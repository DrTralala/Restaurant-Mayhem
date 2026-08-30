import { buildBlockedCells, buildOccupiedCharacterCells, cellToWorld, findPath, findPathWithDynamicFallback, isInsideWorld, worldToCell } from './pathfinding';
import { getDefaultStaffPosition } from './world';

const ROLE_SPEED = { waiter: 75, cook: 55 };

export function ensureStaffRuntime(staff, state) {
  return (staff || []).map((s, index) => {
    const hasCoord = Number.isFinite(s.x) && Number.isFinite(s.y);
    const pos = hasCoord ? { x: s.x, y: s.y } : getDefaultStaffPosition(s.role, index, state, s.id);
    return { ...s, x: pos.x, y: pos.y, path: s.path || [], task: s.task || null };
  });
}

export function moveStaffAlongPath(staff, dt, others = []) {
  return moveCharacterAlongPath(staff, dt, others, ROLE_SPEED[staff.role] || 60);
}

export function minimumSweptDistance(startA, endA, startB, endB) {
  const relativeStart = { x: startA.x - startB.x, y: startA.y - startB.y };
  const relativeVelocity = {
    x: (endA.x - startA.x) - (endB.x - startB.x),
    y: (endA.y - startA.y) - (endB.y - startB.y),
  };
  const divisor = relativeVelocity.x ** 2 + relativeVelocity.y ** 2;
  const time = divisor === 0 ? 0 : Math.min(1, Math.max(0,
    -(relativeStart.x * relativeVelocity.x + relativeStart.y * relativeVelocity.y) / divisor,
  ));
  return Math.hypot(
    relativeStart.x + relativeVelocity.x * time,
    relativeStart.y + relativeVelocity.y * time,
  );
}

function isSafeSegment(state, start, end) {
  if (!state) return true;
  const blocked = buildBlockedCells(state);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / 2));
  const startKey = `${worldToCell(start).x},${worldToCell(start).y}`;
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    const point = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    const key = `${worldToCell(point).x},${worldToCell(point).y}`;
    if (key !== startKey && blocked.has(key)) return false;
  }
  return true;
}

export function moveCharacterAlongPath(character, dt, others = [], speed = 60, minimumSpacing = 16, state = null) {
  if (!character.path || character.path.length === 0) return character;
  const target = cellToWorld(character.path[0]);
  if (!isSafeSegment(state, character, target)) return character;
  const distance = Math.hypot(target.x - character.x, target.y - character.y);
  const budget = Math.max(0, speed * dt);
  if (distance <= 1 && distance <= budget + 1e-6) {
    return { ...character, x: target.x, y: target.y, path: character.path.slice(1) };
  }
  if (distance <= budget + 1e-6) {
    const moved = moveCharacterTowards(character, target, dt, others, speed, minimumSpacing, state);
    return moved.x === target.x && moved.y === target.y
      ? { ...moved, path: character.path.slice(1) }
      : moved;
  }
  const moved = moveCharacterTowards(character, target, dt, others, speed, minimumSpacing, state);
  if (moved === character) return character;
  if (Math.hypot(target.x - moved.x, target.y - moved.y) <= 0.001) {
    return { ...moved, path: character.path.slice(1) };
  }
  return moved;
}

export function planCharacterPath(state, character, goal, others = [], ignoredIds = []) {
  const goalCell = goal?.cell ? goal.cell : worldToCell(goal?.world || goal);
  const occupiedCells = buildOccupiedCharacterCells(others, [character.id, ...ignoredIds]);
  const result = findPathWithDynamicFallback(state, worldToCell(character), goalCell, { occupiedCells });
  // recovery metadata is attached at planning time so stalled movement can revisit the same goal
  return {
    ...character,
    path: result.path,
    pathGoal: goalCell,
    usingStaticFallback: result.usedStaticFallback,
    stalledFor: 0,
    minimumSpacing: 16,
  };
}

