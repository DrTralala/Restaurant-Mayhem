import { describe, expect, it } from 'vitest';
import {
  cancelCustomerFood,
  expireFoodPatience,
  getFoodPatienceFraction,
  startFoodPatience,
} from './foodPatience';
import { advanceConsumption } from './consumption';

function customer(overrides = {}) {
  return {
    id: 'c1',
    partyId: 'p1',
    state: 'waiting_for_items',
    dishId: 'toast',
    drinkId: null,
    dishPriceAtOrder: 12,
    drinkPriceAtOrder: null,
    orderSubtotal: 12,
    patienceMax: 100,
    foodOutcome: null,
    orderedServiceItemIds: ['dish-1'],
    consumedServiceItemIds: [],
    ...overrides,
  };
}

function stateWith(itemState, overrides = {}) {
  const c = customer(overrides.customer);
  return {
    restaurant: { gameTime: 100 },
    customers: [c],
    serviceItems: [{
      id: 'dish-1', kind: 'dish', menuItemId: 'toast', customerId: c.id,
      tableId: 't1', state: itemState, assignedStaffId: itemState === 'carried' ? 'cook' : null,
      stationId: itemState === 'preparing' ? 'k1' : null,
      serviceTableId: itemState === 'on_service' || itemState === 'carried' ? 'st1' : null,
      serviceSlotIndex: itemState === 'on_service' || itemState === 'carried' ? 0 : null,
      x: itemState === 'on_service' || itemState === 'carried' ? 150 : null,
      y: itemState === 'on_service' || itemState === 'carried' ? 130 : null,
      ...(itemState === 'preparing' ? { batchId: 'batch-1', preparationStartedAt: 0 } : {}),
    }],
    staff: itemState === 'carried'
      ? [{
        id: 'cook', role: 'cook', x: 180, y: 220, carryingServiceItemIds: ['dish-1'],
        task: { type: 'place_dish_on_service', serviceItemId: 'dish-1', batchId: 'batch-1' },
      }]
      : [{ id: 'cook', role: 'cook', carryingServiceItemIds: [], task: null }],
    cookingBatches: itemState === 'preparing' || itemState === 'carried'
      ? [{ id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: ['dish-1'], status: 'preparing' }]
      : [],
    serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    tables: [{ id: 't1', status: 'occupied' }],
  };
}

