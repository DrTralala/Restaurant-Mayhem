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

  it('queues a zero-balance cancelled-food customer without dropping party or table ownership', () => {
    const customer = {
      id: 'cancelled', partyId: 'p1', state: 'seated', tableId: 't1',
      dishId: null, drinkId: null, orderSubtotal: 0,
      foodOutcome: 'cancelled', cancelledServiceItemIds: ['dish-1'],
    };
    const queued = enterCheckout(customer, 100);

    expect(queued).toMatchObject({
      state: 'checkout_queued', partyId: 'p1', tableId: 't1',
      orderSubtotal: 0, foodOutcome: 'cancelled',
    });
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
      navigationGoal: { x: 3, y: 4 }, checkoutLineMember: true,
    })).toMatchObject({
      state: 'checkout_queued', paymentQueuedAt: 50, cashierStationId: null,
      checkoutPosition: null, paymentReady: false, checkoutLineMember: false,
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

  it('assigns a physical queue destination at an existing unstaffed cashier', () => {
    const customers = [{
      id: 'c1', state: 'checkout_queued', paymentQueuedAt: 10, x: 400, y: 300,
    }];

    const result = prepareCheckoutCustomers({ ...state, staff: [], customers }, customers);

    expect(result[0]).toMatchObject({
      state: 'checkout_moving', cashierStationId: 'register',
      checkoutPosition: { x: 840, y: 180 }, navigationGoal: { x: 840, y: 180 },
      paymentReady: false,
    });
  });

  it('keeps queued holding when no cashier station exists', () => {
    const customers = [{
      id: 'c1', state: 'checkout_queued', paymentQueuedAt: 10, x: 400, y: 300,
    }];

    const result = prepareCheckoutCustomers({
      ...state, staff: [], cashierStations: [], customers,
    }, customers);

    expect(result[0]).toMatchObject({ state: 'checkout_queued', cashierStationId: null });
  });

  it('requeues an unstaffed processor but keeps a physically moving diner', () => {
    const processing = {
      id: 'processing', state: 'checkout_processing', paymentQueuedAt: 1,
      cashierStationId: 'register', checkoutPosition: { x: 840, y: 180 },
      paymentReady: false, x: 840, y: 180,
    };
    const moving = {
      id: 'moving', state: 'checkout_moving', paymentQueuedAt: 2,
      cashierStationId: 'register', paymentReady: false, x: 400, y: 300,
    };

    const result = prepareCheckoutCustomers({
      ...state, staff: [], customers: [processing, moving],
    }, [processing, moving]);

    expect(result.find(customer => customer.id === 'processing'))
      .toMatchObject({ state: 'checkout_queued', cashierStationId: null });
    expect(result.find(customer => customer.id === 'moving'))
      .toMatchObject({ state: 'checkout_moving', cashierStationId: 'register' });
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

  it('records line membership at the queue slot and resets it when station geometry changes', () => {
    const joining = {
      id: 'joining', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 10, x: 840, y: 300,
    };
    const moving = prepareCheckoutCustomers({ ...baseState, customers: [joining] }, [joining])[0];

    expect(moving.checkoutLineMember).toBe(false);

    const arrivedInput = { ...moving, x: 840, y: 180 };
    const arrived = prepareCheckoutCustomers({ ...baseState, customers: [arrivedInput] }, [arrivedInput])[0];
    expect(arrived.checkoutLineMember).toBe(true);

    const movedStation = { ...baseState,
      cashierStations: [{ ...baseState.cashierStations[0], x: 820 }],
      customers: [arrived],
    };
    const moved = prepareCheckoutCustomers(movedStation, [arrived])[0];
    expect(moved.checkoutLineMember).toBe(false);
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

  it('holds the next payer behind a live departing payer until its forward segment is clear', () => {
    const next = {
      id: 'next', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 20, paymentReady: false, x: 840, y: 200,
    };
    const departing = {
      id: 'paid', state: 'leaving', exitPhase: 'to_door', x: 840, y: 180,
      checkoutDeparture: { stationId: 'register', position: { x: 840, y: 180 } },
    };

    const held = prepareCheckoutCustomers({ ...baseState, customers: [departing, next] }, [departing, next]);

    expect(held.find(customer => customer.id === 'next')).toMatchObject({
      checkoutPosition: { x: 840, y: 200 },
      navigationGoal: { x: 840, y: 200 },
      paymentReady: false,
    });
  });

  it.each([
    ['lateral clearance below threshold', { x: 855, y: 180 }, 200],
    ['still on the forward line farther from the cashier', { x: 840, y: 196 }, 200],
  ])('keeps a departure %s from promoting the next payer', (_name, position, expectedY) => {
    const departing = {
      id: 'paid', state: 'leaving', exitPhase: 'to_door', ...position,
      checkoutDeparture: { stationId: 'register', position: { x: 840, y: 180 } },
    };
    const next = {
      id: 'next', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 20, paymentReady: false, x: 840, y: 200,
    };

    const [prepared] = prepareCheckoutCustomers(
      { ...baseState, customers: [departing, next] },
      [departing, next],
    ).filter(customer => customer.id === 'next');

    expect(prepared.checkoutPosition.y).toBe(expectedY);
    expect(prepared.navigationGoal.y).toBe(expectedY);
    expect(prepared.paymentReady).toBe(false);
  });

  it('releases a sixteen-pixel departure clearance, isolates stations, and cleans moved claims', () => {
    const departing = {
      id: 'paid', state: 'leaving', exitPhase: 'to_door', x: 856, y: 180,
      checkoutDeparture: { stationId: 'register', position: { x: 840, y: 180 } },
    };
    const registerNext = {
      id: 'register-next', state: 'checkout_moving', cashierStationId: 'register',
      paymentQueuedAt: 20, paymentReady: false, x: 840, y: 180,
    };
    const otherNext = {
      id: 'other-next', state: 'checkout_moving', cashierStationId: 'other-register',
      paymentQueuedAt: 21, paymentReady: false, x: 640, y: 180,
    };
    const stations = [
      baseState.cashierStations[0],
      { id: 'other-register', x: 600, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' },
    ];
    const released = prepareCheckoutCustomers({
      ...baseState, cashierStations: stations, customers: [departing, registerNext, otherNext],
    }, [departing, registerNext, otherNext]);

    expect(released.find(customer => customer.id === 'register-next')).toMatchObject({
      checkoutPosition: { x: 840, y: 180 }, paymentReady: true,
    });
    expect(released.find(customer => customer.id === 'other-next')).toMatchObject({
      checkoutPosition: { x: 640, y: 180 }, paymentReady: true,
    });

    const absentDeparture = prepareCheckoutCustomers({
      ...baseState, customers: [{ ...registerNext }],
    }, [{ ...registerNext }]);
    expect(absentDeparture[0]).toMatchObject({
      checkoutPosition: { x: 840, y: 180 }, paymentReady: true,
    });

    const movedStation = [{ ...baseState.cashierStations[0], x: 820 }];
    const moved = prepareCheckoutCustomers({
      ...baseState, cashierStations: movedStation, customers: [
        { ...departing, x: 840, y: 180 },
        { ...registerNext, x: 860 },
      ],
    }, [
      { ...departing, x: 840, y: 180 },
      { ...registerNext, x: 860 },
    ]);
    expect(moved.find(customer => customer.id === 'paid').checkoutDeparture).toBeNull();
    expect(moved.find(customer => customer.id === 'register-next')).toMatchObject({
      checkoutPosition: { x: 860, y: 180 }, paymentReady: true,
    });

    const removed = prepareCheckoutCustomers({
      ...baseState, cashierStations: [], customers: [
        { ...departing, x: 840, y: 180 },
        { ...registerNext },
      ],
    }, [
      { ...departing, x: 840, y: 180 },
      { ...registerNext },
    ]);
    expect(removed.find(customer => customer.id === 'paid').checkoutDeparture).toBeNull();
    expect(removed.find(customer => customer.id === 'register-next')).toMatchObject({
      state: 'checkout_queued', cashierStationId: null, paymentReady: false,
    });
  });
});