function constrainCrossingMovement(state, character, moved, peer, minimumSpacing, budget) {
  const dx = moved.x - character.x;
  const dy = moved.y - character.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return character;
  const blocked = buildBlockedCells(state);
  const epsilon = 1e-6;
  const start = { x: character.x, y: character.y };
  const ordinaryEndpoint = { x: moved.x, y: moved.y };
  const direction = { x: ordinaryEndpoint.x - start.x, y: ordinaryEndpoint.y - start.y };
  const directionLength = Math.hypot(direction.x, direction.y);
  const startProjection = (start.x - peer.x) * direction.x + (start.y - peer.y) * direction.y;
  const legal = candidate => {
    if (Math.hypot(candidate.x - character.x, candidate.y - character.y) > budget + epsilon) return false;
    const cell = worldToCell(candidate);
    const candidateProjection = (candidate.x - peer.x) * direction.x + (candidate.y - peer.y) * direction.y;
    const sameSide = String(character.id) <= String(peer.id)
      || Math.abs(startProjection) <= epsilon || Math.abs(candidateProjection) <= epsilon
      || startProjection * candidateProjection >= -epsilon;
    return sameSide && isSafeSegment(state, character, candidate) && !blocked.has(`${cell.x},${cell.y}`)
      && Math.hypot(candidate.x - peer.x, candidate.y - peer.y) >= minimumSpacing - epsilon;
  };
  const breakpoints = [0, 1];
  const fromPeer = { x: start.x - peer.x, y: start.y - peer.y };
  const a = dx * dx + dy * dy;
  const b = 2 * (fromPeer.x * dx + fromPeer.y * dy);
  const c = fromPeer.x * fromPeer.x + fromPeer.y * fromPeer.y - minimumSpacing ** 2;
  const discriminant = b * b - 4 * a * c;
  if (a > 0 && discriminant >= 0) {
    breakpoints.push((-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a));
  }
  for (const coordinate of ['x', 'y']) {
    const delta = ordinaryEndpoint[coordinate] - start[coordinate];
    if (Math.abs(delta) > epsilon) {
      const first = Math.floor(start[coordinate] / 20) + (delta > 0 ? 1 : 0);
      const last = Math.floor(ordinaryEndpoint[coordinate] / 20) + (delta > 0 ? 0 : 1);
      for (let boundary = first; delta > 0 ? boundary <= last : boundary >= last; boundary += delta > 0 ? 1 : -1) {
        breakpoints.push((boundary * 20 - start[coordinate]) / delta);
      }
    }
  }
  const points = [...new Set(breakpoints.filter(point => point >= 0 && point <= 1))].sort((left, right) => right - left);
  for (const point of points) {
    for (const candidateT of [point, point - epsilon, point + epsilon]) {
      if (candidateT < 0 || candidateT > 1) continue;
      const candidate = { x: start.x + dx * candidateT, y: start.y + dy * candidateT };
      if (legal(candidate)) return { ...moved, x: candidate.x, y: candidate.y };
    }
  }
  return character;
}

