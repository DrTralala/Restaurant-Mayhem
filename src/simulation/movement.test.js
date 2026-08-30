import { describe, expect, it } from 'vitest';
import {
  buildTimeParameterizedTrajectory,
  coincidentStartTrajectoriesSeparateSafely,
  ensureStaffRuntime,
  hasArrived,
  minimumSweptDistance,
  minimumTrajectoryDistance,
  moveCharacterAlongPath,
  moveCharacterTowards,
  moveCharacterWithRecovery,
  moveStaffAlongPath,
  resolveCharacterMovementBatch,
  resolveCharacterMovementBatchWithDiagnostics,
  solveLocalConflictWithMovementMetrics,
} from './movement';
import { buildBlockedCells, findPath, worldToCell } from './pathfinding';
import { createMovementMetrics } from './movementMetrics';
import { getRestaurantWorld } from './world';

const openState = { restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [], serviceTables: [] };

const threeWayCrossingEntries = () => [
  { character: { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 } }, speed: 40 },
  { character: { id: 'b', x: 100, y: 80, path: [{ x: 5, y: 6 }], pathGoal: { x: 5, y: 6 } }, speed: 40 },
  { character: { id: 'c', x: 120, y: 100, path: [{ x: 4, y: 5 }], pathGoal: { x: 4, y: 5 } }, speed: 40 },
];
const conflictEntries = () => threeWayCrossingEntries().slice(0, 2);
const independentEntry = {
  character: { id: 'independent', x: 300, y: 100, path: [{ x: 17, y: 5 }] }, speed: 40,
};
const serialiseById = moved => [...moved.entries()]
  .sort(([left], [right]) => left.localeCompare(right));
const solverTimingKeys = [
  'solverInitialPlanningMilliseconds',
  'solverNodeBuildMilliseconds',
  'solverFrontierOrderingMilliseconds',
  'solverReplanningMilliseconds',
  'solverAgedFallbackMilliseconds',
  'solverResidualMilliseconds',
];
const expectSolverWrapperAccounting = metrics => {
  for (const key of solverTimingKeys) {
    expect(Number.isFinite(metrics[key]), key).toBe(true);
    expect(metrics[key], key).toBeGreaterThanOrEqual(0);
  }
  expect(solverTimingKeys.reduce((total, key) => total + metrics[key], 0))
    .toBeCloseTo(metrics.localConflictSolverMilliseconds, 6);
};
const expectAllEndpointPairsAtLeast = (entries, moved, spacing) => {
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const leftEndpoint = moved.get(entries[left].character.id);
      const rightEndpoint = moved.get(entries[right].character.id);
      expect(Math.hypot(
        leftEndpoint.x - rightEndpoint.x,
        leftEndpoint.y - rightEndpoint.y,
      ), `${entries[left].character.id}/${entries[right].character.id}`)
        .toBeGreaterThanOrEqual(spacing - 1e-6);
    }
  }
};
const simulateMovementTicks = (state, initialEntries, tickCount, dt = 1 / 30, updateEntries = null) => {
  let entries = initialEntries.map(entry => ({ ...entry, character: { ...entry.character } }));
  const frames = [];
  for (let tick = 0; tick < tickCount; tick += 1) {
    if (updateEntries) entries = updateEntries(entries, tick);
    const starts = entries.map(entry => ({ ...entry, character: { ...entry.character } }));
    const moved = resolveCharacterMovementBatch(state, starts, dt);
    frames.push({ entries: starts, moved });
    entries = starts.map(entry => ({
      ...entry,
      character: moved.get(entry.character.id),
    }));
  }
  return { entries, frames };
};

const routeDistance = character => {
  const goal = character.pathGoal || character.path?.at(-1);
  if (!goal) return 0;
  return Math.hypot(character.x - goal.x * 20, character.y - goal.y * 20);
};

const corridorState = {
  ...openState,
  chairs: [60, 80, 100, 120, 140, 160, 180, 200, 220].flatMap((x, index) => [
    { id: `north-${index}`, x, y: 60 },
    { id: `south-${index}`, x, y: 120 },
  ]),
};

