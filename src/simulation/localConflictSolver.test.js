import { describe, expect, it } from 'vitest';
import { findSpaceTimePlan, solveLocalConflictComponent } from './localConflictSolver';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

const actor = (id, startCell, goalCell, stalledFor = 0) => ({
  id,
  startCell,
  goalCell,
  routeCells: [goalCell],
  stalledFor,
  moving: true,
});

function expectConflictFree(plans, actors) {
  const starts = new Map(actors.map(entry => [entry.id, entry.startCell]));
  const actorIds = [...plans.keys()].sort();
  const horizon = plans.get(actorIds[0])?.length || 0;

  for (let slot = 1; slot <= horizon; slot += 1) {
    const vertices = new Map();
    const edges = new Map();
    for (const id of actorIds) {
      const plan = plans.get(id);
      const from = slot === 1 ? starts.get(id) : plan[slot - 2];
      const to = plan[slot - 1];
      const vertexKey = `${to.x},${to.y}`;
      const edgeKey = `${from.x},${from.y}>${to.x},${to.y}`;
      const reverseEdgeKey = `${to.x},${to.y}>${from.x},${from.y}`;
      expect(vertices.get(vertexKey), `vertex conflict at slot ${slot}`).toBeUndefined();
      expect(edges.get(reverseEdgeKey), `edge conflict at slot ${slot}`).toBeUndefined();
      vertices.set(vertexKey, id);
      edges.set(edgeKey, id);
    }
  }
}

function serialisePlans(plans) {
  return JSON.stringify([...plans.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

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

describe('solveLocalConflictComponent PBS', () => {
  it('keeps both plans and makes one actor wait at a crossing vertex', () => {
    const actors = [
      actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
      actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }),
    ];
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 1, maxHighLevelNodes: 128,
    });

    expect(result.mode).toBe('pbs');
    expect([...result.plans.keys()].sort()).toEqual(['a', 'b']);
    expect(actors.some(entry => result.plans.get(entry.id)[0].x === entry.startCell.x
      && result.plans.get(entry.id)[0].y === entry.startCell.y)).toBe(true);
    expectConflictFree(result.plans, actors);
  });

  it('does not produce an opposite-edge swap for head-on adjacent actors', () => {
    const actors = [
      actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
      actor('b', { x: 5, y: 5 }, { x: 4, y: 5 }),
    ];
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 1, maxHighLevelNodes: 128,
    });

    expect(result.mode).toBe('pbs');
    expectConflictFree(result.plans, actors);
  });

  it('returns conflict-free plans for all three actors in one component', () => {
    const actors = [
      actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
      actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }),
      actor('c', { x: 6, y: 5 }, { x: 5, y: 5 }),
    ];
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 1, maxHighLevelNodes: 128,
    });

    expect([...result.plans.keys()].sort()).toEqual(['a', 'b', 'c']);
    expectConflictFree(result.plans, actors);
  });

  it('returns byte-identical component plans by ID for input permutations', () => {
    const actors = [
      actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
      actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }),
      actor('c', { x: 6, y: 5 }, { x: 5, y: 5 }),
    ];
    const solve = entries => solveLocalConflictComponent({
      state: openState, actors: entries, blockedCells: new Set(), horizon: 1, maxHighLevelNodes: 128,
    });

    expect(serialisePlans(solve(actors).plans)).toBe(serialisePlans(solve([...actors].reverse()).plans));
  });

  it('gives an older stalled actor priority over a lexically lower new actor in aged fallback', () => {
    const actors = [
      actor('a-new', { x: 4, y: 5 }, { x: 5, y: 5 }, 0),
      actor('z-old', { x: 5, y: 4 }, { x: 5, y: 5 }, 4),
    ];
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 1, maxHighLevelNodes: 0,
    });

    expect(result.mode).toBe('aged-fallback');
    expect(result.plans.get('z-old')[0]).toEqual({ x: 5, y: 5 });
    expect(result.plans.get('a-new')[0]).not.toEqual({ x: 5, y: 5 });
    expectConflictFree(result.plans, actors);
  });

  it('gives the older stalled actor the preferred PBS branch', () => {
    const actors = [
      actor('a-new', { x: 4, y: 5 }, { x: 5, y: 5 }, 0),
      actor('z-old', { x: 5, y: 4 }, { x: 5, y: 5 }, 4),
    ];
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 1, maxHighLevelNodes: 128,
    });

    expect(result.mode).toBe('pbs');
    expect(result.plans.get('z-old')[0]).toEqual({ x: 5, y: 5 });
    expect(result.plans.get('a-new')[0]).not.toEqual({ x: 5, y: 5 });
    expectConflictFree(result.plans, actors);
  });

  it('bypasses PBS for a component of 13 moving actors', () => {
    const actors = Array.from({ length: 13 }, (_, index) => actor(
      `actor-${String(index).padStart(2, '0')}`,
      { x: 4 + index, y: 10 },
      { x: 4 + index, y: 10 },
      index,
    ));
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 8, maxHighLevelNodes: 128,
    });

    expect(result.mode).toBe('aged-fallback');
    expect(result.plans.size).toBe(13);
    expectConflictFree(result.plans, actors);
  });

  it('uses aged fallback when the PBS node cap is reached', () => {
    const actors = [
      actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }, 2),
      actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }, 1),
    ];
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 1, maxHighLevelNodes: 1,
    });

    expect(result.mode).toBe('aged-fallback');
    expectConflictFree(result.plans, actors);
  });
});
