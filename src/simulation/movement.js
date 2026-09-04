import { buildOccupiedCharacterCells, cellToWorld, findPath, isInsideWorld, worldToCell } from './pathfinding';
import { orderActorsByMovementPriority, solveLocalConflictComponent } from './localConflictSolver';
import { getRestaurantWorld, GRID_SIZE } from './world';
import {
  createNavigationWorkspace,
  furthestWorldSegmentEndpoint,
  isSafeSegment,
  resolveNavigationWorkspace,
} from './movement/navigationWorkspace';
import {
  appendTimedSegment,
  buildDirectTrajectory,
  buildPathTrajectory,
  buildTimeParameterizedTrajectory,
  coincidentStartTrajectoriesSeparateSafely,
  minimumSweptDistance,
  minimumTrajectoryDistance,
  pointAtTrajectorySegment,
  positionOf,
  stationaryTrajectory,
  trajectoryPositionAt,
  trajectoryPrefix,
  trajectorySegment,
} from './movement/trajectory';
import {
  clearMovementRecoveryMetadata,
  ensureStaffRuntime,
  hasArrived,
  moveCharacterAlongPath,
  moveCharacterTowards,
  moveCharacterWithRecovery,
  moveStaffAlongPath,
  planCharacterPath,
} from './movement/pathMotion';

export {
  buildTimeParameterizedTrajectory,
  coincidentStartTrajectoriesSeparateSafely,
  minimumSweptDistance,
  minimumTrajectoryDistance,
} from './movement/trajectory';

export {
  clearMovementRecoveryMetadata,
  ensureStaffRuntime,
  hasArrived,
  moveCharacterAlongPath,
  moveCharacterTowards,
  moveCharacterWithRecovery,
  moveStaffAlongPath,
  planCharacterPath,
} from './movement/pathMotion';

function movementNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function measureMovementPhase(metrics, key, operation) {
  if (!metrics) return operation();
  const startedAt = movementNow();
  try {
    return operation();
  } finally {
    metrics[key] += movementNow() - startedAt;
  }
}

const localConflictPhaseKeys = [
  'localConflictPreparationMilliseconds',
  'localConflictSolverMilliseconds',
  'localConflictCandidateMilliseconds',
  'localConflictSafetyMilliseconds',
  'localConflictFallbackMilliseconds',
];

const solverPhaseKeys = [
  'solverInitialPlanningMilliseconds',
  'solverNodeBuildMilliseconds',
  'solverFrontierOrderingMilliseconds',
  'solverReplanningMilliseconds',
  'solverAgedFallbackMilliseconds',
  'solverResidualMilliseconds',
];

function measureLocalConflictPhase(metrics, key, operation) {
  return measureMovementPhase(metrics, key, operation);
}

function measureLocalConflictFallbackPhase(metrics, operation) {
  if (!metrics) return operation();
  const startedAt = movementNow();
  const safePrefixAtStart = metrics.safePrefixMilliseconds;
  const result = operation();
  const nestedSafePrefix = metrics.safePrefixMilliseconds - safePrefixAtStart;
  metrics.localConflictFallbackMilliseconds += Math.max(
    0,
    movementNow() - startedAt - nestedSafePrefix,
  );
  return result;
}

export function solveLocalConflictWithMovementMetrics(options, metrics = null) {
  const phasesAtStart = metrics
    ? Object.fromEntries(solverPhaseKeys.map(key => [key, metrics[key]]))
    : null;
  const outerAtStart = metrics ? metrics.localConflictSolverMilliseconds : 0;
  const solved = measureLocalConflictPhase(metrics, 'localConflictSolverMilliseconds', () =>
    solveLocalConflictComponent({ ...options, metrics }));
  if (metrics) {
    const outerDelta = metrics.localConflictSolverMilliseconds - outerAtStart;
    const measured = solverPhaseKeys.reduce((total, key) =>
      total + metrics[key] - phasesAtStart[key], 0);
    metrics.solverResidualMilliseconds += Math.max(0, outerDelta - measured);
  }
  return solved;
}

function getMovementSpacing(character) {
  return 16;
}

function isAtTarget(position, target) {
  return Math.hypot(position.x - target.x, position.y - target.y) <= 0.001;
}

function isQueuedTarget(character, target) {
  if (!character.path?.length) return false;
  const queuedTarget = cellToWorld(character.path[0]);
  return isAtTarget(queuedTarget, target);
}

/**
 * `targetAfterPath` is an optional exact-world target for an entry whose final
 * queued waypoint is consumed during this update. The continuation uses only
 * the remaining movement budget and still passes static validation. Its
 * piecewise trajectory is retained for swept dynamic collision resolution.
 */
function moveAlongPathWithContinuation(state, entry, dt, spacing, navigation = {}) {
  const { character, speed } = entry;
  const beforeLength = character.path?.length || 0;
  const pathMoved = moveCharacterAlongPath(character, dt, [], speed, spacing, state, navigation);
  const pathWasConsumed = (pathMoved.path?.length || 0) < beforeLength;
  const pathDisplacement = Math.hypot(pathMoved.x - character.x, pathMoved.y - character.y);
  const pathConsumedAt = pathWasConsumed
    ? (speed > 0 && dt > 0 ? Math.min(1, pathDisplacement / (speed * dt)) : 0)
    : null;
  if (!entry.targetAfterPath || beforeLength === 0 || pathMoved.path?.length || speed <= 0) {
    return {
      moved: pathMoved,
      trajectory: buildPathTrajectory(character, pathMoved, pathMoved, speed, dt, beforeLength, false),
      pathConsumedAt,
    };
  }

  const displacement = Math.hypot(pathMoved.x - character.x, pathMoved.y - character.y);
  const remainingBudget = Math.max(0, speed * dt - displacement);
  if (remainingBudget <= 0) {
    return {
      moved: pathMoved,
      trajectory: buildPathTrajectory(character, pathMoved, pathMoved, speed, dt, beforeLength, false),
      pathConsumedAt,
    };
  }
  const continued = moveCharacterTowards(
    pathMoved,
    entry.targetAfterPath,
    remainingBudget / speed,
    [],
    speed,
    spacing,
    state,
    navigation,
  );
  return {
    moved: continued,
    trajectory: buildPathTrajectory(character, pathMoved, continued, speed, dt, beforeLength, true),
    pathConsumedAt,
  };
}

