import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  getStaffMovementEntries,
  prepareStaffForMovement,
  resolveStaffAfterMovement,
  updateStaff,
} from './staff';
import * as staffDomain from './staff';
import { updateCustomers } from './customers';
import { buildBlockedCells, cellToWorld, findAdjacentOpenCells, findPath, isInsideWorld, worldToCell } from './pathfinding';
import { advanceCharacterMovementBatch } from './movement';
import { minimumSweptDistance } from './movement/trajectory';
import { updateAutomaticDishwashers } from './dishwashing';
import { getDoorPosition, getDoors, getRestaurantWorld } from './world';

const baseState = {
  staff: [],
  customers: [],
  queue: [],
  tables: [],
  chairs: [],
  serviceItems: [],
  unlockedDrinkIds: ['water'],
  kitchenStations: [],
  dishes: [],
  restaurant: { gameTime: 12 * 3600, expansionLevel: 1 },
  serviceTables: [],
  doors: [{ id: 'door1', y: 340, role: 'exit' }],
};

it('prepares staff paths without changing positions', () => {
  const stateWithWalkingWaiter = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', morale: 80, x: 100, y: 100, task: null,
    }],
  };
  const prepared = prepareStaffForMovement(stateWithWalkingWaiter, 1);
  expect(prepared.staff[0]).toMatchObject({ x: 100, y: 100 });
});

it('emits idle roaming at speed 20', () => {
  const entries = getStaffMovementEntries({
    ...baseState,
    staff: [{
      id: 'idle', role: 'waiter', x: 100, y: 100,
      activityPhase: 'idle_roaming', navigationGoal: cellToWorld({ x: 6, y: 5 }), task: null,
    }],
  });
  expect(entries.find(entry => entry.character.id === 'idle')).toMatchObject({ speed: 20 });
});

it('replaces an idle roaming route when real work is assigned', () => {
  const result = updateStaff({
    ...baseState,
    staff: [{
      id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120,
      activityPhase: 'idle_roaming', task: null,
    }],
    customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null, drinkId: null }],
    tables: [{ id: 't1', status: 'occupied', x: 200, y: 220 }],
  }, 0);
  expect(result.staff[0].task).toMatchObject({ type: 'take_order', customerId: 'c1' });
  expect(result.staff[0].activityPhase).toBe('task_assigned');
});

it.each([
  ['cook', { id: 'cook', role: 'cook', morale: 80, x: 400, y: 300 }],
  ['carrier', { id: 'carrier', role: 'waiter', morale: 80, x: 400, y: 300, carryingServiceItemId: 'item' }],
])('keeps a taskless %s out of idle roaming', (_name, worker) => {
  const prepared = prepareStaffForMovement({ ...baseState, staff: [worker] }, 0);
  expect(prepared.staff[0].activityPhase).not.toBe('idle_roaming');
});


















it('never exposes route or recovery metadata in staff movement descriptors', () => {
  const entries = getStaffMovementEntries({
    ...baseState,
    staff: [
      { id: 'one', role: 'waiter', x: 100, y: 100, task: null },
      { id: 'two', role: 'waiter', x: 100, y: 120, task: null },
      { id: 'three', role: 'waiter', x: 100, y: 140, task: null },
    ],
  });

  expect(entries.map(entry => entry.character.id).sort()).toEqual(['one', 'three', 'two']);
  const legacyKeys = [
    'path', 'pathGoal', 'stalledFor', 'usingStaticFallback', 'minimumSpacing',
    'localConflictTarget', 'headOnRecovery', 'headOnDetourEligible',
    'recoveredHeadOnDetourTarget',
  ];
  for (const entry of entries) {
    for (const key of legacyKeys) {
      expect(entry).not.toHaveProperty(key);
      expect(entry.character).not.toHaveProperty(key);
    }
  }
});





it('preserves active customer goals through standalone staff processing', () => {
  const state = {
    ...baseState,
    customers: [
      {
        id: 'checkout', state: 'checkout_moving', x: 300, y: 300,
        navigationGoal: { x: 400, y: 300 }, cashierStationId: 'cashier1',
      },
      {
        id: 'leaving', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 500, y: 300, navigationGoal: { x: 900, y: 360 },
      },
    ],
  };

  const result = updateStaff(state, 0);

  expect(result.customers.find(customer => customer.id === 'checkout').navigationGoal)
    .toEqual({ x: 400, y: 300 });
  expect(result.customers.find(customer => customer.id === 'leaving').navigationGoal)
    .toEqual({ x: 900, y: 360 });
});

it('reserves projected queue blockers without committing them as customers', () => {
  const state = {
    ...baseState,
    staff: [{ id: 'cook', role: 'cook', morale: 80, x: 300, y: 300, task: null }],
    queue: [{ partyId: 'p1', members: [{ id: 'queued', partyId: 'p1', state: 'queued' }] }],
    queueSlots: [{ memberId: 'queued', partyId: 'p1', x: 973, y: 390, slot: 0 }],
  };

  const result = updateStaff(state, { gameDt: 0, movementDt: 0 });

  expect(result.customers).toEqual([]);
  expect(result.queue).toEqual(state.queue);
  expect(result.movementCoordinator.requests.get('queued')).toMatchObject({ speed: 0, start: { x: 973, y: 390 } });
  expect(result.movementCoordinator.plans.get('queued').every(action => action.from.x === action.to.x && action.from.y === action.to.y)).toBe(true);
});

it('keeps every actor in the batch while granting deterministic corridor priority', () => {
  const state = congestionState([
    {
      id: 'a-worker', role: 'waiter', x: 100, y: 100,
      activityPhase: 'idle_roaming', navigationGoal: cellToWorld({ x: 16, y: 5 }), task: null,
    },
    {
      id: 'b-worker', role: 'waiter', x: 260, y: 100,
      activityPhase: 'idle_roaming', navigationGoal: cellToWorld({ x: 3, y: 5 }), task: null,
    },
  ]);
  const { current: result } = runCongestionScenario(
    state,
    current => current.staff.find(worker => worker.id === 'a-worker').x > 100,
    { cooperative: true },
  );
  expect(result.staff.find(worker => worker.id === 'a-worker').x).toBeGreaterThan(100);
  expect(result.staff.find(worker => worker.id === 'b-worker').x).toBeLessThanOrEqual(260);
});

it('reduces morale by 0.01 per game minute without using movement time', () => {
  const state = {
    ...baseState,
    staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 100, y: 100, task: null }],
  };

  const result = updateStaff(state, { gameDt: 60, movementDt: 0 });

  expect(result.staff[0].morale).toBeCloseTo(79.99);
  expect(result.staff[0]).toMatchObject({ x: 100, y: 100 });
});

function corridorWalls(endX) {
  return [20, 180].flatMap(y => Array.from(
    { length: (endX - 60) / 20 + 1 },
    (_, index) => ({ id: `corridor-${y}-${index}`, x: 60 + index * 20, y }),
  ));
}

function runCongestionScenario(state, isComplete, { maxTicks = 100 } = {}) {
  const blocked = buildBlockedCells(state);
  const histories = new Map([...state.staff, ...state.customers].map(actor => [actor.id, []]));
  let current = state;

  const recordActors = () => {
    for (const actor of [...current.staff, ...current.customers]) {
      const point = { x: actor.x, y: actor.y };
      const cell = worldToCell(point);
      histories.get(actor.id)?.push(point);
      expect(blocked.has(`${cell.x},${cell.y}`)).toBe(false);
    }
  };

  recordActors();
  for (let tick = 0; tick < maxTicks && !isComplete(current); tick += 1) {
    const prepared = prepareStaffForMovement(current, 0);
    const movement = advanceCharacterMovementBatch(
      prepared,
      getStaffMovementEntries(prepared),
      0.1,
    );
    current = {
      ...prepared,
      staff: prepared.staff.map(worker => movement.moved.get(worker.id) || worker),
      customers: prepared.customers.map(customer => movement.moved.get(customer.id) || customer),
      movementCoordinator: movement.coordinator,
    };
    recordActors();
  }
  expect(isComplete(current), JSON.stringify(current.staff.map(worker => ({
    id: worker.id,
    x: worker.x,
  })))).toBe(true);
  for (const actor of current.staff) {
    const history = histories.get(actor.id);
    const roleSpeed = actor.activityPhase === 'idle_roaming'
      ? 20
      : actor.role === 'cook' ? 55 : 75;
    expect(history.length).toBeGreaterThan(1);
    for (let index = 1; index < history.length; index += 1) {
      expect(Math.hypot(history[index].x - history[index - 1].x, history[index].y - history[index - 1].y))
        .toBeLessThanOrEqual(roleSpeed * 0.1 + 1e-6);
    }
    for (const field of ['path', 'pathGoal', 'stalledFor', 'minimumSpacing', 'usingStaticFallback']) {
      expect(actor).not.toHaveProperty(field);
    }
  }
  return { current, histories };
}


function congestionState(staff, customers = [], corridorEndX = 340) {
  return { ...baseState, staff, customers, chairs: corridorWalls(corridorEndX), tables: [], serviceItems: [] };
}

function queuedAdmissionState() {
  return {
    ...baseState,
    staff: [
      { id: 'w1', role: 'waiter', morale: 80, x: 860, y: 300, task: null },
      { id: 'w2', role: 'waiter', morale: 80, x: 860, y: 420, task: null },
    ],
    queue: [
      { partyId: 'p1', members: [
        { id: 'q1', partyId: 'p1', partySize: 1, state: 'queued', patience: 100, happiness: 80 },
      ] },
      { partyId: 'p2', members: [
        { id: 'q2', partyId: 'p2', partySize: 1, state: 'queued', patience: 100, happiness: 80 },
      ] },
    ],
    tables: [
      { id: 't1', seats: 1, status: 'empty', x: 200, y: 220 },
      { id: 't2', seats: 1, status: 'empty', x: 400, y: 420 },
    ],
    chairs: [
      { id: 'ch1', tableId: 't1', x: 210, y: 180 },
      { id: 'ch2', tableId: 't2', x: 410, y: 380 },
    ],
  };
}

