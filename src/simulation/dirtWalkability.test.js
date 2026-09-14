import { expect, it } from 'vitest';
import { buildBlockedCells, findPath } from './pathfinding';

function corridorState(floorDirt) {
  return {
    restaurant: { expansionLevel: 1 },
    doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    tables: [{ id: 'real-table', x: 140, y: 200 }],
    chairs: [
      { id: 'north-1', x: 80, y: 180 },
      { id: 'north-2', x: 100, y: 180 },
      { id: 'north-3', x: 120, y: 180 },
      { id: 'north-4', x: 140, y: 180 },
      { id: 'south-1', x: 80, y: 220 },
      { id: 'south-2', x: 100, y: 220 },
      { id: 'south-3', x: 120, y: 220 },
      { id: 'south-4', x: 140, y: 220 },
    ],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    floorDirt,
  };
}

it('keeps dirt out of one-cell corridor topology while real furniture remains blocking', () => {
  const clean = corridorState([]);
  const dirty = corridorState([{ id: 'dirt-1', x: 90, y: 210 }]);
  const start = { x: 4, y: 10 };
  const goal = { x: 9, y: 10 };

  expect(buildBlockedCells(clean)).toEqual(buildBlockedCells(dirty));
  expect(findPath(clean, start, goal)).toEqual(findPath(dirty, start, goal));
  expect(buildBlockedCells(dirty).has('7,10')).toBe(true);
  expect(findPath(dirty, start, goal)).not.toContainEqual({ x: 7, y: 10 });
});