export function moveCharacterWithRecovery(state, character, dt, others = [], speed = 60, ignoredIds = []) {
  if (!character.path?.length) {
    return { ...character, stalledFor: 0, minimumSpacing: 16, usingStaticFallback: false, pathGoal: undefined };
  }
  const before = { x: character.x, y: character.y };
  const pathGoal = character.pathGoal || character.path.at(-1);
  const beforeLength = character.path.length;
  const spacing = character.usingStaticFallback || (character.stalledFor || 0) >= 2 ? 6 : 16;
  const ignored = new Set(ignoredIds);
  const target = cellToWorld(character.path[0]);
  const direction = { x: target.x - character.x, y: target.y - character.y };
  const directionLength = Math.hypot(direction.x, direction.y) || 1;
  const projectedOncoming = others.filter(other => other?.id !== character.id && !ignored.has(other.id)
    && Number.isFinite(other.x) && Number.isFinite(other.y) && other.path?.length
    && Math.hypot(other.x - character.x, other.y - character.y) < 40
    && ((other.x - character.x) * direction.x + (other.y - character.y) * direction.y) > 0
    && ((cellToWorld(other.path[0]).x - other.x) * direction.x
      + (cellToWorld(other.path[0]).y - other.y) * direction.y) < 0
    && Math.abs((other.x - character.x) * direction.y - (other.y - character.y) * direction.x) / directionLength < spacing);
  const lowerOncoming = projectedOncoming.find(other => String(other.id) < String(character.id));
  const higherOncoming = projectedOncoming.find(other => String(other.id) > String(character.id));
  const collisionOthers = others.filter(other => !ignored.has(other?.id));
  const crossingPeer = (character.stalledFor || 0) >= 2 && spacing === 6
    && projectedOncoming.find(other => Math.hypot(other.x - character.x, other.y - character.y) <= 16 + 1e-6);
  const movementOthers = crossingPeer
    ? collisionOthers.filter(other => other.id !== crossingPeer.id)
    : collisionOthers;
  const movementSpacing = spacing === 16 && higherOncoming ? 6 : spacing;
  const ordinaryMoved = moveCharacterAlongPath(character, dt, movementOthers, speed, movementSpacing);
  let moved = lowerOncoming && spacing === 16 ? character : ordinaryMoved;
  if (!crossingPeer && !isSafeSegment(state, character, ordinaryMoved)) moved = character;
  if (lowerOncoming && spacing === 6
    && (moved === character || Math.hypot(moved.x - character.x, moved.y - character.y) < speed * dt - 1e-6)) {
    const retreatLength = Math.min(speed * dt, directionLength);
    const retreat = {
      x: character.x - direction.x * retreatLength,
      y: character.y - direction.y * retreatLength,
    };
    const blocked = buildBlockedCells(state);
    const cell = worldToCell(retreat);
    if (!blocked.has(`${cell.x},${cell.y}`)
      && Math.hypot(retreat.x - lowerOncoming.x, retreat.y - lowerOncoming.y) >= spacing - 1e-6) {
      moved = { ...character, ...retreat };
    }
  }
  if (crossingPeer) {
    const controlledSpacing = String(character.id) < String(crossingPeer.id) ? 2 : 6;
    moved = constrainCrossingMovement(state, character, ordinaryMoved, crossingPeer, controlledSpacing, speed * dt);
    if (moved !== character) {
      moved.path = Math.hypot(target.x - moved.x, target.y - moved.y) <= 0.001
        ? character.path.slice(1)
        : character.path;
    }
  }
  if (!isSafeSegment(state, character, moved)) moved = character;
  const progress = Math.hypot(moved.x - before.x, moved.y - before.y) >= 0.1 || moved.path.length < beforeLength;
  const stalledFor = (character.stalledFor || 0) + dt;
  if (progress) {
    return { ...moved, stalledFor: 0, minimumSpacing: 16, usingStaticFallback: false };
  }
  let recovered = { ...moved, stalledFor, minimumSpacing: spacing };
  if (stalledFor >= 0.75 && pathGoal) {
    const replanned = planCharacterPath(state, recovered, { cell: pathGoal }, others, ignoredIds);
    recovered = { ...replanned, stalledFor };
  }
  if (stalledFor >= 2 && pathGoal) {
    const staticPath = findPath(state, worldToCell(recovered), pathGoal);
    recovered = { ...recovered, path: staticPath, usingStaticFallback: true, minimumSpacing: 6 };
  }
  return recovered;
}

export function moveCharacterTowards(character, target, dt, others = [], speed = 60, minimumSpacing = 16, state = null) {
  const dx = target.x - character.x;
  const dy = target.y - character.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return character;
  const direction = { x: dx / distance, y: dy / distance };
  let step = Math.min(speed * dt, distance);

  for (const other of others) {
    if (!other || other.id === character.id || !Number.isFinite(other.x) || !Number.isFinite(other.y)) continue;
    const relative = { x: other.x - character.x, y: other.y - character.y };
    const along = relative.x * direction.x + relative.y * direction.y;
    if (along <= 0 || along > step + minimumSpacing) continue;
    const perpendicularSquared = Math.max(0, relative.x ** 2 + relative.y ** 2 - along ** 2);
    if (perpendicularSquared >= minimumSpacing ** 2) continue;
    const safeStep = along - Math.sqrt(minimumSpacing ** 2 - perpendicularSquared);
    step = Math.min(step, Math.max(0, safeStep));
  }

  if (step <= 0) return character;
  const endpoint = distance <= step
    ? target
    : { x: character.x + direction.x * step, y: character.y + direction.y * step };
  return isSafeSegment(state, character, endpoint) ? { ...character, ...endpoint } : character;
}

