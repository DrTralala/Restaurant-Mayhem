import { getRushHourMultiplier, isRestaurantOpen } from './clock';
import { buildBlockedCells, worldToCell } from './pathfinding';
import { planCharacterPath, resolveCharacterMovementBatch } from './movement';
import { getCustomerGuideContext } from './guidance';
import { getCashierCustomerPosition, getDoorPosition, getDoors, getQueuePosition } from './world';
import {
  ABANDONMENT_REPUTATION_PENALTY,
  CUSTOMER_PATIENCE,
  clampReputation,
  getBaseArrivalRate,
  getQueuePatienceMultiplier,
  getUpgradeEffect,
} from './balance';

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

function isOpenCell(state, point) {
  const cell = worldToCell(point);
  return !buildBlockedCells(state).has(`${cell.x},${cell.y}`);
}
function nextCustomerId() {
  return `c${++customerIdCounter}`;
}

const ARCHETYPES = ['regular', 'regular', 'regular', 'foodie', 'rusher', 'influencer'];
const PATIENCE_STATES = new Set(['waiting', 'seated', 'waiting_for_items']);

function partyKey(customer) {
  return customer.partyId ?? customer.id;
}

function isWaitingForService(customer, staff) {
  if (PATIENCE_STATES.has(customer.state)) return true;
  return customer.state === 'paying'
    && !(staff || []).some(worker => worker.task?.type === 'take_payment'
      && worker.task.customerId === customer.id);
}

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

  const baseRatePerSecond = Math.max(0, getBaseArrivalRate(state.restaurant.reputation)
    + getUpgradeEffect(state, 'customerRate'));
  const spawnRatePerSecond = baseRatePerSecond
    * getRushHourMultiplier(state.restaurant.gameTime);
  const spawnProbability = 1 - Math.exp(-spawnRatePerSecond * Math.max(0, dt));
  if (Math.random() > spawnProbability) return state;

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
      patience: CUSTOMER_PATIENCE[archetype],
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

function normaliseGameDt(timing) {
  return Math.max(0, Number.isFinite(timing) ? timing : Number(timing?.gameDt) || 0);
}

function normaliseMovementDt(timing) {
  return Math.max(0, Number.isFinite(timing) ? timing : Number(timing?.movementDt) || 0);
}

function replaceCharacters(state, moved, key, committedIds = null) {
  return {
    ...state,
    [key]: (state[key] || []).map(character => {
      if (committedIds && !committedIds.has(character.id)) return character;
      return moved.get(character.id) || character;
    }),
  };
}

function getCompatibilityMovementEntries(state, movementEntries) {
  const entries = [];
  const usedIds = new Set();
  for (const entry of movementEntries) {
    if (entry?.character?.id == null || usedIds.has(entry.character.id)) continue;
    usedIds.add(entry.character.id);
    entries.push(entry);
  }

  for (const character of [...(state.staff || []), ...(state.customers || [])]) {
    if (character?.id == null || usedIds.has(character.id)
      || !Number.isFinite(character.x) || !Number.isFinite(character.y)) continue;
    usedIds.add(character.id);
    entries.push({ character, speed: 0, ignoredIds: [] });
  }
  return entries;
}

function getExitDestination(state, customer) {
  const door = getDoors(state).find(candidate => candidate.id === customer.exitDoorId);
  return door ? getDoorPosition(state, door).outside : null;
}

function isSameCell(left, right) {
  const leftCell = worldToCell(left);
  const rightCell = worldToCell(right);
  return leftCell.x === rightCell.x && leftCell.y === rightCell.y;
}

