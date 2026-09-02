import { describe, expect, it } from 'vitest';
import { moveFixtures } from './fixtureMoves';

function makeState(overrides = {}) {
  return {
    restaurant: { expansionLevel: 1, gameTime: 100 },
    tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
    chairs: [
      { id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 },
      { id: 'ch2', tableId: 't1', x: 210, y: 240, rotation: 0 },
    ],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    doors: [{ id: 'door1', y: 340 }],
    customers: [],
    staff: [],
    serviceItems: [],
    queue: [],
    ...overrides,
  };
}

function makeCollidingStationState() {
  return makeState({
    tables: [],
    chairs: [],
    kitchenStations: [{ id: 'shared', equipmentId: 'eq1', x: 100, y: 120 }],
    cashierStations: [{
      id: 'shared', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
    }],
    customers: [
      { id: 'c1', state: 'waiting_for_items' },
      {
        id: 'payer', state: 'paying', cashierStationId: 'shared',
        path: [{ x: 42, y: 9 }], checkoutPosition: { x: 840, y: 180 },
      },
    ],
    staff: [
      {
        id: 'cook', role: 'cook', path: [{ x: 5, y: 6 }],
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'shared' },
      },
      {
        id: 'cashier', role: 'waiter', path: [{ x: 40, y: 8 }],
        task: { type: 'take_payment', customerId: 'payer', stationId: 'shared' },
      },
    ],
    serviceItems: [{
      id: 'i1', kind: 'dish', customerId: 'c1', state: 'preparing', stationId: 'shared',
      assignedStaffId: 'cook', preparationStartedAt: 50,
    }],
  });
}

