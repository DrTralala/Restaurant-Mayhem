import { describe, expect, it } from 'vitest';
import {
  RECOVERY_SEARCH_LIMITS,
  advanceRecoverySearch,
  buildRecoveryCandidateIndex,
  comparePendingRecoveryPriority,
  createPendingRecoverySearch,
  createRecoverySearchAllowance,
  createRecoveryTickBudget,
  getRecoveryLayoutSignature,
  getRecoveryQueueSignature,
  nextRecoveryWaitCount,
  reconstructRecoveryRoute,
  validatePendingRecoverySearch,
} from './customerRecoverySearch';
import {
  buildBlockedCells,
  cellToWorld,
  isInsideWorld,
  worldToCell,
} from './pathfinding';

function stateForLevel(expansionLevel = 1, overrides = {}) {
  return {
    restaurant: { expansionLevel },
    doors: [],
    tables: [],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    staff: [],
    customers: [],
    queue: [],
    ...overrides,
  };
}

const guidedCustomer = {
  id: 'guided-1',
  state: 'guided',
  x: 100,
  y: 100,
};

const guidedGoal = {
  cell: { x: 10, y: 5 },
  world: { x: 200, y: 100 },
  useWorldGoal: false,
  key: 'guided:10,5:200,100',
};

const levelFourOpenState = stateForLevel(4);

const layoutStateA = stateForLevel(1, {
  restaurant: { expansionLevel: 2 },
  doors: [
    { id: 'door-b', x: 1447, y: 520, w: 6, h: 40, rotation: 0 },
    { id: 'door-a', x: 1447, y: 340, w: 6, h: 40, rotation: 90 },
  ],
  tables: [{ id: 'table-1', x: 100, y: 140, w: 40, h: 40, rotation: 0 }],
  chairs: [{ id: 'chair-1', x: 80, y: 140, w: 20, h: 20, rotation: 90 }],
  kitchenStations: [{ id: 'kitchen-1', x: 60, y: 60, w: 40, h: 40, rotation: 0 }],
  serviceTables: [{ id: 'service-1', x: 180, y: 140, w: 80, h: 40, rotation: 180 }],
  cashierStations: [{ id: 'cashier-1', x: 300, y: 140, w: 40, h: 40, rotation: 270 }],
  washStations: [{ id: 'wash-1', x: 360, y: 140, w: 40, h: 40, rotation: 0 }],
});

const layoutStateReordered = {
  ...layoutStateA,
  doors: [...layoutStateA.doors].reverse(),
  tables: [...layoutStateA.tables].reverse(),
  chairs: [...layoutStateA.chairs].reverse(),
  kitchenStations: [...layoutStateA.kitchenStations].reverse(),
  serviceTables: [...layoutStateA.serviceTables].reverse(),
  cashierStations: [...layoutStateA.cashierStations].reverse(),
  washStations: [...layoutStateA.washStations].reverse(),
};

const layoutStateMoved = {
  ...layoutStateA,
  tables: [{ ...layoutStateA.tables[0], x: 120 }],
};

const queueA = [
  { id: 'queued-b', x: 1459, y: 610 },
  { id: 'queued-a', x: 1459, y: 580 },
];

const queueReordered = [...queueA].reverse();
const queueMoved = [{ ...queueA[0] }, { ...queueA[1], y: 600 }];

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotPlans(plans) {
  return plans instanceof Map
    ? Object.fromEntries([...plans].sort(([left], [right]) => String(left).localeCompare(String(right))))
    : null;
}

