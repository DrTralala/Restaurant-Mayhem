import {
  buildBlockedCells,
  cellToWorld,
  isInsideWorld,
  worldToCell,
} from './pathfinding';
import { getQueueProjectedMembers } from './customerQueue';
import { planCharacterPath } from './movement';
import { GRID_SIZE } from './world';

export const RECOVERY_SEARCH_LIMITS = Object.freeze({
  globalPathSearchEquivalents: 16,
  globalPairCandidateChecks: 2048,
  perSearchPathSearchEquivalents: 8,
  perSearchPairCandidateChecks: 2048,
});

const RECOVERY_SPACING = 16;
const GEOMETRY_EPSILON = 1e-9;
const REACHABILITY_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function nonNegativeCount(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function requestedCount(value, fallback = 1) {
  return Number.isFinite(value) && value >= 0 && Number.isInteger(value)
    ? value
    : fallback;
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function isFiniteCell(cell) {
  return Number.isInteger(cell?.x) && Number.isInteger(cell?.y);
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function sameCell(left, right) {
  return left?.x === right?.x && left?.y === right?.y;
}

function normaliseSignatureNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function layoutRecord(item = {}) {
  return [
    String(item.id),
    normaliseSignatureNumber(item.x),
    normaliseSignatureNumber(item.y),
    normaliseSignatureNumber(item.w ?? null),
    normaliseSignatureNumber(item.h ?? null),
    normaliseSignatureNumber(item.rotation ?? null),
  ];
}

function queueRecord(item = {}) {
  return [
    String(item.id),
    normaliseSignatureNumber(item.x),
    normaliseSignatureNumber(item.y),
  ];
}

function compareCanonicalRecords(left, right) {
  const leftSerialised = JSON.stringify(left);
  const rightSerialised = JSON.stringify(right);
  if (leftSerialised < rightSerialised) return -1;
  if (leftSerialised > rightSerialised) return 1;
  return 0;
}

function canonicalRecords(items, record) {
  return (Array.isArray(items) ? items : [])
    .map(item => record(item || {}))
    .sort(compareCanonicalRecords);
}

export function getRecoveryLayoutSignature(state) {
  const rawExpansionLevel = state?.restaurant?.expansionLevel || 1;
  return JSON.stringify({
    expansionLevel: Number.isFinite(rawExpansionLevel) ? rawExpansionLevel : 1,
    doors: canonicalRecords(state?.doors, layoutRecord),
    tables: canonicalRecords(state?.tables, layoutRecord),
    chairs: canonicalRecords(state?.chairs, layoutRecord),
    kitchenStations: canonicalRecords(state?.kitchenStations, layoutRecord),
    serviceTables: canonicalRecords(state?.serviceTables, layoutRecord),
    cashierStations: canonicalRecords(state?.cashierStations, layoutRecord),
    washStations: canonicalRecords(state?.washStations, layoutRecord),
  });
}

export function getRecoveryQueueSignature(queueActors) {
  return JSON.stringify(canonicalRecords(queueActors, queueRecord));
}

function getRecoveryQueueActors(state) {
  return getQueueProjectedMembers(state || {}, state?.queue || []).filter(isFinitePoint);
}

function getBlockerCustomer(blocker) {
  if (blocker?.kind === 'customer') return blocker.customer;
  return blocker?.kind == null && blocker?.id != null ? blocker : null;
}

function getBlockerKey(blocker) {
  const customer = getBlockerCustomer(blocker);
  return customer ? `customer:${customer.id}` : blocker?.key;
}

function cursorActor(customer, goal) {
  return {
    id: String(customer?.id),
    origin: { x: customer?.x, y: customer?.y },
    goalKey: goal?.key,
  };
}

function pairActors(initiator, initiatorGoal, blockerCustomer, blockerGoal) {
  return [
    { customer: initiator, goal: initiatorGoal },
    { customer: blockerCustomer, goal: blockerGoal },
  ].sort((left, right) => String(left.customer?.id).localeCompare(String(right.customer?.id)));
}

export function createPendingRecoverySearch({
  state,
  initiator,
  initiatorGoal,
  blocker,
  blockerGoal,
} = {}) {
  const blockerCustomer = getBlockerCustomer(blocker);
  const paired = blockerCustomer && blockerGoal;
  const ordered = paired
    ? pairActors(initiator, initiatorGoal, blockerCustomer, blockerGoal)
    : [{ customer: initiator, goal: initiatorGoal }];
  const cursor = {
    version: 1,
    kind: paired ? 'pair' : 'single',
    blockerKey: getBlockerKey(blocker),
    first: cursorActor(ordered[0].customer, ordered[0].goal),
    layoutSignature: getRecoveryLayoutSignature(state),
    queueSignature: getRecoveryQueueSignature(getRecoveryQueueActors(state)),
    firstIndex: 0,
    secondIndex: 0,
    waitTicks: 0,
  };
  if (paired) cursor.second = cursorActor(ordered[1].customer, ordered[1].goal);
  return cursor;
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isValidCursorActor(value) {
  return hasExactKeys(value, ['id', 'origin', 'goalKey'])
    && typeof value.id === 'string'
    && typeof value.goalKey === 'string'
    && hasExactKeys(value.origin, ['x', 'y'])
    && isFinitePoint(value.origin);
}

function isSafeCursorInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function actorMatchesCursor(actor, goal, cursorValue) {
  return actor && goal
    && String(actor.id) === cursorValue.id
    && goal.key === cursorValue.goalKey
    && typeof actor.state === 'string'
    && cursorValue.goalKey.startsWith(`${actor.state}:`);
}

export function validatePendingRecoverySearch({
  state,
  cursor,
  initiator,
  initiatorGoal,
  blocker,
  blockerGoal,
} = {}) {
  try {
    const paired = cursor?.kind === 'pair';
    const cursorKeys = paired
      ? [
        'version', 'kind', 'blockerKey', 'first', 'second', 'layoutSignature',
        'queueSignature', 'firstIndex', 'secondIndex', 'waitTicks',
      ]
      : [
        'version', 'kind', 'blockerKey', 'first', 'layoutSignature',
        'queueSignature', 'firstIndex', 'secondIndex', 'waitTicks',
      ];
    if (!hasExactKeys(cursor, cursorKeys)
      || cursor.version !== 1
      || (cursor.kind !== 'single' && cursor.kind !== 'pair')
      || typeof cursor.blockerKey !== 'string'
      || typeof cursor.layoutSignature !== 'string'
      || typeof cursor.queueSignature !== 'string'
      || !isValidCursorActor(cursor.first)
      || paired && !isValidCursorActor(cursor.second)
      || !isSafeCursorInteger(cursor.firstIndex)
      || !isSafeCursorInteger(cursor.secondIndex)
      || !isSafeCursorInteger(cursor.waitTicks)
      || !paired && cursor.secondIndex !== 0
      || cursor.layoutSignature !== getRecoveryLayoutSignature(state)
      || cursor.queueSignature !== getRecoveryQueueSignature(getRecoveryQueueActors(state))
      || cursor.blockerKey !== getBlockerKey(blocker)) return false;

    if (!paired) {
      return cursor.blockerKey === blocker?.key
        && !getBlockerCustomer(blocker)
        && actorMatchesCursor(initiator, initiatorGoal, cursor.first);
    }

    const blockerCustomer = getBlockerCustomer(blocker);
    if (!blockerCustomer || !blockerGoal) return false;
    const ordered = pairActors(initiator, initiatorGoal, blockerCustomer, blockerGoal);
    return actorMatchesCursor(ordered[0].customer, ordered[0].goal, cursor.first)
      && actorMatchesCursor(ordered[1].customer, ordered[1].goal, cursor.second);
  } catch (_error) {
    return false;
  }
}

function pendingWaitTicks(customer) {
  const value = customer?.pendingRecoverySearch?.waitTicks
    ?? customer?.recoverySearch?.waitTicks
    ?? customer?.recoverySearchCursor?.waitTicks
    ?? customer?.waitTicks;
  return isSafeCursorInteger(value) ? value : 0;
}

export function comparePendingRecoveryPriority(leftCustomer, rightCustomer) {
  return pendingWaitTicks(rightCustomer) - pendingWaitTicks(leftCustomer)
    || String(leftCustomer?.id).localeCompare(String(rightCustomer?.id));
}

export function nextRecoveryWaitCount(value, wasAdvanced) {
  if (wasAdvanced) return 0;
  const current = isSafeCursorInteger(value) ? value : 0;
  return Math.min(Number.MAX_SAFE_INTEGER, current + 1);
}

export function createRecoveryTickBudget(overrides = {}) {
  const options = overrides && typeof overrides === 'object' ? overrides : {};
  const pathCeiling = Math.min(
    RECOVERY_SEARCH_LIMITS.globalPathSearchEquivalents,
    nonNegativeCount(
      options.globalPathSearchEquivalents,
      RECOVERY_SEARCH_LIMITS.globalPathSearchEquivalents,
    ),
  );
  const pairCeiling = Math.min(
    RECOVERY_SEARCH_LIMITS.globalPairCandidateChecks,
    nonNegativeCount(
      options.globalPairCandidateChecks,
      RECOVERY_SEARCH_LIMITS.globalPairCandidateChecks,
    ),
  );
  const usedPathSearchEquivalents = Math.min(
    pathCeiling,
    nonNegativeCount(options.usedPathSearchEquivalents),
  );
  const usedPairCandidateChecks = Math.min(
    pairCeiling,
    nonNegativeCount(options.usedPairCandidateChecks),
  );
  const maximumRemainingPath = Math.max(0, pathCeiling - usedPathSearchEquivalents);
  const maximumRemainingPairs = Math.max(0, pairCeiling - usedPairCandidateChecks);

  return {
    remainingPathSearchEquivalents: Math.min(
      maximumRemainingPath,
      nonNegativeCount(options.remainingPathSearchEquivalents, maximumRemainingPath),
    ),
    remainingPairCandidateChecks: Math.min(
      maximumRemainingPairs,
      nonNegativeCount(options.remainingPairCandidateChecks, maximumRemainingPairs),
    ),
    usedPathSearchEquivalents,
    usedPairCandidateChecks,
    reachableCellVisits: nonNegativeCount(options.reachableCellVisits),
  };
}

export function createRecoverySearchAllowance(tickBudget) {
  const budget = tickBudget && typeof tickBudget === 'object'
    ? tickBudget
    : createRecoveryTickBudget();
  const allowance = {
    remainingPathSearchEquivalents: Math.min(
      RECOVERY_SEARCH_LIMITS.perSearchPathSearchEquivalents,
      nonNegativeCount(budget.remainingPathSearchEquivalents),
    ),
    remainingPairCandidateChecks: Math.min(
      RECOVERY_SEARCH_LIMITS.perSearchPairCandidateChecks,
      nonNegativeCount(budget.remainingPairCandidateChecks),
    ),
    usedPathSearchEquivalents: 0,
    usedPairCandidateChecks: 0,
    reachableCellVisits: 0,
  };

  allowance.canSpendPath = (count = 1) => {
    const amount = requestedCount(count, -1);
    return amount >= 0
      && amount <= allowance.remainingPathSearchEquivalents
      && amount <= nonNegativeCount(budget.remainingPathSearchEquivalents);
  };

  allowance.spendPath = (count = 1, reachableVisits = 0) => {
    const amount = requestedCount(count, -1);
    if (!allowance.canSpendPath(amount)) return false;
    const visits = nonNegativeCount(reachableVisits);
    allowance.remainingPathSearchEquivalents -= amount;
    allowance.usedPathSearchEquivalents += amount;
    allowance.reachableCellVisits += visits;
    budget.remainingPathSearchEquivalents = nonNegativeCount(
      budget.remainingPathSearchEquivalents,
    ) - amount;
    budget.usedPathSearchEquivalents = nonNegativeCount(budget.usedPathSearchEquivalents) + amount;
    budget.reachableCellVisits = nonNegativeCount(budget.reachableCellVisits) + visits;
    return true;
  };

  allowance.canCheckPair = () => allowance.remainingPairCandidateChecks > 0
    && nonNegativeCount(budget.remainingPairCandidateChecks) > 0;

  allowance.spendPairCheck = () => {
    if (!allowance.canCheckPair()) return false;
    allowance.remainingPairCandidateChecks -= 1;
    allowance.usedPairCandidateChecks += 1;
    budget.remainingPairCandidateChecks = nonNegativeCount(
      budget.remainingPairCandidateChecks,
    ) - 1;
    budget.usedPairCandidateChecks = nonNegativeCount(budget.usedPairCandidateChecks) + 1;
    return true;
  };

  return allowance;
}

function getQueueClearanceKeys(state, queueActors) {
  const keys = new Set();
  for (const actor of Array.isArray(queueActors) ? queueActors : []) {
    if (!isFinitePoint(actor)) continue;
    keys.add(cellKey(worldToCell(actor)));
    const firstX = Math.floor((actor.x - RECOVERY_SPACING) / GRID_SIZE);
    const lastX = Math.ceil((actor.x + RECOVERY_SPACING) / GRID_SIZE);
    const firstY = Math.floor((actor.y - RECOVERY_SPACING) / GRID_SIZE);
    const lastY = Math.ceil((actor.y + RECOVERY_SPACING) / GRID_SIZE);
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        const cell = { x, y };
        const point = cellToWorld(cell);
        if (isInsideWorld(state, cell)
          && Math.hypot(point.x - actor.x, point.y - actor.y)
            < RECOVERY_SPACING - GEOMETRY_EPSILON) {
          keys.add(cellKey(cell));
        }
      }
    }
  }
  return keys;
}

function isStaticSegmentClear(blocked, start, end) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / 2));
  const startKey = cellKey(worldToCell(start));
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    const point = {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    };
    const key = cellKey(worldToCell(point));
    if (key !== startKey && blocked.has(key)) return false;
  }
  return true;
}

