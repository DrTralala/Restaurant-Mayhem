import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_PHASES,
  enterCheckout,
  isCheckoutState,
  prepareCheckoutCustomers,
  requeueCheckoutCustomer,
} from './checkout';

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
      tableId: 't1', chairId: 'ch1', path: [{ x: 1, y: 1 }],
    }, 100);

    expect(entered).toMatchObject({
      state: 'checkout_queued', paymentQueuedAt: 100, path: [], paymentReady: false,
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
      path: [{ x: 3, y: 4 }], pathGoal: { x: 3, y: 4 },
    })).toMatchObject({
      state: 'checkout_queued', paymentQueuedAt: 50, cashierStationId: null,
      checkoutPosition: null, paymentReady: false, path: [],
    });
  });

  it('routes legacy and queued customers to the shortest staffed queue', () => {
    const customers = [
      {
        id: 'first', state: 'checkout_moving', cashierStationId: 'register',
        paymentQueuedAt: 10, x: 840, y: 180,
      },
      { id: 'legacy', state: 'paying', paymentQueuedAt: 20, x: 400, y: 300, path: [] },
    ];

    const result = prepareCheckoutCustomers({ ...state, customers }, customers);

    expect(result.map(customer => customer.state)).toEqual([
      'checkout_moving', 'checkout_moving',
    ]);
    expect(result[0]).toMatchObject({
      cashierStationId: 'register', paymentReady: true, checkoutPosition: { x: 840, y: 180 },
    });
    expect(result[1]).toMatchObject({ cashierStationId: 'register', paymentReady: false });
    expect(result[1].path.length).toBeGreaterThan(0);
  });

  it('waits queued when no cashier station is staffed', () => {
    const customers = [{
      id: 'c1', state: 'checkout_queued', paymentQueuedAt: 10, x: 400, y: 300,
    }];

    const result = prepareCheckoutCustomers({ ...state, staff: [], customers }, customers);

    expect(result[0]).toMatchObject({
      state: 'checkout_queued', cashierStationId: null, path: [],
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
      paymentReady: false, x: 840, y: 180, path: [],
    };
    const moving = {
      id: 'moving', state: 'checkout_moving', paymentQueuedAt: 20,
      cashierStationId: 'register', checkoutPosition: null,
      paymentReady: false, x: 840, y: 200, path: [],
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
      paymentReady: false, path: [],
    });
  });

  it('keeps FIFO movers behind a processing customer', () => {
    const processing = {
      id: 'processing', state: 'checkout_processing', paymentQueuedAt: 1,
      cashierStationId: 'register', checkoutPosition: { x: 840, y: 180 },
      paymentReady: false, x: 840, y: 180, path: [],
    };
    const laterById = {
      id: 'z-mover', state: 'checkout_moving', paymentQueuedAt: 20,
      cashierStationId: 'register', paymentReady: false, x: 840, y: 220, path: [],
    };
    const earlierById = {
      id: 'a-mover', state: 'checkout_moving', paymentQueuedAt: 20,
      cashierStationId: 'register', paymentReady: false, x: 840, y: 200, path: [],
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
      paymentReady: false, x: 840, y: 180, path: [],
    };
    const queued = {
      id: 'queued', state: 'checkout_queued', paymentQueuedAt: 2,
      cashierStationId: null, checkoutPosition: null, paymentReady: false,
      x: 500, y: 200, path: [],
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
      paymentReady: false, x: 840, y: 180, path: [],
    };
    const moving = {
      id: 'moving', state: 'checkout_moving', paymentQueuedAt: 2,
      cashierStationId: 'register', paymentReady: false,
      x: 840, y: 180, path: [],
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
});
