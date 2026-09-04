import { describe, expect, it } from 'vitest';
import { buildBlockedCells, findAdjacentOpenCell, findPath, findPathWithDynamicFallback, worldToCell } from './pathfinding';
import * as pathfindingFacade from './pathfinding';
import { createNavigationWorkspace } from './movement/navigationWorkspace';
import { createMovementMetrics } from './movementMetrics';
import { GRID_SIZE } from './world';

const state = {
  restaurant: { expansionLevel: 1 },
  tables: [{ id: 't1', x: 200, y: 200 }],
  chairs: [{ id: 'ch1', x: 180, y: 200 }],
  kitchenStations: [{ id: 'k1', x: 100, y: 120 }],
  serviceTables: [{ id: 'st1', x: 260, y: 120 }],
};

describe('pathfinding', () => {
  it('marks furniture cells as blocked', () => {
    const blocked = buildBlockedCells(state);
    expect(blocked.has('10,10')).toBe(true);
    expect(blocked.has('9,10')).toBe(true);
    expect(blocked.has('5,6')).toBe(true);
    expect(blocked.has('13,6')).toBe(true);
  });

  it('blocks both cells occupied by a 40x40 wash station', () => {
    const blocked = buildBlockedCells({ ...state, washStations: [{ id: 'wash1', x: 500, y: 300, w: 40, h: 40 }] });
    for (const cell of ['25,15', '26,15', '25,16', '26,16']) expect(blocked.has(cell)).toBe(true);
  });

  it('blocks the vertical footprint of a rotated service counter', () => {
    const blocked = buildBlockedCells({
      ...state,
      serviceTables: [{ id: 'vertical', x: 400, y: 120, rotation: 1 }],
    });

    for (const cell of ['20,6', '21,6', '20,11', '21,11']) {
      expect(blocked.has(cell)).toBe(true);
    }
    expect(blocked.has('22,6')).toBe(false);
  });

  it('finds the nearest open cell adjacent to a blocked target', () => {
    const cleanState = {
      restaurant: { expansionLevel: 1 },
      tables: [{ id: 't1', x: 200, y: 200 }],
      chairs: [],
      kitchenStations: [],
      serviceTables: [],
    };
    const rect = { x: 200, y: 200, w: 40, h: 40 };
    const fromCell = worldToCell({ x: 100, y: 200 });
    const cell = findAdjacentOpenCell(cleanState, rect, fromCell);
    expect(cell).toEqual({ x: 9, y: 10 });
  });

  it('chooses a reachable adjacent cell when the nearest side is enclosed', () => {
    const routed = {
      restaurant: { expansionLevel: 1 },
      tables: [{ id: 't1', x: 200, y: 200 }],
      chairs: [
        { id: 'left-wall-a', x: 160, y: 200 },
        { id: 'left-wall-b', x: 160, y: 220 },
        { id: 'left-cap-top', x: 180, y: 180 },
        { id: 'left-cap-bottom', x: 180, y: 220 },
      ],
      kitchenStations: [], serviceTables: [],
    };
    const start = worldToCell({ x: 140, y: 200 });
    expect(findPath(routed, start, { x: 9, y: 10 })).toEqual([]);
    const target = findAdjacentOpenCell(routed, { x: 200, y: 200, w: 40, h: 40 }, start);

    expect(target).not.toEqual({ x: 9, y: 10 });
    expect(findPath(routed, start, target).length).toBeGreaterThan(0);
  });

  it('returns empty path when goal is unreachable', () => {
    const unreachable = {
      restaurant: { expansionLevel: 1 },
      tables: [],
      chairs: [
        { id: 'cw', x: 280, y: 300 },
        { id: 'ce', x: 320, y: 300 },
        { id: 'cn', x: 300, y: 280 },
        { id: 'cs', x: 300, y: 320 },
      ],
      kitchenStations: [],
      serviceTables: [],
    };
    const goal = worldToCell({ x: 300, y: 300 });
    const start = worldToCell({ x: 100, y: 300 });
    const path = findPath(unreachable, start, goal);
    expect(path).toEqual([]);
  });

  it('finds a path that avoids blocked cells', () => {
    const path = findPath(state, worldToCell({ x: 100, y: 300 }), worldToCell({ x: 300, y: 300 }));
    const blocked = buildBlockedCells(state);
    expect(path.length).toBeGreaterThan(0);
    expect(path.some(cell => blocked.has(`${cell.x},${cell.y}`))).toBe(false);
  });

  it('routes around temporarily occupied character cells', () => {
    const openState = {
      restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [], serviceTables: [],
    };
    const path = findPath(
      openState,
      worldToCell({ x: 100, y: 300 }),
      worldToCell({ x: 200, y: 300 }),
      { occupiedCells: new Set(['7,15']) },
    );

    expect(path).not.toContainEqual({ x: 7, y: 15 });
    expect(path.length).toBeGreaterThan(5);
  });

  it('allows crossing the outside wall only through a door opening', () => {
    const doorState = {
      restaurant: { expansionLevel: 1 },
      doors: [{ id: 'door1', y: 340 }],
      tables: [], chairs: [], kitchenStations: [], serviceTables: [],
    };

    const path = findPath(doorState, worldToCell({ x: 800, y: 200 }), worldToCell({ x: 960, y: 200 }));
    const wallColumn = worldToCell({ x: 907, y: 0 }).x;
    const crossing = path.find(cell => cell.x === wallColumn);

    expect(crossing.y * GRID_SIZE).toBeGreaterThanOrEqual(340);
    expect(crossing.y * GRID_SIZE).toBeLessThan(380);
  });

  it('allows an occupied goal while avoiding other occupied cells', () => {
    const open = { restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [], serviceTables: [] };
    const goal = worldToCell({ x: 200, y: 300 });
    const path = findPath(open, worldToCell({ x: 100, y: 300 }), goal, {
      occupiedCells: new Set(['7,15', `${goal.x},${goal.y}`]),
      allowOccupiedGoal: true,
    });

    expect(path.at(-1)).toEqual(goal);
    expect(path).not.toContainEqual({ x: 7, y: 15 });
  });

  it('falls back to a static route when characters close the dynamic route', () => {
    const corridor = {
      restaurant: { expansionLevel: 1 }, tables: [], kitchenStations: [], serviceTables: [],
      chairs: Array.from({ length: 20 }, (_, index) => ({ id: `wall-${index}`, x: 100 + index * 20, y: 280 }))
        .concat(Array.from({ length: 20 }, (_, index) => ({ id: `wall-b-${index}`, x: 100 + index * 20, y: 320 }))),
    };
    const result = findPathWithDynamicFallback(
      corridor,
      worldToCell({ x: 120, y: 300 }),
      worldToCell({ x: 400, y: 300 }),
      { occupiedCells: new Set(['10,15']) },
    );

    expect(result.usedStaticFallback).toBe(false);
    expect(result.path.length).toBeGreaterThan(0);
  });

  it('does not invent a route through furniture when the static target is enclosed', () => {
    const unreachable = {
      restaurant: { expansionLevel: 1 }, tables: [],
      chairs: [
        { id: 'cw', x: 280, y: 300 }, { id: 'ce', x: 320, y: 300 },
        { id: 'cn', x: 300, y: 280 }, { id: 'cs', x: 300, y: 320 },
      ], kitchenStations: [], serviceTables: [],
    };
    const goal = worldToCell({ x: 300, y: 300 });
    const start = worldToCell({ x: 100, y: 300 });
    const result = findPathWithDynamicFallback(unreachable, start, goal, { occupiedCells: new Set() });

    expect(result).toEqual({ path: [], usedStaticFallback: false });
  });

  it('preserves the complete pathfinding API and function arities', () => {
    expect(Object.keys(pathfindingFacade).sort()).toEqual([
      'buildBlockedCells',
      'buildOccupiedCharacterCells',
      'cellKey',
      'cellToWorld',
      'findAdjacentOpenCell',
      'findAdjacentOpenCells',
      'findPath',
      'findPathWithDynamicFallback',
      'isInsideWorld',
      'worldToCell',
    ]);
    expect(Object.fromEntries(Object.entries(pathfindingFacade)
      .map(([name, implementation]) => [name, implementation.length]))).toEqual({
      buildBlockedCells: 1,
      buildOccupiedCharacterCells: 1,
      cellKey: 1,
      cellToWorld: 1,
      findAdjacentOpenCell: 2,
      findAdjacentOpenCells: 2,
      findPath: 3,
      findPathWithDynamicFallback: 3,
      isInsideWorld: 2,
      worldToCell: 1,
    });
  });

  it('reuses one optional workspace across path searches', () => {
    const metrics = createMovementMetrics();
    const workspace = createNavigationWorkspace(state, metrics);
    const start = worldToCell({ x: 100, y: 300 });
    const goal = worldToCell({ x: 300, y: 300 });

    const first = findPath(state, start, goal, { workspace, metrics });
    const second = findPath(state, start, goal, { workspace, metrics });
    expect(second).toEqual(first);
    expect(metrics.blockedCellBuilds).toBe(1);
  });

  it('falls back from a malformed optional workspace', () => {
    const metrics = createMovementMetrics();
    const path = findPath(state, worldToCell({ x: 100, y: 300 }),
      worldToCell({ x: 300, y: 300 }), { workspace: {}, metrics });
    expect(path.length).toBeGreaterThan(0);
    expect(metrics.blockedCellBuilds).toBe(1);
  });
});