function getMovementSpacing(character) {
  return character.usingStaticFallback || (character.stalledFor || 0) >= 2 ? 6 : 16;
}

function isAtTarget(position, target) {
  return Math.hypot(position.x - target.x, position.y - target.y) <= 0.001;
}

function isQueuedTarget(character, target) {
  if (!character.path?.length) return false;
  const queuedTarget = cellToWorld(character.path[0]);
  return isAtTarget(queuedTarget, target);
}

function positionOf(character) {
  return { x: character.x, y: character.y };
}

function trajectorySegment(start, end, startTime, endTime) {
  return {
    start: { ...start },
    end: { ...end },
    startTime,
    endTime,
  };
}

function stationaryTrajectory(position) {
  return [trajectorySegment(position, position, 0, 1)];
}

export function buildTimeParameterizedTrajectory(character, moved, speed, dt) {
  const start = positionOf(character);
  const end = positionOf(moved);
  const displacement = Math.hypot(end.x - start.x, end.y - start.y);
  if (displacement <= 1e-9) return stationaryTrajectory(start);
  const duration = speed * dt > 0
    ? Math.min(1, displacement / (speed * dt))
    : 1;
  const trajectory = [trajectorySegment(start, end, 0, duration)];
  if (duration < 1) trajectory.push(trajectorySegment(end, end, duration, 1));
  return trajectory;
}

function buildDirectTrajectory(character, moved, speed, dt) {
  return buildTimeParameterizedTrajectory(character, moved, speed, dt);
}

function buildPathTrajectory(character, pathMoved, finalMoved, speed, dt, beforeLength, continued) {
  const start = positionOf(character);
  const pathEnd = positionOf(pathMoved);
  if (beforeLength === 0 || pathMoved.path?.length === beforeLength) {
    return buildTimeParameterizedTrajectory(start, pathEnd, speed, dt);
  }

  const pathDisplacement = Math.hypot(pathEnd.x - start.x, pathEnd.y - start.y);
  const firstDuration = speed > 0 && dt > 0
    ? Math.min(1, pathDisplacement / (speed * dt))
    : 0;
  const trajectory = [trajectorySegment(start, pathEnd, 0, firstDuration)];
  if (continued) {
    const finalPosition = positionOf(finalMoved);
    const continuationDisplacement = Math.hypot(
      finalPosition.x - pathEnd.x,
      finalPosition.y - pathEnd.y,
    );
    const continuationDuration = speed > 0 && dt > 0
      ? Math.min(1 - firstDuration, continuationDisplacement / (speed * dt))
      : 0;
    trajectory.push(trajectorySegment(
      pathEnd,
      finalPosition,
      firstDuration,
      firstDuration + continuationDuration,
    ));
    if (firstDuration + continuationDuration < 1) {
      trajectory.push(trajectorySegment(finalPosition, finalPosition, firstDuration + continuationDuration, 1));
    }
    return trajectory;
  }

  if (firstDuration < 1) trajectory.push(trajectorySegment(pathEnd, pathEnd, firstDuration, 1));
  return trajectory;
}

/**
 * `targetAfterPath` is an optional exact-world target for an entry whose final
 * queued waypoint is consumed during this update. The continuation uses only
 * the remaining movement budget and still passes static validation. Its
 * piecewise trajectory is retained for swept dynamic collision resolution.
 */
function moveAlongPathWithContinuation(state, entry, dt, spacing) {
  const { character, speed } = entry;
  const beforeLength = character.path?.length || 0;
  const pathMoved = moveCharacterAlongPath(character, dt, [], speed, spacing, state);
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
  );
  return {
    moved: continued,
    trajectory: buildPathTrajectory(character, pathMoved, continued, speed, dt, beforeLength, true),
    pathConsumedAt,
  };
}

