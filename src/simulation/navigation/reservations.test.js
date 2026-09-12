import { describe, expect, it } from 'vitest';
import { actionsConflict, positionAt } from './reservations';

const action = (x1, y1, x2, y2, start = 0, end = 1) => ({
  from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, start, end,
});

describe('continuous short-horizon reservations', () => {
  it('interpolates at actual action times and clamps to endpoints', () => {
    const move = action(100, 200, 140, 200, 2, 4);
    expect(positionAt(move, 1)).toEqual(move.from);
    expect(positionAt(move, 3)).toEqual({ x: 120, y: 200 });
    expect(positionAt(move, 5)).toEqual(move.to);
  });

  it('rejects head-on traversal even when endpoints are separate', () => {
    expect(actionsConflict(action(0, 0, 40, 0), action(40, 0, 0, 0))).toBe(true);
  });

  it('rejects crossing trajectories between distinct grid edges', () => {
    expect(actionsConflict(action(0, 20, 40, 20), action(20, 0, 20, 40))).toBe(true);
  });

  it('accepts parallel movement at exactly the required clearance', () => {
    expect(actionsConflict(action(0, 0, 40, 0), action(0, 16, 40, 16))).toBe(false);
    expect(actionsConflict(action(0, 0, 40, 0), action(0, 15.999, 40, 15.999))).toBe(true);
  });

  it('checks faster followers throughout their shared interval', () => {
    expect(actionsConflict(action(20, 0, 40, 0), action(0, 0, 40, 0))).toBe(true);
    expect(actionsConflict(action(20, 0, 60, 0), action(0, 0, 40, 0))).toBe(false);
  });

  it('treats a cancelled departure as a stationary obstacle', () => {
    const incoming = action(0, 0, 40, 0);
    expect(actionsConflict(incoming, action(40, 0, 80, 0))).toBe(false);
    expect(actionsConflict(incoming, action(40, 0, 40, 0))).toBe(true);
  });

  it('checks only overlapping time intervals, including their boundary', () => {
    expect(actionsConflict(action(0, 0, 20, 0), action(0, 0, 20, 0, 2, 3))).toBe(false);
    expect(actionsConflict(action(0, 0, 20, 0), action(20, 0, 40, 0, 1, 2))).toBe(true);
  });

  it('handles point occupancy and unequal action durations', () => {
    expect(actionsConflict(action(0, 0, 40, 0, 0, 2), action(20, 0, 20, 0, 1, 1))).toBe(true);
    expect(positionAt(action(20, 0, 20, 0, 1, 1), 1)).toEqual({ x: 20, y: 0 });
  });

  it.each([
    action(0, 0, 20, 0, 1, 0), action(0, 0, 20, 0, 0, 0),
    action(NaN, 0, 20, 0), action(0, 0, 20, 0, 0, Infinity),
  ])('rejects malformed actions instead of treating them as safe', malformed => {
    expect(() => actionsConflict(malformed, action(100, 0, 120, 0))).toThrow(/reservation/i);
  });
});