function buildMovementIntent(state, entry, dt, navigation = {}) {
  const { speed } = entry;
  const sourceCharacter = entry.character;
  const useLocalConflictTarget = sourceCharacter.localConflictTarget
    && !sourceCharacter.usingStaticFallback
    && (sourceCharacter.path?.length || entry.target || entry.targetAfterPath);
  const { localConflictTarget: _staleLocalTarget, ...withoutLocalTarget } = sourceCharacter;
  const character = useLocalConflictTarget ? sourceCharacter : withoutLocalTarget;
  const normalisedEntry = { ...entry, character };
  const spacing = getMovementSpacing(character);
  const start = { x: character.x, y: character.y };
  let desired;

  if (useLocalConflictTarget) {
    const localTarget = cellToWorld(character.localConflictTarget);
    const moved = moveCharacterTowards(character, localTarget, dt, [], speed, spacing, state, navigation);
    const reachedLocalTarget = isAtTarget(moved, localTarget);
    const { localConflictTarget: _localConflictTarget, ...withoutLocalTarget } = moved;
    desired = reachedLocalTarget
      ? { ...withoutLocalTarget, path: character.path }
      : { ...moved, path: character.path };
    return {
      ...normalisedEntry,
      start,
      desired,
      spacing,
      trajectory: buildDirectTrajectory(character, desired, speed, dt),
      pathConsumedAt: null,
    };
  } else if (entry.target) {
    const moved = moveCharacterTowards(character, entry.target, dt, [], speed, spacing, state, navigation);
    desired = moved;
    if (entry.consumePath === true && isAtTarget(moved, entry.target) && isQueuedTarget(character, entry.target)) {
      desired = { ...moved, path: character.path.slice(1) };
    } else if (character.path) {
      desired = { ...moved, path: character.path };
    }
    return {
      ...normalisedEntry,
      start,
      desired,
      spacing,
      trajectory: buildDirectTrajectory(character, moved, speed, dt),
      pathConsumedAt: (desired.path?.length || 0) < (character.path?.length || 0)
        ? buildDirectTrajectory(character, moved, speed, dt)[0].endTime
        : null,
    };
  } else {
    const moved = moveAlongPathWithContinuation(state, normalisedEntry, dt, spacing, navigation);
    desired = moved.moved;
    return {
      ...normalisedEntry,
      start,
      desired,
      spacing,
      trajectory: moved.trajectory,
      pathConsumedAt: moved.pathConsumedAt,
    };
  }
}

function resolvedIntent(intent, endpoint, trajectory) {
  return { ...intent, endpoint, trajectory };
}

function resolvedAtStart(intent) {
  return intent.startResolution;
}

function resolvedAtDesired(intent) {
  return intent.desiredResolution;
}

function ignoresIntentPair(intent, peerId) {
  return (intent.ignoredIds || []).some(id => String(id) === String(peerId));
}

function isHorizontalHeadOnGeometry(intent, peer) {
  const intentMovement = {
    x: intent.desired.x - intent.start.x,
    y: intent.desired.y - intent.start.y,
  };
  const peerMovement = {
    x: peer.desired.x - peer.start.x,
    y: peer.desired.y - peer.start.y,
  };
  const separationX = peer.start.x - intent.start.x;
  const epsilon = 1e-6;
  return Math.abs(intent.start.y - peer.start.y) <= epsilon
    && Math.abs(intentMovement.y) <= epsilon
    && Math.abs(peerMovement.y) <= epsilon
    && Math.abs(intentMovement.x) > epsilon
    && Math.abs(peerMovement.x) > epsilon
    && intentMovement.x * peerMovement.x < 0
    && separationX * intentMovement.x > epsilon
    && separationX * peerMovement.x < -epsilon;
}

function hasExplicitHeadOnRecovery(intent) {
  return intent.headOnDetourEligible === true
    && (intent.character.headOnRecovery === true
      || (intent.character.usingStaticFallback && (intent.character.stalledFor || 0) >= 2));
}

function isExplicitRecoveredHorizontalHeadOn(intent, peer) {
  const priority = String(intent.character.id) < String(peer.character.id) ? intent : peer;
  return hasExplicitHeadOnRecovery(priority)
    && isHorizontalHeadOnGeometry(intent, peer);
}

function findSafeDetour(state, intent, spacing, dt, intents, resolutions, checkedIntents = intents, navigation = {}) {
  for (const y of [intent.start.y - 40, intent.start.y + 40]) {
    const sideTarget = { x: intent.start.x, y };
    if (!isInsideWorld(state, worldToCell(sideTarget))
      || !isSafeSegment(state, intent.start, sideTarget, navigation)) continue;
    let endpoint = moveCharacterTowards(intent.character, sideTarget, dt, [],
      intent.speed, spacing, state, navigation);
    if (Math.hypot(endpoint.x - intent.start.x, endpoint.y - intent.start.y) <= 1e-6) continue;
    if (intent.character.path?.length && !isAtTarget(endpoint, sideTarget)) {
      endpoint = {
        ...endpoint,
        path: [worldToCell(sideTarget), ...intent.character.path],
      };
    }
    const candidate = resolvedIntent(
      intent,
      endpoint,
      buildTimeParameterizedTrajectory(intent.start, endpoint, intent.speed, dt),
    );
    if (!isSafeSegment(state, intent.start, endpoint, navigation)) continue;
    const candidateResolutions = new Map(resolutions);
    candidateResolutions.set(intent.character.id, candidate);
    if (areIntentPairsSafeFor(checkedIntents, intents, candidateResolutions)) {
      return candidate;
    }
  }
  return null;
}

function findControlledOverlapDetour(state, intent, dt, intents, resolutions, component, navigation = {}) {
  const sideTargets = [
    { x: intent.start.x, y: intent.start.y - 40 },
    { x: intent.start.x, y: intent.start.y + 40 },
    { x: intent.start.x - 40, y: intent.start.y },
    { x: intent.start.x + 40, y: intent.start.y },
  ];
  for (const sideTarget of sideTargets) {
    if (!isInsideWorld(state, worldToCell(sideTarget))
      || !isSafeSegment(state, intent.start, sideTarget, navigation)) continue;
    const moved = moveCharacterTowards(
      intent.character,
      sideTarget,
      dt,
      [],
      intent.speed,
      2,
      state,
      navigation,
    );
    if (Math.hypot(moved.x - intent.start.x, moved.y - intent.start.y) <= 1e-6) continue;
    const endpoint = {
      ...moved,
      path: intent.character.path,
      localConflictTarget: worldToCell(sideTarget),
    };
    const candidate = resolvedIntent(
      intent,
      endpoint,
      buildTimeParameterizedTrajectory(intent.start, endpoint, intent.speed, dt),
    );
    const candidateResolutions = new Map(resolutions);
    candidateResolutions.set(intent.character.id, candidate);
    if (areIntentPairsSafeFor(component, intents, candidateResolutions)) return candidate;
  }
  return null;
}

function getEffectivePairSpacing(actor, peer, requiredSpacing) {
  const startingDistance = Math.hypot(
    actor.start.x - peer.start.x,
    actor.start.y - peer.start.y,
  );
  // Do not let accepted floating-point tolerance ratchet normal spacing down each tick.
  return startingDistance >= requiredSpacing - 1e-5
    ? requiredSpacing
    : startingDistance;
}