function emptyIndex(status, work = {}) {
  return {
    status,
    candidates: [],
    nextCellByKey: new Map(),
    work: {
      pathSearchEquivalents: work.pathSearchEquivalents || 0,
      pairCandidateChecks: work.pairCandidateChecks || 0,
      reachableCellVisits: work.reachableCellVisits || 0,
    },
  };
}

function compareCandidates(left, right) {
  return left.relocationDistance - right.relocationDistance
    || Number(right.forwardProgress) - Number(left.forwardProgress)
    || left.routeLength - right.routeLength
    || left.cell.y - right.cell.y
    || left.cell.x - right.cell.x;
}

export function buildRecoveryCandidateIndex(
  state,
  customer,
  goal,
  origin,
  queueActors,
  allowance,
) {
  const currentState = state || {};
  if (!allowance || typeof allowance.canSpendPath !== 'function'
    || typeof allowance.spendPath !== 'function'
    || !allowance.canSpendPath(1)) {
    return emptyIndex('pending');
  }

  if (!isFiniteCell(goal?.cell) || !isFinitePoint(goal?.world)) {
    return emptyIndex('ready');
  }

  const originPoint = isFinitePoint(origin) ? { x: origin.x, y: origin.y }
    : isFinitePoint(customer) ? { x: customer.x, y: customer.y }
      : null;
  if (!originPoint) return emptyIndex('ready');
  if (!allowance.spendPath(1)) return emptyIndex('pending');

  const chargedWork = {
    pathSearchEquivalents: 1,
    pairCandidateChecks: 0,
    reachableCellVisits: 0,
  };

  const goalCell = { x: goal.cell.x, y: goal.cell.y };
  const blocked = buildBlockedCells(currentState);
  const queueClearanceKeys = customer?.state === 'leaving'
    ? getQueueClearanceKeys(currentState, queueActors)
    : new Set();
  const goalKey = cellKey(goalCell);

  if (!isInsideWorld(currentState, goalCell)
    || blocked.has(goalKey)
    || queueClearanceKeys.has(goalKey)
    || goal.useWorldGoal
      && !isStaticSegmentClear(blocked, cellToWorld(goalCell), goal.world)) {
    return emptyIndex('ready', chargedWork);
  }

  const distanceByKey = new Map([[goalKey, 0]]);
  const nextCellByKey = new Map([[goalKey, null]]);
  const cells = [goalCell];
  let readIndex = 0;

  while (readIndex < cells.length) {
    const current = cells[readIndex];
    readIndex += 1;
    const currentDistance = distanceByKey.get(cellKey(current));
    for (const [dx, dy] of REACHABILITY_DIRECTIONS) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = cellKey(next);
      if (distanceByKey.has(key)
        || !isInsideWorld(currentState, next)
        || blocked.has(key)
        || queueClearanceKeys.has(key)) continue;
      distanceByKey.set(key, currentDistance + 1);
      nextCellByKey.set(key, { ...current });
      cells.push(next);
    }
  }

  const work = {
    ...chargedWork,
    reachableCellVisits: cells.length,
  };
  allowance.spendPath(0, cells.length);

  const originCell = worldToCell(originPoint);
  const currentGoalDistance = Math.hypot(
    originPoint.x - goal.world.x,
    originPoint.y - goal.world.y,
  );
  const candidates = [];
  for (const cell of cells) {
    const key = cellKey(cell);
    if (key === cellKey(originCell) || blocked.has(key) || !isInsideWorld(currentState, cell)) continue;
    const atGoalCell = key === goalKey;
    const point = atGoalCell && goal.useWorldGoal
      ? { x: goal.world.x, y: goal.world.y }
      : cellToWorld(cell);
    const goalDistance = Math.hypot(point.x - goal.world.x, point.y - goal.world.y);
    candidates.push({
      cell: { ...cell },
      point,
      relocationDistance: Math.hypot(point.x - originPoint.x, point.y - originPoint.y),
      forwardProgress: goalDistance < currentGoalDistance - GEOMETRY_EPSILON,
      routeLength: distanceByKey.get(key),
    });
  }

  candidates.sort(compareCandidates);
  return {
    status: 'ready',
    candidates,
    nextCellByKey,
    work,
  };
}

