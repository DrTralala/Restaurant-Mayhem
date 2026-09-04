import { describe, expect, it } from 'vitest';
import {
  classifyCustomerBlocker,
  clearCustomerOscillationMetadata,
  getCustomerRecoveryGoal,
  observeCustomerOscillation,
  recoverOscillatingCustomers,
} from './customerOscillationRecovery';
import {
  buildBlockedCells,
  cellToWorld,
  isInsideWorld,
  worldToCell,
} from './pathfinding';
import { getQueueProjectedMembers } from './customerQueue';
import {
  RECOVERY_SEARCH_LIMITS,
  buildRecoveryCandidateIndex,
  createRecoverySearchAllowance,
  createRecoveryTickBudget,
} from './customerRecoverySearch';

const goal = {
  cell: { x: 10, y: 5 },
  world: { x: 200, y: 100 },
  useWorldGoal: false,
  key: 'guided:10,5:200,100',
};

const farGoal = {
  cell: { x: 0, y: 5 },
  world: { x: 0, y: 100 },
  useWorldGoal: false,
  key: 'guided:0,5:0,100',
};

function observe(customer, x, dt = 1, target = goal) {
  return observeCustomerOscillation({
    ...customer,
    x,
    y: 100,
    path: customer.path ?? [target.cell],
  }, target, dt);
}

function oscillatingCustomer(overrides = {}) {
  return {
    id: 'a', state: 'guided', x: 100, y: 100,
    path: [{ x: 6, y: 5 }, { x: 10, y: 5 }],
    pathGoal: { x: 10, y: 5 },
    ...overrides,
  };
}

const seededMetadata = {
  state: 'guided',
  goalKey: goal.key,
  previousCell: { x: 6, y: 5 },
  previousPosition: { x: 120, y: 100 },
  corridorCells: ['5,5', '6,5'],
  edges: ['5,5>6,5', '6,5>5,5'],
  pendingMovementFor: 0,
  oscillatingFor: 5,
  bestGoalDistance: 80,
};

function buildState(blocker = null, overrides = {}) {
  const customer = oscillatingCustomer({ oscillationRecovery: seededMetadata });
  return {
    restaurant: { expansionLevel: 1 },
    customers: blocker ? [customer, blocker] : [customer],
    staff: [],
    queue: [],
    tables: [],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    ...overrides,
  };
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function blockWorldExcept(state, openCells) {
  const open = new Set(openCells.map(cell => `${cell.x},${cell.y}`));
  const chairs = [];
  for (let y = 0; y <= 40; y += 1) {
    for (let x = 0; x <= 60; x += 1) {
      const cell = { x, y };
      if (isInsideWorld(state, cell) && !open.has(`${x},${y}`)) {
        chairs.push({ id: `wall-${x}-${y}`, ...cellToWorld(cell) });
      }
    }
  }
  return { ...state, chairs };
}

function occupyWorldExcept(state, openCells) {
  const open = new Set(openCells.map(cell => `${cell.x},${cell.y}`));
  const staff = [];
  for (let y = 0; y <= 40; y += 1) {
    for (let x = 0; x <= 60; x += 1) {
      const cell = { x, y };
      if (isInsideWorld(state, cell) && !open.has(`${x},${y}`)) {
        const point = cellToWorld(cell);
        staff.push({
          id: `occupant-${x}-${y}`, role: 'waiter', x: point.x, y: point.y + 1,
        });
      }
    }
  }
  return { ...state, staff };
}

function pendingPairState() {
  const initiator = oscillatingCustomer({
    oscillationRecovery: seededMetadata,
  });
  const blocker = oscillatingCustomer({
    id: 'b',
    x: 100,
    path: [{ x: 4, y: 5 }],
    pathGoal: { x: 4, y: 5 },
    oscillationRecovery: undefined,
  });
  return occupyWorldExcept(
    buildState(null, { customers: [initiator, blocker] }),
    [{ x: 5, y: 5 }],
  );
}

function simultaneousPendingState(reverse = false) {
  const customers = [];
  const openCells = [];
  for (const [initiatorId, blockerId, y] of [
    ['a', 'b', 100],
    ['c', 'd', 200],
    ['e', 'f', 300],
  ]) {
    const cellY = y / 20;
    const pairGoal = {
      cell: { x: 10, y: cellY },
      world: { x: 200, y },
      useWorldGoal: false,
      key: `guided:10,${cellY}:200,${y}`,
    };
    customers.push(oscillatingCustomer({
      id: initiatorId,
      y,
      path: [{ x: 6, y: cellY }, pairGoal.cell],
      pathGoal: pairGoal.cell,
      oscillationRecovery: {
        ...seededMetadata,
        goalKey: pairGoal.key,
        previousCell: { x: 6, y: cellY },
        previousPosition: { x: 120, y },
        corridorCells: [`5,${cellY}`, `6,${cellY}`],
        edges: [`5,${cellY}>6,${cellY}`, `6,${cellY}>5,${cellY}`],
      },
    }));
    customers.push(oscillatingCustomer({
      id: blockerId,
      x: 100,
      y,
      path: [{ x: 4, y: cellY }],
      pathGoal: { x: 4, y: cellY },
      oscillationRecovery: undefined,
    }));
    openCells.push({ x: 5, y: cellY });
  }
  const ordered = reverse ? [...customers].reverse() : customers;
  return occupyWorldExcept(buildState(null, { customers: ordered }), openCells);
}

function residualBudgetPendingState() {
  const customers = [];
  const openCells = [];
  for (const [initiatorId, blockerId, y] of [
    ['a', 'b', 100],
    ['c', 'd', 200],
    ['e', 'f', 300],
  ]) {
    const cellY = y / 20;
    const sharedGoal = {
      cell: { x: 10, y: cellY },
      world: { x: 200, y },
      useWorldGoal: false,
      key: `guided:10,${cellY}:200,${y}`,
    };
    customers.push(oscillatingCustomer({
      id: initiatorId,
      y,
      path: [{ x: 6, y: cellY }, sharedGoal.cell],
      pathGoal: sharedGoal.cell,
      oscillationRecovery: {
        ...seededMetadata,
        goalKey: sharedGoal.key,
        previousCell: { x: 6, y: cellY },
        previousPosition: { x: 120, y },
        corridorCells: [`5,${cellY}`, `6,${cellY}`],
        edges: [`5,${cellY}>6,${cellY}`, `6,${cellY}>5,${cellY}`],
      },
    }));
    customers.push(oscillatingCustomer({
      id: blockerId,
      x: 120,
      y,
      path: [{ x: 7, y: cellY }, sharedGoal.cell],
      pathGoal: sharedGoal.cell,
      oscillationRecovery: undefined,
    }));
    for (let x = 5; x <= 10; x += 1) openCells.push({ x, y: cellY });
  }
  return blockWorldExcept(buildState(null, { customers }), openCells);
}

function pendingById(state) {
  return Object.fromEntries(state.customers
    .filter(customer => ['a', 'c', 'e'].includes(customer.id))
    .map(customer => [customer.id, snapshot(customer.oscillationRecovery?.pendingSearch)]));
}

function pairCursorOrdinal(state, cursor) {
  const byId = new Map(state.customers.map(customer => [String(customer.id), customer]));
  const secondCustomer = byId.get(cursor.second.id);
  const secondGoal = getCustomerRecoveryGoal(state, secondCustomer);
  const secondIndex = buildRecoveryCandidateIndex(
    state,
    secondCustomer,
    secondGoal,
    cursor.second.origin,
    [],
    createRecoverySearchAllowance(createRecoveryTickBudget()),
  );
  return cursor.firstIndex * secondIndex.candidates.length + cursor.secondIndex;
}

function minimumPointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const divisor = dx * dx + dy * dy;
  const ratio = divisor === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / divisor));
  return Math.hypot(
    point.x - (start.x + dx * ratio),
    point.y - (start.y + dy * ratio),
  );
}