function isSafeIntentPair(actor, peer, requiredSpacing) {
  const startingDistance = Math.hypot(
    actor.start.x - peer.start.x,
    actor.start.y - peer.start.y,
  );
  if (startingDistance <= 1e-9) {
    return coincidentStartTrajectoriesSeparateSafely(actor.trajectory, peer.trajectory);
  }
  const effectiveSpacing = getEffectivePairSpacing(actor, peer, requiredSpacing);
  const minimumDistance = minimumTrajectoryDistance(actor.trajectory, peer.trajectory);
  return minimumDistance > 1e-9 && minimumDistance >= effectiveSpacing - 1e-6;
}

function normalEffectiveSpacing(left, right) {
  return Math.max(left.spacing, right.spacing);
}

function requiredSpacingForPair(left, right) {
  const selectedId = left.controlledOverlapId ?? right.controlledOverlapId;
  const componentIds = left.controlledOverlapComponentIds ?? right.controlledOverlapComponentIds;
  const sameRelaxedComponent = selectedId != null
    && (left.character.id === selectedId || right.character.id === selectedId)
    && componentIds?.has(left.character.id)
    && componentIds?.has(right.character.id);
  return sameRelaxedComponent ? 2 : normalEffectiveSpacing(left, right);
}

function cellsEqual(left, right) {
  return left.x === right.x && left.y === right.y;
}

function intentMoves(intent) {
  return Math.hypot(
    intent.desired.x - intent.start.x,
    intent.desired.y - intent.start.y,
  ) > 1e-6;
}

function desiredCellsConflict(left, right) {
  if (!intentMoves(left) && !intentMoves(right)) return false;
  const leftStart = worldToCell(left.start);
  const rightStart = worldToCell(right.start);
  const leftEnd = worldToCell(left.desired);
  const rightEnd = worldToCell(right.desired);
  return cellsEqual(leftEnd, rightEnd)
    || (cellsEqual(leftStart, rightEnd) && cellsEqual(leftEnd, rightStart)
      && (!cellsEqual(leftStart, leftEnd) || !cellsEqual(rightStart, rightEnd)));
}

function intentsConflict(left, right) {
  if (ignoresIntentPair(left, right.character.id) || ignoresIntentPair(right, left.character.id)) {
    return false;
  }
  return desiredCellsConflict(left, right)
    || !isSafeIntentPair(left, right, requiredSpacingForPair(left, right));
}

function buildConflictComponents(intents, metrics = null) {
  const neighbours = new Map(intents.map(intent => [intent.character.id, new Set()]));
  for (let leftIndex = 0; leftIndex < intents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < intents.length; rightIndex += 1) {
      const left = intents[leftIndex];
      const right = intents[rightIndex];
      if (metrics) metrics.pairChecks += 1;
      if (!intentsConflict(left, right)) continue;
      if (metrics) metrics.conflictPairs += 1;
      neighbours.get(left.character.id).add(right.character.id);
      neighbours.get(right.character.id).add(left.character.id);
    }
  }

  const intentsById = new Map(intents.map(intent => [intent.character.id, intent]));
  const visited = new Set();
  const components = [];
  for (const intent of intents) {
    if (visited.has(intent.character.id)) continue;
    const pending = [intent.character.id];
    const component = [];
    while (pending.length > 0) {
      const id = pending.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(intentsById.get(id));
      pending.push(...[...neighbours.get(id)]
        .filter(peerId => !visited.has(peerId))
        .sort((left, right) => String(left).localeCompare(String(right))));
    }
    components.push(component.sort((left, right) => String(left.character.id)
      .localeCompare(String(right.character.id))));
  }
  if (metrics) {
    metrics.components += components.length;
    if (components.some(component => component.length > 1)) metrics.conflictBatches += 1;
    metrics.maxComponentSize = Math.max(
      metrics.maxComponentSize,
      ...components.map(component => component.length),
    );
  }
  return components;
}

function solverRouteCells(intent) {
  const routeCells = [];
  if (intent.character.localConflictTarget) routeCells.push(intent.character.localConflictTarget);
  routeCells.push(...(intent.character.path || []));
  if (intent.targetAfterPath) routeCells.push(worldToCell(intent.targetAfterPath));
  if (intent.target) routeCells.push(worldToCell(intent.target));
  return routeCells.filter((cell, index) => index === 0 || !cellsEqual(cell, routeCells[index - 1]));
}

function hasUnscopedLegacyPath(intent) {
  return intent.character.path?.length
    && !intent.character.pathGoal
    && !intent.targetAfterPath;
}

function solverActorForIntent(intent) {
  const startCell = worldToCell(intent.start);
  const moving = intentMoves(intent);
  const unscopedLegacyPath = hasUnscopedLegacyPath(intent);
  const routeCells = unscopedLegacyPath
    ? [worldToCell(intent.desired)]
    : solverRouteCells(intent);
  const goalCell = moving
    ? (unscopedLegacyPath
      ? worldToCell(intent.desired)
      : intent.character.pathGoal
      || routeCells.at(-1)
      || worldToCell(intent.desired))
    : startCell;
  const leaving = intent.character.state === 'leaving' && intent.character.exitPhase !== 'fading';
  const entering = intent.character.state === 'guided' && intent.character.entryDoorId;
  const doorId = leaving
    ? intent.character.exitDoorId || null
    : entering ? intent.character.entryDoorId : null;
  const doorFlow = leaving ? 'out' : entering ? 'in' : null;
  return {
    id: intent.character.id,
    startCell,
    goalCell,
    routeCells: moving ? routeCells : [startCell],
    stalledFor: intent.character.stalledFor || 0,
    moving,
    doorId,
    doorFlow,
  };
}

function trajectoryPositionAt(trajectory, time) {
  const segment = trajectory.find(candidate => time >= candidate.startTime - 1e-9
    && time <= candidate.endTime + 1e-9) || trajectory.at(-1);
  return pointAtTrajectorySegment(segment, Math.min(segment.endTime, Math.max(segment.startTime, time)));
}

function trajectoryPrefix(trajectory, time) {
  if (time <= 0) return stationaryTrajectory(trajectory[0].start);
  if (time >= 1) return trajectory;
  const prefix = [];
  for (const segment of trajectory) {
    if (segment.startTime >= time) break;
    const endTime = Math.min(time, segment.endTime);
    prefix.push(trajectorySegment(
      segment.start,
      pointAtTrajectorySegment(segment, endTime),
      segment.startTime,
      endTime,
    ));
    if (segment.endTime >= time) break;
  }
  const endpoint = trajectoryPositionAt(trajectory, time);
  prefix.push(trajectorySegment(endpoint, endpoint, time, 1));
  return prefix;
}

