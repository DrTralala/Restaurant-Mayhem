import { describe, expect, it } from 'vitest';
import { processKitchen } from './kitchen';

const baseState = {
  customers: [{ id: 'c1', state: 'waiting_for_items' }],
  dishes: [],
  equipment: [],
  kitchenStations: [],
  restaurant: { gameTime: 0, totalServed: 0 },
  serviceItems: [],
  serviceTables: [{ id: 'st1', x: 140, y: 120 }],
  staff: [],
  tables: [],
};

describe('processKitchen', () => {
  it('advances dish preparation with the cook morale rate without changing automatic timers', () => {
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'toast', customerId: 'c1',
      state: 'preparing', stationId: 'k1', assignedStaffId: 'cook1',
      preparationStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0,
    };
    const result = processKitchen({
      ...baseState,
      restaurant: { gameTime: 30 },
      serviceItems: [item],
      dishes: [{ id: 'toast', prepTime: 60 }],
      kitchenStations: [{ id: 'k1' }],
      staff: [{ id: 'cook1', role: 'cook', morale: 0,
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' } }],
    });

    expect(result.serviceItems[0]).toMatchObject({ accumulatedWork: 15, lastProgressAt: 30 });
  });

  it('keeps equipment and global speed modifiers when the assigned cook has no task record', () => {
    const result = processKitchen({
      ...baseState,
      restaurant: { gameTime: 50 },
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'toast', customerId: 'c1',
        state: 'preparing', stationId: 'k1', assignedStaffId: 'cook1',
        preparationStartedAt: 0,
      }],
      dishes: [{ id: 'toast', prepTime: 120 }],
      kitchenStations: [{ id: 'k1', equipmentId: 'oven' }],
      equipment: [{ id: 'oven', owned: true, speedMultiplier: 2 }],
      upgrades: [{ level: 1, effects: { type: 'globalSpeed', value: 0.25 } }],
      staff: [{ id: 'cook1', role: 'cook', morale: 50 }],
    });

    expect(result.serviceItems[0]).toMatchObject({ state: 'ready', readyAt: 50 });
  });

  it('keeps the cook task ledger in step when an older item ledger is missing', () => {
    const result = processKitchen({
      ...baseState,
      restaurant: { gameTime: 40 },
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'toast', customerId: 'c1',
        state: 'preparing', stationId: 'k1', assignedStaffId: 'cook1',
        preparationStartedAt: 0,
      }],
      dishes: [{ id: 'toast', prepTime: 120 }],
      kitchenStations: [{ id: 'k1' }],
      staff: [{ id: 'cook1', role: 'cook', morale: 100,
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1',
          accumulatedWork: 30, lastProgressAt: 30 } }],
    });

    expect(result.serviceItems[0]).toMatchObject({ accumulatedWork: 45, lastProgressAt: 40 });
    expect(result.staff[0].task).toMatchObject({ accumulatedWork: 45, lastProgressAt: 40 });
  });

  const deliveredItems = {
    dish: {
      id: 'dish', customerId: 'c1', tableId: 't1', kind: 'dish',
      menuItemId: 'toast', state: 'delivered', consumptionStartedAt: 0,
    },
    drink: {
      id: 'drink', customerId: 'c1', tableId: 't1', kind: 'drink',
      menuItemId: 'water', state: 'delivered', consumptionStartedAt: 0,
    },
  };
  const makeEatingState = (kinds, gameTime = 0) => ({
    ...baseState,
    restaurant: { gameTime, totalServed: 0 },
    customers: [{
      id: 'c1', state: 'eating', tableId: 't1',
      dishId: kinds.includes('dish') ? 'toast' : null,
      drinkId: kinds.includes('drink') ? 'water' : null,
      orderedServiceItemIds: kinds,
      consumedServiceItemIds: [],
    }],
    serviceItems: kinds.map(kind => deliveredItems[kind]),
    tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
  });

  it.each([
    ['drink', 180],
    ['dish', 480],
  ])('advances a delivered %s using its own consumption duration', (kind, duration) => {
    const before = processKitchen(makeEatingState([kind], duration - 1));
    const completed = processKitchen({ ...before, restaurant: { gameTime: duration } });

    expect(before.customers[0].state).toBe('eating');
    expect(before.serviceItems[0].state).toBe('delivered');
    expect(completed.customers[0]).toMatchObject({
      state: 'checkout_queued', paymentQueuedAt: duration,
    });
    expect(completed.serviceItems[0].state).toBe('dirty_at_table');
  });

  it('finishes combined items independently before entering checkout', () => {
    const combined = makeEatingState(['dish', 'drink']);
    const at180 = processKitchen({ ...combined, restaurant: { gameTime: 180 } });
    expect(at180.customers[0].state).toBe('eating');
    expect(at180.serviceItems.find(item => item.kind === 'drink').state).toBe('dirty_at_table');
    expect(at180.serviceItems.find(item => item.kind === 'dish').state).toBe('delivered');

    const at480 = processKitchen({ ...at180, restaurant: { gameTime: 480 } });
    expect(at480.customers[0].state).toBe('checkout_queued');
    expect(at480.serviceItems.every(item => item.state === 'dirty_at_table')).toBe(true);
  });

  it('uses durable consumed IDs after a waiter collects a finished drink', () => {
    const at180 = processKitchen({
      ...makeEatingState(['dish', 'drink']),
      restaurant: { gameTime: 180 },
    });
    const collected = {
      ...at180,
      staff: [{
        id: 'w1', role: 'waiter', carryingServiceItemId: 'drink',
      }],
      serviceItems: at180.serviceItems.map(item => item.id === 'drink'
        ? { ...item, state: 'carried_dirty' }
        : item),
    };

    expect(collected.serviceItems.find(item => item.id === 'drink').state).toBe('carried_dirty');
    expect(collected.customers[0].consumedServiceItemIds).toContain('drink');

    const at480 = processKitchen({ ...collected, restaurant: { gameTime: 480 } });
    expect(at480.customers[0]).toMatchObject({
      state: 'checkout_queued', consumedServiceItemIds: ['drink', 'dish'],
    });
  });

  it('does not progress an ordered dish before a cook arrives', () => {
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1',
      state: 'ordered', stationId: null, assignedStaffId: null,
      preparationStartedAt: null,
    };

    const result = processKitchen({
      ...baseState,
      restaurant: { gameTime: 999 },
      serviceItems: [item],
      dishes: [{ id: 'd1', prepTime: 60, requiredEquipmentId: 'eq1' }],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', speedMultiplier: 1, owned: true }],
    });

    expect(result.serviceItems).toEqual([item]);
  });

  it('finishes preparation at the kitchen station without teleporting the dish', () => {
    const state = {
      ...baseState,
      restaurant: { gameTime: 91 },
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
        state: 'preparing', stationId: 'k1', assignedStaffId: 'cook1', preparationStartedAt: 0,
        serviceTableId: null, serviceSlotIndex: null,
      }],
      dishes: [{ id: 'd1', prepTime: 120, requiredEquipmentId: 'eq1' }],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
      equipment: [{ id: 'eq1', speedMultiplier: 1.2, qualityBonus: 0, owned: true }],
      upgrades: [{ level: 1, effects: { type: 'globalSpeed', value: 0.1 } }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      staff: [{
        id: 'cook1', role: 'cook',
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      }],
    };

    const result = processKitchen(state);

    expect(result.serviceItems[0]).toMatchObject({
      state: 'ready', serviceTableId: null, serviceSlotIndex: null, x: 120, y: 140,
      readyAt: 91, assignedStaffId: 'cook1', stationId: 'k1',
    });
    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1',
    });
    expect(result.staff[0].task.accumulatedWork).toBeCloseTo(120.12);
    expect(result.staff[0].task.lastProgressAt).toBe(91);
  });

  it('does not progress preparing dishes with invalid equipment or cook ownership', () => {
    const items = [
      {
        id: 'wrong-equipment', kind: 'dish', menuItemId: 'toast', customerId: 'c1',
        state: 'preparing', stationId: 'oven-station', assignedStaffId: 'cook1',
        preparationStartedAt: 0,
      },
      {
        id: 'missing-cook', kind: 'dish', menuItemId: 'toast', customerId: 'c1',
        state: 'preparing', stationId: 'toast-station', assignedStaffId: 'missing',
        preparationStartedAt: 0,
      },
    ];
    const result = processKitchen({
      ...baseState,
      restaurant: { gameTime: 100 },
      serviceItems: items,
      dishes: [{ id: 'toast', prepTime: 60, requiredEquipmentId: 'toaster' }],
      kitchenStations: [
        { id: 'oven-station', equipmentId: 'oven' },
        { id: 'toast-station', equipmentId: 'toaster' },
      ],
      equipment: [{ id: 'toaster', speedMultiplier: 1, owned: true }],
      staff: [{ id: 'cook1', role: 'cook' }],
    });

    expect(result.serviceItems).toEqual(items);
  });

  it('does not complete a food preparation at its deadline', () => {
    const customer = {
      id: 'c1', state: 'waiting_for_items', dishId: 'toast', patienceMax: 100,
      foodOrderedAt: 0, foodPatienceBudget: 100, foodDeadlineAt: 100,
      foodOutcome: 'pending', cancelledServiceItemIds: [],
    };
    const result = processKitchen({
      ...baseState,
      restaurant: { gameTime: 100 },
      customers: [customer],
      serviceItems: [{
        id: 'dish', kind: 'dish', menuItemId: 'toast', customerId: 'c1',
        state: 'preparing', stationId: 'k1', assignedStaffId: 'cook1',
        preparationStartedAt: 0,
      }],
      dishes: [{ id: 'toast', prepTime: 60 }],
      kitchenStations: [{ id: 'k1' }],
      staff: [{ id: 'cook1', role: 'cook', morale: 100,
        task: { type: 'prepare_dish', serviceItemId: 'dish', stationId: 'k1' } }],
    });

    expect(result.customers[0].foodOutcome).toBe('cancelled');
    expect(result.serviceItems).toEqual([]);
    expect(result.staff[0].task).toBeNull();
  });

  it('marks food delivered rather than cancelling when the dish was already delivered', () => {
    const result = processKitchen({
      ...baseState,
      restaurant: { gameTime: 100 },
      customers: [{
        id: 'c1', state: 'waiting_for_items', dishId: 'toast', patienceMax: 100,
        foodOrderedAt: 0, foodPatienceBudget: 100, foodDeadlineAt: 100,
        foodOutcome: 'pending', cancelledServiceItemIds: [],
      }],
      serviceItems: [{
        id: 'dish', kind: 'dish', menuItemId: 'toast', customerId: 'c1', state: 'delivered',
      }],
    });

    expect(result.customers[0].foodOutcome).toBe('delivered');
    expect(result.serviceItems[0].state).toBe('delivered');
  });

  it('does not automatically transfer ready dishes to service-counter slots', () => {
    const result = processKitchen({
      ...baseState,
      serviceItems: [
        { id: 'later', kind: 'dish', customerId: 'c1', state: 'ready', readyAt: 20 },
        { id: 'b', kind: 'dish', customerId: 'c1', state: 'ready', readyAt: 10 },
        { id: 'a', kind: 'dish', customerId: 'c1', state: 'ready', readyAt: 10 },
      ],
    });

    expect(result.serviceItems).toEqual([
      { id: 'later', kind: 'dish', customerId: 'c1', state: 'ready', readyAt: 20 },
      { id: 'b', kind: 'dish', customerId: 'c1', state: 'ready', readyAt: 10 },
      { id: 'a', kind: 'dish', customerId: 'c1', state: 'ready', readyAt: 10 },
    ]);
  });

  it('leaves a ready dish for its cook even when another counter has space', () => {
    const customers = Array.from({ length: 5 }, (_, index) => ({
      id: `c${index + 1}`, state: 'waiting_for_items',
    }));
    const occupied = Array.from({ length: 4 }, (_, index) => ({
      id: `occupied-${index}`, kind: index === 3 ? 'drink' : 'dish',
      customerId: `c${index + 2}`, state: 'on_service',
      serviceTableId: 'st1', serviceSlotIndex: index,
    }));
    const result = processKitchen({
      ...baseState,
      customers,
      serviceItems: [...occupied, {
        id: 'ready', kind: 'dish', customerId: 'c1', state: 'ready', readyAt: 60,
      }],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
    });

    expect(result.serviceItems.find(item => item.id === 'ready')).toEqual({
      id: 'ready', kind: 'dish', customerId: 'c1', state: 'ready', readyAt: 60,
    });
  });

  it('keeps a completed dish ready without duplication while counters are full', () => {
    const occupied = Array.from({ length: 4 }, (_, index) => ({
      id: `occupied-${index}`, kind: 'dish', state: 'on_service',
      serviceTableId: 'st1', serviceSlotIndex: index,
    }));
    const ready = { id: 'ready', kind: 'dish', state: 'ready', readyAt: 60 };
    const state = { ...baseState, serviceItems: [...occupied, ready] };

    const first = processKitchen(state);
    const second = processKitchen(first);

    expect(first.serviceItems).toHaveLength(5);
    expect(first.serviceItems.find(item => item.id === 'ready').state).toBe('ready');
    expect(second.serviceItems.map(item => item.id)).toEqual(first.serviceItems.map(item => item.id));
  });

  it('removes ordered and preparing orphan dishes without retaining cancelled state', () => {
    const result = processKitchen({
      ...baseState,
      customers: [{ id: 'leaving', state: 'leaving' }],
      serviceItems: [
        { id: 'ordered', kind: 'dish', customerId: 'missing', state: 'ordered' },
        {
          id: 'preparing', kind: 'dish', customerId: 'leaving', state: 'preparing',
          stationId: 'k1', assignedStaffId: 'cook1', preparationStartedAt: 0,
        },
      ],
    });

    expect(result.serviceItems).toEqual([]);
  });

  it('routes ready orphan dishes to cleaning', () => {
    const result = processKitchen({
      ...baseState,
      customers: [{ id: 'leaving', state: 'leaving' }],
      serviceItems: [{ id: 'ready', kind: 'dish', customerId: 'leaving', state: 'ready' }],
    });

    expect(result.serviceItems[0]).toMatchObject({ id: 'ready', state: 'to_clean' });
  });

  it.each(['on_service', 'carried', 'delivered'])('converts orphan %s dishes to cleaning', itemState => {
    const result = processKitchen({
      ...baseState,
      customers: [],
      serviceItems: [{ id: 'i1', kind: 'dish', customerId: 'missing', state: itemState }],
    });

    expect(result.serviceItems[0].state).toBe('to_clean');
  });

  it('clears an invalid cook preparation task without stamping route state', () => {
    const state = {
      ...baseState,
      restaurant: { gameTime: 50 },
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'delivered',
      }],
      dishes: [{ id: 'd1', prepTime: 60 }],
      kitchenStations: [{ id: 'k1' }],
      staff: [{
        id: 'cook1', role: 'cook',
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      }],
    };

    const result = processKitchen(state);

    expect(result.staff[0]).toMatchObject({ id: 'cook1', role: 'cook', task: null });
    for (const field of ['path', 'pathGoal', 'stalledFor', 'usingStaticFallback',
      'minimumSpacing', 'localConflictTarget', 'headOnRecovery',
      'recoveredHeadOnDetourTarget']) {
      expect(result.staff[0]).not.toHaveProperty(field);
    }
  });

  it('does not alter drink progression', () => {
    const drink = {
      id: 'drink', kind: 'drink', customerId: 'c1', state: 'preparing',
      preparationStartedAt: 0,
    };

    expect(processKitchen({ ...baseState, restaurant: { gameTime: 999 }, serviceItems: [drink] })
      .serviceItems).toEqual([drink]);
  });

  it('does not return legacy food or kitchen queue keys', () => {
    const result = processKitchen({
      ...baseState,
      serviceItems: [{ id: 'service-item-1', kind: 'dish', customerId: 'c1', state: 'ordered' }],
    });

    expect(result.serviceItems).toHaveLength(1);
  });
});
