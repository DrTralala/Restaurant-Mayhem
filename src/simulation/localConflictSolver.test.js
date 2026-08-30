import { describe, expect, it } from 'vitest';
import { findSpaceTimePlan } from './localConflictSolver';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

describe('findSpaceTimePlan', () => {
  it('waits rather than entering a vertex reserved for the next slot', () => {
    const plan = findSpaceTimePlan({
      state: openState, routeCells: [{ x: 6, y: 5 }, { x: 7, y: 5 }],
      startCell: { x: 5, y: 5 }, goalCell: { x: 7, y: 5 }, blockedCells: new Set(), horizon: 3,
      vertexReservations: new Map([[1, new Set(['6,5'])]]),
      edgeReservations: new Set(),
    });
    expect(plan[0]).toEqual({ x: 5, y: 5 });
    expect(plan.at(-1).x).toBeGreaterThan(5);
  });

  it('rejects an opposite-direction edge swap', () => {
    const plan = findSpaceTimePlan({
      state: openState, routeCells: [{ x: 6, y: 5 }],
      startCell: { x: 5, y: 5 }, goalCell: { x: 6, y: 5 }, blockedCells: new Set(), horizon: 1,
      vertexReservations: new Map(), edgeReservations: new Set(['6,5>5,5@1']),
    });
    expect(plan).toEqual([{ x: 5, y: 5 }]);
  });

  it('returns null when static geometry encloses the actor', () => {
    const blockedCells = new Set(['5,4', '4,5', '6,5', '5,6']);
    expect(findSpaceTimePlan({
      state: openState, routeCells: [],
      startCell: { x: 5, y: 5 }, goalCell: { x: 9, y: 5 }, blockedCells, horizon: 8,
      vertexReservations: new Map([[1, new Set(['5,5'])]]), edgeReservations: new Set(),
    })).toBeNull();
  });

  it('scores goal holds as waits in the horizon objective', () => {
    const plan = findSpaceTimePlan({
      state: openState, routeCells: [{ x: 6, y: 5 }],
      startCell: { x: 5, y: 5 }, goalCell: { x: 6, y: 5 }, blockedCells: new Set(), horizon: 3,
      vertexReservations: new Map(),
      edgeReservations: new Set(),
    });

    expect(plan).toEqual([{ x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }]);
  });

  it('locks goal arrivals and delays them when a future hold is reserved', () => {
    const findPlan = vertexReservations => findSpaceTimePlan({
      state: openState, routeCells: [{ x: 6, y: 5 }],
      startCell: { x: 5, y: 5 }, goalCell: { x: 6, y: 5 },
      blockedCells: new Set(['5,4', '4,5', '5,6']), horizon: 3,
      vertexReservations,
      edgeReservations: new Set(),
    });

    expect(findPlan(new Map())).toEqual([{ x: 6, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 5 }]);
    expect(findPlan(new Map([[2, new Set(['6,5'])]])))
      .toEqual([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }]);
  });

  it('returns byte-identical plans regardless of reservation Set insertion order', () => {
    const findPlan = (vertexKeys, edgeKeys) => findSpaceTimePlan({
      state: openState, routeCells: [],
      startCell: { x: 5, y: 5 }, goalCell: { x: 7, y: 5 }, blockedCells: new Set(), horizon: 1,
      vertexReservations: new Map([[1, new Set(vertexKeys)]]),
      edgeReservations: new Set(edgeKeys),
    });
    const first = findPlan(['5,5', '6,5', '4,5'], ['20,20>21,20@1', '30,30>31,30@1']);
    const reversed = findPlan(['4,5', '6,5', '5,5'], ['30,30>31,30@1', '20,20>21,20@1']);

    expect(first).toEqual([{ x: 5, y: 4 }]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(reversed));
  });
});