function pointAtTrajectorySegment(segment, time) {
  const duration = segment.endTime - segment.startTime;
  if (duration <= 0) return segment.end;
  const ratio = (time - segment.startTime) / duration;
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
  };
}

export function minimumTrajectoryDistance(leftTrajectory, rightTrajectory) {
  let minimum = Infinity;
  for (const leftSegment of leftTrajectory) {
    for (const rightSegment of rightTrajectory) {
      const startTime = Math.max(leftSegment.startTime, rightSegment.startTime);
      const endTime = Math.min(leftSegment.endTime, rightSegment.endTime);
      if (endTime < startTime) continue;
      const leftStart = pointAtTrajectorySegment(leftSegment, startTime);
      const leftEnd = pointAtTrajectorySegment(leftSegment, endTime);
      const rightStart = pointAtTrajectorySegment(rightSegment, startTime);
      const rightEnd = pointAtTrajectorySegment(rightSegment, endTime);
      minimum = Math.min(minimum, minimumSweptDistance(leftStart, leftEnd, rightStart, rightEnd));
    }
  }
  return minimum;
}

function buildMovementIntent(state, entry, dt) {
  const { character, speed } = entry;
  const spacing = getMovementSpacing(character);
  const start = { x: character.x, y: character.y };
  let desired;

  if (entry.target) {
    const moved = moveCharacterTowards(character, entry.target, dt, [], speed, spacing, state);
    desired = moved;
    if (entry.consumePath === true && isAtTarget(moved, entry.target) && isQueuedTarget(character, entry.target)) {
      desired = { ...moved, path: character.path.slice(1) };
    } else if (character.path) {
      desired = { ...moved, path: character.path };
    }
    return {
      ...entry,
      start,
      desired,
      spacing,
      trajectory: buildDirectTrajectory(character, moved, speed, dt),
      pathConsumedAt: (desired.path?.length || 0) < (character.path?.length || 0)
        ? buildDirectTrajectory(character, moved, speed, dt)[0].endTime
        : null,
    };
  } else {
    const moved = moveAlongPathWithContinuation(state, entry, dt, spacing);
    desired = moved.moved;
    return {
      ...entry,
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

function findSafeDetour(state, intent, spacing, dt, intents, resolutions) {
  for (const y of [intent.start.y - 40, intent.start.y + 40]) {
    const sideTarget = { x: intent.start.x, y };
    if (!isInsideWorld(state, worldToCell(sideTarget))
      || !isSafeSegment(state, intent.start, sideTarget)) continue;
    let endpoint = moveCharacterTowards(intent.character, sideTarget, dt, [],
      intent.speed, spacing, state);
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
    if (!isSafeSegment(state, intent.start, endpoint)) continue;
    const candidateResolutions = new Map(resolutions);
    candidateResolutions.set(intent.character.id, candidate);
    if (areIntentPairsSafe(intents, candidateResolutions)) {
      return candidate;
    }
  }
  return null;
}

function isSafeIntentPair(actor, peer, spacing) {
  return minimumTrajectoryDistance(actor.trajectory, peer.trajectory) >= spacing - 1e-6;
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

function isResolutionSafeForIntent(intent, candidate, intents, resolutions) {
  return intents.every(peer => peer === intent
    || ignoresIntentPair(intent, peer.character.id)
    || ignoresIntentPair(peer, intent.character.id)
    || isSafeIntentPair(
      candidate,
      resolutions.get(peer.character.id),
      Math.max(intent.spacing, peer.spacing),
    ));
}

function furthestSafeTrajectoryPrefix(intent, intents, resolutions) {
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
        if (isResolutionSafeForIntent(intent, middleCandidate, intents, resolutions)) low = middle;
        else high = middle;
      }
      return resolvedAtTrajectoryTime(intent, low);
    }
  }
  return resolvedAtStart(intent);
}


function areIntentPairsSafe(intents, resolutions) {
  for (let leftIndex = 0; leftIndex < intents.length; leftIndex += 1) {
    const left = intents[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < intents.length; rightIndex += 1) {
      const right = intents[rightIndex];
      if (ignoresIntentPair(left, right.character.id) || ignoresIntentPair(right, left.character.id)) continue;
      const spacing = Math.max(left.spacing, right.spacing);
      if (!isSafeIntentPair(
        resolutions.get(left.character.id),
        resolutions.get(right.character.id),
        spacing,
      )) {
        return false;
      }
    }
  }
  return true;
}

function resolveIntentPairs(state, intents, resolutions, dt) {
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
        intents,
        detourResolutions,
      );
      if (detour) {
        resolutions.set(intent.character.id, detour);
        yieldedHeadOnIds.add(headOnPeer.character.id);
      } else {
        resolutions.set(intent.character.id, furthestSafeTrajectoryPrefix(intent, intents, resolutions));
      }
      continue;
    }

    if (isResolutionSafeForIntent(intent, resolvedAtDesired(intent), intents, resolutions)) {
      resolutions.set(intent.character.id, resolvedAtDesired(intent));
      continue;
    }

    resolutions.set(intent.character.id, furthestSafeTrajectoryPrefix(intent, intents, resolutions));
  }

  if (!areIntentPairsSafe(intents, resolutions)) {
    for (const intent of intents) resolutions.set(intent.character.id, resolvedAtStart(intent));
  }
}

