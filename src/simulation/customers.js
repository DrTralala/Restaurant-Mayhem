import { getRushHourMultiplier, isRestaurantOpen } from './clock';
import { advanceCharacterMovementBatch, getCharacterMovementStatus } from './movement';
import {
  clearNavigationGoal,
  isAtNavigationGoal,
  sameNavigationGoal,
  setNavigationGoal,
} from './movement/navigationGoal';
import {
  getDoorPosition,
  getDoors,
  getDoorsForFlow,
  isDoorRoleForFlow,
  isDoorCrossing,
  getRestaurantWorld,
} from './world';
import { createGrid } from './navigation/grid';
import { createActorGrid } from './navigation/domainGrid';
import { findRoute } from './navigation/router';
import { isCheckoutState, prepareCheckoutCustomers } from './checkout';
import { releaseVacatedTables } from './tableLifecycle';
import {
  QUEUE_PARTY_CAPACITY,
  getQueueFreeBandSlots,
  getQueueVisibleMembers,
  hasRuntimeLeaseConflict,
  normaliseCustomerQueue,
  reconcileQueueSlots,
} from './customerQueue';
import {
  ABANDONMENT_REPUTATION_PENALTY,
  clampReputation,
  getBaseArrivalRate,
  getCustomerPatience,
  getQueuePatienceMultiplier,
  getUpgradeEffect,
} from './balance';
import { createSpendingProfile } from './menuEconomy';
import { cancelPendingPartyReviews } from './partyReviews';

let customerIdCounter = 0;
let partyIdCounter = 0;

export function getExitHeading(customerId) {
  const hash = String(customerId).split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const angleDegrees = [-35, 0, 35][hash % 3];
  const radians = angleDegrees * Math.PI / 180;
  return { angleDegrees, x: Math.cos(radians), y: Math.sin(radians) };
}

const EXIT_QUEUE_CLEARANCE = 16;
const EXIT_GEOMETRY_EPSILON = 1e-9;
const EXIT_DISTANCE = 120;
const EXIT_OPENING_HEIGHT = 40;
const EXIT_REACHABILITY_EXPANSIONS = 2048;
const EXIT_REACHABILITY_CACHE_LIMIT = 1024;
const EXIT_FLOW_GRID_CACHE_LIMIT = 32;
const exitReachabilityCache = new Map();
const exitFlowGridCache = new Map();

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function getHeadingForAngle(angleDegrees) {
  const radians = angleDegrees * Math.PI / 180;
  return { angleDegrees, x: Math.cos(radians), y: Math.sin(radians) };
}

function minimumPointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const divisor = dx * dx + dy * dy;
  const ratio = divisor === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / divisor));
  return Math.hypot(
    point.x - (start.x + dx * ratio),
    point.y - (start.y + dy * ratio),
  );
}

function isQueueClear(start, end, projectedMembers) {
  return projectedMembers.every(member =>
    minimumPointToSegmentDistance(member, start, end)
      >= EXIT_QUEUE_CLEARANCE - EXIT_GEOMETRY_EPSILON);
}

function longestQueueSafePrefix(start, heading, maximumDistance, projectedMembers) {
  let prefix = maximumDistance;
  for (const member of projectedMembers) {
    const offsetX = member.x - start.x;
    const offsetY = member.y - start.y;
    const distanceSquared = offsetX * offsetX + offsetY * offsetY;
    if (distanceSquared < EXIT_QUEUE_CLEARANCE ** 2 - EXIT_GEOMETRY_EPSILON) return 0;

    const along = offsetX * heading.x + offsetY * heading.y;
    if (along <= EXIT_GEOMETRY_EPSILON) continue;
    const perpendicularSquared = Math.max(0, distanceSquared - along * along);
    if (perpendicularSquared >= EXIT_QUEUE_CLEARANCE ** 2 - EXIT_GEOMETRY_EPSILON) continue;

    const entryDistance = along - Math.sqrt(
      Math.max(0, EXIT_QUEUE_CLEARANCE ** 2 - perpendicularSquared),
    );
    if (entryDistance <= EXIT_GEOMETRY_EPSILON) return 0;
    prefix = Math.min(prefix, entryDistance);
  }
  return Math.max(0, prefix);
}

function getQueueSafeExitChoice(state, customer, additionalMembers = [], includePhysicalActors = false) {
  if (!isFinitePoint(customer)) return null;

  const projectedMembers = [
    ...(includePhysicalActors ? getExitPhysicalActors(state, customer) : []),
    ...getQueueVisibleMembers(state, state.queue),
    ...additionalMembers,
  ].filter(isFinitePoint);
  const stableHeading = getExitHeading(customer.id);
  const preferredSign = stableHeading.angleDegrees > 0 ? 1 : -1;
  const angleCandidates = [
    0,
    35 * preferredSign,
    -35 * preferredSign,
    60 * preferredSign,
    -60 * preferredSign,
  ];

  for (const angleDegrees of angleCandidates) {
    const heading = angleDegrees === stableHeading.angleDegrees
      ? stableHeading
      : getHeadingForAngle(angleDegrees);
    const target = {
      x: customer.x + heading.x * EXIT_DISTANCE,
      y: customer.y + heading.y * EXIT_DISTANCE,
    };
    if (isQueueClear(customer, target, projectedMembers)) {
      return { heading, target, distance: EXIT_DISTANCE };
    }
  }

  let longestPrefix = { heading: null, distance: -Infinity };
  for (const angleDegrees of angleCandidates) {
    const heading = angleDegrees === stableHeading.angleDegrees
      ? stableHeading
      : getHeadingForAngle(angleDegrees);
    const prefix = longestQueueSafePrefix(
      customer,
      heading,
      EXIT_DISTANCE,
      projectedMembers,
    );
    if (prefix > longestPrefix.distance + EXIT_GEOMETRY_EPSILON) {
      longestPrefix = { heading, distance: prefix };
    }
  }

  const heading = longestPrefix.heading || getHeadingForAngle(angleCandidates[0]);
  const distance = Math.max(0, longestPrefix.distance);
  return {
    heading,
    target: {
      x: customer.x + heading.x * EXIT_DISTANCE,
      y: customer.y + heading.y * EXIT_DISTANCE,
    },
    distance,
  };
}