describe('classifyCustomerBlocker', () => {
  it.each([
    ['guided mover', { id: 'b', state: 'guided', x: 120, y: 100, path: [{ x: 4, y: 5 }] }, { kind: 'customer' }],
    ['cashier queue member', { id: 'b', state: 'checkout_moving', x: 120, y: 100, path: [], checkoutPosition: { x: 120, y: 100 } }, { kind: 'customer' }],
    ['pathless checkout customer away from its queue position', { id: 'b', state: 'checkout_moving', x: 120, y: 100, path: [], checkoutPosition: { x: 140, y: 100 } }, { kind: 'fixed', key: 'customer:b' }],
    ['staff', { id: 'b', role: 'waiter', x: 120, y: 100, path: [] }, { kind: 'fixed', key: 'staff:b' }],
    ['seated customer', { id: 'b', state: 'seated', x: 120, y: 100, path: [] }, { kind: 'fixed', key: 'customer:b' }],
    ['checkout processor', { id: 'b', state: 'checkout_processing', x: 120, y: 100, path: [] }, { kind: 'fixed', key: 'customer:b' }],
  ])('classifies a nearby %s blocker with a stable blocker key', (_label, blocker, expected) => {
    const state = blocker.role
      ? buildState(null, { staff: [blocker] })
      : buildState(blocker);
    const triggered = observeCustomerOscillation(
      { ...state.customers[0], x: 100, y: 100 },
      goal,
      0.01,
    );

    expect(triggered.shouldRecover).toBe(true);
    const result = classifyCustomerBlocker(state, triggered.customer, triggered.customer.oscillationRecovery);
    expect(result).toMatchObject(expected);
    if (expected.kind === 'customer') expect(result.customer.id).toBe('b');
  });

  it('classifies a causal exterior queue projection as a fixed blocker', () => {
    const queue = [{ partyId: 'p1', members: [{ id: 'queued', state: 'queued' }] }];
    const queueGoal = {
      cell: { x: 50, y: 19 },
      world: { x: 1000, y: 380 },
      useWorldGoal: false,
      key: 'guided:50,19:1000,380',
    };
    const customer = oscillatingCustomer({
      x: 960,
      y: 380,
      path: [{ x: 49, y: 19 }, { x: 50, y: 19 }],
      pathGoal: queueGoal.cell,
      oscillationRecovery: {
        ...seededMetadata,
        goalKey: queueGoal.key,
        previousCell: { x: 49, y: 19 },
        previousPosition: { x: 980, y: 380 },
        corridorCells: ['48,19', '49,19'],
        edges: ['48,19>49,19', '49,19>48,19'],
        bestGoalDistance: 20,
      },
    });
    const state = buildState(null, { customers: [customer], queue });
    const projected = getQueueProjectedMembers(state, state.queue)[0];
    const triggered = observeCustomerOscillation(customer, queueGoal, 0.01);

    expect(triggered.shouldRecover).toBe(true);
    expect(minimumPointToSegmentDistance(
      projected,
      triggered.customer,
      cellToWorld(triggered.customer.path[0]),
    )).toBeLessThan(16);
    expect(classifyCustomerBlocker(
      state,
      triggered.customer,
      triggered.customer.oscillationRecovery,
    )).toEqual({ kind: 'fixed', key: 'queue:queued' });
  });

  it('selects a nearer static blocker before a farther movable corridor actor', () => {
    const actor = {
      id: 'b', state: 'guided', x: 140, y: 100,
      path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
    };
    const state = buildState(actor, {
      chairs: [{ id: 'near-furniture', x: 120, y: 100 }],
    });
    const customer = oscillatingCustomer({
      path: [{ x: 6, y: 5 }, { x: 10, y: 5 }],
      oscillationRecovery: {
        ...seededMetadata,
        corridorCells: ['5,5', '6,5', '7,5'],
      },
    });

    expect(classifyCustomerBlocker(state, customer, customer.oscillationRecovery))
      .toEqual({ kind: 'fixed', key: 'cell:6,5' });
  });

  it('uses projected coordinates as the queue blocker key when the member has no ID', () => {
    const queue = [{ partyId: 'p1', members: [{ state: 'queued' }] }];
    const state = buildState(null, { queue });
    const projected = getQueueProjectedMembers(state, queue)[0];
    const customer = oscillatingCustomer({
      x: projected.x - 20,
      y: projected.y,
      path: [worldToCell(projected)],
      pathGoal: worldToCell(projected),
      oscillationRecovery: {
        ...seededMetadata,
        previousCell: worldToCell(projected),
        previousPosition: projected,
        corridorCells: [`${worldToCell(projected).x},${worldToCell(projected).y}`],
        edges: [],
        oscillatingFor: 0,
        bestGoalDistance: 20,
      },
    });

    expect(classifyCustomerBlocker(state, customer, customer.oscillationRecovery))
      .toEqual({ kind: 'fixed', key: `queue:${projected.x},${projected.y}` });
  });

  it('prefers staff over equal-distance customer and queue blockers before actor ID', () => {
    const queue = [{ partyId: 'p1', members: [{ id: 'aaa-queue', state: 'queued' }] }];
    const base = buildState(null, { queue });
    const projected = getQueueProjectedMembers(base, queue)[0];
    const current = { x: projected.x - 20, y: projected.y };
    const recovering = oscillatingCustomer({
      ...current,
      path: [worldToCell(projected)],
      pathGoal: worldToCell(projected),
      oscillationRecovery: {
        ...seededMetadata,
        previousCell: worldToCell(current),
        previousPosition: current,
        corridorCells: [
          `${worldToCell(current).x},${worldToCell(current).y}`,
          `${worldToCell(projected).x},${worldToCell(projected).y}`,
        ],
      },
    });
    const fixedCustomer = {
      id: 'mmm-customer', state: 'seated', x: projected.x, y: projected.y, path: [],
    };
    const staff = {
      id: 'zzz-staff', role: 'waiter', x: projected.x, y: projected.y, path: [],
    };
    const state = {
      ...base,
      customers: [recovering, fixedCustomer],
      staff: [staff],
    };

    expect(classifyCustomerBlocker(state, recovering, recovering.oscillationRecovery))
      .toEqual({ kind: 'fixed', key: 'staff:zzz-staff' });
  });

  it('prefers a customer over an equal-distance queue blocker before actor ID', () => {
    const queue = [{ partyId: 'p1', members: [{ id: 'aaa-queue', state: 'queued' }] }];
    const base = buildState(null, { queue });
    const projected = getQueueProjectedMembers(base, queue)[0];
    const current = { x: projected.x - 20, y: projected.y };
    const recovering = oscillatingCustomer({
      ...current,
      path: [worldToCell(projected)],
      pathGoal: worldToCell(projected),
      oscillationRecovery: {
        ...seededMetadata,
        previousCell: worldToCell(current),
        previousPosition: current,
        corridorCells: [
          `${worldToCell(current).x},${worldToCell(current).y}`,
          `${worldToCell(projected).x},${worldToCell(projected).y}`,
        ],
      },
    });
    const fixedCustomer = {
      id: 'zzz-customer', state: 'seated', x: projected.x, y: projected.y, path: [],
    };
    const state = {
      ...base,
      customers: [recovering, fixedCustomer],
    };

    expect(classifyCustomerBlocker(state, recovering, recovering.oscillationRecovery))
      .toEqual({ kind: 'fixed', key: 'customer:zzz-customer' });
  });
});

