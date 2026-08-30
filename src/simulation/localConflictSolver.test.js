import { describe, expect, it } from 'vitest';
import {
  addPriorityEdge,
  advanceExecutablePrefixScore,
  findSpaceTimePlan,
  solveLocalConflictComponent,
} from './localConflictSolver';
import { createMovementMetrics, setExecutablePrefixProfile } from './movementMetrics';

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

function referencePrefixScore(node, startCell, routeCells, scoringSlot) {
  const plan = [];
  let current = node;
  while (current.parent) {
    plan.unshift(current.cell);
    current = current.parent;
  }
  let previous = startCell;
  let waits = 0;
  let routeDeviation = 0;
  for (const cell of plan.slice(0, scoringSlot)) {
    if (cell.x === previous.x && cell.y === previous.y) waits += 1;
    routeDeviation += Math.min(...routeCells.map(routeCell =>
      Math.abs(cell.x - routeCell.x) + Math.abs(cell.y - routeCell.y)));
    previous = cell;
  }
  return { cell: plan.slice(0, scoringSlot).at(-1) || startCell, waits, routeDeviation };
}

const solverTimingKeys = [
  'solverInitialPlanningMilliseconds',
  'solverNodeBuildMilliseconds',
  'solverFrontierOrderingMilliseconds',
  'solverReplanningMilliseconds',
  'solverAgedFallbackMilliseconds',
  'solverResidualMilliseconds',
];

function expectFiniteNonNegativeTimings(metrics) {
  for (const key of solverTimingKeys) {
    expect(Number.isFinite(metrics[key]), key).toBe(true);
    expect(metrics[key], key).toBeGreaterThanOrEqual(0);
  }
}