export function reconstructRecoveryRoute(index, candidateCell) {
  if (!isFiniteCell(candidateCell) || !(index?.nextCellByKey instanceof Map)) return [];
  const nextCellByKey = index.nextCellByKey;
  const currentKey = cellKey(candidateCell);
  if (!nextCellByKey.has(currentKey)) return [];

  const route = [];
  const visited = new Set();
  let current = { ...candidateCell };
  for (let step = 0; step <= nextCellByKey.size; step += 1) {
    const key = cellKey(current);
    if (visited.has(key) || !nextCellByKey.has(key)) return [];
    visited.add(key);
    const next = nextCellByKey.get(key);
    if (next === null) return route;
    if (!isFiniteCell(next)) return [];
    route.push({ ...next });
    current = next;
  }
  return [];
}

function recoveryWork(allowance) {
  return {
    usedPathSearchEquivalents: allowance?.usedPathSearchEquivalents || 0,
    usedPairCandidateChecks: allowance?.usedPairCandidateChecks || 0,
    reachableCellVisits: allowance?.reachableCellVisits || 0,
  };
}

function pendingResult(cursor, allowance) {
  return { status: 'pending', cursor: { ...cursor }, work: recoveryWork(allowance) };
}

function exhaustedResult(allowance) {
  return { status: 'exhausted', work: recoveryWork(allowance) };
}

