import { describe, expect, it } from 'vitest';
import { ensureStaffRuntime, moveStaffAlongPath, hasArrived, moveCharacterAlongPath, moveCharacterTowards, moveCharacterWithRecovery } from './movement';
import { buildBlockedCells, worldToCell } from './pathfinding';

const openState = { restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [], serviceTables: [] };

describe('movement runtime', () => {
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
});