function applyBatchRecovery(state, intent, endpoint, dt, intents) {
  const character = intent.character;
  const moved = endpoint || resolvedAtStart(intent).endpoint;
  const beforeLength = character.path?.length || 0;
  const displacement = Math.hypot(moved.x - intent.start.x, moved.y - intent.start.y);
  const consumedWaypoint = (moved.path?.length || 0) < beforeLength;
  const progress = displacement >= 0.1 || consumedWaypoint;
  const targetReached = intent.target && isAtTarget(moved, intent.target);

  if (!character.path?.length && (!intent.target || targetReached)) {
    return {
      ...moved,
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
      headOnRecovery: false,
      pathGoal: undefined,
    };
  }

  if (progress) {
    return {
      ...moved,
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
      headOnRecovery: false,
    };
  }

  const stalledFor = (character.stalledFor || 0) + dt;
  let recovered = {
    ...moved,
    stalledFor,
    minimumSpacing: character.usingStaticFallback || stalledFor >= 2 ? 6 : 16,
    usingStaticFallback: character.usingStaticFallback || false,
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
      const dynamicPath = findPath(state, worldToCell(recovered), pathGoal, { occupiedCells });
      if (dynamicPath.length) {
        recovered = {
          ...recovered,
          path: dynamicPath,
          pathGoal,
        };
      }
    }
  }
  if (stalledFor >= 2 && pathGoal) {
    const staticPath = findPath(state, worldToCell(recovered), pathGoal);
    recovered = staticPath.length
      ? { ...recovered, path: staticPath, usingStaticFallback: true, minimumSpacing: 6 }
      : { ...recovered, usingStaticFallback: true, minimumSpacing: 6 };
  }
  return recovered;
}

export function resolveCharacterMovementBatch(state, entries, dt) {
  const intents = entries
    .filter(entry => entry?.character?.id != null)
    .map(entry => buildMovementIntent(state, entry, dt))
    .sort((left, right) => String(left.character.id).localeCompare(String(right.character.id)));
  for (const intent of intents) {
    intent.startResolution = resolvedIntent(intent, intent.character, stationaryTrajectory(intent.start));
    intent.desiredResolution = resolvedIntent(intent, intent.desired, intent.trajectory);
  }
  const resolutions = new Map(intents.map(intent => [intent.character.id, resolvedAtDesired(intent)]));
  resolveIntentPairs(state, intents, resolutions, dt);
  return new Map(intents.map(intent => [
    intent.character.id,
    applyBatchRecovery(state, intent, resolutions.get(intent.character.id)?.endpoint, dt, intents),
  ]));
}

export function hasArrived(staff) {
  return !staff || !staff.path || staff.path.length === 0;
}