function pairSearchContext(overrides = {}) {
  const initiator = {
    id: 'customer-b', state: 'guided', x: 100, y: 100,
    path: [{ x: 10, y: 5 }], pathGoal: { x: 10, y: 5 },
  };
  const blockerCustomer = {
    id: 'customer-a', state: 'guided', x: 120, y: 100,
    path: [{ x: 4, y: 5 }], pathGoal: { x: 4, y: 5 },
  };
  const initiatorGoal = {
    cell: { x: 10, y: 5 }, world: { x: 200, y: 100 }, useWorldGoal: false,
    key: 'guided:10,5:200,100',
  };
  const blockerGoal = {
    cell: { x: 4, y: 5 }, world: { x: 80, y: 100 }, useWorldGoal: false,
    key: 'guided:4,5:80,100',
  };
  const state = stateForLevel(1, {
    customers: [initiator, blockerCustomer],
    staff: [
      { id: 'fixed-at-first-candidate', x: 100, y: 100 },
    ],
  });
  return {
    state,
    initiator,
    initiatorGoal,
    blockerCustomer,
    blocker: { kind: 'customer', customer: blockerCustomer },
    blockerGoal,
    ...overrides,
  };
}

function runUntilSettled(initialCursor, context, budgets, maximumChunks = 100) {
  let cursor = initialCursor;
  let result = null;
  for (let chunk = 0; chunk < maximumChunks; chunk += 1) {
    const limits = budgets[Math.min(chunk, budgets.length - 1)];
    result = advanceRecoverySearch({
      state: context.state,
      cursor,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      blockerCustomer: context.blockerCustomer,
      blockerGoal: context.blockerGoal,
      tickBudget: createRecoveryTickBudget(limits),
    });
    if (result.status !== 'pending') return result;
    cursor = result.cursor;
  }
  throw new Error('recovery search did not settle');
}

describe('recovery search limits and accounting', () => {
  it('exports the fixed frozen search limits', () => {
    expect(RECOVERY_SEARCH_LIMITS).toEqual({
      globalPathSearchEquivalents: 16,
      globalPairCandidateChecks: 2048,
      perSearchPathSearchEquivalents: 8,
      perSearchPairCandidateChecks: 2048,
    });
    expect(Object.isFrozen(RECOVERY_SEARCH_LIMITS)).toBe(true);
  });

  it('caps and accounts path and pair work against both ceilings', () => {
    const budget = createRecoveryTickBudget();
    const first = createRecoverySearchAllowance(budget);
    const second = createRecoverySearchAllowance(budget);

    expect(first.canSpendPath(8)).toBe(true);
    expect(first.canSpendPath(9)).toBe(false);
    expect(first.spendPath(8, 12)).toBe(true);
    expect(first.spendPath(1, 1)).toBe(false);
    expect(second.spendPath(8, 10)).toBe(true);
    expect(second.canSpendPath(1)).toBe(false);
    expect(budget).toMatchObject({
      remainingPathSearchEquivalents: 0,
      usedPathSearchEquivalents: 16,
      reachableCellVisits: 22,
    });

    expect(first.canCheckPair()).toBe(true);
    expect(first.spendPairCheck()).toBe(true);
    expect(budget).toMatchObject({
      remainingPairCandidateChecks: 2047,
      usedPairCandidateChecks: 1,
    });
  });

  it('caps a search allowance by a smaller remaining global budget', () => {
    const budget = createRecoveryTickBudget({
      remainingPathSearchEquivalents: 2,
      remainingPairCandidateChecks: 3,
    });
    const allowance = createRecoverySearchAllowance(budget);

    expect(allowance.canSpendPath(2)).toBe(true);
    expect(allowance.canSpendPath(3)).toBe(false);
    expect(allowance.spendPath(2, 0)).toBe(true);
    expect(allowance.canCheckPair()).toBe(true);
    expect(allowance.spendPairCheck()).toBe(true);
    expect(allowance.spendPairCheck()).toBe(true);
    expect(allowance.spendPairCheck()).toBe(true);
    expect(allowance.canCheckPair()).toBe(false);
  });

  it('clamps excessive global budget overrides to the fixed global and per-search ceilings', () => {
    const budget = createRecoveryTickBudget({
      globalPathSearchEquivalents: Number.MAX_SAFE_INTEGER,
      globalPairCandidateChecks: Number.MAX_SAFE_INTEGER,
      remainingPathSearchEquivalents: Number.MAX_SAFE_INTEGER,
      remainingPairCandidateChecks: Number.MAX_SAFE_INTEGER,
    });
    const allowance = createRecoverySearchAllowance(budget);

    expect(budget).toMatchObject({
      remainingPathSearchEquivalents: RECOVERY_SEARCH_LIMITS.globalPathSearchEquivalents,
      remainingPairCandidateChecks: RECOVERY_SEARCH_LIMITS.globalPairCandidateChecks,
    });
    expect(allowance).toMatchObject({
      remainingPathSearchEquivalents: RECOVERY_SEARCH_LIMITS.perSearchPathSearchEquivalents,
      remainingPairCandidateChecks: RECOVERY_SEARCH_LIMITS.perSearchPairCandidateChecks,
    });
  });
});

