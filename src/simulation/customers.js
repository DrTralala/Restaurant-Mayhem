import { isRestaurantOpen } from './clock';
import { buildBlockedCells, worldToCell } from './pathfinding';
import { moveCharacterTowards, moveCharacterWithRecovery, planCharacterPath } from './movement';
import { getDoorPosition, getDoors, getQueuePosition } from './world';
import { clampReputation, getQueuePatienceMultiplier, getUpgradeEffect } from './balance';

let customerIdCounter = 0;
let partyIdCounter = 0;

export function getExitHeading(customerId) {
  const hash = String(customerId).split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const angleDegrees = [-35, 0, 35][hash % 3];
  const radians = angleDegrees * Math.PI / 180;
  return { angleDegrees, x: Math.cos(radians), y: Math.sin(radians) };
}

function leavingFields(customer, overrides = {}) {
  const leaving = {
    ...customer,
    state: 'leaving',
    exitPhase: 'to_door',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: null,
    path: [],
    stalledFor: 0,
    checkoutPosition: null,
    ...overrides,
  };
  delete leaving.pathGoal;
  delete leaving.usingStaticFallback;
  delete leaving.minimumSpacing;
  return leaving;
}

function isOpenSegment(state, start, end) {
  const blocked = buildBlockedCells(state);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const point = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    const cell = worldToCell(point);
    if (blocked.has(`${cell.x},${cell.y}`)) return false;
  }
  return true;
}

function isOpenCell(state, point) {
  const cell = worldToCell(point);
  return !buildBlockedCells(state).has(`${cell.x},${cell.y}`);
}
function nextCustomerId() {
  return `c${++customerIdCounter}`;
}

const ARCHETYPES = ['regular', 'regular', 'regular', 'foodie', 'rusher', 'influencer'];

function chooseParty() {
  const roll = Math.random();
  if (roll < 0.45) return { type: 'solo', size: 1 };
  if (roll < 0.80) return { type: 'couple', size: 2 };
  return { type: 'family', size: 4 };
}

export function spawnCustomers(state, dt = 1) {
  if (!isRestaurantOpen(state)) return state;

  const queuedParties = new Set((state.queue || []).map((customer, index) => customer.partyId ?? customer.id ?? index)).size;
  if (queuedParties >= 8) return state;

  const spawnRatePerSecond = 0.018
    + (state.restaurant.reputation - 1) * 0.004
    + getUpgradeEffect(state, 'customerRate');
  const spawnProbability = 1 - Math.exp(-spawnRatePerSecond * Math.max(0, dt));
  if (Math.random() > spawnProbability) return state;

  const patienceMap = { regular: 240, foodie: 330, rusher: 150, influencer: 270 };
  const party = chooseParty();
  const partyId = `p${++partyIdCounter}`;
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  const newCustomers = Array.from({ length: party.size }, () => {
    return {
      id: nextCustomerId(),
      partyId,
      partyType: party.type,
      partySize: party.size,
      archetype,
      gender: Math.random() < 0.5 ? 'male' : 'female',
      patience: patienceMap[archetype],
      happiness: 80 + getUpgradeEffect(state, 'happiness'),
      state: 'queued',
      dishId: null,
      drinkId: null,
      tableId: null,
      chairId: null,
      tipAmount: 0,
      seatTime: null,
      orderTime: null,
      eatTime: null,
    };
  });

  return {
    ...state,
    queue: [...state.queue, ...newCustomers],
  };
}