function resolvedAtTrajectoryTime(intent, time) {
  if (time <= 0) return resolvedAtStart(intent);
  if (time >= 1) return resolvedAtDesired(intent);
  const position = trajectoryPositionAt(intent.trajectory, time);
  const consumedPath = intent.pathConsumedAt != null && time >= intent.pathConsumedAt - 1e-9;
  const endpoint = {
    ...intent.character,
    x: position.x,
    y: position.y,
    path: consumedPath ? intent.desired.path : intent.character.path,
  };
  return resolvedIntent(intent, endpoint, trajectoryPrefix(intent.trajectory, time));
}

function appendTimedSegment(trajectory, start, end, startSeconds, endSeconds, dt) {
  if (endSeconds < startSeconds || dt <= 0) return;
  trajectory.push(trajectorySegment(
    start,
    end,
    Math.min(1, startSeconds / dt),
    Math.min(1, endSeconds / dt),
  ));
}

function consumeReachedPathCell(intent, path, cell) {
  if (!path.length || !cellsEqual(path[0], cell)) return false;
  if (intent.target && intent.consumePath !== true) return false;
  path.shift();
  return true;
}

function resolutionFromSolverPlan(state, intent, rawPlan, component, dt, horizon = 8, goalCell = null, navigation = {}) {
  const startCell = worldToCell(intent.start);
  const plan = rawPlan?.length === horizon + 1 && cellsEqual(rawPlan[0], startCell)
    ? rawPlan.slice(1)
    : (rawPlan || []);
  const maxSpeed = Math.max(0, ...component.map(candidate => candidate.speed));
  const slotSeconds = maxSpeed > 0 ? GRID_SIZE / maxSpeed : Infinity;
  const budget = Math.max(0, intent.speed * dt);
  const trajectory = [];
  const path = [...(intent.character.path || [])];
  const pathConsumptionTimes = [];
  const plannedArrivals = [];
  let current = { ...intent.start };
  let travelled = 0;
  let nextPlanIndex = 0;
  let previousPlanCell = startCell;
  const desiredCell = worldToCell(intent.desired);
  const preserveCurrentIntent = hasUnscopedLegacyPath(intent);

  while (path.length > 0 && isAtTarget(current, cellToWorld(path[0]))
    && consumeReachedPathCell(intent, path, path[0])) {
    pathConsumptionTimes.push(0);
  }

  for (let index = 0; index < plan.length; index += 1) {
    const slotStart = index * slotSeconds;
    const slotEnd = slotStart + slotSeconds;
    const cellDelta = {
      x: plan[index].x - previousPlanCell.x,
      y: plan[index].y - previousPlanCell.y,
    };
    const reachesExactDesired = preserveCurrentIntent
      && goalCell
      && cellsEqual(plan[index], goalCell)
      && cellsEqual(goalCell, desiredCell);
    const reachesQueuedWaypoint = path.length > 0 && cellsEqual(plan[index], path[0]);
    const target = preserveCurrentIntent
      ? (reachesExactDesired
        ? positionOf(intent.desired)
        : (reachesQueuedWaypoint
          ? cellToWorld(plan[index])
          : {
            x: current.x + cellDelta.x * GRID_SIZE,
            y: current.y + cellDelta.y * GRID_SIZE,
          }))
      : cellToWorld(plan[index]);
    if (!cellsEqual(plan[index], previousPlanCell)) {
      plannedArrivals.push({ cell: plan[index], time: dt > 0 ? slotEnd / dt : Infinity });
    }
    if (slotStart >= dt - 1e-9 || travelled >= budget - 1e-9) break;

    if (cellsEqual(plan[index], previousPlanCell) || isAtTarget(current, target)) {
      if (isAtTarget(current, cellToWorld(plan[index]))
        && consumeReachedPathCell(intent, path, plan[index])) {
        pathConsumptionTimes.push(dt > 0 ? Math.min(1, slotStart / dt) : 0);
      }
      appendTimedSegment(trajectory, current, current, slotStart, Math.min(dt, slotEnd), dt);
      nextPlanIndex = index + 1;
      previousPlanCell = plan[index];
      continue;
    }

    const distance = Math.hypot(target.x - current.x, target.y - current.y);
    const availableSeconds = Math.max(0, Math.min(slotSeconds, dt - slotStart));
    const allowedDistance = Math.min(distance, budget - travelled, intent.speed * availableSeconds);
    if (allowedDistance <= 1e-9) break;
    const ratio = allowedDistance / distance;
    const requestedEndpoint = {
      x: current.x + (target.x - current.x) * ratio,
      y: current.y + (target.y - current.y) * ratio,
    };
    const endpoint = furthestWorldSegmentEndpoint(state, current, requestedEndpoint, navigation.workspace);
    const safeDistance = Math.hypot(endpoint.x - current.x, endpoint.y - current.y);
    if (safeDistance <= 1e-9) break;
    if (!isSafeSegment(state, current, endpoint, navigation)) break;
    const duration = intent.speed > 0 ? safeDistance / intent.speed : 0;
    appendTimedSegment(trajectory, current, endpoint, slotStart, slotStart + duration, dt);
    current = endpoint;
    travelled += safeDistance;

    if (safeDistance < distance - 1e-6) {
      nextPlanIndex = index;
      break;
    }
    nextPlanIndex = index + 1;
    previousPlanCell = plan[index];
    if (isAtTarget(current, cellToWorld(plan[index]))
      && consumeReachedPathCell(intent, path, plan[index])) {
      pathConsumptionTimes.push(Math.min(1, (slotStart + duration) / dt));
    }
    appendTimedSegment(trajectory, current, current, slotStart + duration, Math.min(dt, slotEnd), dt);
  }

  if (trajectory.length === 0) trajectory.push(...stationaryTrajectory(intent.start));
  else if (trajectory.at(-1).endTime < 1) {
    trajectory.push(trajectorySegment(current, current, trajectory.at(-1).endTime, 1));
  }

  let nextCell = plan[nextPlanIndex];
  while (nextCell && (cellsEqual(nextCell, previousPlanCell)
    || (!preserveCurrentIntent && isAtTarget(current, cellToWorld(nextCell))))) {
    nextPlanIndex += 1;
    nextCell = plan[nextPlanIndex];
  }
  const { localConflictTarget: _localConflictTarget, ...baseCharacter } = intent.character;
  const endpoint = {
    ...baseCharacter,
    x: current.x,
    y: current.y,
    path,
    ...(nextCell ? { localConflictTarget: { ...nextCell } } : {}),
  };
  return {
    ...resolvedIntent(intent, endpoint, trajectory),
    pathConsumptionTimes,
    plannedArrivals,
    fromLocalConflictPlan: true,
  };
}