function successResult(plannedCustomers, allowance) {
  return { status: 'success', plannedCustomers, work: recoveryWork(allowance) };
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + dx * ratio),
    point.y - (start.y + dy * ratio),
  );
}

function routeKeepsQueueClear(customer, goal, queueActors) {
  if (customer?.state !== 'leaving') return true;
  const points = [
    { x: customer.x, y: customer.y },
    ...(Array.isArray(customer.path) ? customer.path : []).map(cellToWorld),
  ];
  if (goal.useWorldGoal) {
    const finalPoint = points.at(-1);
    if (!finalPoint || Math.hypot(finalPoint.x - goal.world.x, finalPoint.y - goal.world.y)
      > GEOMETRY_EPSILON) points.push(goal.world);
  }
  return points.every(point => queueActors.every(actor =>
    Math.hypot(point.x - actor.x, point.y - actor.y)
      >= RECOVERY_SPACING - GEOMETRY_EPSILON))
    && points.slice(1).every((point, index) => queueActors.every(actor =>
      pointToSegmentDistance(actor, points[index], point)
        >= RECOVERY_SPACING - GEOMETRY_EPSILON));
}

function goalForPlanning(goal) {
  return goal.useWorldGoal ? { world: goal.world } : { cell: goal.cell };
}

function clearForRecovery(customer, point) {
  return { ...customer, ...point };
}