describe('recoverOscillatingCustomers', () => {
  it('stores a compact pending search when the production budget cannot finish', () => {
    const state = pendingPairState();
    const before = snapshot(state.customers.map(({ id, x, y, path }) => ({ id, x, y, path })));

    const result = recoverOscillatingCustomers(state, 0.01);
    const initiator = result.customers.find(customer => customer.id === 'a');

    expect(result.customers.map(({ id, x, y, path }) => ({ id, x, y, path }))).toEqual(before);
    expect(initiator.oscillationRecovery.pendingSearch).toMatchObject({
      version: 1,
      kind: 'pair',
      blockerKey: 'customer:b',
      waitTicks: 0,
    });
    expect(JSON.parse(JSON.stringify(initiator.oscillationRecovery.pendingSearch)))
      .toEqual(initiator.oscillationRecovery.pendingSearch);
  });

  it('resumes a pending search on a stationary tick without adding oscillation time', () => {
    const first = recoverOscillatingCustomers(pendingPairState(), 0.01);
    const before = first.customers.find(customer => customer.id === 'a').oscillationRecovery;

    const second = recoverOscillatingCustomers(first, 10);
    const after = second.customers.find(customer => customer.id === 'a').oscillationRecovery;

    expect(after.oscillatingFor).toBe(before.oscillatingFor);
    expect(after.pendingSearch.secondIndex).toBeGreaterThan(before.pendingSearch.secondIndex);
    expect(second.customers.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual(first.customers.map(({ id, x, y }) => ({ id, x, y })));
  });

  it.each([
    ['changed goal', state => ({
      ...state,
      customers: state.customers.map(customer => customer.id === 'a'
        ? { ...customer, pathGoal: { x: 11, y: 5 }, path: [{ x: 11, y: 5 }] }
        : customer),
    })],
    ['stopped route', state => ({
      ...state,
      customers: state.customers.map(customer => customer.id === 'a'
        ? { ...customer, path: [] }
        : customer),
    })],
    ['changed blocker key', state => ({
      ...state,
      customers: state.customers.map(customer => customer.id === 'b'
        ? { ...customer, id: 'changed-blocker' }
        : customer),
    })],
    ['moved furniture', state => ({
      ...state,
      chairs: [{ id: 'moved-layout', x: 400, y: 300 }],
    })],
    ['changed relevant queue projection', state => ({
      ...state,
      queue: [{ partyId: 'new-party', members: [{ id: 'new-queued', state: 'queued' }] }],
    })],
  ])('invalidates a pending search after %s without teleporting', (_label, change) => {
    const pending = recoverOscillatingCustomers(pendingPairState(), 0.01);
    const changed = change(pending);
    const before = changed.customers.map(({ id, x, y }) => ({ id, x, y }));

    const result = recoverOscillatingCustomers(changed, 1);
    const initiator = result.customers.find(customer => customer.id === 'a');

    expect(initiator.oscillationRecovery?.pendingSearch).toBeUndefined();
    expect(result.customers.map(({ id, x, y }) => ({ id, x, y }))).toEqual(before);
  });

  it('does not invalidate a pending search for dynamic movement and rejects occupied final candidates', () => {
    const pending = recoverOscillatingCustomers(pendingPairState(), 0.01);
    const moved = {
      ...pending,
      customers: pending.customers.map(customer => customer.id === 'b'
        ? { ...customer, x: customer.x + 1 }
        : customer),
      staff: pending.staff.map((actor, index) => index === 0
        ? { ...actor, x: actor.x + 1 }
        : actor),
    };
    const beforeCursor = moved.customers.find(customer => customer.id === 'a')
      .oscillationRecovery.pendingSearch;

    const result = recoverOscillatingCustomers(moved, 1);
    const initiator = result.customers.find(customer => customer.id === 'a');

    expect(initiator.oscillationRecovery.pendingSearch.blockerKey).toBe('customer:b');
    expect(initiator.oscillationRecovery.pendingSearch.secondIndex)
      .toBeGreaterThan(beforeCursor.secondIndex);
    expect({ x: initiator.x, y: initiator.y }).toEqual({ x: 100, y: 100 });
  });

  it.each([
    ['an invalid cursor object', cursor => ({ ...cursor, firstIndex: -1 })],
    ['a null cursor', () => null],
  ])('removes %s without erasing valid episode metadata', (_label, corrupt) => {
    const pending = recoverOscillatingCustomers(pendingPairState(), 0.01);
    const malformed = {
      ...pending,
      customers: pending.customers.map(customer => customer.id === 'a'
        ? {
          ...customer,
          oscillationRecovery: {
            ...customer.oscillationRecovery,
            pendingSearch: corrupt(customer.oscillationRecovery.pendingSearch),
          },
        }
        : customer),
    };

    const result = recoverOscillatingCustomers(malformed, 1);
    const observation = result.customers.find(customer => customer.id === 'a').oscillationRecovery;

    expect(observation.pendingSearch).toBeUndefined();
    expect(observation).toMatchObject({
      goalKey: goal.key,
      edges: seededMetadata.edges,
      oscillatingFor: 5.01,
    });
  });

  it('discards a malformed cursor without replacing it on the same qualifying reversal', () => {
    const customer = oscillatingCustomer({
      x: 120,
      path: [{ x: 10, y: 5 }],
      oscillationRecovery: {
        ...seededMetadata,
        previousCell: { x: 5, y: 5 },
        previousPosition: { x: 100, y: 100 },
        pendingSearch: null,
      },
    });
    const state = buildState(null, {
      customers: [customer],
      chairs: [{ id: 'causal-blocker', x: 100, y: 100 }],
    });
    const beforeRoute = snapshot(customer.path);

    const result = recoverOscillatingCustomers(state, 0.01);
    const retained = result.customers[0];

    expect({ x: retained.x, y: retained.y, path: retained.path }).toEqual({
      x: 120,
      y: 100,
      path: beforeRoute,
    });
    expect(retained.oscillationRecovery).toMatchObject({
      previousCell: { x: 6, y: 5 },
      edges: seededMetadata.edges,
      oscillatingFor: 5.01,
    });
    expect(retained.oscillationRecovery.pendingSearch).toBeUndefined();

    const retried = recoverOscillatingCustomers({
      ...result,
      customers: [{ ...retained, x: 100 }],
      chairs: [{ id: 'later-blocker', x: 120, y: 100 }],
    }, 0.01).customers[0];
    expect({ x: retried.x, y: retried.y }).not.toEqual({ x: 100, y: 100 });
    expect(retried).not.toHaveProperty('oscillationRecovery');
  });

  it('clears only exhausted pending search and restarts from fresh candidate indices', () => {
    const pending = recoverOscillatingCustomers(pendingPairState(), 0.01);
    const forcedExhaustion = {
      ...pending,
      customers: pending.customers.map(customer => customer.id === 'a'
        ? {
          ...customer,
          oscillationRecovery: {
            ...customer.oscillationRecovery,
            pendingSearch: {
              ...customer.oscillationRecovery.pendingSearch,
              firstIndex: Number.MAX_SAFE_INTEGER,
            },
          },
        }
        : customer),
    };

    const exhausted = recoverOscillatingCustomers(forcedExhaustion, 1);
    const retained = exhausted.customers.find(customer => customer.id === 'a');
    expect(retained.oscillationRecovery.pendingSearch).toBeUndefined();
    expect(retained.oscillationRecovery.oscillatingFor).toBe(5.01);

    const reversed = {
      ...exhausted,
      customers: exhausted.customers.map(customer => customer.id === 'a'
        ? { ...customer, x: 120 }
        : customer),
      staff: exhausted.staff.filter(actor => worldToCell(actor).x !== 6
        || worldToCell(actor).y !== 5),
    };
    const restarted = recoverOscillatingCustomers(reversed, 0.01);
    const cursor = restarted.customers.find(customer => customer.id === 'a')
      .oscillationRecovery.pendingSearch;

    expect(cursor.first.origin).toEqual({ x: 120, y: 100 });
    expect(cursor.firstIndex).toBe(1);
    expect(cursor.secondIndex).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('fairly advances three searches without starvation using wait count and ID priority', () => {
    let forward = simultaneousPendingState();
    let reverse = simultaneousPendingState(true);
    const forwardOrder = forward.customers.map(customer => customer.id);
    const reverseOrder = reverse.customers.map(customer => customer.id);
    const seenAdvancement = new Set();
    let previousOrdinals = { a: 0, c: 0, e: 0 };

    for (let tick = 1; tick <= 3; tick += 1) {
      forward = recoverOscillatingCustomers(forward, tick === 1 ? 0.01 : 1);
      reverse = recoverOscillatingCustomers(reverse, tick === 1 ? 0.01 : 1);
      const forwardPending = pendingById(forward);
      const reversePending = pendingById(reverse);

      expect(reversePending).toEqual(forwardPending);
      expect(forward.customers.map(customer => customer.id)).toEqual(forwardOrder);
      expect(reverse.customers.map(customer => customer.id)).toEqual(reverseOrder);

      for (const id of ['a', 'c', 'e']) {
        const cursor = forwardPending[id];
        const ordinal = pairCursorOrdinal(forward, cursor);
        const pairChecks = ordinal - previousOrdinals[id];
        expect(pairChecks).toBeGreaterThanOrEqual(0);
        expect(pairChecks).toBeLessThanOrEqual(RECOVERY_SEARCH_LIMITS.perSearchPairCandidateChecks);
        if (pairChecks > 0) seenAdvancement.add(id);
        previousOrdinals[id] = ordinal;
        expect(cursor.waitTicks).toBeLessThanOrEqual(2);
      }

      if (tick === 1) {
        expect(forwardPending.a.waitTicks).toBe(0);
        expect(forwardPending.c).toMatchObject({ firstIndex: 0, secondIndex: 0, waitTicks: 1 });
        expect(forwardPending.e).toMatchObject({ firstIndex: 0, secondIndex: 0, waitTicks: 1 });
      } else if (tick === 2) {
        expect(forwardPending.c.waitTicks).toBe(0);
        expect(forwardPending.e).toMatchObject({ firstIndex: 0, secondIndex: 0, waitTicks: 2 });
        expect(forwardPending.a.waitTicks).toBe(1);
      }
    }

    expect([...seenAdvancement].sort()).toEqual(['a', 'c', 'e']);
  });

  it('saturates the wait count of valid searches not served by the shared budget', () => {
    const first = recoverOscillatingCustomers(simultaneousPendingState(), 0.01);
    const saturated = {
      ...first,
      customers: first.customers.map(customer => ['c', 'e'].includes(customer.id)
        ? {
          ...customer,
          oscillationRecovery: {
            ...customer.oscillationRecovery,
            pendingSearch: {
              ...customer.oscillationRecovery.pendingSearch,
              waitTicks: Number.MAX_SAFE_INTEGER,
            },
          },
        }
        : customer),
    };

    const result = recoverOscillatingCustomers(saturated, 1);
    const pending = pendingById(result);

    expect(pending.c.waitTicks).toBe(0);
    expect(pending.e.waitTicks).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('retains fairness credit when residual budget rebuilds work without cursor progress', () => {
    const state = residualBudgetPendingState();

    const result = recoverOscillatingCustomers(state, 0.01);
    const pending = pendingById(result);

    expect(pending.a.firstIndex > 0 || pending.a.secondIndex > 0).toBe(true);
    expect(pending.c.firstIndex > 0 || pending.c.secondIndex > 0).toBe(true);
    expect(pending.e).toMatchObject({
      firstIndex: 0,
      secondIndex: 0,
      waitTicks: 1,
    });
  });

  it('relocates a furniture-blocked customer to the nearest reachable open cell and replans to the unchanged goal', () => {
    const customer = oscillatingCustomer({
      oscillationRecovery: seededMetadata,
      stuckWatchdog: { noProgressFor: 9 },
      localConflictTarget: { x: 4, y: 5 },
      marker: 'preserved',
    });
    const state = buildState(null, {
      customers: [customer],
      chairs: [{ id: 'blocker', x: 120, y: 100 }],
    });
    const before = snapshot(customer);
    const blocked = buildBlockedCells(state);

    const result = recoverOscillatingCustomers(state, 0.01);
    const recovered = result.customers[0];

    expect(snapshot({ marker: recovered.marker, goal: recovered.pathGoal })).toEqual({
      marker: 'preserved', goal: { x: 10, y: 5 },
    });
    expect(Math.hypot(recovered.x - before.x, recovered.y - before.y)).toBe(20);
    expect(blocked.has(`${worldToCell(recovered).x},${worldToCell(recovered).y}`)).toBe(false);
    expect(recovered.path.at(-1)).toEqual({ x: 10, y: 5 });
    expect(recovered).not.toHaveProperty('oscillationRecovery');
    expect(recovered).not.toHaveProperty('stuckWatchdog');
    expect(recovered).not.toHaveProperty('localConflictTarget');
  });

  it('prefers forward progress between equally near safe cells', () => {
    const customer = oscillatingCustomer({
      path: [{ x: 7, y: 5 }, { x: 10, y: 5 }],
      oscillationRecovery: seededMetadata,
    });
    const state = buildState(null, {
      customers: [customer],
      chairs: [{ id: 'blocker', x: 140, y: 100 }],
    });
    const before = snapshot(customer);
    const blocked = buildBlockedCells(state);

    const recovered = recoverOscillatingCustomers(state, 0.01).customers[0];

    expect(snapshot(worldToCell(recovered))).toEqual({ x: 6, y: 5 });
    expect(Math.hypot(recovered.x - before.x, recovered.y - before.y)).toBe(20);
    expect(blocked.has(`${worldToCell(recovered).x},${worldToCell(recovered).y}`)).toBe(false);
  });

  it('accepts a safe cell whose reachable route must detour around a long blockage', () => {
    const customer = oscillatingCustomer({ oscillationRecovery: seededMetadata });
    const state = buildState(null, {
      customers: [customer],
      chairs: [{ id: 'causal', x: 120, y: 100 }],
      tables: [
        { id: 'upper-wall', x: 160, y: 80 },
        { id: 'lower-wall', x: 160, y: 120 },
      ],
    });
    const before = snapshot(customer);
    const blocked = buildBlockedCells(state);

    const recovered = recoverOscillatingCustomers(state, 0.01).customers[0];
    const start = worldToCell(recovered);
    const directLength = Math.abs(start.x - 10) + Math.abs(start.y - 5);

    expect(snapshot({ start, goal: recovered.pathGoal })).toEqual({
      start: { x: 5, y: 4 }, goal: { x: 10, y: 5 },
    });
    expect(recovered.path.length).toBeGreaterThan(directLength);
    expect(Math.hypot(recovered.x - before.x, recovered.y - before.y)).toBe(20);
    expect(blocked.has(`${start.x},${start.y}`)).toBe(false);
  });

  it('uses a statically clear exact world goal when it is the only safe cell', () => {
    const checkoutGoal = {
      cell: { x: 6, y: 5 },
      world: { x: 139, y: 119 },
      useWorldGoal: true,
      key: 'checkout_moving:6,5:139,119',
    };
    const customer = oscillatingCustomer({
      state: 'checkout_moving',
      path: [{ x: 6, y: 5 }],
      pathGoal: undefined,
      checkoutPosition: checkoutGoal.world,
      oscillationRecovery: {
        ...seededMetadata,
        state: 'checkout_moving',
        goalKey: checkoutGoal.key,
        corridorCells: ['4,5', '5,5', '6,5'],
        bestGoalDistance: Math.hypot(19, 19),
      },
    });
    let state = buildState(null, { customers: [customer] });
    state = blockWorldExcept(state, [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    const before = snapshot(customer);
    const blocked = buildBlockedCells(state);

    const recovered = recoverOscillatingCustomers(state, 0.01).customers[0];

    expect(snapshot({ x: recovered.x, y: recovered.y })).toEqual(checkoutGoal.world);
    expect(worldToCell(recovered)).toEqual(checkoutGoal.cell);
    expect(recovered.path).toEqual([]);
    expect(recovered.pathGoal).toEqual(checkoutGoal.cell);
    expect(blocked.has(`${worldToCell(recovered).x},${worldToCell(recovered).y}`)).toBe(false);
    expect(snapshot(recovered)).not.toEqual(before);
  });

  it('keeps a guided recovery cell at least 16 pixels from exterior queue projections', () => {
    const queue = [{ partyId: 'p1', members: [{ id: 'queued', state: 'queued' }] }];
    const queueGoal = {
      cell: { x: 50, y: 19 },
      world: { x: 1000, y: 380 },
      useWorldGoal: false,
      key: 'guided:50,19:1000,380',
    };
    const customer = oscillatingCustomer({
      x: 960,
      y: 380,
      path: [{ x: 49, y: 19 }, { x: 50, y: 19 }],
      pathGoal: queueGoal.cell,
      oscillationRecovery: {
        ...seededMetadata,
        goalKey: queueGoal.key,
        previousCell: { x: 49, y: 19 },
        previousPosition: { x: 980, y: 380 },
        corridorCells: ['47,19', '48,19', '49,19'],
        edges: ['48,19>49,19', '49,19>48,19'],
        bestGoalDistance: 20,
      },
    });
    const state = buildState(null, {
      customers: [customer],
      queue,
      chairs: [{ id: 'causal', x: 940, y: 380 }],
    });
    const before = snapshot(customer);
    const blocked = buildBlockedCells(state);
    const projected = getQueueProjectedMembers(state, state.queue);

    const recovered = recoverOscillatingCustomers(state, 0.01).customers[0];

    expect(snapshot(worldToCell(recovered))).toEqual({ x: 48, y: 18 });
    expect(projected.every(queued => Math.hypot(
      recovered.x - queued.x,
      recovered.y - queued.y,
    ) >= 16)).toBe(true);
    expect(blocked.has(`${worldToCell(recovered).x},${worldToCell(recovered).y}`)).toBe(false);
    expect(snapshot(recovered)).not.toEqual(before);
  });

  it('commits a queue-safe leaver detour instead of a queue-crossing route or fallback', () => {
    const queue = [{ partyId: 'p1', members: [{ id: 'queued', state: 'queued' }] }];
    const leavingGoal = {
      cell: { x: 49, y: 18 },
      world: { x: 993, y: 360 },
      useWorldGoal: true,
      key: 'leaving:49,18:993,360',
    };
    const customer = oscillatingCustomer({
      state: 'leaving',
      exitPhase: 'to_door',
      exitDoorId: 'door1',
      x: 920,
      y: 420,
      path: [{ x: 47, y: 21 }, { x: 49, y: 18 }],
      pathGoal: leavingGoal.cell,
      oscillationRecovery: {
        ...seededMetadata,
        state: 'leaving',
        goalKey: leavingGoal.key,
        previousCell: { x: 47, y: 21 },
        previousPosition: { x: 940, y: 420 },
        corridorCells: ['46,21', '47,21'],
        edges: ['46,21>47,21', '47,21>46,21'],
        bestGoalDistance: Math.hypot(940 - 993, 420 - 360),
      },
    });
    let state = buildState(null, {
      customers: [customer],
      queue,
    });
    state = blockWorldExcept(state, [
      { x: 46, y: 21 },
      { x: 46, y: 20 },
      { x: 46, y: 19 },
      { x: 46, y: 18 },
      { x: 47, y: 18 },
      { x: 48, y: 18 },
      { x: 47, y: 20 },
      { x: 48, y: 20 },
      { x: 49, y: 20 },
      { x: 49, y: 19 },
      { x: 49, y: 18 },
    ]);
    const before = snapshot(customer);
    const blocked = buildBlockedCells(state);
    const projected = getQueueProjectedMembers(state, state.queue);

    const recovered = recoverOscillatingCustomers(state, 0.01).customers[0];
    const routePoints = [
      { x: recovered.x, y: recovered.y },
      ...recovered.path.map(cellToWorld),
      leavingGoal.world,
    ];

    expect(snapshot({
      x: recovered.x,
      y: recovered.y,
      pathGoal: recovered.pathGoal,
    })).toEqual({
      x: 920,
      y: 400,
      pathGoal: leavingGoal.cell,
    });
    for (let index = 1; index < routePoints.length; index += 1) {
      for (const queued of projected) {
        expect(minimumPointToSegmentDistance(
          queued,
          routePoints[index - 1],
          routePoints[index],
        )).toBeGreaterThanOrEqual(16 - 1e-6);
      }
    }
    expect(recovered).not.toHaveProperty('oscillationRecovery');
    expect(blocked.has(`${worldToCell(recovered).x},${worldToCell(recovered).y}`)).toBe(false);
    expect(snapshot(recovered)).not.toEqual(before);
  });

  it('atomically relocates two movable customers to distinct positions with non-conflicting route prefixes', () => {
    const first = oscillatingCustomer({ oscillationRecovery: seededMetadata });
    const second = oscillatingCustomer({
      id: 'b', x: 120,
      path: [{ x: 5, y: 5 }, { x: 4, y: 5 }],
      pathGoal: { x: 4, y: 5 },
      oscillationRecovery: undefined,
    });
    const state = buildState(null, { customers: [first, second] });
    const before = snapshot(state.customers);
    const blocked = buildBlockedCells(state);

    const result = recoverOscillatingCustomers(state, 0.01);
    const byId = new Map(result.customers.map(customer => [customer.id, customer]));
    const recoveredFirst = byId.get('a');
    const recoveredSecond = byId.get('b');
    const firstPrefix = recoveredFirst.path.slice(0, 2).map(cell => `${cell.x},${cell.y}`);
    const secondPrefix = recoveredSecond.path.slice(0, 2).map(cell => `${cell.x},${cell.y}`);

    expect(snapshot({
      a: worldToCell(recoveredFirst),
      b: worldToCell(recoveredSecond),
    })).toEqual({ a: { x: 6, y: 5 }, b: { x: 5, y: 5 } });
    expect(Math.hypot(
      recoveredFirst.x - recoveredSecond.x,
      recoveredFirst.y - recoveredSecond.y,
    )).toBeGreaterThanOrEqual(16);
    expect(firstPrefix.some(key => secondPrefix.includes(key))).toBe(false);
    expect(blocked.has(`${worldToCell(recoveredFirst).x},${worldToCell(recoveredFirst).y}`)).toBe(false);
    expect(blocked.has(`${worldToCell(recoveredSecond).x},${worldToCell(recoveredSecond).y}`)).toBe(false);
    expect(result.customers).not.toEqual(before);
  });

  it('rolls back both relocations, paths, and movement metadata when the second route cannot be reserved', () => {
    const first = oscillatingCustomer({
      oscillationRecovery: seededMetadata,
      stalledFor: 4,
      localConflictTarget: { x: 4, y: 5 },
    });
    const second = oscillatingCustomer({
      id: 'b', x: 120,
      path: [{ x: 7, y: 5 }, { x: 10, y: 5 }],
      pathGoal: { x: 10, y: 5 },
      oscillationRecovery: undefined,
      stalledFor: 3,
      usingStaticFallback: true,
    });
    let state = buildState(null, { customers: [first, second] });
    state = blockWorldExcept(state, Array.from({ length: 6 }, (_, index) => ({ x: 5 + index, y: 5 })));
    const before = snapshot(state.customers);
    const blocked = buildBlockedCells(state);

    const result = recoverOscillatingCustomers(state, 0.01);
    const after = result.customers;

    expect(snapshot(after.map(customer => ({
      id: customer.id,
      x: customer.x,
      y: customer.y,
      path: customer.path,
      pathGoal: customer.pathGoal,
      stalledFor: customer.stalledFor,
      localConflictTarget: customer.localConflictTarget,
      usingStaticFallback: customer.usingStaticFallback,
    })))).toEqual(before.map(customer => ({
      id: customer.id,
      x: customer.x,
      y: customer.y,
      path: customer.path,
      pathGoal: customer.pathGoal,
      stalledFor: customer.stalledFor,
      localConflictTarget: customer.localConflictTarget,
      usingStaticFallback: customer.usingStaticFallback,
    })));
    expect(after[0].oscillationRecovery.oscillatingFor).toBeCloseTo(5.01);
    expect(after[1].oscillationRecovery.oscillatingFor).toBe(0);
    expect(blocked.has(`${worldToCell(after[0]).x},${worldToCell(after[0]).y}`)).toBe(false);
    expect(blocked.has(`${worldToCell(after[1]).x},${worldToCell(after[1]).y}`)).toBe(false);
  });

  it('produces the same per-ID paired recovery when input customer order is reversed', () => {
    const first = oscillatingCustomer({ oscillationRecovery: seededMetadata });
    const second = oscillatingCustomer({
      id: 'b', x: 120,
      path: [{ x: 5, y: 5 }, { x: 4, y: 5 }],
      pathGoal: { x: 4, y: 5 },
      oscillationRecovery: undefined,
    });
    const forwardState = buildState(null, { customers: [first, second] });
    const reverseState = buildState(null, { customers: [snapshot(second), snapshot(first)] });
    const before = snapshot(forwardState.customers);
    const blocked = buildBlockedCells(forwardState);

    const forward = recoverOscillatingCustomers(forwardState, 0.01);
    const reverse = recoverOscillatingCustomers(reverseState, 0.01);
    const perId = state => Object.fromEntries(state.customers
      .map(customer => [customer.id, snapshot(customer)]));

    expect(perId(reverse)).toEqual(perId(forward));
    expect(perId(forward)).not.toEqual(Object.fromEntries(before.map(customer => [customer.id, customer])));
    for (const customer of forward.customers) {
      const cell = worldToCell(customer);
      expect(blocked.has(`${cell.x},${cell.y}`)).toBe(false);
    }
  });

  it('keeps customer state unchanged except for continued observation when no safe cell exists', () => {
    const customer = oscillatingCustomer({
      oscillationRecovery: seededMetadata,
      stalledFor: 4,
      localConflictTarget: { x: 4, y: 5 },
    });
    let state = buildState(null, { customers: [customer] });
    state = blockWorldExcept(state, [{ x: 5, y: 5 }]);
    const before = snapshot(customer);
    const blocked = buildBlockedCells(state);

    const recovered = recoverOscillatingCustomers(state, 0.01).customers[0];
    const { oscillationRecovery: _beforeObservation, ...beforeWithoutObservation } = before;
    const { oscillationRecovery: afterObservation, ...afterWithoutObservation } = snapshot(recovered);

    expect(afterWithoutObservation).toEqual(beforeWithoutObservation);
    expect(afterObservation.oscillatingFor).toBeCloseTo(5.01);
    expect(worldToCell(recovered)).toEqual({ x: 5, y: 5 });
    expect(blocked.has('5,5')).toBe(false);
  });

  it('retries after no blocker is visible while qualifying oscillation continues', () => {
    const initial = buildState();
    const first = recoverOscillatingCustomers(initial, 0.01);
    expect(first.customers[0].oscillationRecovery.oscillatingFor).toBeCloseTo(5.01);

    const continuing = {
      ...first,
      customers: [{ ...first.customers[0], x: 120 }],
      chairs: [{ id: 'now-visible', x: 100, y: 100 }],
    };
    const second = recoverOscillatingCustomers(continuing, 0.01);

    expect(second.customers[0]).not.toHaveProperty('oscillationRecovery');
    expect({ x: second.customers[0].x, y: second.customers[0].y })
      .not.toEqual({ x: 120, y: 100 });
  });

  it('retries after no safe cell exists while qualifying oscillation continues', () => {
    const enclosed = blockWorldExcept(buildState(), [{ x: 5, y: 5 }]);
    const first = recoverOscillatingCustomers(enclosed, 0.01);
    expect(first.customers[0].oscillationRecovery.oscillatingFor).toBeCloseTo(5.01);

    const continuing = {
      ...first,
      customers: [{ ...first.customers[0], x: 120 }],
      chairs: [{ id: 'causal', x: 100, y: 100 }],
    };
    const second = recoverOscillatingCustomers(continuing, 0.01);

    expect(second.customers[0]).not.toHaveProperty('oscillationRecovery');
    expect({ x: second.customers[0].x, y: second.customers[0].y })
      .not.toEqual({ x: 120, y: 100 });
  });

  it('rejects paired destinations with distinct world points in the same grid cell', () => {
    const firstGoal = {
      cell: { x: 6, y: 5 }, world: { x: 120, y: 100 }, useWorldGoal: false,
      key: 'guided:6,5:120,100',
    };
    const first = oscillatingCustomer({
      path: [{ x: 7, y: 5 }, { x: 6, y: 5 }],
      pathGoal: { x: 6, y: 5 },
      oscillationRecovery: { ...seededMetadata, goalKey: firstGoal.key, bestGoalDistance: 20 },
    });
    const second = oscillatingCustomer({
      id: 'b', state: 'checkout_moving', x: 140, y: 100,
      path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 },
      checkoutPosition: { x: 139, y: 119 },
      oscillationRecovery: undefined,
    });
    let state = buildState(null, { customers: [first, second] });
    state = blockWorldExcept(state, [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }]);
    const before = snapshot(state.customers);

    const result = recoverOscillatingCustomers(state, 0.01);

    expect(result.customers.map(customer => ({
      id: customer.id, x: customer.x, y: customer.y, path: customer.path,
    }))).toEqual(before.map(customer => ({
      id: customer.id, x: customer.x, y: customer.y, path: customer.path,
    })));
  });

  it('does not relocate a customer twice after recovering it as an earlier blocker', () => {
    const first = oscillatingCustomer({ oscillationRecovery: seededMetadata });
    const blocker = oscillatingCustomer({
      id: 'b', x: 120,
      path: [{ x: 5, y: 5 }, { x: 4, y: 5 }],
      pathGoal: { x: 4, y: 5 },
      oscillationRecovery: undefined,
    });
    const laterGoal = {
      cell: { x: 3, y: 5 }, world: { x: 60, y: 100 }, useWorldGoal: false,
      key: 'guided:3,5:60,100',
    };
    const later = oscillatingCustomer({
      id: 'c', x: 80,
      path: [{ x: 5, y: 5 }, { x: 3, y: 5 }],
      pathGoal: { x: 3, y: 5 },
      oscillationRecovery: {
        ...seededMetadata,
        goalKey: laterGoal.key,
        previousCell: { x: 5, y: 5 },
        previousPosition: { x: 100, y: 100 },
        corridorCells: ['4,5', '5,5'],
        edges: ['4,5>5,5', '5,5>4,5'],
        bestGoalDistance: 20,
      },
    });
    const pairOnly = recoverOscillatingCustomers(
      buildState(null, { customers: [snapshot(first), snapshot(blocker)] }),
      0.01,
    );
    const expectedBlocker = pairOnly.customers.find(customer => customer.id === 'b');

    const result = recoverOscillatingCustomers(
      buildState(null, { customers: [first, blocker, later] }),
      0.01,
    );
    const recoveredBlocker = result.customers.find(customer => customer.id === 'b');

    expect(snapshot(recoveredBlocker)).toEqual(snapshot(expectedBlocker));
  });
});

describe('customer oscillation metadata', () => {
  it('clears both oscillation and legacy watchdog metadata without mutating the customer', () => {
    const customer = {
      id: 'c1',
      state: 'guided',
      oscillationRecovery: { state: 'guided' },
      stuckWatchdog: { noProgressFor: 3 },
      path: [{ x: 10, y: 5 }],
    };

    const cleared = clearCustomerOscillationMetadata(customer);

    expect(cleared).toEqual({ id: 'c1', state: 'guided', path: [{ x: 10, y: 5 }] });
    expect(customer).toHaveProperty('oscillationRecovery');
    expect(customer).toHaveProperty('stuckWatchdog');
  });

  it('returns the same customer when no recovery metadata is present', () => {
    const customer = { id: 'c1', state: 'waiting' };

    expect(clearCustomerOscillationMetadata(customer)).toBe(customer);
  });
});

describe('getCustomerRecoveryGoal', () => {
  const state = { restaurant: { expansionLevel: 1 }, doors: [{ id: 'door1', y: 340 }] };

  it('uses a guided path goal before the final path cell', () => {
    expect(getCustomerRecoveryGoal(state, {
      state: 'guided', x: 100, y: 100,
      pathGoal: { x: 10, y: 5 }, path: [{ x: 8, y: 5 }],
    })).toEqual(goal);
  });

  it('falls back to a finite final guided path cell', () => {
    expect(getCustomerRecoveryGoal(state, {
      state: 'guided', x: 100, y: 100,
      pathGoal: { x: Infinity, y: 5 }, path: [{ x: 8, y: 5 }],
    })).toEqual({
      cell: { x: 8, y: 5 },
      world: { x: 160, y: 100 },
      useWorldGoal: false,
      key: 'guided:8,5:160,100',
    });
  });

  it('uses the exact checkout position as a world goal', () => {
    expect(getCustomerRecoveryGoal(state, {
      state: 'checkout_moving', x: 100, y: 100,
      path: [{ x: 42, y: 9 }],
      checkoutPosition: { x: 840, y: 180 },
    })).toEqual({
      cell: { x: 42, y: 9 },
      world: { x: 840, y: 180 },
      useWorldGoal: true,
      key: 'checkout_moving:42,9:840,180',
    });
  });

  it('uses the assigned door outside position as a leaving world goal', () => {
    expect(getCustomerRecoveryGoal(state, {
      state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1', x: 900, y: 360,
      path: [{ x: 49, y: 18 }],
    })).toEqual({
      cell: { x: 49, y: 18 },
      world: { x: 993, y: 360 },
      useWorldGoal: true,
      key: 'leaving:49,18:993,360',
    });
  });

  it.each([
    ['an unmonitored lifecycle state', { state: 'waiting', path: [{ x: 10, y: 5 }] }],
    ['a fading customer', { state: 'guided', exitPhase: 'fading', path: [{ x: 10, y: 5 }] }],
    ['non-finite coordinates', { state: 'guided', x: Infinity, y: 100, path: [{ x: 10, y: 5 }] }],
    ['a malformed guided path', { state: 'guided', path: { x: 10, y: 5 } }],
    ['a missing leaving door', { state: 'leaving', exitPhase: 'to_door', exitDoorId: 'missing' }],
    ['a malformed checkout position', { state: 'checkout_moving', checkoutPosition: { x: NaN, y: 180 } }],
    ['a pathless guided customer', { state: 'guided', x: 100, y: 100, path: [], pathGoal: { x: 10, y: 5 } }],
    ['a pathless non-fading leaver', { state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1', x: 900, y: 360, path: [] }],
    ['a pathless checkout customer away from arrival', { state: 'checkout_moving', x: 100, y: 100, path: [], checkoutPosition: { x: 840, y: 180 } }],
  ])('returns null for %s', (_label, customer) => {
    expect(() => getCustomerRecoveryGoal(state, customer)).not.toThrow();
    expect(getCustomerRecoveryGoal(state, customer)).toBeNull();
  });
});

describe('observeCustomerOscillation', () => {
  it('triggers only after more than five movement-seconds of repeated edge reversal', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100, path: [{ x: 10, y: 5 }] };
    customer = observeCustomerOscillation(customer, goal, 0).customer;
    for (const x of [120, 100, 120, 100, 120]) {
      const result = observe(customer, x, 1);
      customer = result.customer;
      expect(result.shouldRecover).toBe(false);
    }
    const triggered = observe(customer, 100, 1.01);
    expect(triggered.shouldRecover).toBe(true);
    expect(triggered.customer.oscillationRecovery.oscillatingFor).toBeGreaterThan(5);
  });

  it.each([
    ['waiting in one cell', [100, 100, 100, 100, 100, 100]],
    ['forward travel', [120, 140, 160, 180, 200, 220]],
    ['one reversal followed by a new corridor', [120, 100, 120, 140, 160, 180]],
  ])('does not classify %s as oscillation', (_label, positions) => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100, path: [{ x: 20, y: 5 }] };
    for (const x of positions) {
      const result = observe(customer, x, 1);
      customer = result.customer;
      expect(result.shouldRecover).toBe(false);
    }
  });

  it('does not add same-cell samples to oscillation time before a reversal is confirmed', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observe(customer, 100, 0).customer;
    customer = observe(customer, 120, 1).customer;
    const waiting = observe(customer, 125, 2);

    expect(waiting.shouldRecover).toBe(false);
    expect(waiting.customer.oscillationRecovery.oscillatingFor).toBe(0);
    expect(waiting.customer.oscillationRecovery.pendingMovementFor).toBe(3);

    const reversed = observe(waiting.customer, 100, 1);
    expect(reversed.shouldRecover).toBe(false);
    expect(reversed.customer.oscillationRecovery.oscillatingFor).toBe(4);
    expect(reversed.customer.oscillationRecovery.pendingMovementFor).toBe(0);
  });

  it('does not retroactively count stationary time when a later edge reverses', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observe(customer, 100, 0, farGoal).customer;
    customer = observe(customer, 120, 1, farGoal).customer;
    customer = observe(customer, 120, 10, farGoal).customer;

    const reversed = observe(customer, 100, 0.01, farGoal);

    expect(reversed.shouldRecover).toBe(false);
    expect(reversed.customer.oscillationRecovery.oscillatingFor).toBeCloseTo(1.01);
  });

  it('does not carry unrelated forward-edge time into a later reversal', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observe(customer, 100, 0, farGoal).customer;
    customer = observe(customer, 120, 5, farGoal).customer;
    customer = observe(customer, 140, 0.1, farGoal).customer;

    const reversed = observe(customer, 120, 0.1, farGoal);

    expect(reversed.shouldRecover).toBe(false);
    expect(reversed.customer.oscillationRecovery.oscillatingFor).toBeLessThan(1);
  });

  it('retries recovery on later qualifying reversals after crossing five seconds', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observeCustomerOscillation(customer, goal, 0).customer;
    for (const x of [120, 100, 120, 100, 120]) {
      customer = observe(customer, x, 1).customer;
    }

    const triggered = observe(customer, 100, 1.01);
    const repeated = observe(triggered.customer, 100, 1);
    const continued = observe(repeated.customer, 120, 1);

    expect(triggered.shouldRecover).toBe(true);
    expect(repeated.shouldRecover).toBe(false);
    expect(continued.shouldRecover).toBe(true);
  });

  it.each([
    ['guided', { state: 'guided' }],
    ['non-fading leaving', { state: 'leaving', exitPhase: 'to_door' }],
  ])('resets %s observation when active route traversal stops', (_label, lifecycle) => {
    const active = {
      id: 'c1', ...lifecycle, x: 100, y: 100,
      path: [{ x: 10, y: 5 }],
      oscillationRecovery: {
        ...seededMetadata,
        state: lifecycle.state,
        goalKey: goal.key,
      },
    };

    const stopped = observeCustomerOscillation({ ...active, path: [] }, goal, 1);
    const resumed = observeCustomerOscillation(
      { ...stopped.customer, x: 120, path: [{ x: 10, y: 5 }] },
      goal,
      1,
    );

    expect(stopped.shouldRecover).toBe(false);
    expect(stopped.customer).not.toHaveProperty('oscillationRecovery');
    expect(resumed.shouldRecover).toBe(false);
    expect(resumed.customer.oscillationRecovery.oscillatingFor).toBe(0);
  });

  it('preserves observation for an arrived pathless checkout customer', () => {
    const checkoutGoal = {
      cell: { x: 6, y: 5 }, world: { x: 121, y: 101 }, useWorldGoal: true,
      key: 'checkout_moving:6,5:121,101',
    };
    const customer = {
      id: 'checkout', state: 'checkout_moving', x: 120, y: 100, path: [],
      checkoutPosition: checkoutGoal.world,
      oscillationRecovery: {
        ...seededMetadata,
        state: 'checkout_moving',
        goalKey: checkoutGoal.key,
        bestGoalDistance: Math.sqrt(2),
      },
    };

    const observed = observeCustomerOscillation(customer, checkoutGoal, 1);

    expect(observed.customer).toHaveProperty('oscillationRecovery');
    expect(observed.customer.oscillationRecovery.oscillatingFor).toBe(5);
  });

  it('resets a candidate when progress toward its goal is at least 0.1', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observe(customer, 100, 0).customer;
    customer = observe(customer, 120, 1).customer;
    customer = observe(customer, 100, 1).customer;
    customer = observe(customer, 120, 1).customer;

    const progressed = observe(customer, 140, 1);

    expect(progressed.shouldRecover).toBe(false);
    expect(progressed.customer.oscillationRecovery).toMatchObject({
      previousCell: { x: 7, y: 5 },
      corridorCells: ['7,5'],
      edges: [],
      oscillatingFor: 0,
      pendingMovementFor: 0,
    });
  });

  it('resets when a candidate leaves its three-cell corridor', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observe(customer, 100, 0, farGoal).customer;
    for (const x of [120, 100, 120, 100, 120, 140, 160]) {
      customer = observe(customer, x, 1, farGoal).customer;
    }

    expect(customer.oscillationRecovery).toMatchObject({
      previousCell: { x: 8, y: 5 },
      corridorCells: ['8,5'],
      edges: [],
      oscillatingFor: 0,
      pendingMovementFor: 0,
    });
  });

  it('does not treat a non-adjacent jump back into the corridor as a directed edge', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observe(customer, 100, 0, farGoal).customer;
    customer = observe(customer, 120, 1, farGoal).customer;
    customer = observe(customer, 140, 1, farGoal).customer;

    const jumped = observe(customer, 100, 1, farGoal);

    expect(jumped.shouldRecover).toBe(false);
    expect(jumped.customer.oscillationRecovery).toMatchObject({
      previousCell: { x: 5, y: 5 },
      corridorCells: ['5,5'],
      edges: [],
      oscillatingFor: 0,
      pendingMovementFor: 0,
    });
  });

  it('starts fresh after a state or goal change', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observe(customer, 100, 0).customer;
    customer = observe(customer, 120, 1).customer;
    customer = observe(customer, 100, 1).customer;

    const stateChanged = observe({ ...customer, state: 'checkout_moving' }, 120, 1);
    expect(stateChanged.customer.oscillationRecovery).toMatchObject({
      state: 'checkout_moving', goalKey: goal.key, edges: [], oscillatingFor: 0,
    });

    const goalChanged = observe(stateChanged.customer, 100, 1, { ...goal, key: 'guided:11,5:220,100' });
    expect(goalChanged.customer.oscillationRecovery).toMatchObject({
      state: 'checkout_moving', goalKey: 'guided:11,5:220,100', edges: [], oscillatingFor: 0,
    });
  });

  it.each([
    ['missing metadata', undefined],
    ['a non-object metadata value', null],
    ['a malformed previous cell', { previousCell: { x: '5', y: 5 } }],
    ['malformed edges', { edges: '5,5>6,5' }],
    ['malformed pending duration', { pendingMovementFor: -1 }],
    ['malformed elapsed duration', { oscillatingFor: 'five' }],
    ['malformed best distance', { bestGoalDistance: Infinity }],
  ])('safely starts fresh with %s', (_label, metadata) => {
    const customer = {
      id: 'c1', state: 'guided', x: 100, y: 100,
      ...(metadata === undefined ? {} : { oscillationRecovery: metadata }),
    };

    const result = observe(customer, 100, 1);

    expect(result.shouldRecover).toBe(false);
    expect(result.customer.oscillationRecovery).toMatchObject({
      state: 'guided', goalKey: goal.key, previousCell: { x: 5, y: 5 },
      corridorCells: ['5,5'], edges: [], pendingMovementFor: 0, oscillatingFor: 0,
    });
  });

  it('rejects type-valid metadata whose elapsed oscillation has no reversal history', () => {
    const customer = {
      id: 'c1', state: 'guided', x: 100, y: 100,
      oscillationRecovery: {
        state: 'guided',
        goalKey: goal.key,
        previousCell: { x: 5, y: 5 },
        previousPosition: { x: 100, y: 100 },
        corridorCells: ['5,5'],
        edges: [],
        pendingMovementFor: 0,
        oscillatingFor: 6,
        bestGoalDistance: 100,
      },
    };

    const result = observe(customer, 100, 1);

    expect(result.shouldRecover).toBe(false);
    expect(result.customer.oscillationRecovery).toMatchObject({
      edges: [], oscillatingFor: 0, pendingMovementFor: 0,
    });
  });

  it('resets at exactly 0.1 world-unit goal progress', () => {
    let customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    customer = observe(customer, 100, 0).customer;
    customer = observe(customer, 120, 1).customer;
    customer = observe(customer, 100, 1).customer;

    const progressed = observe(customer, 120.1, 1);

    expect(progressed.shouldRecover).toBe(false);
    expect(progressed.customer.oscillationRecovery).toMatchObject({
      previousCell: { x: 6, y: 5 },
      corridorCells: ['6,5'],
      edges: [],
      oscillatingFor: 0,
      pendingMovementFor: 0,
    });
  });

  it('does not observe a fading leaving customer even with a valid direct goal', () => {
    const leavingGoal = {
      ...goal,
      key: 'leaving:10,5:200,100',
    };
    let customer = {
      id: 'c1', state: 'leaving', exitPhase: 'fading', x: 100, y: 100,
    };
    customer = observeCustomerOscillation(customer, leavingGoal, 0).customer;
    for (const x of [120, 100, 120, 100, 120, 100]) {
      const result = observeCustomerOscillation(
        { ...customer, x, y: 100, exitPhase: 'fading' }, leavingGoal, 1,
      );
      customer = result.customer;
      expect(result.shouldRecover).toBe(false);
    }
    expect(customer.oscillationRecovery).toBeUndefined();
  });

  it('does not trigger or throw for non-finite coordinates and non-positive durations', () => {
    const customer = { id: 'c1', state: 'guided', x: 100, y: 100 };
    const initial = observe(customer, 100, 0).customer;
    const zero = observe(initial, 120, 0);
    const negative = observe(zero.customer, 100, -1);
    const invalidPosition = observeCustomerOscillation(
      { ...negative.customer, x: NaN, y: 100 }, goal, 10,
    );

    expect(zero.shouldRecover).toBe(false);
    expect(negative.shouldRecover).toBe(false);
    expect(Number.isFinite(negative.customer.oscillationRecovery.pendingMovementFor)).toBe(true);
    expect(invalidPosition.shouldRecover).toBe(false);
    expect(invalidPosition.customer.oscillationRecovery).toBeUndefined();
  });

  it('accepts only valid goals and never triggers with a missing goal', () => {
    const customer = { id: 'c1', state: 'guided', x: 100, y: 100 };

    const result = observeCustomerOscillation(customer, null, 10);

    expect(result).toEqual({ customer, shouldRecover: false });
  });
});
