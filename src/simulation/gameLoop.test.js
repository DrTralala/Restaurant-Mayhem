import { afterEach, describe, it, expect, vi } from 'vitest';
import { runTick } from './gameLoop';
import { createInitialState } from '../state/initialState';

const emptyState = {
  restaurant: { funds: 500, gameTime: 100, day: 1, openHour: 10, closeHour: 22, totalServed: 0, reputation: 2.0 },
  paused: false,
  speed: 1,
  tables: [],
  kitchenStations: [],
  queue: [],
  customers: [],
  chairs: [],
  serviceItems: [],
  serviceTables: [],
  staff: [],
  dishes: [],
  equipment: [],
  upgrades: [],
  milestones: [],
  recipeSlots: 0,
  staffSlots: 0,
  completedCustomers: [],
  dailyHistory: [],
  notifications: [],
};

describe('runTick', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns same state when paused', () => {
    const state = { ...emptyState, paused: true };
    const result = runTick(state, 1);
    expect(result).toBe(state);
  });

  it('advances gameTime when not paused', () => {
    const result = runTick(emptyState, 5);
    expect(result.restaurant.gameTime).toBe(105);
  });

  it('applies speed multiplier', () => {
    const state = { ...emptyState, speed: 2 };
    const result = runTick(state, 5);
    expect(result.restaurant.gameTime).toBe(110); // 100 + 5 * 2
  });

  it('releases stale carried service items for cleanup without leaving a carrier reference', () => {
    const state = {
      ...emptyState,
      customers: [{
        id: 'c1', state: 'leaving', happiness: 40, patience: 0,
        dishId: 'd1', tableId: 't1', x: 200, y: 200, path: [],
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
        state: 'carried', x: 150, y: 130,
      }],
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, salary: 150,
        x: 180, y: 220, path: [], carryingServiceItemId: 'i1',
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' },
      }],
    };

    const result = runTick(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.serviceItems).toEqual([expect.objectContaining({ id: 'i1', state: 'to_clean' })]);
  });

  it("preserves another worker's carried service item through stale delivery cancellation", () => {
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 400, y: 400,
    };
    const state = {
      ...emptyState,
      customers: [{
        id: 'c1', state: 'ordering', happiness: 80, patience: 100,
        dishId: 'd1', tableId: 't1', x: 200, y: 200, path: [],
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      serviceItems: [item],
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, salary: 150,
          x: 180, y: 220, path: [], carryingServiceItemId: null,
          task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'missing' },
        },
        {
          id: 'w2', role: 'waiter', morale: 80, salary: 150,
          x: 400, y: 400, path: [{ x: 10, y: 10 }], carryingServiceItemId: 'i1',
          task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' },
        },
      ],
    };

    const result = runTick(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.staff[1]).toMatchObject({ carryingServiceItemId: 'i1' });
    expect(result.serviceItems).toEqual([item]);
  });

  function runServiceJourney(orderRoll) {
    vi.spyOn(Math, 'random').mockReturnValue(orderRoll);
    const customerId = `journey-${String(orderRoll).replace('.', '-')}`;
    const kindsForJourney = orderRoll < 0.75 ? ['dish'] : orderRoll < 0.95 ? ['dish', 'drink'] : ['drink'];
    let state = createInitialState();
    state = {
      ...state,
      queue: [{
        id: customerId, partyId: `${customerId}-party`, partySize: 1,
        partyType: 'solo', archetype: 'regular', gender: 'female', patience: 2000,
        happiness: 80, state: 'queued', dishId: null, tableId: null, chairId: null,
      }],
    };
    const seen = new Set();
    const deliveredKinds = new Set();
    const stages = new Set();
    const cleanedItemIds = new Set();
    const cleaningTasks = new Set();
    const journeyItemIds = new Set();
    const pickupTaskItemIds = new Set();
    const deliveryTaskItemIds = new Set();
    const removedAfterCleaningIds = new Set();
    let previousItems = new Map();
    let bothDelivered = false;
    let progressedAfterBoth = false;
    let elapsed = 0;
    let completed = false;
    for (; elapsed < 900; elapsed += 1) {
      state = runTick(state, 1);
      const customer = state.customers.find(candidate => candidate.id === customerId);
      const journeyItems = state.serviceItems.filter(candidate => candidate.customerId === customerId);
      for (const item of journeyItems) {
        journeyItemIds.add(item.id);
        seen.add(`${item.kind}:${item.state}`);
        if (item.state === 'to_clean') cleanedItemIds.add(item.id);
      }
      for (const id of previousItems.keys()) {
        if (!journeyItems.some(item => item.id === id) && cleaningTasks.has(id)) removedAfterCleaningIds.add(id);
      }
      if (customer) {
        seen.add(`customer:${customer.state}:${customer.exitPhase || ''}`);
        if (customer.state === 'seated') stages.add('seated');
        if (customer.state === 'waiting_for_items') stages.add('waiting_for_items');
        if (customer.state === 'eating') stages.add('eating');
        if (customer.state === 'paying') stages.add('paying');
        if (customer.state === 'leaving' && customer.departureReason) stages.add(`departure:${customer.departureReason}`);
      }
      for (const staff of state.staff) {
        const task = staff.task;
        if (task?.customerId === customerId && task.type === 'take_order') stages.add('take_order');
        if (task?.customerId === customerId && task.type === 'take_payment') stages.add('take_payment');
        if (task?.serviceItemId && journeyItems.some(item => item.id === task.serviceItemId)) {
          if (task.type === 'prepare_dish') stages.add('prepare_dish');
          if (task.type === 'pickup_service_item') {
            stages.add(`pickup:${task.serviceItemId}`);
            pickupTaskItemIds.add(task.serviceItemId);
          }
          if (task.type === 'deliver_service_item') {
            stages.add(`deliver:${task.serviceItemId}`);
            deliveryTaskItemIds.add(task.serviceItemId);
          }
          if (task.type === 'clean_service_item') {
            stages.add(`clean:${task.serviceItemId}`);
            cleaningTasks.add(task.serviceItemId);
          }
        }
      }
      for (const item of journeyItems) {
        if (item.state !== 'delivered' || previousItems.get(item.id) === 'delivered') continue;
        deliveredKinds.add(item.kind);
      }
      if (kindsForJourney.length === 2 && deliveredKinds.size === 1) {
        expect(customer).toBeDefined();
        expect(customer.state).toBe('waiting_for_items');
      }
      if (deliveredKinds.size === 2) {
        bothDelivered = true;
        stages.add('both_delivered');
        if (customer?.state !== 'waiting_for_items') progressedAfterBoth = true;
      }
      previousItems = new Map(journeyItems.map(item => [item.id, item.state]));
      const ownerKinds = state.serviceItems.map(item => `${item.customerId}:${item.kind}`);
      expect(new Set(ownerKinds).size).toBe(ownerKinds.length);
      expect(state.serviceItems.every(item => typeof item.customerId === 'string')).toBe(true);
      const occupiedSlots = state.serviceItems.filter(item => item.state === 'on_service').map(item => `${item.serviceTableId}:${item.serviceSlotIndex}`);
      expect(new Set(occupiedSlots).size).toBe(occupiedSlots.length);
      for (const staff of state.staff) if (staff.carryingServiceItemId !== null && staff.carryingServiceItemId !== undefined) expect(state.serviceItems).toContainEqual(expect.objectContaining({ id: staff.carryingServiceItemId, state: 'carried' }));
      if (!customer && state.restaurant.totalServed === 1) { completed = true; break; }
    }
    return {
      state, customerId, seen, deliveredKinds, stages, cleaningTasks, cleanedItemIds,
      journeyItemIds, pickupTaskItemIds, deliveryTaskItemIds, removedAfterCleaningIds,
      bothDelivered, progressedAfterBoth, elapsed: elapsed + 1, completed,
    };
  }

  it.each([[0.5, ['dish'], 14.4], [0.8, ['dish', 'drink'], 16.8], [0.97, ['drink'], 2.4]])('completes the %j fresh-game service journey', (roll, kinds, expectedRevenue) => {
    const {
      state, seen, deliveredKinds, stages, cleaningTasks, cleanedItemIds, journeyItemIds,
      pickupTaskItemIds, deliveryTaskItemIds, removedAfterCleaningIds,
      bothDelivered, progressedAfterBoth, elapsed, completed,
    } = runServiceJourney(roll);
    for (const kind of kinds) for (const status of ['on_service', 'carried', 'delivered', 'to_clean']) expect(seen).toContain(`${kind}:${status}`);
    if (kinds.includes('drink')) expect(seen).toContain('drink:preparing');
    expect(seen).toContain('customer:leaving:fading');
    expect(state.restaurant.totalServed).toBe(1);
    expect(state.restaurant.dailyRevenue).toBeCloseTo(expectedRevenue);
    expect(state.customers).toEqual([]);
    expect(state.serviceItems).toEqual([]);
    expect(completed).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(900);
    expect(deliveredKinds).toEqual(new Set(kinds));
    for (const stage of ['seated', 'waiting_for_items', 'eating', 'paying', 'departure:served']) {
      expect(stages).toContain(stage);
    }
    expect(stages.has('take_order')).toBe(true);
    expect(stages.has('take_payment')).toBe(true);
    expect(bothDelivered).toBe(kinds.length === 2 ? true : false);
    expect(progressedAfterBoth).toBe(kinds.length === 2 ? true : false);
    expect(stages.has('prepare_dish')).toBe(kinds.includes('dish'));
    expect(kinds.every(kind => [...seen].some(entry => entry === `${kind}:delivered`))).toBe(true);
    expect(pickupTaskItemIds).toEqual(journeyItemIds);
    expect(deliveryTaskItemIds).toEqual(journeyItemIds);
    expect(cleanedItemIds).toEqual(journeyItemIds);
    expect(cleaningTasks).toEqual(journeyItemIds);
    expect(removedAfterCleaningIds).toEqual(journeyItemIds);
  });

  it('lets a newly purchased second cashier station process payment alongside the staffed starter station', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const initial = createInitialState();
    let state = {
      ...initial,
      tables: initial.tables.map(table => ['t1', 't2'].includes(table.id)
        ? { ...table, status: 'occupied' }
        : table),
      cashierStations: [
        initial.cashierStations[0],
        { id: 'cashier2', x: 600, y: 300, w: 80, h: 40, assignedStaffId: 'starter-waiter' },
      ],
      customers: [
        {
          id: 'c1', state: 'paying', x: 780, y: 140, patience: 100,
          happiness: 80, paymentQueuedAt: 10, dishId: 'starter-toast', tableId: 't1',
        },
        {
          id: 'c2', state: 'paying', x: 580, y: 320, patience: 100,
          happiness: 80, paymentQueuedAt: 20, dishId: 'starter-toast', tableId: 't2',
        },
      ],
    };
    let secondStationTookPayment = false;

    for (let tick = 0; tick < 2; tick += 1) {
      state = runTick(state, 0);
      secondStationTookPayment ||= state.staff.some(staff =>
        staff.id === 'starter-waiter'
          && staff.task?.type === 'take_payment'
          && staff.task.stationId === 'cashier2'
          && staff.task.customerId === 'c2');
    }

    expect(secondStationTookPayment).toBe(true);
    expect(state.customers.find(customer => customer.id === 'c2'))
      .toMatchObject({ state: 'leaving', departureReason: 'served' });
    expect(state.restaurant.totalServed).toBe(2);
  });
});