describe('recovery signatures', () => {
  it('uses canonical layout and queue signatures independent of input order', () => {
    expect(getRecoveryLayoutSignature(layoutStateA)).toBe(getRecoveryLayoutSignature(layoutStateReordered));
    expect(getRecoveryLayoutSignature(layoutStateA)).not.toBe(getRecoveryLayoutSignature(layoutStateMoved));
    expect(getRecoveryQueueSignature(queueA)).toBe(getRecoveryQueueSignature(queueReordered));
    expect(getRecoveryQueueSignature(queueA)).not.toBe(getRecoveryQueueSignature(queueMoved));
  });

  it.each([
    ['expansion level', { restaurant: { expansionLevel: 3 } }],
    ['door ID', { doors: [{ ...layoutStateA.doors[0], id: 'door-moved' }, layoutStateA.doors[1]] }],
    ['door position', { doors: [{ ...layoutStateA.doors[0], y: 540 }, layoutStateA.doors[1]] }],
    ['blocking-object ID', { chairs: [{ ...layoutStateA.chairs[0], id: 'chair-moved' }] }],
    ['blocking-object position', { chairs: [{ ...layoutStateA.chairs[0], x: 100 }] }],
    ['blocking-object dimensions', { chairs: [{ ...layoutStateA.chairs[0], w: 30 }] }],
    ['blocking-object rotation', { chairs: [{ ...layoutStateA.chairs[0], rotation: 180 }] }],
  ])('changes when %s changes', (_label, change) => {
    expect(getRecoveryLayoutSignature({ ...layoutStateA, ...change }))
      .not.toBe(getRecoveryLayoutSignature(layoutStateA));
  });

  it('normalises non-finite signature fields without throwing', () => {
    const malformed = stateForLevel(Number.POSITIVE_INFINITY, {
      tables: [{ id: 'bad', x: Number.NaN, y: Number.POSITIVE_INFINITY, w: Number.NEGATIVE_INFINITY }],
    });
    const normalised = stateForLevel(1, {
      tables: [{ id: 'bad', x: null, y: null, w: null }],
    });

    expect(() => getRecoveryLayoutSignature(malformed)).not.toThrow();
    expect(getRecoveryLayoutSignature(malformed)).toBe(getRecoveryLayoutSignature(normalised));
  });

  it('uses projected queue IDs and positions in its canonical signature', () => {
    expect(getRecoveryQueueSignature([{ id: 'q', x: 1, y: 2 }]))
      .not.toBe(getRecoveryQueueSignature([{ id: 'q-moved', x: 1, y: 2 }]));
    expect(getRecoveryQueueSignature([{ id: 'q', x: 1, y: 2 }]))
      .not.toBe(getRecoveryQueueSignature([{ id: 'q', x: 1, y: 3 }]));
  });
});

