import { expect, it } from 'vitest';
import { createMovementMetrics } from '../movementMetrics';
import { createNavigationWorkspace } from './navigationWorkspace';
import {
  clearMovementRecoveryMetadata,
  ensureStaffRuntime,
  hasArrived,
  moveCharacterAlongPath,
  moveCharacterTowards,
  planCharacterPath,
} from './pathMotion';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

it('moves through one path cell without rebuilding a supplied workspace', () => {
  const metrics = createMovementMetrics();
  const workspace = createNavigationWorkspace(openState, metrics);
  const moved = moveCharacterAlongPath(
    { id: 'actor', x: 100, y: 100, path: [{ x: 6, y: 5 }] },
    1,
    [],
    20,
    16,
    openState,
    { workspace, metrics },
  );
  expect(moved).toMatchObject({ x: 120, y: 100, path: [] });
  expect(metrics.blockedCellBuilds).toBe(1);
});

it('clears only movement recovery metadata', () => {
  expect(clearMovementRecoveryMetadata({
    id: 'actor', x: 100, y: 100, path: [], pathGoal: { x: 5, y: 5 },
    stalledFor: 3, usingStaticFallback: true, minimumSpacing: 6,
    localConflictTarget: { x: 4, y: 5 }, headOnRecovery: true,
    recoveredHeadOnDetourTarget: { x: 4, y: 4 }, businessField: 'kept',
  })).toEqual({
    id: 'actor', x: 100, y: 100, path: [], stalledFor: 0, businessField: 'kept',
  });
});

it('plans the exact open route and resets dynamic-fallback metadata', () => {
  const character = {
    id: 'actor', x: 100, y: 100,
    stalledFor: 4, minimumSpacing: 6, usingStaticFallback: true,
  };

  expect(planCharacterPath(openState, character, { world: { x: 160, y: 100 } }))
    .toEqual({
      ...character,
      path: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
      pathGoal: { x: 8, y: 5 },
      usingStaticFallback: false,
      stalledFor: 0,
      minimumSpacing: 16,
    });
});

it('rejects path and direct movement through static geometry', () => {
  const blockedState = {
    ...openState,
    chairs: [{ id: 'wall', x: 120, y: 100 }],
  };
  const character = { id: 'actor', x: 100, y: 100, path: [{ x: 7, y: 5 }] };

  expect(moveCharacterAlongPath(character, 1, [], 60, 16, blockedState)).toBe(character);
  expect(moveCharacterTowards(character, { x: 160, y: 100 }, 1, [], 60, 16, blockedState))
    .toBe(character);
});

it('fills exact role defaults and preserves arrival semantics', () => {
  expect(ensureStaffRuntime([
    { id: 'cook', role: 'cook' },
    { id: 'waiter', role: 'waiter' },
  ], openState)).toEqual([
    { id: 'cook', role: 'cook', x: 90, y: 75, path: [], task: null },
    { id: 'waiter', role: 'waiter', x: 505, y: 360, path: [], task: null },
  ]);
  expect(hasArrived(null)).toBe(true);
  expect(hasArrived({})).toBe(true);
  expect(hasArrived({ path: [] })).toBe(true);
  expect(hasArrived({ path: [{ x: 1, y: 2 }] })).toBe(false);
});