function routeReachesGoal(state, customer, goal) {
  const startCell = worldToCell(customer);
  if (sameCell(startCell, goal.cell)) {
    return !goal.useWorldGoal
      || isStaticSegmentClear(buildBlockedCells(state || {}), customer, goal.world);
  }
  return Array.isArray(customer.path)
    && customer.path.length > 0
    && sameCell(customer.path.at(-1), goal.cell);
}

function isCurrentlyOccupied(point, actors) {
  return actors.some(actor => isFinitePoint(actor)
    && Math.hypot(point.x - actor.x, point.y - actor.y)
      < RECOVERY_SPACING - GEOMETRY_EPSILON);
}

function reservationActor(ownerId, key, index) {
  const [x, y] = key.split(',').map(Number);
  return {
    id: `oscillation-reservation:${ownerId}:${index}:${key}`,
    ...cellToWorld({ x, y }),
  };
}

function pathUsesReservation(character, reservationKeys) {
  return (character.path || []).some(cell => reservationKeys.has(cellKey(cell)));
}

function hasConflictingPrefixes(left, right) {
  const leftPrefix = (left.path || []).slice(0, 2).map(cellKey);
  const rightPrefix = (right.path || []).slice(0, 2).map(cellKey);
  if (leftPrefix.some(key => rightPrefix.includes(key))) return true;
  const leftStart = cellKey(worldToCell(left));
  const rightStart = cellKey(worldToCell(right));
  return leftPrefix[0] === rightStart && rightPrefix[0] === leftStart;
}

