import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_PHASES,
  enterCheckout,
  isCheckoutState,
  prepareCheckoutCustomers,
  requeueCheckoutCustomer,
} from './checkout';
import { getCharacterMovementStatus } from './movement';

const state = {
  restaurant: { gameTime: 100, expansionLevel: 1 },
  staff: [{ id: 'cashier', role: 'waiter', x: 840, y: 100 }],
  customers: [],
  tables: [],
  chairs: [],
  kitchenStations: [],
  serviceTables: [],
  washStations: [],
  cashierStations: [{
    id: 'register', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
  }],
};
const baseState = state;

describe('checkout state', () => {
  it('enters queued checkout once and preserves order and position data', () => {
    const entered = enterCheckout({
      id: 'c1', state: 'eating', x: 210, y: 190, dishId: 'toast', drinkId: 'water',
      tableId: 't1', chairId: 'ch1', navigationGoal: { x: 20, y: 40 },
    }, 100);

    expect(entered).toMatchObject({
      state: 'checkout_queued', paymentQueuedAt: 100, paymentReady: false,
      x: 210, y: 190, dishId: 'toast', drinkId: 'water', tableId: 't1', chairId: 'ch1',
    });
    expect(enterCheckout(entered, 200).paymentQueuedAt).toBe(100);
  });

  it('recognises every checkout phase and the legacy paying state', () => {
    expect([...CHECKOUT_PHASES].every(isCheckoutState)).toBe(true);
    expect(isCheckoutState({ state: 'paying' })).toBe(true);
    expect(isCheckoutState('eating')).toBe(false);
  });

  it('normalises legacy paying without losing order or physical position data', () => {
    const result = enterCheckout({
      id: 'legacy', state: 'paying', x: 310, y: 270, dishId: 'toast', drinkId: 'water',
      tableId: 't1', chairId: 'ch1', paymentQueuedAt: 80,
    }, 100);

    expect(result).toMatchObject({
      state: 'checkout_queued', paymentQueuedAt: 80, x: 310, y: 270,
      dishId: 'toast', drinkId: 'water', tableId: 't1', chairId: 'ch1',
    });
  });

  it('requeues without losing checkout order', () => {
    expect(requeueCheckoutCustomer({
      id: 'c1', state: 'checkout_processing', paymentQueuedAt: 50,
      cashierStationId: 'gone', checkoutPosition: { x: 1, y: 2 }, paymentReady: true,
      navigationGoal: { x: 3, y: 4 },
    })).toMatchObject({
      state: 'checkout_queued', paymentQueuedAt: 50, cashierStationId: null,
      checkoutPosition: null, paymentReady: false,
    });
  });

  it('assigns exact goals to legacy and queued customers in the shortest staffed queue', () => {
    const customers = [
      {
        id: 'first', state: 'checkout_moving', cashierStationId: 'register',
        paymentQueuedAt: 10, x: 840, y: 180,
      },
      { id: 'legacy', state: 'paying', paymentQueuedAt: 20, x: 400, y: 300 },
    ];

    const result = prepareCheckoutCustomers({ ...state, customers }, customers);

    expect(result.map(customer => customer.state)).toEqual([
      'checkout_moving', 'checkout_moving',
    ]);
    expect(result[0]).toMatchObject({
      cashierStationId: 'register', paymentReady: true, checkoutPosition: { x: 840, y: 180 },
    });
    expect(result[1]).toMatchObject({
      cashierStationId: 'register', paymentReady: false,
      navigationGoal: { x: 840, y: 200 },
    });
  });

  it('waits queued when no cashier station is staffed', () => {
    const customers = [{
      id: 'c1', state: 'checkout_queued', paymentQueuedAt: 10, x: 400, y: 300,
    }];

    const result = prepareCheckoutCustomers({ ...state, staff: [], customers }, customers);

    expect(result[0]).toMatchObject({
      state: 'checkout_queued', cashierStationId: null,
    });
  });

  it('requeues processing when its matching cashier task is stale', () => {
    const customer = {
      id: 'c1', state: 'checkout_processing', cashierStationId: 'register',
      paymentQueuedAt: 10,
    };

    const result = prepareCheckoutCustomers({
      ...state, customers: [customer],
    }, [customer]);

    expect(result[0]).toMatchObject({
      state: 'checkout_queued', cashierStationId: null, paymentQueuedAt: 10,
    });
  });

  it('reserves slot zero for a valid processing customer', () => {
    const processing = {
      id: 'processing', state: 'checkout_processing', paymentQueuedAt: 10,
      cashierStationId: 'register', checkoutPosition: { x: 840, y: 180 },
      paymentReady: false, x: 840, y: 180,
    };
    const moving = {
      id: 'moving', state: 'checkout_moving', paymentQueuedAt: 20,
      cashierStationId: 'register', checkoutPosition: null,
      paymentReady: false, x: 840, y: 200,
    };
    const state = {
      ...baseState,
      staff: [{
        ...baseState.staff[0],
        task: { type: 'take_payment', customerId: 'processing', stationId: 'register', startedAt: 90 },
      }],
      customers: [processing, moving],
    };

    const result = prepareCheckoutCustomers(state, state.customers);

    expect(result[0]).toEqual(processing);
    expect(result[1]).toMatchObject({
      state: 'checkout_moving', checkoutPosition: { x: 840, y: 200 },
      paymentReady: false, navigationGoal: { x: 840, y: 200 },
    });
  });

  it('keeps FIFO movers behind a processing customer', () => {
    const processing = {
      id: 'processing', state: 'checkout_processing', paymentQueuedAt: 1,
      cashierStationId: 'register', checkoutPosition: { x: 840, y: 180 },
      paymentReady: false, x: 840, y: 180,
    };
    const laterById = {
      id: 'z-mover', state: 'checkout_moving', paymentQueuedAt: 20,
      cashierStationId: 'register', paymentReady: false, x: 840, y: 220,
    };
    const earlierById = {
      id: 'a-mover', state: 'checkout_moving', paymentQueuedAt: 20,
      cashierStationId: 'register', paymentReady: false, x: 840, y: 200,
    };
    const state = {
      ...baseState,
      staff: [{
        ...baseState.staff[0],
        task: { type: 'take_payment', customerId: 'processing', stationId: 'register', startedAt: 90 },
      }],
      customers: [processing, laterById, earlierById],
    };

    const result = prepareCheckoutCustomers(state, state.customers);

    expect(result.map(customer => customer.id)).toEqual(['processing', 'z-mover', 'a-mover']);
    expect(result.find(customer => customer.id === 'a-mover')).toMatchObject({
      checkoutPosition: { x: 840, y: 200 }, paymentReady: false,
    });
    expect(result.find(customer => customer.id === 'z-mover')).toMatchObject({
      checkoutPosition: { x: 840, y: 220 }, paymentReady: false,
    });
  });

  it('counts a processor when assigning the shortest staffed queue', () => {
    const stations = [
      { id: 'register', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' },
      { id: 'register-2', x: 600, y: 120, w: 80, h: 40, assignedStaffId: 'cashier-2' },
    ];
    const processing = {
      id: 'processing', state: 'checkout_processing', paymentQueuedAt: 1,
      cashierStationId: 'register', checkoutPosition: { x: 840, y: 180 },
      paymentReady: false, x: 840, y: 180,
    };
    const queued = {
      id: 'queued', state: 'checkout_queued', paymentQueuedAt: 2,
      cashierStationId: null, checkoutPosition: null, paymentReady: false,
      x: 500, y: 200,
    };
    const state = {
      ...baseState,
      cashierStations: stations,
      staff: [
        {
          id: 'cashier', role: 'waiter', x: 840, y: 100,
          task: { type: 'take_payment', customerId: 'processing', stationId: 'register', startedAt: 90 },
        },
        { id: 'cashier-2', role: 'waiter', x: 640, y: 100, task: null },
      ],
      customers: [processing, queued],
    };

    const result = prepareCheckoutCustomers(state, state.customers);

    expect(result[1]).toMatchObject({
      state: 'checkout_moving', cashierStationId: 'register-2',
      checkoutPosition: { x: 640, y: 180 },
    });
  });

  it('does not reserve slot zero for a stale processing customer', () => {
    const stale = {
      id: 'stale', state: 'checkout_processing', paymentQueuedAt: 1,
      cashierStationId: 'register', checkoutPosition: { x: 840, y: 180 },
      paymentReady: false, x: 840, y: 180,
    };
    const moving = {
      id: 'moving', state: 'checkout_moving', paymentQueuedAt: 2,
      cashierStationId: 'register', paymentReady: false,
      x: 840, y: 180,
    };
    const state = { ...baseState, customers: [stale, moving] };

    const result = prepareCheckoutCustomers(state, state.customers);

    expect(result[0]).toMatchObject({
      state: 'checkout_queued', cashierStationId: null, checkoutPosition: null,
      paymentReady: false,
    });
    expect(result[1]).toMatchObject({
      state: 'checkout_moving', checkoutPosition: { x: 840, y: 180 },
      paymentReady: true,
    });
  });

  it('retains an unchanged checkout goal object', () => {
    const goal = { x: 840, y: 180 };
    const customer = {
      id: 'c1', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 10, paymentReady: false, x: 400, y: 300,
      navigationGoal: goal,
    };

    const [prepared] = prepareCheckoutCustomers({ ...baseState, customers: [customer] }, [customer]);

    expect(prepared.navigationGoal).toBe(goal);
    expect(prepared).toMatchObject({ checkoutPosition: goal, paymentReady: false });
  });

  it('creates one new goal when a processing customer shifts the queue index', () => {
    const oldGoal = { x: 840, y: 180 };
    const processing = {
      id: 'processing', state: 'checkout_processing', paymentQueuedAt: 10,
      cashierStationId: 'register', checkoutPosition: oldGoal,
      paymentReady: false, x: 840, y: 180,
    };
    const moving = {
      id: 'moving', state: 'checkout_moving', paymentQueuedAt: 20,
      cashierStationId: 'register', paymentReady: false, x: 400, y: 300,
      navigationGoal: oldGoal,
    };
    const checkoutState = {
      ...baseState,
      staff: [{
        ...baseState.staff[0],
        task: { type: 'take_payment', customerId: 'processing', stationId: 'register' },
      }],
      customers: [processing, moving],
    };

    const result = prepareCheckoutCustomers(checkoutState, checkoutState.customers);

    expect(result[1]).toMatchObject({ checkoutPosition: { x: 840, y: 200 }, navigationGoal: { x: 840, y: 200 } });
    expect(result[1].navigationGoal).not.toBe(oldGoal);
  });

  it('does not inherit an arrived status from a stale checkout goal', () => {
    const staleGoal = { x: 840, y: 180 };
    const processing = {
      id: 'processing', state: 'checkout_processing', cashierStationId: 'register',
      paymentQueuedAt: 10, x: 840, y: 180,
    };
    const actor = {
      id: 'moving', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 20, x: 800, y: 200, navigationGoal: { x: 840, y: 200 },
    };
    const stateWithStaleStatus = {
      ...baseState,
      staff: [{
        ...baseState.staff[0],
        task: { type: 'take_payment', customerId: 'processing', stationId: 'register' },
      }],
      customers: [processing, actor],
      movementCoordinator: {
        requests: new Map([['moving', { id: 'moving', goal: staleGoal }]]),
        statuses: new Map([['moving', { plan: 'arrived', motion: 'holding' }]]),
      },
    };

    expect(getCharacterMovementStatus(stateWithStaleStatus, 'moving')).toEqual({
      plan: 'planning', motion: 'holding',
    });
    expect(prepareCheckoutCustomers(stateWithStaleStatus, stateWithStaleStatus.customers)
      .find(customer => customer.id === 'moving').paymentReady)
      .toBe(false);
  });

  it('makes payment ready only for rank zero after an arrived status', () => {
    const rankZero = {
      id: 'rank-zero', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 10, x: 840, y: 180,
    };
    const rankOne = {
      id: 'rank-one', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 20, x: 840, y: 200,
    };
    const checkoutState = {
      ...baseState,
      customers: [rankZero, rankOne],
    };

    const prepared = prepareCheckoutCustomers(checkoutState, checkoutState.customers);

    expect(prepared.find(customer => customer.id === 'rank-zero').paymentReady).toBe(true);
    expect(prepared.find(customer => customer.id === 'rank-one').paymentReady).toBe(false);

    const waiting = prepareCheckoutCustomers({
      ...checkoutState,
      customers: [{ ...rankZero, x: 400, y: 300 }],
    }, [{ ...rankZero, x: 400, y: 300 }]);
    expect(waiting[0].paymentReady).toBe(false);
  });

  it('assigns a destination even when the current actor cell is blocked', () => {
    const customer = {
      id: 'blocked', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 10, x: 400, y: 300,
    };
    const result = prepareCheckoutCustomers({
      ...baseState,
      tables: [{ id: 'blocker', x: 400, y: 300, status: 'occupied' }],
      customers: [customer],
    }, [customer]);

    expect(result[0]).toMatchObject({
      state: 'checkout_moving', navigationGoal: { x: 840, y: 180 },
    });
  });
});
