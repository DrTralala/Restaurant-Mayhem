import { describe, expect, it } from 'vitest';
import { createGrid } from './grid';
import { advanceRouteSearch, beginRouteSearch, findRoute, forkRouteSearch } from './router';

const openState = () => ({
  restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [],
  serviceTables: [], washStations: [], cashierStations: [], doors: [{ id: 'door1', y: 340 }],
});

function expectSafeRoute(grid, start, goal, result) {
  expect(result.status).toBe('found');
  expect(result.points.at(-1)).toEqual(goal);
  let previous = start;
  for (const point of result.points) {
    expect(grid.isOpen(point)).toBe(true);
    expect(grid.segmentClear(previous, point)).toBe(true);
    previous = point;
  }
}

describe('independent static navigation router', () => {
  it('exempts an explicit endpoint from traffic avoidance without opening the rest of its cell', () => {
    const grid = createGrid(openState());
    const start = { x: 419, y: 300 }, goal = { x: 460, y: 300 };
    const blocked = new Set(['20,15']);
    const result = advanceRouteSearch(beginRouteSearch(grid, start, goal, { blocked, allowBlockedStart: true }), 256);
    expectSafeRoute(grid, start, goal, result);
    expect(result.points).not.toContainEqual({ x: 400, y: 300 });
    const reverse = advanceRouteSearch(beginRouteSearch(grid, goal, start, { blocked, allowBlockedGoal: true }), 256);
    expectSafeRoute(grid, goal, start, reverse);
    expect(reverse.points).not.toContainEqual({ x: 400, y: 300 });
    expect(findRoute(grid, start, goal, { blocked }).status).toBe('unreachable');
  });
  it('returns a deterministic shortest cardinal route without the old planner', () => {
    const grid = createGrid(openState());
    const start = { x: 400, y: 300 };
    const goal = { x: 460, y: 300 };
    const result = findRoute(grid, start, goal);
    expectSafeRoute(grid, start, goal, result);
    expect(result.points).toEqual([{ x: 420, y: 300 }, { x: 440, y: 300 }, goal]);
    expect(findRoute(grid, start, goal)).toEqual(result);
  });

  it('takes a safe detour around furniture', () => {
    const state = openState();
    state.tables.push({ id: 'obstacle', x: 420, y: 280 });
    const grid = createGrid(state);
    const start = { x: 400, y: 300 };
    const goal = { x: 480, y: 300 };
    const result = findRoute(grid, start, goal);
    expectSafeRoute(grid, start, goal, result);
    expect(result.points.some(point => point.y !== 300)).toBe(true);
  });

  it('only reports unreachable after exhausting a disconnected component', () => {
    const state = openState();
    state.chairs = [[280, 300], [320, 300], [300, 280], [300, 320]]
      .map(([x, y], id) => ({ id, x, y }));
    const result = findRoute(createGrid(state), { x: 300, y: 300 }, { x: 400, y: 300 });
    expect(result).toEqual({ status: 'unreachable', points: [], expansions: 1 });
  });

  it.each([0, 1, 2])('reports pending, not unreachable, on a %i-expansion budget', maxExpansions => {
    const result = findRoute(createGrid(openState()), { x: 400, y: 300 }, { x: 600, y: 300 }, { maxExpansions });
    expect(result.status).toBe('pending');
    expect(result.points).toEqual([]);
    expect(result.expansions).toBe(maxExpansions);
  });

  it('preserves exact fractional endpoints through validated connectors', () => {
    const grid = createGrid(openState());
    const start = { x: 403.125, y: 307.25 };
    const goal = { x: 473.5, y: 333.75 };
    expectSafeRoute(grid, start, goal, findRoute(grid, start, goal));
  });

  it('connects close fractional endpoints without forcing a detour to a corner', () => {
    const grid = createGrid(openState());
    const start = { x: 403.125, y: 307.25 };
    const goal = { x: 405.5, y: 310.75 };
    expect(findRoute(grid, start, goal).points).toEqual([goal]);
  });

  it('does not let an exact connector cut across a blocked cell', () => {
    const state = openState();
    state.chairs = [{ id: 'chair', x: 420, y: 300 }];
    const grid = createGrid(state);
    expect(grid.segmentClear({ x: 419.9, y: 309.9 }, { x: 430.1, y: 299.9 })).toBe(false);
    expect(grid.segmentClear({ x: 400, y: 290 }, { x: 440, y: 290 })).toBe(true);
  });

  it('never authorises escape from an ordinary blocked starting point', () => {
    const state = openState();
    state.chairs = [{ id: 'chair', x: 400, y: 300 }];
    const grid = createGrid(state);
    expect(findRoute(grid, { x: 410, y: 310 }, { x: 460, y: 300 }).status).toBe('unreachable');
    expect(grid.segmentClear({ x: 410, y: 310 }, { x: 460, y: 300 })).toBe(false);
  });

  it.each([null, { x: NaN, y: 300 }, { x: Infinity, y: 300 }, { x: 1e100, y: 300 }])(
    'rejects invalid/outside goals without a search', goal => {
      expect(findRoute(createGrid(openState()), { x: 400, y: 300 }, goal))
        .toEqual({ status: 'unreachable', points: [], expansions: 0 });
    },
  );

  it('distinguishes already at goal from a failed route', () => {
    const point = { x: 400, y: 300 };
    expect(findRoute(createGrid(openState()), point, point))
      .toEqual({ status: 'found', points: [], expansions: 0 });
  });

  it('crosses the restaurant wall only through the open door', () => {
    const grid = createGrid(openState());
    const start = { x: 800, y: 200 };
    const goal = { x: 960, y: 200 };
    const result = findRoute(grid, start, goal);
    expectSafeRoute(grid, start, goal, result);
    const crossing = result.points.filter(point => point.x === 900);
    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.every(point => point.y >= 340 && point.y < 380)).toBe(true);
  });

  it('changes topology when fixtures rotate or the restaurant expands', () => {
    const state = openState();
    state.serviceTables = [{ id: 'counter', x: 400, y: 120, rotation: 0 }];
    const before = createGrid(state);
    const rotated = createGrid({ ...state, serviceTables: [{ ...state.serviceTables[0], rotation: 1 }] });
    const expanded = createGrid({ ...state, restaurant: { expansionLevel: 2 } });
    expect(before.isOpen({ x: 400, y: 220 })).toBe(true);
    expect(rotated.isOpen({ x: 400, y: 220 })).toBe(false);
    expect(rotated.signature).not.toBe(before.signature);
    expect(expanded.signature).not.toBe(before.signature);
    expect(expanded.bounds.right).toBeGreaterThan(before.bounds.right);
  });

  it('allows temporary exclusions without changing the static grid or returned route ownership', () => {
    const grid = createGrid(openState());
    const start = { x: 400, y: 300 };
    const goal = { x: 460, y: 300 };
    const result = findRoute(grid, start, goal, { blocked: new Set(['21,15']) });
    expectSafeRoute(grid, start, goal, result);
    expect(result.points).not.toContainEqual({ x: 420, y: 300 });
    result.points[0].x = -1000;
    expect(findRoute(grid, start, goal).points[0]).toEqual({ x: 420, y: 300 });
  });

  it('resumes bounded search with the same route as an uninterrupted search', () => {
    const grid = createGrid(openState());
    const start = { x: 80, y: 100 };
    const goal = { x: 880, y: 600 };
    const cursor = beginRouteSearch(grid, start, goal);
    let result;
    for (let index = 0; index < 100; index += 1) {
      result = advanceRouteSearch(cursor, 32);
      expect(result.expansions).toBeLessThanOrEqual(32);
      if (result.status !== 'pending') break;
    }
    expectSafeRoute(grid, start, goal, result);
    expect(result.points).toEqual(findRoute(grid, start, goal).points);
  });

  it('forks a retained cursor without modifying the previous frame search', () => {
    const cursor = beginRouteSearch(createGrid(openState()), { x: 400, y: 300 }, { x: 600, y: 300 });
    advanceRouteSearch(cursor, 2);
    const before = JSON.stringify({ frontier: cursor.frontier, costs: [...cursor.costs] });
    const fork = forkRouteSearch(cursor);
    const result = advanceRouteSearch(fork, 100);
    expect(result.status).toBe('found');
    expect(JSON.stringify({ frontier: cursor.frontier, costs: [...cursor.costs] })).toBe(before);
    expect(advanceRouteSearch(cursor, 1).status).toBe('pending');
  });
});
