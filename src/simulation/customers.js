import { isRestaurantOpen } from './clock';
import { findPath, worldToCell } from './pathfinding';
import { moveCharacterAlongPath } from './movement';
import { getDoorPosition, getDoors, getQueuePosition } from './world';
import { clampReputation, getQueuePatienceMultiplier, getUpgradeEffect } from './balance';

let customerIdCounter = 0;
let partyIdCounter = 0;
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
  const patienceStates = new Set(['arriving', 'waiting', 'guided', 'seated', 'ordering', 'paying']);
  let abandonmentCount = 0;
  let updatedCustomers = state.customers.map(c => {
    const newPatience = patienceStates.has(c.state)
      ? Math.max(0, c.patience - dt)
      : c.patience;

    if (newPatience <= 0 && patienceStates.has(c.state)) {
      if (!c.reputationApplied) abandonmentCount += 1;
      return { ...c, patience: 0, state: 'leaving', happiness: Math.max(0, c.happiness - 30), reputationApplied: true };
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
    updatedCustomers = [...updatedCustomers, ...deadQueue.map(q => ({
      ...q,
      state: 'leaving',
      happiness: Math.max(0, q.happiness - 30),
      tableId: null,
      reputationApplied: true,
    }))];
  }

  const cashier = state.cashierStations?.[0];
  if (cashier) {
    const payingCustomers = updatedCustomers
      .filter(customer => customer.state === 'paying')
      .sort((a, b) => (a.paymentQueuedAt ?? 0) - (b.paymentQueuedAt ?? 0));
    const positions = new Map(payingCustomers.map((customer, index) => [customer.id, {
      x: cashier.x - 20 - index * 20,
      y: cashier.y + cashier.h / 2,
    }]));
    updatedCustomers = updatedCustomers.map(customer => {
      const checkoutPosition = positions.get(customer.id);
      if (!checkoutPosition) return customer;
      const current = Number.isFinite(customer.x) && Number.isFinite(customer.y)
        ? customer
        : { ...customer, x: checkoutPosition.x - 80, y: checkoutPosition.y + 80 };
      const path = Math.hypot(current.x - checkoutPosition.x, current.y - checkoutPosition.y) <= 2
        ? []
        : findPath(state, worldToCell(current), worldToCell(checkoutPosition));
      return { ...current, checkoutPosition, path };
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
    if (customer.state === 'leaving' && customer.exitDoorId) {
      claimedDoors.set(customer.exitDoorId, (claimedDoors.get(customer.exitDoorId) || 0) + 1);
    }
  }

  updatedCustomers = updatedCustomers.map((customer, index, allCustomers) => {
    if (customer.state !== 'leaving') return customer;
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
    if (!leaving.exitDoorId || !leaving.path?.length) {
      const door = [...doors].sort((a, b) => {
        const loadDifference = (claimedDoors.get(a.id) || 0) - (claimedDoors.get(b.id) || 0);
        return loadDifference || Math.abs(a.y - leaving.y) - Math.abs(b.y - leaving.y);
      })[0];
      const destination = getDoorPosition(state, door).outside;
      const path = findPath(state, worldToCell(leaving), worldToCell(destination));
      if (!leaving.exitDoorId) claimedDoors.set(door.id, (claimedDoors.get(door.id) || 0) + 1);
      leaving = { ...leaving, exitDoorId: door.id, path };
    }
    const others = [
      ...(state.staff || []),
      ...allCustomers.filter((candidate, candidateIndex) => candidateIndex !== index),
    ];
    return moveCharacterAlongPath(leaving, dt, others, 55);
  });

  const doorPositions = new Map(doors.map(door => [door.id, getDoorPosition(state, door)]));
  updatedCustomers = updatedCustomers.filter(customer => {
    if (customer.state !== 'leaving' || customer.path?.length) return true;
    const destination = doorPositions.get(customer.exitDoorId)?.outside;
    return !destination || Math.hypot(customer.x - destination.x, customer.y - destination.y) > 2;
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