describe('movement runtime', () => {
  it('rejects co-located piecewise trajectories that share a positive-duration first segment', () => {
    const sharedThenLeft = [
      { start: { x: 100, y: 100 }, end: { x: 120, y: 100 }, startTime: 0, endTime: 0.5 },
      { start: { x: 120, y: 100 }, end: { x: 120, y: 120 }, startTime: 0.5, endTime: 1 },
    ];
    const sharedThenRight = [
      { start: { x: 100, y: 100 }, end: { x: 120, y: 100 }, startTime: 0, endTime: 0.5 },
      { start: { x: 120, y: 100 }, end: { x: 120, y: 80 }, startTime: 0.5, endTime: 1 },
    ];
    const immediateLeft = buildTimeParameterizedTrajectory(
      { x: 100, y: 100 }, { x: 80, y: 100 }, 20, 1,
    );
    const immediateRight = buildTimeParameterizedTrajectory(
      { x: 100, y: 100 }, { x: 120, y: 100 }, 20, 1,
    );

    expect(coincidentStartTrajectoriesSeparateSafely(sharedThenLeft, sharedThenRight)).toBe(false);
    expect(coincidentStartTrajectoriesSeparateSafely(immediateLeft, immediateRight)).toBe(true);
  });
  it('replaces non-finite coordinates (NaN, Infinity) with default positions', () => {
    const state = { restaurant: { expansionLevel: 1 } };
    const staff = [
      { id: 'c', role: 'cook', name: 'Marco', x: NaN, y: NaN },
      { id: 'w', role: 'waiter', name: 'Anna', x: Infinity, y: -Infinity },
    ];
    const result = ensureStaffRuntime(staff, state);
    expect(result[0].x).not.toBeNaN();
    expect(result[0].y).not.toBeNaN();
    expect(result[1].x).not.toBe(Infinity);
    expect(result[1].y).not.toBe(-Infinity);
    expect(Number.isFinite(result[1].x)).toBe(true);
    expect(Number.isFinite(result[1].y)).toBe(true);
    // Verify defaults are sane: within restaurant bounds
    expect(result[0].x).toBeGreaterThanOrEqual(0);
    expect(result[0].y).toBeGreaterThanOrEqual(0);
  });

  it('fills missing staff coordinates without changing existing coordinates', () => {
    const state = { restaurant: { expansionLevel: 1 } };
    const staff = [
      { id: 'c', role: 'cook', name: 'Marco', morale: 80 },
      { id: 'w', role: 'waiter', name: 'Anna', morale: 80, x: 333, y: 444 },
    ];
    const result = ensureStaffRuntime(staff, state);
    expect(result[0].x).toBeTypeOf('number');
    expect(result[0].y).toBeTypeOf('number');
    expect(result[1].x).toBe(333);
    expect(result[1].y).toBe(444);
    expect(result[0].path).toEqual([]);
    expect(result[0].task).toBeNull();
    expect(result[1].path).toEqual([]);
    expect(result[1].task).toBeNull();
  });

  it('moves staff toward the next path point without teleporting', () => {
    const staff = { id: 'w', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }] };
    const moved = moveStaffAlongPath(staff, 0.5);
    expect(moved.x).toBeGreaterThan(100);
    expect(moved.x).toBeLessThan(160);
    expect(moved.path.length).toBe(1);
  });

  it('does not move through a newly blocked ordinary waypoint', () => {
    const state = { ...openState, chairs: [{ id: 'wall', x: 120, y: 100 }] };
    const staff = { id: 'w', role: 'waiter', x: 100, y: 100, path: [{ x: 7, y: 5 }] };

    const moved = moveCharacterAlongPath(staff, 1, [], 60, 16, state);

    expect(moved).toEqual(staff);
  });

  it('does not move directly through a hard obstacle', () => {
    const state = { ...openState, chairs: [{ id: 'wall', x: 120, y: 100 }] };
    const character = { id: 'w', x: 100, y: 100 };

    const moved = moveCharacterTowards(character, { x: 160, y: 100 }, 1, [], 60, 16, state);

    expect(moved).toEqual(character);
  });

  it('consumes a path point when staff reaches it', () => {
    const staff = { id: 'w', role: 'waiter', x: 140, y: 100, path: [{ x: 8, y: 5 }] };
    const moved = moveStaffAlongPath(staff, 1);
    expect(moved.x).toBe(160);
    expect(moved.y).toBe(100);
    expect(moved.path).toEqual([]);
  });

  it('consumes a nearly reached waypoint even when another character is close', () => {
    const staff = { id: 'w1', role: 'waiter', x: 521, y: 360, path: [{ x: 26, y: 18 }, { x: 25, y: 18 }] };

    const moved = moveStaffAlongPath(staff, 1, [{ id: 'w', x: 505, y: 360 }]);

    expect(moved).toMatchObject({ x: 520, y: 360, path: [{ x: 25, y: 18 }] });
  });

  it('does not snap a near waypoint beyond the current movement budget', () => {
    const staff = { id: 'w', role: 'waiter', x: 100.5, y: 100, path: [{ x: 5, y: 5 }] };
    const moved = moveCharacterAlongPath(staff, 0.001, [], 60);

    expect(Math.hypot(moved.x - staff.x, moved.y - staff.y)).toBeLessThanOrEqual(60 * 0.001 + 1e-6);
    expect(moved.path).toEqual(staff.path);
  });

  it('consumes an exactly reached waypoint with zero dt without moving', () => {
    const staff = { id: 'w', role: 'waiter', x: 100, y: 100, path: [{ x: 5, y: 5 }] };
    const moved = moveCharacterAlongPath(staff, 0, [], 60);

    expect(moved).toMatchObject({ x: 100, y: 100, path: [] });
  });

  it('stops before colliding with another character', () => {
    const staff = { id: 'w', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }] };

    const moved = moveStaffAlongPath(staff, 1, [{ id: 'h', x: 125, y: 100 }]);

    expect(moved.x).toBeLessThanOrEqual(109);
    expect(moved.path).toHaveLength(1);
  });

  it('hasArrived returns true when path is empty or missing', () => {
    expect(hasArrived({ path: [] })).toBe(true);
    expect(hasArrived({})).toBe(true);
    expect(hasArrived({ path: [{ x: 1, y: 2 }] })).toBe(false);
  });

  it('hasArrived with null or undefined staff returns true', () => {
    expect(hasArrived(null)).toBe(true);
    expect(hasArrived(undefined)).toBe(true);
  });

  it('replans after 0.75 seconds stalled and uses six-pixel spacing after two seconds', () => {
    const blocker = { id: 'blocker', x: 111, y: 111 };
    let character = {
      id: 'worker', role: 'waiter', x: 100, y: 100,
      path: [{ x: 5, y: 6 }, { x: 10, y: 5 }],
      pathGoal: { x: 10, y: 5 },
      stalledFor: 0, minimumSpacing: 16, usingStaticFallback: false,
    };

    character = moveCharacterWithRecovery(openState, character, 0.75, [blocker], 75);
    expect(character).toMatchObject({ x: 100, y: 100, stalledFor: 0.75, usingStaticFallback: false });
    expect(character.path[0]).toEqual({ x: 6, y: 5 });

    character = moveCharacterWithRecovery(openState, character, 1.25, [blocker], 75);
    expect(character).toMatchObject({
      x: 100, y: 100, stalledFor: 2, usingStaticFallback: true, minimumSpacing: 6,
    });
  });

  it('gives the lexically lower character ID right of way head-on', () => {
    const low = { id: 'a', x: 100, y: 100, path: [{ x: 8, y: 5 }] };
    const high = { id: 'b', x: 125, y: 100, path: [{ x: 4, y: 5 }] };

    const movedLow = moveCharacterWithRecovery(openState, low, 0.2, [high], 60);
    const movedHigh = moveCharacterWithRecovery(openState, high, 0.2, [low], 60);

    expect(movedLow.x).toBeGreaterThan(low.x);
    expect(movedHigh.x).toBe(high.x);
  });

  it('keeps two-pixel controlled-overlap spacing when an oncoming peer occupies the next waypoint', () => {
    const moving = {
      id: 'a', x: 94, y: 100, path: [{ x: 5, y: 5 }],
      stalledFor: 2, minimumSpacing: 6, usingStaticFallback: true,
    };
    const peer = { id: 'b', x: 100, y: 100, path: [{ x: 4, y: 5 }] };

    const result = moveCharacterWithRecovery(openState, moving, 0.1, [peer], 60);
    const separation = Math.hypot(result.x - peer.x, result.y - peer.y);

    expect(separation).not.toBe(0);
    expect(separation).toBeGreaterThanOrEqual(2 - 1e-6);
  });

  it('consumes a controlled-overlap waypoint when the accepted endpoint genuinely arrives', () => {
    const moving = {
      id: 'a', x: 80, y: 100, path: [{ x: 5, y: 5 }, { x: 8, y: 5 }],
      stalledFor: 2, minimumSpacing: 6, usingStaticFallback: true,
    };
    const peer = { id: 'b', x: 90, y: 100, path: [{ x: 3, y: 5 }] };

    const result = moveCharacterWithRecovery(openState, moving, 0.4, [peer], 60);

    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.path).toEqual([{ x: 8, y: 5 }]);
    expect(result.stalledFor).toBe(0);
    expect(result.minimumSpacing).toBe(16);
    expect(result.usingStaticFallback).toBe(false);
  });

  it('does not use controlled overlap before the two-second fallback phase', () => {
    const moving = {
      id: 'a', x: 94, y: 100, path: [{ x: 5, y: 5 }],
      stalledFor: 1.9, minimumSpacing: 6, usingStaticFallback: true,
    };
    const peer = { id: 'b', x: 100, y: 100, path: [{ x: 4, y: 5 }] };

    const result = moveCharacterWithRecovery(openState, moving, 0.01, [peer], 60);

    expect(result.x).toBeLessThanOrEqual(moving.x + 1e-6);
    expect(Math.hypot(result.x - peer.x, result.y - peer.y)).toBeGreaterThanOrEqual(6 - 1e-6);
  });

  it('allows only the lexically lower fallback actor to cross on the bounded forward segment', () => {
    const lower = { id: 'a', x: 80, y: 100, path: [{ x: 8, y: 5 }], stalledFor: 2, usingStaticFallback: true };
    const higher = { id: 'b', x: 100, y: 100, path: [{ x: 4, y: 5 }], stalledFor: 2, usingStaticFallback: true };

    const lowerResult = moveCharacterWithRecovery(openState, lower, 0.1, [higher], 60);
    const higherResult = moveCharacterWithRecovery(openState, higher, 0.1, [lower], 60);

    expect(lowerResult.x).toBeGreaterThan(lower.x);
    expect(higherResult.x).toBeLessThanOrEqual(higher.x + 1e-6);
    expect(Math.abs(lowerResult.y - lower.y)).toBeLessThan(1e-6);
    expect(lowerResult.x).toBeLessThanOrEqual(lower.x + 6 + 1e-6);
  });

  it('keeps a higher-ID actor on its original side when its budget reaches the far side', () => {
    const moving = { id: 'b', x: 94, y: 100, path: [{ x: 8, y: 5 }], stalledFor: 2, usingStaticFallback: true };
    const peer = { id: 'a', x: 100, y: 100, path: [{ x: 4, y: 5 }] };
    const result = moveCharacterWithRecovery(openState, moving, 0.2, [peer], 60);

    expect(result.x).toBeLessThanOrEqual(peer.x + 1e-6);
    expect(Math.hypot(result.x - peer.x, result.y - peer.y)).toBeGreaterThanOrEqual(6 - 1e-6);
  });

  it.each([
    ['horizontal', { x: 90, y: 100 }, { x: 100, y: 100 }, [{ x: 8, y: 5 }]],
    ['vertical', { x: 100, y: 90 }, { x: 100, y: 100 }, [{ x: 5, y: 8 }]],
    ['diagonal', { x: 90, y: 90 }, { x: 100, y: 100 }, [{ x: 8, y: 8 }]],
  ])('preserves the higher-ID actor same side for %s movement but rejects centreline crossing', (_name, start, peerPosition, path) => {
    const moving = { id: 'b', ...start, path, stalledFor: 2, usingStaticFallback: true };
    const peer = { id: 'a', ...peerPosition, path: [{ x: 4, y: 5 }] };
    const result = moveCharacterWithRecovery(openState, moving, 0.1, [peer], 60);
    const direction = { x: path[0].x * 20 - start.x, y: path[0].y * 20 - start.y };
    const length = Math.hypot(direction.x, direction.y);
    const startProjection = ((start.x - peer.x) * direction.x + (start.y - peer.y) * direction.y) / length;
    const resultProjection = ((result.x - peer.x) * direction.x + (result.y - peer.y) * direction.y) / length;
    expect(result.x !== start.x || result.y !== start.y).toBe(true);
    expect(startProjection * resultProjection).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.hypot(result.x - peer.x, result.y - peer.y)).toBeGreaterThanOrEqual(6 - 1e-6);

    const crossing = { ...moving, x: start.x - direction.x / length * 4, y: start.y - direction.y / length * 4 };
    const crossingResult = moveCharacterWithRecovery(openState, crossing, 0.2, [peer], 60);
    const crossingProjection = ((crossingResult.x - peer.x) * direction.x + (crossingResult.y - peer.y) * direction.y) / length;
    expect(crossingProjection).toBeLessThanOrEqual(1e-6);
  });

  it('selects the furthest legal open interval before blocked endpoint and peer circle', () => {
    const state = { ...openState, chairs: [{ id: 'wall', x: 120, y: 100 }] };
    const moving = { id: 'a', x: 80, y: 100, path: [{ x: 8, y: 5 }], stalledFor: 2, usingStaticFallback: true };
    const peer = { id: 'b', x: 105, y: 100, path: [{ x: 4, y: 5 }] };
    const result = moveCharacterWithRecovery(state, moving, 0.8, [peer], 60);
    expect(result.x).toBeCloseTo(99, 3);
    expect(Math.hypot(result.x - peer.x, result.y - peer.y)).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(buildBlockedCells(state).has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
  });

  it('counts waypoint consumption as progress and resets recovery metadata', () => {
    const moving = { id: 'w1', x: 100, y: 100, path: [{ x: 5, y: 5 }, { x: 8, y: 5 }], stalledFor: 2, minimumSpacing: 6, usingStaticFallback: true };
    const result = moveCharacterWithRecovery(openState, moving, 1, [], 60);
    expect(result.path.length).toBeLessThan(moving.path.length);
    expect(result.stalledFor).toBe(0);
    expect(result.minimumSpacing).toBe(16);
    expect(result.usingStaticFallback).toBe(false);
  });

  it('never exceeds the tiny movement budget while crossing a qualified peer', () => {
    const moving = {
      id: 'a', x: 48, y: 100, path: [{ x: 4, y: 5 }],
      stalledFor: 2, minimumSpacing: 6, usingStaticFallback: true,
    };
    const peer = { id: 'b', x: 50, y: 100, path: [{ x: 3, y: 5 }] };
    const result = moveCharacterWithRecovery(openState, moving, 1 / 60, [peer], 60);

    expect(Math.hypot(result.x - moving.x, result.y - moving.y)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('does not return the old crossing clamp point inside static geometry', () => {
    const state = { ...openState, chairs: [{ id: 'chair', x: 60, y: 100 }] };
    const moving = {
      id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }],
      stalledFor: 2, minimumSpacing: 6, usingStaticFallback: true,
    };
    const peer = { id: 'b', x: 85, y: 100, path: [{ x: 4, y: 5 }] };
    const result = moveCharacterWithRecovery(state, moving, 1 / 60, [peer], 60);

    expect(buildBlockedCells(state).has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
  });

  it('selects the furthest legal endpoint while moving negatively across a grid boundary', () => {
    const state = { ...openState, chairs: [{ id: 'ordinary-endpoint', x: 20, y: 100 }] };
    const moving = { id: 'a', x: 60, y: 100, path: [{ x: 1, y: 5 }], stalledFor: 2, usingStaticFallback: true };
    const peer = { id: 'b', x: 54, y: 100, path: [{ x: 4, y: 5 }] };
    const result = moveCharacterWithRecovery(state, moving, 0.5, [peer], 60);
    const distance = Math.hypot(result.x - moving.x, result.y - moving.y);
    const endpoint = { x: 40, y: 100 };

    expect(distance).toBeLessThanOrEqual(30 + 1e-6);
    expect(buildBlockedCells(state).has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
    expect(Math.hypot(result.x - peer.x, result.y - peer.y)).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(result.x).toBeLessThanOrEqual(moving.x + 1e-6);
    expect(result.x).toBeCloseTo(endpoint.x, 5);
    expect(result.y).toBeCloseTo(endpoint.y, 5);
    expect(result.x).toBeLessThan(60);
  });

  it('uses floor semantics at an ordinary endpoint on a grid boundary', () => {
    const state = { ...openState, chairs: [{ id: 'wall', x: 120, y: 100 }] };
    const moving = { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }], stalledFor: 2, usingStaticFallback: true };
    const peer = { id: 'b', x: 105, y: 100, path: [{ x: 4, y: 5 }] };
    const result = moveCharacterWithRecovery(state, moving, 0.5, [peer], 80);
    const distance = Math.hypot(result.x - moving.x, result.y - moving.y);

    expect(distance).toBeLessThanOrEqual(40 + 1e-6);
    expect(buildBlockedCells(state).has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
    expect(Math.hypot(result.x - peer.x, result.y - peer.y)).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(result.x).toBeGreaterThanOrEqual(moving.x - 1e-6);
    expect(result.x).toBeLessThanOrEqual(120 + 1e-6);
    expect(result.x).toBeCloseTo(99, 5);
    expect(result.y).toBeCloseTo(100, 5);
    expect(worldToCell(result)).toEqual({ x: 4, y: 5 });
  });

  it('selects the furthest legal diagonal endpoint across both grid boundaries', () => {
    const state = { ...openState, chairs: [{ id: 'ordinary-endpoint', x: 20, y: 20 }] };
    const moving = { id: 'a', x: 60, y: 60, path: [{ x: 1, y: 1 }], stalledFor: 2, usingStaticFallback: true };
    const peer = { id: 'b', x: 54, y: 54, path: [{ x: 4, y: 4 }] };
    const result = moveCharacterWithRecovery(state, moving, 0.5, [peer], 80);
    const distance = Math.hypot(result.x - moving.x, result.y - moving.y);

    expect(distance).toBeLessThanOrEqual(40 + 1e-6);
    expect(buildBlockedCells(state).has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
    expect(Math.hypot(result.x - peer.x, result.y - peer.y)).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(result.x).toBeLessThanOrEqual(moving.x + 1e-6);
    expect(result.y).toBeLessThanOrEqual(moving.y + 1e-6);
    expect(result.x).toBeCloseTo(40, 5);
    expect(result.y).toBeCloseTo(40, 5);
    expect(worldToCell(result)).toEqual({ x: 2, y: 2 });
  });

  it('selects the furthest interval when legal and blocked segments alternate', () => {
    const state = {
      ...openState,
      chairs: [
         { id: 'blocked-a', x: 100, y: 100 },
         { id: 'blocked-b', x: 140, y: 100 },
         { id: 'blocked-endpoint', x: 160, y: 100 },
      ],
    };
    const moving = { id: 'a', x: 80, y: 100, path: [{ x: 10, y: 5 }], stalledFor: 2, usingStaticFallback: true };
    const peer = { id: 'b', x: 84, y: 100, path: [{ x: 3, y: 5 }] };
    const result = moveCharacterWithRecovery(state, moving, 2, [peer], 60);
    const distance = Math.hypot(result.x - moving.x, result.y - moving.y);

    expect(distance).toBeLessThanOrEqual(120 + 1e-6);
    expect(buildBlockedCells(state).has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
    expect(Math.hypot(result.x - peer.x, result.y - peer.y)).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(result.x).toBeGreaterThanOrEqual(moving.x - 1e-6);
    expect(result.x).toBeLessThanOrEqual(100 + 1e-6);
    expect(result.x).toBeCloseTo(100, 3);
    expect(result.y).toBeCloseTo(100, 5);
    expect(worldToCell(result)).toEqual({ x: 4, y: 5 });
    expect(result.x).not.toBeCloseTo(moving.x, 5);
  });

  it('leaves an unaccepted waypoint unconsumed', () => {
    const moving = {
      id: 'a', x: 94, y: 100, path: [{ x: 5, y: 5 }, { x: 8, y: 5 }],
      stalledFor: 2, minimumSpacing: 6, usingStaticFallback: true,
    };
    const peer = { id: 'b', x: 100, y: 100, path: [{ x: 4, y: 5 }] };
    const result = moveCharacterWithRecovery({ ...openState, chairs: [{ id: 'blocked', x: 80, y: 100 }] }, moving, 0.1, [peer], 60);

    expect(result.path[0]).toEqual(moving.path[0]);
    expect(result.x).toBe(moving.x);
    expect(result.y).toBe(moving.y);
  });

  it('resets recovery metadata after measurable progress', () => {
    const moving = {
      id: 'w1', x: 100, y: 100, path: [{ x: 8, y: 5 }],
      stalledFor: 2, minimumSpacing: 6, usingStaticFallback: true,
    };

    const result = moveCharacterWithRecovery(openState, moving, 0.2, [], 60);

    expect(result.stalledFor).toBe(0);
    expect(result.minimumSpacing).toBe(16);
    expect(result.usingStaticFallback).toBe(false);
  });

  it.each([
    ['behind', { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }] }],
    ['same direction', { id: 'a', x: 125, y: 100, path: [{ x: 8, y: 5 }] }],
    ['non-head-on', { id: 'a', x: 125, y: 140, path: [{ x: 6, y: 6 }] }],
  ])('does not yield to a lower-ID %s character without opposing projected movement', (_name, other) => {
    const moving = { id: 'z', x: 100, y: 100, path: [{ x: 8, y: 5 }] };
    const result = moveCharacterWithRecovery(openState, moving, 0.2, [other], 60);
    expect(result.x).toBeGreaterThan(moving.x);
  });

  it('resets recovery metadata whenever measurable movement occurs despite a constraint', () => {
    const moving = {
      id: 'w1', x: 100, y: 100, path: [{ x: 8, y: 5 }],
      stalledFor: 2, minimumSpacing: 6, usingStaticFallback: true,
    };
    const result = moveCharacterWithRecovery(openState, moving, 0.2, [{ id: 'blocker', x: 130, y: 100 }], 60);

    expect(result.x).toBeGreaterThan(moving.x);
    expect(result.stalledFor).toBe(0);
    expect(result.minimumSpacing).toBe(16);
    expect(result.usingStaticFallback).toBe(false);
  });

  it('resets recovery metadata after progress towards an occupied target cell without fallback', () => {
    const moving = {
      id: 'w1', x: 100, y: 100, path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
      stalledFor: 0.5, minimumSpacing: 16, usingStaticFallback: false,
    };
    const blocker = { id: 'blocker', x: 175, y: 100 };

    const result = moveCharacterWithRecovery(openState, moving, 0.2, [blocker], 60);

    expect(result.x).toBeGreaterThan(moving.x);
    expect(result.stalledFor).toBe(0);
    expect(result.minimumSpacing).toBe(16);
    expect(result.usingStaticFallback).toBe(false);
  });

  it('does not yield to a lower-ID peer behind and moving away', () => {
    const moving = { id: 'z', x: 140, y: 100, path: [{ x: 9, y: 5 }] };
    const behind = { id: 'a', x: 120, y: 100, path: [{ x: 8, y: 5 }] };
    expect(moveCharacterWithRecovery(openState, moving, 0.2, [behind], 60).x).toBeGreaterThan(moving.x);
  });

  it('does not yield to a nearby lower-ID parallel traveller', () => {
    const moving = { id: 'z', x: 100, y: 100, path: [{ x: 8, y: 5 }] };
    const parallel = { id: 'a', x: 110, y: 115, path: [{ x: 7, y: 5 }] };
    expect(moveCharacterWithRecovery(openState, moving, 0.2, [parallel], 60).x).toBeGreaterThan(moving.x);
  });

  it('detects perpendicular segments crossing between their endpoints', () => {
    expect(minimumSweptDistance(
      { x: 80, y: 100 }, { x: 120, y: 100 },
      { x: 100, y: 80 }, { x: 100, y: 120 },
    )).toBeCloseTo(0);
  });

  it('lets a three-actor crossing component make deterministic progress without unsafe overlap', () => {
    const entries = threeWayCrossingEntries();
    const moved = resolveCharacterMovementBatch(openState, entries, 1);
    expect(entries.filter(({ character }) => {
      const result = moved.get(character.id);
      return Math.hypot(result.x - character.x, result.y - character.y) > 0;
    }).length).toBeGreaterThanOrEqual(1);
    expectAllEndpointPairsAtLeast(entries, moved, 16);
  });

  it('does not let a conflicted component stop an independent actor', () => {
    const moved = resolveCharacterMovementBatch(openState, [...conflictEntries(), independentEntry], 1);
    expect(moved.get('independent').x).toBe(340);
  });

  it('returns input-order-independent results for a local conflict component', () => {
    const entries = threeWayCrossingEntries();
    expect(serialiseById(resolveCharacterMovementBatch(openState, entries, 1)))
      .toEqual(serialiseById(resolveCharacterMovementBatch(openState, [...entries].reverse(), 1)));
  });

  it('returns byte-equivalent dense movement results with metrics enabled', () => {
    const entries = threeWayCrossingEntries();
    const metrics = createMovementMetrics();

    const withoutMetrics = serialiseById(
      resolveCharacterMovementBatch(openState, entries, 1),
    );
    const withMetrics = serialiseById(
      resolveCharacterMovementBatch(openState, entries, 1, metrics),
    );

    expect(withMetrics).toEqual(withoutMetrics);
    expect(withMetrics).toEqual([
      ['a', {
        id: 'a', x: 80, y: 100,
        path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 },
        localConflictTarget: { x: 5, y: 5 }, stalledFor: 1,
        minimumSpacing: 16, usingStaticFallback: false, headOnRecovery: true,
      }],
      ['b', {
        id: 'b', x: 120, y: 100,
        path: [{ x: 5, y: 6 }], pathGoal: { x: 5, y: 6 },
        localConflictTarget: { x: 6, y: 6 }, stalledFor: 0,
        minimumSpacing: 16, usingStaticFallback: false, headOnRecovery: false,
      }],
      ['c', {
        id: 'c', x: 100, y: 80,
        path: [{ x: 4, y: 5 }], pathGoal: { x: 4, y: 5 },
        localConflictTarget: { x: 4, y: 4 }, stalledFor: 0,
        minimumSpacing: 16, usingStaticFallback: false, headOnRecovery: false,
      }],
    ]);
    expect(metrics.batches).toBe(1);
    expect(metrics.batchMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.pairChecks).toBe(3);
    expect(metrics.conflictPairs).toBeGreaterThan(0);
    expect(metrics.components).toBe(1);
    expect(metrics.maxComponentSize).toBe(3);
    expect(metrics.solverCalls).toBeGreaterThan(0);
    expect(metrics.solverCalls).toBe(
      metrics.solverPbs + metrics.solverAgedFallback + metrics.solverNull,
    );
    expect(metrics.solverNodePops).toBeGreaterThan(0);
    expect(metrics.localConflictAttempts).toBeGreaterThanOrEqual(metrics.solverCalls);
    expect(metrics.localConflictProgressAccepts).toBeGreaterThan(0);
    expect(metrics.spaceTimePlanCalls).toBeGreaterThanOrEqual(metrics.solverCalls);
    expect(metrics.spaceTimeExpandedStates).toBeGreaterThan(0);
    expect(metrics.solverNodesBuilt).toBeGreaterThanOrEqual(metrics.solverPbs);
    expect(metrics.solverBranchesGenerated).toBeGreaterThan(0);
    expect(metrics.pairBuildMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.localConflictMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.safePrefixMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.dynamicRepathMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.staticRepathMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.residualBatchMilliseconds).toBeGreaterThanOrEqual(0);
    for (const key of [
      'localConflictPreparationMilliseconds',
      'localConflictSolverMilliseconds',
      'localConflictCandidateMilliseconds',
      'localConflictSafetyMilliseconds',
      'localConflictFallbackMilliseconds',
      'localConflictResidualMilliseconds',
      'solverInitialPlanningMilliseconds',
      'solverNodeBuildMilliseconds',
      'solverFrontierOrderingMilliseconds',
      'solverReplanningMilliseconds',
      'solverAgedFallbackMilliseconds',
      'solverResidualMilliseconds',
    ]) {
      expect(Number.isFinite(metrics[key]), key).toBe(true);
      expect(metrics[key], key).toBeGreaterThanOrEqual(0);
    }
    expect(metrics.localConflictPreparationMilliseconds
      + metrics.localConflictSolverMilliseconds
      + metrics.localConflictCandidateMilliseconds
      + metrics.localConflictSafetyMilliseconds
      + metrics.localConflictFallbackMilliseconds
      + metrics.localConflictResidualMilliseconds).toBeCloseTo(metrics.localConflictMilliseconds, 6);
    expect(metrics.solverInitialPlanningMilliseconds
      + metrics.solverNodeBuildMilliseconds
      + metrics.solverFrontierOrderingMilliseconds
      + metrics.solverReplanningMilliseconds
      + metrics.solverAgedFallbackMilliseconds
      + metrics.solverResidualMilliseconds).toBeCloseTo(metrics.localConflictSolverMilliseconds, 6);
    expect(metrics.pairBuildMilliseconds
      + metrics.localConflictMilliseconds
      + metrics.safePrefixMilliseconds
      + metrics.dynamicRepathMilliseconds
      + metrics.staticRepathMilliseconds
      + metrics.residualBatchMilliseconds).toBeCloseTo(metrics.batchMilliseconds, 6);
  });

  it('reconciles an initial-plan null result through the production movement solver wrapper', () => {
    const metrics = createMovementMetrics();
    const result = solveLocalConflictWithMovementMetrics({
      state: openState,
      actors: [{
        id: 'outside',
        startCell: { x: -10, y: -10 },
        goalCell: { x: 9, y: 5 },
        routeCells: [{ x: 9, y: 5 }],
        stalledFor: 0,
        moving: true,
      }],
      blockedCells: new Set(),
      horizon: 1,
      maxHighLevelNodes: 128,
    }, metrics);

    expect(result).toBeNull();
    expect(metrics.solverCalls).toBe(1);
    expect([metrics.solverPbs, metrics.solverAgedFallback, metrics.solverNull]).toEqual([0, 0, 1]);
    expectSolverWrapperAccounting(metrics);
  });

  it('preserves a stalled result while counting direct dynamic and static re-path branches', () => {
    const entries = [{
      character: {
        id: 'stalled', x: 100, y: 100,
        path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 }, stalledFor: 2,
      },
      speed: 0,
    }];
    const metrics = createMovementMetrics();

    const withoutMetrics = resolveCharacterMovementBatch(openState, entries, 1);
    const withMetrics = resolveCharacterMovementBatch(openState, entries, 1, metrics);

    expect(withMetrics).toEqual(withoutMetrics);
    expect(metrics.dynamicRepaths).toBeGreaterThan(0);
    expect(metrics.staticRepaths).toBeGreaterThan(0);
  });

  it('exposes the exact resolved trajectories without changing moved characters', () => {
    const entries = threeWayCrossingEntries();
    const ordinary = resolveCharacterMovementBatch(openState, entries, 1);
    const diagnostic = resolveCharacterMovementBatchWithDiagnostics(openState, entries, 1);

    expect(serialiseById(diagnostic.moved)).toEqual(serialiseById(ordinary));
    expect([...diagnostic.trajectories.keys()].sort()).toEqual(['a', 'b', 'c']);
    for (const trajectory of diagnostic.trajectories.values()) {
      expect(trajectory.length).toBeGreaterThan(0);
      expect(trajectory[0].startTime).toBe(0);
      expect(trajectory.at(-1).endTime).toBe(1);
    }
  });

  it('keeps local conflict movement within every actor budget', () => {
    const entries = threeWayCrossingEntries();
    const moved = resolveCharacterMovementBatch(openState, entries, 0.5);

    for (const { character, speed } of entries) {
      expect(Math.hypot(
        moved.get(character.id).x - character.x,
        moved.get(character.id).y - character.y,
      )).toBeLessThanOrEqual(speed * 0.5 + 1e-6);
    }
  });

  it('charges a bent travelled path rather than only its endpoint chord to the tick budget', () => {
    const actor = { id: 'bent', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const moved = resolveCharacterMovementBatch(openState, [{
      character: actor,
      speed: 40,
      targetAfterPath: { x: 120, y: 160 },
    }], 1).get(actor.id);

    const travelled = 20 + Math.hypot(moved.x - 120, moved.y - 100);
    expect(travelled).toBeLessThanOrEqual(40 + 1e-6);
    expect(moved).toMatchObject({ x: 120, y: 120 });
    expect(Math.hypot(moved.x - actor.x, moved.y - actor.y)).toBeLessThan(travelled);
  });

  it('keeps every swept leg of a bent movement clear of newly placed furniture', () => {
    const state = { ...openState, chairs: [{ id: 'swept-blocker', x: 120, y: 120 }] };
    const actor = { id: 'bent', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const moved = resolveCharacterMovementBatch(state, [{
      character: actor,
      speed: 80,
      targetAfterPath: { x: 120, y: 160 },
    }], 1).get(actor.id);

    expect(moved).toMatchObject({ x: 120, y: 100 });
    expect(buildBlockedCells(state).has(`${worldToCell(moved).x},${worldToCell(moved).y}`)).toBe(false);
  });

  it('prevents production exact-exit intents from swapping an opposing door edge within one tick', () => {
    const left = { id: 'left-exit', state: 'leaving', x: 880, y: 360, path: [] };
    const right = { id: 'right-exit', state: 'leaving', x: 900, y: 360, path: [] };
    const entries = [
      { character: left, speed: 20, target: { x: 900, y: 360 } },
      { character: right, speed: 20, target: { x: 880, y: 360 } },
    ];
    const metrics = createMovementMetrics();
    const withoutMetrics = resolveCharacterMovementBatch(openState, entries, 1);
    const moved = resolveCharacterMovementBatch(openState, entries, 1, metrics);

    expect(moved).toEqual(withoutMetrics);
    expect(metrics.safePrefixProbes).toBeGreaterThan(0);
    expect([moved.get(left.id).x, moved.get(right.id).x]).not.toEqual([900, 880]);
    const leftTrajectory = buildTimeParameterizedTrajectory(left, moved.get(left.id), 20, 1);
    const rightTrajectory = buildTimeParameterizedTrajectory(right, moved.get(right.id), 20, 1);
    expect(minimumTrajectoryDistance(leftTrajectory, rightTrajectory)).toBeGreaterThan(1e-9);
  });

  it('keeps an impossible controlled-overlap layout static when a conflicting peer is present', () => {
    const state = {
      ...openState,
      chairs: [
        { id: 'north', x: 100, y: 80 }, { id: 'south', x: 100, y: 120 },
        { id: 'west', x: 80, y: 100 },
      ],
    };
    const enclosed = {
      id: 'enclosed', x: 100, y: 100, path: [{ x: 8, y: 5 }],
      pathGoal: { x: 8, y: 5 }, stalledFor: 3, usingStaticFallback: true,
    };
    const peer = { id: 'peer', x: 102, y: 100, path: [], stalledFor: 0 };
    const moved = resolveCharacterMovementBatch(state, [
      { character: enclosed, speed: 60 },
      { character: peer, speed: 0 },
    ], 1);

    expect(findPath(state, worldToCell(enclosed), enclosed.pathGoal).length).toBeGreaterThan(0);
    expect(moved.get(enclosed.id)).toMatchObject({ x: 100, y: 100 });
    expect(Number.isFinite(moved.get(peer.id).x) && Number.isFinite(moved.get(peer.id).y)).toBe(true);
    expect(buildBlockedCells(state).has(`${worldToCell(moved.get(enclosed.id)).x},${worldToCell(moved.get(enclosed.id)).y}`)).toBe(false);
  });

  it('keeps furniture impassable while resolving a local crossing', () => {
    const state = { ...openState, chairs: [{ id: 'detour-blocker', x: 80, y: 80 }] };
    const entries = threeWayCrossingEntries();
    const moved = resolveCharacterMovementBatch(state, entries, 1);
    const blocked = buildBlockedCells(state);

    for (const { character } of entries) {
      const endpoint = moved.get(character.id);
      expect(blocked.has(`${worldToCell(endpoint).x},${worldToCell(endpoint).y}`)).toBe(false);
    }
  });

  it('lets one actor clear a contested vertex while another explicitly waits', () => {
    const state = {
      ...openState,
      chairs: [
        { id: 'north-west', x: 80, y: 80 },
        { id: 'west', x: 60, y: 100 },
        { id: 'south-west', x: 80, y: 120 },
      ],
    };
    const entries = [
      {
        character: {
          id: 'a-new', x: 80, y: 100,
          path: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }],
          pathGoal: { x: 7, y: 5 }, stalledFor: 0,
        },
        speed: 20,
      },
      {
        character: {
          id: 'z-old', x: 100, y: 80,
          path: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }],
          pathGoal: { x: 5, y: 7 }, stalledFor: 4,
        },
        speed: 20,
      },
      {
        character: {
          id: 'z-third', x: 120, y: 100,
          path: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
          pathGoal: { x: 3, y: 5 }, stalledFor: 0,
        },
        speed: 20,
      },
    ];
    const moved = resolveCharacterMovementBatch(state, entries, 1);

    const progressed = entries.filter(({ character }) => Math.hypot(
      moved.get(character.id).x - character.x,
      moved.get(character.id).y - character.y,
    ) > 0);
    expect(progressed.length).toBeGreaterThanOrEqual(1);
    expect(progressed.length).toBeLessThan(entries.length);
    expectAllEndpointPairsAtLeast(entries, moved, 16);
  });

  it('returns finite safely separated endpoints for a contentious 13-actor component', () => {
    const starts = [
      [8, 8], [9, 8], [10, 8], [11, 8], [12, 8],
      [8, 9], [12, 9], [8, 10], [12, 10],
      [8, 11], [9, 11], [11, 11], [12, 11],
    ];
    const entries = starts.map(([x, y], index) => ({
      character: {
        id: `crowd-${String(index).padStart(2, '0')}`,
        x: x * 20,
        y: y * 20,
        path: [{ x: 10, y: 10 }],
        pathGoal: { x: 10, y: 10 },
        stalledFor: index / 100,
      },
      speed: 200,
    }));
    const metrics = createMovementMetrics();
    const withoutMetrics = resolveCharacterMovementBatch(openState, entries, 1);
    const moved = resolveCharacterMovementBatch(openState, entries, 1, metrics);

    expect(moved).toEqual(withoutMetrics);
    for (const result of moved.values()) {
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    }
    expectAllEndpointPairsAtLeast(entries, moved, 16);
    expect(metrics.maxComponentSize).toBe(13);
    expect(metrics.solverCalls).toBeGreaterThan(0);
    expect(metrics.solverAgedFallback).toBe(metrics.solverCalls);
    expect([metrics.solverPbs, metrics.solverNull]).toEqual([0, 0]);
    expectSolverWrapperAccounting(metrics);
  });

  it('applies guide-party ignored IDs only to the exempt pair', () => {
    const entries = [
      { character: { id: 'guide', x: 80, y: 100, path: [] }, speed: 20, target: { x: 100, y: 100 }, ignoredIds: ['party'] },
      { character: { id: 'party', x: 120, y: 100, path: [] }, speed: 20, target: { x: 100, y: 100 }, ignoredIds: ['guide'] },
      { character: { id: 'outsider', x: 100, y: 80, path: [] }, speed: 20, target: { x: 100, y: 100 } },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    const outsider = moved.get('outsider');
    for (const id of ['guide', 'party']) {
      const exemptActor = moved.get(id);
      expect(Math.hypot(exemptActor.x - outsider.x, exemptActor.y - outsider.y))
        .toBeGreaterThanOrEqual(16 - 1e-6);
    }
  });

  it('uses solver coordination for an ignored pair transitively connected through an outsider', () => {
    const entries = [
      {
        character: { id: 'guide', x: 80, y: 100, path: [], stalledFor: 0 },
        speed: 20, target: { x: 100, y: 100 }, ignoredIds: ['party'],
      },
      {
        character: { id: 'party', x: 120, y: 100, path: [], stalledFor: 0 },
        speed: 20, target: { x: 100, y: 100 }, ignoredIds: ['guide'],
      },
      {
        character: { id: 'outsider', x: 100, y: 80, path: [], stalledFor: 0 },
        speed: 20, target: { x: 100, y: 100 }, ignoredIds: [],
      },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);
    const contestedArrivals = entries.filter(({ character }) => {
      const result = moved.get(character.id);
      return result.x === 100 && result.y === 100;
    });

    expect(contestedArrivals.length).toBeLessThanOrEqual(1);
    const outsider = moved.get('outsider');
    for (const id of ['guide', 'party']) {
      const exemptActor = moved.get(id);
      expect(Math.hypot(exemptActor.x - outsider.x, exemptActor.y - outsider.y))
        .toBeGreaterThanOrEqual(16 - 1e-6);
    }
  });

  it('uses the solver plan for an equal-age crossing component', () => {
    const entries = [
      { character: { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }] }, speed: 40 },
      { character: { id: 'b', x: 100, y: 80, path: [{ x: 5, y: 6 }] }, speed: 40 },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(moved.get('a')).not.toMatchObject({ x: 120, y: 100, path: [] });
    expect([...moved.values()].every(result => Number.isFinite(result.x) && Number.isFinite(result.y))).toBe(true);
  });

  it('uses the solver plan for an explicitly recovered head-on component', () => {
    const entries = [
      { character: { id: 'a', x: 180, y: 100, path: [{ x: 16, y: 5 }], stalledFor: 2, usingStaticFallback: true, headOnRecovery: true }, speed: 75, headOnDetourEligible: true },
      { character: { id: 'b', x: 200, y: 100, path: [{ x: 3, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(moved.get('a')).not.toMatchObject({ x: 180, y: 60 });
    expect([...moved.values()].every(result => Number.isFinite(result.x) && Number.isFinite(result.y))).toBe(true);
  });

  it('keeps solver-null fallback local while an outside actor moves away', () => {
    const mover = { id: 'mover', x: 80, y: 100, path: [], stalledFor: 2 };
    const fixed = { id: 'fixed', x: 80, y: 100, path: [], stalledFor: 0 };
    const outside = { id: 'outside', x: 85, y: 100, path: [], stalledFor: 0 };
    const moved = resolveCharacterMovementBatch(openState, [
      { character: mover, speed: 5, target: { x: 85, y: 100 } },
      { character: fixed, speed: 0 },
      { character: outside, speed: 20, target: { x: 105, y: 100 } },
    ], 1);

    expect(moved.get('outside')).toMatchObject({ x: 105, y: 100 });
    expect(moved.get('mover')).toMatchObject({ x: 85, y: 100 });
  });

  it('consumes a current-cell leading waypoint when the solver plan waits', () => {
    const waiting = {
      id: 'waiting', x: 100, y: 100,
      path: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
      pathGoal: { x: 6, y: 5 }, stalledFor: 0.2,
    };
    const crossing = {
      id: 'crossing', x: 80, y: 100,
      path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 }, stalledFor: 0,
    };
    const moved = resolveCharacterMovementBatch(openState, [
      { character: waiting, speed: 20 },
      { character: crossing, speed: 200 },
    ], 0.1);

    expect(moved.get('waiting').path).toEqual([{ x: 6, y: 5 }]);
  });

  it('accepts a safe bent solver detour even when its endpoint chord crosses a peer', () => {
    const actor = {
      id: 'actor', x: 80, y: 100,
      path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 }, stalledFor: 1,
    };
    const fixed = { id: 'fixed', x: 100, y: 100, path: [], stalledFor: 0 };
    const moved = resolveCharacterMovementBatch(openState, [
      { character: actor, speed: 160 },
      { character: fixed, speed: 0 },
    ], 1);

    expect(minimumTrajectoryDistance(
      buildTimeParameterizedTrajectory(actor, { x: 120, y: 100 }, 160, 1),
      buildTimeParameterizedTrajectory(fixed, fixed, 0, 1),
    )).toBeLessThan(16);
    expect(moved.get('actor')).toMatchObject({ x: 120, y: 100, path: [] });
  });

  it('continues through a contested desired waypoint to the furthest safe solver prefix', () => {
    const actor = {
      id: 'a', x: 80, y: 100,
      path: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
      pathGoal: { x: 6, y: 5 }, stalledFor: 1,
    };
    const peer = {
      id: 'b', x: 100, y: 80,
      path: [{ x: 5, y: 5 }],
      pathGoal: { x: 5, y: 5 }, stalledFor: 0,
    };
    const entries = [
      { character: actor, speed: 40 },
      { character: peer, speed: 20 },
    ];
    const metrics = createMovementMetrics();
    const withoutMetrics = resolveCharacterMovementBatch(openState, entries, 1);
    const moved = resolveCharacterMovementBatch(openState, entries, 1, metrics);

    expect(moved).toEqual(withoutMetrics);
    expect(moved.get('a')).toMatchObject({ x: 120, y: 100, path: [] });
    expect(moved.get('b')).toMatchObject({ x: 100, y: 90 });
    expect(Math.hypot(moved.get('a').x - actor.x, moved.get('a').y - actor.y))
      .toBeLessThanOrEqual(40 + 1e-6);
    expect(minimumTrajectoryDistance(
      [
        { start: { x: 80, y: 100 }, end: { x: 100, y: 100 }, startTime: 0, endTime: 0.5 },
        { start: { x: 100, y: 100 }, end: { x: 120, y: 100 }, startTime: 0.5, endTime: 1 },
      ],
      [
        { start: { x: 100, y: 80 }, end: { x: 100, y: 80 }, startTime: 0, endTime: 0.5 },
        { start: { x: 100, y: 80 }, end: { x: 100, y: 90 }, startTime: 0.5, endTime: 1 },
      ],
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('coordinates distant contested waypoints through every executable safe slot', () => {
    const actor = {
      id: 'a', x: 40, y: 100,
      path: [{ x: 10, y: 5 }], stalledFor: 1,
    };
    const peer = {
      id: 'b', x: 100, y: 40,
      path: [{ x: 5, y: 10 }], stalledFor: 0,
    };
    const moved = resolveCharacterMovementBatch(openState, [
      { character: actor, speed: 60 },
      { character: peer, speed: 60 },
    ], 1);

    expect(moved.get('a')).toMatchObject({ x: 100, y: 100, path: [{ x: 10, y: 5 }] });
    expect(moved.get('b')).toMatchObject({ x: 100, y: 80, path: [{ x: 5, y: 10 }] });
    for (const character of [actor, peer]) {
      expect(Math.hypot(
        moved.get(character.id).x - character.x,
        moved.get(character.id).y - character.y,
      )).toBeLessThanOrEqual(60 + 1e-6);
    }
    expect(minimumTrajectoryDistance(
      [
        { start: { x: 40, y: 100 }, end: { x: 60, y: 100 }, startTime: 0, endTime: 1 / 3 },
        { start: { x: 60, y: 100 }, end: { x: 80, y: 100 }, startTime: 1 / 3, endTime: 2 / 3 },
        { start: { x: 80, y: 100 }, end: { x: 100, y: 100 }, startTime: 2 / 3, endTime: 1 },
      ],
      [
        { start: { x: 100, y: 40 }, end: { x: 100, y: 60 }, startTime: 0, endTime: 1 / 3 },
        { start: { x: 100, y: 60 }, end: { x: 100, y: 60 }, startTime: 1 / 3, endTime: 2 / 3 },
        { start: { x: 100, y: 60 }, end: { x: 100, y: 80 }, startTime: 2 / 3, endTime: 1 },
      ],
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('keeps an unscoped solver plan directed at the active waypoint', () => {
    const actor = {
      id: 'a', x: 40, y: 100,
      path: [{ x: 10, y: 5 }, { x: 2, y: 10 }], stalledFor: 1,
    };
    const peer = {
      id: 'b', x: 100, y: 40,
      path: [{ x: 5, y: 10 }], stalledFor: 0,
    };
    const entries = [
      { character: actor, speed: 60 },
      { character: peer, speed: 60 },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(moved.get('a')).toMatchObject({
      x: 100, y: 100,
      path: [{ x: 10, y: 5 }, { x: 2, y: 10 }],
    });
    expect(moved.get('b')).toMatchObject({ x: 100, y: 80, path: [{ x: 5, y: 10 }] });
    expect(moved.get('a').x).toBeGreaterThan(actor.x);
    expect(moved.get('a').y).toBe(actor.y);
    for (const { character, speed } of entries) {
      expect(Math.hypot(
        moved.get(character.id).x - character.x,
        moved.get(character.id).y - character.y,
      )).toBeLessThanOrEqual(speed + 1e-6);
    }
    expect(minimumTrajectoryDistance(
      buildTimeParameterizedTrajectory(actor, moved.get('a'), 60, 1),
      buildTimeParameterizedTrajectory(peer, moved.get('b'), 60, 1),
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('uses the safe remaining tick budget after an off-grid partial cell', () => {
    const actor = {
      id: 'a', x: 59, y: 100,
      path: [{ x: 10, y: 5 }], stalledFor: 1,
    };
    const peer = {
      id: 'b', x: 100, y: 59,
      path: [{ x: 5, y: 10 }], stalledFor: 0,
    };
    const entries = [
      { character: actor, speed: 60 },
      { character: peer, speed: 60 },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(moved.get('a')).toMatchObject({ x: 119, y: 100, path: [{ x: 10, y: 5 }] });
    expect(moved.get('b')).toMatchObject({ x: 100, path: [{ x: 5, y: 10 }] });
    expect(moved.get('b').y).toBeCloseTo(84, 5);
    expect(moved.get('a').x).toBeGreaterThan(actor.x);
    expect(moved.get('a').y).toBe(actor.y);
    for (const { character, speed } of entries) {
      expect(Math.hypot(
        moved.get(character.id).x - character.x,
        moved.get(character.id).y - character.y,
      )).toBeLessThanOrEqual(speed + 1e-6);
    }
    expect(minimumTrajectoryDistance(
      buildTimeParameterizedTrajectory(actor, moved.get('a'), 60, 1),
      buildTimeParameterizedTrajectory(peer, moved.get('b'), 60, 1),
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('stops an offset-preserving solver detour at the right world boundary', () => {
    const state = {
      ...openState,
      chairs: [
        { id: 'upper', x: 1000, y: 80 },
        { id: 'left-a', x: 980, y: 100 },
        { id: 'left-b', x: 980, y: 120 },
        { id: 'lower', x: 1000, y: 140 },
      ],
    };
    const actor = {
      id: 'a', x: 1019, y: 100,
      path: [{ x: 50, y: 6 }], stalledFor: 0,
    };
    const peer = {
      id: 'b', x: 1019, y: 120,
      path: [{ x: 50, y: 5 }], stalledFor: 1,
    };
    const moved = resolveCharacterMovementBatch(state, [
      { character: actor, speed: 60 },
      { character: peer, speed: 60 },
    ], 0.5);
    const reversedPriority = resolveCharacterMovementBatch(state, [
      { character: { ...actor, stalledFor: 1 }, speed: 60 },
      { character: { ...peer, stalledFor: 0 }, speed: 60 },
    ], 0.5);
    const world = getRestaurantWorld(state.restaurant);
    for (const result of [moved, reversedPriority]) {
      for (const character of result.values()) {
        expect(character.x).toBeLessThanOrEqual(world.queueX + world.queueW);
      }
    }
    expect(Math.max(...[...reversedPriority.values()].map(character => character.x)))
      .toBeCloseTo(world.queueX + world.queueW, 6);
    expect(reversedPriority.get('a')).toMatchObject({
      x: world.queueX + world.queueW,
      y: actor.y,
      path: actor.path,
      localConflictTarget: { x: 51, y: 5 },
      stalledFor: 1.5,
    });
    expect(minimumTrajectoryDistance(
      buildTimeParameterizedTrajectory(actor, moved.get('a'), 60, 0.5),
      buildTimeParameterizedTrajectory(peer, moved.get('b'), 60, 0.5),
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('stops an offset-preserving solver detour at the bottom world boundary', () => {
    const state = {
      ...openState,
      chairs: [
        { id: 'left', x: 80, y: 640 },
        { id: 'upper-a', x: 100, y: 620 },
        { id: 'upper-b', x: 120, y: 620 },
        { id: 'right', x: 140, y: 640 },
      ],
    };
    const actor = {
      id: 'a', x: 100, y: 659,
      path: [{ x: 6, y: 32 }], stalledFor: 0,
    };
    const peer = {
      id: 'b', x: 120, y: 659,
      path: [{ x: 5, y: 32 }], stalledFor: 1,
    };
    const moved = resolveCharacterMovementBatch(state, [
      { character: actor, speed: 60 },
      { character: peer, speed: 60 },
    ], 0.5);
    const world = getRestaurantWorld(state.restaurant);
    const bottom = world.diningY + world.areaH + 50;
    for (const character of moved.values()) {
      expect(character.y).toBeLessThanOrEqual(bottom);
    }
    expect(moved.get('b').y).toBeCloseTo(bottom, 6);
    expect(moved.get('b').y).not.toBe(660);
    expect(moved.get('b')).toMatchObject({
      x: peer.x,
      y: bottom,
      path: peer.path,
      localConflictTarget: { x: 6, y: 33 },
      stalledFor: 1.5,
    });
    expect(minimumTrajectoryDistance(
      buildTimeParameterizedTrajectory(actor, moved.get('a'), 60, 0.5),
      buildTimeParameterizedTrajectory(peer, moved.get('b'), 60, 0.5),
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('preserves the fast-path endpoint and path consumption for one uncongested actor', () => {
    const character = { id: 'solo', x: 100, y: 100, path: [{ x: 6, y: 5 }, { x: 8, y: 5 }] };
    const expected = moveCharacterAlongPath(character, 1, [], 20, 16, openState);
    const moved = resolveCharacterMovementBatch(openState, [{ character, speed: 20 }], 1).get('solo');

    expect({ x: moved.x, y: moved.y, path: moved.path })
      .toEqual({ x: expected.x, y: expected.y, path: expected.path });
  });

  it('moves an unrelated actor despite a pre-existing stationary overlap elsewhere', () => {
    const mover = { id: 'mover', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const overlapA = { id: 'overlap-a', x: 300, y: 300, path: [] };
    const overlapB = { id: 'overlap-b', x: 300, y: 300, path: [] };

    const moved = resolveCharacterMovementBatch(openState, [
      { character: mover, speed: 20, ignoredIds: [] },
      { character: overlapA, speed: 0, ignoredIds: [] },
      { character: overlapB, speed: 0, ignoredIds: [] },
    ], 1);

    expect(moved.get('mover')).toMatchObject({ x: 120, y: 100 });
  });

  it('allows actors that start too close to separate', () => {
    const left = { id: 'left', x: 100, y: 100, path: [{ x: 4, y: 5 }] };
    const right = { id: 'right', x: 108, y: 100, path: [{ x: 7, y: 5 }] };

    const moved = resolveCharacterMovementBatch(openState, [
      { character: left, speed: 20, ignoredIds: [] },
      { character: right, speed: 20, ignoredIds: [] },
    ], 1);

    expect(moved.get('left').x).toBeLessThan(100);
    expect(moved.get('right').x).toBeGreaterThan(108);
  });

  it('does not let actors that start too close reduce their starting distance', () => {
    const approaching = { id: 'a-approaching', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const stationary = { id: 'b-stationary', x: 108, y: 100, path: [] };

    const moved = resolveCharacterMovementBatch(openState, [
      { character: approaching, speed: 20, ignoredIds: [] },
      { character: stationary, speed: 0, ignoredIds: [] },
    ], 1);

    const startDistance = 8;
    const finalDistance = Math.hypot(
      moved.get('a-approaching').x - moved.get('b-stationary').x,
      moved.get('a-approaching').y - moved.get('b-stationary').y,
    );
    expect(finalDistance).toBeGreaterThanOrEqual(startDistance - 1e-6);
  });

  it('rejects a below-spacing route whose endpoints recover after worsening swept separation', () => {
    const crossing = { id: 'a-crossing', x: 100, y: 100, path: [] };
    const stationary = { id: 'b-stationary', x: 108, y: 100, path: [] };
    const target = { x: 120, y: 100 };
    const startDistance = 8;
    const desiredCrossing = buildTimeParameterizedTrajectory(crossing, target, 20, 1);
    const stationaryTrajectory = buildTimeParameterizedTrajectory(stationary, stationary, 0, 1);

    expect(Math.hypot(target.x - stationary.x, target.y - stationary.y))
      .toBeGreaterThanOrEqual(startDistance);
    expect(minimumTrajectoryDistance(desiredCrossing, stationaryTrajectory))
      .toBeLessThan(startDistance);

    const moved = resolveCharacterMovementBatch(openState, [
      { character: crossing, speed: 20, target, ignoredIds: [] },
      { character: stationary, speed: 0, ignoredIds: [] },
    ], 1);
    const acceptedCrossing = buildTimeParameterizedTrajectory(crossing, moved.get(crossing.id), 20, 1);
    const acceptedStationary = buildTimeParameterizedTrajectory(stationary, moved.get(stationary.id), 0, 1);

    expect(minimumTrajectoryDistance(acceptedCrossing, acceptedStationary))
      .toBeGreaterThanOrEqual(startDistance - 1e-6);
  });

  it('keeps unrelated movement through final validation while overlapped movers separate', () => {
    const mover = { id: 'mover', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const overlapA = { id: 'overlap-a', x: 300, y: 300, path: [] };
    const overlapB = { id: 'overlap-b', x: 308, y: 300, path: [] };
    const startDistance = 8;

    const moved = resolveCharacterMovementBatch(openState, [
      { character: mover, speed: 20, ignoredIds: [] },
      { character: overlapA, speed: 20, target: { x: 280, y: 300 }, ignoredIds: [] },
      { character: overlapB, speed: 20, target: { x: 328, y: 300 }, ignoredIds: [] },
    ], 1);
    const acceptedA = buildTimeParameterizedTrajectory(overlapA, moved.get(overlapA.id), 20, 1);
    const acceptedB = buildTimeParameterizedTrajectory(overlapB, moved.get(overlapB.id), 20, 1);

    expect(moved.get(mover.id)).toMatchObject({ x: 120, y: 100 });
    expect(moved.get(overlapA.id).x).toBeLessThan(overlapA.x);
    expect(moved.get(overlapB.id).x).toBeGreaterThan(overlapB.x);
    expect(minimumTrajectoryDistance(acceptedA, acceptedB))
      .toBeGreaterThanOrEqual(startDistance - 1e-6);
  });

  it('retains normal spacing for actors that start safely separated', () => {
    const left = { id: 'left', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const right = { id: 'right', x: 140, y: 100, path: [{ x: 6, y: 5 }] };

    const moved = resolveCharacterMovementBatch(openState, [
      { character: left, speed: 20, ignoredIds: [] },
      { character: right, speed: 20, ignoredIds: [] },
    ], 1);

    expect(Math.hypot(
      moved.get('left').x - moved.get('right').x,
      moved.get('left').y - moved.get('right').y,
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('coordinates equal-age crossing segments within movement budgets', () => {
    const a = { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }] };
    const b = { id: 'b', x: 100, y: 80, path: [{ x: 5, y: 6 }] };
    const moved = resolveCharacterMovementBatch(openState, [
      { character: b, speed: 40 },
      { character: a, speed: 40 },
    ], 1);

    expect(['a', 'b'].filter(id => Math.hypot(
      moved.get(id).x - (id === 'a' ? a.x : b.x),
      moved.get(id).y - (id === 'a' ? a.y : b.y),
    ) > 0)).not.toHaveLength(0);
    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
    for (const character of [a, b]) {
      expect(Math.hypot(moved.get(character.id).x - character.x, moved.get(character.id).y - character.y))
        .toBeLessThanOrEqual(40 + 1e-6);
    }
  });

  it('does not commit two actors to one endpoint', () => {
    const entries = [
      { character: { id: 'a', x: 80, y: 100, path: [{ x: 5, y: 5 }] }, speed: 20 },
      { character: { id: 'b', x: 120, y: 100, path: [{ x: 5, y: 5 }] }, speed: 20 },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);
    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('keeps converging actors separated within their movement budgets', () => {
    const entries = [
      { character: { id: 'a', x: 80, y: 100, path: [{ x: 5, y: 5 }] }, speed: 20 },
      { character: { id: 'b', x: 120, y: 100, path: [{ x: 5, y: 5 }] }, speed: 20 },
    ];

    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
    expect(entries.some(({ character }) => Math.hypot(
      moved.get(character.id).x - character.x,
      moved.get(character.id).y - character.y,
    ) > 0)).toBe(true);
    for (const { character, speed } of entries) {
      expect(Math.hypot(moved.get(character.id).x - character.x, moved.get(character.id).y - character.y))
        .toBeLessThanOrEqual(speed + 1e-6);
    }
  });

  it('preserves a consumed first leg while safely coordinating a bent continuation', () => {
    const actor = { id: 'a', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const blocker = { id: 'z-blocker', x: 120, y: 140, path: [] };

    const moved = resolveCharacterMovementBatch(openState, [
      { character: actor, speed: 60, targetAfterPath: { x: 120, y: 160 } },
      { character: blocker, speed: 0 },
    ], 1);

    expect(moved.get('a')).toMatchObject({ x: 120, path: [], stalledFor: 0 });
    expect(Math.hypot(moved.get('a').x - blocker.x, moved.get('a').y - blocker.y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
    expect(Math.hypot(moved.get('a').x - actor.x, moved.get('a').y - actor.y))
      .toBeLessThanOrEqual(60 + 1e-6);
  });

  it('returns identical ID-keyed results when entries are reversed', () => {
    const entries = [
      { character: { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }] }, speed: 40 },
      { character: { id: 'b', x: 100, y: 80, path: [{ x: 5, y: 6 }] }, speed: 40 },
    ];
    const serialise = result => [...result].sort(([left], [right]) => left.localeCompare(right));
    expect(serialise(resolveCharacterMovementBatch(openState, entries, 1)))
      .toEqual(serialise(resolveCharacterMovementBatch(openState, [...entries].reverse(), 1)));
  });

  it('never exceeds each entry movement budget', () => {
    const character = { id: 'a', x: 80, y: 100, path: [{ x: 20, y: 5 }] };
    const moved = resolveCharacterMovementBatch(openState, [{ character, speed: 30 }], 0.5).get('a');
    expect(Math.hypot(moved.x - character.x, moved.y - character.y)).toBeLessThanOrEqual(15 + 1e-6);
  });

  it('never accepts an endpoint inside static geometry', () => {
    const state = { ...openState, chairs: [{ id: 'chair', x: 100, y: 100 }] };
    const character = { id: 'a', x: 80, y: 100, path: [{ x: 5, y: 5 }] };
    const moved = resolveCharacterMovementBatch(state, [{ character, speed: 20 }], 1).get('a');
    expect(buildBlockedCells(state).has(`${worldToCell(moved).x},${worldToCell(moved).y}`)).toBe(false);
  });

  it('does not let a priority actor pass through a yielding actor start', () => {
    const moving = { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }] };
    const clearing = { id: 'b', x: 100, y: 100, path: [{ x: 5, y: 7 }] };
    const moved = resolveCharacterMovementBatch(openState, [
      { character: moving, speed: 40 },
      { character: clearing, speed: 40 },
    ], 1);
    expect(moved.get('a').x).toBeCloseTo(84, 5);
    expect(moved.get('a').y).toBe(100);
    expect(moved.get('b').y).toBeGreaterThan(100);
  });

  it('rejects an unsafe early-arrival detour and keeps lexical progress on the desired line', () => {
    const state = { ...openState, chairs: [{ id: 'south-side-blocker', x: 180, y: 140 }] };
    const entries = [
      { character: { id: 'a', x: 180, y: 100, path: [{ x: 16, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
      { character: { id: 'b', x: 200, y: 100, path: [{ x: 3, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
      { character: { id: 'third', x: 100, y: 60, path: [] }, speed: 75, target: { x: 175, y: 60 } },
    ];
    const moved = resolveCharacterMovementBatch(state, entries, 1);

    const earlyArrival = buildTimeParameterizedTrajectory(
      entries[0].character,
      { x: 180, y: 60 },
      entries[0].speed,
      1,
    );
    const thirdActor = buildTimeParameterizedTrajectory(
      entries[2].character,
      entries[2].target,
      entries[2].speed,
      1,
    );

    expect(minimumTrajectoryDistance(earlyArrival, thirdActor)).toBeLessThan(16);
    expect(moved.get('a').x).toBeGreaterThan(entries[0].character.x);
    expect(moved.get('a')).toMatchObject({ y: 100, path: [{ x: 16, y: 5 }] });
    expect(moved.get('third')).toMatchObject({ x: 175, y: 60 });
  });

  it('coordinates a flagged horizontal crossing before explicit recovery', () => {
    const entries = [
      { character: { id: 'a', x: 180, y: 100, path: [{ x: 16, y: 5 }] }, speed: 75, headOnDetourEligible: true },
      { character: { id: 'b', x: 200, y: 100, path: [{ x: 3, y: 5 }] }, speed: 75, headOnDetourEligible: true },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);
    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
    expect(entries.some(({ character }) => Math.hypot(
      moved.get(character.id).x - character.x,
      moved.get(character.id).y - character.y,
    ) > 0)).toBe(true);
  });

  it('coordinates recovered flagged actors without unsafe convergence', () => {
    const entries = [
      { character: { id: 'a', x: 100, y: 100, path: [], stalledFor: 2, usingStaticFallback: true }, speed: 75,
        target: { x: 140, y: 120 }, headOnDetourEligible: true },
      { character: { id: 'b', x: 140, y: 120, path: [], stalledFor: 2, usingStaticFallback: true }, speed: 75,
        target: { x: 100, y: 100 }, headOnDetourEligible: true },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
    expect(entries.some(({ character }) => Math.hypot(
      moved.get(character.id).x - character.x,
      moved.get(character.id).y - character.y,
    ) > 0)).toBe(true);
  });

  it('coordinates a production-flagged ordinary diagonal convergence', () => {
    const entries = [
      { character: { id: 'a', x: 100, y: 100, path: [{ x: 7, y: 6 }], stalledFor: 2, usingStaticFallback: true }, speed: 75,
        allowStaticFallbackCrossing: true, movementRecovery: true, headOnDetourEligible: true },
      { character: { id: 'b', x: 140, y: 120, path: [{ x: 5, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 75,
        allowStaticFallbackCrossing: true, movementRecovery: true, headOnDetourEligible: true },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('coordinates a production-flagged ordinary perpendicular crossing', () => {
    const entries = [
      { character: { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 40,
        headOnDetourEligible: true },
      { character: { id: 'b', x: 100, y: 80, path: [{ x: 5, y: 6 }], stalledFor: 2, usingStaticFallback: true }, speed: 40,
        headOnDetourEligible: true },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('uses a side-space detour for two explicitly recovered horizontal head-on actors', () => {
    const entries = [
      { character: { id: 'a', x: 180, y: 100, path: [{ x: 16, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
      { character: { id: 'b', x: 200, y: 100, path: [{ x: 3, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
    for (const { character, speed } of entries) {
      expect(Math.hypot(moved.get(character.id).x - character.x, moved.get(character.id).y - character.y))
        .toBeLessThanOrEqual(speed + 1e-6);
    }
  });

  it('validates recovered head-on detours against below-spacing moving pairs', () => {
    const recoveredHeadOnEntries = () => [
      { character: { id: 'a', x: 180, y: 100, path: [{ x: 16, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
      { character: { id: 'b', x: 200, y: 100, path: [{ x: 3, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
    ];
    const overlapA = { id: 'c-overlap', x: 300, y: 300, path: [] };
    const overlapB = { id: 'd-overlap', x: 308, y: 300, path: [] };
    const startDistance = 8;

    const separated = resolveCharacterMovementBatch(openState, [
      ...recoveredHeadOnEntries(),
      { character: overlapA, speed: 20, target: { x: 280, y: 300 }, ignoredIds: [] },
      { character: overlapB, speed: 20, target: { x: 328, y: 300 }, ignoredIds: [] },
    ], 1);
    const separatedA = buildTimeParameterizedTrajectory(overlapA, separated.get(overlapA.id), 20, 1);
    const separatedB = buildTimeParameterizedTrajectory(overlapB, separated.get(overlapB.id), 20, 1);

    expect(minimumTrajectoryDistance(separatedA, separatedB))
      .toBeGreaterThanOrEqual(startDistance - 1e-6);

    const worseningTarget = { x: 320, y: 300 };
    const worseningDesired = buildTimeParameterizedTrajectory(overlapA, worseningTarget, 20, 1);
    const stationaryDesired = buildTimeParameterizedTrajectory(overlapB, overlapB, 0, 1);
    expect(Math.hypot(worseningTarget.x - overlapB.x, worseningTarget.y - overlapB.y))
      .toBeGreaterThanOrEqual(startDistance);
    expect(minimumTrajectoryDistance(worseningDesired, stationaryDesired))
      .toBeLessThan(startDistance);

    const protectedResult = resolveCharacterMovementBatch(openState, [
      ...recoveredHeadOnEntries(),
      { character: overlapA, speed: 20, target: worseningTarget, ignoredIds: [] },
      { character: overlapB, speed: 0, ignoredIds: [] },
    ], 1);
    const protectedA = buildTimeParameterizedTrajectory(overlapA, protectedResult.get(overlapA.id), 20, 1);
    const protectedB = buildTimeParameterizedTrajectory(overlapB, protectedResult.get(overlapB.id), 0, 1);

    expect(protectedResult.get('a').y).toBe(100);
    expect(minimumTrajectoryDistance(protectedA, protectedB))
      .toBeGreaterThanOrEqual(startDistance - 1e-6);
  });

  it('uses the legal side when a recovered head-on detour is beside the kitchen boundary', () => {
    const entries = [
      { character: { id: 'a', x: 180, y: 60, path: [{ x: 16, y: 3 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
      { character: { id: 'b', x: 200, y: 60, path: [{ x: 3, y: 3 }], stalledFor: 2, usingStaticFallback: true }, speed: 75, headOnDetourEligible: true },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
    const blocked = buildBlockedCells(openState);
    for (const result of moved.values()) {
      expect(blocked.has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
    }
  });

  it('rejects a low-budget partial detour whose complete side leg is statically blocked', () => {
    const state = { ...openState, chairs: [{ id: 'blocked-north-target', x: 180, y: 60 }] };
    const entries = [
      { character: { id: 'a', x: 180, y: 100, path: [{ x: 16, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 10, headOnDetourEligible: true },
      { character: { id: 'b', x: 200, y: 100, path: [{ x: 3, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 10, headOnDetourEligible: true },
    ];
    const moved = resolveCharacterMovementBatch(state, entries, 1);

    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(6 - 1e-6);
    for (const { character, speed } of entries) {
      const result = moved.get(character.id);
      expect(Math.hypot(result.x - character.x, result.y - character.y)).toBeLessThanOrEqual(speed + 1e-6);
      expect(buildBlockedCells(state).has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
    }
  });

  it('gives the recovered lower ID its furthest safe prefix when both detour sides are blocked', () => {
    const state = {
      ...openState,
      chairs: [
        { id: 'north-blocker', x: 180, y: 60 },
        { id: 'south-blocker', x: 180, y: 140 },
      ],
    };
    const entries = [
      { character: { id: 'a', x: 180, y: 100, path: [{ x: 16, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 20, headOnDetourEligible: true },
      { character: { id: 'b', x: 200, y: 100, path: [{ x: 3, y: 5 }], stalledFor: 2, usingStaticFallback: true }, speed: 20, headOnDetourEligible: true },
    ];

    const moved = resolveCharacterMovementBatch(state, entries, 1);

    for (const { character, speed } of entries) {
      const result = moved.get(character.id);
      expect(Math.hypot(result.x - character.x, result.y - character.y)).toBeLessThanOrEqual(speed + 1e-6);
      expect(buildBlockedCells(state).has(`${worldToCell(result).x},${worldToCell(result).y}`)).toBe(false);
    }
    expect(minimumTrajectoryDistance(
      buildTimeParameterizedTrajectory(entries[0].character, moved.get('a'), 20, 1),
      buildTimeParameterizedTrajectory(entries[1].character, moved.get('b'), 20, 1),
    )).toBeGreaterThanOrEqual(6 - 1e-6);
  });

  it('times sub-unit movement from the actual positive movement budget', () => {
    const trajectory = buildTimeParameterizedTrajectory(
      { x: 100, y: 100 },
      { x: 100.5, y: 100 },
      0.75,
      1,
    );

    expect(trajectory).toEqual([
      { start: { x: 100, y: 100 }, end: { x: 100.5, y: 100 }, startTime: 0, endTime: 2 / 3 },
      { start: { x: 100.5, y: 100 }, end: { x: 100.5, y: 100 }, startTime: 2 / 3, endTime: 1 },
    ]);
  });

  it('preserves a queued path for direct-target movement unless consumption is explicit', () => {
    const character = { id: 'direct', x: 80, y: 100, path: [{ x: 6, y: 5 }, { x: 7, y: 5 }] };
    const target = { x: 120, y: 100 };

    const defaultResult = resolveCharacterMovementBatch(openState, [{ character, speed: 40, target }], 1).get('direct');
    expect(defaultResult.path).toEqual(character.path);

    const explicitResult = resolveCharacterMovementBatch(openState, [{ character, speed: 40, target, consumePath: true }], 1).get('direct');
    expect(explicitResult.path).toEqual(character.path.slice(1));

    const unrelatedTargetResult = resolveCharacterMovementBatch(openState, [{
      character, speed: 60, target: { x: 140, y: 100 }, consumePath: true,
    }], 1).get('direct');
    expect(unrelatedTargetResult.path).toEqual(character.path);
  });

  it('makes the furthest safe progress towards a dynamically blocked pathless direct target', () => {
    const direct = { id: 'direct', x: 80, y: 100, path: [] };
    const clearing = { id: 'clearing', x: 100, y: 100, path: [{ x: 5, y: 7 }] };
    const moved = resolveCharacterMovementBatch(openState, [
      { character: direct, speed: 40, target: { x: 120, y: 100 } },
      { character: clearing, speed: 40 },
    ], 1);

    expect(moved.get('direct').x).toBeGreaterThan(80);
    expect(moved.get('direct').x).toBeLessThan(120);
    expect(moved.get('direct')).toMatchObject({ y: 100, stalledFor: 0 });

    const alreadyThere = resolveCharacterMovementBatch(openState, [{
      character: { id: 'already-there', x: 100, y: 100, path: [] },
      speed: 0,
      target: { x: 100, y: 100 },
    }], 1).get('already-there');
    expect(alreadyThere.stalledFor).toBe(0);
  });

  it('keeps dynamic recovery separate from the two-second static fallback', () => {
    const peers = [
      { id: 'north', x: 100, y: 80, path: [] },
      { id: 'south', x: 100, y: 120, path: [] },
      { id: 'west', x: 80, y: 100, path: [] },
      { id: 'east', x: 120, y: 100, path: [] },
    ];
    const actor = {
      id: 'actor', x: 100, y: 100, path: [{ x: 7, y: 5 }], pathGoal: { x: 7, y: 5 },
    };
    const entries = [
      { character: actor, speed: 0 },
      ...peers.map(character => ({ character, speed: 0 })),
    ];

    const dynamicOnly = resolveCharacterMovementBatch(openState, entries, 0.75).get('actor');
    expect(dynamicOnly).toMatchObject({ usingStaticFallback: false, minimumSpacing: 16, stalledFor: 0.75 });
    expect(dynamicOnly.path).toEqual(actor.path);

    const staticFallback = resolveCharacterMovementBatch(openState, entries, 2).get('actor');
    expect(staticFallback).toMatchObject({ usingStaticFallback: true, minimumSpacing: 16, stalledFor: 2 });
  });

  it('preserves an existing static fallback during pre-two-second no-progress recovery', () => {
    const character = {
      id: 'fallback', x: 100, y: 100, path: [{ x: 7, y: 5 }], pathGoal: { x: 7, y: 5 },
      stalledFor: 1, minimumSpacing: 6, usingStaticFallback: true,
    };
    const moved = resolveCharacterMovementBatch(openState, [{ character, speed: 0 }], 0.25).get('fallback');

    expect(moved).toMatchObject({ stalledFor: 1.25, usingStaticFallback: true, minimumSpacing: 16 });
  });

  it('does not create static fallback during a normal 0.75-second dynamic replan', () => {
    const character = {
      id: 'normal', x: 100, y: 100, path: [{ x: 7, y: 5 }], pathGoal: { x: 7, y: 5 },
      stalledFor: 0, minimumSpacing: 16, usingStaticFallback: false,
    };
    const moved = resolveCharacterMovementBatch(openState, [{ character, speed: 0 }], 0.75).get('normal');

    expect(moved).toMatchObject({ stalledFor: 0.75, usingStaticFallback: false, minimumSpacing: 16 });
  });

  it('preserves the unreached path when dynamic and static replanning both fail', () => {
    const state = { ...openState, chairs: [{ id: 'blocked-goal', x: 100, y: 100 }] };
    const character = {
      id: 'stuck', x: 80, y: 100, path: [{ x: 5, y: 5 }], pathGoal: { x: 5, y: 5 },
    };
    const moved = resolveCharacterMovementBatch(state, [{ character, speed: 0 }], 2).get('stuck');

    expect(moved.path).toEqual(character.path);
    expect(moved).toMatchObject({ stalledFor: 2, usingStaticFallback: true, minimumSpacing: 16 });
  });

  it('returns swept-safe endpoints when pair resolution reaches its safety limit', () => {
    const entries = [
      { character: { id: 'a', x: 360, y: 345, path: [] }, speed: 500, target: { x: 280, y: 290 } },
      { character: { id: 'b', x: 360, y: 395, path: [] }, speed: 500, target: { x: 320, y: 240 } },
      { character: { id: 'c', x: 295, y: 295, path: [] }, speed: 500, target: { x: 380, y: 395 } },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);
    const starts = new Map(entries.map(({ character }) => [character.id, character]));
    const ids = entries.map(({ character }) => character.id);

    for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
        const left = starts.get(ids[leftIndex]);
        const right = starts.get(ids[rightIndex]);
        const leftEntry = entries.find(entry => entry.character.id === left.id);
        const rightEntry = entries.find(entry => entry.character.id === right.id);
        expect(minimumTrajectoryDistance(
          buildTimeParameterizedTrajectory(left, moved.get(left.id), leftEntry.speed, 1),
          buildTimeParameterizedTrajectory(right, moved.get(right.id), rightEntry.speed, 1),
        ))
          .toBeGreaterThanOrEqual(16 - 1e-6);
      }
    }
  });

  it('allows an explicitly ignored actor pair to share its direct endpoint', () => {
    const entries = [
      { character: { id: 'a', x: 80, y: 100, path: [] }, speed: 20, target: { x: 100, y: 100 }, ignoredIds: ['b'] },
      { character: { id: 'b', x: 120, y: 100, path: [] }, speed: 20, target: { x: 100, y: 100 } },
    ];
    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(moved.get('a')).toMatchObject({ x: 100, y: 100 });
    expect(moved.get('b')).toMatchObject({ x: 100, y: 100 });
  });

  it('continues to the exact target after consuming a final path waypoint', () => {
    const character = { id: 'a', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const moved = resolveCharacterMovementBatch(openState, [{
      character, speed: 60, targetAfterPath: { x: 180, y: 100 },
    }], 1).get('a');

    expect(moved).toMatchObject({ x: 160, y: 100, path: [] });
    expect(Math.hypot(moved.x - character.x, moved.y - character.y)).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('stops final-target continuation at static geometry', () => {
    const state = { ...openState, chairs: [{ id: 'wall', x: 140, y: 100 }] };
    const character = { id: 'a', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const moved = resolveCharacterMovementBatch(state, [{
      character, speed: 60, targetAfterPath: { x: 180, y: 100 },
    }], 1).get('a');

    expect(moved).toMatchObject({ x: 120, y: 100, path: [] });
    expect(buildBlockedCells(state).has(`${worldToCell(moved).x},${worldToCell(moved).y}`)).toBe(false);
  });

  it('resolves a moving peer crossing the first leg of a bent continuation', () => {
    const actor = { id: 'a', x: 100, y: 100, path: [{ x: 6, y: 5 }] };
    const peer = { id: 'b', x: 120, y: 80, path: [] };
    const actorEndpoint = { x: 120, y: 140 };
    const peerEndpoint = { x: 120, y: 120 };

    expect(minimumSweptDistance(actor, actorEndpoint, peer, peerEndpoint))
      .toBeGreaterThanOrEqual(16);

    const moved = resolveCharacterMovementBatch(openState, [
      { character: actor, speed: 60, targetAfterPath: actorEndpoint },
      { character: peer, speed: 40, target: peerEndpoint },
    ], 1);

    expect(moved.get('a')).toMatchObject({ x: 120, path: [] });
    expect(Math.hypot(moved.get('a').x - moved.get('b').x, moved.get('a').y - moved.get('b').y))
      .toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('moves both horizontal opposing actors beyond their initial cells within a bounded number of ticks', () => {
    const initialEntries = [
      {
        character: {
          id: 'left', x: 180, y: 100,
          path: [{ x: 16, y: 5 }], pathGoal: { x: 16, y: 5 },
        },
        speed: 60,
      },
      {
        character: {
          id: 'right', x: 220, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
        },
        speed: 60,
      },
    ];

    const { entries } = simulateMovementTicks(openState, initialEntries, 360);

    expect(entries.find(entry => entry.character.id === 'left').character.x).toBeGreaterThan(220);
    expect(entries.find(entry => entry.character.id === 'right').character.x).toBeLessThan(180);
  });

  it('moves both vertical opposing actors beyond their initial cells within a bounded number of ticks', () => {
    const initialEntries = [
      {
        character: {
          id: 'upper', x: 100, y: 180,
          path: [{ x: 5, y: 16 }], pathGoal: { x: 5, y: 16 },
        },
        speed: 60,
      },
      {
        character: {
          id: 'lower', x: 100, y: 220,
          path: [{ x: 5, y: 3 }], pathGoal: { x: 5, y: 3 },
        },
        speed: 60,
      },
    ];

    const { entries } = simulateMovementTicks(openState, initialEntries, 240);

    expect(entries.find(entry => entry.character.id === 'upper').character.y).toBeGreaterThan(220);
    expect(entries.find(entry => entry.character.id === 'lower').character.y).toBeLessThan(180);
  });

  it('keeps every actor making eventual progress while contesting a crossing', () => {
    const initialEntries = threeWayCrossingEntries();
    const initialDistance = new Map(initialEntries.map(({ character }) => [character.id, routeDistance(character)]));

    const { entries, frames } = simulateMovementTicks(openState, initialEntries, 360);
    const midpoint = frames[179].moved;

    for (const { character } of entries) {
      expect(routeDistance(character), character.id)
        .toBeLessThan(routeDistance(midpoint.get(character.id)) - 0.1);
      expect(routeDistance(character), character.id)
        .toBeLessThan(initialDistance.get(character.id) - 0.1);
    }
  });

  it('keeps a flagged non-head-on staff component making eventual route progress', () => {
    const initialEntries = threeWayCrossingEntries().map((entry, index) => index === 0
      ? {
          ...entry,
          character: {
            ...entry.character,
            role: 'waiter',
            stalledFor: 2,
            usingStaticFallback: true,
            minimumSpacing: 16,
          },
          headOnDetourEligible: true,
        }
      : entry);

    const initialDistance = new Map(initialEntries.map(({ character }) => [character.id, routeDistance(character)]));
    const { entries, frames } = simulateMovementTicks(openState, initialEntries, 360);
    const midpoint = frames[179].moved;

    for (const { character } of entries) {
      expect(routeDistance(character), character.id)
        .toBeLessThan(routeDistance(midpoint.get(character.id)) - 0.1);
      expect(routeDistance(character), character.id)
        .toBeLessThan(initialDistance.get(character.id) - 0.1);
    }
  });

  it('retains staff recovery age during non-goal displacement and clears it on route progress', () => {
    const initial = {
      id: 'waiter', role: 'waiter', x: 100, y: 100,
      path: [{ x: 10, y: 5 }], pathGoal: { x: 10, y: 5 },
      localConflictTarget: { x: 5, y: 3 },
      stalledFor: 2, usingStaticFallback: false, minimumSpacing: 16,
    };
    const first = resolveCharacterMovementBatch(openState, [{ character: initial, speed: 60 }], 0.1)
      .get(initial.id);

    expect(first.y).toBeLessThan(initial.y);
    expect(routeDistance(first)).toBeGreaterThanOrEqual(routeDistance(initial) - 0.1);
    expect(first.stalledFor).toBeGreaterThan(2);

    const { entries } = simulateMovementTicks(openState, [{ character: first, speed: 60 }], 60, 0.1);
    const cleared = entries[0].character;
    expect(cleared.x).toBeGreaterThan(initial.x);
    expect(cleared).toMatchObject({ stalledFor: 0, minimumSpacing: 16, usingStaticFallback: false });
  });

  it('resets a continuing recovered head-on detour only for progress toward its tagged waypoint', () => {
    const detourTarget = { x: 5, y: 3 };
    const baseCharacter = {
      id: 'waiter', role: 'waiter', x: 100, y: 100,
      path: [detourTarget, { x: 10, y: 5 }], pathGoal: { x: 10, y: 5 },
      recoveredHeadOnDetourTarget: detourTarget,
      stalledFor: 1.5, usingStaticFallback: false, minimumSpacing: 16,
    };
    const interrupted = resolveCharacterMovementBatch(openState, [{
      character: { ...baseCharacter, localConflictTarget: { x: 3, y: 5 } },
      speed: 60,
    }], 0.1).get(baseCharacter.id);

    expect(interrupted.x).toBeLessThan(baseCharacter.x);
    expect(interrupted.y).toBe(baseCharacter.y);
    expect(interrupted.stalledFor).toBeGreaterThan(baseCharacter.stalledFor);
    expect(interrupted).not.toHaveProperty('recoveredHeadOnDetourTarget');

    const continuing = resolveCharacterMovementBatch(openState, [{ character: baseCharacter, speed: 60 }], 0.1)
      .get(baseCharacter.id);
    expect(continuing.y).toBeLessThan(baseCharacter.y);
    expect(Math.hypot(continuing.x - detourTarget.x * 20, continuing.y - detourTarget.y * 20))
      .toBeLessThan(Math.hypot(
        baseCharacter.x - detourTarget.x * 20,
        baseCharacter.y - detourTarget.y * 20,
      ));
    expect(continuing).toMatchObject({ stalledFor: 0, recoveredHeadOnDetourTarget: detourTarget });

    const { entries } = simulateMovementTicks(openState, [{ character: continuing, speed: 60 }], 20, 0.1);
    expect(entries[0].character).not.toHaveProperty('recoveredHeadOnDetourTarget');
    expect(entries[0].character.x).toBeGreaterThan(baseCharacter.x);
  });

  it('serialises converging exit traffic through the door within a bounded number of ticks', () => {
    const world = getRestaurantWorld(openState.restaurant);
    const doorCell = worldToCell({ x: world.doorX, y: world.doorY + 20 });
    const initialEntries = [
      {
        character: {
          id: 'north-exit', x: 860, y: 320,
          path: [{ x: 44, y: doorCell.y }, doorCell, { x: 48, y: doorCell.y }],
          pathGoal: { x: 48, y: doorCell.y },
        },
        speed: 60,
      },
      {
        character: {
          id: 'south-exit', x: 860, y: 380,
          path: [{ x: 44, y: doorCell.y }, doorCell, { x: 48, y: doorCell.y }],
          pathGoal: { x: 48, y: doorCell.y },
        },
        speed: 60,
      },
    ];

    const { entries, frames } = simulateMovementTicks(openState, initialEntries, 240);

    expect(entries.every(entry => entry.character.x > world.doorX)).toBe(true);
    for (const { moved } of frames) {
      expect(Math.hypot(
        moved.get('north-exit').x - moved.get('south-exit').x,
        moved.get('north-exit').y - moved.get('south-exit').y,
      )).toBeGreaterThan(0);
    }
  });

  it('advances an older stalled actor within a bounded number of ticks despite repeated lower-ID arrivals', () => {
    const oldActor = {
      id: 'z-old', x: 92, y: 100,
      path: [{ x: 11, y: 5 }], pathGoal: { x: 11, y: 5 },
      stalledFor: 3, usingStaticFallback: true, minimumSpacing: 6,
    };
    const newcomer = tick => ({
      id: `a-${String(tick).padStart(3, '0')}`, x: 108, y: 100,
      path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
      stalledFor: 0, usingStaticFallback: false, minimumSpacing: 16,
    });
    const initialEntries = [
      { character: oldActor, speed: 60 },
      { character: newcomer(0), speed: 60 },
    ];

    const { entries } = simulateMovementTicks(openState, initialEntries, 120, 1 / 30,
      (currentEntries, tick) => currentEntries.map(entry => (entry.character.id === 'z-old'
        ? entry
        : { ...entry, character: newcomer(tick) })));

    expect(entries.find(entry => entry.character.id === 'z-old').character.x).toBeGreaterThan(108);
  });

  it('starts controlled overlap only at two seconds and selects greatest age then stable ID', () => {
    const makeEntries = (leftId, leftAge, rightId, rightAge) => [
      {
        character: {
          id: leftId, x: 92, y: 100,
          path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
          stalledFor: leftAge, usingStaticFallback: true, minimumSpacing: 6,
        },
        speed: 60,
      },
      {
        character: {
          id: rightId, x: 108, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: rightAge, usingStaticFallback: true, minimumSpacing: 6,
        },
        speed: 60,
      },
    ];

    const beforeThreshold = resolveCharacterMovementBatch(
      corridorState, makeEntries('z', 1.99, 'a', 1.99), 1 / 30,
    );
    expect(beforeThreshold.get('z').minimumSpacing).toBe(16);
    expect(beforeThreshold.get('a').minimumSpacing).toBe(16);
    expect(Math.hypot(
      beforeThreshold.get('z').x - beforeThreshold.get('a').x,
      beforeThreshold.get('z').y - beforeThreshold.get('a').y,
    )).toBeGreaterThanOrEqual(16 - 1e-6);

    const greatestAge = resolveCharacterMovementBatch(
      corridorState, makeEntries('z-old', 3, 'a-young', 2), 0.2,
    );
    expect(greatestAge.get('z-old').x).toBeGreaterThan(92);
    expect(greatestAge.get('z-old').x - 92).toBeGreaterThan(108 - greatestAge.get('a-young').x);

    const stableId = resolveCharacterMovementBatch(
      corridorState, makeEntries('a', 2, 'z', 2), 0.2,
    );
    expect(stableId.get('a').x).toBeGreaterThan(92);
    expect(stableId.get('a').x - 92).toBeGreaterThan(108 - stableId.get('z').x);
  });

  it('applies normal spacing and controlled-overlap eligibility boundaries to leaving customers', () => {
    const makeEntries = (left, right) => [
      {
        character: {
          id: left.id, state: 'leaving', exitPhase: 'to_door', x: 92, y: 100,
          path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
          stalledFor: left.age, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
      {
        character: {
          id: right.id, state: 'leaving', exitPhase: 'to_door', x: 108, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: right.age, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
    ];
    const ageZeroEntries = makeEntries({ id: 'z', age: 0 }, { id: 'a', age: 0 });
    const ageZero = resolveCharacterMovementBatch(corridorState, ageZeroEntries, 0.2);
    const ageZeroDistance = minimumTrajectoryDistance(
      buildTimeParameterizedTrajectory(ageZeroEntries[0].character, ageZero.get('z'), 60, 0.2),
      buildTimeParameterizedTrajectory(ageZeroEntries[1].character, ageZero.get('a'), 60, 0.2),
    );

    expect(ageZeroDistance).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(ageZero.get('z').minimumSpacing).toBe(16);
    expect(ageZero.get('a').minimumSpacing).toBe(16);

    const beforeThreshold = resolveCharacterMovementBatch(
      corridorState,
      makeEntries({ id: 'z', age: 1.99 }, { id: 'a', age: 1.99 }),
      1 / 30,
    );
    expect(Math.hypot(
      beforeThreshold.get('z').x - beforeThreshold.get('a').x,
      beforeThreshold.get('z').y - beforeThreshold.get('a').y,
    )).toBeGreaterThanOrEqual(16 - 1e-6);

    const selected = resolveCharacterMovementBatch(
      corridorState,
      makeEntries({ id: 'z-old', age: 3 }, { id: 'a-young', age: 2 }),
      0.2,
    );
    expect(selected.get('z-old').x).toBeGreaterThan(92);
    expect(selected.get('z-old').x - 92).toBeGreaterThan(108 - selected.get('a-young').x);
  });

  it('does not relax a leaving customer without a valid static route', () => {
    const state = {
      ...openState,
      chairs: [
        { id: 'north', x: 100, y: 80 },
        { id: 'east', x: 120, y: 100 },
        { id: 'south', x: 100, y: 120 },
        { id: 'west', x: 80, y: 100 },
      ],
    };
    const enclosed = {
      id: 'enclosed-leaving', state: 'leaving', exitPhase: 'to_door', x: 100, y: 100,
      path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
      stalledFor: 3, usingStaticFallback: true, minimumSpacing: 16,
    };
    const moved = resolveCharacterMovementBatch(state, [
      { character: enclosed, speed: 60 },
      {
        character: {
          id: 'peer', x: 102, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: 2, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
    ], 0.2);

    expect(moved.get(enclosed.id)).toMatchObject({ x: 100, y: 100, minimumSpacing: 16 });
  });

  it('selects falsey non-null stable ID zero for controlled overlap', () => {
    const entries = [
      {
        character: {
          id: 0, x: 92, y: 100,
          path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
          stalledFor: 3, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
      {
        character: {
          id: 'peer', x: 108, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: 2, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
    ];

    const moved = resolveCharacterMovementBatch(corridorState, entries, 0.2);

    expect(moved.get(0).x).toBeGreaterThan(92);
    expect(moved.get(0).x - 92).toBeGreaterThan(108 - moved.get('peer').x);
  });

  it('removes controlled overlap policy when a detour clears without goal progress', () => {
    const entries = [
      {
        character: {
          id: 'selected', x: 100, y: 100,
          path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
          stalledFor: 3, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
      {
        character: {
          id: 'peer', x: 102, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: 2, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
    ];

    const conflicted = resolveCharacterMovementBatch(openState, entries, 1 / 30);
    expect(conflicted.get('selected')).toHaveProperty('localConflictTarget');

    const cleared = resolveCharacterMovementBatch(openState, [{
      ...entries[0], character: conflicted.get('selected'),
    }], 1 / 30).get('selected');

    expect(cleared).toMatchObject({ minimumSpacing: 16, usingStaticFallback: false });
    expect(cleared.localConflictTarget).toEqual(conflicted.get('selected').localConflictTarget);
    expect(routeDistance(cleared)).toBeGreaterThanOrEqual(routeDistance(conflicted.get('selected')) - 0.1);
  });

  it('activates controlled overlap below sixteen while protecting every outside pair', () => {
    const entries = [
      {
        character: {
          id: 'selected', x: 92, y: 100,
          path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
          stalledFor: 3, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
      {
        character: {
          id: 'peer', x: 108, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: 2, usingStaticFallback: true, minimumSpacing: 16,
        },
        speed: 60,
      },
      { character: { id: 'outside', x: 100, y: 84, path: [] }, speed: 0 },
    ];
    const dt = 0.2;
    const moved = resolveCharacterMovementBatch(openState, entries, dt);
    const trajectories = new Map(entries.map(entry => [
      entry.character.id,
      buildTimeParameterizedTrajectory(
        entry.character,
        moved.get(entry.character.id),
        entry.speed,
        dt,
      ),
    ]));
    const relaxedDistance = minimumTrajectoryDistance(
      trajectories.get('selected'), trajectories.get('peer'),
    );

    expect(relaxedDistance).toBeLessThan(16);
    expect(relaxedDistance).toBeGreaterThanOrEqual(2 - 1e-6);
    for (const id of ['selected', 'peer']) {
      expect(minimumTrajectoryDistance(trajectories.get(id), trajectories.get('outside')), id)
        .toBeGreaterThanOrEqual(16 - 1e-6);
    }
  });

  it('keeps every same-component swept pair at least two units apart during controlled overlap', () => {
    const initialEntries = [
      {
        character: {
          id: 'selected', x: 92, y: 100,
          path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
          stalledFor: 3, usingStaticFallback: true, minimumSpacing: 6,
        },
        speed: 60,
      },
      {
        character: {
          id: 'peer', x: 108, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: 2, usingStaticFallback: true, minimumSpacing: 6,
        },
        speed: 60,
      },
    ];
    const { frames } = simulateMovementTicks(corridorState, initialEntries, 8);

    for (const { entries, moved } of frames) {
      const left = entries[0];
      const right = entries[1];
      expect(minimumTrajectoryDistance(
        buildTimeParameterizedTrajectory(left.character, moved.get(left.character.id), left.speed, 1 / 30),
        buildTimeParameterizedTrajectory(right.character, moved.get(right.character.id), right.speed, 1 / 30),
      )).toBeGreaterThanOrEqual(2 - 1e-6);
    }
  });

  it('keeps an outside-component actor at normal spacing during controlled overlap', () => {
    const entries = [
      {
        character: {
          id: 'selected', x: 92, y: 100,
          path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
          stalledFor: 3, usingStaticFallback: true, minimumSpacing: 6,
        },
        speed: 60,
      },
      {
        character: {
          id: 'peer', x: 108, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: 2, usingStaticFallback: true, minimumSpacing: 6,
        },
        speed: 60,
      },
      { character: { id: 'outside', x: 100, y: 84, path: [] }, speed: 0 },
    ];

    const moved = resolveCharacterMovementBatch(openState, entries, 1 / 30);

    expect(minimumTrajectoryDistance(
      buildTimeParameterizedTrajectory(entries[0].character, moved.get('selected'), 60, 1 / 30),
      buildTimeParameterizedTrajectory(entries[2].character, moved.get('outside'), 0, 1 / 30),
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });

  it('restores normal metadata immediately after controlled overlap progress', () => {
    const entries = [
      {
        character: {
          id: 'selected', x: 92, y: 100,
          path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
          stalledFor: 3, usingStaticFallback: true, minimumSpacing: 6,
        },
        speed: 60,
      },
      {
        character: {
          id: 'peer', x: 108, y: 100,
          path: [{ x: 3, y: 5 }], pathGoal: { x: 3, y: 5 },
          stalledFor: 2, usingStaticFallback: true, minimumSpacing: 6,
        },
        speed: 60,
      },
    ];

    const first = resolveCharacterMovementBatch(corridorState, entries, 1 / 30);
    expect(first.get('selected')).toMatchObject({ stalledFor: 0, minimumSpacing: 16, usingStaticFallback: false });

    const secondEntries = entries.map(entry => ({ ...entry, character: first.get(entry.character.id) }));
    const second = resolveCharacterMovementBatch(corridorState, secondEntries, 1 / 30);
    expect(second.get('selected')).toMatchObject({ minimumSpacing: 16, usingStaticFallback: false });
    expect(Math.hypot(
      second.get('selected').x - second.get('peer').x,
      second.get('selected').y - second.get('peer').y,
    )).toBeGreaterThanOrEqual(Math.hypot(
      first.get('selected').x - first.get('peer').x,
      first.get('selected').y - first.get('peer').y,
    ) - 1e-6);
  });

  it('keeps a statically impossible furniture enclosure stationary and finite', () => {
    const state = {
      ...openState,
      chairs: [
        { id: 'north', x: 100, y: 80 },
        { id: 'east', x: 120, y: 100 },
        { id: 'south', x: 100, y: 120 },
        { id: 'west', x: 80, y: 100 },
      ],
    };
    const actor = {
      id: 'enclosed', x: 100, y: 100,
      path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
      stalledFor: 2, usingStaticFallback: true, minimumSpacing: 6,
    };

    const { entries, frames } = simulateMovementTicks(state, [{ character: actor, speed: 60 }], 120);
    const result = entries[0].character;

    expect(result).toMatchObject({ x: actor.x, y: actor.y });
    expect(Number.isFinite(result.x) && Number.isFinite(result.y)).toBe(true);
    const blocked = buildBlockedCells(state);
    for (const { moved } of frames) {
      const endpoint = moved.get(actor.id);
      expect(blocked.has(`${worldToCell(endpoint).x},${worldToCell(endpoint).y}`)).toBe(false);
    }
  });
});