describe('updateStaff', () => {
  it.each([
    ['take_order', 15],
    ['take_payment', 15],
    ['clean_table', 15],
    ['clean_floor', 15],
    ['wash_item', 15],
  ])('records morale-scaled accumulated work for %s', (type, expectedWork) => {
    const taskByType = {
      take_order: { type, customerId: 'c1', startedAt: 0, accumulatedWork: 0, lastProgressAt: 0 },
      take_payment: { type, customerId: 'c1', stationId: 'cashier1', startedAt: 0, accumulatedWork: 0, lastProgressAt: 0 },
      clean_table: { type, tableId: 't1', cleaningStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 },
      clean_floor: { type, dirtId: 'd1', cleaningStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 },
      wash_item: { type, serviceItemId: 'item', washStationId: 'sink', washingStartedAt: 0 },
    };
    const staff = {
      id: 'worker', role: type === 'clean_floor' || type === 'wash_item' ? 'janitor' : 'waiter',
      morale: 0, x: type === 'take_payment' ? 840 : 200,
      y: type === 'take_payment' ? 100 : 200, task: taskByType[type],
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 30 },
      staff: [staff],
      customers: type === 'take_order'
        ? [{ id: 'c1', state: 'seated', tableId: 't1' }]
        : type === 'take_payment'
          ? [{ id: 'c1', state: 'checkout_processing', cashierStationId: 'cashier1',
            paymentReady: false, x: 840, y: 180 }]
          : [],
      tables: type === 'clean_table'
        ? [{ id: 't1', status: 'dirty', x: 200, y: 200 }]
        : [],
      floorDirt: type === 'clean_floor' ? [{ id: 'd1', x: 200, y: 200 }] : [],
      washStations: type === 'wash_item'
        ? [{ id: 'sink', type: 'manual', x: 200, y: 200 }]
        : [],
      serviceItems: type === 'wash_item'
        ? [{ id: 'item', state: 'washing', washStationId: 'sink', washStartedAt: 0,
          accumulatedWork: 0, lastProgressAt: 0 }]
        : [],
      cashierStations: type === 'take_payment'
        ? [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'worker' }]
        : [],
    };
    const result = resolveStaffAfterMovement(state, 30);

    const source = type === 'wash_item' ? result.serviceItems[0] : result.staff[0].task;
    expect(source).toMatchObject({ accumulatedWork: expectedWork, lastProgressAt: 30 });
  });

  it('changes only future work when morale changes and ignores a repeated timestamp', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 30 },
      customers: [{ id: 'c1', state: 'seated', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      staff: [{ id: 'worker', role: 'waiter', morale: 100, x: 200, y: 200,
        task: { type: 'take_order', customerId: 'c1', startedAt: 0,
          accumulatedWork: 0, lastProgressAt: 0 } }],
    };
    const first = resolveStaffAfterMovement(state, 30);
    const changed = resolveStaffAfterMovement({
      ...first,
      restaurant: { ...first.restaurant, gameTime: 40 },
      staff: [{ ...first.staff[0], morale: 0 }],
    }, 10);
    const repeated = resolveStaffAfterMovement(changed, 0);

    expect(first.staff[0].task).toMatchObject({ accumulatedWork: 45, lastProgressAt: 30 });
    expect(changed.staff[0].task).toMatchObject({ accumulatedWork: 50, lastProgressAt: 40 });
    expect(repeated.staff[0].task).toEqual(changed.staff[0].task);
  });

  it('persists morale-scaled drink preparation work on the service item', () => {
    const result = resolveStaffAfterMovement({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 30 },
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{ id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1',
        state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'cook',
        preparationStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1', drinkId: 'water' }],
      staff: [{ id: 'cook', role: 'cook', morale: 0, x: 120, y: 120,
        task: { type: 'prepare_drink', serviceItemId: 'drink', serviceTableId: 'st1', serviceSlotIndex: 0 } }],
    }, 30);

    expect(result.serviceItems[0]).toMatchObject({ accumulatedWork: 15, lastProgressAt: 30 });
    expect(result.staff[0].task).toMatchObject({ accumulatedWork: 15, lastProgressAt: 30 });
  });

  it('hydrates drink progress from the task when the older item ledger is absent', () => {
    const result = resolveStaffAfterMovement({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 40 },
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{ id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1',
        state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'cook',
        preparationStartedAt: 0 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1', drinkId: 'water' }],
      staff: [{ id: 'cook', role: 'cook', morale: 100, x: 120, y: 120,
        task: { type: 'prepare_drink', serviceItemId: 'drink', serviceTableId: 'st1', serviceSlotIndex: 0,
          accumulatedWork: 30, lastProgressAt: 30 } }],
    }, 10);

    expect(result.serviceItems[0]).toMatchObject({ accumulatedWork: 45, lastProgressAt: 40 });
    expect(result.staff[0].task).toMatchObject({ accumulatedWork: 45, lastProgressAt: 40 });
  });

  it('hydrates manual washing progress from the task when the item ledger is absent', () => {
    const result = resolveStaffAfterMovement({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 40 },
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200 }],
      serviceItems: [{ id: 'item', state: 'washing', washStationId: 'sink', washStartedAt: 0 }],
      staff: [{ id: 'janitor', role: 'janitor', morale: 100, x: 200, y: 200,
        task: { type: 'wash_item', serviceItemId: 'item', washStationId: 'sink', washingStartedAt: 0,
          accumulatedWork: 30, lastProgressAt: 30 } }],
    }, 10);

    expect(result.serviceItems[0]).toMatchObject({ accumulatedWork: 45, lastProgressAt: 40 });
    expect(result.staff[0].task).toMatchObject({ accumulatedWork: 45, lastProgressAt: 40 });
  });

  function orderOutcomeState(customers) {
    return {
      ...baseState,
      restaurant: {
        ...baseState.restaurant, gameTime: 60, day: 1, reputation: 3, totalServed: 0,
      },
      staff: customers.map((customer, index) => ({
        id: `waiter-${index}`, role: 'waiter', morale: 80,
        x: 180 + index * 20, y: 220,
        task: { type: 'take_order', customerId: customer.id, startedAt: 0 },
      })),
      customers,
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      dishes: [{ id: 'toast', price: 10, quality: 1, popularity: 50, prepTime: 60 }],
      unlockedDrinkIds: [],
      completedCustomers: [],
      pendingPartyReviews: [],
      partyReviewHistory: [],
      upgrades: [],
    };
  }

  it('records both outcomes and keeps an unaffordable member waiting for an ordered party member', () => {
    const state = orderOutcomeState([
      {
        id: 'a', partyId: 'p1', partySize: 2, state: 'seated', tableId: 't1',
        spendingTier: 'budget', spendingBudget: 18, archetype: 'regular',
        patience: 100, happiness: 80,
      },
      {
        id: 'b', partyId: 'p1', partySize: 2, state: 'seated', tableId: 't1',
        spendingTier: 'budget', spendingBudget: 6, archetype: 'regular',
        patience: 100, happiness: 80,
      },
    ]);

    const result = updateStaff(state, 0);

    expect(result.customers.find(customer => customer.id === 'a').state).toBe('waiting_for_items');
    expect(result.customers.find(customer => customer.id === 'b').state).toBe('waiting_for_party');
    expect(result.pendingPartyReviews).toEqual([{
      partyId: 'p1', memberIds: ['a', 'b'], orderedMemberIds: ['a'],
      unaffordableMemberIds: ['b'], paidReviews: [],
    }]);
    expect(result.partyReviewHistory).toEqual([]);
    expect(result.tables[0].status).toBe('occupied');
  });

  it('settles an all-unaffordable couple after the second order task in the same tick', () => {
    const state = orderOutcomeState([
      {
        id: 'a', partyId: 'p1', partySize: 2, state: 'seated', tableId: 't1',
        spendingTier: 'budget', spendingBudget: 6, archetype: 'regular',
        patience: 100, happiness: 80,
      },
      {
        id: 'b', partyId: 'p1', partySize: 2, state: 'seated', tableId: 't1',
        spendingTier: 'budget', spendingBudget: 6, archetype: 'regular',
        patience: 100, happiness: 80,
      },
    ]);

    const result = updateStaff(state, 0);

    expect(result.customers).toEqual([
      expect.objectContaining({ id: 'a', state: 'leaving', departureReason: 'menu_unaffordable', tableId: 't1' }),
      expect.objectContaining({ id: 'b', state: 'leaving', departureReason: 'menu_unaffordable', tableId: 't1' }),
    ]);
    expect(result.partyReviewHistory).toEqual([
      expect.objectContaining({
        partyId: 'p1', score: -110, paidCount: 0, unaffordableCount: 2,
        reputationDelta: -0.044,
      }),
    ]);
    expect(result.restaurant.reputation).toBe(2.956);
    expect(result.pendingPartyReviews).toEqual([]);
  });

  it('settles a solo unaffordable order without payment, service, or served-count effects', () => {
    const state = orderOutcomeState([{
      id: 'solo', partyId: 'solo-party', partySize: 1, state: 'seated', tableId: 't1',
      spendingTier: 'budget', spendingBudget: 6, archetype: 'regular',
      patience: 100, happiness: 80,
    }]);

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({
      state: 'leaving', departureReason: 'menu_unaffordable', tableId: 't1',
    });
    expect(result.partyReviewHistory).toEqual([
      expect.objectContaining({
        partyId: 'solo-party', score: -50, paidCount: 0, unaffordableCount: 1,
        reputationDelta: -0.01,
      }),
    ]);
    expect(result.restaurant).toMatchObject({ reputation: 2.99, totalServed: 0 });
    expect(result.pendingPartyReviews).toEqual([]);
    expect(result.serviceItems).toEqual([]);
    expect(result.completedCustomers).toEqual([]);
  });

  function partyPaymentState({ customers, pendingPartyReviews, upgrades = [] }) {
    return {
      ...baseState,
      restaurant: {
        ...baseState.restaurant, gameTime: 60, day: 1, reputation: 3, totalServed: 0,
      },
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'a', stationId: 'cashier1', startedAt: 0 },
      }],
      customers,
      dishes: [{ id: 'toast', price: 40 }],
      unlockedDrinkIds: [],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      serviceItems: [],
      completedCustomers: [],
      pendingPartyReviews,
      partyReviewHistory: [],
      upgrades,
    };
  }

  it('settles one mixed-party review when its ordered member makes the final payment', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const state = partyPaymentState({
      customers: [
        {
          id: 'a', partyId: 'p1', state: 'checkout_processing', menuOutcome: 'ordered',
          cashierStationId: 'cashier1', paymentReady: false, x: 840, y: 180,
          happiness: 100, dishId: 'toast', drinkId: null, orderSubtotal: 10,
          tableId: 't1',
        },
        {
          id: 'b', partyId: 'p1', state: 'waiting_for_party', menuOutcome: 'unaffordable',
          happiness: 80, tableId: 't1',
        },
      ],
      pendingPartyReviews: [{
        partyId: 'p1', memberIds: ['a', 'b'], orderedMemberIds: ['a'],
        unaffordableMemberIds: ['b'], paidReviews: [],
      }],
    });

    const result = updateStaff(state, 0);
    const randomCallsAfterPayment = randomSpy.mock.calls.length;
    expect(randomCallsAfterPayment).toBe(1);

    expect(result.customers.find(customer => customer.id === 'a')).toMatchObject({
      state: 'leaving', departureReason: 'served',
    });
    expect(result.customers.find(customer => customer.id === 'b')).toMatchObject({
      state: 'leaving', departureReason: 'menu_unaffordable', tableId: 't1',
    });
    expect(result.partyReviewHistory.at(-1)).toMatchObject({
      partyId: 'p1', score: -5, memberCount: 2, paidCount: 1,
      unaffordableCount: 1, reputationDelta: -0.002,
    });
    expect(result.pendingPartyReviews).toEqual([]);
    expect(result.completedCustomers).toHaveLength(1);
    expect(result.restaurant).toMatchObject({ totalServed: 1, reputation: 2.998 });

    const repeated = updateStaff(result, 0);
    expect(repeated.partyReviewHistory).toHaveLength(1);
    expect(repeated.completedCustomers).toEqual(result.completedCustomers);
    expect(repeated.restaurant).toEqual(result.restaurant);
    expect(randomSpy.mock.calls.length).toBe(randomCallsAfterPayment);
  });

  it('records the departing payer position before clearing checkout fields', () => {
    const result = updateStaff(partyPaymentState({
      customers: [{
        id: 'a', partyId: 'p1', state: 'checkout_processing', menuOutcome: 'ordered',
        cashierStationId: 'cashier1', checkoutPosition: { x: 840, y: 180 },
        paymentReady: false, checkoutLineMember: true, x: 840, y: 180, happiness: 100,
        dishId: 'toast', drinkId: null, orderSubtotal: 10, tableId: 't1',
      }],
      pendingPartyReviews: [],
    }), 0);

    expect(result.customers[0]).toMatchObject({
      state: 'leaving', cashierStationId: null, checkoutPosition: null,
      checkoutDeparture: { stationId: 'cashier1', position: { x: 840, y: 180 } },
      checkoutLineMember: false,
    });
  });

  it('hands the station to the next payer only after the completed payer clears the line', () => {
    const station = {
      id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
    };
    const first = {
      id: 'first', state: 'checkout_processing', paymentQueuedAt: 1,
      cashierStationId: station.id, checkoutPosition: { x: 840, y: 180 },
      paymentReady: false, x: 840, y: 180, happiness: 80,
      dishId: 'toast', drinkId: null, tableId: null,
    };
    const second = {
      id: 'second', state: 'checkout_moving', paymentQueuedAt: 2,
      cashierStationId: station.id, paymentReady: false, x: 840, y: 200,
      happiness: 80, dishId: 'toast', drinkId: null, tableId: null,
    };
    const initial = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 60, day: 1, totalServed: 0, reputation: 3 },
      cashierStations: [station],
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: first.id, stationId: station.id, startedAt: 0 },
      }],
      customers: [first, second],
      dishes: [{ id: 'toast', price: 10 }],
      completedCustomers: [],
    };

    const queued = updateCustomers(initial, { gameDt: 0, movementDt: 0 });
    expect(queued.customers.find(customer => customer.id === second.id)).toMatchObject({
      checkoutPosition: { x: 840, y: 200 }, paymentReady: false,
    });

    const paid = updateStaff(queued, 0);
    expect(paid.customers.find(customer => customer.id === first.id)).toMatchObject({
      state: 'leaving',
      checkoutDeparture: { stationId: station.id, position: { x: 840, y: 180 } },
    });
    expect(paid.completedCustomers).toHaveLength(1);

    const cleared = updateCustomers({
      ...paid,
      customers: paid.customers.map(customer => customer.id === first.id
        ? { ...customer, x: 760, y: 180 }
        : { ...customer, x: 840, y: 180 }),
    }, { gameDt: 0, movementDt: 0 });
    expect(cleared.customers.find(customer => customer.id === second.id)).toMatchObject({
      checkoutPosition: { x: 840, y: 180 }, paymentReady: true,
    });

    const assigned = updateStaff(cleared, 0);
    const secondStarted = updateStaff(assigned, 0);
    expect(secondStarted.customers.find(customer => customer.id === second.id).state)
      .toBe('checkout_processing');
    expect(secondStarted.staff[0].task).toMatchObject({
      type: 'take_payment', customerId: second.id, stationId: station.id, startedAt: 60,
    });

    const secondPaid = updateStaff({
      ...secondStarted,
      restaurant: { ...secondStarted.restaurant, gameTime: 120 },
    }, 0);
    expect(secondPaid.customers.find(customer => customer.id === second.id).state).toBe('leaving');
    expect(secondPaid.completedCustomers).toHaveLength(2);
  });

  it('applies one upgraded positive delta when the final member of an all-paying party pays', () => {
    const result = updateStaff(partyPaymentState({
      customers: [
        {
          id: 'a', partyId: 'p1', state: 'checkout_processing', menuOutcome: 'ordered',
          cashierStationId: 'cashier1', paymentReady: false, x: 840, y: 180,
          happiness: 100, dishId: 'toast', drinkId: null, orderSubtotal: 10,
          tableId: 't1',
        },
        {
          id: 'b', partyId: 'p1', state: 'leaving', menuOutcome: 'ordered',
          departureReason: 'served', happiness: 100, tableId: 't1',
        },
      ],
      pendingPartyReviews: [{
        partyId: 'p1', memberIds: ['a', 'b'], orderedMemberIds: ['a', 'b'],
        unaffordableMemberIds: [], paidReviews: [{ customerId: 'b', score: 100 }],
      }],
      upgrades: [{ level: 2, effects: { type: 'reputationGain', value: 0.01 } }],
    }), 0);

    expect(result.partyReviewHistory).toEqual([
      expect.objectContaining({
        partyId: 'p1', score: 100, memberCount: 2, paidCount: 2,
        unaffordableCount: 0, reputationDelta: 0.0408,
      }),
    ]);
    expect(result.restaurant.reputation).toBe(3.0408);
    expect(result.pendingPartyReviews).toEqual([]);
  });

  it('does not fall back to an individual reputation gain for an untracked new-system payment', () => {
    const result = updateStaff(partyPaymentState({
      customers: [{
        id: 'a', partyId: 'p1', state: 'checkout_processing', menuOutcome: 'ordered',
        cashierStationId: 'cashier1', paymentReady: false, x: 840, y: 180,
        happiness: 100, dishId: 'toast', drinkId: null, orderSubtotal: 10,
        tableId: 't1',
      }],
      pendingPartyReviews: [],
    }), 0);

    expect(result.completedCustomers).toHaveLength(1);
    expect(result.restaurant).toMatchObject({ totalServed: 1, reputation: 3 });
    expect(result.partyReviewHistory).toEqual([]);
  });

  it('bills one dish and one drink from accepted price snapshots exactly once without changing delivered items', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const legacyConsumedItem = {
      id: 'dish', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'delivered', consumedAt: 100,
    };
    const state = {
      ...baseState,
      staff: [{ id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 } }],
      customers: [{ id: 'c1', state: 'checkout_processing', paymentReady: false, cashierStationId: 'cashier1', x: 840, y: 180, happiness: 80, dishId: 'd1', drinkId: 'water', tableId: 't1', menuOutcome: 'ordered', dishPriceAtOrder: 8, drinkPriceAtOrder: 3, orderSubtotal: 11 }],
      dishes: [{ id: 'd1', price: 40 }], unlockedDrinkIds: ['water'], drinkOverrides: { water: { price: 20 } },
      serviceItems: [
        legacyConsumedItem,
        { id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'delivered' },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }], completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
    };
    const result = updateStaff(state, 0);
    expect(result.completedCustomers[0]).toMatchObject({ dishId: 'd1', drinkId: 'water', revenue: 13.2, tip: 2.2, totalPaid: 13.2 });
    expect(result.serviceItems).toEqual(state.serviceItems);
    // Payment is no longer a table-state authority: a diner still physically
    // seated keeps the table occupied until movement clears the seat.
    expect(result.tables[0].status).toBe('occupied');

    const repeated = updateStaff(result, 60);
    expect(repeated.completedCustomers).toHaveLength(1);
    expect(repeated.restaurant.totalServed).toBe(result.restaurant.totalServed);
  });

  it('does not dirty a replacement party table or delete its items when an old payer completes twice', () => {
    const newItem = {
      id: 'new-item', kind: 'dish', menuItemId: 'd1', customerId: 'new',
      state: 'ordered', tableId: 't1', assignedStaffId: null,
    };
    const state = {
      ...baseState,
      staff: [{ id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'payer', stationId: 'cashier1', startedAt: 0 } }],
      customers: [
        { id: 'payer', partyId: 'old-party', state: 'checkout_processing', paymentReady: false,
          cashierStationId: 'cashier1', x: 840, y: 180, happiness: 80,
          dishId: 'd1', drinkId: null, tableId: 't1', menuOutcome: 'ordered',
          dishPriceAtOrder: 8, orderSubtotal: 8 },
        { id: 'new', partyId: 'new-party', state: 'seated', tableId: 't1', chairId: 'ch1',
          x: 220, y: 190, dishId: 'd1', drinkId: null },
      ],
      dishes: [{ id: 'd1', price: 40 }],
      serviceItems: [newItem],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
      tables: [{
        id: 't1', seats: 2, status: 'occupied', x: 200, y: 200,
        diningPartyId: 'new-party', diningCustomerIds: ['new'],
      }],
      completedCustomers: [],
      pendingPartyReviews: [],
      partyReviewHistory: [],
    };

    const paid = updateStaff(state, 0);
    expect(paid.completedCustomers).toHaveLength(1);
    expect(paid.tables[0]).toMatchObject({
      status: 'occupied', diningPartyId: 'new-party', diningCustomerIds: ['new'],
    });
    expect(paid.serviceItems).toEqual([newItem]);

    const recovered = updateStaff({
      ...paid,
      customers: paid.customers.map(customer => customer.id === 'payer'
        ? { ...customer, state: 'checkout_processing', cashierStationId: 'cashier1' }
        : customer),
      staff: [{ id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'payer', stationId: 'cashier1', startedAt: 0 } }],
    }, 0);

    expect(recovered.completedCustomers).toHaveLength(1);
    expect(recovered.tables[0]).toMatchObject({
      status: 'occupied', diningPartyId: 'new-party', diningCustomerIds: ['new'],
    });
    expect(recovered.serviceItems).toEqual([newItem]);
  });

  it('bills legacy dish and resolved drink prices when no snapshot exists', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 60 },
      staff: [{ id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 } }],
      customers: [{ id: 'c1', state: 'checkout_processing', paymentReady: false, cashierStationId: 'cashier1', x: 840, y: 180, happiness: 80, dishId: 'd1', drinkId: 'water', tableId: 't1' }],
      dishes: [{ id: 'd1', price: 40 }], unlockedDrinkIds: ['water'], drinkOverrides: { water: { price: 20 } },
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
      serviceItems: [
        { id: 'dish', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'delivered' },
        { id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'delivered' },
      ],
      completedCustomers: [],
    };

    const result = updateStaff(state, 0);

    expect(result.completedCustomers[0]).toMatchObject({
      dishId: 'd1', drinkId: 'water', revenue: 72, tip: 12, totalPaid: 72,
    });
  });

  it('falls back to current prices instead of billing an inconsistent ordered snapshot tuple', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 60 },
      staff: [{ id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 } }],
      customers: [{
        id: 'c1', state: 'checkout_processing', paymentReady: false,
        cashierStationId: 'cashier1', x: 840, y: 180, happiness: 80,
        dishId: 'd1', drinkId: 'water', tableId: 't1', menuOutcome: 'ordered',
        dishPriceAtOrder: 8, drinkPriceAtOrder: 3, orderSubtotal: 2,
      }],
      dishes: [{ id: 'd1', price: 40 }],
      unlockedDrinkIds: ['water'],
      drinkOverrides: { water: { price: 20 } },
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
      serviceItems: [
        { id: 'dish', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'delivered' },
        { id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'delivered' },
      ],
      completedCustomers: [],
    };

    const result = updateStaff(state, 0);

    expect(result.completedCustomers[0]).toMatchObject({
      revenue: 72, tip: 12, totalPaid: 72,
    });
  });

  it('finishes stale checkout cleanup without charging or serving a completed customer visit twice', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const existingPayment = { customerId: 'a', revenue: 12 };
    const state = partyPaymentState({
      customers: [{
        id: 'a', partyId: 'p1', state: 'checkout_processing', menuOutcome: 'ordered',
        cashierStationId: 'cashier1', paymentReady: false, x: 840, y: 180,
        happiness: 100, dishId: 'toast', drinkId: null, orderSubtotal: 10,
        tableId: 't1',
      }],
      pendingPartyReviews: [],
    });
    state.completedCustomers = [existingPayment];
    state.restaurant = { ...state.restaurant, totalServed: 7 };
    state.serviceItems = [{
      id: 'stale-order', customerId: 'a', kind: 'dish', state: 'preparing',
    }];

    const result = updateStaff(state, 0);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(result.completedCustomers).toEqual([existingPayment]);
    expect(result.restaurant.totalServed).toBe(7);
    expect(result.customers[0]).toMatchObject({
      id: 'a', state: 'leaving', departureReason: 'served',
      cashierStationId: null, checkoutPosition: null, paymentReady: false,
    });
    expect(result.serviceItems).toEqual([]);
    expect(result.staff[0].task).toBeNull();
  });

  it('does not re-dirty an already cleaned table when payment completes', () => {
    const result = updateStaff({
      ...baseState,
      restaurant: {
        ...baseState.restaurant, gameTime: 60, totalServed: 0, reputation: 3,
      },
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: {
          type: 'take_payment', customerId: 'payer',
          stationId: 'cashier1', startedAt: 0,
        },
      }],
      customers: [{
        id: 'payer', state: 'checkout_processing', paymentReady: false,
        cashierStationId: 'cashier1', x: 840, y: 180,
        happiness: 80, dishId: 'd1', drinkId: null, tableId: 't1',
      }],
      dishes: [{ id: 'd1', price: 10 }],
      tables: [{ id: 't1', status: 'empty', seats: 2, x: 200, y: 200 }],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40,
        assignedStaffId: 'cashier',
      }],
      completedCustomers: [],
    }, 0);

    expect(result.customers[0]).toMatchObject({
      state: 'leaving', tableId: 't1', departureReason: 'served',
    });
    expect(result.tables[0].status).toBe('empty');
  });

  it('advances and completes the next payment after a processor leaves slot zero', () => {
    const station = {
      id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
    };
    const state = {
      ...baseState,
      restaurant: {
        ...baseState.restaurant, gameTime: 60, totalServed: 0, reputation: 3,
      },
      cashierStations: [station],
      dishes: [{ id: 'd1', price: 10 }],
      completedCustomers: [],
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'first', stationId: 'cashier1', startedAt: 0 },
      }],
      customers: [
        {
          id: 'first', state: 'checkout_processing', paymentQueuedAt: 1,
          cashierStationId: 'cashier1', checkoutPosition: { x: 840, y: 180 },
          paymentReady: false, x: 840, y: 180,
          happiness: 80, dishId: 'd1', drinkId: null, tableId: null,
        },
        {
          id: 'second', state: 'checkout_moving', paymentQueuedAt: 2,
          cashierStationId: 'cashier1', checkoutPosition: null,
          paymentReady: false, x: 800, y: 180,
          happiness: 80, dishId: 'd1', drinkId: null, tableId: null,
        },
      ],
    };

    const slotOne = { x: 840, y: 200 };
    let reserved = state;
    expect(Math.hypot(
      state.customers[1].x - state.customers[0].x,
      state.customers[1].y - state.customers[0].y,
    )).toBe(40);
    let reachedSlotOne = false;
    for (let tick = 0; tick < 100; tick += 1) {
      const previous = reserved.customers.find(customer => customer.id === 'second');
      reserved = updateCustomers(reserved, { gameDt: 0, movementDt: 0.1 });
      const processor = reserved.customers.find(customer => customer.id === 'first');
      const second = reserved.customers.find(customer => customer.id === 'second');
      expect(processor).toMatchObject({
        state: 'checkout_processing', checkoutPosition: { x: 840, y: 180 },
      });
      expect(Math.hypot(second.x - previous.x, second.y - previous.y)).toBeLessThanOrEqual(6.2 + 1e-6);
      expect(Math.hypot(second.x - processor.x, second.y - processor.y)).toBeGreaterThanOrEqual(16 - 1e-6);
      if (second.checkoutPosition?.x === slotOne.x
        && second.checkoutPosition?.y === slotOne.y
        && Math.hypot(second.x - slotOne.x, second.y - slotOne.y) <= 2) {
        reachedSlotOne = true;
        break;
      }
    }
    expect(reachedSlotOne).toBe(true);
    const secondAtSlotOne = reserved.customers.find(customer => customer.id === 'second');
    expect(secondAtSlotOne).toMatchObject({
      state: 'checkout_moving', checkoutPosition: slotOne, paymentReady: false,
    });
    expect(Math.hypot(secondAtSlotOne.x - slotOne.x, secondAtSlotOne.y - slotOne.y))
      .toBeLessThanOrEqual(2);

    const firstPaid = updateStaff(reserved, 0);
    expect(firstPaid.customers.find(customer => customer.id === 'first').state).toBe('leaving');
    expect(firstPaid.completedCustomers).toHaveLength(1);

    const slotZero = { x: 840, y: 180 };
    let arrivedAtFront = firstPaid;
    let reachedSlotZero = false;
    for (let tick = 0; tick < 100; tick += 1) {
      const previous = arrivedAtFront.customers.find(customer => customer.id === 'second');
      arrivedAtFront = updateCustomers(arrivedAtFront, { gameDt: 0, movementDt: 0.1 });
      const second = arrivedAtFront.customers.find(customer => customer.id === 'second');
      expect(Math.hypot(second.x - previous.x, second.y - previous.y)).toBeLessThanOrEqual(6.2 + 1e-6);
      if (second.checkoutPosition?.x === slotZero.x
        && second.checkoutPosition?.y === slotZero.y
        && Math.hypot(second.x - slotZero.x, second.y - slotZero.y) <= 2
        && second.paymentReady) {
        reachedSlotZero = true;
        break;
      }
    }
    expect(reachedSlotZero).toBe(true);
    const secondAtSlotZero = arrivedAtFront.customers.find(customer => customer.id === 'second');
    expect(secondAtSlotZero).toMatchObject({
      state: 'checkout_moving', checkoutPosition: slotZero, paymentReady: true,
    });
    expect(Math.hypot(secondAtSlotZero.x - secondAtSlotOne.x,
      secondAtSlotZero.y - secondAtSlotOne.y)).toBeGreaterThan(0);

    const secondAssigned = updateStaff(arrivedAtFront, 0);
    const secondStarted = updateStaff(secondAssigned, 0);
    expect(secondStarted.customers.find(customer => customer.id === 'second').state)
      .toBe('checkout_processing');
    expect(secondStarted.staff[0].task).toMatchObject({
      type: 'take_payment', customerId: 'second', stationId: 'cashier1', startedAt: 60,
    });

    const secondPaid = updateStaff({
      ...secondStarted,
      restaurant: { ...secondStarted.restaurant, gameTime: 120 },
    }, 0);
    expect(secondPaid.customers.find(customer => customer.id === 'second').state).toBe('leaving');
    expect(secondPaid.completedCustomers).toHaveLength(2);
    expect(secondPaid.restaurant.totalServed).toBe(2);
  });

  it.each(['dish', 'drink'])('clears a used %s item through one generic task', kind => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 220, y: 220,
        task: { type: 'clean_service_item', serviceItemId: 'i1' } }],
      serviceItems: [{ id: 'i1', kind, state: 'to_clean', x: 220, y: 220 }],
    };
    const result = updateStaff(state, 0);
    expect(result.serviceItems).toEqual([]);
    expect(result.staff[0].task).toBeNull();
  });

  it('balances concurrent dirty deliveries across projected station workloads', () => {
    const washStations = [
      { id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 },
      { id: 'auto-1', type: 'automatic', x: 320, y: 200, w: 40, h: 40 },
      { id: 'auto-2', type: 'automatic', x: 440, y: 200, w: 40, h: 40 },
    ];
    const serviceItems = ['one', 'two', 'three'].map((id, index) => ({
      id, kind: 'dish', customerId: `gone-${index}`, state: 'carried_dirty', washQueuedAt: null,
    }));
    const staff = serviceItems.map((item, index) => ({
      id: `waiter-${index}`, role: 'waiter', morale: 80,
      x: 100, y: 200 + index * 20, task: null, carryingServiceItemId: item.id,
    }));

    const assigned = updateStaff({ ...baseState, staff, serviceItems, washStations }, 0);
    const deliveries = assigned.staff.map(worker => worker.task);
    expect(new Set(deliveries.map(task => task?.washStationId))).toEqual(
      new Set(['auto-1', 'auto-2']),
    );
    expect(deliveries.every(task => ['auto-1', 'auto-2'].includes(task?.washStationId))).toBe(true);

    const delivered = updateStaff({
      ...assigned,
      staff: assigned.staff.map(worker => {
        const station = washStations.find(candidate => candidate.id === worker.task.washStationId);
        return { ...worker, x: worker.navigationGoal.x, y: worker.navigationGoal.y };
      }),
    }, 0);
    expect(delivered.serviceItems.every(item => item.state === 'queued_for_wash')).toBe(true);
    const washing = updateAutomaticDishwashers(delivered);
    expect(washing.serviceItems.filter(item => item.state === 'washing')).toHaveLength(2);
    expect(new Set(washing.serviceItems.filter(item => item.state === 'washing')
      .map(item => item.washStationId))).toEqual(new Set(['auto-1', 'auto-2']));
  });

  it('reserves only eight inbound deliveries for a manual sink', () => {
    const washStations = [{ id: 'sink', type: 'manual', x: 300, y: 200, w: 40, h: 40 }];
    const serviceItems = Array.from({ length: 9 }, (_, index) => ({
      id: `dirty-${index}`, state: 'carried_dirty', tableId: `table-${index}`,
    }));
    const staff = serviceItems.map((item, index) => ({
      id: `waiter-${index}`, role: 'waiter', morale: 80,
      x: 100, y: 100 + index * 20, task: null, carryingServiceItemId: item.id,
    }));

    const result = updateStaff({ ...baseState, washStations, serviceItems, staff }, 0);

    expect(result.staff.filter(worker => worker.task?.type === 'deliver_dirty_item')).toHaveLength(8);
    expect(result.staff.filter(worker => worker.task == null
      && worker.carryingServiceItemIds?.length > 0)).toHaveLength(1);
  });

  it('leaves dirty items at tables when every wash station is full', () => {
    const washStations = [{ id: 'sink', type: 'manual', x: 300, y: 200, w: 40, h: 40 }];
    const serviceItems = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `queued-${index}`, state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: index,
      })),
      { id: 'dirty', state: 'dirty_at_table', tableId: 't1' },
    ];
    const staff = [{ id: 'waiter', role: 'waiter', morale: 80, x: 180, y: 220, task: null }];

    const result = updateStaff({
      ...baseState,
      washStations,
      serviceItems,
      staff,
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
    }, 0);

    expect(result.serviceItems.find(item => item.id === 'dirty').state).toBe('dirty_at_table');
    expect(result.staff[0].task?.type).not.toBe('collect_dirty_item');
  });

  it('rechecks capacity before delivering a reserved dirty item', () => {
    const queued = Array.from({ length: 8 }, (_, index) => ({
      id: `queued-${index}`, state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: index,
    }));
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [...queued, { id: 'dirty', state: 'carried_dirty' }],
      staff: [{
        id: 'waiter', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'sink' },
        carryingServiceItemId: 'dirty',
      }],
    };

    const result = updateStaff(state, 0);

    expect(result.serviceItems.find(item => item.id === 'dirty')).toMatchObject({ state: 'carried_dirty' });
    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: ['dirty'] });
  });

  it('does not claim a dirty item at a table with no reachable adjacent cell', () => {
    const blockers = [
      [180, 180], [200, 180], [220, 180], [240, 180],
      [180, 200], [240, 200], [180, 220], [240, 220],
      [180, 240], [200, 240], [220, 240], [240, 240],
    ].map(([x, y], index) => ({ id: `block-${index}`, x, y }));
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 400, y: 300, task: null }],
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
      chairs: blockers,
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', tableId: 't1', state: 'dirty_at_table' }],
    }, 0);
    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems[0].state).toBe('dirty_at_table');
  });

  it('replans dirty pickup when its table moves before arrival', () => {
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'collect_dirty_item', serviceItemId: 'dirty', tableId: 't1' }, carryingServiceItemId: null }],
      tables: [{ id: 't1', status: 'dirty', x: 400, y: 200 }],
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', tableId: 't1', state: 'dirty_at_table' }],
    }, 0);
    expect(result.staff[0]).toMatchObject({
      task: { type: 'collect_dirty_item', serviceItemId: 'dirty', tableId: 't1' },
      carryingServiceItemIds: [],
    });
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 19, y: 11 }));
    expect(result.serviceItems[0].state).toBe('dirty_at_table');
  });

  it('replans dirty delivery when its station moves before arrival', () => {
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'sink' }, carryingServiceItemId: 'dirty' }],
      washStations: [{ id: 'sink', type: 'manual', x: 400, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', state: 'carried_dirty' }],
    }, 0);
    expect(result.staff[0]).toMatchObject({
      task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'sink' },
      carryingServiceItemIds: ['dirty'],
    });
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 19, y: 11 }));
    expect(result.serviceItems[0].state).toBe('carried_dirty');
  });

  it('cancels an unreachable moved-station delivery without losing the carried item', () => {
    const blockers = [
      [380, 180], [400, 180], [420, 180], [440, 180],
      [380, 200], [440, 200], [380, 220], [440, 220],
      [380, 240], [400, 240], [420, 240], [440, 240],
    ].map(([x, y], index) => ({ id: `station-block-${index}`, x, y }));
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'sink' }, carryingServiceItemId: 'dirty' }],
      chairs: blockers,
      washStations: [{ id: 'sink', type: 'manual', x: 400, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', state: 'carried_dirty' }],
    }, 0);
    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: ['dirty'] });
    expect(result.serviceItems[0].state).toBe('carried_dirty');
  });

  it('assigns the oldest unassigned wash item to a reachable manual sink', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, task: null }],
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [
        { id: 'new', kind: 'dish', customerId: 'gone-new', state: 'queued_for_wash', washStationId: null, washQueuedAt: 20 },
        { id: 'old', kind: 'dish', customerId: 'gone-old', state: 'queued_for_wash', washStationId: null, washQueuedAt: 10 },
      ],
    };
    const claimed = updateStaff(state, 0);
    expect(claimed.staff[0].task).toMatchObject({ type: 'wash_item', serviceItemId: 'old', washStationId: 'sink' });
    expect(claimed.staff[0].navigationGoal).toEqual(cellToWorld({ x: 9, y: 11 }));
    expect(claimed.staff[0]).not.toHaveProperty('path');
    expect(claimed.serviceItems.find(item => item.id === 'old').washStationId).toBe('sink');
    const started = updateStaff(claimed, 0);
    expect(started.serviceItems.find(item => item.id === 'old')).toMatchObject({
      state: 'washing', washStationId: 'sink', washStartedAt: 100,
    });
  });

  it.each([
    ['ordered', { id: 'ordered', kind: 'dish', customerId: 'c1', state: 'ordered' }],
    ['preparing', { id: 'preparing', kind: 'dish', customerId: 'c1', state: 'preparing' }],
  ])('removes a paid customer %s item at payment without owner-kind duplicates', (kind, pendingItem) => {
    const result = updateStaff({ ...baseState, restaurant: { ...baseState.restaurant, gameTime: 60 },
      staff: [{ id: 'cashier', role: 'waiter', task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 }, carryingServiceItemId: null },
        { id: 'other', role: 'waiter', carryingServiceItemId: 'other-carried' }],
      customers: [{ id: 'c1', state: 'checkout_processing', paymentReady: false, cashierStationId: 'cashier1', x: 840, y: 180, happiness: 80, dishId: 'd1', drinkId: null, tableId: 't1' }, { id: 'c2', state: 'waiting_for_items', dishId: 'd1', tableId: 't2' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }, { id: 't2', status: 'occupied', x: 360, y: 200 }],
      dishes: [{ id: 'd1', price: 10 }],
      serviceItems: [
        pendingItem,
        { id: 'carried', kind: 'drink', customerId: 'c1', state: 'carried' },
        { id: 'other-carried', kind: 'dish', customerId: 'c2', tableId: 't2', state: 'carried' },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
    }, 0);
    expect(result.serviceItems.map(item => item.id)).toEqual(['carried', 'other-carried']);
    expect(result.serviceItems[0].state).toBe('to_clean');
    expect(result.staff[0].carryingServiceItemIds).toEqual([]);
    expect(result.staff[1].carryingServiceItemIds).toEqual(['other-carried']);
  });

  it('clears every paid carried-item carrier and preserves unrelated ownership in the same tick', () => {
    const result = updateStaff({ ...baseState, restaurant: { ...baseState.restaurant, gameTime: 60 },
      staff: [{ id: 'cashier', role: 'waiter', task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 }, carryingServiceItemId: null },
        { id: 'paid-waiter', role: 'waiter', carryingServiceItemId: 'paid-item' },
        { id: 'other-waiter', role: 'waiter', carryingServiceItemId: 'other-item' }],
      customers: [{ id: 'c1', state: 'checkout_processing', paymentReady: false, cashierStationId: 'cashier1', x: 840, y: 180, happiness: 80, dishId: 'd1', tableId: 't1' }, { id: 'c2', state: 'waiting_for_items', dishId: 'd1', tableId: 't2' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }, { id: 't2', status: 'occupied', x: 360, y: 200 }],
      dishes: [{ id: 'd1', price: 10 }],
      serviceItems: [{ id: 'paid-item', kind: 'dish', customerId: 'c1', state: 'carried' }, { id: 'other-item', kind: 'dish', customerId: 'c2', tableId: 't2', state: 'carried' }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
    }, 60);
    expect(result.serviceItems).toEqual([expect.objectContaining({ id: 'paid-item', state: 'to_clean' }), expect.objectContaining({ id: 'other-item', state: 'carried' })]);
    expect(result.staff.find(worker => worker.id === 'paid-waiter').carryingServiceItemIds).toEqual([]);
    expect(result.staff.find(worker => worker.id === 'other-waiter').carryingServiceItemIds).toEqual(['other-item']);
  });
  afterEach(() => vi.restoreAllMocks());

  it('does nothing with no staff', () => {
    const result = updateStaff(baseState, 1);
    expect(result.staff).toEqual([]);
  });

  it('collects and queues dirty service items, retaining ownership when no station is reachable', () => {
    const base = { ...baseState, restaurant: { gameTime: 100 }, customers: [{ id: 'c1', tableId: 't1', state: 'leaving' }],
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }], serviceItems: [{ id: 'i1', customerId: 'c1', tableId: 't1', kind: 'dish', state: 'dirty_at_table', dirtyAt: 1 }],
      staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220, task: { type: 'collect_dirty_item', serviceItemId: 'i1', tableId: 't1' }, carryingServiceItemId: null }] };
    const carried = updateStaff({ ...base, washStations: [] }, 0);
    expect(carried.serviceItems[0].state).toBe('carried_dirty');
    expect(carried.tables[0].status).toBe('dirty');
    expect(carried.staff[0].carryingServiceItemIds).toEqual(['i1']);
    const queued = updateStaff({ ...carried, washStations: [{ id: 'wash1', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      staff: [{ ...carried.staff[0], task: { type: 'deliver_dirty_item', serviceItemId: 'i1', washStationId: 'wash1' } }] }, 0);
    expect(queued.serviceItems[0]).toMatchObject({ state: 'queued_for_wash', washStationId: 'wash1', washQueuedAt: 100 });
    expect(queued.staff[0].carryingServiceItemIds).toEqual([]);
  });

  it('clears the old point when collection immediately transitions to adjacent delivery', () => {
    const state = {
      ...baseState,
      restaurant: { gameTime: 100 },
      customers: [{ id: 'c1', tableId: 't1', state: 'leaving' }],
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
      washStations: [{ id: 'wash1', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'i1', customerId: 'c1', tableId: 't1', kind: 'dish', state: 'dirty_at_table', dirtyAt: 1 }],
      staff: [{
        id: 'w1', role: 'waiter', x: 180, y: 220,
        navigationGoal: { x: 180, y: 220 },
        task: { type: 'collect_dirty_item', serviceItemId: 'i1', tableId: 't1' },
      carryingServiceItemIds: [],
      }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({
      task: { type: 'deliver_dirty_item', serviceItemId: 'i1', washStationId: 'wash1' },
      carryingServiceItemIds: ['i1'],
      activityPhase: 'working',
    });
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.serviceItems[0].state).toBe('carried_dirty');
  });

  it('manual washing retains a duplicate and prevents a second janitor station claim', () => {
    const state = { ...baseState, restaurant: { gameTime: 100 }, washStations: [{ id: 'wash1', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'same', state: 'queued_for_wash', washStationId: 'wash1', washQueuedAt: 1 }, { id: 'same', state: 'queued_for_wash', washStationId: 'wash1', washQueuedAt: 2 }],
      staff: [{ id: 'j1', role: 'janitor', x: 180, y: 200, task: null }, { id: 'j2', role: 'janitor', x: 160, y: 200, task: null }] };
    const claimed = updateStaff(state, 0);
    expect(claimed.staff.filter(worker => worker.task?.type === 'wash_item')).toHaveLength(1);
    const started = updateStaff({ ...claimed, restaurant: { gameTime: 100 },
      staff: claimed.staff.map(worker => worker.task?.type === 'wash_item'
        ? { ...worker, task: { ...worker.task, washingStartedAt: null } } : worker) }, 0);
    expect(started.serviceItems.filter(item => item.state === 'washing')).toHaveLength(1);
    const waiting = updateStaff({ ...started, restaurant: { gameTime: 399 } }, 0);
    expect(waiting.serviceItems).toHaveLength(2);
    const done = updateStaff({ ...waiting, restaurant: { gameTime: 400 } }, 0);
    expect(done.serviceItems).toHaveLength(1);
  });

  it('does not claim a dirty table while a customer or dirty item blocks cleaning', () => {
    const blocked = {
      ...baseState,
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      customers: [{ id: 'c1', tableId: 't1', state: 'eating' }],
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, task: null }],
    };
    expect(updateStaff(blocked, 0).staff[0].task).toBeNull();
    expect(updateStaff({
      ...blocked,
      customers: [{ id: 'c1', tableId: 't1', state: 'leaving' }],
      serviceItems: [{ id: 'dirty', tableId: 't1', state: 'dirty_at_table' }],
    }, 0).staff[0].task).toBeNull();
  });

  it('never assigns automatic-station queued work to a janitor', () => {
    const result = updateStaff({ ...baseState, washStations: [{ id: 'auto', type: 'automatic', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'i', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 1 }],
      staff: [{ id: 'j1', role: 'janitor', x: 200, y: 200, task: null }] }, 0);
    expect(result.staff[0].task?.type).not.toBe('wash_item');
  });

  it('moves two idle workers through opposing corridor traffic within fifteen seconds, including yielding', () => {
    const state = congestionState([
      {
        id: 'a-worker', role: 'waiter', x: 100, y: 100,
        activityPhase: 'idle_roaming', navigationGoal: cellToWorld({ x: 16, y: 5 }),
        task: null,
      },
      {
        id: 'b-worker', role: 'waiter', x: 260, y: 100,
        activityPhase: 'idle_roaming', navigationGoal: cellToWorld({ x: 3, y: 5 }),
        task: null,
      },
    ]);
    const { histories } = runCongestionScenario({
      ...state,
      serviceItems: [],
    }, current => current.staff.find(worker => worker.id === 'a-worker').x > 260
      && current.staff.find(worker => worker.id === 'b-worker').x < 100, { maxTicks: 150 });

    expect(Math.max(...histories.get('a-worker').map(point => point.x))).toBeGreaterThan(260);
    expect(Math.min(...histories.get('b-worker').map(point => point.x))).toBeLessThan(100);
    const pairwiseSeparations = histories.get('a-worker').map((point, tick) => {
      const peer = histories.get('b-worker')[tick];
      return Math.hypot(point.x - peer.x, point.y - peer.y);
    });
    expect(Math.min(...pairwiseSeparations)).toBeGreaterThanOrEqual(16 - 1e-6);
    for (let tick = 1; tick < histories.get('a-worker').length; tick += 1) {
      expect(minimumSweptDistance(
        histories.get('a-worker')[tick - 1], histories.get('a-worker')[tick],
        histories.get('b-worker')[tick - 1], histories.get('b-worker')[tick],
      )).toBeGreaterThanOrEqual(16 - 1e-6);
    }
  });

  it('recovers a worker whose work point is temporarily occupied within ten seconds', () => {
    const state = congestionState([
      { id: 'worker', role: 'waiter', x: 100, y: 100, navigationGoal: cellToWorld({ x: 8, y: 5 }), task: { type: 'clean_service_item', serviceItemId: 'target' } },
      { id: 'occupier', role: 'waiter', x: 160, y: 100, navigationGoal: cellToWorld({ x: 14, y: 5 }), task: { type: 'clean_service_item', serviceItemId: 'other' } },
    ]);
    runCongestionScenario({
      ...state,
      serviceItems: [
        { id: 'target', kind: 'drink', state: 'to_clean', x: 200, y: 100 },
        { id: 'other', kind: 'dish', state: 'to_clean', x: 300, y: 100 },
      ],
    }, current => current.staff.find(worker => worker.id === 'worker').x >= 160, { cooperative: true });
  });



  it('cook reserves a unique counter slot when assigning drink preparation', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'cook', morale: 80, x: 400, y: 300 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
        state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
      }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0,
    });
    expect(result.serviceItems[0]).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1',
    });
  });

  it('holds the cook still for five game-seconds before placing the drink', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0,
      assignedStaffId: 'w1', preparationStartedAt: 100,
    };
    const staff = [{
      id: 'w1', role: 'cook', morale: 80, x: 120, y: 120,
      task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
    }];
    const state = {
      ...baseState, staff, serviceItems: [item],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1', drinkId: 'water' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 104.999 },
    };

    const waiting = updateStaff(state, 0);
    const completed = updateStaff({
      ...waiting,
      restaurant: { ...waiting.restaurant, gameTime: 225 },
    }, 0);

    expect(waiting.staff[0]).toMatchObject({ x: 120, y: 120 });
    expect(waiting.serviceItems[0].state).toBe('preparing');
    expect(completed.serviceItems[0]).toMatchObject({ state: 'on_service', x: 150, y: 130 });
    expect(completed.staff[0].task).toBeNull();
  });

  it('starts preparation only for an exact drink reservation', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1',
    };
    const untouched = {
      id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
      state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'cook', morale: 80, x: 120, y: 120,
        task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 1 },
      }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water', tableId: 't2' },
      ],
      serviceItems: [item, untouched],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 50 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'prepare_drink', serviceItemId: 'i2' });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
    });
    expect(result.serviceItems[1]).toMatchObject({ id: 'i2', customerId: 'c2', state: 'ordered' });
  });

  it('starts a reserved drink on arrival while retaining its task', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'cook', morale: 80, x: 120, y: 120,
        task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
        state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1',
      }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({
      task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
    });
    expect(result.serviceItems[0]).toMatchObject({ state: 'preparing', preparationStartedAt: 100 });
  });

  it('does not reserve a second drink slot when three slots and one reservation are occupied', () => {
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'cook', morale: 80, x: 120, y: 120,
          task: { type: 'prepare_drink', serviceItemId: 'i4', serviceTableId: 'st1', serviceSlotIndex: 3 },
        },
        { id: 'w2', role: 'cook', morale: 80, x: 400, y: 300 },
      ],
      customers: [
        { id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water', tableId: 't2' },
      ],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [
        ...[0, 1, 2].map(index => ({
          id: `i${index + 1}`, kind: 'drink', menuItemId: 'water', customerId: `c${index + 1}`,
          tableId: `t${index + 1}`, state: 'on_service', serviceTableId: 'st1',
          serviceSlotIndex: index, assignedStaffId: null,
        })),
        {
          id: 'i4', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
          state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 3, assignedStaffId: 'w1',
        },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff.find(staff => staff.id === 'w2').task?.type).not.toBe('prepare_drink');
  });

  it('reserves a pending drink while another cook already owns a drink reservation', () => {
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'cook', morale: 80, x: 120, y: 120,
          task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
        },
        { id: 'w2', role: 'cook', morale: 80, x: 400, y: 300 },
      ],
      customers: [
        { id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water', tableId: 't2' },
      ],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [
        {
          id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
          state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1',
          preparationStartedAt: 100,
        },
        {
          id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
          state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
        },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[1].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'i2', serviceTableId: 'st1', serviceSlotIndex: 1,
    });
    expect(result.serviceItems[1]).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 1, assignedStaffId: 'w2',
    });
  });

  it('does not clear a valid drink reservation owned by another cook after a stale task', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w2',
      preparationStartedAt: 100,
    };
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'cook', morale: 80, x: 120, y: 120,
          task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
        },
        {
          id: 'w2', role: 'cook', morale: 80, x: 400, y: 300,
          navigationGoal: cellToWorld({ x: 7, y: 5 }),
          task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
        },
      ],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [item],
    };

    const result = updateStaff(state, 0);

    expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'preparing' });
    expect(result.staff[0].task).toBeNull();
  });

  it('does not pick up a service item after its recorded counter changes', () => {
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st2', serviceSlotIndex: 0, state: 'on_service', x: 410, y: 130,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 400, y: 120,
        task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' },
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      serviceItems: [item],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120, rotation: 1 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
    expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'on_service' });
  });

  it('restarts an unassigned preparing drink from zero after reservation cleanup', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'missing',
      preparationStartedAt: 10,
    };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'cook', morale: 80, x: 120, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [item],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0,
    });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0,
      assignedStaffId: 'w1', preparationStartedAt: null,
    });
  });

  it('starts the assigned front payment without stamping route state on the arriving customer', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 840, y: 100 };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [
        { id: 'c1', state: 'checkout_moving', paymentReady: true, cashierStationId: 'cashier1', x: 840, y: 180, checkoutPosition: { x: 840, y: 180 }, dishId: 'd1', tableId: 't1', patience: 100 },
        { id: 'c2', state: 'checkout_moving', paymentReady: false, cashierStationId: 'cashier1', x: 700, y: 160, dishId: 'd1', tableId: 't1', patience: 100 },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
    };

    const assigned = updateStaff(state, 0);
    expect(assigned.staff[0].task).toMatchObject({
      type: 'take_payment', customerId: 'c1', stationId: 'cashier1',
    });
    expect(assigned.staff[0].task.startedAt ?? null).toBeNull();
    expect(assigned.staff[0]).not.toHaveProperty('path');
    expect(assigned.staff[0].navigationGoal).toEqual(cellToWorld({ x: 42, y: 5 }));
    expect(assigned.customers[1].state).toBe('checkout_moving');

    const started = updateStaff(assigned, 0);
    expect(started.staff[0].task).toMatchObject({
      type: 'take_payment', customerId: 'c1', stationId: 'cashier1',
    });
    expect(started.staff[0].task.startedAt).not.toBeNull();
    expect(started.customers[0]).toMatchObject({
      state: 'checkout_processing', paymentReady: false,
    });
    for (const field of ['path', 'pathGoal', 'stalledFor', 'usingStaticFallback',
      'minimumSpacing', 'localConflictTarget', 'headOnRecovery',
      'recoveredHeadOnDetourTarget']) {
      expect(started.customers[0]).not.toHaveProperty(field);
    }
  });

  it('does not claim payment while another character occupies the cashier work point', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 840, y: 100 };
    const blocker = { id: 'w1', name: 'Anna', role: 'waiter', morale: 80, x: 840, y: 100 };
    const state = {
      ...baseState,
      staff: [cashier, blocker],
      customers: [{ id: 'c1', state: 'checkout_moving', paymentReady: false, cashierStationId: 'cashier1', x: 780, y: 140, dishId: 'd1', tableId: 't1', patience: 100 }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0].state).toBe('checkout_moving');
  });

  it('requeues checkout processing when its payment task references a missing station', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, totalServed: 4, reputation: 3 },
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'c1', stationId: 'missing', startedAt: 0 },
      }],
      customers: [{
        id: 'c1', state: 'checkout_processing', cashierStationId: 'missing', paymentReady: false,
        x: 840, y: 180, dishId: 'd1', tableId: 't1', happiness: 80,
      }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [],
    };

    const result = updateStaff(state, 60);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toMatchObject({
      state: 'checkout_queued', cashierStationId: null, paymentReady: false,
    });
    expect(result.completedCustomers).toEqual([]);
    expect(result.restaurant).toMatchObject({ totalServed: 4, reputation: 3 });
  });

  it('cashier completes payment and sends the customer towards an exit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const cashier = {
      id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 840, y: 100, task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 },
    };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'checkout_processing', paymentReady: false, cashierStationId: 'cashier1', x: 840, y: 180, checkoutPosition: { x: 840, y: 180 }, dishId: 'd1', tableId: 't1', patience: 100 }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      restaurant: { ...baseState.restaurant, gameTime: 60, totalServed: 3 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({
      state: 'leaving', departureReason: 'served', exitPhase: 'to_door', exitDoorId: null,
      exitFadeProgress: 0, exitHeading: null, checkoutPosition: null,
    });
    for (const field of ['path', 'pathGoal', 'stalledFor', 'usingStaticFallback',
      'minimumSpacing', 'localConflictTarget', 'headOnRecovery',
      'recoveredHeadOnDetourTarget']) {
      expect(result.customers[0]).not.toHaveProperty(field);
    }
    expect(result.completedCustomers[0]).toMatchObject({ revenue: 14.4, tip: 2.4 });
    expect(result.restaurant.totalServed).toBe(4);
    expect(result.staff[0].activityPhase).toBe('stationed');
  });

  it('happy payment increases reputation with configured gain effects', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const cashier = {
      id: 'cw1', role: 'waiter', morale: 80, x: 840, y: 100, task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 },
    };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'checkout_processing', paymentReady: false, cashierStationId: 'cashier1', x: 840, y: 180, happiness: 80, dishId: 'd1', tableId: 't1' }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      restaurant: { ...baseState.restaurant, gameTime: 60, reputation: 4.9 },
      upgrades: [{ level: 2, effects: { type: 'reputationGain', value: 0.01 } }],
    };

    const result = updateStaff(state, 0);

    expect(result.completedCustomers[0].reviewScore).toBe(100);
    expect(result.restaurant.reputation).toBeCloseTo(4.9204);
    expect(result.completedCustomers[0].tip).toBe(2.4);
  });

  it.each([0, 25, 100])(
    'records a fixed review and random tip for a tracked party payment at patience/happiness %s',
    value => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const state = partyPaymentState({
        customers: [{
          id: 'a', partyId: 'p1', state: 'checkout_processing', menuOutcome: 'ordered',
          cashierStationId: 'cashier1', paymentReady: false, x: 840, y: 180,
          happiness: value, patience: value, patienceMax: 100,
          queuePatience: value, queuePatienceMax: 100,
          dishId: 'toast', drinkId: null,
          dishPriceAtOrder: 12, drinkPriceAtOrder: null, orderSubtotal: 12,
          tableId: 't1',
        }],
        pendingPartyReviews: [{
          partyId: 'p1', memberIds: ['a'], orderedMemberIds: ['a'],
          unaffordableMemberIds: [], paidReviews: [],
        }],
      });

      const result = updateStaff(state, 0);

      expect(result.completedCustomers[0]).toMatchObject({
        reviewScore: 100, tip: 2.4, totalPaid: 14.4, revenue: 14.4,
      });
      expect(result.restaurant.reputation).toBeCloseTo(3.02);
    },
  );

  it.each([0, 25, 100])(
    'records a fixed review and random tip for an untracked payment at patience/happiness %s',
    value => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const state = partyPaymentState({
        customers: [{
          id: 'a', partyId: 'p1', state: 'checkout_processing',
          cashierStationId: 'cashier1', paymentReady: false, x: 840, y: 180,
          happiness: value, patience: value, patienceMax: 100,
          queuePatience: value, queuePatienceMax: 100,
          dishId: 'toast', drinkId: null, orderSubtotal: 12,
          tableId: 't1',
        }],
        pendingPartyReviews: [],
      });
      state.dishes = [{ id: 'toast', price: 12 }];

      const result = updateStaff(state, 0);

      expect(result.completedCustomers[0]).toMatchObject({
        reviewScore: 100, tip: 2.4, totalPaid: 14.4, revenue: 14.4,
      });
      expect(result.restaurant.reputation).toBeCloseTo(3.02);
    },
  );

  it('rounds a random tip to cents for a 12.35 subtotal', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const state = partyPaymentState({
      customers: [{
        id: 'a', partyId: 'p1', state: 'checkout_processing',
        cashierStationId: 'cashier1', paymentReady: false, x: 840, y: 180,
        happiness: 80, dishId: 'toast', drinkId: null, orderSubtotal: 12.35,
        tableId: 't1',
      }],
      pendingPartyReviews: [],
    });
    state.dishes = [{ id: 'toast', price: 12.35 }];

    const result = updateStaff(state, 0);

    expect(result.completedCustomers[0]).toMatchObject({ tip: 1.24, totalPaid: 13.59 });
  });

  it('does not start payment for a cashier away from the physical work point', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100, totalServed: 0 },
      staff: [{
        id: 'cw1', role: 'waiter', morale: 80, x: 100, y: 100,
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' },
      }],
      customers: [{
        id: 'c1', state: 'checkout_moving', paymentReady: true,
        cashierStationId: 'cashier1', x: 840, y: 180, checkoutPosition: { x: 840, y: 180 },
        dishId: 'd1', tableId: 't1', happiness: 80,
      }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
    };

    const result = resolveStaffAfterMovement(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toMatchObject({ state: 'checkout_queued', cashierStationId: null, paymentReady: false });
    expect(result.completedCustomers).toEqual([]);
    expect(result.restaurant.totalServed).toBe(0);
  });

  it('does not complete payment for a hydrated cashier away from the physical work point', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100, totalServed: 0 },
      staff: [{
        id: 'cw1', role: 'waiter', morale: 80, x: 100, y: 100,
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 },
      }],
      customers: [{
        id: 'c1', state: 'checkout_processing', paymentReady: false,
        cashierStationId: 'cashier1', x: 840, y: 180, checkoutPosition: { x: 840, y: 180 },
        dishId: 'd1', tableId: 't1', happiness: 80,
      }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
    };

    const result = resolveStaffAfterMovement(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toMatchObject({ state: 'checkout_queued', cashierStationId: null, paymentReady: false });
    expect(result.completedCustomers).toEqual([]);
    expect(result.restaurant.totalServed).toBe(0);
  });

  it('assigned cashier waiter stays at the station when no payment is waiting', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 300, y: 300 };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'seated', dishId: null, tableId: 't1', patience: 100 }],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      chairs: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      dishes: [{ id: 'd1', popularity: 50 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 42, y: 5 }));
    expect(result.staff[0].activityPhase).toBe('stationed');
  });

  it('clears the cashier goal after reaching the station without payment work', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 840, y: 100 }],
      customers: [{ id: 'c1', state: 'seated', dishId: null, tableId: 't1', patience: 100 }],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      chairs: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      dishes: [{ id: 'd1', popularity: 50 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.staff[0].activityPhase).toBe('stationed');
  });

  it('reduces morale slowly over time', () => {
    const staff = [{ id: 's1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200 }];
    const state = { ...baseState, staff };
    const result = updateStaff(state, 10);
    expect(result.staff[0].morale).toBeLessThan(80);
  });

  // --- New arrival-based tests (Task 4) ---




  it('keeps a party queued when every door has active egress', () => {
    const state = queuedAdmissionState();
    state.staff = [state.staff[0]];
    state.doors = [
      { id: 'door-near', y: 300, role: 'exit' },
      { id: 'door-alt', y: 420, role: 'exit' },
    ];
    state.customers = state.doors.map((door, index) => ({
      id: `out-${index}`, state: 'leaving', exitPhase: 'to_door', exitDoorId: door.id,
      x: 900, y: door.y + 20,
    }));

    const result = updateStaff(state, 0);

    expect(result.queue).toEqual(state.queue);
    expect(result.queueAdmissionGate).toBeNull();
    expect(result.customers).toEqual(expect.arrayContaining(state.customers.map(customer =>
      expect.objectContaining(customer))));
    expect(result.customers.some(customer => customer.id === 'q1')).toBe(false);
  });


  it('does not seat a waiting customer or fall back to the table centre when no chairs exist', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360, morale: 80 }],
      customers: [{
        id: 'c1', state: 'waiting', patience: 100, happiness: 80,
        tableId: null, chairId: null, x: 860, y: 360,
      }],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [],
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toMatchObject({
      id: 'c1', state: 'waiting', tableId: null, chairId: null, x: 860, y: 360,
    });
    expect(result.customers[0]).not.toMatchObject({ x: 200, y: 220 });
    expect(result.tables[0].status).toBe('empty');
  });



  it('starts lower-priority cleaning when no queued party has a suitable table', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360, morale: 80 }],
      queue: [{ partyId: 'queued-party', members: [
        { id: 'queued1', partyId: 'queued-party', partySize: 2, state: 'queued', patience: 100 },
        { id: 'queued2', partyId: 'queued-party', partySize: 2, state: 'queued', patience: 100 },
      ] }],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'clean_table', tableId: 't1' });
    expect(result.queue).toEqual(state.queue);
  });

  it('keeps an assigned cashier waiter out of general waiter work while idle', () => {
    const waiter = { id: 'w1', role: 'waiter', x: 300, y: 300, morale: 80 };
    const state = {
      ...baseState,
      staff: [waiter],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'w1' }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null }],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      dishes: [{ id: 'd1', popularity: 50 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 42, y: 5 }));
  });
























  it('holds a waiter at a ready dirty table for the canonical wipe duration', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220, task: { type: 'clean_table', tableId: 't1' } }],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const started = updateStaff(state, 0);
    expect(started.staff[0].task).toMatchObject({ cleaningStartedAt: 100 });
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 219.999 } }, 0).tables[0].status).toBe('dirty');
    const finished = updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 220 } }, 0);
    expect(finished.tables[0].status).toBe('empty');
    expect(finished.staff[0].task).toBeNull();
  });

  it('assigns an already-adjacent waiter one timed table wipe', () => {
    const approachBlockers = [
      [9, 10], [9, 12], [9, 13],
      [12, 10], [12, 11], [12, 12], [12, 13],
      [10, 10], [11, 10], [10, 13], [11, 13],
    ].map(([x, y], index) => ({
      id: `table-approach-block-${index}`, x: x * 20, y: y * 20,
    }));
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{
        id: 'w1', role: 'waiter', morale: 80,
        x: 180, y: 220, task: null,
      }],
      customers: [{ id: 'former', state: 'leaving', tableId: 't1' }],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      chairs: approachBlockers,
      serviceItems: [{
        id: 'off-table', state: 'to_clean', tableId: 't1', x: 500, y: 500,
      }],
    };

    const assigned = updateStaff(state, 0);
    expect(assigned.staff[0]).toMatchObject({
      navigationGoal: { x: 180, y: 220 }, task: { type: 'clean_table', tableId: 't1' },
    });

    const started = updateStaff(assigned, 0);
    expect(started.staff[0].task).toMatchObject({ cleaningStartedAt: 100 });
    expect(started.tables[0].status).toBe('dirty');

    const waiting = updateStaff({
      ...started,
      restaurant: { ...started.restaurant, gameTime: 192.307 },
    }, 0);
    expect(waiting.tables[0].status).toBe('dirty');

    const finished = updateStaff({
      ...started,
      restaurant: { ...started.restaurant, gameTime: 192.308 },
    }, 0);
    expect(finished.tables[0].status).toBe('empty');
    expect(finished.staff[0].task).toBeNull();
  });

  it('leaves an unreachable dirty table unclaimed', () => {
    const blockers = [
      [180, 180], [200, 180], [220, 180], [240, 180],
      [180, 200], [240, 200], [180, 220], [240, 220],
      [180, 240], [200, 240], [220, 240], [240, 240],
    ].map(([x, y], index) => ({ id: `block-${index}`, x, y }));
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80,
        x: 400, y: 300, task: null,
      }],
      chairs: blockers,
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0].status).toBe('dirty');
  });

  it('does not start cleaning while a checkout diner is still physically on a chair', () => {
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 400, y: 300, task: null }],
      tables: [{
        id: 't1', seats: 2, status: 'dirty', x: 200, y: 200,
        diningPartyId: 'p1', diningCustomerIds: ['payer'],
      }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      customers: [{
        id: 'payer', partyId: 'p1', state: 'checkout_moving', tableId: 't1',
        chairId: 'ch1', x: 220, y: 190,
      }],
    }, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0].status).toBe('dirty');
  });

  it('clears every dining field when cleaning completes on a physically vacated table', () => {
    const result = updateStaff({
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'clean_table', tableId: 't1', cleaningStartedAt: 100 },
      }],
      tables: [{
        id: 't1', seats: 2, status: 'dirty', x: 200, y: 200,
        diningPartyId: 'p1', diningCustomerIds: ['payer'],
        seatingAssignments: [], reservationOwnerStaffId: 'guide',
      }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      customers: [],
      restaurant: { ...baseState.restaurant, gameTime: 10000 },
    }, 0);

    expect(result.tables[0]).toEqual({ id: 't1', seats: 2, status: 'empty', x: 200, y: 200 });
  });

  it('cancels active table cleaning when a customer blocks the table', () => {
    const active = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220,
        task: { type: 'clean_table', tableId: 't1', cleaningStartedAt: 100 } }],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 150 },
    };

    const result = updateStaff({
      ...active,
      customers: [{ id: 'c1', tableId: 't1', state: 'eating' }],
    }, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0]).not.toHaveProperty('path');
    expect(result.tables[0].status).toBe('dirty');
  });

  it('cancels cleaning safely when the target table is no longer dirty', () => {
    const tables = [
      { id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 },
      { id: 't2', seats: 2, status: 'dirty', x: 360, y: 220 },
    ];
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 180, y: 220,
        task: { type: 'clean_table', tableId: 't1', cleaningStartedAt: 100 },
      }],
      tables,
      restaurant: { ...baseState.restaurant, gameTime: 102 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables).toEqual(tables);
  });

  it('allows only one idle waiter to claim a dirty table in one tick', () => {
    const state = {
      ...baseState,
      staff: [
        { id: 'w1', role: 'waiter', morale: 80, x: 800, y: 500 },
        { id: 'w2', role: 'waiter', morale: 80, x: 700, y: 500 },
      ],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff.filter(staff => staff.task?.type === 'clean_table'))
      .toHaveLength(1);
  });

  it('assigns floor dirt only to a janitor', () => {
    const state = {
      ...baseState,
      floorDirt: [{ id: 'dirt-1', x: 200, y: 200 }],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, task: null }],
    };
    expect(updateStaff(state, 0).staff[0].task)
      .toMatchObject({ type: 'clean_floor', dirtId: 'dirt-1' });
  });

  it('starts and completes floor wiping after the canonical duration', () => {
    const state = {
      ...baseState,
      floorDirt: [{ id: 'dirt-1', x: 200, y: 200 }],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 200, y: 180, task: { type: 'clean_floor', dirtId: 'dirt-1' } }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const started = updateStaff(state, 0);
    expect(started.staff[0].task).toMatchObject({ type: 'clean_floor', cleaningStartedAt: 100 });
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 192.307 } }, 0).floorDirt)
      .toHaveLength(1);
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 192.308 } }, 0).floorDirt)
      .toHaveLength(0);
  });

  it('prevents two janitors from claiming the same dirt item', () => {
    const state = {
      ...baseState,
      floorDirt: [{ id: 'dirt-1', x: 200, y: 200 }],
      staff: [
        { id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, task: null },
        { id: 'j2', role: 'janitor', morale: 80, x: 220, y: 180, task: null },
      ],
    };
    expect(updateStaff(state, 0).staff.filter(staff => staff.task?.dirtId === 'dirt-1')).toHaveLength(1);
  });

  it('selects the nearest reachable dirt item', () => {
    const state = {
      ...baseState,
      floorDirt: [
        { id: 'dirt-near', x: 200, y: 200 },
        { id: 'dirt-far', x: 400, y: 200 },
      ],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, task: null }],
    };
    expect(updateStaff(state, 0).staff[0].task).toMatchObject({ type: 'clean_floor', dirtId: 'dirt-near' });
  });

  it('does not give floor-cleaning work to waiters', () => {
    const state = {
      ...baseState,
      floorDirt: [{ id: 'dirt-1', x: 200, y: 200 }],
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, task: null }],
    };
    expect(updateStaff(state, 0).staff[0].task?.type).not.toBe('clean_floor');
  });

  it('clears a floor-cleaning task safely when its dirt disappears', () => {
    const state = {
      ...baseState,
      floorDirt: [],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 200, y: 180, task: { type: 'clean_floor', dirtId: 'dirt-1' } }],
    };
    expect(updateStaff(state, 0).staff[0]).toMatchObject({ task: null });
  });

  it('does not claim a dirty table already targeted by an active cleaning task', () => {
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, x: 800, y: 500, task: { type: 'clean_table', tableId: 't1' },
        },
        { id: 'w2', role: 'waiter', morale: 80, x: 700, y: 500 },
      ],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff.filter(staff => staff.task?.type === 'clean_table'))
      .toHaveLength(1);
    expect(result.staff.find(staff => staff.id === 'w2').task).toBeNull();
  });

  it('waiter does not complete order until arrival', () => {
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, drinkId: null, tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('take_order');
    // Not completed yet - waiter hasn't arrived
    expect(result.customers[0].state).toBe('seated');
    expect(result.customers[0].dishId).toBe(null);
  });

  it('times an arrived order before creating service items', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{ id: 'w1', role: 'waiter', x: 220, y: 220, task: { type: 'take_order', customerId: 'c1' } }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null, drinkId: null }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      dishes: [{ id: 'd1', price: 10, popularity: 50 }],
    };
    const started = updateStaff(state, 0);
    expect(started.staff[0].task.startedAt).toBe(100);
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 159 } }, 0).customers[0].dishId).toBeNull();
    const completed = updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 160 } }, 0);
    expect(completed.customers[0].state).toBe('waiting_for_items');
    expect(completed.staff[0]).toMatchObject({ activityPhase: 'idle_waiting' });
    expect(completed.staff[0].idleUntil).toBeGreaterThanOrEqual(340);
    expect(completed.staff[0].idleUntil).toBeLessThanOrEqual(520);
  });

  it('times payment only after both actors are positioned', () => {
    const station = { id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'w1' };
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 0 },
      cashierStations: [station], dishes: [{ id: 'd1', price: 10 }],
      staff: [{ id: 'w1', role: 'waiter', x: 840, y: 100, task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' } }],
      customers: [{ id: 'c1', state: 'checkout_moving', paymentReady: true, cashierStationId: 'cashier1', x: 800, y: 140, dishId: 'd1', tableId: 't1' }] };
    const started = updateStaff({ ...state, customers: [{ ...state.customers[0], x: 840, y: 180 }] }, 0);
    expect(started.staff[0].task.startedAt).toBe(0);
    expect(started.staff[0].activityPhase).toBe('working');
    expect(started.customers[0]).toMatchObject({ state: 'checkout_processing', paymentReady: false });
    const displaced = updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 20 }, customers: [{ ...started.customers[0], x: 800, y: 140 }] }, 0);
    expect(displaced.staff[0].task).toBeNull();
    expect(displaced.customers[0].state).toBe('checkout_queued');
    expect(displaced.completedCustomers).toEqual([]);
    const rerouted = updateCustomers({
      ...displaced,
      restaurant: { ...displaced.restaurant, gameTime: 20 },
      customers: [{ ...displaced.customers[0], x: 840, y: 180 }],
    }, 0);
    const reassigned = updateStaff(rerouted, 0);
    expect(reassigned.staff[0].task).toMatchObject({ type: 'take_payment', customerId: 'c1' });
    const restarted = updateStaff(reassigned, 0);
    expect(restarted.staff[0].task.startedAt).toBe(20);
    expect(updateStaff({ ...restarted, restaurant: { ...restarted.restaurant, gameTime: 79 } }, 0).customers[0].state).toBe('checkout_processing');
    expect(updateStaff({ ...restarted, restaurant: { ...restarted.restaurant, gameTime: 80 } }, 0).customers[0].state).toBe('leaving');
  });

  it.each([
    [0.5, ['dish'], 'd1', null],
    [0.8, ['dish', 'drink'], 'd1', 'water'],
    [0.97, ['drink'], null, 'water'],
  ])('creates customer-owned service items for roll %s', (roll, kinds, dishId, drinkId) => {
    vi.spyOn(Math, 'random').mockReturnValue(roll);
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, task: { type: 'take_order', customerId: 'c1', startedAt: 0 } }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null, drinkId: null }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      dishes: [{ id: 'd1', popularity: 50, quality: 1, price: 12 }],
      unlockedDrinkIds: ['water'],
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({ state: 'waiting_for_items', dishId, drinkId });
    expect(result.serviceItems.map(item => item.kind)).toEqual(kinds);
    expect(result.serviceItems.every(item => item.customerId === 'c1')).toBe(true);
  });

  it('takes an order when only a canonical unlocked drink is available', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 800, y: 500 }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null, drinkId: null }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 220 }],
      unlockedDrinkIds: ['water'],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'take_order', customerId: 'c1' });
  });

  // --- Adapted existing tests ---

  it('waiter beginning take_order task (was: seats waiting customer)', () => {
    // With arrival-based tasks, waiters no longer seat customers.
    // A waiter sees a seated customer without dishId and starts a take_order task.
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, drinkId: null, tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes,
    };
    const result = updateStaff(state, 2);
    // Waiter starts take_order task but doesn't complete (distance)
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('take_order');
    expect(result.customers[0].state).toBe('seated');
    expect(result.customers[0].dishId).toBe(null);
  });

  // --- Unified service-item pickup ---

  it('waiter starts picking up a ready service item from its recorded service table', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1',
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 0, x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter], customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      serviceItems: [item], serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };
    const result = updateStaff(state, 2);

    expect(result.staff[0].task).toMatchObject({ type: 'pickup_service_item', serviceItemId: 'i1' });
    expect(result.serviceItems[0].state).toBe('on_service');
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 13, y: 8 }));
  });

  it("waiter paths to the ready item's recorded service counter", () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 700, y: 500 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
        serviceTableId: 'st2', serviceSlotIndex: 0, state: 'on_service', x: 410, y: 130,
      }],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120, rotation: 1 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'pickup_service_item', serviceItemId: 'i1' });
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 22, y: 12 }));
  });

  it.each(['dish', 'drink'])('picks up and carries one on-service %s', kind => {
    const item = {
      id: 'i1', kind, menuItemId: kind === 'dish' ? 'd1' : 'water',
      customerId: 'c1', tableId: 't1', serviceTableId: 'st1', serviceSlotIndex: 0,
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120, task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' } }],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
      serviceItems: [item],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.serviceItems[0].state).toBe('carried');
    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: ['i1'] });
  });

  it('batches eligible items at one service table and delivers each item to its own customer', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', skill: 5, morale: 80, x: 120, y: 120,
        task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' },
        carryingServiceItemIds: [],
      }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't2' },
        { id: 'c3', state: 'waiting_for_items', dishId: 'd1', tableId: 't3' },
        { id: 'departed', state: 'leaving', dishId: 'd1', tableId: 't4' },
        { id: 'other-table', state: 'waiting_for_items', dishId: 'd1', tableId: 't5' },
      ],
      tables: [
        { id: 't1', status: 'occupied', x: 200, y: 200 },
        { id: 't2', status: 'occupied', x: 360, y: 200 },
        { id: 't3', status: 'occupied', x: 520, y: 200 },
        { id: 't4', status: 'occupied', x: 680, y: 200 },
        { id: 't5', status: 'occupied', x: 200, y: 360 },
      ],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }, { id: 'st2', x: 140, y: 320 }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service' },
        { id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2', serviceTableId: 'st1', serviceSlotIndex: 1, state: 'on_service' },
        { id: 'i3', kind: 'dish', menuItemId: 'd1', customerId: 'c3', tableId: 't3', serviceTableId: 'st1', serviceSlotIndex: 2, state: 'on_service' },
        { id: 'i4', kind: 'dish', menuItemId: 'd1', customerId: 'departed', tableId: 't4', serviceTableId: 'st1', serviceSlotIndex: 3, state: 'on_service' },
        { id: 'i5', kind: 'dish', menuItemId: 'd1', customerId: 'other-table', tableId: 't5', serviceTableId: 'st2', serviceSlotIndex: 0, state: 'on_service' },
      ],
    };

    const picked = updateStaff(state, 0);
    expect(picked.staff[0]).toMatchObject({
      task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' },
      carryingServiceItemIds: ['i1', 'i2'],
    });
      expect(picked.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'i1', state: 'carried' }),
      expect.objectContaining({ id: 'i2', state: 'carried' }),
      expect.objectContaining({ id: 'i3', state: 'on_service' }),
      expect.objectContaining({ id: 'i4', state: 'to_clean' }),
      expect.objectContaining({ id: 'i5', state: 'on_service' }),
    ]));

    const firstDelivered = resolveStaffAfterMovement(
      picked,
      0,
      new Map([['w1', { plan: 'arrived', motion: 'holding' }]]),
    );
    expect(firstDelivered.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'i1', state: 'delivered' }),
      expect.objectContaining({ id: 'i2', state: 'carried' }),
    ]));
    expect(firstDelivered.staff[0]).toMatchObject({
      task: { type: 'deliver_service_item', serviceItemId: 'i2', customerId: 'c2' },
      carryingServiceItemIds: ['i2'],
    });

    const secondDelivered = resolveStaffAfterMovement(
      firstDelivered,
      0,
      new Map([['w1', { plan: 'arrived', motion: 'holding' }]]),
    );
    expect(secondDelivered.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'i1', state: 'delivered' }),
      expect.objectContaining({ id: 'i2', state: 'delivered' }),
      expect.objectContaining({ id: 'i3', state: 'on_service' }),
      expect.objectContaining({ id: 'i4', state: 'to_clean' }),
      expect.objectContaining({ id: 'i5', state: 'on_service' }),
    ]));
    expect(secondDelivered.staff[0].carryingServiceItemIds).toEqual([]);
  });

  it('retains an undeposited dirty load when a station has only partial capacity', () => {
    const queued = Array.from({ length: 7 }, (_, index) => ({
      id: `queued-${index}`, state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: index,
    }));
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', skill: 5, morale: 80, x: 180, y: 220,
        task: { type: 'collect_dirty_item', serviceItemId: 'dirty-1', tableId: 't1' },
        carryingServiceItemIds: [],
      }],
      customers: [
        { id: 'gone-1', state: 'leaving', tableId: 't1' },
        { id: 'gone-2', state: 'leaving', tableId: 't1' },
      ],
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [
        ...queued,
        { id: 'dirty-1', kind: 'dish', customerId: 'gone-1', tableId: 't1', state: 'dirty_at_table', dirtyAt: 1 },
        { id: 'dirty-2', kind: 'drink', menuItemId: 'water', customerId: 'gone-2', tableId: 't1', state: 'dirty_at_table', dirtyAt: 2 },
      ],
    };

    const collected = resolveStaffAfterMovement(
      state,
      0,
      new Map([['w1', { plan: 'arrived', motion: 'holding' }]]),
    );
    expect(collected.staff[0]).toMatchObject({
      task: { type: 'deliver_dirty_item', serviceItemId: 'dirty-1', washStationId: 'sink' },
      carryingServiceItemIds: ['dirty-1', 'dirty-2'],
    });

    const partiallyDeposited = resolveStaffAfterMovement(
      collected,
      0,
      new Map([['w1', { plan: 'arrived', motion: 'holding' }]]),
    );
    expect(partiallyDeposited.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dirty-1', state: 'queued_for_wash', washStationId: 'sink' }),
      expect.objectContaining({ id: 'dirty-2', state: 'carried_dirty' }),
    ]));
    expect(partiallyDeposited.staff[0].carryingServiceItemIds).toEqual(['dirty-2']);

    const reopened = updateStaff({
      ...partiallyDeposited,
      serviceItems: partiallyDeposited.serviceItems.filter(item => item.id !== 'queued-0'),
    }, 0);
    expect(reopened.staff[0].task).toMatchObject({
      type: 'deliver_dirty_item', serviceItemId: 'dirty-2', washStationId: 'sink',
    });
  });

  it('clears a missing dirty-delivery task and reroutes another worker retained load', () => {
    let state = {
      ...baseState,
      staff: [
        {
          id: 'stale', role: 'waiter', skill: 5, x: 500, y: 300,
          task: { type: 'deliver_dirty_item', serviceItemId: 'missing', washStationId: 'sink' },
          carryingServiceItemIds: [],
        },
        {
          id: 'carrier', role: 'waiter', skill: 5, x: 500, y: 300,
          task: null, carryingServiceItemIds: ['real'],
        },
      ],
      customers: [{ id: 'gone', state: 'leaving', tableId: 't1' }],
      tables: [],
      washStations: [{ id: 'sink', type: 'manual', x: 300, y: 120, w: 40, h: 40 }],
      serviceItems: [
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `queued-${index}`, state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: index,
        })),
        { id: 'real', kind: 'dish', customerId: 'gone', tableId: 't1', state: 'carried_dirty' },
      ],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    for (let tick = 0; tick < 10; tick += 1) {
      state = updateStaff(state, { gameDt: 0, movementDt: 1 });
    }

    expect(state.staff.find(worker => worker.id === 'stale').task).toBeNull();
    expect(state.staff.find(worker => worker.id === 'carrier')).toMatchObject({
      task: { type: 'deliver_dirty_item', serviceItemId: 'real', washStationId: 'sink' },
      carryingServiceItemIds: ['real'],
    });
    expect(state.serviceItems.find(item => item.id === 'real').state)
      .toBe('carried_dirty');
  });

  it('does not claim a service item that another waiter has already carried', () => {
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', serviceTableId: 'st1', serviceSlotIndex: 0, state: 'carried' };
    const state = {
      ...baseState,
      staff: [
         { id: 'w1', role: 'waiter', x: 120, y: 120, task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' } },
         { id: 'w2', role: 'waiter', carryingServiceItemId: 'i1' },
       ],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [item], serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
     expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'carried' });
  });

  it('clears stale carrier metadata before a valid pickup', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 300, y: 300,
    };
    const state = {
      ...baseState,
      staff: [
        { id: 'w1', role: 'waiter', x: 120, y: 120, task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' } },
         { id: 'w2', role: 'waiter', x: 300, y: 300, carryingServiceItemId: 'missing' },
      ],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
      serviceItems: [item], serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: ['i1'] });
    expect(result.staff[1].carryingServiceItemIds).toEqual([]);
     expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'carried' });
  });

  it('does not claim a second service item while already carrying another item', () => {
    const readyItem = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130,
    };
    const carriedItem = {
      id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
      serviceTableId: 'st1', serviceSlotIndex: 1, state: 'carried', x: 120, y: 120,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 120, y: 120,
        task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' }, carryingServiceItemId: 'i2',
      }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', tableId: 't2' },
      ],
      tables: [
        { id: 't1', status: 'occupied', x: 200, y: 200 },
        { id: 't2', status: 'occupied', x: 360, y: 200 },
      ],
      serviceItems: [readyItem, carriedItem],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: ['i2'] });
    expect(result.serviceItems).toEqual([readyItem, carriedItem]);
  });

  it('does not claim an item from a missing service counter', () => {
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', serviceTableId: 'missing', serviceSlotIndex: 0, state: 'on_service' };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 120, y: 120, task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' } }],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
      serviceItems: [item],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
    expect(result.serviceItems[0]).toEqual(item);
  });

  // --- Unified service-item delivery ---

  it('waiter carrying a service item paths to its customer table for delivery', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 120, y: 120, carryingServiceItemId: 'i1',
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1',
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter], customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      serviceItems: [item],
    };
    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toMatchObject({ type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' });
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 9, y: 9 }));
  });

  it('keeps carried service-item coordinates synchronised with its moving waiter', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 120, y: 120,
        navigationGoal: cellToWorld({ x: 10, y: 10 }),
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 300, y: 300 }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried', x: 150, y: 130 }],
    };

    const result = updateStaff(state, 0.5);

    expect(result.staff[0]).toMatchObject({ carryingServiceItemIds: ['i1'] });
    expect(result.serviceItems[0]).toMatchObject({ state: 'carried', x: result.staff[0].x, y: result.staff[0].y });
  });

  it.each([
    ['dish', 'd1', { x: 208, y: 208 }],
    ['drink', 'water', { x: 224, y: 208 }],
  ])('delivers a %s at its kind-specific table position', (kind, menuItemId, position) => {
    const item = {
      id: 'i1', kind, menuItemId, customerId: 'c1', tableId: 't1',
      state: 'carried', x: 150, y: 130,
    };
    const customer = {
      id: 'c1', state: 'waiting_for_items', dishId: kind === 'dish' ? 'd1' : null,
      drinkId: kind === 'drink' ? 'water' : null, tableId: 't1', happiness: 80,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        navigationGoal: { x: 180, y: 220 },
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [customer],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [item],
    };

    const result = updateStaff(state, 0);

    expect(result.serviceItems[0]).toMatchObject({ state: 'delivered', ...position });
    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.customers[0]).toMatchObject({ state: 'eating', eatTime: 100 });
  });

  it('adds dish quality, upgrade, and equipment quality only for a dish delivery', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', happiness: 50, dishId: 'd1', drinkId: null, tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' }],
      dishes: [{ id: 'd1', quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1.3, qualityBonus: 0.15 }],
      upgrades: [{ level: 2, effects: { type: 'qualityBonus', value: 0.05 } }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({ state: 'eating', happiness: 83 });
  });

  it('does not add a dish-quality bonus to a drink delivery', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', happiness: 50, dishId: null, drinkId: 'water', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{ id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1', state: 'carried' }],
      dishes: [{ id: 'd1', quality: 10, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, qualityBonus: 0.5 }],
      upgrades: [{ level: 2, effects: { type: 'qualityBonus', value: 0.5 } }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({ state: 'eating', happiness: 50 });
  });

  it('caps dish-delivery happiness at 100', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', happiness: 95, dishId: 'd1', drinkId: null, tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' }],
      dishes: [{ id: 'd1', quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, qualityBonus: 0 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0].happiness).toBe(100);
  });

  it('starts independent consumption timers after the final ordered item is delivered', () => {
    const deliver = (customer, serviceItems) => updateStaff({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_service_item', serviceItemId: serviceItems.find(item => item.state === 'carried').id, customerId: customer.id },
        carryingServiceItemId: serviceItems.find(item => item.state === 'carried').id,
      }],
      customers: [customer],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems,
    }, 0);

    const result = deliver(
      { id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: 'water', tableId: 't1' },
      [
        { id: 'dish-item', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'delivered' },
        { id: 'drink-item', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1', state: 'carried' },
      ],
    );

    expect(result.customers[0]).toMatchObject({
      state: 'eating',
      orderedServiceItemIds: ['dish-item', 'drink-item'],
      consumedServiceItemIds: [],
    });
    expect(result.customers[0]).not.toHaveProperty('consumptionDuration');
    expect(result.serviceItems
      .filter(item => item.customerId === 'c1')
      .map(item => item.consumptionStartedAt)).toEqual([100, 100]);
  });

  it('cancels a stale take_order task when the customer is no longer seated', () => {
    const customer = { id: 'c1', state: 'checkout_queued', dishId: 'd1', drinkId: null, tableId: 't1', happiness: 80 };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'take_order', customerId: 'c1' },
      }],
      customers: [customer],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      dishes: [{ id: 'd2', popularity: 100, quality: 10, price: 1 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toEqual(customer);
  });

  it('cancels a stale take_payment task without creating revenue', () => {
    const customer = { id: 'c1', state: 'eating', dishId: 'd1', drinkId: null, tableId: 't1', happiness: 80 };
    const state = {
      ...baseState,
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100,
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 },
      }],
      customers: [customer], dishes: [{ id: 'd1', price: 12 }], completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
      restaurant: { ...baseState.restaurant, totalServed: 4 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toEqual(customer);
    expect(result.completedCustomers).toEqual([]);
    expect(result.restaurant.totalServed).toBe(4);
  });

  it('cancels delivery when the target customer is leaving', () => {
    const customer = { id: 'c1', state: 'leaving', happiness: 40, dishId: 'd1', drinkId: null, tableId: 't1' };
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [customer], serviceItems: [item],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
    expect(result.customers[0]).toEqual(customer);
    expect(result.serviceItems[0]).toEqual({ ...item, state: 'to_clean' });
  });

  it('cancels delivery when the task service item is not carried', () => {
    const customer = { id: 'c1', state: 'waiting_for_items', happiness: 80, dishId: 'd1', drinkId: null, tableId: 't1' };
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'on_service' };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [customer], serviceItems: [item],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
    expect(result.customers[0]).toEqual(customer);
    expect(result.serviceItems[0]).toEqual(item);
  });

  it('does not release a stale task service item carried by another worker', () => {
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 400, y: 400,
    };
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
          navigationGoal: { x: 180, y: 220 },
          task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'missing' }, carryingServiceItemId: null,
        },
        {
          id: 'w2', role: 'waiter', morale: 80, x: 400, y: 400,
          navigationGoal: cellToWorld({ x: 10, y: 10 }),
          task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
        },
      ],
      customers: [{ id: 'c1', state: 'waiting_for_items', happiness: 80, dishId: 'd1', tableId: 't1' }],
      serviceItems: [item], tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.staff[1]).toMatchObject({ carryingServiceItemIds: ['i1'] });
    expect(result.serviceItems[0]).toEqual(item);
  });

  it('preserves the current worker unrelated carrier when cancelling stale delivery', () => {
    const taskItem = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'on_service' };
    const ownItem = {
      id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
      state: 'carried', x: 180, y: 220,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i2',
      }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', happiness: 80, dishId: 'd1', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', happiness: 80, drinkId: 'water', tableId: 't2' },
      ],
      serviceItems: [taskItem, ownItem],
      tables: [
        { id: 't1', status: 'occupied', x: 200, y: 200 },
        { id: 't2', status: 'occupied', x: 360, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({
      task: { type: 'deliver_service_item', serviceItemId: 'i2', customerId: 'c2' },
      carryingServiceItemIds: ['i2'],
    });
    expect(result.serviceItems).toEqual([taskItem, ownItem]);
  });

  // --- Unified service-item cleanup ---

  it('waiter cleans a to_clean service item on arrival', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 220, y: 220, task: { type: 'clean_service_item', serviceItemId: 'i1' },
    };
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const result = updateStaff({ ...baseState, staff: [waiter], serviceItems: [item] }, 2);
    expect(result.serviceItems).toEqual([]);
    expect(result.staff[0].task).toBeNull();
  });

  it('waiter starts cleaning a to_clean service item', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const result = updateStaff({ ...baseState, staff: [waiter], serviceItems: [item] }, 2);
    expect(result.staff[0].task).toMatchObject({ type: 'clean_service_item', serviceItemId: 'i1' });
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 11, y: 11 }));
  });

  it('waiter also cleans a to_clean service item after table work', () => {
    const waiter = { id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const result = updateStaff({ ...baseState, staff: [waiter], serviceItems: [item] }, 2);
    expect(result.staff[0].task).toMatchObject({ type: 'clean_service_item', serviceItemId: 'i1' });
  });

  // --- Dish preparation ---

  it('cook paths to a compatible station for the oldest ordered dish item', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200, x: 500, y: 600 };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'ordered' },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ordered' },
      ],
      customers: [{ id: 'c1', dishId: 'd1' }, { id: 'c2', dishId: 'd1' }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1',
      batchId: expect.any(String), serviceItemIds: ['i1', 'i2'],
    });
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 3, y: 5 }));
  });

  it('cook selects the oldest eligible food or drink preparation', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'cook', role: 'cook', morale: 80, x: 500, y: 600 }],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      customers: [
        { id: 'food-customer', state: 'waiting_for_items', dishId: 'd1', orderTime: 20 },
        { id: 'drink-customer', state: 'waiting_for_items', drinkId: 'water', orderTime: 10 },
      ],
      serviceItems: [
        { id: 'food', kind: 'dish', menuItemId: 'd1', customerId: 'food-customer', state: 'ordered' },
        { id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'drink-customer', state: 'ordered' },
      ],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'drink', serviceTableId: 'st1', serviceSlotIndex: 0,
    });
    expect(result.serviceItems.find(item => item.id === 'food')).toMatchObject({
      state: 'ordered',
    });
  });

  it('cook starts only the exact owned dish item upon arrival at its station', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 90, y: 70 };
    const cook = {
      id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200,
      x: station.x, y: station.y,
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
    };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [station],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'ordered' },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ordered' },
      ],
      customers: [{ id: 'c1', dishId: 'd1' }, { id: 'c2', dishId: 'd1' }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toEqual({
      type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1',
    });
    expect(result.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'i1', state: 'preparing', stationId: 'k1', assignedStaffId: 'c1',
        preparationStartedAt: 100, x: 110, y: 90,
      }),
      expect.objectContaining({ id: 'i2', customerId: 'c2', state: 'ordered' }),
    ]));
  });

  it('cook picks up their finished dish and paths to a reserved service-counter slot', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 160 },
      staff: [{
        id: 'cook1', role: 'cook', morale: 80, x: 80, y: 140,
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      }],
      customers: [{ id: 'customer', state: 'waiting_for_items', dishId: 'd1' }],
      kitchenStations: [station],
      serviceTables: [{ id: 'st1', x: 300, y: 120 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'customer',
        state: 'ready', stationId: 'k1', assignedStaffId: 'cook1', readyAt: 160,
        serviceTableId: null, serviceSlotIndex: null, x: 120, y: 140,
      }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({
      task: {
        type: 'place_dish_on_service', serviceItemId: 'i1',
        serviceTableId: 'st1', serviceSlotIndex: 0,
      },
      carryingServiceItemIds: ['i1'],
    });
    expect(result.staff[0].navigationGoal).toEqual(cellToWorld({ x: 14, y: 7 }));
    expect(result.serviceItems[0]).toMatchObject({
      state: 'carried', assignedStaffId: 'cook1',
      serviceTableId: 'st1', serviceSlotIndex: 0,
    });
  });

  it('batches ready dishes for a cook without calling a shadowed ownership flag', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'cook', role: 'cook', skill: 10, x: 80, y: 140,
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
        carryingServiceItemIds: [],
      }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'd1' },
        { id: 'c2', state: 'waiting_for_items', dishId: 'd1' },
      ],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1', prepTime: 60 }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceTables: [{ id: 'st1', x: 300, y: 120 }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'ready', stationId: 'k1', assignedStaffId: 'cook', readyAt: 1 },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ready', stationId: 'k1', assignedStaffId: 'cook', readyAt: 2 },
      ],
    };

    let result;
    expect(() => { result = updateStaff(state, 0); }).not.toThrow();
    expect(result.staff[0].carryingServiceItemIds).toEqual(['i1', 'i2']);
    expect(result.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'i1', state: 'carried', serviceSlotIndex: 0 }),
      expect.objectContaining({ id: 'i2', state: 'carried', serviceSlotIndex: 1 }),
    ]));
  });

  it('clears an already-reached goal when preparing a dish transitions into service placement', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 160 },
      staff: [{
        id: 'cook1', role: 'cook', morale: 80, x: 180, y: 220,
        navigationGoal: { x: 180, y: 220 },
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      }],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 200, y: 200 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 240 }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'ready',
        stationId: 'k1', assignedStaffId: 'cook1', readyAt: 160,
        serviceTableId: null, serviceSlotIndex: null,
      }],
    };

    const result = resolveStaffAfterMovement(state, 0);

    expect(result.staff[0]).toMatchObject({
      task: {
        type: 'place_dish_on_service', serviceItemId: 'i1',
        serviceTableId: 'st1', serviceSlotIndex: 0,
      },
      activityPhase: 'working',
      carryingServiceItemIds: ['i1'],
    });
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.serviceItems[0]).toMatchObject({ state: 'carried', assignedStaffId: 'cook1' });
  });

  it('cook places the carried dish onto the service counter for waiter pickup', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'cook1', role: 'cook', morale: 80, x: 300, y: 160,
        task: {
          type: 'place_dish_on_service', serviceItemId: 'i1',
          serviceTableId: 'st1', serviceSlotIndex: 0,
        },
        carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'customer', state: 'waiting_for_items', dishId: 'd1' }],
      serviceTables: [{ id: 'st1', x: 300, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'customer',
        state: 'carried', assignedStaffId: 'cook1',
        serviceTableId: 'st1', serviceSlotIndex: 0, x: 300, y: 160,
      }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'on_service', assignedStaffId: null,
      serviceTableId: 'st1', serviceSlotIndex: 0, x: 310, y: 130,
    });
  });

  it('clears a stale prepare-dish task without touching another item', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 90, y: 70 };
    const item = { id: 'i2', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ordered' };
    const cook = {
      id: 'c1', role: 'cook', morale: 80, x: station.x, y: station.y,
      task: { type: 'prepare_dish', serviceItemId: 'missing', stationId: 'k1' },
    };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [station],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
       serviceItems: [item], customers: [{ id: 'c2', dishId: 'd1' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems).toEqual([item]);
  });

  it('does not assign a dish whose required equipment is unowned', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'c1', role: 'cook', morale: 80, x: 500, y: 600 }],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: false }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', state: 'ordered' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
  });

  it('clears an arrival task if the required equipment became unavailable', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 90, y: 70 };
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ordered' };
    const state = {
      ...baseState,
      staff: [{
        id: 'c1', role: 'cook', morale: 80, x: station.x, y: station.y,
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      }],
      kitchenStations: [station],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: false }],
      serviceItems: [item], customers: [{ id: 'c2', dishId: 'd1' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems).toEqual([item]);
  });

  it('cook does not move if no ordered dish item is pending', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200, x: 500, y: 600 };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', state: 'preparing' }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
  });

  it('does not reuse a station while another dish is preparing there', () => {
    const state = {
      ...baseState,
      staff: [
        { id: 'c1', role: 'cook', morale: 80, x: 500, y: 600 },
        { id: 'c2', role: 'cook', morale: 80, x: 700, y: 600 },
      ],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [
        {
          id: 'i1', kind: 'dish', menuItemId: 'd1', state: 'preparing',
          stationId: 'k1', assignedStaffId: 'c1', preparationStartedAt: 0,
        },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', state: 'ordered' },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff.every(candidate => candidate.task == null)).toBe(true);
  });

  // --- Unified service-item priority and duplicate prevention ---

  it('prioritises on-service pickup over ordered-drink preparation and taking new orders', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't2' },
        { id: 'c3', state: 'seated', dishId: null, drinkId: null, tableId: 't3' },
      ],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'occupied', x: 360, y: 200 },
        { id: 't3', seats: 2, status: 'occupied', x: 200, y: 360 },
      ],
      dishes: [{ id: 'd1', popularity: 50, quality: 1, price: 12 }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130 },
        { id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2', serviceTableId: null, serviceSlotIndex: null, state: 'ordered', assignedStaffId: null },
      ],
    };
    const result = updateStaff(state, 2);
    expect(result.staff[0].task).toMatchObject({ type: 'pickup_service_item', serviceItemId: 'i1' });
  });

  it('delivers a carried service item before preparing another ordered drink', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 120, y: 120, carryingServiceItemId: 'i1',
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't2' },
      ],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'occupied', x: 360, y: 200 },
      ],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' },
        { id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2', state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null },
      ],
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).toMatchObject({ type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' });
  });

  it('allows multiple cooks to claim distinct ordered drinks and service slots', () => {
    const state = {
      ...baseState,
      staff: [
        { id: 'w1', role: 'cook', morale: 80, x: 800, y: 500 },
        { id: 'w2', role: 'cook', morale: 80, x: 700, y: 500 },
      ],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't2' },
      ],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'occupied', x: 360, y: 200 },
      ],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
        state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
      }, {
        id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
        state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
      }],
    };
    const result = updateStaff(state, 0);
    const preparationTasks = result.staff.filter(candidate => candidate.task?.type === 'prepare_drink');
    expect(preparationTasks).toHaveLength(2);
    expect(new Set(preparationTasks.map(candidate => candidate.task.serviceItemId))).toEqual(new Set(['i1', 'i2']));
    expect(new Set(preparationTasks.map(candidate => candidate.task.serviceSlotIndex))).toEqual(new Set([0, 1]));
  });

  it('does not let a waiter claim ordered drink preparation', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 800, y: 500 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
        state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
      }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).not.toMatchObject({ type: 'prepare_drink' });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
    });
  });

  it('releases an old waiter drink-preparation task for a cook to reclaim', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{
        id: 'waiter', role: 'waiter', morale: 80, x: 120, y: 120,
        task: {
          type: 'prepare_drink', serviceItemId: 'drink',
          serviceTableId: 'st1', serviceSlotIndex: 0,
        },
      }, { id: 'cook', role: 'cook', morale: 80, x: 400, y: 300 }],
      customers: [{ id: 'customer', state: 'waiting_for_items', drinkId: 'water' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'customer',
        state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0,
        assignedStaffId: 'waiter', preparationStartedAt: 10,
      }],
    };

    const released = updateStaff(state, 0);

    expect(released.staff[0].task).toBeNull();
    expect(released.serviceItems[0]).toMatchObject({
      state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0,
      assignedStaffId: 'cook', preparationStartedAt: null,
    });
    expect(released.staff.find(worker => worker.id === 'cook')?.task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'drink',
    });
  });

  // --- Existing tests preserved ---




  // --- Task 5: Duplicate claim prevention ---

  it('two waiters do not claim the same take_order customer in one tick', () => {
    const waiter1 = { id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    const takeOrderTasks = result.staff.filter(s => s.task && s.task.type === 'take_order');
    expect(takeOrderTasks.length).toBeLessThanOrEqual(1);
  });

  it('two waiters do not claim the same on-service item for pickup in one tick', () => {
    const waiter1 = { id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      serviceItems: [item],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    const pickupTasks = result.staff.filter(s => s.task && s.task.type === 'pickup_service_item');
    expect(pickupTasks.length).toBeLessThanOrEqual(1);
  });

  // --- Task 5: Cross-tick duplicate claim prevention ---

  it('waiter2 does not claim customer already in an active take_order task by waiter1', () => {
    const waiter1 = {
      id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 400, y: 500,
      task: { type: 'take_order', customerId: 'c1' },
    };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    // waiter2 must not have claimed the same customer as waiter1's active task
    const w2Task = result.staff.find(s => s.id === 'w2').task;
    expect(w2Task).toBeNull();
  });

  it('waiter2 does not claim an item already in an active pickup_service_item task by waiter1', () => {
    const waiter1 = {
      id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 400, y: 500,
      task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' },
    };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      serviceItems: [item],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    // waiter2 must not have claimed the same service item
    const w2Task = result.staff.find(s => s.id === 'w2').task;
    expect(w2Task).toBeNull();
  });

  it('cook2 does not claim an item or station already used by an active prepare-dish task', () => {
    const cook1 = {
      id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200,
      x: 400, y: 500,
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
    };
    const cook2 = { id: 'c2', name: 'Luca', role: 'cook', skill: 5, morale: 80, salary: 200, x: 700, y: 500 };
    const state = {
      ...baseState,
      staff: [cook1, cook2],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', state: 'ordered' },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', state: 'ordered' },
      ],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);

    const c2Task = result.staff.find(s => s.id === 'c2').task;
    expect(c2Task).toBeNull();
  });

  describe('static staff target selection', () => {
    const assignmentCases = [
      ['floor dirt', () => ({
        ...baseState,
        staff: [{ id: 'j1', role: 'janitor', x: 180, y: 180, task: null }],
        floorDirt: [{ id: 'd1', x: 200, y: 200 }],
      }), { type: 'clean_floor', dirtId: 'd1' }, { x: 8, y: 9 }],
      ['kitchen station', () => ({
        ...baseState,
        staff: [{ id: 'cook1', role: 'cook', x: 180, y: 200, task: null }],
        kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 200, y: 200 }],
        dishes: [{ id: 'dish1', requiredEquipmentId: 'eq1' }],
        equipment: [{ id: 'eq1', owned: true }],
        serviceItems: [{ id: 'item1', kind: 'dish', menuItemId: 'dish1', state: 'ordered' }],
      }), { type: 'prepare_dish', serviceItemId: 'item1', stationId: 'k1' }, { x: 9, y: 10 }],
      ['service counter', () => ({
        ...baseState,
        staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220, task: null }],
        customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
        serviceTables: [{ id: 'st1', x: 200, y: 200 }],
        serviceItems: [{
          id: 'item1', kind: 'dish', menuItemId: 'dish1', customerId: 'c1',
          serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service',
        }],
      }), { type: 'pickup_service_item', serviceItemId: 'item1', serviceTableId: 'st1' }, { x: 9, y: 11 }],
      ['cashier', () => ({
        ...baseState,
        staff: [{ id: 'cashier', role: 'waiter', x: 840, y: 100, task: null }],
        customers: [{
          id: 'c1', state: 'checkout_moving', paymentReady: true,
          cashierStationId: 'cashier1', checkoutPosition: { x: 840, y: 180 },
        }],
        cashierStations: [{
          id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
        }],
      }), { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' }, { x: 42, y: 5 }],
      ['wash station', () => ({
        ...baseState,
        staff: [{
          id: 'w1', role: 'waiter', x: 180, y: 180, task: null,
          carryingServiceItemId: 'dirty1',
        }],
        washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
        serviceItems: [{ id: 'dirty1', state: 'carried_dirty' }],
      }), { type: 'deliver_dirty_item', serviceItemId: 'dirty1', washStationId: 'sink' }, { x: 9, y: 9 }],
      ['carried-item delivery', () => ({
        ...baseState,
        staff: [{
          id: 'w1', role: 'waiter', x: 180, y: 200, task: null,
          carryingServiceItemId: 'item1',
        }],
        customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
        tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
        serviceItems: [{
          id: 'item1', kind: 'dish', customerId: 'c1', tableId: 't1', state: 'carried',
        }],
      }), { type: 'deliver_service_item', serviceItemId: 'item1', customerId: 'c1' }, { x: 9, y: 10 }],
      ['table cleaning', () => ({
        ...baseState,
        staff: [{ id: 'w1', role: 'waiter', x: 180, y: 200, task: null }],
        tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
      }), { type: 'clean_table', tableId: 't1' }, { x: 9, y: 10 }],
      ['service-item cleaning', () => ({
        ...baseState,
        staff: [{ id: 'w1', role: 'waiter', x: 180, y: 200, task: null }],
        serviceItems: [{ id: 'item1', state: 'to_clean', x: 200, y: 200 }],
      }), { type: 'clean_service_item', serviceItemId: 'item1' }, { x: 9, y: 10 }],
      ['drink preparation', () => ({
        ...baseState,
        staff: [{ id: 'w1', role: 'cook', x: 180, y: 220, task: null }],
        customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water' }],
        serviceTables: [{ id: 'st1', x: 200, y: 200 }],
        serviceItems: [{
          id: 'drink1', kind: 'drink', menuItemId: 'water', customerId: 'c1',
          state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
        }],
      }), { type: 'prepare_drink', serviceItemId: 'drink1', serviceTableId: 'st1', serviceSlotIndex: 0 }, { x: 9, y: 11 }],
      ['dirty-item collection', () => ({
        ...baseState,
        staff: [{ id: 'w1', role: 'waiter', x: 180, y: 200, task: null }],
        tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
        washStations: [{ id: 'sink', type: 'manual', x: 400, y: 200, w: 40, h: 40 }],
        serviceItems: [{ id: 'dirty1', tableId: 't1', state: 'dirty_at_table', dirtyAt: 1 }],
      }), { type: 'collect_dirty_item', serviceItemId: 'dirty1', tableId: 't1' }, { x: 9, y: 10 }],
      ['table ordering', () => ({
        ...baseState,
        staff: [{ id: 'w1', role: 'waiter', x: 180, y: 200, task: null }],
        customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null, drinkId: null }],
        tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
        dishes: [{ id: 'dish1', popularity: 50 }],
      }), { type: 'take_order', customerId: 'c1' }, { x: 9, y: 10 }],
    ];

    it.each(assignmentCases)(
      'assigns %s work with an exact finite goal and no actor route',
      (_label, makeState, expectedTask, expectedCell) => {
        const result = resolveStaffAfterMovement(makeState(), 0);

        expect(result.staff[0]).toMatchObject({
          task: expectedTask,
          navigationGoal: cellToWorld(expectedCell),
        });
        expect(result.staff[0]).not.toHaveProperty('path');
        expect(Number.isFinite(result.staff[0].navigationGoal.x)).toBe(true);
        expect(Number.isFinite(result.staff[0].navigationGoal.y)).toBe(true);
      },
    );

    it('assigns the same reachable target when two actors occupy its shortest route', () => {
      const makeState = includeOccupiers => ({
        ...baseState,
        staff: [{ id: 'w1', role: 'waiter', x: 100, y: 220, task: null }],
        customers: includeOccupiers ? [
          { id: 'c1', state: 'eating', x: 120, y: 220 },
          { id: 'c2', state: 'eating', x: 140, y: 220 },
        ] : [],
        tables: [{ id: 't1', seats: 1, status: 'dirty', x: 200, y: 200 }],
      });
      const baseline = resolveStaffAfterMovement(makeState(false), 0);
      const occupied = resolveStaffAfterMovement(makeState(true), 0);

      expect(baseline.staff[0]).toMatchObject({
        task: { type: 'clean_table', tableId: 't1' },
        navigationGoal: cellToWorld({ x: 9, y: 11 }),
      });
      expect(occupied.staff[0]).toMatchObject({
        task: { type: 'clean_table', tableId: 't1' },
        navigationGoal: cellToWorld({ x: 9, y: 11 }),
      });
      expect(occupied.staff[0]).not.toHaveProperty('path');
    });

    it('uses the stable station-ID tie-break for equal static workloads and distances', () => {
      const state = {
        ...baseState,
        staff: [{
          id: 'w1', role: 'waiter', x: 300, y: 200, task: null,
          carryingServiceItemId: 'dirty1',
        }],
        washStations: [
          { id: 'z-sink', type: 'manual', x: 180, y: 200, w: 40, h: 40 },
          { id: 'a-sink', type: 'manual', x: 400, y: 200, w: 40, h: 40 },
        ],
        serviceItems: [{ id: 'dirty1', state: 'carried_dirty' }],
      };

      const result = resolveStaffAfterMovement(state, 0);

      expect(result.staff[0]).toMatchObject({
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty1', washStationId: 'a-sink' },
        navigationGoal: cellToWorld({ x: 19, y: 10 }),
      });
    });

    it('preserves an already-adjacent staff point as the exact navigation goal', () => {
      const state = {
        ...baseState,
        staff: [{
          id: 'w1', role: 'waiter', x: 185, y: 205, task: null,
          carryingServiceItemId: 'item1',
        }],
        customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
        tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
        serviceItems: [{
          id: 'item1', kind: 'dish', customerId: 'c1', tableId: 't1', state: 'carried',
        }],
      };

      const result = resolveStaffAfterMovement(state, 0);

      expect(result.staff[0]).toMatchObject({
        task: { type: 'deliver_service_item', serviceItemId: 'item1', customerId: 'c1' },
        navigationGoal: { x: 185, y: 205 },
      });
    });

    it('materialises staff coordinates without adding route or planner state', () => {
      const result = staffDomain.ensureStaffRuntime([{
        id: 'w1', role: 'waiter', task: null,
      }], baseState);

      expect(result[0]).toMatchObject({ task: null });
      expect(Number.isFinite(result[0].x)).toBe(true);
      expect(Number.isFinite(result[0].y)).toBe(true);
      expect(result[0]).not.toHaveProperty('path');
      expect(result[0]).not.toHaveProperty('pathGoal');
      expect(result[0]).not.toHaveProperty('stalledFor');
    });

    it('preserves inherited unrelated fields when assigning a static goal', () => {
      const inherited = {
        morale: 60,
        shiftStartedAt: 100,
      };
      const result = resolveStaffAfterMovement({
        ...baseState,
        staff: [{ id: 'j1', role: 'janitor', x: 180, y: 180, task: null, ...inherited }],
        floorDirt: [{ id: 'd1', x: 200, y: 200 }],
      }, 0);

      expect(result.staff[0]).toMatchObject({
        task: { type: 'clean_floor', dirtId: 'd1' },
        navigationGoal: cellToWorld({ x: 8, y: 9 }),
        ...inherited,
      });
      for (const field of ['path', 'pathGoal', 'stalledFor', 'usingStaticFallback',
        'minimumSpacing', 'localConflictTarget', 'headOnRecovery',
        'recoveredHeadOnDetourTarget']) {
        expect(result.staff[0]).not.toHaveProperty(field);
      }
    });

    it('keeps static ranking when occupiers make the nearer competing route expensive', () => {
      const makeState = includeOccupiers => ({
        ...baseState,
        staff: [
          { id: 'w1', role: 'waiter', x: 100, y: 220, task: null, carryingServiceItemId: 'dirty1' },
          ...(includeOccupiers ? [
            { id: 'blocker-1', role: 'cook', x: 120, y: 220, task: null },
            { id: 'blocker-2', role: 'cook', x: 140, y: 220, task: null },
            { id: 'blocker-3', role: 'cook', x: 160, y: 220, task: null },
          ] : []),
        ],
        chairs: [
          { id: 'top-1', x: 120, y: 200 },
          { id: 'top-2', x: 140, y: 200 },
          { id: 'top-3', x: 160, y: 200 },
          { id: 'bottom-1', x: 120, y: 240 },
          { id: 'bottom-2', x: 140, y: 240 },
          { id: 'bottom-3', x: 160, y: 240 },
        ],
        washStations: [
          { id: 'near', type: 'manual', x: 200, y: 200, w: 40, h: 40 },
          { id: 'far', type: 'manual', x: 100, y: 340, w: 40, h: 40 },
        ],
        serviceItems: [{ id: 'dirty1', state: 'carried_dirty' }],
      });
      const baseline = resolveStaffAfterMovement(makeState(false), 0);
      const occupied = resolveStaffAfterMovement(makeState(true), 0);

      expect(baseline.staff[0]).toMatchObject({
        task: { type: 'deliver_dirty_item', washStationId: 'near' },
        navigationGoal: cellToWorld({ x: 9, y: 11 }),
      });
      expect(occupied.staff[0]).toMatchObject({
        task: { type: 'deliver_dirty_item', washStationId: 'near' },
        navigationGoal: cellToWorld({ x: 9, y: 11 }),
      });
    });

    it('preserves findAdjacentOpenCells coordinate order for equal static candidate distances', () => {
      const state = {
        ...baseState,
        staff: [{
          id: 'w1', role: 'waiter', x: 300, y: 200, task: null,
          carryingServiceItemId: 'dirty1',
        }],
        chairs: [{ id: 'block-right-centre', x: 240, y: 200 }],
        washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
        serviceItems: [{ id: 'dirty1', state: 'carried_dirty' }],
      };
      const station = state.washStations[0];
      const orderedCandidates = findAdjacentOpenCells(
        state,
        station,
        worldToCell(state.staff[0]),
      );

      expect(orderedCandidates.slice(0, 2)).toEqual([{ x: 12, y: 9 }, { x: 12, y: 11 }]);
      const result = resolveStaffAfterMovement(state, 0);

      expect(result.staff[0]).toMatchObject({
        task: { type: 'deliver_dirty_item', washStationId: 'sink' },
        navigationGoal: cellToWorld({ x: 12, y: 9 }),
      });
    });

    it('ranks a zero-distance current point ahead of a farther equal-workload station', () => {
      const state = {
        ...baseState,
        staff: [{
          id: 'w1', role: 'waiter', x: 180, y: 220, task: null,
          carryingServiceItemId: 'dirty1',
        }],
        washStations: [
          { id: 'a-far', type: 'manual', x: 400, y: 200, w: 40, h: 40 },
          { id: 'z-current', type: 'manual', x: 200, y: 200, w: 40, h: 40 },
        ],
        serviceItems: [{ id: 'dirty1', state: 'carried_dirty' }],
      };

      const result = resolveStaffAfterMovement(state, 0);

      expect(result.staff[0]).toMatchObject({
        task: { type: 'deliver_dirty_item', washStationId: 'z-current' },
        navigationGoal: { x: 180, y: 220 },
      });
    });

    it('does not start work from an empty route when the batch status is scheduled', () => {
      const state = {
        ...baseState,
        staff: [{
          id: 'j1', role: 'janitor', x: 180, y: 180,
          navigationGoal: cellToWorld({ x: 9, y: 9 }),
          task: { type: 'clean_floor', dirtId: 'd1' },
        }],
        floorDirt: [{ id: 'd1', x: 200, y: 200 }],
      };

      const result = resolveStaffAfterMovement(state, 0, new Map([
        ['j1', { plan: 'scheduled', motion: 'traversing' }],
      ]));

      expect(result.staff[0]).toMatchObject({
        task: { type: 'clean_floor', dirtId: 'd1' },
        navigationGoal: cellToWorld({ x: 9, y: 9 }),
        activityPhase: 'task_assigned',
      });
      expect(result.staff[0].task.cleaningStartedAt).toBeUndefined();
    });

    it('clears the destination before starting work from an arrived status', () => {
      const state = {
        ...baseState,
        staff: [{
          id: 'j1', role: 'janitor', x: 180, y: 180,
          navigationGoal: cellToWorld({ x: 9, y: 9 }),
          task: { type: 'clean_floor', dirtId: 'd1' },
        }],
        floorDirt: [{ id: 'd1', x: 200, y: 200 }],
      };

      const result = resolveStaffAfterMovement(state, 0, new Map([
        ['j1', { plan: 'arrived', motion: 'holding' }],
      ]));

      expect(result.staff[0].task).toMatchObject({
        type: 'clean_floor', dirtId: 'd1', cleaningStartedAt: baseState.restaurant.gameTime,
      });
      expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    });
  });
});
