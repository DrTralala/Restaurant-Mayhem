import { describe, expect, it, vi } from 'vitest';
import { actionsConflict, positionAt } from './reservations';

const action = (x1, y1, x2, y2, start = 0, end = 1) => ({
  from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, start, end,
});

function preciseConflict(left, right, clearance = 16) {
  const interpolate = (candidate, time) => {
    if (time <= candidate.start) return { ...candidate.from };
    if (time >= candidate.end) return { ...candidate.to };
    const fraction = (time - candidate.start) / (candidate.end - candidate.start);
    return {
      x: candidate.from.x + (candidate.to.x - candidate.from.x) * fraction,
      y: candidate.from.y + (candidate.to.y - candidate.from.y) * fraction,
    };
  };
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  if (end < start) return false;
  const a = interpolate(left, start);
  const b = interpolate(right, start);
  const aEnd = interpolate(left, end);
  const bEnd = interpolate(right, end);
  const x = a.x - b.x;
  const y = a.y - b.y;
  const dx = (aEnd.x - bEnd.x) - x;
  const dy = (aEnd.y - bEnd.y) - y;
  const squared = dx * dx + dy * dy;
  const fraction = squared === 0 ? 0 : Math.max(0, Math.min(1, -(x * dx + y * dy) / squared));
  return Math.hypot(x + dx * fraction, y + dy * fraction) < clearance;
}

function generatedCases() {
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const cases = [];
  for (let index = 0; index < 256; index += 1) {
    const point = () => Math.round((next() - 0.5) * 2000) / 10;
    const leftStart = Math.round((next() - 0.5) * 40) / 10;
    const rightStart = Math.round((next() - 0.5) * 40) / 10;
    const leftDuration = index % 5 === 0 ? 0 : Math.round(next() * 40) / 10;
    const rightDuration = index % 7 === 0 ? 0 : Math.round(next() * 40) / 10;
    const leftFrom = { x: point(), y: point() };
    const rightFrom = { x: point(), y: point() };
    const leftTo = leftDuration === 0 ? leftFrom : { x: point(), y: point() };
    const rightTo = rightDuration === 0 ? rightFrom : { x: point(), y: point() };
    cases.push({
      left: { from: leftFrom, to: leftTo, start: leftStart, end: leftStart + leftDuration },
      right: { from: rightFrom, to: rightTo, start: rightStart, end: rightStart + rightDuration },
      clearance: [0, 1, 15.999999999, 16, 16.000000001, 32][index % 6],
    });
  }
  return cases;
}

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

  it('rejects distant reservations before the continuous distance calculation', () => {
    const hypot = vi.spyOn(Math, 'hypot');
    try {
      expect(actionsConflict(action(0, 0, 0, 0), action(1000, 1000, 1000, 1000))).toBe(false);
      expect(actionsConflict(
        action(1e12, 0, 1e12 + 1e6, 0),
        action(-1e12, 0, -1e12 + 1e6, 0),
      )).toBe(false);
      expect(hypot).not.toHaveBeenCalled();
    } finally {
      hypot.mockRestore();
    }
  });

  it('validates plain reservation DTOs without allocating an every-array', () => {
    const every = vi.spyOn(Array.prototype, 'every');
    try {
      expect(actionsConflict(action(0, 0, 0, 0), action(1000, 1000, 1000, 1000))).toBe(false);
      expect(every).not.toHaveBeenCalled();
    } finally {
      every.mockRestore();
    }
  });

  it('matches the precise continuous reference across movement and numerical edge cases', () => {
    const cases = [
      { left: action(0, 0, 40, 0), right: action(40, 0, 0, 0), clearance: 16 },
      { left: action(0, 20, 40, 20), right: action(20, 0, 20, 40), clearance: 16 },
      { left: action(0, 0, 40, 0), right: action(0, 16, 40, 16), clearance: 16 },
      { left: action(0, 0, 40, 0), right: action(0, 15.999999999, 40, 15.999999999), clearance: 16 },
      { left: action(0, 0, 40, 0, 0, 2), right: action(20, 0, 20, 0, 1, 1), clearance: 16 },
      { left: action(0, 0, 20, 0), right: action(20, 0, 40, 0, 1, 2), clearance: 16 },
      {
        left: action(1e150, 0, 1e150 + 1e140, 0),
        right: action(1e150 + 1e141, 0, 1e150 + 2e141, 0),
        clearance: 16,
      },
      ...generatedCases(),
    ];
    for (const candidate of cases) {
      expect(actionsConflict(candidate.left, candidate.right, candidate.clearance))
        .toBe(preciseConflict(candidate.left, candidate.right, candidate.clearance));
    }
  });

  it('retains validation and arithmetic errors before spatial rejection', () => {
    const valid = action(0, 0, 20, 0);
    expect(() => actionsConflict(valid, action(Number.NaN, 0, 20, 0))).toThrow(/reservation/i);
    expect(() => actionsConflict(valid, valid, Number.NaN)).toThrow(/clearance/i);
    expect(() => actionsConflict(
      action(Number.MAX_VALUE, 0, Number.MAX_VALUE, 0),
      action(-Number.MAX_VALUE, 0, -Number.MAX_VALUE, 0),
    )).toThrow(/arithmetic/i);
  });

  it('preserves arithmetic errors for finite gaps and durations that overflow exact math', () => {
    expect(() => actionsConflict(
      action(-7e307, -7e307, -7e307, -7e307),
      action(7e307, 7e307, 7e307, 7e307),
    )).toThrow(/arithmetic/i);
    expect(() => actionsConflict(
      action(-7e307, 0, 7e307, 0, -1e308, 1e308),
      action(7e307, 7e307, 7e307, 7e307, 8e307, 9e307),
    )).toThrow(/arithmetic/i);
  });

  it.each([
    action(0, 0, 20, 0, 1, 0), action(0, 0, 20, 0, 0, 0),
    action(NaN, 0, 20, 0), action(0, 0, 20, 0, 0, Infinity),
  ])('rejects malformed actions instead of treating them as safe', malformed => {
    expect(() => actionsConflict(malformed, action(100, 0, 120, 0))).toThrow(/reservation/i);
  });
});