function resolutionAtTime(intent, resolution, time) {
  if (time >= 1) return resolution;
  const boundedTime = Math.max(0, time);
  const position = trajectoryPositionAt(resolution.trajectory, boundedTime);
  const consumedCount = (resolution.pathConsumptionTimes || [])
    .filter(consumedAt => consumedAt <= boundedTime + 1e-9).length;
  const nextArrival = (resolution.plannedArrivals || [])
    .find(arrival => arrival.time > boundedTime + 1e-9
      && !isAtTarget(position, cellToWorld(arrival.cell)));
  const { localConflictTarget: _localConflictTarget, ...baseCharacter } = intent.character;
  const endpoint = {
    ...baseCharacter,
    x: position.x,
    y: position.y,
    path: (intent.character.path || []).slice(consumedCount),
    ...(nextArrival ? { localConflictTarget: { ...nextArrival.cell } } : {}),
  };
  return {
    ...resolution,
    endpoint,
    trajectory: trajectoryPrefix(resolution.trajectory, boundedTime),
  };
}

function isSafeResolvedPair(actor, peer, requiredSpacing) {
  return isSafeIntentPair(actor, peer, requiredSpacing);
}

function isResolutionSafeForIntent(intent, candidate, intents, resolutions) {
  return intents.every(peer => peer === intent
    || ignoresIntentPair(intent, peer.character.id)
    || ignoresIntentPair(peer, intent.character.id)
    || isSafeResolvedPair(
      candidate,
      resolutions.get(peer.character.id),
      requiredSpacingForPair(intent, peer),
    ));
}

function furthestSafeResolutionPrefix(intent, resolution, intents, resolutions, metrics = null) {
  if (isResolutionSafeForIntent(intent, resolution, intents, resolutions)) return resolution;
  let best = resolutionAtTime(intent, resolution, 0);
  let bestTime = 0;
  const samples = 256;
  for (let sample = 1; sample <= samples; sample += 1) {
    const time = sample / samples;
    const candidate = resolutionAtTime(intent, resolution, time);
    if (!isResolutionSafeForIntent(intent, candidate, intents, resolutions)) break;
    best = candidate;
    bestTime = time;
  }
  if (bestTime === 0) return best;
  let low = bestTime;
  let high = Math.min(1, low + 1 / samples);
  for (let iteration = 0; iteration < 40 && high - low > 1e-10; iteration += 1) {
    const middle = (low + high) / 2;
    const candidate = resolutionAtTime(intent, resolution, middle);
    if (metrics) metrics.safePrefixProbes += 1;
    if (isResolutionSafeForIntent(intent, candidate, intents, resolutions)) low = middle;
    else high = middle;
  }
  return resolutionAtTime(intent, resolution, low);
}

function furthestSafeTrajectoryPrefix(intent, intents, resolutions, metrics = null) {
  if (isResolutionSafeForIntent(intent, resolvedAtDesired(intent), intents, resolutions)) {
    return resolvedAtDesired(intent);
  }

  const boundaries = new Set([0, 1]);
  for (const segment of intent.trajectory) {
    boundaries.add(segment.startTime);
    boundaries.add(segment.endTime);
  }
  for (const peer of intents) {
    for (const segment of resolutions.get(peer.character.id).trajectory) {
      boundaries.add(segment.startTime);
      boundaries.add(segment.endTime);
    }
  }
  const times = [...boundaries].sort((left, right) => left - right);
  const samplesPerInterval = 128;
  let unsafeTime = 1;

  for (let intervalIndex = times.length - 2; intervalIndex >= 0; intervalIndex -= 1) {
    const start = times[intervalIndex];
    const end = times[intervalIndex + 1];
    for (let sample = samplesPerInterval; sample >= 0; sample -= 1) {
      const time = start + (end - start) * sample / samplesPerInterval;
      const candidate = resolvedAtTrajectoryTime(intent, time);
      if (!isResolutionSafeForIntent(intent, candidate, intents, resolutions)) {
        unsafeTime = time;
        continue;
      }

      let low = time;
      let high = unsafeTime;
      for (let iteration = 0; iteration < 40 && high - low > 1e-10; iteration += 1) {
        const middle = (low + high) / 2;
        const middleCandidate = resolvedAtTrajectoryTime(intent, middle);
        if (metrics) metrics.safePrefixProbes += 1;
        if (isResolutionSafeForIntent(intent, middleCandidate, intents, resolutions)) low = middle;
        else high = middle;
      }
      const safePrefix = resolvedAtTrajectoryTime(intent, low);
      if (Math.hypot(
        safePrefix.endpoint.x - intent.start.x,
        safePrefix.endpoint.y - intent.start.y,
      ) <= 1e-6) return resolvedAtStart(intent);
      return safePrefix;
    }
  }
  return resolvedAtStart(intent);
}


function areIntentPairsSafeFor(checkedIntents, intents, resolutions) {
  return checkedIntents.every(intent => isResolutionSafeForIntent(
    intent,
    resolutions.get(intent.character.id),
    intents,
    resolutions,
  ));
}

function resolveIntentPairs(state, intents, resolutions, dt, validationIntents = intents, metrics = null, navigation = {}) {
  for (const intent of intents) resolutions.set(intent.character.id, resolvedAtStart(intent));
  const yieldedHeadOnIds = new Set();

  for (let intentIndex = 0; intentIndex < intents.length; intentIndex += 1) {
    const intent = intents[intentIndex];
    if (yieldedHeadOnIds.has(intent.character.id)) continue;

    const headOnPeer = intents.find(peer => peer !== intent
      && String(intent.character.id) < String(peer.character.id)
      && hasExplicitHeadOnRecovery(intent)
      && isExplicitRecoveredHorizontalHeadOn(intent, peer));
    if (headOnPeer) {
      const detourResolutions = new Map(resolutions);
      for (let laterIndex = intentIndex + 1; laterIndex < intents.length; laterIndex += 1) {
        const later = intents[laterIndex];
        detourResolutions.set(later.character.id, resolvedAtDesired(later));
      }
      detourResolutions.set(intent.character.id, resolvedAtStart(intent));
      const detour = findSafeDetour(
        state,
        intent,
        Math.max(intent.spacing, headOnPeer.spacing),
        dt,
        validationIntents,
        detourResolutions,
        intents,
        navigation,
      );
      if (detour) {
        intent.acceptedRecoveredHeadOnDetour = true;
        intent.acceptedRecoveredHeadOnDetourEndpoint = positionOf(detour.endpoint);
        const detourTarget = detour.endpoint.path?.[0];
        if (detourTarget && !cellsEqual(detourTarget, intent.character.path?.[0])) {
          intent.acceptedRecoveredHeadOnDetourTarget = { ...detourTarget };
        }
        resolutions.set(intent.character.id, detour);
        yieldedHeadOnIds.add(headOnPeer.character.id);
      } else {
        resolutions.set(intent.character.id, measureMovementPhase(
          metrics,
          'safePrefixMilliseconds',
          () => furthestSafeTrajectoryPrefix(intent, validationIntents, resolutions, metrics),
        ));
      }
      continue;
    }

    if (isResolutionSafeForIntent(intent, resolvedAtDesired(intent), validationIntents, resolutions)) {
      resolutions.set(intent.character.id, resolvedAtDesired(intent));
      continue;
    }

    resolutions.set(intent.character.id, measureMovementPhase(
      metrics,
      'safePrefixMilliseconds',
      () => furthestSafeTrajectoryPrefix(intent, validationIntents, resolutions, metrics),
    ));
  }

  if (!areIntentPairsSafeFor(intents, validationIntents, resolutions)) {
    for (const intent of intents) resolutions.set(intent.character.id, resolvedAtStart(intent));
  }
}

