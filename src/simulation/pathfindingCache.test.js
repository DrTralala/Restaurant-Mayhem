import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findPath } from './pathfinding';
import * as statics from './navigation/router';
import { createInitialState } from '../state/initialState';
import { createNavigationWorkspace } from './movement/navigationWorkspace';

let buildGraph;
beforeEach(() => { buildGraph = vi.spyOn(statics, 'findRoute'); });
afterEach(() => vi.restoreAllMocks());
const start = { x: 20, y: 20 };
const goal = { x: 22, y: 20 };

it('reuses a route across ticks but never shares caller-owned cells or arrays', () => {
  const state = createInitialState();
  const first = findPath(state, start, goal);
  expect(first).toEqual([{ x: 21, y: 20 }, { x: 22, y: 20 }]);
  first[0].x = 999;
  first.pop();
  const nextTick = { ...state, restaurant: { ...state.restaurant, gameTime: 36002 } };
  expect(findPath(nextTick, start, goal)).toEqual([{ x: 21, y: 20 }, { x: 22, y: 20 }]);
  expect(buildGraph).toHaveBeenCalledTimes(1);
});

it.each([
  ['table', state => state.tables.push({ id: 'block', x: 420, y: 400 })],
  ['chair', state => state.chairs.push({ id: 'block', x: 420, y: 400 })],
  ['kitchen', state => state.kitchenStations.push({ id: 'block', x: 420, y: 400 })],
  ['service rotation', state => { state.serviceTables[0].rotation = 1; }],
  ['cashier', state => state.cashierStations.push({ id: 'block', x: 420, y: 400, w: 80, h: 40 })],
  ['wash station', state => state.washStations.push({ id: 'block', x: 420, y: 400 })],
  ['door', state => { state.doors[0].y = 440; }],
  ['expansion', state => { state.restaurant.expansionLevel += 1; }],
])('invalidates cached routes after a %s topology edit, including in-place edits', (_label, edit) => {
  const state = createInitialState();
  findPath(state, start, goal);
  edit(state);
  const result = findPath(state, start, goal);
  expect(buildGraph).toHaveBeenCalledTimes(2);
  // Independent cache owner provides the uncached solver result for the edited layout.
  expect(result).toEqual(findPath({ ...state, doors: [...state.doors] }, start, goal));
});

it('does not reuse routes between new or deserialised games with identical layouts', () => {
  const state = createInitialState();
  findPath(state, start, goal);
  findPath(createInitialState(), start, goal);
  findPath(JSON.parse(JSON.stringify(state)), start, goal);
  expect(buildGraph).toHaveBeenCalledTimes(3);
});

it('bounds retained routes and evicts the least recently used entry', () => {
  const state = createInitialState();
  findPath(state, start, goal);
  const hotGoal = { x: 23, y: 20 };
  findPath(state, start, hotGoal);
  for (let index = 0; index < 127; index += 1) {
    findPath(state, start, { x: 100 + index, y: 20 });
    findPath(state, start, hotGoal);
  }
  expect(buildGraph).toHaveBeenCalledTimes(129);
  findPath(state, start, goal);
  expect(buildGraph).toHaveBeenCalledTimes(130);
});

it('keeps unreachable and same-cell results distinct from malformed options', () => {
  const state = createInitialState();
  for (let index = 0; index < 2; index += 1) {
    expect(findPath(state, start, start)).toEqual([]);
    expect(findPath(state, start, { x: 999, y: 999 })).toEqual([]);
  }
  expect(buildGraph).toHaveBeenCalledTimes(2);
  expect(() => findPath(state, start, start, { dynamic: true })).toThrow(/static path options/);
});

it('rejects a workspace from another state before consulting cached paths', () => {
  const state = createInitialState();
  const workspace = createNavigationWorkspace(state);
  findPath(state, start, goal, { workspace });
  const changed = { ...state, tables: [...state.tables, { id: 'block', x: 440, y: 400 }] };
  expect(findPath(changed, start, goal, { workspace })).toEqual([]);
});