describe('moveFixtures', () => {
  it('moves a table, all linked chairs, and their seated customers by one delta', () => {
    const state = makeState({
      customers: [{
        id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1', x: 220, y: 190,
        path: [{ x: 12, y: 10 }],
      }],
    });

    const result = moveFixtures(state, [{ type: 'table', id: 't1', x: 300, y: 240 }]);

    expect(result.tables[0]).toMatchObject({ x: 300, y: 240 });
    expect(result.chairs).toEqual([
      { id: 'ch1', tableId: 't1', x: 310, y: 220, rotation: 2 },
      { id: 'ch2', tableId: 't1', x: 310, y: 280, rotation: 0 },
    ]);
    expect(result.customers[0]).toMatchObject({
      id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1', x: 320, y: 230, path: [],
    });
  });

  it('moves only the occupant of a chair moved independently', () => {
    const state = makeState({
      customers: [
        { id: 'c1', state: 'seated', tableId: 't1', chairId: 'ch1', x: 220, y: 190, path: [] },
        { id: 'c2', state: 'seated', tableId: 't1', chairId: 'ch2', x: 220, y: 250, path: [] },
      ],
    });

    const result = moveFixtures(state, [
      { type: 'chair', id: 'ch1', x: 180, y: 210, rotation: 1 },
    ]);

    expect(result.chairs[0]).toMatchObject({ x: 180, y: 210, rotation: 1 });
    expect(result.customers[0]).toMatchObject({ x: 190, y: 220 });
    expect(result.customers[1]).toBe(state.customers[1]);
  });

  it.each([
    ['seated', 190, 220],
    ['eating', 190, 220],
    ['paying', 220, 190],
    ['leaving', 220, 190],
  ])('translates only physically seated customers when a chair moves: %s', (customerState, x, y) => {
    const state = makeState({
      customers: [{
        id: 'c1', state: customerState, tableId: 't1', chairId: 'ch1',
        x: 220, y: 190, path: [{ x: 20, y: 20 }],
      }],
    });

    const result = moveFixtures(state, [
      { type: 'chair', id: 'ch1', x: 180, y: 210, rotation: 1 },
    ]);

    expect(result.customers[0]).toMatchObject({ state: customerState, x, y });
  });

  it('rejects an inconsistent explicit table and chair delta atomically', () => {
    const state = makeState();

    const result = moveFixtures(state, [
      { type: 'table', id: 't1', x: 300, y: 240 },
      { type: 'chair', id: 'ch1', x: 320, y: 220, rotation: 2 },
    ]);

    expect(result).toBe(state);
  });

  it('preserves station equipment and relocates on-counter items without changing slots', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'dish', customerId: 'c1', state: 'on_service',
        serviceTableId: 'st1', serviceSlotIndex: 2, x: 210, y: 130,
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items' }],
    });

    const result = moveFixtures(state, [
      { type: 'kitchenStation', id: 'k1', x: 500, y: 120 },
      { type: 'serviceTable', id: 'st1', x: 500, y: 300 },
    ]);

    expect(result.kitchenStations[0]).toEqual({
      id: 'k1', equipmentId: 'eq1', x: 500, y: 120,
    });
    expect(result.serviceItems[0]).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 2, x: 570, y: 310,
    });
  });

  it('rolls preparation back when its kitchen station moves', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items' }],
      staff: [{
        id: 'cook1', role: 'cook', path: [{ x: 5, y: 6 }],
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      }],
      serviceItems: [{
        id: 'i1', kind: 'dish', customerId: 'c1', state: 'preparing', stationId: 'k1',
        assignedStaffId: 'cook1', preparationStartedAt: 50,
      }],
    });

    const result = moveFixtures(state, [
      { type: 'kitchenStation', id: 'k1', x: 500, y: 120 },
    ]);

    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', stationId: null, assignedStaffId: null, preparationStartedAt: null,
    });
    expect(result.staff[0]).toMatchObject({ task: null, path: [] });
  });

  it('returns the original state and preserves preparation for an unchanged kitchen station', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items' }],
      staff: [{
        id: 'cook1', role: 'cook', path: [{ x: 5, y: 6 }],
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      }],
      serviceItems: [{
        id: 'i1', kind: 'dish', customerId: 'c1', state: 'preparing', stationId: 'k1',
        assignedStaffId: 'cook1', preparationStartedAt: 50,
      }],
    });

    const result = moveFixtures(state, [
      { type: 'kitchenStation', id: 'k1', x: 100, y: 120 },
    ]);

    expect(result).toBe(state);
    expect(result.staff[0].task).toEqual({
      type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1',
    });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'preparing', stationId: 'k1', assignedStaffId: 'cook1',
      preparationStartedAt: 50,
    });
  });

  it('returns the original state and preserves washing for an unchanged wash station', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      washStations: [{ id: 'wash1', type: 'automatic', x: 300, y: 120, w: 40, h: 40 }],
      staff: [{
        id: 'washer', role: 'janitor', path: [{ x: 15, y: 6 }],
        task: { type: 'wash_item', serviceItemId: 'i1', washStationId: 'wash1' },
      }],
      serviceItems: [{
        id: 'i1', state: 'washing', washStationId: 'wash1', washStartedAt: 80,
      }],
    });

    const result = moveFixtures(state, [
      { type: 'washStation', id: 'wash1', x: 300, y: 120 },
    ]);

    expect(result).toBe(state);
    expect(result.staff[0].task).toEqual({
      type: 'wash_item', serviceItemId: 'i1', washStationId: 'wash1',
    });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'washing', washStationId: 'wash1', washStartedAt: 80,
    });
  });

  it('returns the original state and preserves table work for an unchanged table', () => {
    const state = makeState({
      staff: [{
        id: 'cleaner', role: 'waiter', path: [{ x: 200, y: 180 }],
        task: { type: 'clean_table', tableId: 't1' },
      }],
    });

    const result = moveFixtures(state, [
      { type: 'table', id: 't1', x: 200, y: 200 },
    ]);

    expect(result).toBe(state);
    expect(result.staff[0].task).toEqual({ type: 'clean_table', tableId: 't1' });
    expect(result.staff[0].path).toEqual([{ x: 200, y: 180 }]);
  });

  it('filters unchanged fixtures from a mixed move before cancelling active work', () => {
    const state = makeState({
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items' }],
      staff: [
        {
          id: 'cleaner', role: 'waiter', path: [{ x: 200, y: 180 }],
          task: { type: 'clean_table', tableId: 't1' },
        },
        {
          id: 'cook1', role: 'cook', path: [{ x: 5, y: 6 }],
          task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
        },
      ],
      serviceItems: [{
        id: 'i1', kind: 'dish', customerId: 'c1', state: 'preparing', stationId: 'k1',
        assignedStaffId: 'cook1', preparationStartedAt: 50,
      }],
    });

    const result = moveFixtures(state, [
      { type: 'table', id: 't1', x: 300, y: 240 },
      { type: 'kitchenStation', id: 'k1', x: 100, y: 120 },
    ]);

    expect(result).not.toBe(state);
    expect(result.tables[0]).toMatchObject({ x: 300, y: 240 });
    expect(result.kitchenStations[0]).toBe(state.kitchenStations[0]);
    expect(result.staff[0]).toMatchObject({ task: null, path: [] });
    expect(result.staff[1]).toMatchObject({
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      path: [{ x: 5, y: 6 }],
    });
    expect(result.serviceItems[0]).toBe(state.serviceItems[0]);
  });

  it('does not cancel cashier work when a kitchen station has an identical ID', () => {
    const state = makeCollidingStationState();

    const result = moveFixtures(state, [
      { type: 'kitchenStation', id: 'shared', x: 500, y: 120 },
    ]);

    expect(result.staff[0]).toMatchObject({ task: null, path: [] });
    expect(result.staff[1]).toMatchObject({
      task: { type: 'take_payment', customerId: 'payer', stationId: 'shared' },
      path: [{ x: 40, y: 8 }],
    });
    expect(result.customers[1]).toMatchObject({
      path: [{ x: 42, y: 9 }], checkoutPosition: { x: 840, y: 180 },
    });
  });

  it('does not cancel kitchen work when a cashier station has an identical ID', () => {
    const state = makeCollidingStationState();

    const result = moveFixtures(state, [
      { type: 'cashierTable', id: 'shared', x: 600, y: 300 },
    ]);

    expect(result.staff[0]).toMatchObject({
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'shared' },
      path: [{ x: 5, y: 6 }],
    });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'preparing', stationId: 'shared', assignedStaffId: 'cook',
      preparationStartedAt: 50,
    });
    expect(result.staff[1]).toMatchObject({ task: null, path: [] });
    expect(result.customers[1]).toMatchObject({ path: [], checkoutPosition: null });
  });

  it('requeues washing work without retaining a moved wash station', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      washStations: [{ id: 'wash1', type: 'automatic', x: 300, y: 120, w: 40, h: 40 }],
      serviceItems: [
        { id: 'i1', state: 'washing', washStationId: 'wash1', washStartedAt: 80 },
        { id: 'i2', state: 'queued_for_wash', washStationId: 'wash1', washStartedAt: 90 },
      ],
    });

    const result = moveFixtures(state, [
      { type: 'washStation', id: 'wash1', x: 500, y: 120 },
    ]);

    expect(result.serviceItems).toEqual([
      { id: 'i1', state: 'queued_for_wash', washStationId: null, washStartedAt: null },
      { id: 'i2', state: 'queued_for_wash', washStationId: null, washStartedAt: null },
    ]);
  });

  it('cancels payment routing when a cashier moves but preserves its assigned waiter', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'waiter1',
      }],
      staff: [{
        id: 'waiter1', role: 'waiter', path: [{ x: 40, y: 8 }],
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' },
      }],
      customers: [{
        id: 'c1', state: 'checkout_processing', cashierStationId: 'cashier1', paymentReady: true,
        path: [{ x: 42, y: 9 }], checkoutPosition: { x: 840, y: 180 }, paymentQueuedAt: 10,
      }],
    });

    const result = moveFixtures(state, [
      { type: 'cashierTable', id: 'cashier1', x: 600, y: 300 },
    ]);

    expect(result.cashierStations[0]).toMatchObject({
      x: 600, y: 300, assignedStaffId: 'waiter1',
    });
    expect(result.staff[0]).toMatchObject({ task: null, path: [] });
    expect(result.customers[0]).toMatchObject({
      state: 'checkout_queued', cashierStationId: null, checkoutPosition: null,
      paymentReady: false, path: [], paymentQueuedAt: 10,
    });
  });

  it('clears stale routing for an idle waiter assigned to a moved cashier', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'waiter1',
      }],
      staff: [{
        id: 'waiter1', role: 'waiter', task: null, path: [{ x: 840, y: 100 }], stalledFor: 7,
        pathGoal: { x: 840, y: 100 }, usingStaticFallback: true, minimumSpacing: 6,
        localConflictTarget: { x: 820, y: 100 }, headOnRecovery: true,
        recoveredHeadOnDetourTarget: { x: 800, y: 100 },
      }],
    });

    const result = moveFixtures(state, [
      { type: 'cashierTable', id: 'cashier1', x: 600, y: 300 },
    ]);

    expect(result.cashierStations[0]).toMatchObject({
      x: 600, y: 300, assignedStaffId: 'waiter1',
    });
    expect(result.staff[0]).toMatchObject({ task: null, path: [], stalledFor: 0 });
    for (const field of [
      'pathGoal',
      'usingStaticFallback',
      'minimumSpacing',
      'localConflictTarget',
      'headOnRecovery',
      'recoveredHeadOnDetourTarget',
    ]) {
      expect(result.staff[0]).not.toHaveProperty(field);
    }
  });

  it('cancels work tied to moved tables, seated customers, and service counters', () => {
    const recovery = {
      stalledFor: 7, pathGoal: { x: 1, y: 1 }, usingStaticFallback: true, minimumSpacing: 6,
      localConflictTarget: { x: 2, y: 2 }, headOnRecovery: true,
      recoveredHeadOnDetourTarget: { x: 3, y: 3 },
    };
    const state = makeState({
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      customers: [
        {
          id: 'c1', state: 'seated', tableId: 't1', chairId: 'ch1', x: 220, y: 190,
          path: [{ x: 1, y: 1 }], ...recovery,
        },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water' },
      ],
      staff: [
        { id: 'w1', role: 'waiter', task: { type: 'clean_table', tableId: 't1' }, path: [{ x: 1, y: 1 }], ...recovery },
        {
          id: 'w2', role: 'waiter', carryingServiceItemId: 'i3',
          task: { type: 'deliver_service_item', serviceItemId: 'i3', customerId: 'c1' },
          path: [{ x: 1, y: 1 }],
        },
        { id: 'w3', role: 'waiter', task: { type: 'prepare_drink', serviceItemId: 'i2', serviceTableId: 'st1', serviceSlotIndex: 1 }, path: [{ x: 1, y: 1 }] },
      ],
      serviceItems: [
        {
          id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', state: 'ordered',
          serviceTableId: 'st1', serviceSlotIndex: 1, assignedStaffId: 'w3',
        },
        { id: 'i3', kind: 'dish', customerId: 'c1', tableId: 't1', state: 'carried' },
      ],
    });

    const result = moveFixtures(state, [
      { type: 'table', id: 't1', x: 300, y: 240 },
      { type: 'serviceTable', id: 'st1', x: 500, y: 120 },
    ]);

    expect(result.staff.every(worker => worker.task == null && worker.path.length === 0)).toBe(true);
    for (const field of Object.keys(recovery).filter(field => field !== 'stalledFor')) {
      expect(result.staff[0]).not.toHaveProperty(field);
      expect(result.customers[0]).not.toHaveProperty(field);
    }
    expect(result.staff[0].stalledFor).toBe(0);
    expect(result.customers[0].stalledFor).toBe(0);
    expect(result.serviceItems[0]).toMatchObject({
      serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
    });
    expect(result.staff[1]).toMatchObject({ task: null, carryingServiceItemId: 'i3' });
    expect(result.serviceItems[1]).toMatchObject({ id: 'i3', state: 'carried' });
  });

  it('rotates a service counter and repositions its on-counter items', () => {
    const state = makeState({
      serviceTables: [{ id: 'st1', x: 400, y: 120 }],
      serviceItems: [{
        id: 'i1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 1,
        x: 180, y: 130,
      }],
    });

    const result = moveFixtures(state, [
      { type: 'serviceTable', id: 'st1', x: 400, y: 120, rotation: 1 },
    ]);

    expect(result.serviceTables[0]).toMatchObject({ rotation: 1 });
    expect(result.serviceItems[0]).toMatchObject({ x: 410, y: 160 });
  });

  it('invalidates all routed actors when a door moves and safely cancels guidance', () => {
    const state = makeState({
      tables: [
        { id: 't1', seats: 2, status: 'reserved', reservationOwnerStaffId: 'guide', x: 200, y: 200 },
        { id: 't2', seats: 1, status: 'reserved', reservationOwnerStaffId: 'other-guide', x: 400, y: 200 },
      ],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      washStations: [{ id: 'wash1', type: 'manual', x: 300, y: 120, w: 40, h: 40 }],
      staff: [
        {
          id: 'guide', role: 'waiter', path: [{ x: 10, y: 10 }],
          task: { type: 'guide_customer', customerIds: ['c1'], tableId: 't1', chairIds: ['ch1'] },
        },
        { id: 'janitor', role: 'janitor', path: [{ x: 11, y: 10 }], task: { type: 'clean_floor', dirtId: 'd1' } },
        { id: 'cook', role: 'cook', path: [{ x: 5, y: 6 }], task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' } },
        { id: 'washer', role: 'janitor', path: [{ x: 15, y: 6 }], task: { type: 'wash_item', serviceItemId: 'i2', washStationId: 'wash1' } },
      ],
      customers: [
        {
          id: 'c1', state: 'guided', guideStaffId: 'guide', tableId: 't1', chairId: null,
          x: 100, y: 200, path: [{ x: 10, y: 10 }],
        },
        { id: 'c2', state: 'paying', x: 700, y: 300, path: [{ x: 40, y: 10 }] },
        { id: 'c3', state: 'waiting_for_items' },
      ],
      serviceItems: [
        {
          id: 'i1', kind: 'dish', customerId: 'c3', state: 'preparing', stationId: 'k1',
          assignedStaffId: 'cook', preparationStartedAt: 50,
        },
        {
          id: 'i2', kind: 'dish', customerId: 'c3', state: 'washing', washStationId: 'wash1',
          washStartedAt: 75,
        },
      ],
    });

    const result = moveFixtures(state, [
      { type: 'door', id: 'door1', x: 907, y: 440 },
    ]);

    expect(result.staff.every(worker => worker.task == null && worker.path.length === 0)).toBe(true);
    expect(result.customers[0]).toMatchObject({
      state: 'waiting', guideStaffId: null, tableId: null, chairId: null, path: [],
    });
    expect(result.customers[1]).toMatchObject({ state: 'paying', path: [] });
    expect(result.tables[0]).toEqual({ id: 't1', seats: 2, status: 'empty', x: 200, y: 200 });
    expect(result.tables[1]).toMatchObject({
      status: 'reserved', reservationOwnerStaffId: 'other-guide',
    });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', stationId: null, assignedStaffId: null, preparationStartedAt: null,
    });
    expect(result.serviceItems[1]).toMatchObject({
      state: 'queued_for_wash', washStationId: 'wash1', washStartedAt: null,
    });
  });
});