function orderIntentsByMovementPriority(intents) {
  const intentsById = new Map(intents.map(intent => [intent.character.id, intent]));
  return orderActorsByMovementPriority(intents.map(solverActorForIntent))
    .map(actor => intentsById.get(actor.id));
}

function selectControlledOverlapActor(component) {
  const selected = orderIntentsByMovementPriority(component
    .filter(intent => {
      if ((intent.character.stalledFor || 0) < 2 || !intent.hasValidStaticRoute) return false;
      const entryDoorId = intent.character.state === 'guided'
        ? intent.character.entryDoorId
        : null;
      if (!entryDoorId) return true;
      return !component.some(peer => peer.character.state === 'leaving'
        && peer.character.exitPhase !== 'fading'
        && peer.character.exitDoorId === entryDoorId);
    }))[0];
  return selected ? selected.character.id : null;
}

function movementGoalForIntent(intent) {
  const goalCell = intent.character.pathGoal || intent.character.path?.at(-1);
  if (goalCell) return cellToWorld(goalCell);
  return intent.targetAfterPath || intent.target || null;
}

function hasMeasurableRouteProgress(intent, endpoint) {
  const beforeLength = intent.character.path?.length || 0;
  if ((endpoint.path?.length || 0) < beforeLength) return true;
  const goal = movementGoalForIntent(intent);
  if (!goal) return false;
  const beforeDistance = Math.hypot(intent.start.x - goal.x, intent.start.y - goal.y);
  const afterDistance = Math.hypot(endpoint.x - goal.x, endpoint.y - goal.y);
  return afterDistance < beforeDistance - 0.1;
}

function componentHasMeasurableRouteProgress(component, resolutions) {
  return component.some(intent => hasMeasurableRouteProgress(
    intent,
    resolutions.get(intent.character.id)?.endpoint || intent.character,
  ));
}

function copyComponentResolutions(component, source, target) {
  for (const intent of component) {
    target.set(intent.character.id, source.get(intent.character.id));
  }
}

function componentIsSafe(component, intents, resolutions) {
  return component.every(intent => isResolutionSafeForIntent(
    intent,
    resolutions.get(intent.character.id),
    intents,
    resolutions,
  ));
}

function resolveComponentWithExistingSafety(state, component, resolutions, dt, intents, metrics = null, navigation = {}) {
  const ordered = orderIntentsByMovementPriority(component);
  resolveIntentPairs(state, ordered, resolutions, dt, intents, metrics, navigation);
  if (!componentIsSafe(component, intents, resolutions)) {
    for (const intent of component) resolutions.set(intent.character.id, resolvedAtStart(intent));
  }
}

function resolveConflictComponentAttempt(
  state,
  component,
  resolutions,
  dt,
  intents,
  allowControlledOverlapId = null,
  metrics = null,
  navigation = {},
) {
  if (metrics) metrics.localConflictAttempts += 1;
  const isRecoveredStaffHeadOnPair = component.length === 2
    && component.every(intent => Boolean(intent.character.role))
    && isExplicitRecoveredHorizontalHeadOn(component[0], component[1]);
  if (isRecoveredStaffHeadOnPair) {
    measureLocalConflictFallbackPhase(metrics, () =>
      resolveComponentWithExistingSafety(state, component, resolutions, dt, intents, metrics, navigation));
    return;
  }

  const prepared = measureLocalConflictPhase(metrics, 'localConflictPreparationMilliseconds', () => {
    const desiredCellKeys = component.map(intent => {
      const cell = worldToCell(intent.desired);
      return `${cell.x},${cell.y}`;
    });
    const hasContestedDesiredCell = new Set(desiredCellKeys).size < desiredCellKeys.length;
    const actors = component.map(solverActorForIntent);
    const contestedRouteHorizon = Math.max(1, ...actors.map(actor => {
      let previous = actor.startCell;
      return actor.routeCells.reduce((slots, cell) => {
        const distance = Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y);
        previous = cell;
        return slots + distance;
      }, 0);
    }));
    const currentIntentHorizon = Math.max(1, ...component.map(intent => {
      const startCell = worldToCell(intent.start);
      const desiredCell = worldToCell(intent.desired);
      return Math.abs(desiredCell.x - startCell.x) + Math.abs(desiredCell.y - startCell.y);
    }));
    const maxSpeed = Math.max(0, ...component.map(intent => intent.speed));
    const executableSlots = Math.max(1, Math.ceil(dt * maxSpeed / GRID_SIZE));
    const horizon = 8;
    const hasUnscopedPath = component.some(hasUnscopedLegacyPath);
    const stalledAges = component.map(intent => intent.character.stalledFor || 0);
    const hasAgedPriority = Math.max(...stalledAges) > Math.min(...stalledAges);
    let progressHorizon = horizon;
    if (hasContestedDesiredCell && hasUnscopedPath) {
      progressHorizon = Math.min(horizon, currentIntentHorizon, executableSlots);
    } else if (hasContestedDesiredCell && hasAgedPriority) {
      progressHorizon = Math.min(horizon, contestedRouteHorizon, executableSlots);
    }
    const { workspace = null, metrics: navigationMetrics = null } = navigation;
    const blockedCells = resolveNavigationWorkspace(state, workspace, navigationMetrics).blockedCells;
    return { actors, blockedCells, horizon, progressHorizon };
  });
  const solved = solveLocalConflictWithMovementMetrics({
    state,
    ...prepared,
    maxHighLevelNodes: 128,
    allowControlledOverlapId,
  }, metrics);
  if (!solved) {
    measureLocalConflictFallbackPhase(metrics, () =>
      resolveComponentWithExistingSafety(state, component, resolutions, dt, intents, metrics, navigation));
    return;
  }
  const candidates = measureLocalConflictPhase(metrics, 'localConflictCandidateMilliseconds', () => {
    const actorsById = new Map(prepared.actors.map(actor => [actor.id, actor]));
    return new Map(component.map(intent => [
      intent.character.id,
      resolutionFromSolverPlan(
        state,
        intent,
        solved.plans.get(intent.character.id),
        component,
        dt,
        prepared.horizon,
        actorsById.get(intent.character.id).goalCell,
        navigation,
      ),
    ]));
  });
  const collective = new Map(resolutions);
  for (const [id, candidate] of candidates) collective.set(id, candidate);
  for (const intent of component.filter(candidate => candidate.character.state === 'leaving'
    && (candidate.target || candidate.targetAfterPath))) {
    collective.set(intent.character.id, resolvedAtStart(intent));
    const exactCandidate = measureMovementPhase(
      metrics,
      'safePrefixMilliseconds',
      () => furthestSafeTrajectoryPrefix(intent, intents, collective, metrics),
    );
    candidates.set(intent.character.id, exactCandidate);
    collective.set(intent.character.id, exactCandidate);
  }
  const safe = measureLocalConflictPhase(
    metrics,
    'localConflictSafetyMilliseconds',
    () => componentIsSafe(component, intents, collective),
  );
  if (safe) {
    for (const [id, candidate] of candidates) resolutions.set(id, candidate);
    return;
  }

  if (metrics) metrics.localConflictSafetyFallbacks += 1;
  measureLocalConflictFallbackPhase(metrics, () => {
    for (const intent of component) resolutions.set(intent.character.id, resolvedAtStart(intent));
    for (const intent of orderIntentsByMovementPriority(component)) {
      const candidate = measureMovementPhase(
        metrics,
        'safePrefixMilliseconds',
        () => furthestSafeResolutionPrefix(
          intent,
          candidates.get(intent.character.id),
          intents,
          resolutions,
          metrics,
        ),
      );
      resolutions.set(intent.character.id, candidate);
    }
    if (!componentIsSafe(component, intents, resolutions)) {
      for (const intent of component) resolutions.set(intent.character.id, resolvedAtStart(intent));
    }
  });
}

