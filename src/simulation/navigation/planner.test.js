import { describe, expect, it, vi } from 'vitest';
import { createGrid } from './grid';
import { actionsConflict } from './reservations';
import * as reservations from './reservations';
import { planMovement } from './planner';

const state = { restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [], serviceTables: [] };
const hold = (actorId, point, end = 2) => ({ actorId, actions: [{ from: point, to: point, start: 0, end }] });
const options = () => ({ grid: createGrid(state), start: { x: 400, y: 300 }, goal: { x: 460, y: 300 },
  speed: 40, horizon: 2, reservations: [], maxExpansions: 128 });

function expectSafePlan(request, result) {
  let position = request.start;
  let time = 0;
  for (const move of result.actions) {
    expect(move.start).toBe(time);
    expect(move.from).toEqual(position);
    expect(move.end).toBeGreaterThan(move.start);
    expect(move.end).toBeLessThanOrEqual(request.horizon);
    expect(request.grid.segmentClear(move.from, move.to)).toBe(true);
    expect(Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y))
      .toBeLessThanOrEqual(request.speed * (move.end - move.start) + 1e-9);
    for (const reservation of request.reservations) {
      for (const other of reservation.actions) expect(actionsConflict(move, other)).toBe(false);
    }
    position = move.to;
    time = move.end;
  }
  expect(time).toBe(request.horizon);
}