function queueReservations(state, customer, queueActors) {
  if (customer.state !== 'leaving') return [];
  return [...getQueueClearanceKeys(state, queueActors)].map((key, index) =>
    reservationActor('queue', key, index));
}

function candidateRoute(index, candidate, customer) {
  return {
    ...customer,
    ...candidate.point,
    path: reconstructRecoveryRoute(index, candidate.cell),
  };
}

function candidateRouteIsValid(state, index, candidate, customer, goal, queueActors) {
  const routed = candidateRoute(index, candidate, customer);
  return routeReachesGoal(state, routed, goal)
    && routeKeepsQueueClear(routed, goal, queueActors);
}

function nextPairCursor(cursor, firstCount, secondCount) {
  let firstIndex = cursor.firstIndex;
  let secondIndex = cursor.secondIndex + 1;
  if (secondIndex >= secondCount) {
    firstIndex += 1;
    secondIndex = 0;
  }
  return { ...cursor, firstIndex: Math.min(firstIndex, firstCount), secondIndex };
}

function advanceSingleSearch({
  state,
  cursor,
  customer,
  goal,
  queueActors,
  nonRelocatedActors,
  allowance,
}) {
  const index = buildRecoveryCandidateIndex(
    state,
    customer,
    goal,
    cursor.first.origin,
    queueActors,
    allowance,
  );
  if (index.status === 'pending') return pendingResult(cursor, allowance);
  if (cursor.firstIndex > index.candidates.length) return exhaustedResult(allowance);

  let workingCursor = { ...cursor };
  while (workingCursor.firstIndex < index.candidates.length) {
    const candidate = index.candidates[workingCursor.firstIndex];
    if (isCurrentlyOccupied(candidate.point, nonRelocatedActors)
      || !candidateRouteIsValid(state, index, candidate, customer, goal, queueActors)) {
      workingCursor = { ...workingCursor, firstIndex: workingCursor.firstIndex + 1 };
      continue;
    }
    if (!allowance.canSpendPath(2)) return pendingResult(workingCursor, allowance);
    allowance.spendPath(2);
    const planned = planCharacterPath(
      state,
      clearForRecovery(customer, candidate.point),
      goalForPlanning(goal),
      [
        ...nonRelocatedActors,
        ...queueReservations(state, customer, queueActors),
      ],
    );
    if (routeReachesGoal(state, planned, goal)
      && routeKeepsQueueClear(planned, goal, queueActors)) {
      return successResult(new Map([[planned.id, planned]]), allowance);
    }
    workingCursor = { ...workingCursor, firstIndex: workingCursor.firstIndex + 1 };
  }
  return exhaustedResult(allowance);
}