function resolveConflictComponent(state, component, resolutions, dt, intents, metrics = null, navigation = {}) {
  const exactExitIntents = component.filter(intent => intent.character.state === 'leaving'
    && (intent.target || intent.targetAfterPath));
  const isExactExitOnlyComponent = exactExitIntents.length > 0
    && component.every(intent => exactExitIntents.includes(intent) || intent.speed === 0);
  if (isExactExitOnlyComponent) {
    const exactResolutions = new Map(resolutions);
    const exactProgress = measureLocalConflictFallbackPhase(metrics, () => {
      resolveComponentWithExistingSafety(state, component, exactResolutions, dt, intents, metrics, navigation);
      const progressed = exactExitIntents.some(intent => hasMeasurableRouteProgress(
        intent,
        exactResolutions.get(intent.character.id)?.endpoint || intent.character,
      ));
      if (progressed) copyComponentResolutions(component, exactResolutions, resolutions);
      return progressed;
    });
    if (exactProgress) {
      return;
    }
  }

  const ordinaryResolutions = new Map(resolutions);
  resolveConflictComponentAttempt(state, component, ordinaryResolutions, dt, intents, null, metrics, navigation);
  if (componentHasMeasurableRouteProgress(component, ordinaryResolutions)) {
    if (metrics) metrics.localConflictProgressAccepts += 1;
    measureLocalConflictFallbackPhase(metrics, () =>
      copyComponentResolutions(component, ordinaryResolutions, resolutions));
    return;
  }

  const selectedId = measureLocalConflictFallbackPhase(metrics, () => {
    for (const intent of component) {
      const goal = intent.character.state === 'leaving' && intent.target
        ? null
        : movementGoalForIntent(intent);
      intent.hasValidStaticRoute = Boolean(goal
        && findPath(state, worldToCell(intent.character), worldToCell(goal)).length);
    }
    return selectControlledOverlapActor(component);
  });
  if (selectedId == null) {
    measureLocalConflictFallbackPhase(metrics, () =>
      copyComponentResolutions(component, ordinaryResolutions, resolutions));
    return;
  }

  measureLocalConflictFallbackPhase(metrics, () => {
    const componentIds = new Set(component.map(intent => intent.character.id));
    for (const intent of component) {
      intent.controlledOverlapId = selectedId;
      intent.controlledOverlapComponentIds = componentIds;
      intent.controlledOverlapSelected = intent.character.id === selectedId;
    }
  });
  const relaxedResolutions = new Map(resolutions);
  resolveConflictComponentAttempt(
    state,
    component,
    relaxedResolutions,
    dt,
    intents,
    selectedId,
    metrics,
    navigation,
  );
  measureLocalConflictFallbackPhase(metrics, () => {
    const selectedIntent = component.find(intent => intent.character.id === selectedId);
    if (!hasMeasurableRouteProgress(
      selectedIntent,
      relaxedResolutions.get(selectedId)?.endpoint || selectedIntent.character,
    )) {
      const detour = findControlledOverlapDetour(
        state,
        selectedIntent,
        dt,
        intents,
        relaxedResolutions,
        component,
        navigation,
      );
      if (detour) {
        selectedIntent.controlledOverlapDetour = true;
        relaxedResolutions.set(selectedId, detour);
      }
    }
    if (metrics && componentHasMeasurableRouteProgress(component, relaxedResolutions)) {
      metrics.localConflictProgressAccepts += 1;
    }
    copyComponentResolutions(component, relaxedResolutions, resolutions);
  });
}