export function getQueueSafeExitGoal(state, customer) {
  return getQueueSafeExitChoice(state, customer)?.target || null;
}

function leavingFields(customer, overrides = {}) {
  const { entryDoorId: _entryDoorId, ...withoutEntryDoor } =
    clearNavigationGoal(customer);
  return {
    ...withoutEntryDoor,
    state: 'leaving',
    exitPhase: 'to_door',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: null,
    cashierStationId: null,
    checkoutPosition: null,
    checkoutQueueIndex: null,
    checkoutDeparture: null,
    checkoutLineMember: false,
    checkoutLineGeometry: null,
    paymentReady: false,
    ...overrides,
  };
}

function numericIdSuffix(id, prefix) {
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(String(id));
  return match ? Number(match[1]) : 0;
}

function nextUnusedId(prefix, ids, counter) {
  const usedIds = new Set(ids.filter(id => id != null).map(String));
  let nextCounter = Math.max(
    counter,
    ...[...usedIds].map(id => numericIdSuffix(id, prefix)),
  );
  let id;
  do {
    id = `${prefix}${++nextCounter}`;
  } while (usedIds.has(id));
  return { id, counter: nextCounter };
}

function getCustomerIdentityIds(state, queue) {
  return [
    ...(state.customers || []).map(customer => customer?.id),
    ...queue.flatMap(party => party.members.map(customer => customer?.id)),
    ...(state.queueDepartures || []).map(record => record?.id),
    ...(state.completedCustomers || []).map(payment => payment?.customerId),
    ...(state.pendingPartyReviews || []).flatMap(record => [
      ...(record?.memberIds || []),
      ...(record?.paidReviews || []).map(payment => payment?.customerId),
    ]),
    ...(state.serviceItems || []).map(item => item?.customerId),
  ];
}

function getPartyIdentityIds(state, queue) {
  return [
    ...(state.customers || []).map(customer => customer?.partyId),
    ...queue.flatMap(party => [
      party?.partyId,
      ...party.members.map(customer => customer?.partyId),
    ]),
    ...(state.queueDepartures || []).map(record => record?.partyId),
    ...(state.pendingPartyReviews || []).map(record => record?.partyId),
    ...(state.partyReviewHistory || []).map(record => record?.partyId),
  ];
}

const ARCHETYPES = ['regular', 'regular', 'regular', 'foodie', 'rusher', 'influencer'];