describe('goal-rooted recovery candidate indexing', () => {
  it('charges before reachability traversal and refuses traversal when accounting cannot spend', () => {
    let geometryRead = false;
    const state = new Proxy(stateForLevel(1), {
      get(target, property, receiver) {
        geometryRead = true;
        return Reflect.get(target, property, receiver);
      },
    });
    const spendCalls = [];
    const allowance = {
      canSpendPath: () => true,
      spendPath(count, reachableVisits = 0) {
        spendCalls.push({ count, reachableVisits, geometryRead });
        return true;
      },
    };

    const result = buildRecoveryCandidateIndex(
      state,
      guidedCustomer,
      guidedGoal,
      { x: guidedCustomer.x, y: guidedCustomer.y },
      [],
      allowance,
    );

    expect(result.status).toBe('ready');
    expect(spendCalls[0]).toEqual({ count: 1, reachableVisits: 0, geometryRead: false });
    expect(spendCalls.filter(call => call.count === 1)).toHaveLength(1);
    expect(spendCalls.reduce((total, call) => total + call.reachableVisits, 0))
      .toBe(result.work.reachableCellVisits);

    const unreadState = new Proxy({}, {
      get() {
        throw new Error('geometry traversed after path charge was refused');
      },
    });
    const refusingAllowance = {
      canSpendPath: () => true,
      spendPath: () => false,
    };
    let refused;
    expect(() => {
      refused = buildRecoveryCandidateIndex(
        unreadState,
        guidedCustomer,
        guidedGoal,
        { x: guidedCustomer.x, y: guidedCustomer.y },
        [],
        refusingAllowance,
      );
    }).not.toThrow();
    expect(refused).toMatchObject({ status: 'pending', candidates: [] });
    expect(refused.nextCellByKey.size).toBe(0);
  });

  it('builds a level-4 candidate index with one bounded reachability fill', () => {
    const budget = createRecoveryTickBudget();
    const allowance = createRecoverySearchAllowance(budget);
    const result = buildRecoveryCandidateIndex(
      levelFourOpenState,
      guidedCustomer,
      guidedGoal,
      { x: guidedCustomer.x, y: guidedCustomer.y },
      [],
      allowance,
    );

    expect(result.status).toBe('ready');
    expect(budget.usedPathSearchEquivalents).toBe(1);
    expect(budget.reachableCellVisits).toBeLessThanOrEqual(3724);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every(candidate => !Object.hasOwn(candidate, 'route'))).toBe(true);
    expect(result.candidates.every(candidate => [
      'cell', 'point', 'relocationDistance', 'forwardProgress', 'routeLength',
    ].every(key => Object.hasOwn(candidate, key)))).toBe(true);
  });

  it('returns pending without traversing cells when no path allowance remains', () => {
    const budget = createRecoveryTickBudget({ remainingPathSearchEquivalents: 0 });
    const result = buildRecoveryCandidateIndex(
      stateForLevel(1),
      guidedCustomer,
      guidedGoal,
      { x: guidedCustomer.x, y: guidedCustomer.y },
      [],
      createRecoverySearchAllowance(budget),
    );

    expect(result).toMatchObject({ status: 'pending', candidates: [] });
    expect(result.nextCellByKey.size).toBe(0);
    expect(budget).toMatchObject({ usedPathSearchEquivalents: 0, reachableCellVisits: 0 });
    expect(result.work).toMatchObject({ pathSearchEquivalents: 0, reachableCellVisits: 0 });
  });

  it('returns pending before reading world, blocked, or queue geometry with no path allowance', () => {
    const state = new Proxy({}, {
      get() {
        throw new Error('world or blocked geometry was read');
      },
    });
    const queueActors = new Proxy([], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error('queue geometry was traversed');
        return Reflect.get(target, property, receiver);
      },
    });
    const budget = createRecoveryTickBudget({ remainingPathSearchEquivalents: 0 });

    expect(() => buildRecoveryCandidateIndex(
      state,
      guidedCustomer,
      guidedGoal,
      { x: guidedCustomer.x, y: guidedCustomer.y },
      queueActors,
      createRecoverySearchAllowance(budget),
    )).not.toThrow();
    expect(budget).toMatchObject({ usedPathSearchEquivalents: 0, reachableCellVisits: 0 });
  });

  it('excludes the anchored origin, static blockers, and does not filter moving actors', () => {
    const state = stateForLevel(1, {
      chairs: [{ id: 'blocked', x: 120, y: 100 }],
      staff: [{ id: 'moving-staff', x: 200, y: 100 }],
      customers: [{ id: 'moving-customer', x: 220, y: 100 }],
    });
    const budget = createRecoveryTickBudget();
    const result = buildRecoveryCandidateIndex(
      state,
      guidedCustomer,
      guidedGoal,
      { x: guidedCustomer.x, y: guidedCustomer.y },
      [],
      createRecoverySearchAllowance(budget),
    );
    const keys = new Set(result.candidates.map(candidate => `${candidate.cell.x},${candidate.cell.y}`));

    expect(keys.has('5,5')).toBe(false);
    expect(keys.has('6,5')).toBe(false);
    expect(keys.has('10,5')).toBe(true);
  });

  it('uses queue-clearance cells for a leaving customer but leaves moving occupancy to evaluation', () => {
    const state = stateForLevel(1, { customers: [{ id: 'moving', x: 300, y: 100 }] });
    const queueActors = [{ id: 'queued', x: 200, y: 100 }];
    const leavingCustomer = { ...guidedCustomer, state: 'leaving' };
    const leavingGoal = { ...guidedGoal, cell: { x: 15, y: 5 }, world: { x: 300, y: 100 } };
    const result = buildRecoveryCandidateIndex(
      state,
      leavingCustomer,
      leavingGoal,
      { x: leavingCustomer.x, y: leavingCustomer.y },
      queueActors,
      createRecoverySearchAllowance(createRecoveryTickBudget()),
    );
    const keys = new Set(result.candidates.map(candidate => `${candidate.cell.x},${candidate.cell.y}`));

    expect(keys.has('10,5')).toBe(false);
    expect(keys.has('15,5')).toBe(true);
  });

  it('rejects an exact world goal whose final segment crosses a static blocker', () => {
    const state = stateForLevel(1, { chairs: [{ id: 'segment-blocker', x: 140, y: 100 }] });
    const exactGoal = {
      ...guidedGoal,
      cell: { x: 6, y: 5 },
      world: { x: 161, y: 100 },
      useWorldGoal: true,
    };
    const result = buildRecoveryCandidateIndex(
      state,
      guidedCustomer,
      exactGoal,
      { x: guidedCustomer.x, y: guidedCustomer.y },
      [],
      createRecoverySearchAllowance(createRecoveryTickBudget()),
    );

    expect(result.status).toBe('ready');
    expect(result.candidates).toEqual([]);
  });

  it('reconstructs candidate-to-goal cells lazily from next-cell links', () => {
    const result = buildRecoveryCandidateIndex(
      stateForLevel(1),
      guidedCustomer,
      guidedGoal,
      { x: guidedCustomer.x, y: guidedCustomer.y },
      [],
      createRecoverySearchAllowance(createRecoveryTickBudget()),
    );
    const candidate = result.candidates.find(item => item.routeLength === 2);

    expect(candidate).toBeDefined();
    expect(reconstructRecoveryRoute(result, candidate.cell)).toHaveLength(2);
    expect(reconstructRecoveryRoute(result, candidate.cell).at(-1)).toEqual(guidedGoal.cell);
    expect(reconstructRecoveryRoute(result, guidedGoal.cell)).toEqual([]);
  });

  it('uses the shared pathfinding geometry for world-cell bounds and blocked cells', () => {
    const state = stateForLevel(1);
    const blocked = buildBlockedCells(state);
    const inside = { x: 5, y: 5 };
    const outside = { x: -1, y: -1 };

    expect(isInsideWorld(state, inside)).toBe(true);
    expect(isInsideWorld(state, outside)).toBe(false);
    expect(blocked.has(`${worldToCell(cellToWorld(inside)).x},${worldToCell(cellToWorld(inside)).y}`)).toBe(false);
  });
});