function applyBatchRecovery(state, intent, endpoint, dt, intents, metrics = null, navigation = {}) {
  const character = intent.character;
  const moved = endpoint || resolvedAtStart(intent).endpoint;
  const displacement = Math.hypot(moved.x - intent.start.x, moved.y - intent.start.y);
  const recoveredHeadOnDetourTarget = intent.acceptedRecoveredHeadOnDetourTarget
    || character.recoveredHeadOnDetourTarget;
  const acceptedRecoveredHeadOnDetour = intent.acceptedRecoveredHeadOnDetour
    && intent.acceptedRecoveredHeadOnDetourEndpoint
    && isAtTarget(moved, intent.acceptedRecoveredHeadOnDetourEndpoint);
  const continuingRecoveredHeadOnDetour = recoveredHeadOnDetourTarget
    && character.path?.[0]
    && cellsEqual(recoveredHeadOnDetourTarget, character.path[0]);
  const recoveredHeadOnDetourWorld = recoveredHeadOnDetourTarget
    && cellToWorld(recoveredHeadOnDetourTarget);
  const continuingRecoveredHeadOnDetourProgress = continuingRecoveredHeadOnDetour
    && Math.hypot(
      moved.x - recoveredHeadOnDetourWorld.x,
      moved.y - recoveredHeadOnDetourWorld.y,
    ) < Math.hypot(
      intent.start.x - recoveredHeadOnDetourWorld.x,
      intent.start.y - recoveredHeadOnDetourWorld.y,
    ) - 0.1;
  const progress = hasMeasurableRouteProgress(intent, moved)
    || (acceptedRecoveredHeadOnDetour && displacement >= 0.1)
    || continuingRecoveredHeadOnDetourProgress;
  const targetReached = intent.target && isAtTarget(moved, intent.target);

  if (!character.path?.length && (!intent.target || targetReached)) {
    const { localConflictTarget: _localConflictTarget, ...withoutLocalTarget } = moved;
    return {
      ...withoutLocalTarget,
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
      headOnRecovery: false,
      pathGoal: undefined,
    };
  }

  if (progress) {
    const keepsRecoveredHeadOnDetour = recoveredHeadOnDetourTarget
      && moved.path?.[0]
      && cellsEqual(recoveredHeadOnDetourTarget, moved.path[0])
      && (acceptedRecoveredHeadOnDetour
        || continuingRecoveredHeadOnDetourProgress
        || displacement < 0.1);
    const { recoveredHeadOnDetourTarget: _completedHeadOnDetour, ...withoutCompletedHeadOnDetour } = moved;
    return {
      ...withoutCompletedHeadOnDetour,
      ...(keepsRecoveredHeadOnDetour
        ? { recoveredHeadOnDetourTarget: { ...recoveredHeadOnDetourTarget } }
        : {}),
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
      headOnRecovery: false,
    };
  }

  if (intent.controlledOverlapDetour) {
    return {
      ...moved,
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
      headOnRecovery: false,
    };
  }

  const stalledFor = (character.stalledFor || 0) + dt;
  const unrelatedRecoveredHeadOnDetourMovement = continuingRecoveredHeadOnDetour
    && displacement >= 0.1
    && !continuingRecoveredHeadOnDetourProgress;
  const { recoveredHeadOnDetourTarget: _interruptedHeadOnDetour, ...withoutInterruptedHeadOnDetour } = moved;
  let recovered = {
    ...(unrelatedRecoveredHeadOnDetourMovement ? withoutInterruptedHeadOnDetour : moved),
    stalledFor,
    minimumSpacing: 16,
    usingStaticFallback: intent.controlledOverlapSelected
      ? false
      : character.usingStaticFallback || false,
  };
  const pathGoal = character.pathGoal || character.path?.at(-1);
  if (stalledFor >= 0.75 && pathGoal) {
    const opposingHeadOn = intents.some(peer => peer !== intent
      && !ignoresIntentPair(intent, peer.character.id)
      && !ignoresIntentPair(peer, intent.character.id)
      && isHorizontalHeadOnGeometry(intent, peer));
    if (opposingHeadOn) {
      recovered = { ...recovered, headOnRecovery: true, pathGoal };
    } else {
      const others = intents
        .filter(peer => String(peer.character.id) !== String(character.id))
        .map(peer => peer.character);
      const occupiedCells = buildOccupiedCharacterCells(others, [character.id, ...(intent.ignoredIds || [])]);
      if (metrics) metrics.dynamicRepaths += 1;
      const dynamicPath = measureMovementPhase(
        metrics,
        'dynamicRepathMilliseconds',
        () => findPath(state, worldToCell(recovered), pathGoal, { ...navigation, occupiedCells }),
      );
      if (dynamicPath.length) {
        recovered = {
          ...recovered,
          path: dynamicPath,
          pathGoal,
        };
      }
    }
  }
  if (stalledFor >= 2 && pathGoal && !intent.controlledOverlapSelected) {
    if (metrics) metrics.staticRepaths += 1;
    const staticPath = measureMovementPhase(
      metrics,
      'staticRepathMilliseconds',
      () => findPath(state, worldToCell(recovered), pathGoal, navigation),
    );
    recovered = staticPath.length
      ? { ...recovered, path: staticPath, usingStaticFallback: true }
      : { ...recovered, usingStaticFallback: true };
  }
  return recovered;
}

function resolveCharacterMovementBatchInternal(state, entries, dt, metrics = null) {
  const startedAt = metrics ? movementNow() : 0;
  const phaseAtStart = metrics ? {
    pairBuildMilliseconds: metrics.pairBuildMilliseconds,
    localConflictMilliseconds: metrics.localConflictMilliseconds,
    safePrefixMilliseconds: metrics.safePrefixMilliseconds,
    dynamicRepathMilliseconds: metrics.dynamicRepathMilliseconds,
    staticRepathMilliseconds: metrics.staticRepathMilliseconds,
  } : null;
  const navigation = {
    workspace: state ? createNavigationWorkspace(state, metrics) : null,
    metrics,
  };
  if (metrics) metrics.batches += 1;
  const intents = entries
    .filter(entry => entry?.character?.id != null)
    .map(entry => buildMovementIntent(state, entry, dt, navigation))
    .sort((left, right) => String(left.character.id).localeCompare(String(right.character.id)));
  for (const intent of intents) {
    intent.movementDt = dt;
    intent.startResolution = resolvedIntent(intent, intent.character, stationaryTrajectory(intent.start));
    intent.desiredResolution = resolvedIntent(intent, intent.desired, intent.trajectory);
  }
  const resolutions = new Map(intents.map(intent => [intent.character.id, resolvedAtDesired(intent)]));
  const components = measureMovementPhase(
    metrics,
    'pairBuildMilliseconds',
    () => buildConflictComponents(intents, metrics),
  );
  for (const component of components) {
    if (component.length <= 1) continue;
    if (!metrics) {
      resolveConflictComponent(state, component, resolutions, dt, intents, metrics, navigation);
      continue;
    }
    const conflictStartedAt = movementNow();
    const safePrefixAtStart = metrics.safePrefixMilliseconds;
    const phasesAtStart = Object.fromEntries(localConflictPhaseKeys.map(key => [key, metrics[key]]));
    resolveConflictComponent(state, component, resolutions, dt, intents, metrics, navigation);
    const nestedSafePrefix = metrics.safePrefixMilliseconds - safePrefixAtStart;
    const localConflictElapsed = Math.max(
      0,
      movementNow() - conflictStartedAt - nestedSafePrefix,
    );
    metrics.localConflictMilliseconds += localConflictElapsed;
    const measured = localConflictPhaseKeys.reduce((total, key) =>
      total + metrics[key] - phasesAtStart[key], 0);
    metrics.localConflictResidualMilliseconds += Math.max(0, localConflictElapsed - measured);
  }
  const moved = new Map(intents.map(intent => [
    intent.character.id,
    applyBatchRecovery(
      state, intent, resolutions.get(intent.character.id)?.endpoint, dt, intents, metrics,
      navigation,
    ),
  ]));
  if (metrics) {
    const elapsed = movementNow() - startedAt;
    const measured = Object.keys(phaseAtStart).reduce((total, key) =>
      total + metrics[key] - phaseAtStart[key], 0);
    metrics.residualBatchMilliseconds += Math.max(0, elapsed - measured);
    metrics.batchMilliseconds += elapsed;
  }
  return {
    moved,
    trajectories: new Map(intents.map(intent => [
      intent.character.id,
      resolutions.get(intent.character.id)?.trajectory || stationaryTrajectory(intent.start),
    ])),
  };
}

export function resolveCharacterMovementBatch(state, entries, dt, metrics = null) {
  return resolveCharacterMovementBatchInternal(state, entries, dt, metrics).moved;
}

export function resolveCharacterMovementBatchWithDiagnostics(state, entries, dt, metrics = null) {
  return resolveCharacterMovementBatchInternal(state, entries, dt, metrics);
}
