import { findAdjacentOpenCells, cellToWorld } from './pathfinding';
import { clampReputation } from './balance';
import { getRestaurantWorld } from './world';

const DIRT_PER_MINUTE = 0.25;
const EATING_DIRT_PER_MINUTE = 0.5;
const SEATED_VISUAL_STATES = new Set(['seated', 'ordering', 'eating', 'waiting_for_items']);

export function getNextDirtId(floorDirt = []) {
  const next = floorDirt.reduce((maximum, dirt) => {
    const match = /^dirt-(\d+)$/.exec(dirt.id || '');
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
  return `dirt-${next}`;
}

export function isRestaurantFloorPoint(state, point) {
  if (![point?.x, point?.y].every(Number.isFinite)) return false;
  const { floorX, doorX, kitchenY, floorH } = getRestaurantWorld(state.restaurant);
  return point.x >= floorX && point.x <= doorX
    && point.y >= kitchenY && point.y <= kitchenY + floorH;
}

function customerDirtOrigin(state, customer) {
  if (SEATED_VISUAL_STATES.has(customer.state)) {
    const chair = (state.chairs || []).find(candidate => candidate.id === customer.chairId
      && candidate.tableId === customer.tableId);
    if (chair && Number.isFinite(chair.x) && Number.isFinite(chair.y)) {
      return { x: chair.x + 10, y: chair.y + 10 };
    }
  }
  const table = (state.tables || []).find(candidate => candidate.id === customer.tableId);
  if (SEATED_VISUAL_STATES.has(customer.state)
    && table && Number.isFinite(table.x) && Number.isFinite(table.y)) {
    return { x: table.x + 20, y: table.y + 20 };
  }
  return !SEATED_VISUAL_STATES.has(customer.state)
    && Number.isFinite(customer.x) && Number.isFinite(customer.y)
    ? { x: customer.x, y: customer.y }
    : null;
}

function customerRect(state, customer) {
  const origin = customerDirtOrigin(state, customer);
  return origin ? { x: origin.x - 10, y: origin.y - 10, w: 20, h: 20 } : null;
}

function customerPosition(state, customer) {
  if (SEATED_VISUAL_STATES.has(customer.state)) return customerDirtOrigin(state, customer);
  if (Number.isFinite(customer.x) && Number.isFinite(customer.y)) return { x: customer.x, y: customer.y };
  const table = (state.tables || []).find(candidate => candidate.id === customer.tableId);
  return table && Number.isFinite(table.x) && Number.isFinite(table.y)
    ? { x: table.x + 20, y: table.y + 20 }
    : null;
}

function cellCentre(cell) {
  const point = cellToWorld(cell);
  return { x: point.x + 10, y: point.y + 10 };
}

export function updateDirt(state, gameDt, random = Math.random) {
  const boundedDt = Math.min(60, Math.max(0, gameDt));
  let floorDirt = [...(state.floorDirt || [])];
  let customers = (state.customers || []).map(customer => ({ ...customer }));
  for (const customer of customers) {
    if (customer.state === 'leaving' || customer.state === 'queued' || customer.state === 'waiting') continue;
    const rect = customerRect(state, customer);
    if (!rect) continue;
    const rate = customer.state === 'eating' ? EATING_DIRT_PER_MINUTE : DIRT_PER_MINUTE;
    const increment = (boundedDt / 60) * rate;
    let dirtFactor = Math.max(0, Number(customer.dirtFactor) || 0) + increment;
    if (dirtFactor >= 10) {
      const candidates = findAdjacentOpenCells(state, rect)
        .filter(cell => isRestaurantFloorPoint(state, cellCentre(cell)));
      if (candidates.length) {
        const cell = candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, random()) * candidates.length))];
        const point = cellCentre(cell);
        floorDirt.push({ id: getNextDirtId(floorDirt), x: point.x, y: point.y, createdAt: state.restaurant.gameTime });
        dirtFactor -= 10;
      }
    }
    customer.dirtFactor = dirtFactor;
  }

  const penaltyDt = boundedDt / 60;
  customers = customers.map(customer => {
    if (customer.state === 'leaving' || customer.state === 'queued' || customer.state === 'waiting') return customer;
    const position = customerPosition(state, customer);
    if (!position) return customer;
    const nearbyCount = floorDirt.filter(dirt => Math.hypot(dirt.x - position.x, dirt.y - position.y) <= 120).length;
    const happinessLoss = Math.min(1, nearbyCount * 0.2) * penaltyDt;
    return nearbyCount > 0
      ? { ...customer, happiness: Math.max(0, (Number(customer.happiness) || 0) - happinessLoss) }
      : customer;
  });
  const excessDirt = Math.max(0, floorDirt.length - 3);
  const reputationLoss = Math.min(0.01, excessDirt * 0.001) * penaltyDt;
  return {
    ...state,
    customers,
    floorDirt,
    restaurant: {
      ...state.restaurant,
      reputation: clampReputation((state.restaurant.reputation ?? 1) - reputationLoss),
    },
  };
}
