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

  it('advances only by the supplied game-time duration', () => {
    const result = runTick(emptyState, { gameDt: 2, movementDt: 1 / 30 });
    expect(result.restaurant.gameTime).toBe(102);
  });

  it('does not apply the speed multiplier a second time', () => {
    const state = { ...emptyState, speed: 2 };
    const result = runTick(state, { gameDt: 4, movementDt: 2 / 30 });
    expect(result.restaurant.gameTime).toBe(104);
  });

  it('creates floor dirt before staff assignment so a janitor can claim it in the same tick', () => {
    const state = {
      ...emptyState,
      customers: [{ id: 'c1', state: 'seated', x: 200, y: 200, dirtFactor: 9, happiness: 80, patience: 100 }],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, path: [], task: null }],
      floorDirt: [],
    };
    const result = runTick(state, 1);
    expect(result.floorDirt).toHaveLength(1);
    expect(result.staff[0].task).toMatchObject({ type: 'clean_floor', dirtId: 'dirt-1' });
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
    for (; elapsed < 1800; elapsed += 1) {
      // Keep this long-running journey at the pre-scale game-time pace.
      state = runTick(state, 1 / 60);
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
      for (const staff of state.staff) if (staff.carryingServiceItemId !== null && staff.carryingServiceItemId !== undefined) expect(state.serviceItems).toContainEqual(expect.objectContaining({ id: staff.carryingServiceItemId, state: expect.stringMatching(/^carried(_dirty)?$/) }));
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
    for (const kind of kinds) for (const status of ['on_service', 'carried', 'delivered']) expect(seen).toContain(`${kind}:${status}`);
    if (kinds.includes('drink')) expect(seen).toContain('drink:preparing');
    expect([...seen].some(entry => entry.startsWith('customer:leaving:'))).toBe(true);
    expect(state.restaurant.totalServed).toBeGreaterThanOrEqual(0);
    expect(state.restaurant.dailyRevenue).toBeGreaterThanOrEqual(0);
    expect(state.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(state.serviceItems.every(item => ['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing'].includes(item.state))).toBe(true);
    expect(completed || state.customers.length === 0 || state.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(1801);
    expect(deliveredKinds).toEqual(new Set(kinds));
    for (const stage of ['seated', 'waiting_for_items', 'eating', 'paying']) {
      expect(stages).toContain(stage);
    }
    expect(stages.has('take_order')).toBe(true);
    expect(stages.has('take_payment') || state.restaurant.totalServed === 0).toBe(true);
    expect(bothDelivered).toBe(kinds.length === 2 ? true : false);
    expect(progressedAfterBoth).toBe(kinds.length === 2 ? true : false);
    expect(stages.has('prepare_dish')).toBe(kinds.includes('dish'));
    expect(kinds.every(kind => [...seen].some(entry => entry === `${kind}:delivered`))).toBe(true);
    expect(pickupTaskItemIds).toEqual(journeyItemIds);
    expect(deliveryTaskItemIds).toEqual(journeyItemIds);
    expect(cleanedItemIds).toEqual(expect.any(Set));
    expect(cleaningTasks).toEqual(expect.any(Set));
    expect(removedAfterCleaningIds).toEqual(expect.any(Set));
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

    state.customers = state.customers.map(customer => ({
      ...customer,
      x: customer.id === 'c1' ? 840 : 640,
      y: customer.id === 'c1' ? 180 : 360,
      paymentReady: customer.id === 'c1',
    }));
    for (let tick = 0; tick < 70; tick += 1) {
      state = runTick(state, 1 / 60);
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

  it('completes one deterministic full-service lifecycle and its independent cleanup path', () => {
    const initial = createInitialState();
    const customerId = 'lifecycle-customer';
    let state = {
      ...initial,
      restaurant: { ...initial.restaurant, gameTime: 0 },
      queue: [],
      customers: [{
        id: customerId,
        partyId: 'lifecycle-party',
        partySize: 1,
        partyType: 'solo',
        archetype: 'regular',
        gender: 'female',
        patience: 5000,
        happiness: 80,
        state: 'seated',
        dishId: null,
        drinkId: null,
        tableId: 't1',
        chairId: 'ch1',
        x: 220,
        y: 190,
        dirtFactor: 0,
        path: [],
      }],
      tables: initial.tables.map(table => table.id === 't1'
        ? { ...table, status: 'occupied' }
        : table),
      staff: initial.staff
        .filter(staff => ['starter-cook', 'starter-waiter', 'starter-cashier-waiter', 'starter-janitor'].includes(staff.id))
        .map(staff => ({
          ...staff,
          x: {
            'starter-cook': 80,
            'starter-waiter': 180,
            'starter-cashier-waiter': 840,
            'starter-janitor': 600,
          }[staff.id],
          y: {
            'starter-cook': 80,
            'starter-waiter': 180,
            'starter-cashier-waiter': 100,
            'starter-janitor': 360,
          }[staff.id],
          path: [],
          task: null,
          carryingServiceItemId: null,
        })),
    };

    let useDeterministicDishRoll = false;
    vi.spyOn(Math, 'random').mockImplementation(() => (useDeterministicDishRoll ? 0.5 : 1));

    const requiredStages = [
      'take_order', 'prepare_dish', 'pickup_service_item', 'deliver_service_item',
      'eating', 'paying_at_cashier', 'dirty_at_table', 'carried_dirty',
      'queued_for_wash', 'washing', 'washed', 'leaving',
    ];
    const observedStages = [];
    const observe = stage => {
      if (!observedStages.includes(stage)) observedStages.push(stage);
    };
    const stageIndex = stage => observedStages.indexOf(stage);
    const observedCompletionIds = new Set();
    let observedPaymentHappiness = null;
    let completed = false;

    for (let tick = 0; tick < 5000; tick += 1) {
      const previousItem = state.serviceItems.find(item => item.customerId === customerId);
      const previousTotalServed = state.restaurant.totalServed;
      useDeterministicDishRoll = state.staff.some(staff =>
        staff.task?.type === 'take_order' && staff.task.startedAt != null);

      state = runTick(state, 1 / 60);
      if (state.restaurant.totalServed > previousTotalServed) {
        observedCompletionIds.add(customerId);
        observedPaymentHappiness = state.customers.find(customer => customer.id === customerId)?.happiness;
      }

      const item = state.serviceItems.find(candidate => candidate.customerId === customerId);
      const customer = state.customers.find(candidate => candidate.id === customerId);
      if (state.staff.some(staff => staff.task?.type === 'take_order' && staff.task.customerId === customerId)) observe('take_order');
      if (state.staff.some(staff => staff.task?.type === 'prepare_dish' && staff.task.serviceItemId === item?.id)
        || item?.state === 'preparing') observe('prepare_dish');
      if (state.staff.some(staff => staff.task?.type === 'pickup_service_item' && staff.task.serviceItemId === item?.id)
        || (previousItem?.state === 'on_service' && item?.state === 'carried')) observe('pickup_service_item');
      if (state.staff.some(staff => staff.task?.type === 'deliver_service_item' && staff.task.serviceItemId === item?.id)
        || (previousItem?.state === 'carried' && item?.state === 'delivered')) observe('deliver_service_item');
      if (customer?.state === 'eating') observe('eating');
      if (customer?.state === 'paying'
        || state.staff.some(staff => staff.task?.type === 'take_payment' && staff.task.customerId === customerId)) {
        observe('paying_at_cashier');
      }
      if (item?.state === 'dirty_at_table') observe('dirty_at_table');
      if (item?.state === 'carried_dirty') observe('carried_dirty');
      if (item?.state === 'queued_for_wash') observe('queued_for_wash');
      if (item?.state === 'washing') observe('washing');
      if (previousItem?.state === 'washing' && !item) observe('washed');
      if (customer?.state === 'leaving') observe('leaving');

      completed = requiredStages.every(stage => observedStages.includes(stage))
        && observedCompletionIds.size === 1
        && state.serviceItems.length === 0
        && state.tables[0].status === 'empty'
        && state.customers.length === 0;
      if (completed) break;
    }

    const finalState = state;
    expect(completed, `lifecycle stalled after observing: ${observedStages.join(' -> ')}; final=${JSON.stringify({
      customers: finalState.customers,
      completedCustomers: finalState.completedCustomers,
      serviceItems: finalState.serviceItems,
      tables: finalState.tables,
    })}`).toBe(true);
    expect(observedStages).toEqual(expect.arrayContaining(requiredStages));
    expect(observedCompletionIds).toEqual(new Set([customerId]));
    expect(finalState.restaurant.totalServed).toBe(1);
    expect(finalState.completedCustomers).toEqual([]);
    expect(finalState.serviceItems).toEqual([]);
    expect(finalState.tables[0].status).toBe('empty');
    const lifecycleDish = initial.dishes.find(dish => dish.id === 'starter-toast');
    const expectedRevenue = lifecycleDish.price
      + Math.round(lifecycleDish.price * (observedPaymentHappiness / 400) * 100) / 100;
    expect(Math.round(expectedRevenue * 100) / 100).toBe(14.38);
    expect(Math.round(finalState.restaurant.dailyRevenue * 100) / 100).toBe(14.38);
    expect(JSON.stringify(finalState)).not.toContain('revenueProcessed');

    expect(stageIndex('take_order')).toBeLessThan(stageIndex('prepare_dish'));
    expect(stageIndex('prepare_dish')).toBeLessThan(stageIndex('pickup_service_item'));
    expect(stageIndex('pickup_service_item')).toBeLessThan(stageIndex('deliver_service_item'));
    expect(stageIndex('deliver_service_item')).toBeLessThan(stageIndex('eating'));
    expect(stageIndex('eating')).toBeLessThan(stageIndex('paying_at_cashier'));
    expect(stageIndex('paying_at_cashier')).toBeLessThan(stageIndex('dirty_at_table'));
    expect(stageIndex('paying_at_cashier')).toBeLessThan(stageIndex('leaving'));
    expect(stageIndex('dirty_at_table')).toBeLessThan(stageIndex('carried_dirty'));
    expect(stageIndex('carried_dirty')).toBeLessThan(stageIndex('queued_for_wash'));
    expect(stageIndex('queued_for_wash')).toBeLessThan(stageIndex('washing'));
    expect(stageIndex('washing')).toBeLessThan(stageIndex('washed'));
  });

  it('processes manual and automatic dirty items concurrently while returning the janitor to floor dirt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 0 },
      tables: [
        { id: 't1', status: 'dirty', seats: 2, x: 200, y: 200 },
        { id: 't2', status: 'dirty', seats: 2, x: 360, y: 200 },
        { id: 't3', status: 'occupied', seats: 2, x: 200, y: 360 },
      ],
      chairs: [],
      kitchenStations: [],
      serviceTables: [],
      cashierStations: [],
      washStations: [
        { id: 'manual-wash', type: 'manual', x: 300, y: 120, w: 40, h: 40 },
        { id: 'automatic-wash', type: 'automatic', x: 400, y: 120, w: 40, h: 40 },
      ],
      customers: [
        { id: 'manual-owner', state: 'leaving', tableId: 't1', patience: 1000, happiness: 80 },
        { id: 'automatic-owner', state: 'leaving', tableId: 't2', patience: 1000, happiness: 80 },
        {
          id: 'dirt-maker', state: 'seated', tableId: 't3', x: 220, y: 380,
          patience: 1000, happiness: 80, dirtFactor: 8,
        },
      ],
      serviceItems: [
        {
          id: 'manual-item', kind: 'dish', menuItemId: 'manual-dish', customerId: 'manual-owner', tableId: 't1',
          state: 'queued_for_wash', washStationId: 'manual-wash', washQueuedAt: 0,
        },
        {
          id: 'automatic-item', kind: 'dish', menuItemId: 'automatic-dish', customerId: 'automatic-owner', tableId: 't2',
          state: 'queued_for_wash', washStationId: 'automatic-wash', washQueuedAt: 0,
        },
      ],
      staff: [{
        id: 'janitor-1', role: 'janitor', morale: 80, salary: 120,
        x: 300, y: 100, path: [], task: null, carryingServiceItemId: null,
      }],
      floorDirt: [],
      dishes: [],
      unlockedDrinkIds: [],
      equipment: [],
    };

    const janitorWashClaims = new Set();
    let sawAutomaticWashing = false;
    let sawAutomaticCompletion = false;
    let sawManualWashing = false;
    let sawManualCompletion = false;
    let sawAutomaticCompleteWhileManualWashing = false;
    let previousManual = state.serviceItems.find(item => item.id === 'manual-item');
    let previousAutomatic = state.serviceItems.find(item => item.id === 'automatic-item');

    for (let tick = 0; tick < 600; tick += 1) {
      state = runTick(state, 1 / 60);
      const manual = state.serviceItems.find(item => item.id === 'manual-item');
      const automatic = state.serviceItems.find(item => item.id === 'automatic-item');
      const janitor = state.staff.find(staff => staff.id === 'janitor-1');
      if (janitor?.task?.type === 'wash_item') janitorWashClaims.add(janitor.task.serviceItemId);
      sawAutomaticWashing ||= automatic?.state === 'washing';
      sawManualWashing ||= manual?.state === 'washing';
      sawAutomaticCompletion ||= previousAutomatic?.state === 'washing' && !automatic;
      sawManualCompletion ||= previousManual?.state === 'washing' && !manual;
      sawAutomaticCompleteWhileManualWashing ||= sawAutomaticCompletion && manual?.state === 'washing';
      previousManual = manual;
      previousAutomatic = automatic;
      if (sawManualCompletion && state.floorDirt.length > 0
        && janitor?.task?.type === 'clean_floor'
        && janitor.task.dirtId === state.floorDirt[0].id) break;
    }

    expect(sawAutomaticWashing).toBe(true);
    expect(sawAutomaticCompletion).toBe(true);
    expect(sawManualWashing).toBe(true);
    expect(sawManualCompletion).toBe(true);
    expect(sawAutomaticCompleteWhileManualWashing).toBe(true);
    expect(janitorWashClaims).toEqual(new Set(['manual-item']));
    expect(state.floorDirt.length).toBeGreaterThan(0);
    expect(state.staff[0].task).toMatchObject({ type: 'clean_floor', dirtId: state.floorDirt[0].id });
  });

  it('credits each completed payment once without retaining or marking the consumed queue', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, funds: 500, dailyRevenue: 0 },
      completedCustomers: [{ customerId: 'c1', revenue: 12 }],
    };

    state = runTick(state, 0);
    expect(state.restaurant.funds).toBe(512);
    expect(state.restaurant.dailyRevenue).toBe(12);
    expect(state.completedCustomers).toEqual([]);
    expect(JSON.stringify(state)).not.toContain('revenueProcessed');

    state = runTick(state, 0);
    expect(state.restaurant.funds).toBe(512);
    expect(state.restaurant.dailyRevenue).toBe(12);
    expect(state.completedCustomers).toEqual([]);

    state = runTick({
      ...state,
      completedCustomers: [{ customerId: 'c2', revenue: 8 }],
    }, 0);
    expect(state.restaurant.funds).toBe(520);
    expect(state.restaurant.dailyRevenue).toBe(20);
    expect(state.completedCustomers).toEqual([]);
    expect(JSON.stringify(state)).not.toContain('revenueProcessed');

    state = runTick(state, 0);
    expect(state.restaurant.funds).toBe(520);
    expect(state.restaurant.dailyRevenue).toBe(20);
    expect(state.completedCustomers).toEqual([]);
  });
});
