import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { prepareStaffForMovement, resolveStaffAfterMovement, updateStaff } from './staff';
import { clearNavigationGoal } from './movement/navigationGoal';

function stalledStaffState() {
  const initial = createInitialState();
  return {
    ...initial,
    customers: [],
    queue: [],
    tables: initial.tables.map(table => ({ ...table, status: 'dirty' })),
    serviceItems: [{
      id: 'abandoned-food', kind: 'dish', menuItemId: 'starter-toast',
      customerId: 'departed', tableId: 't3', state: 'to_clean',
      x: 240, y: 290.0000000000075,
    }],
    staff: initial.staff.filter(worker => ['starter-waiter', 'starter-host'].includes(worker.id))
      .map(worker => ({
        ...worker,
        x: worker.id === 'starter-waiter' ? 340 : 240,
        y: worker.id === 'starter-waiter' ? 340 : 290.0000000000075,
        navigationGoal: { x: 240, y: 340 },
        carryingServiceItemId: null,
        task: worker.id === 'starter-waiter'
          ? { type: 'take_order', customerId: 'leaving' }
          : { type: 'deliver_service_item', serviceItemId: 'abandoned-food', customerId: 'departed' },
      })),
  };
}

describe('staff task cancellation without arrival', () => {
  it.each(['planning', 'unreachable', 'scheduled'])('releases stale order and delivery tasks while movement is %s', plan => {
    const state = stalledStaffState();
    state.customers = [{ id: 'leaving', state: 'leaving', tableId: 't3', x: 566, y: 360 }];
    const prepared = prepareStaffForMovement(state, 2);
    const statuses = new Map(state.staff.map(worker => [worker.id, { plan, motion: 'holding' }]));
    const result = resolveStaffAfterMovement(prepared, 2, statuses);

    for (const worker of result.staff) {
      expect(worker.task).toBeNull();
      expect(worker).not.toHaveProperty('navigationGoal');
    }
    expect(result.serviceItems).toEqual(state.serviceItems);
    expect(result.customers).toEqual(state.customers);
    const reassigned = resolveStaffAfterMovement(prepareStaffForMovement(result, 2), 2);
    expect(reassigned.staff.map(worker => worker.task)).toEqual([
      { type: 'collect_dirty_item', serviceItemId: 'abandoned-food' },
      null,
    ]);
  });

  it('does not execute valid order or delivery tasks before arrival', () => {
    const state = stalledStaffState();
    state.customers = [
      { id: 'leaving', state: 'seated', tableId: 't3' },
      { id: 'departed', state: 'waiting_for_items', tableId: 't3', dishId: 'starter-toast' },
    ];
    state.serviceItems[0].state = 'carried';
    state.staff[1].carryingServiceItemIds = ['abandoned-food'];
    const originalTasks = structuredClone(state.staff.map(worker => worker.task));
    const result = resolveStaffAfterMovement(state, 2,
      new Map(state.staff.map(worker => [worker.id, { plan: 'planning', motion: 'holding' }])));
    expect(result.staff.map(worker => worker.task)).toEqual(originalTasks);
    expect(result.serviceItems[0].state).toBe('carried');
    expect(result.customers).toEqual(state.customers);
  });
});

function activeServiceState() {
  const state = stalledStaffState();
  return {
    ...state,
    unlockedDrinkIds: [],
    tables: state.tables.map(table => ({ ...table, status: table.id === 't3' ? 'occupied' : 'empty' })),
    customers: [
      { id: 'leaving', state: 'seated', tableId: 't3', chairId: 'ch6', x: 220, y: 410,
        happiness: 80, spendingTier: 'value', spendingBudget: 45 },
      { id: 'departed', state: 'waiting_for_items', tableId: 't3', chairId: 'ch5', x: 220, y: 350,
        dishId: 'starter-toast', happiness: 80 },
    ],
    serviceItems: state.serviceItems.map(item => ({ ...item, state: 'carried' })),
    staff: state.staff.map(worker => ({ ...worker,
      carryingServiceItemIds: worker.id === 'starter-host' ? ['abandoned-food'] : [],
    })),
  };
}

