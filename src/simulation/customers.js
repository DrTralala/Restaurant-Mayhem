import { getRushHourMultiplier, isRestaurantOpen } from './clock';
import { buildBlockedCells, cellToWorld, findPath, isInsideWorld, worldToCell } from './pathfinding';
import { clearMovementRecoveryMetadata, planCharacterPath, resolveCharacterMovementBatch } from './movement';
import { getCustomerGuideContext, releaseTableReservation } from './guidance';
import { getDoorPosition, getDoors, getRestaurantWorld } from './world';
import { isCheckoutState, prepareCheckoutCustomers } from './checkout';
import {
  QUEUE_PARTY_CAPACITY,
  getQueueProjectedMembers,
  normaliseCustomerQueue,
} from './customerQueue';
import {
  ABANDONMENT_REPUTATION_PENALTY,
  clampReputation,
  getBaseArrivalRate,
  getCustomerPatience,
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
  return clearMovementRecoveryMetadata({
    ...customer,
    state: 'leaving',
    exitPhase: 'to_door',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: null,
    path: [],
    stalledFor: 0,
    cashierStationId: null,
    checkoutPosition: null,
    paymentReady: false,
    ...overrides,
  });
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
const ITEM_WAIT_PATIENCE_FACTOR = 0.5;

function partyKey(customer) {
  return customer.partyId ?? customer.id;
}

function isWaitingForService(customer, staff) {
  const activeOrder = customer.state === 'seated'
    && (staff || []).some(worker => worker.task?.type === 'take_order'
      && worker.task.customerId === customer.id);
  if (activeOrder) return false;
  return PATIENCE_STATES.has(customer.state);
}

function getPatienceFactor(customer) {
  return customer.state === 'waiting_for_items' ? ITEM_WAIT_PATIENCE_FACTOR : 1;
}

function getPatienceMax(customer) {
  if (Number.isFinite(customer.patienceMax) && customer.patienceMax > 0) {
    return customer.patienceMax;
  }
  const archetypePatience = getCustomerPatience(customer.archetype, customer.partySize);
  if (Number.isFinite(archetypePatience) && archetypePatience > 0) return archetypePatience;
  return Math.max(0, Number(customer.patience) || 0);
}

function getQueuePatience(customer) {
  return Number.isFinite(customer.queuePatience) ? customer.queuePatience : customer.patience;
}

function getQueuePatienceMax(customer) {
  if (Number.isFinite(customer.queuePatienceMax) && customer.queuePatienceMax > 0) {
    return customer.queuePatienceMax;
  }
  return getPatienceMax(customer);
}

function chooseParty() {
  const roll = Math.random();
  if (roll < 0.45) return { type: 'solo', size: 1 };
  if (roll < 0.80) return { type: 'couple', size: 2 };
  return { type: 'family', size: 4 };
}

export function spawnCustomers(state, dt = 1) {
  const queue = normaliseCustomerQueue(state.queue || []);
  if (!isRestaurantOpen(state)) return { ...state, queue };
  if (queue.length >= QUEUE_PARTY_CAPACITY) return { ...state, queue };

  const baseRatePerSecond = Math.max(0, getBaseArrivalRate(state.restaurant.reputation)
    + getUpgradeEffect(state, 'customerRate'));
  const spawnRatePerSecond = baseRatePerSecond
    * getRushHourMultiplier(state.restaurant.gameTime);
  const spawnProbability = 1 - Math.exp(-spawnRatePerSecond * Math.max(0, dt));
  if (Math.random() > spawnProbability) return { ...state, queue };

  const party = chooseParty();
  const partyId = `p${++partyIdCounter}`;
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  const newCustomers = Array.from({ length: party.size }, () => {
    const patienceMax = getCustomerPatience(archetype, party.size);
    return {
      id: nextCustomerId(),
      partyId,
      partyType: party.type,
      partySize: party.size,
      archetype,
      gender: Math.random() < 0.5 ? 'male' : 'female',
      patience: patienceMax,
      patienceMax,
      queuePatience: patienceMax,
      queuePatienceMax: patienceMax,
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
    queue: [...queue, { partyId, members: newCustomers }],
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

const CUSTOMER_STUCK_SECONDS = 10;
const CUSTOMER_PROGRESS_DISTANCE = 0.1;
const CUSTOMER_RECOVERY_SPACING = 16;
const STUCK_MOVEMENT_STATES = new Set(['guided', 'checkout_moving', 'leaving']);

function withoutStuckWatchdog(customer) {
  if (!Object.hasOwn(customer, 'stuckWatchdog')) return customer;
  const { stuckWatchdog: _stuckWatchdog, ...remaining } = customer;
  return remaining;
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function getCustomerStuckGoal(state, customer) {
  if (!STUCK_MOVEMENT_STATES.has(customer.state)
    || customer.exitPhase === 'fading'
    || !isFinitePoint(customer)) return null;

  let cell = null;
  let world = null;
  let useWorldGoal = false;
  if (customer.state === 'guided') {
    const finalPathCell = Array.isArray(customer.path) ? customer.path.at(-1) : null;
    cell = isFinitePoint(customer.pathGoal)
      ? customer.pathGoal
      : isFinitePoint(finalPathCell) ? finalPathCell : null;
    world = isFinitePoint(cell) ? cellToWorld(cell) : null;
  } else if (customer.state === 'checkout_moving') {
    world = customer.checkoutPosition;
    cell = isFinitePoint(world) ? worldToCell(world) : null;
    useWorldGoal = true;
  } else {
    world = getExitDestination(state, customer);
    cell = isFinitePoint(world) ? worldToCell(world) : null;
    useWorldGoal = true;
  }
  if (!isFinitePoint(cell) || !isFinitePoint(world)) return null;
  return {
    cell,
    world,
    useWorldGoal,
    key: `${customer.state}:${cell.x},${cell.y}:${world.x},${world.y}`,
  };
}

function observeCustomerProgress(customer, goal, movementDt) {
  const previous = customer.stuckWatchdog;
  const validPrevious = previous
    && Number.isFinite(previous.x)
    && Number.isFinite(previous.y)
    && Number.isFinite(previous.noProgressFor)
    && previous.noProgressFor >= 0;
  const fresh = !validPrevious
    || previous.state !== customer.state
    || previous.goalKey !== goal.key;
  const progress = !fresh && Math.hypot(customer.x - previous.x, customer.y - previous.y)
    + 1e-9 >= CUSTOMER_PROGRESS_DISTANCE;
  if (fresh || progress) {
    return {
      customer: {
        ...customer,
        stuckWatchdog: {
          state: customer.state,
          goalKey: goal.key,
          x: customer.x,
          y: customer.y,
          noProgressFor: 0,
        },
      },
      shouldRecover: false,
    };
  }

  const before = previous.noProgressFor;
  const elapsed = before + movementDt;
  const after = Number.isFinite(elapsed) ? elapsed : Number.MAX_VALUE;
  const nextAttemptAt = (Math.floor(before / CUSTOMER_STUCK_SECONDS) + 1)
    * CUSTOMER_STUCK_SECONDS;
  return {
    customer: {
      ...customer,
      stuckWatchdog: { ...previous, noProgressFor: after },
    },
    shouldRecover: movementDt > 0 && after + 1e-9 >= nextAttemptAt,
  };
}

function isInsideRestaurantWorld(state, point) {
  const world = getRestaurantWorld(state.restaurant || {});
  return point.x >= world.floorX
    && point.x <= world.queueX + world.queueW
    && point.y >= world.kitchenY
    && point.y <= world.diningY + world.areaH + 50;
}

function getStuckRecoveryCandidates(state, customer, goal) {
  const startCell = worldToCell(customer);
  const sameGoalCell = startCell.x === goal.cell.x && startCell.y === goal.cell.y;
  const route = findPath(state, startCell, goal.cell);
  if (!sameGoalCell && route.length === 0) return [];

  const candidates = route.map(cellToWorld);
  const exactWorldAdvances = goal.useWorldGoal
    && Math.hypot(goal.world.x - customer.x, goal.world.y - customer.y)
      >= CUSTOMER_PROGRESS_DISTANCE
    && (sameGoalCell || route.length > 0);
  const finalCandidate = candidates.at(-1);
  if (exactWorldAdvances && (!finalCandidate
    || Math.hypot(finalCandidate.x - goal.world.x, finalCandidate.y - goal.world.y) > 1e-9)) {
    candidates.push(goal.world);
  }
  return candidates;
}

function isSafeStuckRecoveryCandidate(state, customer, candidate, occupiedActors) {
  if (!isFinitePoint(candidate)
    || !isInsideRestaurantWorld(state, candidate)
    || Math.hypot(candidate.x - customer.x, candidate.y - customer.y)
      < CUSTOMER_PROGRESS_DISTANCE) return false;
  const cell = worldToCell(candidate);
  if (!isInsideWorld(state, cell) || buildBlockedCells(state).has(`${cell.x},${cell.y}`)) {
    return false;
  }
  return occupiedActors.every(actor => actor.kind === 'customer' && actor.id === customer.id
    || Math.hypot(candidate.x - actor.x, candidate.y - actor.y)
      >= CUSTOMER_RECOVERY_SPACING - 1e-9);
}

function replaceOccupiedCustomer(occupiedActors, customer) {
  return [
    ...occupiedActors.filter(actor => actor.kind !== 'customer' || actor.id !== customer.id),
    { kind: 'customer', id: customer.id, x: customer.x, y: customer.y },
  ];
}

export function recoverStuckCustomers(state, movementDt) {
  const dt = Math.max(0, Number.isFinite(movementDt) ? movementDt : 0);
  const customers = state.customers || [];
  const byId = new Map(customers.map(customer => [customer.id, customer]));
  let occupiedActors = [
    ...(state.staff || []).map(actor => ({ ...actor, kind: 'staff' })),
    ...customers.map(actor => ({ ...actor, kind: 'customer' })),
  ].filter(isFinitePoint);

  const ordered = [...customers].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)));
  for (const original of ordered) {
    const customer = byId.get(original.id);
    const workingState = {
      ...state,
      customers: customers.map(candidate => byId.get(candidate.id) || candidate),
    };
    const goal = getCustomerStuckGoal(workingState, customer);
    if (!goal) {
      byId.set(customer.id, withoutStuckWatchdog(customer));
      continue;
    }

    const observed = observeCustomerProgress(customer, goal, dt);
    byId.set(customer.id, observed.customer);
    if (!observed.shouldRecover) continue;

    const candidate = getStuckRecoveryCandidates(workingState, observed.customer, goal)
      .find(point => isSafeStuckRecoveryCandidate(
        workingState,
        observed.customer,
        point,
        occupiedActors,
      ));
    if (!candidate) continue;

    const currentCustomers = customers.map(current => byId.get(current.id) || current);
    const recoveryState = { ...state, customers: currentCustomers };
    const guideContext = getCustomerGuideContext(recoveryState, observed.customer);
    const cleared = withoutStuckWatchdog(clearMovementRecoveryMetadata({
      ...observed.customer,
      ...candidate,
    }));
    const recovered = planCharacterPath(
      recoveryState,
      cleared,
      goal.useWorldGoal ? { world: goal.world } : { cell: goal.cell },
      [
        ...(state.staff || []),
        ...currentCustomers.filter(current => current.id !== customer.id),
      ],
      guideContext?.ignoredIds || [],
    );
    byId.set(customer.id, recovered);
    occupiedActors = replaceOccupiedCustomer(occupiedActors, recovered);
  }

  return {
    ...state,
    customers: customers.map(customer => byId.get(customer.id) || customer),
  };
}

function isSameCell(left, right) {
  const leftCell = worldToCell(left);
  const rightCell = worldToCell(right);
  return leftCell.x === rightCell.x && leftCell.y === rightCell.y;
}

export function prepareCustomersForMovement(state, gameDt) {
  const customers = state.customers || [];
  const queue = normaliseCustomerQueue(state.queue || []);
  const queuePositions = new Map(getQueueProjectedMembers(state, queue)
    .map(customer => [customer.id, { x: customer.x, y: customer.y }]));
  const restaurantOpen = isRestaurantOpen(state);
  const closedQueue = restaurantOpen ? [] : queue.flatMap(party =>
    party.members.map(customer => leavingFields({
      ...customer,
      ...queuePositions.get(customer.id),
    }, {
      tableId: null,
      reputationApplied: true,
      closedAt: state.restaurant.gameTime,
    })));
  let abandonmentCount = 0;
  let updatedCustomers = [...customers, ...closedQueue].map(c => {
    const waitingForService = isWaitingForService(c, state.staff);
    const newPatience = waitingForService
      ? Math.max(0, c.patience - gameDt * getPatienceFactor(c))
      : c.patience;

    let newState = c.state;
    if (c.state === 'arriving') {
      newState = 'waiting';
    }

    return { ...c, patience: newPatience, state: newState };
  });

  // Update queue: apply party pressure to patience, then remove those who run out.
  const queuePatienceMultiplier = getQueuePatienceMultiplier(queue);
  let updatedQueue = (restaurantOpen ? queue : []).map(party => ({
    ...party,
    members: party.members.map(customer => {
      const patienceMax = getPatienceMax(customer);
      const queuePatienceMax = getQueuePatienceMax(customer);
      return {
        ...customer,
        patience: patienceMax,
        patienceMax,
        queuePatience: Math.max(0, getQueuePatience(customer) - gameDt * queuePatienceMultiplier),
        queuePatienceMax,
      };
    }),
  }));

  const abandoningParties = new Set([
    ...updatedCustomers
      .filter(customer => isWaitingForService(customer, state.staff) && customer.patience <= 0)
      .map(partyKey),
    ...updatedQueue
      .filter(party => party.members.some(customer => customer.queuePatience <= 0))
      .map(party => party.partyId),
  ]);

  if (abandoningParties.size > 0) {
    const allPartyMembers = [...updatedCustomers, ...updatedQueue.flatMap(party => party.members)];
    abandonmentCount = [...abandoningParties].filter(key =>
      !allPartyMembers.some(customer => partyKey(customer) === key && customer.reputationApplied),
    ).length;

    updatedCustomers = updatedCustomers.map(customer => abandoningParties.has(partyKey(customer))
      && !isCheckoutState(customer)
      ? leavingFields(customer, {
          patience: Math.max(0, customer.patience),
          happiness: Math.max(0, customer.happiness - 30),
          reputationApplied: true,
        })
      : customer);

    const abandoningQueue = updatedQueue.flatMap(party =>
      abandoningParties.has(party.partyId)
        ? party.members.map(customer => leavingFields({
            ...customer,
            ...queuePositions.get(customer.id),
          }, {
            patience: Math.max(0, customer.patience),
            happiness: Math.max(0, customer.happiness - 30),
            tableId: null,
            reputationApplied: true,
          }))
        : []);
    updatedQueue = updatedQueue.filter(party => !abandoningParties.has(party.partyId));
    updatedCustomers = [...updatedCustomers, ...abandoningQueue];
  }

  updatedCustomers = prepareCheckoutCustomers(
    { ...state, customers: updatedCustomers },
    updatedCustomers,
  );

  // Free tables as soon as their last customer leaves the dining area, while
  // retaining checkout and leaving customers for their visible journeys.
  const vacatedTableIds = new Set(updatedCustomers
    .filter(customer => customer.state === 'leaving' || isCheckoutState(customer))
    .map(customer => customer.tableId)
    .filter(Boolean));
  let updatedTables = state.tables || [];
  if (vacatedTableIds.size > 0) {
    updatedTables = updatedTables.map(t =>
      vacatedTableIds.has(t.id) && !updatedCustomers.some(customer =>
        customer.tableId === t.id
          && customer.state !== 'leaving'
          && !isCheckoutState(customer))
        ? releaseTableReservation(t, 'dirty')
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
      const fallback = table && Number.isFinite(table.x) && Number.isFinite(table.y)
        ? { x: table.x + 20, y: table.y + 20 }
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

    if (!character.path?.length
      || !['checkout_moving', 'leaving', 'guided'].includes(character.state)) return [];
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

  const recoveredState = recoverStuckCustomers({ ...state, customers: updatedCustomers }, movementDt);
  updatedCustomers = recoveredState.customers;

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

  return { ...recoveredState, customers: updatedCustomers };
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