describe('serialisable recovery cursor validation and fair wait priority', () => {
  it('creates a scalar-only pair cursor in stable customer-ID order', () => {
    const context = pairSearchContext();
    const cursor = createPendingRecoverySearch(context);

    expect(JSON.parse(JSON.stringify(cursor))).toEqual(cursor);
    expect(cursor).toEqual({
      version: 1,
      kind: 'pair',
      blockerKey: 'customer:customer-a',
      first: {
        id: 'customer-a', origin: { x: 120, y: 100 }, goalKey: context.blockerGoal.key,
      },
      second: {
        id: 'customer-b', origin: { x: 100, y: 100 }, goalKey: context.initiatorGoal.key,
      },
      layoutSignature: getRecoveryLayoutSignature(context.state),
      queueSignature: getRecoveryQueueSignature([]),
      firstIndex: 0,
      secondIndex: 0,
      waitTicks: 0,
    });
  });

  it('creates a single cursor without a second actor', () => {
    const context = pairSearchContext();
    const cursor = createPendingRecoverySearch({
      state: context.state,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      blocker: { kind: 'fixed', key: 'cell:6,5' },
    });

    expect(cursor.kind).toBe('single');
    expect(cursor.blockerKey).toBe('cell:6,5');
    expect(cursor).not.toHaveProperty('second');
    expect(JSON.parse(JSON.stringify(cursor))).toEqual(cursor);
  });

  it('accepts moved actors while rejecting changed identity, state, goal, blocker, and signatures', () => {
    const context = pairSearchContext();
    const cursor = createPendingRecoverySearch(context);
    const validation = overrides => validatePendingRecoverySearch({
      state: context.state,
      cursor,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      blocker: context.blocker,
      blockerGoal: context.blockerGoal,
      ...overrides,
    });

    expect(validation({
      initiator: { ...context.initiator, x: 180, y: 140 },
      blocker: {
        kind: 'customer',
        customer: { ...context.blockerCustomer, x: 200, y: 160 },
      },
    })).toBe(true);
    expect(validation({ initiator: { ...context.initiator, id: 'changed' } })).toBe(false);
    expect(validation({ initiator: { ...context.initiator, state: 'leaving' } })).toBe(false);
    expect(validation({ initiatorGoal: { ...context.initiatorGoal, key: 'guided:changed' } }))
      .toBe(false);
    expect(validation({
      blocker: { kind: 'customer', customer: { ...context.blockerCustomer, id: 'other' } },
    })).toBe(false);
    expect(validation({
      state: { ...context.state, chairs: [{ id: 'layout-change', x: 300, y: 300 }] },
    })).toBe(false);
    expect(validation({
      state: {
        ...context.state,
        queue: [{ partyId: 'queued-party', members: [{ id: 'queued-change' }] }],
      },
    })).toBe(false);
  });

  it.each([
    ['negative first index', cursor => { cursor.firstIndex = -1; }],
    ['fractional second index', cursor => { cursor.secondIndex = 0.5; }],
    ['non-finite origin', cursor => { cursor.first.origin.x = Number.POSITIVE_INFINITY; }],
    ['non-integer wait count', cursor => { cursor.waitTicks = 1.5; }],
    ['negative wait count', cursor => { cursor.waitTicks = -1; }],
    ['extra cursor field', cursor => { cursor.unexpected = true; }],
    ['missing actor field', cursor => { delete cursor.first.goalKey; }],
  ])('rejects malformed cursor structure: %s', (_label, corrupt) => {
    const context = pairSearchContext();
    const cursor = createPendingRecoverySearch(context);
    corrupt(cursor);

    expect(() => validatePendingRecoverySearch({
      state: context.state,
      cursor,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      blocker: context.blocker,
      blockerGoal: context.blockerGoal,
    })).not.toThrow();
    expect(validatePendingRecoverySearch({
      state: context.state,
      cursor,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      blocker: context.blocker,
      blockerGoal: context.blockerGoal,
    })).toBe(false);
  });

  it('resets advanced wait counts, increments waiting counts, and saturates safely', () => {
    expect(nextRecoveryWaitCount(8, true)).toBe(0);
    expect(nextRecoveryWaitCount(8, false)).toBe(9);
    expect(nextRecoveryWaitCount(Number.MAX_SAFE_INTEGER, false)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('sorts pending customers by greatest wait then string ID', () => {
    const customers = [
      { id: 'customer-2', pendingRecoverySearch: { waitTicks: 3 } },
      { id: 'customer-10', pendingRecoverySearch: { waitTicks: 5 } },
      { id: 'customer-1', pendingRecoverySearch: { waitTicks: 5 } },
    ];

    expect(customers.sort(comparePendingRecoveryPriority).map(customer => customer.id))
      .toEqual(['customer-1', 'customer-10', 'customer-2']);
  });
});

describe('bounded recovery search advancement', () => {
  it('resumes pair order across budget chunks and matches one-chunk planning', () => {
    const context = pairSearchContext();
    const cursor = createPendingRecoverySearch(context);
    const first = advanceRecoverySearch({
      state: context.state,
      cursor,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      blockerCustomer: context.blockerCustomer,
      blockerGoal: context.blockerGoal,
      tickBudget: createRecoveryTickBudget({
        globalPathSearchEquivalents: 2,
        globalPairCandidateChecks: 3,
      }),
    });

    expect(first.status).toBe('pending');
    expect(first.plannedCustomers).toBeUndefined();
    expect(first.work.usedPairCandidateChecks).toBe(0);
    expect(first.cursor).toEqual(cursor);

    const second = advanceRecoverySearch({
      state: context.state,
      cursor: first.cursor,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      blockerCustomer: context.blockerCustomer,
      blockerGoal: context.blockerGoal,
      tickBudget: createRecoveryTickBudget({
        globalPathSearchEquivalents: 6,
        globalPairCandidateChecks: 3,
      }),
    });
    expect(second.status).toBe('pending');
    expect(second.work.usedPairCandidateChecks).toBe(3);
    expect(second.cursor.firstIndex > 0 || second.cursor.secondIndex > 0).toBe(true);

    const resumed = runUntilSettled(second.cursor, context, [{
      globalPathSearchEquivalents: 8,
      globalPairCandidateChecks: 2048,
    }]);
    const oneChunk = runUntilSettled(cursor, context, [{
      globalPathSearchEquivalents: 8,
      globalPairCandidateChecks: 2048,
    }]);
    expect(resumed.status).toBe('success');
    expect(snapshotPlans(resumed.plannedCustomers)).toEqual(snapshotPlans(oneChunk.plannedCustomers));
  });

  it('advances a rejected pair exactly once across one-check chunks', () => {
    const context = pairSearchContext();
    let cursor = createPendingRecoverySearch(context);
    const visited = [];

    for (let chunk = 0; chunk < 3; chunk += 1) {
      const result = advanceRecoverySearch({
        state: context.state,
        cursor,
        initiator: context.initiator,
        initiatorGoal: context.initiatorGoal,
        blockerCustomer: context.blockerCustomer,
        blockerGoal: context.blockerGoal,
        tickBudget: createRecoveryTickBudget({
          globalPathSearchEquivalents: 6,
          globalPairCandidateChecks: 1,
        }),
      });
      expect(result.status).toBe('pending');
      expect(result.work.usedPairCandidateChecks).toBe(1);
      const key = `${result.cursor.firstIndex}:${result.cursor.secondIndex}`;
      expect(visited).not.toContain(key);
      visited.push(key);
      cursor = result.cursor;
    }
  });

  it('returns a complete staged map for single recovery without mutating inputs', () => {
    const context = pairSearchContext({
      state: stateForLevel(1),
    });
    context.state = { ...context.state, customers: [context.initiator] };
    const cursor = createPendingRecoverySearch({
      state: context.state,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      blocker: { kind: 'fixed', key: 'cell:6,5' },
    });
    const before = snapshot({ state: context.state, initiator: context.initiator });

    const result = advanceRecoverySearch({
      state: context.state,
      cursor,
      initiator: context.initiator,
      initiatorGoal: context.initiatorGoal,
      tickBudget: createRecoveryTickBudget(),
    });

    expect(result.status).toBe('success');
    expect(result.plannedCustomers).toBeInstanceOf(Map);
    expect([...result.plannedCustomers.keys()]).toEqual([context.initiator.id]);
    expect(result.cursor).toBeUndefined();
    expect(snapshot({ state: context.state, initiator: context.initiator })).toEqual(before);
  });

  it('executes a real level-4 no-solution search within production work budgets', () => {
    const initiator = {
      id: 'relocating-b', state: 'guided', x: 100, y: 100,
      path: [{ x: 40, y: 20 }], pathGoal: { x: 40, y: 20 },
    };
    const blockerCustomer = {
      id: 'relocating-a', state: 'guided', x: 120, y: 100,
      path: [{ x: 4, y: 20 }], pathGoal: { x: 4, y: 20 },
    };
    const initiatorGoal = {
      cell: { x: 40, y: 20 }, world: { x: 800, y: 400 }, useWorldGoal: false,
      key: 'guided:40,20:800,400',
    };
    const blockerGoal = {
      cell: { x: 4, y: 20 }, world: { x: 80, y: 400 }, useWorldGoal: false,
      key: 'guided:4,20:80,400',
    };
    const openState = stateForLevel(4);
    const fixedActors = [];
    for (let y = 0; y <= 60; y += 1) {
      for (let x = 0; x <= 80; x += 1) {
        const cell = { x, y };
        if (isInsideWorld(openState, cell)) {
          fixedActors.push({ id: `fixed-${x}-${y}`, ...cellToWorld(cell) });
        }
      }
    }
    const state = {
      ...openState,
      customers: [initiator, blockerCustomer],
      staff: fixedActors,
    };
    const context = {
      state,
      initiator,
      initiatorGoal,
      blockerCustomer,
      blocker: { kind: 'customer', customer: blockerCustomer },
      blockerGoal,
    };
    const cursor = createPendingRecoverySearch(context);
    const before = snapshot({
      customers: state.customers,
      paths: state.customers.map(customer => customer.path),
      positions: state.customers.map(({ id, x, y }) => ({ id, x, y })),
    });

    const result = advanceRecoverySearch({
      state,
      cursor,
      initiator,
      initiatorGoal,
      blockerCustomer,
      blockerGoal,
      tickBudget: createRecoveryTickBudget(),
    });

    expect(result.status).toBe('pending');
    expect(result.plannedCustomers).toBeUndefined();
    expect(result.work.usedPathSearchEquivalents).toBeLessThanOrEqual(8);
    expect(result.work.usedPairCandidateChecks).toBe(2048);
    expect(result.work.reachableCellVisits).toBeLessThanOrEqual(59584);
    expect(result.cursor.firstIndex > 0 || result.cursor.secondIndex > 0).toBe(true);
    expect(snapshot({
      customers: state.customers,
      paths: state.customers.map(customer => customer.path),
      positions: state.customers.map(({ id, x, y }) => ({ id, x, y })),
    })).toEqual(before);
  });
});