describe('distinct staff service destinations', () => {
  it('assigns distinct approach positions for simultaneous ordering and delivery at one table', () => {
    const initial = activeServiceState();
    initial.staff = initial.staff.map(({ navigationGoal, ...worker }) => ({ ...worker, task: null }));
    const result = resolveStaffAfterMovement(initial, 2);
    expect(result.staff.map(worker => worker.task?.type)).toEqual(['take_order', 'deliver_service_item']);
    const [first, second] = result.staff.map(worker => worker.navigationGoal);
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(16);
  });

  it('repairs conflicting destinations in existing tasks without completing them remotely', () => {
    const initial = activeServiceState();
    const result = prepareStaffForMovement(initial, 2);
    const [first, second] = result.staff.map(worker => worker.navigationGoal);
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(16);
    expect(result.staff.map(worker => worker.task)).toEqual(initial.staff.map(worker => worker.task));
    expect(result.staff.map(worker => [worker.x, worker.y])).toEqual(initial.staff.map(worker => [worker.x, worker.y]));
    expect(result.serviceItems[0].state).toBe('carried');
  });

  it('delivers food and takes the other order from initially conflicting goals', () => {
    let state = activeServiceState();
    for (let tick = 0; tick < 350; tick += 1) {
      state = updateStaff({ ...state,
        restaurant: { ...state.restaurant, gameTime: state.restaurant.gameTime + 2 },
      }, { movementDt: 1 / 30, gameDt: 2 });
      const [first, second] = state.staff;
      expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(16 - 1e-8);
      if (state.serviceItems.find(item => item.id === 'abandoned-food')?.state === 'delivered'
        && state.customers[0].state !== 'seated') break;
    }
    expect(state.serviceItems.find(item => item.id === 'abandoned-food')?.state).toBe('delivered');
    expect(state.customers[0]).toMatchObject({ state: 'waiting_for_items', menuOutcome: 'ordered' });
    expect(state.serviceItems).toContainEqual(expect.objectContaining({ customerId: 'leaving', state: 'ordered' }));
  }, 30000);
});

