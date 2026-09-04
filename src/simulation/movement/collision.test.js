import { expect, it } from 'vitest';
import { createMovementMetrics } from '../movementMetrics';
import {
  buildConflictComponents,
  furthestSafeTrajectoryPrefix,
  ignoresIntentPair,
  intentsConflict,
  isResolutionSafeForIntent,
  isSafeIntentPair,
  requiredSpacingForPair,
} from './collision';
import { buildMovementIntent, resolvedIntent } from './intents';
import { buildTimeParameterizedTrajectory, stationaryTrajectory } from './trajectory';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

const threeWayCrossingEntries = () => [
  { character: { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 } }, speed: 40 },
  { character: { id: 'b', x: 100, y: 80, path: [{ x: 5, y: 6 }], pathGoal: { x: 5, y: 6 } }, speed: 40 },
  { character: { id: 'c', x: 120, y: 100, path: [{ x: 4, y: 5 }], pathGoal: { x: 4, y: 5 } }, speed: 40 },
];

function makeIntent({
  id, start, desired, spacing = 16, ignoredIds = [],
  controlledOverlapId, controlledOverlapComponentIds,
}) {
  const speed = Math.hypot(desired.x - start.x, desired.y - start.y);
  const intent = {
    character: { id, ...start, path: [] },
    start: { ...start },
    desired: { id, ...desired, path: [] },
    spacing,
    ignoredIds,
    controlledOverlapId,
    controlledOverlapComponentIds,
    trajectory: buildTimeParameterizedTrajectory(start, desired, speed, 1),
  };
  intent.startResolution = resolvedIntent(
    intent, intent.character, stationaryTrajectory(start),
  );
  intent.desiredResolution = resolvedIntent(
    intent, intent.desired, intent.trajectory,
  );
  return intent;
}

it('builds stable three-way components and counts each pair once', () => {
  const metrics = createMovementMetrics();
  const intents = threeWayCrossingEntries()
    .map(entry => buildMovementIntent(openState, entry, 1));
  for (const intent of intents) {
    intent.startResolution = resolvedIntent(intent, intent.character, stationaryTrajectory(intent.start));
    intent.desiredResolution = resolvedIntent(intent, intent.desired, intent.trajectory);
  }
  const components = buildConflictComponents(intents, metrics);

  expect(components.map(component => component.map(intent => intent.character.id)))
    .toEqual([['a', 'b', 'c']]);
  expect(metrics.pairChecks).toBe(3);
  expect(metrics.conflictPairs).toBeGreaterThan(0);
  expect(metrics.components).toBe(1);
  expect(metrics.maxComponentSize).toBe(3);
});

it('preserves ignored-pair, edge-swap, spacing, and controlled-overlap rules', () => {
  const left = makeIntent({
    id: 'left', start: { x: 80, y: 100 }, desired: { x: 100, y: 100 },
    ignoredIds: ['right'],
  });
  const right = makeIntent({
    id: 'right', start: { x: 100, y: 100 }, desired: { x: 80, y: 100 },
  });
  expect(ignoresIntentPair(left, 'right')).toBe(true);
  expect(intentsConflict(left, right)).toBe(false);

  left.ignoredIds = [];
  expect(intentsConflict(left, right)).toBe(true);
  expect(isSafeIntentPair(left, right, 16)).toBe(false);
  expect(requiredSpacingForPair(left, right)).toBe(16);

  left.controlledOverlapId = 'left';
  left.controlledOverlapComponentIds = new Set(['left', 'right']);
  expect(requiredSpacingForPair(left, right)).toBe(2);
});

it('preserves coincident-start separation and resolved-candidate safety', () => {
  const separatingLeft = makeIntent({
    id: 'left', start: { x: 100, y: 100 }, desired: { x: 80, y: 100 },
  });
  const separatingRight = makeIntent({
    id: 'right', start: { x: 100, y: 100 }, desired: { x: 120, y: 100 },
  });
  const stationaryRight = makeIntent({
    id: 'stationary', start: { x: 100, y: 100 }, desired: { x: 100, y: 100 },
  });
  expect(isSafeIntentPair(separatingLeft, separatingRight, 16)).toBe(true);
  expect(isSafeIntentPair(separatingLeft, stationaryRight, 16)).toBe(true);

  const mover = makeIntent({
    id: 'mover', start: { x: 80, y: 100 }, desired: { x: 100, y: 100 },
  });
  const blocker = makeIntent({
    id: 'blocker', start: { x: 120, y: 100 }, desired: { x: 120, y: 100 },
  });
  const resolutions = new Map([
    ['mover', mover.desiredResolution],
    ['blocker', blocker.startResolution],
  ]);
  expect(isResolutionSafeForIntent(
    mover, mover.desiredResolution, [mover, blocker], resolutions,
  )).toBe(true);
  const unsafe = resolvedIntent(
    mover,
    { ...mover.desired, x: 110 },
    buildTimeParameterizedTrajectory(mover.start, { x: 110, y: 100 }, 30, 1),
  );
  expect(isResolutionSafeForIntent(mover, unsafe, [mover, blocker], resolutions)).toBe(false);
});

it('returns the furthest exact safe trajectory prefix before a stationary blocker', () => {
  const mover = makeIntent({
    id: 'mover', start: { x: 80, y: 100 }, desired: { x: 120, y: 100 },
  });
  const blocker = makeIntent({
    id: 'blocker', start: { x: 120, y: 100 }, desired: { x: 120, y: 100 },
  });
  const resolutions = new Map([
    ['mover', mover.startResolution],
    ['blocker', blocker.startResolution],
  ]);
  const metrics = createMovementMetrics();
  const prefix = furthestSafeTrajectoryPrefix(
    mover, [mover, blocker], resolutions, metrics,
  );

  expect(prefix.endpoint.x).toBeCloseTo(104, 5);
  expect(prefix.endpoint.y).toBe(100);
  expect(prefix.endpoint.path).toEqual([]);
  expect(prefix.trajectory[0].start).toEqual({ x: 80, y: 100 });
  expect(prefix.trajectory.at(-1).end.x).toBeCloseTo(104, 5);
  expect(prefix.trajectory.at(-1).end.y).toBe(100);
  expect(prefix.trajectory.at(-1).endTime).toBe(1);
  expect(metrics.safePrefixProbes).toBeGreaterThan(0);
});
