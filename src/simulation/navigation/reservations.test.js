import { describe, expect, it, vi } from 'vitest';
import { actionsConflict, positionAt } from './reservations';
import * as reservations from './reservations';

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

function outcome(run) {
  try {
    return { value: run() };
  } catch (error) {
    return { error: { name: error.name, message: error.message } };
  }
}

function referenceSafe(candidate, reservations, blockers) {
  let clear = true;
  for (const reservation of reservations) {
    for (const other of reservation.actions) {
      if (!actionsConflict(candidate, other)) continue;
      blockers.add(reservation.actorId);
      clear = false;
      break;
    }
  }
  return clear;
}

function safetyOutcome(check, candidate, blockers) {
  try {
    return { safe: check(candidate), blockers: [...blockers] };
  } catch (error) {
    return { error: { name: error.name, message: error.message }, blockers: [...blockers] };
  }
}

function generatedSafetyWorkload() {
  let seed = 0x51f15e;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const point = () => Math.round((next() - 0.5) * 1000) / 10;
  const movement = () => {
    const from = { x: point(), y: point() };
    const duration = [0, 0.25, 0.5, 1, 2][Math.floor(next() * 5)];
    const start = Math.round((next() - 0.5) * 20) / 10;
    const to = duration === 0 ? from : { x: point(), y: point() };
    return { from, to, start, end: start + duration };
  };
  const reservations = Array.from({ length: 24 }, (_, actor) => {
    const actions = Array.from({ length: 1 + Math.floor(next() * 5) }, movement);
    if (actor % 3 === 0) actions.push(actions[0]);
    return { actorId: `random-${actor}`, actions };
  });
  const candidates = Array.from({ length: 96 }, movement);
  return { reservations, candidates };
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

  it('reuses validated action geometry and bounds across repeated scoped checks', () => {
    const reads = { from: 0, to: 0, start: 0, end: 0 };
    const right = {
      get from() { reads.from += 1; return { x: 1000, y: 1000 }; },
      get to() { reads.to += 1; return { x: 1000, y: 1000 }; },
      get start() { reads.start += 1; return 0; },
      get end() { reads.end += 1; return 1; },
    };
    const checker = reservations.createConflictChecker();
    const minimum = vi.spyOn(Math, 'min');
    const maximum = vi.spyOn(Math, 'max');
    const absolute = vi.spyOn(Math, 'abs');
    try {
      const left = action(0, 0, 40, 0);
      expect(Array.from({ length: 4 }, () => checker(left, right))).toEqual([false, false, false, false]);
      expect(reads).toEqual({ from: 2, to: 2, start: 3, end: 3 });
      // One bounds calculation per immutable action, plus one time-overlap
      // calculation per query.
      expect(minimum).toHaveBeenCalledTimes(8);
      expect(maximum).toHaveBeenCalledTimes(8);
      expect(absolute).toHaveBeenCalledTimes(20);
    } finally {
      minimum.mockRestore();
      maximum.mockRestore();
      absolute.mockRestore();
    }
  });

  it('matches public conflict outcomes for seeded, extreme and malformed pairs', () => {
    const cases = [
      ...generatedCases(),
      { left: action(Number.MAX_VALUE, 0, Number.MAX_VALUE, 0),
        right: action(-Number.MAX_VALUE, 0, -Number.MAX_VALUE, 0) },
      { left: action(-7e307, -7e307, -7e307, -7e307),
        right: action(7e307, 7e307, 7e307, 7e307) },
      { left: action(-7e307, 0, 7e307, 0, -1e308, 1e308),
        right: action(7e307, 7e307, 7e307, 7e307, 8e307, 9e307) },
      { left: action(0, 0, 20, 0), right: action(NaN, 0, 20, 0) },
      { left: action(0, 0, 20, 0), right: action(0, 0, 20, 0, 1, 0) },
      { left: action(0, 0, 20, 0), right: action(0, 0, 20, 0), clearance: NaN },
      { left: action(0, 0, 20, 0), right: action(1000, 1000, 1000, 1000),
        clearance: Number.MIN_VALUE },
      { left: action(0, 0, 20, 0), right: action(1000, 1000, 1000, 1000),
        clearance: Number.MAX_SAFE_INTEGER },
      { left: action(0, 0, 20, 0), right: action(1000, 1000, 1000, 1000),
        clearance: Number.MAX_VALUE },
    ];
    const checker = reservations.createConflictChecker();
    for (const candidate of cases) {
      const clearance = candidate.clearance;
      expect(outcome(() => checker(candidate.left, candidate.right, clearance)))
        .toEqual(outcome(() => actionsConflict(candidate.left, candidate.right, clearance)));
    }
  });

  it('retains left-to-right action validation before clearance validation', () => {
    const checker = reservations.createConflictChecker();
    const malformedLeft = action(NaN, 0, 20, 0);
    let rightReads = 0;
    const throwingRight = {
      get from() { rightReads += 1; throw new Error('right action read first'); },
    };
    expect(() => checker(malformedLeft, throwingRight, NaN)).toThrow(/reservation/i);
    expect(rightReads).toBe(0);

    const valid = action(0, 0, 20, 0);
    expect(() => checker(valid, action(0, 0, 20, 0, 1, 0), NaN)).toThrow(/reservation/i);
    expect(() => checker(valid, valid, NaN)).toThrow(/clearance/i);
  });

  it('matches the original safety loop for seeded multi-action reservation paths', () => {
    const { reservations: entries, candidates } = generatedSafetyWorkload();
    const blockers = new Set();
    const context = reservations.createReservationPreparationContext();
    for (const candidate of candidates) {
      const expectedBlockers = new Set();
      blockers.clear();
      const check = reservations.createReservationSafetyChecker(entries, blockers, context);
      expect(safetyOutcome(check, candidate, blockers))
        .toEqual(safetyOutcome(value => referenceSafe(value, entries, expectedBlockers), candidate, expectedBlockers));
    }
  });

  it('uses indexed owned actions without per-query iteration and validates tails only when reached', () => {
    let reservationIterations = 0;
    let actionIterations = 0;
    let tailReads = 0;
    const firstAction = action(40, 0, 0, 0);
    const tail = { get from() { tailReads += 1; throw new Error('tail geometry visited'); } };
    const firstActions = [firstAction, tail];
    firstActions[Symbol.iterator] = function* iterateOwnedActions() {
      actionIterations += 1;
      for (let index = 0; index < firstActions.length; index += 1) yield firstActions[index];
    };
    const entries = [
      { actorId: 'first', actions: firstActions },
      { actorId: 'second', actions: [firstAction] },
    ];
    entries[Symbol.iterator] = function* iterateOwnedReservations() {
      reservationIterations += 1;
      for (let index = 0; index < entries.length; index += 1) yield entries[index];
    };
    const blockers = new Set();
    const context = reservations.createReservationPreparationContext();
    const check = reservations.createReservationSafetyChecker(entries, blockers, context);

    expect(reservationIterations).toBe(1);
    expect(actionIterations).toBe(0);
    expect(tailReads).toBe(0);
    expect(check(action(0, 0, 40, 0))).toBe(false);
    expect([...blockers]).toEqual(['first', 'second']);
    expect(reservationIterations).toBe(1);
    expect(actionIterations).toBe(0);
    expect(tailReads).toBe(0);

    blockers.clear();
    expect(() => check(action(0, 100, 40, 100))).toThrow('tail geometry visited');
    expect(reservationIterations).toBe(1);
    expect(actionIterations).toBe(0);
    expect(tailReads).toBe(1);
    expect([...blockers]).toEqual([]);
  });

  it('keeps left-before-right validation order in the branded owned path', () => {
    let rightReads = 0;
    const right = { get from() { rightReads += 1; throw new Error('right geometry read'); } };
    const context = reservations.createReservationPreparationContext();
    const check = reservations.createReservationSafetyChecker(
      [{ actorId: 'peer', actions: [right] }], new Set(), context);

    expect(() => check(action(NaN, 0, 20, 0))).toThrow(/reservation/i);
    expect(rightReads).toBe(0);
    expect(() => check(action(0, 0, 20, 0))).toThrow('right geometry read');
    expect(rightReads).toBe(1);
  });

  it('prepares one candidate per safety query and reuses right records across pairs', () => {
    const tracked = (x, y) => {
      const reads = { from: 0, to: 0, start: 0, end: 0 };
      const from = { x, y };
      const to = { x: x + 10, y };
      return {
        reads,
        action: {
          get from() { reads.from += 1; return from; },
          get to() { reads.to += 1; return to; },
          get start() { reads.start += 1; return 0; },
          get end() { reads.end += 1; return 1; },
        },
      };
    };
    const right = Array.from({ length: 12 }, (_, index) => tracked(1000 + index * 20, 1000));
    const blockers = new Set();
    const check = reservations.createReservationSafetyChecker(
      [{ actorId: 'distant', actions: right.map(entry => entry.action) }], blockers);
    const first = tracked(0, 0);
    const second = tracked(0, 20);
    const isFinite = vi.spyOn(Number, 'isFinite');

    try {
      expect(check(first.action)).toBe(true);
      expect(first.reads).toEqual({ from: 2, to: 2, start: 3, end: 3 });
      expect(right.map(entry => entry.reads)).toEqual(Array.from({ length: 12 }, () =>
        ({ from: 2, to: 2, start: 3, end: 3 })));

      expect(check(second.action)).toBe(true);
      expect(second.reads).toEqual({ from: 2, to: 2, start: 3, end: 3 });
      expect(right.map(entry => entry.reads)).toEqual(Array.from({ length: 12 }, () =>
        ({ from: 2, to: 2, start: 3, end: 3 })));
      expect(isFinite.mock.calls.filter(([value]) => value === 16)).toHaveLength(0);
    } finally {
      isFinite.mockRestore();
    }
  });

  it('retains endpoint, clearance, duplicate-action and per-actor blocker semantics', () => {
    const candidate = action(0, 0, 40, 0);
    const duplicate = action(40, 0, 0, 0);
    const entries = [
      { actorId: 'zeta', actions: [
        action(0, 16, 40, 16),
        action(0, 15.999999999, 40, 15.999999999),
        action(0, 0, 20, 0, 1, 2),
        action(100, 100, 100, 100, 0, 0),
      ] },
      { actorId: 'endpoint', actions: [action(40, 0, 60, 0, 1, 2)] },
      { actorId: 'alpha', actions: [duplicate] },
      { actorId: 'beta', actions: [duplicate] },
    ];
    const expectedBlockers = new Set();
    const actualBlockers = new Set();
    const check = reservations.createReservationSafetyChecker(entries, actualBlockers,
      reservations.createReservationPreparationContext());

    expect(safetyOutcome(check, candidate, actualBlockers))
      .toEqual(safetyOutcome(value => referenceSafe(value, entries, expectedBlockers), candidate, expectedBlockers));
    expect([...actualBlockers]).toEqual(['zeta', 'endpoint', 'alpha', 'beta']);
  });

  it('matches the reference safety loop when extreme finite arithmetic throws', () => {
    const cases = [
      [action(Number.MAX_VALUE, 0, Number.MAX_VALUE, 0),
        action(-Number.MAX_VALUE, 0, -Number.MAX_VALUE, 0)],
      [action(-7e307, -7e307, -7e307, -7e307),
        action(7e307, 7e307, 7e307, 7e307)],
    ];
    for (const [candidate, other] of cases) {
      const entries = [{ actorId: 'extreme', actions: [other] }];
      const expectedBlockers = new Set();
      const actualBlockers = new Set();
      const check = reservations.createReservationSafetyChecker(entries, actualBlockers,
        reservations.createReservationPreparationContext());
      const expected = safetyOutcome(value => referenceSafe(value, entries, expectedBlockers),
        candidate, expectedBlockers);
      const actual = safetyOutcome(check, candidate, actualBlockers);
      expect(actual).toEqual(expected);
      expect(actual).toMatchObject({ error: { message: expect.stringMatching(/arithmetic/i) }, blockers: [] });
    }
  });

  it('matches the public pair oracle for signed-zero and subnormal prepared geometry', () => {
    const pairs = [
      [action(-0, -0, 0, 0), action(0, Number.MIN_VALUE, 0, Number.MIN_VALUE)],
      [action(Number.MIN_VALUE, 0, -Number.MIN_VALUE, 0), action(-0, -0, 0, 0)],
      [action(0, Number.MIN_VALUE, 40, Number.MIN_VALUE), action(0, 16, 40, 16)],
      [action(-Number.MIN_VALUE, 0, Number.MIN_VALUE, 0), action(0, 15.999999999, 40, 15.999999999)],
    ];
    const context = reservations.createReservationPreparationContext();
    for (const [candidate, other] of pairs) {
      const entries = [{ actorId: 'numeric-edge', actions: [other] }];
      const expectedBlockers = new Set();
      const actualBlockers = new Set();
      const check = reservations.createReservationSafetyChecker(entries, actualBlockers, context);
      expect(safetyOutcome(check, candidate, actualBlockers))
        .toEqual(safetyOutcome(value => referenceSafe(value, entries, expectedBlockers), candidate, expectedBlockers));
    }
  });

  it('avoids repeating finite gap and threshold checks for a prepared eligible pair', () => {
    const right = action(1000, 1000, 1000, 1000);
    const check = reservations.createReservationSafetyChecker(
      [{ actorId: 'distant', actions: [right] }], new Set());
    const isFinite = vi.spyOn(Number, 'isFinite');
    try {
      expect(check(action(0, 0, 40, 0))).toBe(true);
      expect(check(action(0, 0, 40, 0))).toBe(true);
      expect(isFinite).toHaveBeenCalledTimes(18);
    } finally {
      isFinite.mockRestore();
    }
  });

  it('re-reads mutable reservation action arrays and replaces stale position records', () => {
    const candidate = action(0, 0, 40, 0);
    const conflicting = action(40, 0, 0, 0);
    let arraysRead = 0;
    let actions = [conflicting];
    const reservation = { actorId: 'peer', get actions() { arraysRead += 1; return actions; } };
    const blockers = new Set();
    const check = reservations.createReservationSafetyChecker([reservation], blockers);

    expect(check(candidate)).toBe(false);
    actions = [];
    expect(check(candidate)).toBe(true);
    expect(arraysRead).toBe(2);

    actions = [action(NaN, 0, 20, 0)];
    expect(() => check(candidate)).toThrow(/reservation/i);
    expect(arraysRead).toBe(3);
  });

  it('preserves lazy validation and the old actor/action short-circuit order', () => {
    const invalidCandidate = action(NaN, 0, 20, 0);
    const emptyCheck = reservations.createReservationSafetyChecker([], new Set());
    expect(emptyCheck(invalidCandidate)).toBe(true);

    let rightReads = 0;
    const throwingRight = { get from() { rightReads += 1; throw new Error('right read'); } };
    const invalidLeftCheck = reservations.createReservationSafetyChecker(
      [{ actorId: 'peer', actions: [throwingRight] }], new Set());
    expect(() => invalidLeftCheck(invalidCandidate)).toThrow(/reservation/i);
    expect(rightReads).toBe(0);

    const actionsFailure = reservations.createReservationSafetyChecker([
      { get actions() { throw new Error('actions getter'); } },
    ], new Set());
    expect(() => actionsFailure(invalidCandidate)).toThrow('actions getter');

    const candidate = action(0, 0, 40, 0);
    const blockers = new Set();
    const laterInvalid = reservations.createReservationSafetyChecker([
      { actorId: 'first', actions: [action(40, 0, 0, 0), action(NaN, 0, 20, 0)] },
      { actorId: 'later', actions: [action(NaN, 0, 20, 0)] },
    ], blockers);
    expect(() => laterInvalid(candidate)).toThrow(/reservation/i);
    expect([...blockers]).toEqual(['first']);
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
