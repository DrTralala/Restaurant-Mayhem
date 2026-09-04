import {
  buildBlockedCells,
  cellToWorld,
  worldToCell,
} from './pathfinding';
import { clearMovementRecoveryMetadata } from './movement';
import { getQueueProjectedMembers } from './customerQueue';
import { getDoorPosition, getDoors } from './world';
import {
  advanceRecoverySearch,
  comparePendingRecoveryPriority,
  createPendingRecoverySearch,
  createRecoveryTickBudget,
  nextRecoveryWaitCount,
  validatePendingRecoverySearch,
} from './customerRecoverySearch';

const MONITORED_STATES = new Set(['guided', 'checkout_moving', 'leaving']);
const OSCILLATION_SECONDS = 5;
const PROGRESS_DISTANCE = 0.1;
const MAX_CORRIDOR_CELLS = 3;
const MAX_EDGES = 6;
const ARRIVAL_TOLERANCE = 2;

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function isFiniteCell(cell) {
  return Number.isInteger(cell?.x) && Number.isInteger(cell?.y);
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function parseCellKey(value) {
  if (typeof value !== 'string' || !/^-?\d+,-?\d+$/.test(value)) return null;
  const [x, y] = value.split(',').map(Number);
  return isFiniteCell({ x, y }) ? { x, y } : null;
}

function parseEdgeKey(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('>');
  if (parts.length !== 2) return null;
  const from = parseCellKey(parts[0]);
  const to = parseCellKey(parts[1]);
  if (!from || !to || !areAdjacent(from, to)) return null;
  return { from, to };
}

function areAdjacent(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function isContiguousCorridor(corridorCells) {
  if (corridorCells.length === 0) return false;
  const remaining = new Set(corridorCells);
  const reached = new Set([corridorCells[0]]);
  remaining.delete(corridorCells[0]);
  while (remaining.size > 0) {
    let added = false;
    for (const key of remaining) {
      const cell = parseCellKey(key);
      const adjacent = [...reached].some(reachedKey =>
        areAdjacent(parseCellKey(reachedKey), cell));
      if (!adjacent) continue;
      reached.add(key);
      remaining.delete(key);
      added = true;
    }
    if (!added) return false;
  }
  return true;
}

function isValidCorridor(corridorCells, previousCell) {
  if (!Array.isArray(corridorCells)
    || corridorCells.length === 0
    || corridorCells.length > MAX_CORRIDOR_CELLS
    || new Set(corridorCells).size !== corridorCells.length
    || !corridorCells.every(key => parseCellKey(key))) return false;
  if (!corridorCells.includes(cellKey(previousCell))) return false;
  return isContiguousCorridor(corridorCells);
}

function isValidEdges(edges, corridorCells) {
  if (!Array.isArray(edges)
    || edges.length > MAX_EDGES
    || new Set(edges).size !== edges.length) return false;
  const corridor = new Set(corridorCells);
  return edges.every(edge => {
    const parsed = parseEdgeKey(edge);
    return parsed
      && corridor.has(cellKey(parsed.from))
      && corridor.has(cellKey(parsed.to));
  });
}

function isValidObservationMetadata(metadata, state, goal) {
  if (!metadata || typeof metadata !== 'object'
    || metadata.state !== state
    || metadata.goalKey !== goal.key
    || !isFiniteCell(metadata.previousCell)
    || !isFinitePoint(metadata.previousPosition)
    || cellKey(metadata.previousCell) !== cellKey(worldToCell(metadata.previousPosition))
    || !isValidCorridor(metadata.corridorCells, metadata.previousCell)
    || !isValidEdges(metadata.edges, metadata.corridorCells)
    || !Number.isFinite(metadata.pendingMovementFor)
    || metadata.pendingMovementFor < 0
    || !Number.isFinite(metadata.oscillatingFor)
    || metadata.oscillatingFor < 0
    || (metadata.oscillatingFor > 0 && !hasReversal(metadata.edges))
    || !Number.isFinite(metadata.bestGoalDistance)
    || metadata.bestGoalDistance < 0) return false;
  return true;
}

function isValidGoal(goal) {
  return !!goal
    && typeof goal === 'object'
    && typeof goal.key === 'string'
    && typeof goal.useWorldGoal === 'boolean'
    && isFinitePoint(goal.cell)
    && isFinitePoint(goal.world);
}

function withoutOscillationMetadata(customer) {
  if (!customer || typeof customer !== 'object' || !Object.hasOwn(customer, 'oscillationRecovery')) {
    return customer;
  }
  const { oscillationRecovery: _oscillationRecovery, ...clean } = customer;
  return clean;
}

function createObservation(customer, goal, currentCell, goalDistance) {
  return {
    state: customer.state,
    goalKey: goal.key,
    previousCell: { ...currentCell },
    previousPosition: { x: customer.x, y: customer.y },
    corridorCells: [cellKey(currentCell)],
    edges: [],
    pendingMovementFor: 0,
    oscillatingFor: 0,
    bestGoalDistance: goalDistance,
  };
}

function withObservation(customer, observation) {
  return { ...customer, oscillationRecovery: observation };
}

function goalDistance(customer, goal) {
  return Math.hypot(customer.x - goal.world.x, customer.y - goal.world.y);
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
}

function isActivelyTraversingPath(customer) {
  return Array.isArray(customer?.path) && customer.path.length > 0;
}

function isArrivedPathlessCheckout(customer, destination = customer?.checkoutPosition) {
  return customer?.state === 'checkout_moving'
    && Array.isArray(customer.path)
    && customer.path.length === 0
    && isFinitePoint(customer)
    && isFinitePoint(destination)
    && Math.hypot(customer.x - destination.x, customer.y - destination.y)
      <= ARRIVAL_TOLERANCE + 1e-9;
}

function isMovableCustomerBlocker(customer) {
  if (!customer || !MONITORED_STATES.has(customer.state) || customer.exitPhase === 'fading') {
    return false;
  }
  return isActivelyTraversingPath(customer) || isArrivedPathlessCheckout(customer);
}

export function classifyCustomerBlocker(state, customer, metadata) {
  if (!isFinitePoint(customer)) return null;
  const currentCell = worldToCell(customer);
  const nextCell = Array.isArray(customer.path) && isFiniteCell(customer.path[0])
    ? customer.path[0]
    : null;
  const corridorKeys = new Set([
    ...(Array.isArray(metadata?.corridorCells)
      ? metadata.corridorCells.filter(key => parseCellKey(key))
      : []),
    cellKey(currentCell),
    ...(nextCell ? [cellKey(nextCell)] : []),
  ]);
  const segmentEnd = nextCell ? cellToWorld(nextCell) : customer;
  const actorCandidates = [
    ...(state?.staff || []).map(actor => ({
      actor,
      kind: 'fixed',
      key: `staff:${actor?.id}`,
      tieType: 1,
    })),
    ...(state?.customers || [])
      .filter(actor => actor?.id !== customer.id)
      .map(actor => ({
        actor,
        kind: isMovableCustomerBlocker(actor) ? 'customer' : 'fixed',
        key: `customer:${actor?.id}`,
        tieType: 2,
      })),
    ...getQueueActors(state).map(actor => ({
      actor,
      kind: 'fixed',
      key: actor?.id != null
        ? `queue:${actor.id}`
        : `queue:${actor?.x},${actor?.y}`,
      tieType: 3,
    })),
  ].filter(({ actor }) => isFinitePoint(actor))
    .map(candidate => ({
      ...candidate,
      segmentDistance: pointToSegmentDistance(candidate.actor, customer, segmentEnd),
      tieId: String(candidate.actor.id),
    }))
    .filter(({ actor, segmentDistance }) =>
      corridorKeys.has(cellKey(worldToCell(actor))) || segmentDistance <= 16);

  const blocked = buildBlockedCells(state || {});
  const currentKey = cellKey(currentCell);
  const staticCandidates = [...corridorKeys]
    .filter(key => key !== currentKey && blocked.has(key))
    .map(key => {
      const cell = parseCellKey(key);
      return {
        kind: 'fixed',
        key: `cell:${key}`,
        segmentDistance: pointToSegmentDistance(cellToWorld(cell), customer, segmentEnd),
        tieType: 0,
        tieY: cell.y,
        tieX: cell.x,
      };
    });
  const candidates = [...actorCandidates, ...staticCandidates]
    .sort((left, right) => left.segmentDistance - right.segmentDistance
      || left.tieType - right.tieType
      || (left.tieY ?? 0) - (right.tieY ?? 0)
      || (left.tieX ?? 0) - (right.tieX ?? 0)
      || (left.tieId || '').localeCompare(right.tieId || ''));

  if (candidates.length > 0) {
    const first = candidates[0];
    return first.kind === 'customer'
      ? { kind: 'customer', customer: first.actor }
      : { kind: 'fixed', key: first.key };
  }
  return null;
}

function getQueueActors(state) {
  return getQueueProjectedMembers(state || {}, state?.queue || []).filter(isFinitePoint);
}

function withoutLegacyStuckWatchdog(customer) {
  if (!customer || typeof customer !== 'object' || !Object.hasOwn(customer, 'stuckWatchdog')) {
    return customer;
  }
  const { stuckWatchdog: _stuckWatchdog, ...clean } = customer;
  return clean;
}

function withoutPendingSearch(customer) {
  const observation = customer?.oscillationRecovery;
  if (!observation || typeof observation !== 'object'
    || !Object.hasOwn(observation, 'pendingSearch')) return customer;
  const { pendingSearch: _pendingSearch, ...retainedObservation } = observation;
  return {
    ...customer,
    oscillationRecovery: retainedObservation,
  };
}

function withPendingSearch(customer, pendingSearch) {
  return {
    ...customer,
    oscillationRecovery: {
      ...customer.oscillationRecovery,
      pendingSearch,
    },
  };
}

function commitStagedRecoveryCustomer(staged) {
  const cleared = clearMovementRecoveryMetadata(staged);
  for (const key of ['pathGoal', 'usingStaticFallback', 'minimumSpacing']) {
    if (Object.hasOwn(staged, key)) cleared[key] = staged[key];
  }
  return clearCustomerOscillationMetadata(cleared);
}

function getCurrentBlockerContext(state, observedById, goalsById, customer) {
  const blocker = classifyCustomerBlocker(state, customer, customer.oscillationRecovery);
  if (!blocker) return { blocker: null, blockerCustomer: null, blockerGoal: null };
  if (blocker.kind === 'fixed') {
    return { blocker, blockerCustomer: null, blockerGoal: null };
  }
  const blockerCustomer = observedById.get(blocker.customer.id);
  const blockerGoal = goalsById.get(blocker.customer.id)
    || getCustomerRecoveryGoal(state, blockerCustomer);
  return { blocker, blockerCustomer, blockerGoal };
}

export function recoverOscillatingCustomers(state, movementDt) {
  const customers = state?.customers || [];
  const observedById = new Map();
  const goalsById = new Map();
  const triggeredIds = new Set();

  for (const customer of customers) {
    const goal = getCustomerRecoveryGoal(state, customer);
    if (!goal) {
      observedById.set(customer.id, clearCustomerOscillationMetadata(customer));
      continue;
    }
    const observed = observeCustomerOscillation(customer, goal, movementDt);
    observedById.set(customer.id, withoutLegacyStuckWatchdog(observed.customer));
    goalsById.set(customer.id, goal);
    if (observed.shouldRecover) triggeredIds.add(customer.id);
  }

  const pendingContexts = [];
  for (const customer of customers) {
    const observed = observedById.get(customer.id);
    const goal = goalsById.get(customer.id);
    if (!observed || !goal) continue;
    const currentCustomers = customers.map(candidate => observedById.get(candidate.id) || candidate);
    const workingState = { ...state, customers: currentCustomers };
    const context = getCurrentBlockerContext(
      workingState,
      observedById,
      goalsById,
      observed,
    );
    const hasPendingCursor = !!observed.oscillationRecovery
      && Object.hasOwn(observed.oscillationRecovery, 'pendingSearch');
    const existingCursor = observed.oscillationRecovery?.pendingSearch;

    if (hasPendingCursor) {
      if (validatePendingRecoverySearch({
        state: workingState,
        cursor: existingCursor,
        initiator: observed,
        initiatorGoal: goal,
        blocker: context.blocker,
        blockerGoal: context.blockerGoal,
      })) {
        pendingContexts.push({
          id: customer.id,
          pendingRecoverySearch: existingCursor,
          cursor: existingCursor,
          goal,
          ...context,
        });
        continue;
      }
      observedById.set(customer.id, withoutPendingSearch(observed));
      continue;
    }

    if (!triggeredIds.has(customer.id) || !context.blocker) continue;
    if (context.blocker.kind === 'customer'
      && (!context.blockerCustomer || !context.blockerGoal)) continue;
    const cursor = createPendingRecoverySearch({
      state: workingState,
      initiator: observedById.get(customer.id),
      initiatorGoal: goal,
      blocker: context.blocker,
      blockerGoal: context.blockerGoal,
    });
    observedById.set(customer.id, withPendingSearch(observedById.get(customer.id), cursor));
    pendingContexts.push({
      id: customer.id,
      pendingRecoverySearch: cursor,
      cursor,
      goal,
      ...context,
    });
  }

  pendingContexts.sort(comparePendingRecoveryPriority);
  const tickBudget = createRecoveryTickBudget();
  const recoveredIds = new Set();
  for (let index = 0; index < pendingContexts.length; index += 1) {
    const pending = pendingContexts[index];
    const { id } = pending;
    if (recoveredIds.has(id)
      || pending.blockerCustomer && recoveredIds.has(pending.blockerCustomer.id)) continue;
    const hasBudget = tickBudget.remainingPathSearchEquivalents > 0
      && (pending.cursor.kind === 'single'
        || tickBudget.remainingPairCandidateChecks > 0);
    if (!hasBudget) {
      const waitingCustomer = observedById.get(id);
      if (waitingCustomer?.oscillationRecovery?.pendingSearch) {
        observedById.set(id, withPendingSearch(waitingCustomer, {
          ...waitingCustomer.oscillationRecovery.pendingSearch,
          waitTicks: nextRecoveryWaitCount(
            waitingCustomer.oscillationRecovery.pendingSearch.waitTicks,
            false,
          ),
        }));
      }
      continue;
    }
    const currentCustomers = customers.map(customer => observedById.get(customer.id) || customer);
    const workingState = { ...state, customers: currentCustomers };
    const customer = observedById.get(id);
    const result = advanceRecoverySearch({
      state: workingState,
      cursor: pending.cursor,
      initiator: customer,
      initiatorGoal: pending.goal,
      blockerCustomer: pending.blockerCustomer,
      blockerGoal: pending.blockerGoal,
      tickBudget,
    });

    if (result.status === 'pending') {
      const madeCursorProgress = result.cursor.firstIndex !== pending.cursor.firstIndex
        || result.cursor.secondIndex !== pending.cursor.secondIndex;
      observedById.set(id, withPendingSearch(customer, {
        ...result.cursor,
        waitTicks: nextRecoveryWaitCount(pending.cursor.waitTicks, madeCursorProgress),
      }));
    } else if (result.status === 'exhausted') {
      observedById.set(id, withoutPendingSearch(customer));
    } else if (result.status === 'success') {
      for (const [recoveredId, staged] of result.plannedCustomers) {
        const recovered = commitStagedRecoveryCustomer(staged);
        observedById.set(recoveredId, recovered);
        recoveredIds.add(recoveredId);
      }
    }
  }

  return {
    ...state,
    customers: customers.map(customer => observedById.get(customer.id) || customer),
  };
}

function addUniqueEdge(edges, edge) {
  if (edges.includes(edge) || edges.length >= MAX_EDGES) return edges;
  return [...edges, edge];
}

function hasReversal(edges) {
  const edgeSet = new Set(edges);
  return edges.some(edge => {
    const parsed = parseEdgeKey(edge);
    return parsed && edgeSet.has(`${cellKey(parsed.to)}>${cellKey(parsed.from)}`);
  });
}

function freshCustomerObservation(customer, goal, currentCell, distance) {
  return {
    customer: withObservation(customer, createObservation(customer, goal, currentCell, distance)),
    shouldRecover: false,
  };
}

function getNextCorridor(previous, currentCell) {
  const currentKey = cellKey(currentCell);
  if (!areAdjacent(previous.previousCell, currentCell)) return null;
  if (previous.corridorCells.includes(currentKey)) return previous.corridorCells;
  if (previous.corridorCells.length >= MAX_CORRIDOR_CELLS) return null;
  return [...previous.corridorCells, currentKey];
}

function shouldAttemptOscillationRecovery(observation, movementDt, qualifyingTransition) {
  return movementDt > 0
    && qualifyingTransition
    && observation.oscillatingFor > OSCILLATION_SECONDS;
}

export function clearCustomerOscillationMetadata(customer) {
  if (!customer || typeof customer !== 'object'
    || (!Object.hasOwn(customer, 'oscillationRecovery') && !Object.hasOwn(customer, 'stuckWatchdog'))) {
    return customer;
  }
  const {
    oscillationRecovery: _oscillationRecovery,
    stuckWatchdog: _stuckWatchdog,
    ...clean
  } = customer;
  return clean;
}

export function getCustomerRecoveryGoal(state, customer) {
  if (!customer || typeof customer !== 'object'
    || !MONITORED_STATES.has(customer.state)
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
    world = cell ? cellToWorld(cell) : null;
  } else if (customer.state === 'checkout_moving') {
    world = customer.checkoutPosition;
    cell = isFinitePoint(world) ? worldToCell(world) : null;
    useWorldGoal = true;
  } else {
    let doors;
    try {
      doors = getDoors(state || {});
    } catch (_error) {
      doors = null;
    }
    const door = Array.isArray(doors)
      ? doors.find(candidate => candidate?.id === customer.exitDoorId)
      : null;
    try {
      world = door ? getDoorPosition(state || {}, door).outside : null;
    } catch (_error) {
      world = null;
    }
    cell = isFinitePoint(world) ? worldToCell(world) : null;
    useWorldGoal = true;
  }

  if (!isFinitePoint(cell) || !isFinitePoint(world)) return null;
  if (!isActivelyTraversingPath(customer)
    && !isArrivedPathlessCheckout(customer, world)) return null;
  return {
    cell,
    world,
    useWorldGoal,
    key: `${customer.state}:${cell.x},${cell.y}:${world.x},${world.y}`,
  };
}

export function observeCustomerOscillation(customer, goal, movementDt) {
  if (!customer || typeof customer !== 'object'
    || !MONITORED_STATES.has(customer.state)
    || customer.exitPhase === 'fading'
    || !isValidGoal(goal)
    || (!isActivelyTraversingPath(customer)
      && !isArrivedPathlessCheckout(customer, goal?.world))
    || !isFinitePoint(customer)) {
    return { customer: withoutOscillationMetadata(customer), shouldRecover: false };
  }

  const currentCell = worldToCell(customer);
  const currentDistance = goalDistance(customer, goal);
  const previous = customer.oscillationRecovery;
  if (!isValidObservationMetadata(previous, customer.state, goal)) {
    return freshCustomerObservation(customer, goal, currentCell, currentDistance);
  }

  const dt = Number.isFinite(movementDt) && movementDt > 0 ? movementDt : 0;
  const currentPosition = { x: customer.x, y: customer.y };
  const currentMovementFor = Math.hypot(
    currentPosition.x - previous.previousPosition.x,
    currentPosition.y - previous.previousPosition.y,
  ) > 0 ? dt : 0;
  const hasCandidate = previous.oscillatingFor > 0 || hasReversal(previous.edges);
  const meaningfulProgress = hasCandidate
    && currentDistance <= previous.bestGoalDistance - PROGRESS_DISTANCE + 1e-9;
  if (meaningfulProgress) {
    return freshCustomerObservation(customer, goal, currentCell, currentDistance);
  }

  const bestGoalDistance = Math.min(previous.bestGoalDistance, currentDistance);
  const currentKey = cellKey(currentCell);
  const previousKey = cellKey(previous.previousCell);
  if (currentKey === previousKey) {
    const pendingMovementFor = previous.pendingMovementFor + currentMovementFor;
    const observation = {
      ...previous,
      previousPosition: currentPosition,
      pendingMovementFor: Number.isFinite(pendingMovementFor) ? pendingMovementFor : Number.MAX_VALUE,
      bestGoalDistance,
    };
    return {
      customer: withObservation(customer, observation),
      shouldRecover: false,
    };
  }

  const corridorCells = getNextCorridor(previous, currentCell);
  if (!corridorCells) {
    return freshCustomerObservation(customer, goal, currentCell, currentDistance);
  }

  const edge = `${previousKey}>${currentKey}`;
  const reverse = `${currentKey}>${previousKey}`;
  const segmentDuration = previous.pendingMovementFor + currentMovementFor;
  const reversed = previous.edges.includes(reverse);
  const edges = addUniqueEdge(previous.edges, edge);
  const oscillatingFor = reversed
    ? previous.oscillatingFor + segmentDuration
    : previous.oscillatingFor;
  const observation = {
    ...previous,
    previousCell: { ...currentCell },
    previousPosition: currentPosition,
    corridorCells: [...corridorCells],
    edges,
    pendingMovementFor: reversed ? 0 : currentMovementFor,
    oscillatingFor: Number.isFinite(oscillatingFor) ? oscillatingFor : Number.MAX_VALUE,
    bestGoalDistance,
  };
  return {
    customer: withObservation(customer, observation),
    shouldRecover: shouldAttemptOscillationRecovery(observation, dt, reversed),
  };
}