function partyKey(customer) {
  return customer.partyId ?? customer.id;
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
  const nextParty = nextUnusedId('p', getPartyIdentityIds(state, queue), partyIdCounter);
  partyIdCounter = nextParty.counter;
  const partyId = nextParty.id;
  const usedCustomerIds = getCustomerIdentityIds(state, queue);
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  const newCustomers = Array.from({ length: party.size }, () => {
    const nextCustomer = nextUnusedId('c', usedCustomerIds, customerIdCounter);
    customerIdCounter = nextCustomer.counter;
    usedCustomerIds.push(nextCustomer.id);
    const patienceMax = getCustomerPatience(archetype, party.size);
    const gender = Math.random() < 0.5 ? 'male' : 'female';
    const spendingProfile = createSpendingProfile(state.restaurant.reputation);
    return {
      id: nextCustomer.id,
      partyId,
      partyType: party.type,
      partySize: party.size,
      archetype,
      gender,
      ...spendingProfile,
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
  const movedFor = id => moved.get(id) || moved.get(String(id));
  return {
    ...state,
    [key]: (state[key] || []).map(character => {
      if (committedIds && !committedIds.has(character.id)) return character;
      return movedFor(character.id) || character;
    }),
  };
}

function getExitDestination(state, customer) {
  const door = getDoors(state).find(candidate => candidate.id === customer.exitDoorId);
  const position = door ? getDoorPosition(state, door) : null;
  if (!position) return null;
  const crossing = customer.exitCrossingPoint;
  const validCrossing = isFinitePoint(crossing)
    && Math.abs(crossing.x - position.outside.x) <= EXIT_GEOMETRY_EPSILON
    && crossing.y >= door.y - EXIT_GEOMETRY_EPSILON
    && crossing.y < door.y + EXIT_OPENING_HEIGHT - EXIT_GEOMETRY_EPSILON;
  return validCrossing
    ? { x: position.outside.x, y: crossing.y }
    : position.outside;
}

function isPastExitCrossing(state, customer, door) {
  const outside = getDoorPosition(state, door)?.outside;
  return Boolean(outside && isFinitePoint(customer)
    && customer.x >= outside.x - EXIT_GEOMETRY_EPSILON
    && customer.y >= door.y - EXIT_GEOMETRY_EPSILON
    && customer.y < door.y + EXIT_OPENING_HEIGHT - EXIT_GEOMETRY_EPSILON);
}

function samePoint(left, right) {
  return isFinitePoint(left) && isFinitePoint(right)
    && left.x === right.x && left.y === right.y;
}

function clearExitCrossingPoint(customer) {
  if (!Object.hasOwn(customer, 'exitCrossingPoint') && !Object.hasOwn(customer, 'exitFadeOrigin')) return customer;
  const { exitCrossingPoint: _exitCrossingPoint, exitFadeOrigin: _exitFadeOrigin, ...cleared } = customer;
  return cleared;
}

function setExitCrossingPoint(customer, point) {
  return samePoint(customer.exitCrossingPoint, point)
    ? customer
    : { ...customer, exitCrossingPoint: { x: point.x, y: point.y } };
}

function getExitCrossingCandidates(state, door) {
  const position = getDoorPosition(state, door);
  if (!position || !Number.isFinite(door?.y)) return [];
  const world = getRestaurantWorld(state.restaurant || {});
  const centreY = position.outside.y;
  const yValues = new Set([centreY]);
  const firstLatticeY = Math.ceil((door.y - EXIT_GEOMETRY_EPSILON) / world.gridSize) * world.gridSize;
  for (let y = firstLatticeY; y < door.y + EXIT_OPENING_HEIGHT - EXIT_GEOMETRY_EPSILON; y += world.gridSize) {
    if (y >= door.y - EXIT_GEOMETRY_EPSILON) yValues.add(y);
  }
  return [...yValues]
    .filter(y => y >= door.y - EXIT_GEOMETRY_EPSILON
      && y < door.y + EXIT_OPENING_HEIGHT - EXIT_GEOMETRY_EPSILON)
    .map(y => ({ x: position.outside.x, y }))
    .sort((left, right) => Math.abs(left.y - centreY) - Math.abs(right.y - centreY) || left.y - right.y);
}

function getExitPhysicalActors(state, customer) {
  const id = String(customer.id);
  return [
    ...(state.staff || []),
    ...(state.customers || []),
    ...getQueueVisibleMembers(state, state.queue),
  ].filter(actor => String(actor.id ?? actor.memberId) !== id && isFinitePoint(actor));
}

function isExitCrossingPointSafe(state, customer, point) {
  return getExitPhysicalActors(state, customer).every(actor =>
    Math.hypot(point.x - actor.x, point.y - actor.y)
      >= EXIT_QUEUE_CLEARANCE - EXIT_GEOMETRY_EPSILON);
}

function setBoundedCache(cache, key, value, limit) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > limit) {
    cache.delete(cache.keys().next().value);
  }
}

function navigationTopologyKey(state) {
  const geometry = (items, keys) => (items || []).map(item => keys.map(key => item?.[key]));
  return JSON.stringify({
    expansionLevel: state.restaurant?.expansionLevel ?? 1,
    tables: geometry(state.tables, ['id', 'x', 'y']),
    chairs: geometry(state.chairs, ['id', 'tableId', 'x', 'y', 'rotation']),
    kitchenStations: geometry(state.kitchenStations, ['id', 'x', 'y']),
    serviceTables: geometry(state.serviceTables, ['id', 'x', 'y', 'rotation']),
    cashierStations: geometry(state.cashierStations, ['id', 'x', 'y', 'w', 'h']),
    washStations: geometry(state.washStations, ['id', 'x', 'y', 'w', 'h']),
    doors: getDoors(state).map(door => [door?.id, door?.y, door?.role]),
  });
}

function getExitFlowGrid(state, door) {
  if (!door) return null;
  const key = `${navigationTopologyKey(state)}:egress:${String(door.id)}:${door.role || ''}`;
  if (exitFlowGridCache.has(key)) return exitFlowGridCache.get(key);
  const grid = createGrid(state, null, { doorFlow: { direction: 'egress', doorId: door.id } });
  setBoundedCache(exitFlowGridCache, key, grid, EXIT_FLOW_GRID_CACHE_LIMIT);
  return grid;
}

function isReachableExitCrossingPoint(state, customer, door, point, flowGrid = null) {
  const flow = { direction: 'egress', doorId: door.id };
  const base = flowGrid || createGrid(state, null, { doorFlow: flow });
  const grid = createActorGrid(state, customer, base, flow);
  if (!grid.isOpen(point)) return false;
  // A legacy cleared-residency fixture can retain a blocked table cell while
  // the customer has already logically left its seat. Keep the old goal
  // assignment in that case; the coordinator still applies the authoritative
  // domain grid before any movement is committed.
  if (!grid.isOpen(customer)) return customer.seatResidency?.phase === 'clear';
  const key = JSON.stringify([grid.signature, door.y, customer.x, customer.y, point.x, point.y]);
  if (exitReachabilityCache.has(key)) return exitReachabilityCache.get(key);
  const result = findRoute(grid, customer, point, {
    maxExpansions: EXIT_REACHABILITY_EXPANSIONS,
  });
  if (result.status === 'found' || result.status === 'unreachable') {
    setBoundedCache(exitReachabilityCache, key, result.status === 'found', EXIT_REACHABILITY_CACHE_LIMIT);
  }
  return result.status === 'found';
}

function chooseExitCrossingPoint(state, customer, door, flowGrid = null) {
  const candidates = getExitCrossingCandidates(state, door);
  const previous = [customer.exitCrossingPoint, customer.navigationGoal]
    .find(point => candidates.some(candidate => samePoint(candidate, point)));
  const ordered = previous
    ? [previous, ...candidates.filter(candidate => !samePoint(candidate, previous))]
    : candidates;
  return ordered.find(point => isExitCrossingPointSafe(state, customer, point)
    && isReachableExitCrossingPoint(state, customer, door, point, flowGrid)) || null;
}

function assignExitCrossingPoint(state, customer, door, flowGrid = null) {
  const crossing = chooseExitCrossingPoint(state, customer, door, flowGrid);
  if (!crossing) return clearNavigationGoal(clearExitCrossingPoint(customer));
  return setNavigationGoal(setExitCrossingPoint(customer, crossing), crossing);
}

function nearestDoor(state, doors, customer, side) {
  return [...doors].sort((left, right) => {
    const leftPosition = getDoorPosition(state, left)?.[side];
    const rightPosition = getDoorPosition(state, right)?.[side];
    return Math.hypot(customer.x - leftPosition.x, customer.y - leftPosition.y)
      - Math.hypot(customer.x - rightPosition.x, customer.y - rightPosition.y)
      || String(left.id).localeCompare(String(right.id));
  })[0] || null;
}

function restoreEnteringNavigationGoal(state, customer) {
  if (isFinitePoint(customer.navigationGoal)) return customer;
  const table = (state.tables || []).find(candidate => candidate.id === customer.tableId);
  const assignment = table?.seatingAssignments?.find(candidate => candidate.customerId === customer.id);
  return assignment && isFinitePoint(assignment.approachPoint)
    ? setNavigationGoal(customer, assignment.approachPoint)
     : customer;
}

function isInsideRestaurant(state, customer) {
  const world = getRestaurantWorld(state.restaurant || {});
  return isFinitePoint(customer) && customer.x < world.doorX - 40;
}

function isOutdoorQueuePosition(state, customer) {
  const world = getRestaurantWorld(state.restaurant || {});
  return isFinitePoint(customer)
    && customer.x >= world.queueX
    && customer.y >= world.queueY
    && customer.y <= world.queueY + world.queueH;
}

function directOutdoorDeparture(state, customer, additionalMembers = []) {
  const world = getRestaurantWorld(state.restaurant || {});
  const currentGoal = customer.navigationGoal;
  const alreadyBeyondQueue = customer.x >= world.queueX + world.queueW - EXIT_GEOMETRY_EPSILON;
  const canContinueExistingTail = alreadyBeyondQueue
    && isFinitePoint(currentGoal)
    && isBoundedOutdoorTail(customer, currentGoal)
    && currentGoal.y >= world.queueY
    && currentGoal.y <= world.queueY + world.queueH
    && isQueueClear(customer, currentGoal, [
      ...getQueueVisibleMembers(state, state.queue),
      ...additionalMembers,
    ].filter(isFinitePoint));
  if (canContinueExistingTail) {
    const distance = Math.hypot(currentGoal.x - customer.x, currentGoal.y - customer.y);
    const heading = {
      angleDegrees: Math.atan2(currentGoal.y - customer.y, currentGoal.x - customer.x) * 180 / Math.PI,
      x: (currentGoal.x - customer.x) / distance,
      y: (currentGoal.y - customer.y) / distance,
    };
    return setNavigationGoal({
      ...customer,
      exitPhase: 'fading',
      exitDoorId: null,
      exitFadeProgress: 0,
      exitHeading: heading,
    }, currentGoal);
  }
  const choice = getQueueSafeExitChoice(state, customer, additionalMembers);
  if (!choice) return customer;
  const outwardTarget = alreadyBeyondQueue ? {
    x: customer.x + Math.max(0, choice.heading.x) * EXIT_DISTANCE,
    y: customer.y + choice.heading.y * EXIT_DISTANCE,
  } : choice.target;
  const boundaryDistance = alreadyBeyondQueue ? choice.distance : Math.min(
    choice.distance,
    choice.heading.x > EXIT_GEOMETRY_EPSILON
      ? (world.queueX + world.queueW - customer.x) / choice.heading.x
      : choice.heading.x < -EXIT_GEOMETRY_EPSILON
        ? (world.queueX - customer.x) / choice.heading.x
        : Infinity,
    choice.heading.y > EXIT_GEOMETRY_EPSILON
      ? (world.queueY + world.queueH - customer.y) / choice.heading.y
      : choice.heading.y < -EXIT_GEOMETRY_EPSILON
        ? (world.queueY - customer.y) / choice.heading.y
        : Infinity,
  );
  if (boundaryDistance <= EXIT_GEOMETRY_EPSILON) {
    return clearNavigationGoal({
      ...customer,
      exitPhase: 'fading',
      exitDoorId: null,
      exitFadeProgress: 0,
      exitHeading: choice.heading,
    });
  }
  const boundedTarget = alreadyBeyondQueue ? outwardTarget : {
    x: customer.x + choice.heading.x * boundaryDistance,
    y: customer.y + choice.heading.y * boundaryDistance,
  };
  const target = {
    x: alreadyBeyondQueue
      ? boundedTarget.x
      : Math.min(world.queueX + world.queueW, Math.max(world.queueX, boundedTarget.x)),
    y: Math.min(world.queueY + world.queueH, Math.max(world.queueY, boundedTarget.y)),
  };
  return setNavigationGoal({
    ...customer,
    exitPhase: 'fading',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: choice.heading,
  }, target);
}

function isOutdoorGoal(state, customer, goal) {
  const world = getRestaurantWorld(state.restaurant || {});
  return isBoundedOutdoorTail(customer, goal)
    && goal.x >= world.queueX
    && goal.y >= world.queueY
    && goal.y <= world.queueY + world.queueH
    && ((customer.x < world.queueX + world.queueW - EXIT_GEOMETRY_EPSILON
      && goal.x <= world.queueX + world.queueW)
      || (customer.x >= world.queueX + world.queueW - EXIT_GEOMETRY_EPSILON
        && goal.x > customer.x));
}

function isBoundedOutdoorTail(customer, goal) {
  if (!isFinitePoint(customer) || !isFinitePoint(goal) || goal.x <= customer.x) return false;
  const distance = Math.hypot(goal.x - customer.x, goal.y - customer.y);
  return Number.isFinite(distance) && distance <= EXIT_DISTANCE + EXIT_GEOMETRY_EPSILON;
}

function isValidDoorFadeRoute(state, customer) {
  const goal = customer.navigationGoal;
  const savedOrigin = customer.exitFadeOrigin || customer.exitCrossingPoint;
  const savedRoute = isFinitePoint(savedOrigin) && isFinitePoint(customer)
    && isFinitePoint(goal)
    && goal.x > savedOrigin.x
    && Math.abs(Math.hypot(goal.x - savedOrigin.x, goal.y - savedOrigin.y) - EXIT_DISTANCE)
      <= EXIT_GEOMETRY_EPSILON;
  const origin = savedRoute ? savedOrigin : getExitDestination(state, customer);
  if (!origin || !isFinitePoint(customer) || !isFinitePoint(goal)) return false;
  const dx = goal.x - origin.x;
  const dy = goal.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (goal.x <= origin.x || Math.abs(length - EXIT_DISTANCE) > EXIT_GEOMETRY_EPSILON) return false;
  const along = (customer.x - origin.x) * dx + (customer.y - origin.y) * dy;
  const cross = (customer.x - origin.x) * dy - (customer.y - origin.y) * dx;
  return along >= -EXIT_GEOMETRY_EPSILON
    && along <= length * length + EXIT_GEOMETRY_EPSILON
    && Math.abs(cross) <= EXIT_GEOMETRY_EPSILON;
}

function isExitFadePathClear(state, customer) {
  return isFinitePoint(customer.navigationGoal)
    && isQueueClear(customer, customer.navigationGoal, getExitPhysicalActors(state, customer));
}

function isDirectOutdoorFade(state, customer) {
  return customer.state === 'leaving'
    && customer.exitPhase === 'fading'
    && (customer.exitDoorId == null
      || (isOutdoorQueuePosition(state, customer) && !isValidDoorFadeRoute(state, customer)));
}

function planDirectOutdoorDepartures(state, customers) {
  const candidates = customers
    .filter(customer => isDirectOutdoorFade(state, customer) && isFinitePoint(customer))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const assignments = new Map();
  for (const customer of candidates) {
    const otherCustomers = candidates
      .filter(other => String(other.id) !== String(customer.id))
      .flatMap(other => [
        ...(isFinitePoint(other) ? [other] : []),
        ...(isFinitePoint(other.navigationGoal) ? [other.navigationGoal] : []),
      ]);
    const assignedGoals = [...assignments.values()]
      .filter(assigned => isFinitePoint(assigned.navigationGoal))
      .map(assigned => assigned.navigationGoal);
    const blockers = [...otherCustomers, ...assignedGoals];
    const goalIsSafe = isOutdoorGoal(state, customer, customer.navigationGoal)
      && isQueueClear(customer, customer.navigationGoal, [
        ...getQueueVisibleMembers(state, state.queue),
        ...blockers,
      ].filter(isFinitePoint));
    assignments.set(String(customer.id), goalIsSafe
      ? customer.exitDoorId == null ? customer : directOutdoorDeparture(state, customer, blockers)
      : directOutdoorDeparture(state, customer, blockers));
  }
  return assignments;
}

// Admit the oldest staged pending-departure records (hidden overflow members
// whose party abandoned or the restaurant closed) to legally vacant visible
// queue-band slots, as leaving customers. The pending records were converted
// before any lease existed, so each materialised member is granted a new exact
// departure lease at the candidate point it starts from; the lease is retained
// (blocking regrants of that origin) until the live leaver is at least 16 px
// clear. A slot is free only when no valid lease origin (standing or retained
// departure), staff actor, customer actor or earlier grant in the same pass is
// within 16 px of it. Records that cannot materialise yet stay ordered for a
// later tick; a pending record and its lease never coexist.
function materialiseQueueDepartures(state, queue, queueSlots) {
  const pending = state.queueDepartures || [];
  const customers = [...(state.customers || [])];
  if (pending.length === 0) return { customers, queueDepartures: [], queueSlots };
  // While the retained runtime origins are already unsafe no new physical claim
  // is staged: compensating materialisation is blocked alongside new grants.
  if (hasRuntimeLeaseConflict(state, queueSlots)) {
    return { customers, queueDepartures: pending, queueSlots };
  }
  const working = [...queueSlots];
  const remaining = [];
  for (const record of pending) {
    const freeSlots = getQueueFreeBandSlots(state, working);
    if (freeSlots.length === 0) {
      remaining.push(record);
      continue;
    }
    const slot = freeSlots[0];
    const { departureReason, closedAt, ...member } = record;
    const overrides = departureReason === 'closed'
      ? { tableId: null, reputationApplied: true, closedAt }
      : {
          patience: Math.max(0, member.patience ?? 0),
          happiness: Math.max(0, (member.happiness ?? 0) - 30),
          tableId: null,
          reputationApplied: true,
        };
    customers.push(leavingFields({ ...member, x: slot.x, y: slot.y }, overrides));
    const lease = {
      memberId: record.id,
      partyId: record.partyId,
      x: slot.x,
      y: slot.y,
      slot: slot.slot,
    };
    working.push(lease);
  }
  return { customers, queueDepartures: remaining, queueSlots: working };
}

export function prepareCustomersForMovement(state, gameDt) {
  const customers = state.customers || [];
  const queue = normaliseCustomerQueue(state.queue || []);
  const restaurantOpen = isRestaurantOpen(state);

  // 1. Reconcile exact queue-slot ownership: validate the seed records, retain
  //    standing and uncleared departure leases, release only cleared/orphaned
  //    records, then grant unleased queue members in logical FIFO order at any
  //    current candidate that is physically free (any-free rule). A layout
  //    change never rewrites a retained x/y. Queued claims precede the staged
  //    departure pipeline.
  const reconciledSlots = reconcileQueueSlots(state, state.queueSlots || []);

  // 2. Staged materialisation of hidden pending-departure records into the
  //    slots still free after the queue claims, oldest pending first. Each
  //    materialised leaver obtains a retained exact departure lease.
  const materialised = materialiseQueueDepartures(state, queue, reconciledSlots);
  const queueSlots = materialised.queueSlots;
  let queueDepartures = materialised.queueDepartures;
  const customersWithStaged = materialised.customers;

  // 3. Conversions use the canonical exact leases: abandoning/closing leased
  //    members convert at their stored exact points and keep their lease
  //    records as departure ownership; unleased members become ordered pending
  //    departure records.
  const queuePositions = new Map(getQueueVisibleMembers({ ...state, queueSlots }, queue)
    .map(customer => [customer.id, { x: customer.x, y: customer.y }]));

  // Only physically present (visible) queue members convert to leaving at their
  // distinct slots now; hidden overflow members are retained as ordered
  // pending-departure records below instead of being dissolved.
  let closedQueue = [];
  if (!restaurantOpen) {
    closedQueue = [];
    for (const party of queue) {
      for (const customer of party.members) {
        if (queuePositions.has(customer.id)) {
          closedQueue.push(leavingFields({
            ...customer,
            ...queuePositions.get(customer.id),
          }, {
            tableId: null,
            reputationApplied: true,
            closedAt: state.restaurant.gameTime,
          }));
        } else {
          queueDepartures.push({
            ...customer,
            departureReason: 'closed',
            closedAt: state.restaurant.gameTime,
          });
        }
      }
    }
  }
  let abandonmentCount = 0;
  let updatedCustomers = [...customersWithStaged, ...closedQueue].map(c => {
    let newState = c.state;
    if (c.state === 'arriving') {
      newState = 'waiting';
    }

    const canMove = ['checkout_moving', 'leaving', 'entering'].includes(newState);
    return {
      ...(canMove ? c : clearNavigationGoal(c)),
      state: newState,
    };
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

  const abandoningParties = new Set(updatedQueue
    .filter(party => party.members.some(customer => customer.queuePatience <= 0))
    .map(party => party.partyId));

  if (abandoningParties.size > 0) {
    const allPartyMembers = [...updatedCustomers, ...updatedQueue.flatMap(party => party.members)];
    // Accounting is applied once, at the decision tick, per abandoning party.
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

    const abandoningQueue = [];
    updatedQueue = updatedQueue.filter(party => {
      if (!abandoningParties.has(party.partyId)) return true;
      for (const customer of party.members) {
        if (queuePositions.has(customer.id)) {
          abandoningQueue.push(leavingFields({
            ...customer,
            ...queuePositions.get(customer.id),
          }, {
            patience: Math.max(0, customer.patience),
            happiness: Math.max(0, customer.happiness - 30),
            tableId: null,
            reputationApplied: true,
          }));
        } else {
          queueDepartures.push({ ...customer, departureReason: 'abandoned' });
        }
      }
      return false;
    });
    updatedCustomers = [...updatedCustomers, ...abandoningQueue];
  }

  updatedCustomers = prepareCheckoutCustomers(
    { ...state, customers: updatedCustomers },
    updatedCustomers,
  );

  const departureState = { ...state, queue: updatedQueue, queueSlots };
  const directOutdoorDepartures = planDirectOutdoorDepartures(departureState, updatedCustomers);

  const doors = getDoors(state);
  const entranceDoors = getDoorsForFlow(state, 'ingress');
  const exitDoors = getDoorsForFlow(state, 'egress');

  updatedCustomers = updatedCustomers.map(customer => {
    if (customer.state !== 'entering') return customer;
    const door = doors.find(candidate => candidate.id === customer.entryDoorId);
    if (door && (isDoorRoleForFlow(door, 'ingress') || isDoorCrossing(state, customer, door))) {
      return customer;
    }
    const replacement = nearestDoor(state, entranceDoors, customer, 'outside');
    if (!replacement) {
      // Once an entrant is beyond the doorway, its chair route no longer
      // requires an entrance. Keep the interior goal while the role warning is
      // shown; only an outside entrant must wait for an entrance to return.
      return isInsideRestaurant(state, customer)
        ? restoreEnteringNavigationGoal(state, { ...customer, entryDoorId: null })
        : { ...clearNavigationGoal(customer), entryDoorId: null };
    }
    return restoreEnteringNavigationGoal(state, { ...customer, entryDoorId: replacement.id });
  });

  const claimedDoors = new Map();
  for (const customer of updatedCustomers) {
    if (customer.state === 'leaving' && customer.exitPhase !== 'fading' && customer.exitDoorId) {
      claimedDoors.set(customer.exitDoorId, (claimedDoors.get(customer.exitDoorId) || 0) + 1);
    }
  }

  updatedCustomers = updatedCustomers.map(customer => {
    if (customer.state !== 'leaving') return customer;
    let leaving = customer;
    if (!Number.isFinite(leaving.x) || !Number.isFinite(leaving.y)) {
      const table = (state.tables || []).find(candidate => candidate.id === leaving.tableId);
      const fallback = table && Number.isFinite(table.x) && Number.isFinite(table.y)
        ? { x: table.x + 20, y: table.y + 20 }
        : getDoorPosition(state, getDoors(state)[0])?.inside;
      if (!fallback) return leaving;
      leaving = { ...leaving, ...fallback };
    }
    if (leaving.exitPhase === 'fading') {
      const directDeparture = directOutdoorDepartures.get(String(leaving.id));
      if (directDeparture) return directDeparture;
      if (leaving.exitDoorId == null) {
        return directOutdoorDeparture(departureState, leaving);
      }
    }
    // Queue departures fade from their own standing positions, not from the
    // restaurant exit. Indoor departures keep their assigned doorway route.
    if (leaving.exitDoorId == null && isOutdoorQueuePosition(state, leaving)) {
      return directOutdoorDeparture(departureState, leaving);
    }
    const currentDoor = doors.find(candidate => candidate.id === leaving.exitDoorId);
    const preservingCrossing = currentDoor
      && (leaving.exitPhase === 'fading' || isDoorCrossing(state, leaving, currentDoor));
    const currentDoorIsEligible = currentDoor && isDoorRoleForFlow(currentDoor, 'egress');
    if (leaving.exitPhase !== 'fading' && currentDoorIsEligible
      && isPastExitCrossing(state, leaving, currentDoor)) {
      return startCustomerFading(departureState, leaving);
    }
    if (!currentDoorIsEligible && !preservingCrossing) {
      const door = [...exitDoors].sort((a, b) => {
        const loadDifference = (claimedDoors.get(a.id) || 0) - (claimedDoors.get(b.id) || 0);
        return loadDifference || Math.abs(a.y - leaving.y) - Math.abs(b.y - leaving.y);
      })[0];
      if (!door) {
        return isOutdoorQueuePosition(state, leaving)
          ? directOutdoorDeparture(departureState, leaving)
          : { ...clearNavigationGoal(clearExitCrossingPoint(leaving)), exitDoorId: null };
      }
      claimedDoors.set(door.id, (claimedDoors.get(door.id) || 0) + 1);
      leaving = clearExitCrossingPoint({ ...leaving, exitDoorId: door.id });
    }
    const destination = getExitDestination(state, leaving);
    if (!destination) return leaving;
    if (leaving.exitPhase === 'fading') {
      if (!isFinitePoint(leaving.navigationGoal)) {
        const choice = getQueueSafeExitChoice(state, leaving, [], true);
        if (!choice) return leaving;
        leaving = { ...leaving, exitHeading: choice.heading };
        return setNavigationGoal(leaving, choice.target);
      }
      if (!isExitFadePathClear(departureState, leaving)) {
        const choice = getQueueSafeExitChoice(departureState, leaving, [], true);
        if (choice && !samePoint(choice.target, leaving.navigationGoal)) {
          return setNavigationGoal({
            ...leaving,
            exitFadeProgress: 0,
            exitHeading: choice.heading,
            exitFadeOrigin: { x: leaving.x, y: leaving.y },
          }, choice.target);
        }
      }
      return leaving;
    }
    const routeDoor = doors.find(candidate => candidate.id === leaving.exitDoorId);
    if (preservingCrossing) {
      const inFlightPoint = getExitCrossingCandidates(state, routeDoor)
        .find(candidate => samePoint(candidate, leaving.navigationGoal)) || destination;
      return isFinitePoint(inFlightPoint)
        ? setNavigationGoal(setExitCrossingPoint(leaving, inFlightPoint), inFlightPoint)
        : leaving;
    }
    return assignExitCrossingPoint(
      { ...departureState, customers: updatedCustomers },
      leaving,
      routeDoor,
      getExitFlowGrid(state, routeDoor),
    );
  });

  const doorAdmissions = updateDoorAdmissions(state.doorAdmissions, updatedCustomers);

  return {
    ...state,
    ...(doorAdmissions ? { doorAdmissions } : {}),
    restaurant: abandonmentCount > 0
      ? {
          ...state.restaurant,
          reputation: clampReputation(state.restaurant.reputation
            - abandonmentCount * ABANDONMENT_REPUTATION_PENALTY),
        }
      : state.restaurant,
    customers: updatedCustomers,
    queue: updatedQueue,
    queueDepartures,
    queueSlots,
    tables: state.tables || [],
    pendingPartyReviews: abandoningParties.size > 0
      ? cancelPendingPartyReviews(state.pendingPartyReviews, abandoningParties)
      : state.pendingPartyReviews,
  };
}

function getCheckoutQueueRank(state, customer) {
  if (Number.isInteger(customer.checkoutQueueIndex) && customer.checkoutQueueIndex >= 0) {
    return customer.checkoutQueueIndex;
  }
  const station = (state.cashierStations || [])
    .find(candidate => candidate.id === customer.cashierStationId);
  const position = customer.checkoutPosition;
  if (!station || !isFinitePoint(position)) return null;
  const rank = (position.y - station.y - station.h - 20) / 20;
  return Number.isInteger(rank) && rank >= 0 ? rank : null;
}

function getCheckoutAdvance(state, customer) {
  if (customer.state !== 'checkout_moving' || customer.cashierStationId == null
    || customer.checkoutLineMember !== true
    || !isFinitePoint(customer.checkoutPosition) || !Number.isInteger(getCheckoutQueueRank(state, customer))) {
    return null;
  }
  // Once a diner has arrived at its assigned queue slot, advancement is
  // constrained to the line's forward segment. Customers approaching their
  // first queue slot from a table retain ordinary pathfinding until arrival.
  if (Math.abs(customer.x - customer.checkoutPosition.x) > 1e-6
    || customer.y < customer.checkoutPosition.y - 1e-6) return null;
  return {
    stationId: customer.cashierStationId,
    queueRank: getCheckoutQueueRank(state, customer),
    goal: { x: customer.checkoutPosition.x, y: customer.checkoutPosition.y },
  };
}

function activeDoorApproachCustomers(customers) {
  return (customers || [])
    .filter(customer => customer?.id != null && isFinitePoint(customer)
      && customer.state === 'leaving' && customer.exitPhase !== 'fading'
      && customer.exitDoorId != null)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function updateDoorAdmissions(previous, customers) {
  const active = activeDoorApproachCustomers(customers);
  if (!previous && active.length === 0) return null;

  const previousRequests = previous?.requests && typeof previous.requests === 'object'
    ? previous.requests
    : {};
  let nextSequence = Number.isInteger(previous?.nextSequence) && previous.nextSequence > 0
    ? previous.nextSequence
    : 1;
  const requests = {};

  for (const customer of active) {
    const id = String(customer.id);
    const doorId = String(customer.exitDoorId);
    const prior = previousRequests[id];
    if (prior && String(prior.doorId) === doorId && Number.isInteger(prior.sequence)) {
      requests[id] = { doorId, sequence: prior.sequence };
      continue;
    }
    requests[id] = { doorId, sequence: nextSequence };
    nextSequence += 1;
  }

  return { nextSequence, requests };
}

function descriptorForCustomer(state, character) {
  const movingState = character.state === 'checkout_moving'
    || character.state === 'leaving'
    || character.state === 'entering';
  const descriptorCharacter = movingState
    ? character
    : clearNavigationGoal(character);
  const hasGoal = isFinitePoint(descriptorCharacter.navigationGoal);
  const doorId = character.exitDoorId ?? character.entryDoorId ?? null;
  const isLeaving = character.state === 'leaving';
  const isFading = isLeaving && character.exitPhase === 'fading';
  const isToDoor = isLeaving && !isFading;
  const isCheckout = character.state === 'checkout_moving';
  const isEntering = character.state === 'entering';
  const checkoutAdvance = getCheckoutAdvance(state, character);
  const speed = !hasGoal ? 0
    : isFading ? 30
      : isToDoor ? 55
        : isCheckout || isEntering ? 62
          : 0;
  const direction = isLeaving ? 'egress' : isEntering ? 'ingress' : 'none';
  const descriptor = {
    character: descriptorCharacter,
    speed,
    ignoredIds: [],
    doorFlow: { doorId: direction === 'none' ? null : doorId, direction },
    queueRank: isCheckout ? getCheckoutQueueRank(state, character) : null,
    ...(checkoutAdvance ? { checkoutAdvance } : {}),
    ...(isToDoor ? { doorApproach: true } : {}),
    terminalPolicy: isFading ? 'release' : 'hold',
    provenance: 'customer',
  };
  return descriptor;
}

export function getCustomerMovementEntries(state, _movementDt) {
  const active = (state.customers || [])
    .filter(character => character?.id != null && isFinitePoint(character))
    .map(character => descriptorForCustomer(state, character));
  const queue = getQueueVisibleMembers(state, state.queue)
    .filter(member => member?.id != null && isFinitePoint(member))
    .map(character => ({
      character: clearNavigationGoal(character),
      speed: 0,
      ignoredIds: [],
      doorFlow: { doorId: null, direction: 'none' },
      queueRank: null,
      terminalPolicy: 'hold',
      provenance: 'queue',
    }));
  return [...active, ...queue];
}

function suppliedMovementStatus(state, statuses, id) {
  if (statuses instanceof Map) {
    return statuses.get(id) ?? statuses.get(String(id)) ?? getCharacterMovementStatus(state, id);
  }
  return getCharacterMovementStatus(state, id);
}

function getCustomerBatchEntries(state, movementDt) {
  const entriesById = new Map();
  const add = entry => {
    if (entry?.character?.id == null) return;
    const id = String(entry.character.id);
    const existing = entriesById.get(id);
    if (!existing
      || (Number(entry.speed) > 0 && !(Number(existing.speed) > 0))) {
      entriesById.set(id, entry);
    }
  };
  for (const entry of getCustomerMovementEntries(state, movementDt)) add(entry);
  for (const character of state.staff || []) {
    if (character?.id == null || !isFinitePoint(character)) continue;
    add({
      character,
      speed: 0,
      ignoredIds: [],
      doorFlow: { doorId: null, direction: 'none' },
      queueRank: null,
      terminalPolicy: 'hold',
    });
  }
  return [...entriesById.values()];
}

function startCustomerFading(state, customer) {
  const destination = getExitDestination(state, customer);
  const door = getDoors(state).find(candidate => candidate.id === customer.exitDoorId);
  const crossing = customer.exitDoorId != null && isFinitePoint(destination)
    ? isPastExitCrossing(state, customer, door)
      ? { x: customer.x, y: customer.y }
      : { x: destination.x, y: destination.y }
    : null;
  const withCrossing = crossing ? setExitCrossingPoint(customer, crossing) : customer;
  const choice = getQueueSafeExitChoice(state, withCrossing, [], true);
  if (!choice) return customer;
  const fading = {
    ...withCrossing,
    exitPhase: 'fading',
    exitFadeProgress: 0,
    exitHeading: choice.heading,
    ...(isFinitePoint(withCrossing) ? { exitFadeOrigin: { x: withCrossing.x, y: withCrossing.y } } : {}),
  };
  return setNavigationGoal(fading, choice.target);
}

function clampFadeProgress(distance) {
  return Math.min(1, Math.max(0, 1 - distance / EXIT_DISTANCE));
}

export function resolveCustomersAfterMovement(state, _movementDt, statuses = new Map()) {
  let updatedCustomers = (state.customers || []).map(customer => {
    if (customer.state !== 'leaving' || customer.exitPhase === 'fading') return customer;
    const destination = getExitDestination(state, customer);
    const status = suppliedMovementStatus(state, statuses, customer.id);
    if (!destination || !sameNavigationGoal(customer.navigationGoal, destination)
      || !isAtNavigationGoal(customer) || status.plan !== 'arrived') return customer;
    return startCustomerFading(state, customer);
  });

  updatedCustomers = updatedCustomers.map(customer => {
    if (customer.state !== 'leaving' || customer.exitPhase !== 'fading') return customer;
    if (!isFinitePoint(customer.navigationGoal)) return customer;
    const distance = isFinitePoint(customer)
      ? Math.hypot(customer.x - customer.navigationGoal.x, customer.y - customer.navigationGoal.y)
      : Infinity;
    const status = suppliedMovementStatus(state, statuses, customer.id);
    const arrived = status.plan === 'arrived' && isAtNavigationGoal(customer);
    return {
      ...customer,
      exitFadeProgress: arrived ? 1 : clampFadeProgress(distance),
    };
  });

  updatedCustomers = updatedCustomers.filter(customer => {
    if (customer.state !== 'leaving' || customer.exitPhase !== 'fading') return true;
    if (!isFinitePoint(customer.navigationGoal)) return true;
    const status = suppliedMovementStatus(state, statuses, customer.id);
    return !(status.plan === 'arrived' && isAtNavigationGoal(customer));
  });

  return releaseVacatedTables({ ...state, customers: updatedCustomers });
}

export function updateCustomers(state, timing) {
  const gameDt = normaliseGameDt(timing);
  const movementDt = normaliseMovementDt(timing);
  const prepared = prepareCustomersForMovement(state, gameDt);
  const entries = getCustomerBatchEntries(prepared, movementDt);
  const result = advanceCharacterMovementBatch(prepared, entries, movementDt);
  const finiteCustomerIds = new Set((prepared.customers || [])
    .filter(customer => customer?.id != null && isFinitePoint(customer))
    .map(customer => customer.id));
  const committed = {
    ...replaceCharacters(prepared, result.moved, 'customers', finiteCustomerIds),
    movementCoordinator: result.coordinator,
  };
  return resolveCustomersAfterMovement(committed, movementDt, result.statuses);
}
