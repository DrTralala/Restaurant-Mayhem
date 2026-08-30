import { findAdjacentOpenCells, cellToWorld } from './pathfinding';
import { clampReputation } from './balance';

const DIRT_PER_MINUTE = 0.5;
const EATING_DIRT_PER_MINUTE = 1;

export function getNextDirtId(floorDirt = []) {
  const next = floorDirt.reduce((maximum, dirt) => {
    const match = /^dirt-(\d+)$/.exec(dirt.id || '');
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
  return `dirt-${next}`;
}

function customerRect(state, customer) {
  const table = (state.tables || []).find(candidate => candidate.id === customer.tableId);
  if (Number.isFinite(customer.x) && Number.isFinite(customer.y)) {
    return { x: customer.x - 10, y: customer.y - 10, w: 20, h: 20 };
  }
  if (table && Number.isFinite(table.x) && Number.isFinite(table.y)) {
    return { x: table.x, y: table.y, w: 40, h: 40 };
  }
  return null;
}

function customerPosition(state, customer) {
  if (Number.isFinite(customer.x) && Number.isFinite(customer.y)) return { x: customer.x, y: customer.y };
  const table = (state.tables || []).find(candidate => candidate.id === customer.tableId);
  return table && Number.isFinite(table.x) && Number.isFinite(table.y)
    ? { x: table.x + 20, y: table.y + 20 }
    : null;
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
      const candidates = findAdjacentOpenCells(state, rect);
      if (candidates.length) {
        const cell = candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, random()) * candidates.length))];
        const point = cellToWorld(cell);
        floorDirt.push({ id: getNextDirtId(floorDirt), x: point.x + 10, y: point.y + 10, createdAt: state.restaurant.gameTime });
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
