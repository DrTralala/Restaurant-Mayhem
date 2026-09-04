import { cellToWorld, worldToCell } from './navigationWorkspace';
import {
  coincidentStartTrajectoriesSeparateSafely,
  minimumTrajectoryDistance,
  trajectoryPositionAt,
  trajectoryPrefix,
} from './trajectory';
import {
  cellsEqual,
  intentMoves,
  isAtTarget,
  resolvedAtDesired,
  resolvedAtStart,
  resolvedIntent,
} from './intents';

export function ignoresIntentPair(intent, peerId) {
  return (intent.ignoredIds || []).some(id => String(id) === String(peerId));
}

export function isHorizontalHeadOnGeometry(intent, peer) {
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

export function hasExplicitHeadOnRecovery(intent) {
  return intent.headOnDetourEligible === true
    && (intent.character.headOnRecovery === true
      || (intent.character.usingStaticFallback && (intent.character.stalledFor || 0) >= 2));
}

export function isExplicitRecoveredHorizontalHeadOn(intent, peer) {
  const priority = String(intent.character.id) < String(peer.character.id) ? intent : peer;
  return hasExplicitHeadOnRecovery(priority)
    && isHorizontalHeadOnGeometry(intent, peer);
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

export function isSafeIntentPair(actor, peer, requiredSpacing) {
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

export function requiredSpacingForPair(left, right) {
  const selectedId = left.controlledOverlapId ?? right.controlledOverlapId;
  const componentIds = left.controlledOverlapComponentIds ?? right.controlledOverlapComponentIds;
  const sameRelaxedComponent = selectedId != null
    && (left.character.id === selectedId || right.character.id === selectedId)
    && componentIds?.has(left.character.id)
    && componentIds?.has(right.character.id);
  return sameRelaxedComponent ? 2 : normalEffectiveSpacing(left, right);
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

export function intentsConflict(left, right) {
  if (ignoresIntentPair(left, right.character.id) || ignoresIntentPair(right, left.character.id)) {
    return false;
  }
  return desiredCellsConflict(left, right)
    || !isSafeIntentPair(left, right, requiredSpacingForPair(left, right));
}

export function buildConflictComponents(intents, metrics = null) {
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

export function isResolutionSafeForIntent(intent, candidate, intents, resolutions) {
  return intents.every(peer => peer === intent
    || ignoresIntentPair(intent, peer.character.id)
    || ignoresIntentPair(peer, intent.character.id)
    || isSafeResolvedPair(
      candidate,
      resolutions.get(peer.character.id),
      requiredSpacingForPair(intent, peer),
    ));
}

export function furthestSafeResolutionPrefix(intent, resolution, intents, resolutions, metrics = null) {
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

export function furthestSafeTrajectoryPrefix(intent, intents, resolutions, metrics = null) {
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

export function areIntentPairsSafeFor(checkedIntents, intents, resolutions) {
  return checkedIntents.every(intent => isResolutionSafeForIntent(
    intent,
    resolutions.get(intent.character.id),
    intents,
    resolutions,
  ));
}

export function componentIsSafe(component, intents, resolutions) {
  return component.every(intent => isResolutionSafeForIntent(
    intent,
    resolutions.get(intent.character.id),
    intents,
    resolutions,
  ));
}
