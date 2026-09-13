import { describe, expect, it } from 'vitest';
import { buildBlockedCells, findAdjacentOpenCell, findPath, worldToCell } from './pathfinding';
import * as pathfindingFacade from './pathfinding';
import { createNavigationWorkspace } from './movement/navigationWorkspace';
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

  it('finds a dining-floor route along the lower edge of the top wall', () => {
    const openState = {
      restaurant: { expansionLevel: 1 },
      tables: [], chairs: [], kitchenStations: [], serviceTables: [],
      cashierStations: [], washStations: [], doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    };
    const start = worldToCell({ x: 80, y: 100 });
    const goal = worldToCell({ x: 260, y: 100 });
    const blocked = buildBlockedCells(openState);
    const path = findPath(openState, start, goal);

    expect(path.length).toBeGreaterThan(0);
    expect(path.some(cell => blocked.has(`${cell.x},${cell.y}`))).toBe(false);
  });

  it('rejects a target inside the top interior wall', () => {
    const openState = {
      restaurant: { expansionLevel: 1 },
      tables: [], chairs: [], kitchenStations: [], serviceTables: [],
      cashierStations: [], washStations: [], doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    };
    expect(findPath(openState, worldToCell({ x: 80, y: 100 }), { x: 5, y: 4 })).toEqual([]);
  });

  it('keeps the queue route open at the top edge of the restaurant', () => {
    const openState = {
      restaurant: { expansionLevel: 1 },
      tables: [], chairs: [], kitchenStations: [], serviceTables: [],
      cashierStations: [], washStations: [], doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    };
    const start = worldToCell({ x: 973, y: 60 });
    const goal = worldToCell({ x: 973, y: 140 });
    const blocked = buildBlockedCells(openState);
    const path = findPath(openState, start, goal);

    expect(path.length).toBeGreaterThan(0);
    expect(path.some(cell => blocked.has(`${cell.x},${cell.y}`))).toBe(false);
  });

  it('does not route through the top-wall cell at a top-band side door', () => {
    const topDoorState = {
      restaurant: { expansionLevel: 1 },
      tables: [], chairs: [], kitchenStations: [], serviceTables: [],
      cashierStations: [], washStations: [], doors: [{ id: 'top-door', y: 80, role: 'entrance' }],
    };
    const blocked = buildBlockedCells(topDoorState);
    const path = findPath(topDoorState, { x: 48, y: 4 }, { x: 44, y: 5 });

    expect(blocked.has('45,4')).toBe(true);
    expect(path).not.toContainEqual({ x: 45, y: 4 });
    expect(path.some(cell => blocked.has(`${cell.x},${cell.y}`))).toBe(false);
  });

  it.each([
    ['kitchen', { id: 'k1', x: 100, y: 120 }, { x: 80, y: 120 }],
    ['cashier', { id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }, { x: 840, y: 100 }],
    ['wash', { id: 'wash1', type: 'manual', x: 300, y: 120, w: 40, h: 40 }, { x: 280, y: 120 }],
  ])('keeps the %s approach reachable below the top wall', (_name, fixture, approach) => {
    const openState = {
      restaurant: { expansionLevel: 1 },
      tables: [], chairs: [], kitchenStations: [], serviceTables: [],
      cashierStations: [], washStations: [], doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    };
    const collection = fixture.w ? (fixture.type ? 'washStations' : 'cashierStations') : 'kitchenStations';
    const state = { ...openState, [collection]: [fixture] };
    expect(findPath(state, worldToCell({ x: 80, y: 100 }), worldToCell(approach)).length)
      .toBeGreaterThan(0);
  });

  it('returns the direct static lattice path between open cells', () => {
    const openState = {
      restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [], serviceTables: [],
    };
    expect(findPath(openState, { x: 5, y: 5 }, { x: 10, y: 5 })).toEqual([
      { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 10, y: 5 },
    ]);
  });

  it('rejects any dynamic occupancy option on the static-only path finder', () => {
    const openState = {
      restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [], serviceTables: [],
    };
    expect(() => findPath(
      openState,
      worldToCell({ x: 100, y: 300 }),
      worldToCell({ x: 200, y: 300 }),
      { occupiedCells: new Set(['7,15']) },
    )).toThrow(/static path options/i);
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
    expect(findPath(unreachable, start, goal)).toEqual([]);
  });

  it('allows crossing the outside wall only through a door opening', () => {
    const doorState = {
      restaurant: { expansionLevel: 1 },
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
      tables: [], chairs: [], kitchenStations: [], serviceTables: [],
    };

    const path = findPath(doorState, worldToCell({ x: 800, y: 200 }), worldToCell({ x: 960, y: 200 }));
    const wallColumn = worldToCell({ x: 907, y: 0 }).x;
    const crossing = path.find(cell => cell.x === wallColumn);

    expect(crossing.y * GRID_SIZE).toBeGreaterThanOrEqual(340);
    expect(crossing.y * GRID_SIZE).toBeLessThan(380);
  });

  it('preserves the complete pathfinding API and function arities', () => {
    expect(Object.keys(pathfindingFacade).sort()).toEqual([
      'buildBlockedCells',
      'cellKey',
      'cellToWorld',
      'findAdjacentOpenCell',
      'findAdjacentOpenCells',
      'findPath',
      'isInsideWorld',
      'worldToCell',
    ]);
    expect(Object.fromEntries(Object.entries(pathfindingFacade)
      .map(([name, implementation]) => [name, implementation.length]))).toEqual({
      buildBlockedCells: 1,
      cellKey: 1,
      cellToWorld: 1,
      findAdjacentOpenCell: 2,
      findAdjacentOpenCells: 2,
      findPath: 3,
      isInsideWorld: 2,
      worldToCell: 1,
    });
  });

  it('reuses one optional workspace across path searches', () => {
    const workspace = createNavigationWorkspace(state);
    const start = worldToCell({ x: 100, y: 300 });
    const goal = worldToCell({ x: 300, y: 300 });

    const first = findPath(state, start, goal, { workspace });
    const second = findPath(state, start, goal, { workspace });
    expect(second).toEqual(first);
  });

  it('falls back from a malformed optional workspace', () => {
    const path = findPath(state, worldToCell({ x: 100, y: 300 }),
      worldToCell({ x: 300, y: 300 }), { workspace: {} });
    expect(path.length).toBeGreaterThan(0);
  });
});
