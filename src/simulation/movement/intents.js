import {
  cellToWorld,
  furthestWorldSegmentEndpoint,
  isSafeSegment,
  worldToCell,
} from './navigationWorkspace';
import { moveCharacterAlongPath, moveCharacterTowards } from './pathMotion';
import {
  appendTimedSegment,
  buildDirectTrajectory,
  buildPathTrajectory,
  positionOf,
  stationaryTrajectory,
  trajectorySegment,
} from './trajectory';
import { GRID_SIZE } from '../world';

function getMovementSpacing(character) {
  return 16;
}

export function isAtTarget(position, target) {
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

export function buildMovementIntent(state, entry, dt, navigation = {}) {
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
    const trajectory = buildDirectTrajectory(character, moved, speed, dt);
    return {
      ...normalisedEntry,
      start,
      desired,
      spacing,
      trajectory,
      pathConsumedAt: (desired.path?.length || 0) < (character.path?.length || 0)
        ? trajectory[0].endTime
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

export function resolvedIntent(intent, endpoint, trajectory) {
  return { ...intent, endpoint, trajectory };
}

export function resolvedAtStart(intent) {
  return intent.startResolution;
}

export function resolvedAtDesired(intent) {
  return intent.desiredResolution;
}

export function cellsEqual(left, right) {
  return left.x === right.x && left.y === right.y;
}

export function intentMoves(intent) {
  return Math.hypot(
    intent.desired.x - intent.start.x,
    intent.desired.y - intent.start.y,
  ) > 1e-6;
}

function solverRouteCells(intent) {
  const routeCells = [];
  if (intent.character.localConflictTarget) routeCells.push(intent.character.localConflictTarget);
  routeCells.push(...(intent.character.path || []));
  if (intent.targetAfterPath) routeCells.push(worldToCell(intent.targetAfterPath));
  if (intent.target) routeCells.push(worldToCell(intent.target));
  return routeCells.filter((cell, index) => index === 0 || !cellsEqual(cell, routeCells[index - 1]));
}

export function hasUnscopedLegacyPath(intent) {
  return intent.character.path?.length
    && !intent.character.pathGoal
    && !intent.targetAfterPath;
}

export function solverActorForIntent(intent) {
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

function consumeReachedPathCell(intent, path, cell) {
  if (!path.length || !cellsEqual(path[0], cell)) return false;
  if (intent.target && intent.consumePath !== true) return false;
  path.shift();
  return true;
}

export function resolutionFromSolverPlan(state, intent, rawPlan, component, dt, horizon = 8, goalCell = null, navigation = {}) {
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

export function movementGoalForIntent(intent) {
  const goalCell = intent.character.pathGoal || intent.character.path?.at(-1);
  if (goalCell) return cellToWorld(goalCell);
  return intent.targetAfterPath || intent.target || null;
}

export function hasMeasurableRouteProgress(intent, endpoint) {
  const beforeLength = intent.character.path?.length || 0;
  if ((endpoint.path?.length || 0) < beforeLength) return true;
  const goal = movementGoalForIntent(intent);
  if (!goal) return false;
  const beforeDistance = Math.hypot(intent.start.x - goal.x, intent.start.y - goal.y);
  const afterDistance = Math.hypot(endpoint.x - goal.x, endpoint.y - goal.y);
  return afterDistance < beforeDistance - 0.1;
}