export function updateCustomers(state, dt) {
  const patienceStates = new Set(['arriving', 'waiting', 'guided', 'seated', 'ordering', 'waiting_for_items', 'paying']);
  let abandonmentCount = 0;
  let updatedCustomers = state.customers.map(c => {
    const newPatience = patienceStates.has(c.state)
      ? Math.max(0, c.patience - dt)
      : c.patience;

    if (newPatience <= 0 && patienceStates.has(c.state)) {
      if (!c.reputationApplied) abandonmentCount += 1;
      return leavingFields(c, { patience: 0, happiness: Math.max(0, c.happiness - 30), reputationApplied: true });
    }

    let newState = c.state;
    if (c.state === 'arriving') {
      newState = 'waiting';
    }

    return { ...c, patience: newPatience, state: newState };
  });

  // Update queue: apply party pressure to patience, then remove those who run out.
  const queuePatienceMultiplier = getQueuePatienceMultiplier(state.queue);
  let updatedQueue = state.queue.map(q => ({
    ...q,
    patience: Math.max(0, q.patience - dt * queuePatienceMultiplier),
  }));

  // Separate queue members whose patience expired
  const deadQueue = updatedQueue.filter(q => q.patience <= 0);
  updatedQueue = updatedQueue.filter(q => q.patience > 0);

  // If dead queue members exist, add them as leaving customers (reputation penalty)
  if (deadQueue.length > 0) {
    abandonmentCount += deadQueue.filter(customer => !customer.reputationApplied).length;
    updatedCustomers = [...updatedCustomers, ...deadQueue.map(q => leavingFields(q, {
      happiness: Math.max(0, q.happiness - 30), tableId: null, reputationApplied: true,
    }))];
  }

  const cashierStations = Array.isArray(state.cashierStations) ? state.cashierStations : [];
  const staffedCashierStations = cashierStations.filter(station =>
    (state.staff || []).some(staff => staff.id === station.assignedStaffId && staff.role === 'waiter'),
  );
  const fallbackCashierStation = staffedCashierStations[0] || cashierStations[0];
  const routingCashierStations = staffedCashierStations.length > 0
    ? staffedCashierStations
    : fallbackCashierStation ? [fallbackCashierStation] : [];
  const stationById = new Map(cashierStations.map(station => [station.id, station]));
  const payingCustomers = updatedCustomers.filter(customer => customer.state === 'paying');

  if (payingCustomers.length > 0 && fallbackCashierStation) {
    const queueLengths = new Map(routingCashierStations.map(station => [station.id, 0]));
    for (const customer of payingCustomers) {
      if (!queueLengths.has(customer.cashierStationId)) continue;
      queueLengths.set(customer.cashierStationId, queueLengths.get(customer.cashierStationId) + 1);
    }

    updatedCustomers = updatedCustomers.map(customer => {
      if (customer.state !== 'paying') return customer;
      const assignedStation = stationById.get(customer.cashierStationId);
      if (assignedStation || !fallbackCashierStation) return customer;
      const shortestQueue = routingCashierStations.reduce((shortest, station) =>
        queueLengths.get(station.id) < queueLengths.get(shortest.id) ? station : shortest,
      routingCashierStations[0]);
      queueLengths.set(shortestQueue.id, queueLengths.get(shortestQueue.id) + 1);
      return { ...customer, cashierStationId: shortestQueue.id };
    });

    const payingByStation = new Map();
    for (const customer of updatedCustomers) {
      if (customer.state !== 'paying' || !stationById.has(customer.cashierStationId)) continue;
      const group = payingByStation.get(customer.cashierStationId) || [];
      group.push(customer);
      payingByStation.set(customer.cashierStationId, group);
    }

    const positions = new Map();
    for (const [stationId, customersAtStation] of payingByStation) {
      const station = stationById.get(stationId);
      customersAtStation
        .sort((a, b) => (a.paymentQueuedAt ?? 0) - (b.paymentQueuedAt ?? 0))
        .forEach((customer, queueIndex) => {
          positions.set(customer.id, {
            x: station.x - 20 - queueIndex * 20,
            y: station.y + station.h / 2,
          });
        });
    }

    updatedCustomers = updatedCustomers.map(customer => {
      const checkoutPosition = positions.get(customer.id);
      if (!checkoutPosition) return customer;
      const current = Number.isFinite(customer.x) && Number.isFinite(customer.y)
        ? customer
        : { ...customer, x: checkoutPosition.x - 80, y: checkoutPosition.y + 80 };
      const goal = worldToCell(checkoutPosition);
      const currentGoal = current.pathGoal;
      const arrived = Math.hypot(current.x - checkoutPosition.x, current.y - checkoutPosition.y) <= 2;
      if (arrived) return { ...current, checkoutPosition, path: [], pathGoal: undefined, stalledFor: 0 };
      const needsPlan = !current.path?.length || !currentGoal || currentGoal.x !== goal.x || currentGoal.y !== goal.y;
      const routed = needsPlan
        ? planCharacterPath(state, current, { world: checkoutPosition }, [
          ...(state.staff || []),
          ...updatedCustomers.filter(candidate => candidate.id !== current.id && candidate.exitPhase !== 'fading'),
        ])
        : { ...current, checkoutPosition };
      return moveCharacterWithRecovery(state, { ...routed, checkoutPosition }, dt, [
        ...(state.staff || []),
        ...updatedCustomers.filter(candidate => candidate.id !== current.id && candidate.exitPhase !== 'fading'),
      ], 62);
    });
  }

  // Free tables as soon as their last customer begins leaving, while retaining
  // those customers so their walk to the exit remains visible.
  const leavingTableIds = new Set(updatedCustomers.filter(c => c.state === 'leaving').map(c => c.tableId).filter(Boolean));
  let updatedTables = state.tables;
  if (leavingTableIds.size > 0) {
    updatedTables = state.tables.map(t =>
      leavingTableIds.has(t.id) && !updatedCustomers.some(customer => customer.tableId === t.id && customer.state !== 'leaving')
        ? { ...t, status: 'dirty' }
        : t
    );
  }

  const doors = getDoors(state);
  const claimedDoors = new Map();
  for (const customer of updatedCustomers) {
    if (customer.state === 'leaving' && customer.exitPhase !== 'fading' && customer.exitDoorId) {
      claimedDoors.set(customer.exitDoorId, (claimedDoors.get(customer.exitDoorId) || 0) + 1);
    }
  }

  updatedCustomers = updatedCustomers.map((customer, index, allCustomers) => {
    if (customer.state !== 'leaving' || customer.exitPhase === 'fading') return customer;
    let leaving = customer;
    if (!Number.isFinite(leaving.x) || !Number.isFinite(leaving.y)) {
      const table = state.tables.find(candidate => candidate.id === leaving.tableId);
      const queueIndex = state.queue.findIndex(candidate => candidate.id === leaving.id);
      const fallback = table && Number.isFinite(table.x) && Number.isFinite(table.y)
        ? { x: table.x + 20, y: table.y + 20 }
        : queueIndex >= 0
          ? getQueuePosition(state, queueIndex)
          : getDoorPosition(state, getDoors(state)[0]).inside;
      leaving = { ...leaving, ...fallback };
    }
    if (!leaving.exitDoorId) {
      const door = [...doors].sort((a, b) => {
        const loadDifference = (claimedDoors.get(a.id) || 0) - (claimedDoors.get(b.id) || 0);
        return loadDifference || Math.abs(a.y - leaving.y) - Math.abs(b.y - leaving.y);
      })[0];
      if (!door) return leaving;
      claimedDoors.set(door.id, (claimedDoors.get(door.id) || 0) + 1);
      leaving = { ...leaving, exitDoorId: door.id };
    }
    const destination = getDoorPosition(state, doors.find(door => door.id === leaving.exitDoorId)).outside;
    const goal = worldToCell(destination);
    if (!leaving.path?.length && Math.hypot(leaving.x - destination.x, leaving.y - destination.y) <= 2) {
      return { ...leaving, exitPhase: 'fading', exitFadeProgress: 0, exitHeading: getExitHeading(leaving.id), path: [], stalledFor: 0 };
    }
    let hasStaticRoute = leaving.path?.length > 0;
    if (!leaving.path?.length || !leaving.pathGoal
      || leaving.pathGoal.x !== goal.x || leaving.pathGoal.y !== goal.y) {
      leaving = planCharacterPath(state, leaving, { world: destination }, [
        ...(state.staff || []),
        ...allCustomers.filter(candidate => candidate.id !== leaving.id && candidate.exitPhase !== 'fading'),
      ]);
      hasStaticRoute = leaving.path.length > 0;
      if (!hasStaticRoute) {
        const currentCell = worldToCell(leaving);
        hasStaticRoute = currentCell.x === goal.x && currentCell.y === goal.y
          && isOpenCell(state, leaving);
      }
    }
    const others = [
      ...(state.staff || []),
      ...allCustomers.filter((candidate, candidateIndex) => candidateIndex !== index && candidate.exitPhase !== 'fading'),
    ];
    const frameStart = { x: leaving.x, y: leaving.y };
    const moved = moveCharacterWithRecovery(state, leaving, dt, others, 55);
    const displacement = Math.hypot(moved.x - frameStart.x, moved.y - frameStart.y);
    const remainingBudget = Math.max(0, 55 * dt - displacement);
    if (!hasStaticRoute || moved.path?.length || remainingBudget <= 0) return moved;
    if (!isOpenCell(state, destination)) return moved;
    const finalMove = moveCharacterTowards(moved, destination, remainingBudget / 55, others, 55, 16, state);
    if (!isOpenSegment(state, moved, finalMove)) return moved;
    return finalMove === moved ? moved : finalMove;
  });

  updatedCustomers = updatedCustomers.map(customer => {
    if (customer.state !== 'leaving' || customer.exitPhase !== 'fading') return customer;
    const heading = customer.exitHeading || getExitHeading(customer.id);
    return {
      ...customer,
      x: customer.x + heading.x * 30 * dt,
      y: customer.y + heading.y * 30 * dt,
      exitHeading: heading,
      exitFadeProgress: Math.min(1, (customer.exitFadeProgress || 0) + dt / 4),
    };
  });

  const doorPositions = new Map(doors.map(door => [door.id, getDoorPosition(state, door)]));
  updatedCustomers = updatedCustomers.filter(customer => {
    if (customer.state !== 'leaving') return true;
    if (customer.exitPhase === 'fading') return customer.exitFadeProgress < 1;
    if (customer.path?.length) return true;
    const destination = doorPositions.get(customer.exitDoorId)?.outside;
    return !destination || Math.hypot(customer.x - destination.x, customer.y - destination.y) > 2
      || customer.exitPhase === 'to_door';
  });

  return {
    ...state,
    restaurant: abandonmentCount > 0
      ? {
          ...state.restaurant,
          reputation: clampReputation(state.restaurant.reputation - abandonmentCount * 0.02),
        }
      : state.restaurant,
    customers: updatedCustomers,
    queue: updatedQueue,
    tables: updatedTables,
  };
}