describe('waiter orderability recovery', () => {
  it.each(['cancelled', 'delivered'])(
    'does not target a %s seated customer or include them in a group order',
    foodOutcome => {
      const fresh = createInitialState();
      const state = {
        ...fresh,
        staff: [{
          ...fresh.staff.find(worker => worker.role === 'waiter'),
          id: 'order-waiter',
          skill: 10,
          x: 180,
          y: 220,
          task: null,
        }],
        tables: [fresh.tables.find(table => table.id === 't1')],
        customers: [
          {
            id: 'blocked',
            partyId: 'party-1',
            state: 'seated',
            tableId: 't1',
            dishId: null,
            drinkId: null,
            foodOutcome,
          },
          {
            id: 'eligible',
            partyId: 'party-1',
            state: 'seated',
            tableId: 't1',
            dishId: null,
            drinkId: null,
            foodOutcome: null,
          },
        ],
        serviceItems: [],
      };

      const assigned = updateStaff(state, 0);

      expect(assigned.staff[0].task).toMatchObject({
        type: 'take_order',
        customerId: 'eligible',
        customerIds: ['eligible'],
      });
    },
  );

  it('releases a stale group order made entirely of non-orderable members before serving a valid diner', () => {
    const fresh = createInitialState();
    const staleTask = {
      type: 'take_order',
      customerId: 'cancelled',
      customerIds: ['cancelled', 'delivered'],
      tableId: 't1',
      partyId: 'stale-party',
    };
    const state = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 100 },
      staff: [{
        ...fresh.staff.find(worker => worker.role === 'waiter'),
        id: 'order-waiter',
        skill: 10,
        x: 180,
        y: 220,
        task: staleTask,
      }],
      tables: [fresh.tables.find(table => table.id === 't1')],
      customers: [
        {
          id: 'cancelled',
          partyId: 'stale-party',
          state: 'seated',
          tableId: 't1',
          dishId: null,
          drinkId: null,
          foodOutcome: 'cancelled',
        },
        {
          id: 'delivered',
          partyId: 'stale-party',
          state: 'seated',
          tableId: 't1',
          dishId: null,
          drinkId: null,
          foodOutcome: 'delivered',
        },
        {
          id: 'eligible',
          partyId: 'new-party',
          state: 'seated',
          tableId: 't1',
          dishId: null,
          drinkId: null,
          foodOutcome: null,
        },
      ],
      serviceItems: [],
    };

    const released = resolveStaffAfterMovement(state, 0);
    expect(released.staff[0].task).toBeNull();

    const reassigned = updateStaff(released, 0);
    expect(reassigned.staff[0].task).toMatchObject({
      type: 'take_order',
      customerId: 'eligible',
    });
  });

  function mixedGroupRecoveryState(fresh, pendingPartyReviews) {
    const terminal = {
      id: 'cancelled',
      partyId: 'party-1',
      state: 'seated',
      tableId: 't1',
      dishId: null,
      drinkId: null,
      menuOutcome: 'ordered',
      foodOutcome: 'cancelled',
      foodCancelledAt: 80,
      cancelledServiceItemIds: ['cancelled-item'],
    };
    const eligible = {
      id: 'eligible',
      partyId: 'party-1',
      partySize: 2,
      state: 'seated',
      tableId: 't1',
      dishId: null,
      drinkId: null,
      spendingTier: 'premium',
      spendingBudget: 100,
      archetype: 'regular',
      foodOutcome: null,
    };
    const table = { ...fresh.tables.find(candidate => candidate.id === 't1'), status: 'occupied' };
    return {
      terminal,
      eligible,
      state: {
        ...fresh,
        restaurant: { ...fresh.restaurant, gameTime: 100, day: 1 },
        staff: [{
          ...fresh.staff.find(worker => worker.role === 'waiter'),
          id: 'order-waiter',
          skill: 10,
          x: 180,
          y: 220,
          task: {
            type: 'take_order',
            customerId: terminal.id,
            customerIds: [terminal.id, eligible.id],
            tableId: 't1',
            partyId: 'party-1',
            startedAt: 0,
            accumulatedWork: 0,
            lastProgressAt: 0,
          },
        }],
        tables: [table],
        customers: [terminal, eligible],
        serviceItems: [],
        unlockedDrinkIds: [],
        pendingPartyReviews,
        partyReviewHistory: [],
        completedCustomers: [],
      },
    };
  }

  it('preserves an existing mixed party review and settles after the eligible member pays', () => {
    const fresh = createInitialState();
    const { terminal, eligible, state: baseState } = mixedGroupRecoveryState(fresh, []);
    const state = {
      ...baseState,
      pendingPartyReviews: [{
        partyId: 'party-1',
        memberIds: [terminal.id, eligible.id],
        orderedMemberIds: [terminal.id],
        unaffordableMemberIds: [],
        paidReviews: [{ customerId: terminal.id, score: 100 }],
      }],
    };
    const completed = resolveStaffAfterMovement(state, 0);

    expect(completed.customers.find(customer => customer.id === terminal.id)).toEqual(terminal);
    expect(completed.customers.find(customer => customer.id === eligible.id)).toMatchObject({
      state: 'waiting_for_items',
      menuOutcome: 'ordered',
    });
    expect(completed.serviceItems).toEqual([
      expect.objectContaining({ customerId: eligible.id, state: 'ordered' }),
    ]);
    expect(completed.tables).toEqual(state.tables);
    expect(completed.pendingPartyReviews).toEqual([{
      partyId: 'party-1',
      memberIds: [terminal.id, eligible.id],
      orderedMemberIds: [terminal.id, eligible.id],
      unaffordableMemberIds: [],
      paidReviews: [{ customerId: terminal.id, score: 100 }],
    }]);

    const paymentState = {
      ...completed,
      restaurant: {
        ...completed.restaurant, gameTime: 60, day: 1, reputation: 3, totalServed: 0,
      },
      staff: [{
        ...fresh.staff.find(worker => worker.role === 'waiter'),
        id: 'cashier',
        x: 840,
        y: 100,
        task: { type: 'take_payment', customerId: eligible.id, stationId: 'cashier1', startedAt: 0 },
      }],
      customers: completed.customers.map(customer => customer.id === eligible.id
        ? {
          ...customer,
          state: 'checkout_processing',
          cashierStationId: 'cashier1',
          paymentReady: false,
          x: 840,
          y: 180,
          happiness: 100,
        }
        : customer),
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
      completedCustomers: [],
    };
    const settled = updateStaff(paymentState, 0);

    expect(settled.pendingPartyReviews).toEqual([]);
    expect(settled.partyReviewHistory).toEqual([
      expect.objectContaining({
        partyId: 'party-1', memberCount: 2, paidCount: 2, unaffordableCount: 0,
      }),
    ]);
    expect(settled.customers.find(customer => customer.id === terminal.id)).toEqual(
      completed.customers.find(customer => customer.id === terminal.id),
    );
    expect(settled.customers.find(customer => customer.id === eligible.id)).toMatchObject({
      state: 'leaving',
      departureReason: 'served',
    });
  });

  it('does not create an incomplete mixed-party review when the saved task has no tracker', () => {
    const fresh = createInitialState();
    const { terminal, eligible, state } = mixedGroupRecoveryState(fresh, []);
    const completed = resolveStaffAfterMovement(state, 0);
    const pending = completed.pendingPartyReviews[0];

    expect(completed.customers.find(customer => customer.id === terminal.id)).toEqual(terminal);
    expect(pending).toEqual({
      partyId: 'party-1',
      memberIds: [eligible.id],
      orderedMemberIds: [eligible.id],
      unaffordableMemberIds: [],
      paidReviews: [],
    });
  });

  it.each(['cancelled', 'delivered'])(
    'releases and recovers an individual %s saved order task without reordering the terminal customer',
    foodOutcome => {
      const fresh = createInitialState();
      const terminal = {
        id: 'terminal',
        partyId: 'terminal-party',
        state: 'seated',
        tableId: 't1',
        dishId: null,
        drinkId: null,
        menuOutcome: 'ordered',
        foodOutcome,
      };
      const eligible = {
        id: 'eligible',
        partyId: 'eligible-party',
        state: 'seated',
        tableId: 't1',
        dishId: null,
        drinkId: null,
        spendingTier: 'premium',
        spendingBudget: 100,
        archetype: 'regular',
        foodOutcome: null,
      };
      const table = { ...fresh.tables.find(candidate => candidate.id === 't1'), status: 'occupied' };
      const state = {
        ...fresh,
        restaurant: { ...fresh.restaurant, gameTime: 100, day: 1 },
        staff: [{
          ...fresh.staff.find(worker => worker.role === 'waiter'),
          id: 'order-waiter',
          skill: 5,
          x: 180,
          y: 220,
          task: { type: 'take_order', customerId: terminal.id },
        }],
        tables: [table],
        customers: [terminal, eligible],
        serviceItems: [],
        unlockedDrinkIds: [],
        pendingPartyReviews: [],
        partyReviewHistory: [],
        completedCustomers: [],
      };

      const released = resolveStaffAfterMovement(state, 0);
      expect(released.staff[0].task).toBeNull();
      expect(released.customers.find(customer => customer.id === terminal.id)).toEqual(terminal);
      expect(released.tables).toEqual([table]);

      const reassigned = updateStaff(released, 0);
      expect(reassigned.staff[0].task).toMatchObject({
        type: 'take_order', customerId: eligible.id,
      });
      const assignedWorker = reassigned.staff[0];
      const assignedGoal = assignedWorker.navigationGoal || assignedWorker;
      const completionState = {
        ...reassigned,
        restaurant: { ...reassigned.restaurant, gameTime: 100 },
        staff: [clearNavigationGoal({
          ...assignedWorker,
          x: assignedGoal.x,
          y: assignedGoal.y,
          task: {
            ...assignedWorker.task,
            startedAt: 0,
            accumulatedWork: 0,
            lastProgressAt: 0,
          },
        })],
      };
      const completed = resolveStaffAfterMovement(completionState, 0);

      expect(completed.customers.find(customer => customer.id === terminal.id)).toEqual(terminal);
      expect(completed.tables).toEqual([table]);
      expect(completed.serviceItems.every(item => item.customerId !== terminal.id)).toBe(true);
      expect(completed.pendingPartyReviews.some(record => record.partyId === terminal.partyId)).toBe(false);
      expect(completed.customers.find(customer => customer.id === eligible.id)).toMatchObject({
        state: 'waiting_for_items',
        menuOutcome: 'ordered',
      });
      expect(completed.serviceItems).toContainEqual(
        expect.objectContaining({ customerId: eligible.id, state: 'ordered' }),
      );
    },
  );
});