describe('findSpaceTimePlan', () => {
  it('advances immutable executable-prefix scores exactly through the scoring horizon', () => {
    const startCell = { x: 5, y: 5 };
    const routeCells = [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }];
    const cells = [
      { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 5 },
      { x: 6, y: 4 }, { x: 7, y: 4 }, { x: 8, y: 4 },
    ];
    let node = { cell: startCell, slot: 0, parent: null };
    let score = { cell: { ...startCell }, waits: 0, routeDeviation: 0 };
    const nodes = [];
    const scores = [];
    for (const [index, cell] of cells.entries()) {
      const successor = {
        cell,
        slot: index + 1,
        waited: cell.x === node.cell.x && cell.y === node.cell.y,
        parent: node,
      };
      const routeDistance = Math.min(...routeCells.map(routeCell =>
        Math.abs(cell.x - routeCell.x) + Math.abs(cell.y - routeCell.y)));
      score = advanceExecutablePrefixScore(score, successor, 3, routeDistance);
      node = successor;
      nodes.push(node);
      scores.push(score);
    }

    expect(scores[1]).toEqual(referencePrefixScore(nodes[1], startCell, routeCells, 3));
    expect(scores[2]).toEqual(referencePrefixScore(nodes[2], startCell, routeCells, 3));
    expect(scores[5]).toEqual(referencePrefixScore(nodes[5], startCell, routeCells, 3));
    expect(scores[5].cell).not.toBe(scores[2].cell);
  });

  it('returns the exact unreserved executable-prefix plan when progress horizon is shorter', () => {
    expect(findSpaceTimePlan({
      state: openState,
      startCell: { x: 5, y: 5 },
      goalCell: { x: 8, y: 5 },
      routeCells: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
      blockedCells: new Set(),
      horizon: 6,
      progressHorizon: 3,
      vertexReservations: new Map(),
      edgeReservations: new Set(),
    })).toEqual([
      { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 },
      { x: 8, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 5 },
    ]);
  });

  it('returns identical plans in counter-disabled legacy and cached profile modes', () => {
    const options = {
      state: openState,
      startCell: { x: 5, y: 5 },
      goalCell: { x: 8, y: 5 },
      routeCells: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
      blockedCells: new Set(),
      horizon: 6,
      progressHorizon: 3,
      vertexReservations: new Map(),
      edgeReservations: new Set(),
    };
    const legacyMetrics = setExecutablePrefixProfile(createMovementMetrics(), {
      mode: 'legacy', countWork: false,
    });
    const cachedMetrics = setExecutablePrefixProfile(createMovementMetrics(), {
      mode: 'cached', countWork: false,
    });

    const withoutMetrics = findSpaceTimePlan(options);
    const legacy = findSpaceTimePlan({ ...options, metrics: legacyMetrics });
    const cached = findSpaceTimePlan({ ...options, metrics: cachedMetrics });

    expect(legacy).toEqual(withoutMetrics);
    expect(cached).toEqual(withoutMetrics);
    expect([
      legacyMetrics.solverExecutablePrefixScores,
      legacyMetrics.solverExecutablePrefixNodeVisits,
      cachedMetrics.solverExecutablePrefixScores,
      cachedMetrics.solverExecutablePrefixNodeVisits,
    ]).toEqual([0, 0, 0, 0]);
    expect(legacyMetrics.spaceTimePlanCalls).toBe(1);
    expect(cachedMetrics.spaceTimePlanCalls).toBe(1);
  });

  it('retains counter-enabled reconstructive work evidence only in legacy mode', () => {
    const options = {
      state: openState,
      startCell: { x: 5, y: 5 },
      goalCell: { x: 8, y: 5 },
      routeCells: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
      blockedCells: new Set(), horizon: 6, progressHorizon: 3,
      vertexReservations: new Map(), edgeReservations: new Set(),
    };
    const legacyMetrics = setExecutablePrefixProfile(createMovementMetrics(), { mode: 'legacy' });
    const cachedMetrics = setExecutablePrefixProfile(createMovementMetrics(), { mode: 'cached' });

    expect(findSpaceTimePlan({ ...options, metrics: legacyMetrics }))
      .toEqual(findSpaceTimePlan({ ...options, metrics: cachedMetrics }));
    expect(legacyMetrics.solverExecutablePrefixScores).toBeGreaterThan(0);
    expect(legacyMetrics.solverExecutablePrefixNodeVisits).toBeGreaterThan(0);
    expect(cachedMetrics.solverExecutablePrefixScores)
      .toBe(legacyMetrics.solverExecutablePrefixScores);
    expect(cachedMetrics.solverExecutablePrefixNodeVisits).toBe(0);
  });

  it('counts each plan call and expanded frontier state', () => {
    const metrics = createMovementMetrics();
    const plan = findSpaceTimePlan({
      state: openState, routeCells: [{ x: 6, y: 5 }],
      startCell: { x: 5, y: 5 }, goalCell: { x: 6, y: 5 }, blockedCells: new Set(), horizon: 1,
      vertexReservations: new Map(), edgeReservations: new Set(), metrics,
    });

    expect(plan).not.toBeNull();
    expect(metrics.spaceTimePlanCalls).toBe(1);
    expect(metrics.spaceTimeExpandedStates).toBe(1);
  });

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
  it('returns the exact reserved dependent re-planning snapshot through a PBS conflict', () => {
    const result = solveLocalConflictComponent({
      state: openState,
      actors: [
        actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
        actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }),
      ],
      blockedCells: new Set(), horizon: 3, progressHorizon: 2, maxHighLevelNodes: 128,
    });

    expect({ mode: result.mode, plans: [...result.plans.entries()].sort() }).toEqual({
      mode: 'pbs',
      plans: [
        ['a', [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]],
        ['b', [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 5 }]],
      ],
    });
  });

  it('returns the exact max-node aged-fallback plan snapshot', () => {
    const result = solveLocalConflictComponent({
      state: openState,
      actors: [
        actor('a-new', { x: 4, y: 5 }, { x: 5, y: 5 }, 0),
        actor('z-old', { x: 5, y: 4 }, { x: 5, y: 5 }, 4),
      ],
      blockedCells: new Set(), horizon: 3, progressHorizon: 2, maxHighLevelNodes: 0,
    });

    expect({ mode: result.mode, plans: [...result.plans.entries()].sort() }).toEqual({
      mode: 'aged-fallback',
      plans: [
        ['a-new', [{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 5 }]],
        ['z-old', [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]],
      ],
    });
  });

  it('accounts ordinary PBS search work in exclusive solver phases', () => {
    const actors = [
      actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
      actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }),
    ];
    const metrics = createMovementMetrics();
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 1, metrics,
    });

    expect(result.mode).toBe('pbs');
    expect(metrics.solverCalls).toBe(1);
    expect([metrics.solverPbs, metrics.solverAgedFallback, metrics.solverNull]).toEqual([1, 0, 0]);
    expect(metrics.spaceTimePlanCalls).toBeGreaterThanOrEqual(actors.length);
    expect(metrics.spaceTimeExpandedStates).toBeGreaterThan(0);
    expect(metrics.solverNodesBuilt).toBeGreaterThanOrEqual(1);
    expect(metrics.solverBranchesGenerated).toBeGreaterThan(0);
    expect(metrics.solverInitialPlanningMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.solverNodeBuildMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.solverFrontierOrderingMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.solverReplanningMilliseconds).toBeGreaterThanOrEqual(0);
    expectFiniteNonNegativeTimings(metrics);
  });

  it('accounts the max-node aged fallback without PBS phase overlap', () => {
    const metrics = createMovementMetrics();
    const result = solveLocalConflictComponent({
      state: openState,
      actors: [
        actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
        actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }),
      ],
      blockedCells: new Set(), horizon: 1, maxHighLevelNodes: 0, metrics,
    });

    expect(result.mode).toBe('aged-fallback');
    expect(metrics.solverCalls).toBe(1);
    expect([metrics.solverPbs, metrics.solverAgedFallback, metrics.solverNull]).toEqual([0, 1, 0]);
    expect(metrics.solverAgedFallbackMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.solverInitialPlanningMilliseconds).toBe(0);
    expect(metrics.solverNodeBuildMilliseconds).toBe(0);
    expect(metrics.solverFrontierOrderingMilliseconds).toBe(0);
    expect(metrics.solverReplanningMilliseconds).toBe(0);
    expectFiniteNonNegativeTimings(metrics);
  });

  it('accounts an initial-plan null return', () => {
    const metrics = createMovementMetrics();
    const result = solveLocalConflictComponent({
      state: openState,
      actors: [actor('outside', { x: -10, y: -10 }, { x: 9, y: 5 })],
      blockedCells: new Set(),
      horizon: 1,
      metrics,
    });

    expect(result).toBeNull();
    expect(metrics.solverCalls).toBe(1);
    expect([metrics.solverPbs, metrics.solverAgedFallback, metrics.solverNull]).toEqual([0, 0, 1]);
    expect(metrics.solverInitialPlanningMilliseconds).toBeGreaterThanOrEqual(0);
    expect(metrics.solverNodesBuilt).toBe(0);
    expect(metrics.solverBranchesGenerated).toBe(0);
    expectFiniteNonNegativeTimings(metrics);
  });

  it('rejects a priority edge that would close a PBS cycle', () => {
    const actors = [
      actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
      actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }),
      actor('c', { x: 6, y: 5 }, { x: 5, y: 5 }),
    ];
    const edges = [['a', 'b'], ['b', 'c']];

    expect(addPriorityEdge(actors, edges, 'c', 'a')).toBeNull();
    expect(addPriorityEdge(actors, edges, 'a', 'c')).toEqual([...edges, ['a', 'c']]);
  });

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

  it('replans transitive priority dependants and stays stable across input permutations', () => {
    const actors = [
      { ...actor('a', { x: 4, y: 5 }, { x: 7, y: 5 }, 3), routeCells: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }] },
      { ...actor('b', { x: 5, y: 4 }, { x: 5, y: 7 }, 2), routeCells: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }] },
      { ...actor('c', { x: 6, y: 5 }, { x: 3, y: 5 }, 1), routeCells: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }] },
    ];
    const solve = entries => solveLocalConflictComponent({
      state: openState, actors: entries, blockedCells: new Set(), horizon: 4, maxHighLevelNodes: 128,
    });

    const first = solve(actors);
    const permuted = solve([actors[2], actors[0], actors[1]]);
    expect(first.mode).toBe('pbs');
    expectConflictFree(first.plans, actors);
    expect(serialisePlans(first.plans)).toBe(serialisePlans(permuted.plans));
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

  it('keeps aged executable-prefix progress while reserving the remaining eight-slot route', () => {
    const actors = [
      { ...actor('a', { x: 4, y: 5 }, { x: 6, y: 5 }, 1), routeCells: [{ x: 5, y: 5 }, { x: 6, y: 5 }] },
      actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }, 0),
    ];
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 8,
      progressHorizon: 2, maxHighLevelNodes: 128,
    });

    expect(result.plans.get('a').slice(0, 2)).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    expect(result.plans.get('a')).toHaveLength(8);
    expect(result.plans.get('b')).toHaveLength(8);
    expectConflictFree(result.plans, actors);
  });

  it('uses deterministic aged fallback for 13 genuinely moving contentious actors', () => {
    const actors = Array.from({ length: 13 }, (_, index) => ({
      ...actor(
        `actor-${String(index).padStart(2, '0')}`,
        { x: 4 + index, y: 10 },
        { x: 10, y: 12 },
        index,
      ),
      routeCells: [{ x: 10, y: 10 }, { x: 10, y: 11 }, { x: 10, y: 12 }],
    }));
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 8, maxHighLevelNodes: 128,
    });

    expect(result.mode).toBe('aged-fallback');
    expect(result.plans.size).toBe(13);
    expectConflictFree(result.plans, actors);
    const reversed = solveLocalConflictComponent({
      state: openState, actors: [...actors].reverse(), blockedCells: new Set(), horizon: 8, maxHighLevelNodes: 128,
    });
    expect(serialisePlans(result.plans)).toBe(serialisePlans(reversed.plans));
  });

  it('does not count stationary actors towards the twelve-moving PBS cap', () => {
    const actors = [
      ...Array.from({ length: 12 }, (_, index) => actor(
        `moving-${String(index).padStart(2, '0')}`,
        { x: 4 + index, y: 10 },
        { x: 4 + index, y: 10 },
      )),
      { ...actor('stationary', { x: 20, y: 10 }, { x: 20, y: 10 }), moving: false },
    ];
    const result = solveLocalConflictComponent({
      state: openState, actors, blockedCells: new Set(), horizon: 2, maxHighLevelNodes: 128,
    });

    expect(result.mode).toBe('pbs');
    expect(result.plans.size).toBe(13);
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