describe('food patience', () => {
  it('starts a fresh positive budget and exposes a clamped fraction', () => {
    const started = startFoodPatience(customer({ patienceMax: 120 }), 50);

    expect(started).toMatchObject({
      foodOrderedAt: 50,
      foodPatienceBudget: 120,
      foodDeadlineAt: 170,
      foodOutcome: 'pending',
      foodCancelledAt: null,
      cancelledServiceItemIds: [],
    });
    expect(getFoodPatienceFraction(started, 50)).toBe(1);
    expect(getFoodPatienceFraction(started, 110)).toBe(0.5);
    expect(getFoodPatienceFraction(started, 170)).toBe(0);
  });

  it('does not create a timer without a positive budget', () => {
    const started = startFoodPatience(customer({ patienceMax: 0 }), 50);

    expect(started).toMatchObject({
      foodOrderedAt: null,
      foodPatienceBudget: null,
      foodDeadlineAt: null,
      foodOutcome: null,
      foodCancelledAt: null,
      cancelledServiceItemIds: [],
    });
    expect(getFoodPatienceFraction(started, 100)).toBeNull();
  });

  it.each(['ordered', 'preparing', 'ready', 'on_service', 'carried'])
    ('cancels %s food exactly once and retains terminal history', itemState => {
      const initial = stateWith(itemState);
      const pending = {
        ...initial,
        customers: [startFoodPatience(initial.customers[0], 0)],
      };
      const cancelled = cancelCustomerFood(pending, 'c1', 100);

      expect(cancelled.customers[0]).toMatchObject({
        foodOutcome: 'cancelled', foodCancelledAt: 100,
        cancelledServiceItemIds: ['dish-1'], dishId: null,
        dishPriceAtOrder: null, orderSubtotal: 0,
      });
      expect(cancelled.customers[0].menuOutcome).not.toBe('unaffordable');
      const repeated = cancelCustomerFood(cancelled, 'c1', 200);
      expect(repeated.customers[0]).toEqual(cancelled.customers[0]);
      expect(repeated.customers[0].orderSubtotal).toBe(0);
    });

  it('releases a carried cancelled dish at the cook position for waiter pickup', () => {
    const initial = stateWith('carried');
    const pending = {
      ...initial,
      serviceItems: initial.serviceItems.map(item => ({
        ...item,
        washStationId: 'stale-sink', reservedWashStationId: 'stale-dishwasher',
        washQueuedAt: 40, washStartedAt: 50,
      })),
      customers: [startFoodPatience(initial.customers[0], 0)],
    };
    const cancelled = cancelCustomerFood(pending, 'c1', 100);

    expect(cancelled.serviceItems[0]).toMatchObject({
      id: 'dish-1', state: 'to_clean', foodCancelled: true,
      deliveryProhibited: true, assignedStaffId: null,
      x: 180, y: 220,
    });
    expect(cancelled.serviceItems[0]).toMatchObject({
      serviceTableId: null, serviceSlotIndex: null, stationId: null,
      washStationId: null, reservedWashStationId: null,
      washQueuedAt: null, washStartedAt: null,
    });
    expect(cancelled.staff[0].carryingServiceItemIds).toEqual([]);
    expect(cancelled.staff[0].task).toBeNull();
  });

  it('converts a waiter-carried cancelled dish to dirty work and clears stale wash metadata', () => {
    const initial = stateWith('carried');
    const pending = {
      ...initial,
      staff: [{
        ...initial.staff[0], id: 'waiter', role: 'waiter',
        carryingServiceItemIds: ['dish-1'],
        task: { type: 'deliver_service_item', serviceItemId: 'dish-1', customerId: 'c1' },
      }],
      serviceItems: initial.serviceItems.map(item => ({
        ...item,
        assignedStaffId: 'waiter',
        washStationId: 'stale-sink', reservedWashStationId: 'stale-dishwasher',
        washQueuedAt: 40, washStartedAt: 50,
      })),
      customers: [startFoodPatience(initial.customers[0], 0)],
    };

    const cancelled = cancelCustomerFood(pending, 'c1', 100);

    expect(cancelled.serviceItems[0]).toMatchObject({
      id: 'dish-1', state: 'carried_dirty', foodCancelled: true,
      deliveryProhibited: true, assignedStaffId: null,
      serviceTableId: null, serviceSlotIndex: null, stationId: null,
      washStationId: null, reservedWashStationId: null,
      washQueuedAt: null, washStartedAt: null,
    });
    expect(cancelled.staff[0].carryingServiceItemIds).toEqual(['dish-1']);
  });

  it('removes a malformed load reference when cancellation removes a non-carried item', () => {
    const initial = stateWith('ordered');
    initial.staff[0].carryingServiceItemIds = ['dish-1'];
    const pending = {
      ...initial,
      customers: [startFoodPatience(initial.customers[0], 0)],
    };

    const cancelled = cancelCustomerFood(pending, 'c1', 100);

    expect(cancelled.serviceItems).toEqual([]);
    expect(cancelled.staff[0].carryingServiceItemIds).toEqual([]);
  });

  it('preserves the other members of a cooking batch when food expires', () => {
    const initial = stateWith('preparing');
    const other = {
      id: 'dish-2', kind: 'dish', menuItemId: 'toast', customerId: 'c2',
      state: 'preparing', batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook',
      preparationStartedAt: 0,
    };
    const pending = {
      ...initial,
      customers: [startFoodPatience(initial.customers[0], 0), {
        id: 'c2', state: 'waiting_for_items', dishId: 'toast', foodOutcome: 'pending',
      }],
      serviceItems: [...initial.serviceItems, other],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: ['dish-1', 'dish-2'],
        status: 'preparing', startedAt: 0,
      }],
      staff: [{
        id: 'cook', role: 'cook', carryingServiceItemIds: [],
        task: {
          type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'dish-1',
          serviceItemIds: ['dish-1', 'dish-2'], stationId: 'k1',
        },
      }],
    };
    const cancelled = cancelCustomerFood(pending, 'c1', 100);

    expect(cancelled.serviceItems.find(item => item.id === 'dish-1')).toBeUndefined();
    expect(cancelled.serviceItems.find(item => item.id === 'dish-2')).toMatchObject({
      state: 'preparing', batchId: 'batch-1', preparationStartedAt: 0,
    });
    expect(cancelled.cookingBatches[0].serviceItemIds).toEqual(['dish-2']);
    expect(cancelled.staff[0].task).toMatchObject({
      type: 'prepare_dish', serviceItemId: 'dish-2', serviceItemIds: ['dish-2'],
    });
  });

  it('does not cancel a dish that was delivered before the deadline', () => {
    const initial = stateWith('delivered');
    const pending = {
      ...initial,
      customers: [startFoodPatience(initial.customers[0], 0)],
    };
    const result = expireFoodPatience({ ...pending, restaurant: { gameTime: 100 } }, 100);

    expect(result.customers[0].foodOutcome).toBe('delivered');
    expect(result.customers[0].cancelledServiceItemIds).toEqual([]);
    expect(result.serviceItems[0].state).toBe('delivered');
  });

  it('expires exactly at the deadline', () => {
    const pendingCustomer = startFoodPatience(customer({ patienceMax: 100 }), 0);
    const result = expireFoodPatience({
      ...stateWith('ordered'),
      customers: [pendingCustomer],
    }, 100);

    expect(result.customers[0].foodOutcome).toBe('cancelled');
  });

  it('materialises the counter origin for cleanup when item coordinates are stale', () => {
    const initial = stateWith('on_service');
    initial.serviceItems[0].x = null;
    initial.serviceItems[0].y = null;
    const pending = {
      ...initial,
      customers: [startFoodPatience(initial.customers[0], 0)],
    };

    const result = cancelCustomerFood(pending, 'c1', 100);

    expect(result.serviceItems[0]).toMatchObject({
      state: 'to_clean', x: 150, y: 130,
      wasteOrigin: { serviceTableId: 'st1', serviceSlotIndex: 0, x: 150, y: 130 },
    });
    expect(result.serviceItems[0]).toHaveProperty('wasteOrigin');
  });

  it('uses the kitchen station origin for a ready item with missing coordinates', () => {
    const initial = stateWith('ready');
    initial.serviceItems[0].stationId = 'k1';
    initial.kitchenStations = [{ id: 'k1', x: 100, y: 120 }];
    const pending = {
      ...initial,
      customers: [startFoodPatience(initial.customers[0], 0)],
    };

    const result = cancelCustomerFood(pending, 'c1', 100);

    expect(result.serviceItems[0]).toMatchObject({
      state: 'to_clean', x: 120, y: 140,
      wasteOrigin: { stationId: 'k1', x: 120, y: 140 },
    });
    expect(result.serviceItems[0]).toHaveProperty('wasteOrigin');
  });

  it('lets a cancelled food order finish its valid drink before individual checkout', () => {
    const initial = stateWith('ready', {
      customer: {
        drinkId: 'water', drinkPriceAtOrder: 2, orderSubtotal: 14,
        orderedServiceItemIds: ['dish-1', 'drink-1'],
      },
    });
    initial.serviceItems.push({
      id: 'drink-1', kind: 'drink', menuItemId: 'water', customerId: 'c1',
      state: 'delivered',
    });
    const pending = { ...initial, customers: [startFoodPatience(initial.customers[0], 0)] };
    const cancelled = cancelCustomerFood(pending, 'c1', 100);
    const complete = advanceConsumption({
      ...cancelled,
      restaurant: { gameTime: 280 },
    });

    expect(cancelled.customers[0]).toMatchObject({ state: 'eating', drinkId: 'water' });
    expect(cancelled.serviceItems.find(item => item.id === 'drink-1').consumptionStartedAt).toBe(100);
    expect(complete.customers[0]).toMatchObject({
      state: 'checkout_queued', consumedServiceItemIds: ['drink-1'],
    });
    expect(complete.serviceItems.find(item => item.id === 'dish-1').state).toBe('to_clean');
  });
});
