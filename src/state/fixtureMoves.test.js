import { describe, expect, it } from 'vitest';
import { moveFixtures } from './fixtureMoves';
import { advanceCharacterMovementBatch } from '../simulation/movement';
import { createGrid } from '../simulation/navigation/grid';

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
    doors: [{ id: 'door1', y: 340, role: 'entrance' }],
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
        navigationGoal: { x: 840, y: 180 }, checkoutPosition: { x: 840, y: 180 },
      },
    ],
    staff: [
      {
        id: 'cook', role: 'cook', navigationGoal: { x: 100, y: 120 },
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'shared' },
      },
      {
        id: 'cashier', role: 'waiter', navigationGoal: { x: 800, y: 160 },
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
        navigationGoal: { x: 240, y: 200 },
      }],
    });

    const result = moveFixtures(state, [{ type: 'table', id: 't1', x: 300, y: 240 }]);

    expect(result.tables[0]).toMatchObject({ x: 300, y: 240 });
    expect(result.chairs).toEqual([
      { id: 'ch1', tableId: 't1', x: 310, y: 220, rotation: 2 },
      { id: 'ch2', tableId: 't1', x: 310, y: 280, rotation: 0 },
    ]);
    expect(result.customers[0]).toMatchObject({
      id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1', x: 320, y: 230,
    });
    expect(result.customers[0]).not.toHaveProperty('navigationGoal');
  });

  it('moves only the occupant of a chair moved independently', () => {
    const state = makeState({
      customers: [
        { id: 'c1', state: 'seated', tableId: 't1', chairId: 'ch1', x: 220, y: 190 },
        { id: 'c2', state: 'seated', tableId: 't1', chairId: 'ch2', x: 220, y: 250 },
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
        x: 220, y: 190, navigationGoal: { x: 400, y: 400 },
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
        id: 'cook1', role: 'cook', navigationGoal: { x: 100, y: 120 },
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
    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
  });

  it('returns the original state and preserves preparation for an unchanged kitchen station', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items' }],
      staff: [{
        id: 'cook1', role: 'cook', navigationGoal: { x: 100, y: 120 },
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
        id: 'washer', role: 'janitor', navigationGoal: { x: 300, y: 120 },
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
        id: 'cleaner', role: 'waiter', navigationGoal: { x: 200, y: 180 },
        task: { type: 'clean_table', tableId: 't1' },
      }],
    });

    const result = moveFixtures(state, [
      { type: 'table', id: 't1', x: 200, y: 200 },
    ]);

    expect(result).toBe(state);
    expect(result.staff[0].task).toEqual({ type: 'clean_table', tableId: 't1' });
    expect(result.staff[0].navigationGoal).toEqual({ x: 200, y: 180 });
  });

  it('filters unchanged fixtures from a mixed move before cancelling active work', () => {
    const state = makeState({
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items' }],
      staff: [
        {
          id: 'cleaner', role: 'waiter', navigationGoal: { x: 200, y: 180 },
          task: { type: 'clean_table', tableId: 't1' },
        },
        {
          id: 'cook1', role: 'cook', navigationGoal: { x: 100, y: 120 },
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
    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.staff[1]).toMatchObject({
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      navigationGoal: { x: 100, y: 120 },
    });
    expect(result.serviceItems[0]).toBe(state.serviceItems[0]);
  });

  it('does not cancel cashier work when a kitchen station has an identical ID', () => {
    const state = makeCollidingStationState();

    const result = moveFixtures(state, [
      { type: 'kitchenStation', id: 'shared', x: 500, y: 120 },
    ]);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.staff[1]).toMatchObject({
      task: { type: 'take_payment', customerId: 'payer', stationId: 'shared' },
      navigationGoal: { x: 800, y: 160 },
    });
    expect(result.customers[1]).toMatchObject({
      navigationGoal: { x: 840, y: 180 }, checkoutPosition: { x: 840, y: 180 },
    });
  });

  it('does not cancel kitchen work when a cashier station has an identical ID', () => {
    const state = makeCollidingStationState();

    const result = moveFixtures(state, [
      { type: 'cashierTable', id: 'shared', x: 600, y: 300 },
    ]);

    expect(result.staff[0]).toMatchObject({
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'shared' },
      navigationGoal: { x: 100, y: 120 },
    });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'preparing', stationId: 'shared', assignedStaffId: 'cook',
      preparationStartedAt: 50,
    });
    expect(result.staff[1].task).toBeNull();
    expect(result.staff[1]).not.toHaveProperty('navigationGoal');
    expect(result.customers[1]).toMatchObject({ checkoutPosition: null });
    expect(result.customers[1]).not.toHaveProperty('navigationGoal');
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
        id: 'waiter1', role: 'waiter', navigationGoal: { x: 800, y: 160 },
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' },
      }],
      customers: [{
        id: 'c1', state: 'checkout_processing', cashierStationId: 'cashier1', paymentReady: true,
        navigationGoal: { x: 840, y: 180 }, checkoutPosition: { x: 840, y: 180 }, paymentQueuedAt: 10,
      }],
    });

    const result = moveFixtures(state, [
      { type: 'cashierTable', id: 'cashier1', x: 600, y: 300 },
    ]);

    expect(result.cashierStations[0]).toMatchObject({
      x: 600, y: 300, assignedStaffId: 'waiter1',
    });
    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.customers[0]).toMatchObject({
      state: 'checkout_queued', cashierStationId: null, checkoutPosition: null,
      paymentReady: false, paymentQueuedAt: 10,
    });
    expect(result.customers[0]).not.toHaveProperty('navigationGoal');
  });

  it('cancels an idle assigned waiter goal without scrubbing unrelated actor fields', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'waiter1',
      }],
      staff: [{
        id: 'waiter1', role: 'waiter', task: null,
        navigationGoal: { x: 840, y: 100 },
      }],
    });

    const result = moveFixtures(state, [
      { type: 'cashierTable', id: 'cashier1', x: 600, y: 300 },
    ]);

    expect(result.cashierStations[0]).toMatchObject({
      x: 600, y: 300, assignedStaffId: 'waiter1',
    });
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    const { navigationGoal: _navigationGoal, ...unchanged } = state.staff[0];
    expect(result.staff[0]).toEqual({ ...unchanged, carryingServiceItemIds: [] });
  });

  it('cancels work tied to moved tables, seated customers, and service counters', () => {
    const state = makeState({
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      customers: [
        {
          id: 'c1', state: 'seated', tableId: 't1', chairId: 'ch1', x: 220, y: 190,
          navigationGoal: { x: 20, y: 20 },
        },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water' },
      ],
      staff: [
        { id: 'w1', role: 'waiter', task: { type: 'clean_table', tableId: 't1' }, navigationGoal: { x: 20, y: 20 } },
        {
          id: 'w2', role: 'waiter', carryingServiceItemId: 'i3',
          task: { type: 'deliver_service_item', serviceItemId: 'i3', customerId: 'c1' },
          navigationGoal: { x: 20, y: 20 },
        },
        { id: 'w3', role: 'cook', task: { type: 'prepare_drink', serviceItemId: 'i2', serviceTableId: 'st1', serviceSlotIndex: 1 }, navigationGoal: { x: 20, y: 20 } },
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

    expect(result.staff.every(worker => worker.task == null && !worker.navigationGoal)).toBe(true);
    expect(result.customers[0]).not.toHaveProperty('navigationGoal');
    expect(result.serviceItems[0]).toMatchObject({
      serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
    });
    expect(result.staff[1]).toMatchObject({ task: null, carryingServiceItemIds: ['i3'] });
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

  it('invalidates routed actors when a door moves and preserves self-seating reservations', () => {
    const state = makeState({
      tables: [
        {
          id: 't1', seats: 2, status: 'reserved', x: 200, y: 200,
          diningPartyId: 'p1', diningCustomerIds: ['c1'],
          seatingAssignments: [{
            customerId: 'c1', chairId: 'ch1',
            approachCell: { x: 9, y: 9 }, approachPoint: { x: 180, y: 180 },
          }],
        },
        { id: 't2', seats: 1, status: 'reserved', x: 400, y: 200 },
      ],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      washStations: [{ id: 'wash1', type: 'manual', x: 300, y: 120, w: 40, h: 40 }],
      staff: [
        { id: 'waiter', role: 'waiter', navigationGoal: { x: 224, y: 200 }, task: { type: 'take_order', customerId: 'c2' } },
        { id: 'janitor', role: 'janitor', navigationGoal: { x: 220, y: 200 }, task: { type: 'clean_floor', dirtId: 'd1' } },
        { id: 'cook', role: 'cook', navigationGoal: { x: 100, y: 120 }, task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' } },
        { id: 'washer', role: 'janitor', navigationGoal: { x: 300, y: 120 }, task: { type: 'wash_item', serviceItemId: 'i2', washStationId: 'wash1' } },
      ],
      customers: [
        {
          id: 'c1', state: 'entering', tableId: 't1', chairId: 'ch1',
          x: 180, y: 180, navigationGoal: { x: 180, y: 180 },
        },
        { id: 'c2', state: 'paying', x: 700, y: 300, navigationGoal: { x: 800, y: 200 } },
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

    expect(result.queueAdmissionGate ?? null).toBeNull();
    expect(result.staff.every(worker => worker.task == null && !worker.navigationGoal)).toBe(true);
    expect(result.customers[0]).toMatchObject({ state: 'entering', tableId: 't1', chairId: 'ch1' });
    expect(result.customers[1]).toMatchObject({ state: 'paying' });
    expect(result.customers[1]).not.toHaveProperty('navigationGoal');
    expect(result.tables[0]).toMatchObject({
      id: 't1', status: 'reserved', diningPartyId: 'p1', diningCustomerIds: ['c1'],
    });
    expect(result.tables[1]).toMatchObject({ id: 't2', status: 'reserved' });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', stationId: null, assignedStaffId: null, preparationStartedAt: null,
    });
    expect(result.serviceItems[1]).toMatchObject({
      state: 'queued_for_wash', washStationId: 'wash1', washStartedAt: null,
    });
  });

  it('invalidates only the gate whose own door moved', () => {
    const base = makeState({
      doors: [
        { id: 'door1', y: 340, role: 'entrance' },
        { id: 'door2', y: 180, role: 'entrance' },
      ],
      tables: [{
        id: 't1', seats: 1, status: 'reserved', x: 200, y: 200,
        diningPartyId: 'p1', diningCustomerIds: ['c1'],
        seatingAssignments: [{
          customerId: 'c1', chairId: 'ch1',
          approachCell: { x: 9, y: 9 }, approachPoint: { x: 180, y: 180 },
        }],
      }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 }],
      customers: [{
        id: 'c1', partyId: 'p1', state: 'entering', tableId: 't1', chairId: 'ch1',
        x: 1000, y: 360, navigationGoal: { x: 1000, y: 360 },
      }],
      queueAdmissionGate: { partyId: 'p1', customerIds: ['c1'], tableId: 't1', doorId: 'door1' },
    });

    const unrelated = moveFixtures(base, [{ type: 'door', id: 'door2', x: 907, y: 200 }]);
    expect(unrelated.queueAdmissionGate).toEqual(base.queueAdmissionGate);

    const matching = moveFixtures(base, [{ type: 'door', id: 'door1', x: 907, y: 440 }]);
    expect(matching.queueAdmissionGate).toBeNull();
  });

  it('reroutes around a moved fixture while independent traffic keeps moving', () => {
    let state = makeState({ tables: [], chairs: [],
      serviceTables: [{ id: 'counter', x: 400, y: 500 }],
      staff: [
        { id: 'a', x: 100, y: 200, navigationGoal: { x: 500, y: 200 } },
        { id: 'b', x: 100, y: 400, navigationGoal: { x: 500, y: 400 } },
      ],
    });
    const batch = input => advanceCharacterMovementBatch(input,
      input.staff.map(character => ({ character, speed: 40 })), 0.1);
    const installed = batch(state);
    expect(installed.coordinator.plans.size).toBe(2);
    state = { ...state, staff: state.staff.map(actor => installed.moved.get(actor.id)), movementCoordinator: installed.coordinator };
    const originalGeometry = JSON.stringify([...installed.coordinator.plans]);
    const edited = moveFixtures(state, [{ type: 'serviceTable', id: 'counter', x: 280, y: 180 }]);
    expect(edited).not.toBe(state);
    expect(edited.movementCoordinator).toBe(state.movementCoordinator);
    let current = edited;
    for (let tick = 0; tick < 140; tick += 1) {
      const result = batch(current);
      if (tick === 0) expect(result.moved.get('b').x).toBeGreaterThan(current.staff[1].x);
      const grid = createGrid(current);
      for (const trajectory of result.trajectories.values()) for (const segment of trajectory) {
        expect(grid.segmentClear(segment.start, segment.end)).toBe(true);
        expect(Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y)).toBeLessThanOrEqual(4 + 1e-9);
      }
      current = { ...current, staff: current.staff.map(actor => result.moved.get(actor.id)), movementCoordinator: result.coordinator };
    }
    expect(current.staff[0]).toMatchObject({ x: 500, y: 200 });
    expect(current.staff[1]).toMatchObject({ x: 500, y: 400 });
    expect(JSON.stringify([...installed.coordinator.plans])).toBe(originalGeometry);
  });
});
