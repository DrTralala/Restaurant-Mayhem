import { describe, expect, it } from 'vitest';
import { ensureStaffRuntime, moveStaffAlongPath, hasArrived } from './movement';

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

  it('consumes a path point when staff reaches it', () => {
    const staff = { id: 'w', role: 'waiter', x: 140, y: 100, path: [{ x: 8, y: 5 }] };
    const moved = moveStaffAlongPath(staff, 1);
    expect(moved.x).toBe(160);
    expect(moved.y).toBe(100);
    expect(moved.path).toEqual([]);
  });

  it('consumes a nearly reached waypoint even when another character is close', () => {
    const staff = { id: 'h', role: 'host', x: 521, y: 360, path: [{ x: 26, y: 18 }, { x: 25, y: 18 }] };

    const moved = moveStaffAlongPath(staff, 1, [{ id: 'w', x: 505, y: 360 }]);

    expect(moved).toMatchObject({ x: 520, y: 360, path: [{ x: 25, y: 18 }] });
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
});