export function prepareCustomersForMovement(state, gameDt) {
  const customers = state.customers || [];
  const queue = state.queue || [];
  const restaurantOpen = isRestaurantOpen(state);
  const closedQueue = restaurantOpen ? [] : queue.map(customer => leavingFields(customer, {
    tableId: null,
    reputationApplied: true,
    closedAt: state.restaurant.gameTime,
  }));
  let abandonmentCount = 0;
  let updatedCustomers = [...customers, ...closedQueue].map(c => {
    const waitingForService = isWaitingForService(c, state.staff);
    const newPatience = waitingForService
      ? Math.max(0, c.patience - gameDt)
      : c.patience;

    let newState = c.state;
    if (c.state === 'arriving') {
      newState = 'waiting';
    }

    return { ...c, patience: newPatience, state: newState };
  });

  // Update queue: apply party pressure to patience, then remove those who run out.
  const queuePatienceMultiplier = getQueuePatienceMultiplier(queue);
  let updatedQueue = (restaurantOpen ? queue : []).map(q => ({
    ...q,
    patience: Math.max(0, q.patience - gameDt * queuePatienceMultiplier),
  }));

  const abandoningParties = new Set([
    ...updatedCustomers
      .filter(customer => isWaitingForService(customer, state.staff) && customer.patience <= 0)
      .map(partyKey),
    ...updatedQueue.filter(customer => customer.patience <= 0).map(partyKey),
  ]);

  if (abandoningParties.size > 0) {
    const allPartyMembers = [...updatedCustomers, ...updatedQueue];
    abandonmentCount = [...abandoningParties].filter(key =>
      !allPartyMembers.some(customer => partyKey(customer) === key && customer.reputationApplied),
    ).length;

    updatedCustomers = updatedCustomers.map(customer => abandoningParties.has(partyKey(customer))
      ? leavingFields(customer, {
          patience: Math.max(0, customer.patience),
          happiness: Math.max(0, customer.happiness - 30),
          reputationApplied: true,
        })
      : customer);

    const abandoningQueue = updatedQueue.filter(customer => abandoningParties.has(partyKey(customer)));
    updatedQueue = updatedQueue.filter(customer => !abandoningParties.has(partyKey(customer)));
    updatedCustomers = [...updatedCustomers, ...abandoningQueue.map(customer => leavingFields(customer, {
      patience: Math.max(0, customer.patience),
      happiness: Math.max(0, customer.happiness - 30),
      tableId: null,
      reputationApplied: true,
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
      if (queueLengths.has(customer.cashierStationId) || !fallbackCashierStation) return customer;
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
    const queueIndexes = new Map();
    for (const [stationId, customersAtStation] of payingByStation) {
      const station = stationById.get(stationId);
      customersAtStation
        .sort((a, b) => (a.paymentQueuedAt ?? 0) - (b.paymentQueuedAt ?? 0))
        .forEach((customer, queueIndex) => {
          positions.set(customer.id, getCashierCustomerPosition(station, queueIndex));
          queueIndexes.set(customer.id, queueIndex);
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
      if (arrived) return { ...current, checkoutPosition, paymentReady: queueIndexes.get(customer.id) === 0, path: [], pathGoal: undefined, stalledFor: 0 };
      const needsPlan = !current.path?.length || !currentGoal || currentGoal.x !== goal.x || currentGoal.y !== goal.y;
      const routed = needsPlan
        ? planCharacterPath(state, current, { world: checkoutPosition }, [
          ...(state.staff || []),
          ...updatedCustomers.filter(candidate => candidate.id !== current.id && candidate.exitPhase !== 'fading'),
        ])
        : { ...current, checkoutPosition };
      return { ...routed, checkoutPosition, paymentReady: false };
    });
  }

  // Free tables as soon as their last customer begins leaving, while retaining
  // those customers so their walk to the exit remains visible.
  const leavingTableIds = new Set(updatedCustomers.filter(c => c.state === 'leaving').map(c => c.tableId).filter(Boolean));
  let updatedTables = state.tables || [];
  if (leavingTableIds.size > 0) {
    updatedTables = updatedTables.map(t =>
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
      const table = (state.tables || []).find(candidate => candidate.id === leaving.tableId);
      const queueIndex = queue.findIndex(candidate => candidate.id === leaving.id);
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
    const destination = getExitDestination(state, leaving);
    if (!destination) return leaving;
    if (!leaving.path?.length && Math.hypot(leaving.x - destination.x, leaving.y - destination.y) <= 2) {
      return leaving;
    }
    const goal = worldToCell(destination);
    if (!leaving.path?.length || !leaving.pathGoal
      || leaving.pathGoal.x !== goal.x || leaving.pathGoal.y !== goal.y) {
      leaving = planCharacterPath(state, leaving, { world: destination }, [
        ...(state.staff || []),
        ...allCustomers.filter(candidate => candidate.id !== leaving.id && candidate.exitPhase !== 'fading'),
      ]);
    }
    return leaving;
  });

  return {
    ...state,
    restaurant: abandonmentCount > 0
      ? {
          ...state.restaurant,
          reputation: clampReputation(state.restaurant.reputation
            - abandonmentCount * ABANDONMENT_REPUTATION_PENALTY),
        }
      : state.restaurant,
    customers: updatedCustomers,
    queue: updatedQueue,
    tables: updatedTables,
  };
}

export function getCustomerMovementEntries(state, movementDt) {
  return (state.customers || []).flatMap(character => {
    if (character.state === 'leaving' && character.exitPhase === 'fading') {
      const heading = character.exitHeading || getExitHeading(character.id);
      return [{
        character,
        speed: 30,
        target: {
          x: character.x + heading.x * 30 * movementDt,
          y: character.y + heading.y * 30 * movementDt,
        },
        consumePath: false,
        ignoredIds: [],
      }];
    }

    if (character.state === 'leaving' && character.exitPhase !== 'fading' && !character.path?.length) {
      const destination = getExitDestination(state, character);
      if (destination && Math.hypot(character.x - destination.x, character.y - destination.y) > 2
        && isSameCell(character, destination) && isOpenCell(state, character)) {
        return [{
          character,
          speed: 55,
          target: destination,
          consumePath: false,
          ignoredIds: [],
        }];
      }
    }

    if (!character.path?.length || !['paying', 'leaving', 'guided'].includes(character.state)) return [];
    const guideContext = character.state === 'guided' ? getCustomerGuideContext(state, character) : null;
    if (character.state === 'guided' && !guideContext) return [];
    const entry = {
      character,
      speed: character.state === 'leaving' ? 55 : 62,
      ignoredIds: guideContext?.ignoredIds || [],
      ...(guideContext ? { provenance: 'guide' } : {}),
    };
    if (character.state === 'leaving' && character.exitPhase !== 'fading') {
      const destination = getExitDestination(state, character);
      const goal = destination && worldToCell(destination);
      const routeGoal = character.pathGoal || character.path.at(-1);
      if (destination && goal && routeGoal?.x === goal.x && routeGoal?.y === goal.y) {
        return [{ ...entry, targetAfterPath: destination }];
      }
    }
    return [entry];
  });
}

/**
 * Resolve customer arrival and fade state after a committed movement batch.
 * `fadingMovementIds` is optional batch evidence: pass a Set of IDs whose
 * fading displacement was committed. Omitting it performs arrival transitions
 * and leaves existing fade progress unchanged.
 */
export function resolveCustomersAfterMovement(state, movementDt, fadingMovementIds = null) {
  const doorPositions = new Map(getDoors(state).map(door => [door.id, getDoorPosition(state, door)]));
  const fadingAtMovementStart = fadingMovementIds || new Set();
  let updatedCustomers = (state.customers || []).map(customer => {
    if (customer.state !== 'leaving' || customer.exitPhase === 'fading') return customer;
    const destination = doorPositions.get(customer.exitDoorId)?.outside;
    const destinationCell = destination && worldToCell(destination);
    const routeGoal = customer.pathGoal || customer.path?.at(-1);
    const committedAtDoor = !customer.path?.length || destinationCell
      && routeGoal?.x === destinationCell.x && routeGoal?.y === destinationCell.y;
    if (committedAtDoor && destination
      && Math.hypot(customer.x - destination.x, customer.y - destination.y) <= 2) {
      return {
        ...customer,
        exitPhase: 'fading',
        exitFadeProgress: 0,
        exitHeading: getExitHeading(customer.id),
        path: [],
        stalledFor: 0,
      };
    }
    return customer;
  });

  updatedCustomers = updatedCustomers.map(customer => {
    if (customer.state !== 'leaving' || customer.exitPhase !== 'fading'
      || !fadingAtMovementStart.has(customer.id)) return customer;
    const heading = customer.exitHeading || getExitHeading(customer.id);
    return {
      ...customer,
      exitHeading: heading,
      exitFadeProgress: Math.min(1, (customer.exitFadeProgress || 0) + movementDt / 4),
    };
  });

  updatedCustomers = updatedCustomers.filter(customer => {
    if (customer.state !== 'leaving') return true;
    if (customer.exitPhase === 'fading') return customer.exitFadeProgress < 1;
    if (customer.path?.length) return true;
    const destination = doorPositions.get(customer.exitDoorId)?.outside;
    return !destination || Math.hypot(customer.x - destination.x, customer.y - destination.y) > 2
      || customer.exitPhase === 'to_door';
  });

  return { ...state, customers: updatedCustomers };
}

export function updateCustomers(state, timing) {
  const gameDt = normaliseGameDt(timing);
  const movementDt = normaliseMovementDt(timing);
  const prepared = prepareCustomersForMovement(state, gameDt);
  const movementEntries = getCustomerMovementEntries(prepared, movementDt);
  const movingCustomerIds = new Set(movementEntries.map(entry => entry.character.id));
  const entries = getCompatibilityMovementEntries(prepared, movementEntries);
  const moved = resolveCharacterMovementBatch(prepared, entries, movementDt);
  const committed = replaceCharacters(prepared, moved, 'customers', movingCustomerIds);
  const fadingMovementIds = new Set(movementEntries
    .filter(entry => entry.character.state === 'leaving' && entry.character.exitPhase === 'fading')
    .filter(entry => {
      const movedCharacter = moved.get(entry.character.id);
      return movedCharacter
        && (movedCharacter.x !== entry.character.x || movedCharacter.y !== entry.character.y);
    })
    .map(entry => entry.character.id));
  return resolveCustomersAfterMovement(committed, movementDt, fadingMovementIds);
}