describe('bounded movement planning', () => {
  it.each([
    ['clear', 1000, 'arrived', []],
    ['blocked', 400, 'blocked', ['peer']],
  ])('checks the %s initial hold only once when expanding the initial node', (_label, peerX, status, blockers) => {
    const request = { ...options(), goal: { x: 400, y: 300 }, maxExpansions: 1,
      reservations: [hold('peer', { x: peerX, y: 300 })] };
    const conflict = vi.spyOn(reservations, 'actionsConflict');
    try {
      const result = planMovement(request);
      expect(result).toEqual({ status, expansions: 1, blockers,
        actions: status === 'arrived' ? [{ from: { x: 400, y: 300 }, to: { x: 400, y: 300 }, start: 0, end: 2 }] : [] });
      const initialChecks = conflict.mock.calls.filter(([action]) => action.start === 0 && action.end === 2
        && action.from.x === 400 && action.from.y === 300 && action.to.x === 400 && action.to.y === 300);
      expect(initialChecks).toHaveLength(1);
    } finally {
      conflict.mockRestore();
    }
  });

  it('keeps completed grid traversals at exact nodes for fractional traversal durations', () => {
    for (const speed of [55, 62, 73, 75]) {
      const request = { ...options(), speed, horizon: 10, goal: { x: 800, y: 300 }, maxExpansions: 256 };
      const result = planMovement(request);
      expectSafePlan(request, result);
      for (const action of result.actions.filter(action => action.end < request.horizon)) {
        expect(action.to.x % 20).toBe(0);
        expect(action.to.y % 20).toBe(0);
      }
      expect(result.status).toBe('arrived');
    }
  });

  it.each([[436.7934443842663, 380], [431.2934443842663, 380], [425.7934443842663, 360], [420.2934443842663, 360]])(
    'passes a stationary queue from y=%s towards a route hint at y=%s', (startY, goalY) => {
    const request = { ...options(), start: { x: 1000, y: startY }, goal: { x: 980, y: goalY },
      speed: 55, maxExpansions: 256,
      reservations: [390, 420, 450, 480, 510, 540, 570, 600, 630].map(y => hold(`queue-${y}`, { x: 973, y })) };
    const result = planMovement(request);
    expectSafePlan(request, result);
    expect(result.actions.at(-1).to.y, JSON.stringify(result)).toBeLessThanOrEqual(400);
    expect(result.actions[0].to.y, JSON.stringify(result)).toBeLessThanOrEqual(startY);
  });

  it('reaches an available destination and reserves its remaining horizon', () => {
    const request = options();
    const result = planMovement(request);
    expect(result.status).toBe('arrived');
    expectSafePlan(request, result);
    expect(result.actions.at(-1).to).toEqual(request.goal);
  });

  it('preserves a required first edge before continuing towards the destination', () => {
    const request = { ...options(), start: { x: 406, y: 300 }, goal: { x: 440, y: 300 },
      firstWaypoint: { x: 400, y: 300 } };
    const result = planMovement(request);
    expect(result.actions.find(action => action.from.x !== action.to.x || action.from.y !== action.to.y)?.to)
      .toEqual({ x: 400, y: 300 });
    expect(result.status).toBe('arrived');
    expectSafePlan(request, result);
  });

  it('clips a required first edge safely when its traversal exceeds the horizon', () => {
    const request = { ...options(), start: { x: 406, y: 300 }, goal: { x: 440, y: 300 },
      firstWaypoint: { x: 400, y: 300 }, speed: 1 };
    const result = planMovement(request);
    expect(result.actions.at(-1).to).toEqual({ x: 404, y: 300 });
    expectSafePlan(request, result);
  });

  it('holds rather than reversing or crossing traffic when its required first edge is blocked', () => {
    const request = { ...options(), start: { x: 420, y: 300 }, firstWaypoint: { x: 400, y: 300 },
      reservations: [hold('peer', { x: 400, y: 300 })] };
    const result = planMovement(request);
    expect(result.actions.every(action => action.from.x === action.to.x && action.from.y === action.to.y)).toBe(true);
    expect(result.blockers).toContain('peer');
    expectSafePlan(request, result);
  });

  it('rejects a required first waypoint outside the current graph edges', () => {
    const result = planMovement({ ...options(), firstWaypoint: { x: 440, y: 300 } });
    expect(result).toMatchObject({ status: 'unreachable', actions: [], expansions: 0 });
  });

  it('makes safe partial progress without solving the whole journey', () => {
    const request = { ...options(), goal: { x: 800, y: 300 } };
    const result = planMovement(request);
    expect(result.status).toBe('partial');
    expectSafePlan(request, result);
    expect(result.actions.at(-1).to.x).toBeGreaterThan(400);
    expect(result.actions.at(-1).to.x).toBeLessThan(800);
    expect(result.expansions).toBeLessThanOrEqual(request.maxExpansions);
  });

  it('still advances when a slow actor cannot finish one grid edge within the horizon', () => {
    const request = { ...options(), speed: 1 };
    const result = planMovement(request);
    expectSafePlan(request, result);
    expect(result.actions.at(-1).to).toEqual({ x: 402, y: 300 });
  });

  it('plans a detour around stationary traffic rather than walking through it', () => {
    const request = { ...options(), speed: 80, reservations: [hold('blocker', { x: 420, y: 300 })] };
    const result = planMovement(request);
    expectSafePlan(request, result);
    expect(result.actions.some(move => move.to.y !== 300)).toBe(true);
    expect(result.actions.at(-1).to).toEqual(request.goal);
  });

  it('does not claim arrival at an occupied terminal', () => {
    const request = { ...options(), reservations: [hold('owner', { x: 460, y: 300 })] };
    const result = planMovement(request);
    expectSafePlan(request, result);
    expect(result.status).not.toBe('arrived');
    expect(result.blockers).toContain('owner');
  });

  it('returns a safe hold when no expansion budget remains', () => {
    const request = { ...options(), maxExpansions: 0 };
    const result = planMovement(request);
    expect(result.status).toBe('pending');
    expect(result.expansions).toBe(0);
    expectSafePlan(request, result);
    expect(result.actions.at(-1).to).toEqual(request.start);
  });

  it('does not return an unsafe hold when incoming reservations cover the start', () => {
    const request = { ...options(), maxExpansions: 0, reservations: [{ actorId: 'incoming', actions: [
      { from: { x: 440, y: 300 }, to: { x: 400, y: 300 }, start: 0, end: 2 },
    ] }] };
    const result = planMovement(request);
    expect(result.status).toBe('blocked');
    expect(result.actions).toEqual([]);
    expect(result.blockers).toContain('incoming');
  });

  it('is deterministic and preserves speed-dependent durations', () => {
    const request = { ...options(), speed: 75 };
    const first = planMovement(request);
    expect(planMovement(request)).toEqual(first);
    expectSafePlan(request, first);
    const moving = first.actions.filter(move => move.from.x !== move.to.x || move.from.y !== move.to.y);
    for (const move of moving) expect(Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y)
      / (move.end - move.start)).toBeCloseTo(75, 10);
  });
});