function advancePairSearch({
  state,
  cursor,
  first,
  second,
  queueActors,
  nonRelocatedActors,
  allowance,
}) {
  const firstIndex = buildRecoveryCandidateIndex(
    state,
    first.customer,
    first.goal,
    cursor.first.origin,
    queueActors,
    allowance,
  );
  if (firstIndex.status === 'pending') return pendingResult(cursor, allowance);
  const secondIndex = buildRecoveryCandidateIndex(
    state,
    second.customer,
    second.goal,
    cursor.second.origin,
    queueActors,
    allowance,
  );
  if (secondIndex.status === 'pending') return pendingResult(cursor, allowance);
  if (cursor.firstIndex > firstIndex.candidates.length
    || cursor.secondIndex > secondIndex.candidates.length) return exhaustedResult(allowance);

  let workingCursor = { ...cursor };
  while (workingCursor.firstIndex < firstIndex.candidates.length) {
    if (workingCursor.secondIndex >= secondIndex.candidates.length) {
      workingCursor = {
        ...workingCursor,
        firstIndex: workingCursor.firstIndex + 1,
        secondIndex: 0,
      };
      continue;
    }
    if (!allowance.canSpendPath(4)) return pendingResult(workingCursor, allowance);
    if (!allowance.canCheckPair()) return pendingResult(workingCursor, allowance);
    allowance.spendPairCheck();
    const firstCandidate = firstIndex.candidates[workingCursor.firstIndex];
    const secondCandidate = secondIndex.candidates[workingCursor.secondIndex];
    const rejectedByGeometry = sameCell(firstCandidate.cell, secondCandidate.cell)
      || Math.hypot(
        firstCandidate.point.x - secondCandidate.point.x,
        firstCandidate.point.y - secondCandidate.point.y,
      ) < RECOVERY_SPACING - GEOMETRY_EPSILON
      || isCurrentlyOccupied(firstCandidate.point, nonRelocatedActors)
      || isCurrentlyOccupied(secondCandidate.point, nonRelocatedActors);
    if (rejectedByGeometry
      || !candidateRouteIsValid(
        state,
        firstIndex,
        firstCandidate,
        first.customer,
        first.goal,
        queueActors,
      )
      || !candidateRouteIsValid(
        state,
        secondIndex,
        secondCandidate,
        second.customer,
        second.goal,
        queueActors,
      )) {
      workingCursor = nextPairCursor(
        workingCursor,
        firstIndex.candidates.length,
        secondIndex.candidates.length,
      );
      continue;
    }

    if (!allowance.canSpendPath(4)) return pendingResult(workingCursor, allowance);
    allowance.spendPath(4);
    const secondCellKey = cellKey(secondCandidate.cell);
    const firstReservations = new Set([secondCellKey]);
    const plannedFirst = planCharacterPath(
      state,
      clearForRecovery(first.customer, firstCandidate.point),
      goalForPlanning(first.goal),
      [
        ...nonRelocatedActors,
        ...queueReservations(state, first.customer, queueActors),
        reservationActor(second.customer.id, secondCellKey, 0),
      ],
    );
    const secondReservationKeys = new Set([
      cellKey(firstCandidate.cell),
      ...(plannedFirst.path || []).slice(0, 2).map(cellKey),
    ]);
    const plannedSecond = planCharacterPath(
      state,
      clearForRecovery(second.customer, secondCandidate.point),
      goalForPlanning(second.goal),
      [
        ...nonRelocatedActors,
        ...queueReservations(state, second.customer, queueActors),
        ...[...secondReservationKeys].map((key, index) =>
          reservationActor(first.customer.id, key, index)),
      ],
    );
    const firstValid = routeReachesGoal(state, plannedFirst, first.goal)
      && routeKeepsQueueClear(plannedFirst, first.goal, queueActors)
      && !pathUsesReservation(plannedFirst, firstReservations);
    if (firstValid) {
      if (routeReachesGoal(state, plannedSecond, second.goal)
        && routeKeepsQueueClear(plannedSecond, second.goal, queueActors)
        && !pathUsesReservation(plannedSecond, secondReservationKeys)
        && !hasConflictingPrefixes(plannedFirst, plannedSecond)) {
        return successResult(new Map([
          [plannedFirst.id, plannedFirst],
          [plannedSecond.id, plannedSecond],
        ]), allowance);
      }
    }
    workingCursor = nextPairCursor(
      workingCursor,
      firstIndex.candidates.length,
      secondIndex.candidates.length,
    );
  }
  return exhaustedResult(allowance);
}

export function advanceRecoverySearch({
  state,
  cursor,
  initiator,
  initiatorGoal,
  blockerCustomer,
  blockerGoal,
  tickBudget,
} = {}) {
  const allowance = createRecoverySearchAllowance(tickBudget);
  const blocker = cursor?.kind === 'pair'
    ? { kind: 'customer', customer: blockerCustomer }
    : { kind: 'fixed', key: cursor?.blockerKey };
  if (!validatePendingRecoverySearch({
    state,
    cursor,
    initiator,
    initiatorGoal,
    blocker,
    blockerGoal,
  })) return exhaustedResult(allowance);

  const queueActors = getRecoveryQueueActors(state);
  if (cursor.kind === 'single') {
    const nonRelocatedActors = [
      ...(state?.staff || []),
      ...(state?.customers || []).filter(actor => String(actor.id) !== String(initiator.id)),
      ...queueActors,
    ].filter(isFinitePoint);
    return advanceSingleSearch({
      state,
      cursor,
      customer: initiator,
      goal: initiatorGoal,
      queueActors,
      nonRelocatedActors,
      allowance,
    });
  }

  const ordered = pairActors(initiator, initiatorGoal, blockerCustomer, blockerGoal);
  const relocatingIds = new Set(ordered.map(entry => String(entry.customer.id)));
  const nonRelocatedActors = [
    ...(state?.staff || []),
    ...(state?.customers || []).filter(actor => !relocatingIds.has(String(actor.id))),
    ...queueActors,
  ].filter(isFinitePoint);
  return advancePairSearch({
    state,
    cursor,
    first: ordered[0],
    second: ordered[1],
    queueActors,
    nonRelocatedActors,
    allowance,
  });
}
