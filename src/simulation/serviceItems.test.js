import { describe, expect, it } from 'vitest';
import {
  createCustomerOrder,
  findAvailableServiceSlot,
  hasDuplicateOwner,
  allOrderedItemsDelivered,
  selectOrderKinds,
  selectUnlockedDrinkId,
  normaliseServiceItemOwnership,
} from './serviceItems';

describe('service item orders', () => {
  it.each([
    [0, ['dish']],
    [0.749999, ['dish']],
    [0.75, ['dish', 'drink']],
    [0.949999, ['dish', 'drink']],
    [0.95, ['drink']],
    [0.999999, ['drink']],
  ])('maps order roll %s to %j', (roll, expected) => {
    expect(selectOrderKinds(roll)).toEqual(expected);
  });

  it('selects uniformly from currently unlocked canonical drinks', () => {
    expect(selectUnlockedDrinkId(['water', 'tea'], 0)).toBe('water');
    expect(selectUnlockedDrinkId(['water', 'tea'], 0.999999)).toBe('tea');
    expect(selectUnlockedDrinkId([], 0.5)).toBeNull();
    expect(selectUnlockedDrinkId(['lemonade'], 0.5)).toBeNull();
  });

  it('creates one scalar-owned item per selected kind', () => {
    const rolls = [0.8, 0.9];
    const state = {
      dishes: [{ id: 'toast', popularity: 50, quality: 1, price: 12 }],
      unlockedDrinkIds: ['water'], serviceItems: [],
    };
    const customer = { id: 'c1', tableId: 't1', state: 'seated' };

    const result = createCustomerOrder(state, customer, () => rolls.shift());

    expect(result.customer).toMatchObject({
      state: 'waiting_for_items', dishId: 'toast', drinkId: 'water',
    });
    expect(result.serviceItems).toEqual([
      expect.objectContaining({ kind: 'dish', menuItemId: 'toast', customerId: 'c1', tableId: 't1', state: 'ordered' }),
      expect.objectContaining({ kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1', state: 'ordered' }),
    ]);
    expect(result.serviceItems.every(item => !Array.isArray(item.customerId))).toBe(true);
  });

  it('allocates stable IDs and initialises every service-item field', () => {
    const rolls = [0.8, 0];
    const existing = [{ id: 'service-item-4', kind: 'dish', customerId: 'other' }];
    const result = createCustomerOrder({
      dishes: [{ id: 'toast', popularity: 50, quality: 1, price: 12 }],
      unlockedDrinkIds: ['water'], serviceItems: existing,
      restaurant: { gameTime: 42 },
    }, { id: 'c1', tableId: 't1', state: 'seated', orderTime: null }, () => rolls.shift());

    expect(result.customer.orderTime).toBe(42);
    expect(result.serviceItems.slice(1)).toEqual([
      expect.objectContaining({ id: 'service-item-5', kind: 'dish', state: 'ordered' }),
      expect.objectContaining({ id: 'service-item-6', kind: 'drink', state: 'ordered' }),
    ]);
  });

  it('does not create a duplicate customer-kind item', () => {
    const existing = [{ id: 'service-item-1', kind: 'dish', customerId: 'c1' }];
    expect(hasDuplicateOwner(existing, 'c1', 'dish')).toBe(true);
    expect(hasDuplicateOwner(existing, 'c1', 'drink')).toBe(false);

    const customer = { id: 'c1', tableId: 't1', state: 'seated' };
    const result = createCustomerOrder({
      dishes: [{ id: 'toast', popularity: 50, quality: 1, price: 12 }],
      unlockedDrinkIds: [], serviceItems: existing,
    }, customer, () => 0.2);

    expect(result).toEqual({ customer, serviceItems: existing });
  });

  it('degrades an unavailable dish order to drink-only', () => {
    const rolls = [0.2, 0];
    const result = createCustomerOrder({
      dishes: [], unlockedDrinkIds: ['water'], serviceItems: [],
    }, { id: 'c1', tableId: 't1', state: 'seated' }, () => rolls.shift());

    expect(result.customer).toMatchObject({ dishId: null, drinkId: 'water' });
    expect(result.serviceItems.map(item => item.kind)).toEqual(['drink']);
  });

  it('chooses the dish with the highest value score', () => {
    const result = createCustomerOrder({
      dishes: [
        { id: 'good-value', popularity: 70, quality: 7, price: 20 },
        { id: 'overpriced', popularity: 90, quality: 8, price: 100 },
      ],
      unlockedDrinkIds: [], serviceItems: [],
    }, { id: 'c1', tableId: 't1', state: 'seated' }, () => 0.2);

    expect(result.customer.dishId).toBe('good-value');
  });

  it('allocates the first unique slot across on-service items and active drink reservations', () => {
    const state = {
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [
        { id: 'i1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 0 },
        { id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 1, assignedStaffId: 'w1' },
      ],
      customers: [{ id: 'c1', drinkId: 'water', state: 'waiting_for_items' }],
      staff: [{ id: 'w1', role: 'waiter', task: { type: 'prepare_drink', serviceItemId: 'i2', serviceTableId: 'st1', serviceSlotIndex: 1 } }],
    };

    expect(findAvailableServiceSlot(state)).toEqual({
      serviceTableId: 'st1', serviceSlotIndex: 2, x: 210, y: 130,
    });
  });

  it('ignores a stale drink reservation with no matching worker task', () => {
    const state = {
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', state: 'ordered', serviceTableId: 'st1',
        serviceSlotIndex: 0, assignedStaffId: 'missing',
      }],
      staff: [],
    };

    expect(findAvailableServiceSlot(state).serviceSlotIndex).toBe(0);
  });

  it('ignores a drink reservation whose worker task records a different slot', () => {
    const state = {
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', state: 'preparing', serviceTableId: 'st1',
        serviceSlotIndex: 0, assignedStaffId: 'w1',
      }],
      staff: [{ id: 'w1', task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 1 } }],
    };

    expect(findAvailableServiceSlot(state).serviceSlotIndex).toBe(0);
  });

  it.each([
    ['wrong item', { type: 'prepare_drink', serviceItemId: 'other', serviceTableId: 'st1' }],
    ['wrong counter', { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st2' }],
    ['wrong task type', { type: 'prepare_dish', serviceItemId: 'i1', serviceTableId: 'st1' }],
  ])('ignores a drink reservation with a %s task', (_label, task) => {
    const state = {
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', state: 'preparing', serviceTableId: 'st1',
        serviceSlotIndex: 0, assignedStaffId: 'w1',
      }],
      staff: [{ id: 'w1', task }],
    };

    expect(findAvailableServiceSlot(state).serviceSlotIndex).toBe(0);
  });

  it('returns null when all four slots on every counter are occupied', () => {
    const state = {
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: Array.from({ length: 4 }, (_, serviceSlotIndex) => ({
        id: `i${serviceSlotIndex}`, state: 'on_service',
        serviceTableId: 'st1', serviceSlotIndex,
      })),
    };

    expect(findAvailableServiceSlot(state)).toBeNull();
  });

  it('keeps the first owner-kind item and safely cancels duplicates', () => {
    const result = normaliseServiceItemOwnership({
      customers: [{ id: 'c1', state: 'waiting_for_items' }], staff: [], serviceTables: [],
      serviceItems: [
        { id: 'i1', kind: 'dish', customerId: 'c1', state: 'ordered' },
        { id: 'i2', kind: 'dish', customerId: 'c1', state: 'ordered' },
      ],
    });
    expect(result.serviceItems.map(item => item.id)).toEqual(['i1']);
  });

  it('releases stale carriers and reservations', () => {
    const result = normaliseServiceItemOwnership({
      customers: [{ id: 'c1', state: 'waiting_for_items' }],
      serviceTables: [{ id: 'st1' }],
      staff: [{ id: 'w1', carryingServiceItemId: 'missing', task: null }],
      serviceItems: [{ id: 'i1', kind: 'drink', customerId: 'c1', state: 'ordered',
        serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'missing' }],
    });
    expect(result.staff[0].carryingServiceItemId).toBeNull();
    expect(result.serviceItems[0]).toMatchObject({ serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null });
  });

  it.each(['ordered', 'preparing'])('removes an abandoned %s item and releases its metadata', itemState => {
    const result = normaliseServiceItemOwnership({
      customers: [{ id: 'c1', state: 'leaving', drinkId: 'water' }],
      staff: [{ id: 'w1', role: 'waiter', task: { type: 'prepare_drink', serviceItemId: 'i1' }, carryingServiceItemId: null }],
      serviceTables: [{ id: 'st1' }],
      serviceItems: [{ id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: itemState,
        serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1' }],
    });

    expect(result.serviceItems).toEqual([]);
  });

  it('removes a zero-customer nonphysical orphan', () => {
    const result = normaliseServiceItemOwnership({ customers: [], staff: [], serviceTables: [],
      serviceItems: [{ id: 'i1', kind: 'dish', customerId: 'missing', state: 'ordered' }] });
    expect(result.serviceItems).toEqual([]);
  });

  it('converts a physical orphan to to_clean', () => {
    const result = normaliseServiceItemOwnership({ customers: [], staff: [], serviceTables: [],
      serviceItems: [{ id: 'i1', kind: 'dish', customerId: 'missing', state: 'delivered' }] });
    expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'to_clean' });
  });

  it('clears stale counter and slot metadata with a null worker', () => {
    const result = normaliseServiceItemOwnership({ customers: [{ id: 'c1', drinkId: 'water' }], staff: [], serviceTables: [{ id: 'st1' }],
      serviceItems: [{ id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: null }] });
    expect(result.serviceItems[0]).toMatchObject({ serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null });
  });

  it('converts a physical duplicate to to_clean', () => {
    const result = normaliseServiceItemOwnership({ customers: [{ id: 'c1' }], staff: [], serviceTables: [],
      serviceItems: [{ id: 'i1', kind: 'dish', customerId: 'c1', state: 'ordered' }, { id: 'i2', kind: 'dish', customerId: 'c1', state: 'delivered' }] });
    expect(result.serviceItems).toEqual([expect.objectContaining({ id: 'i1' }), expect.objectContaining({ id: 'i2', state: 'to_clean' })]);
  });

  it('cleans up an ambiguous carrier', () => {
    const result = normaliseServiceItemOwnership({ customers: [{ id: 'c1' }], serviceTables: [],
      staff: [{ id: 'w1', carryingServiceItemId: 'i1' }, { id: 'w2', carryingServiceItemId: 'i1' }],
      serviceItems: [{ id: 'i1', kind: 'dish', customerId: 'c1', state: 'carried' }] });
    expect(result.staff.every(worker => worker.carryingServiceItemId == null)).toBe(true);
    expect(result.serviceItems[0].state).toBe('to_clean');
  });

  it('rejects a janitor or cook as carrier of a dirty item', () => {
    for (const role of ['janitor', 'cook']) {
      const result = normaliseServiceItemOwnership({ tables: [{ id: 't1' }], customers: [], serviceTables: [],
        staff: [{ id: 'worker', role, carryingServiceItemId: 'i1' }],
        serviceItems: [{ id: 'i1', kind: 'dish', customerId: 'gone', tableId: 't1', state: 'carried_dirty' }] });
      expect(result.staff[0].carryingServiceItemId).toBeNull();
      expect(result.serviceItems[0].state).toBe('dirty_at_table');
    }
  });

  it('normalises a queued item that references a missing wash station', () => {
    const result = normaliseServiceItemOwnership({
      customers: [], staff: [], tables: [], washStations: [{ id: 'existing' }], serviceTables: [],
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', state: 'queued_for_wash',
        washStationId: 'missing', washQueuedAt: 10 }],
    });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'queued_for_wash', washStationId: null, washQueuedAt: 10,
    });
  });

  it('keeps a complete two-item checkout order active during ownership normalisation', () => {
    const result = normaliseServiceItemOwnership({
      customers: [{ id: 'c1', state: 'checkout_moving', dishId: 'toast', drinkId: 'water' }],
      staff: [], tables: [], washStations: [], serviceTables: [],
      serviceItems: [
        { id: 'dish', customerId: 'c1', kind: 'dish', menuItemId: 'toast', state: 'delivered' },
        { id: 'drink', customerId: 'c1', kind: 'drink', menuItemId: 'water', state: 'delivered' },
      ],
    });
    expect(result.customers[0].state).toBe('checkout_moving');
  });

  it('cancels a malformed combined checkout order instead of allowing incomplete payment', () => {
    const result = normaliseServiceItemOwnership({
      customers: [{ id: 'c1', state: 'checkout_processing', dishId: 'toast', drinkId: 'water' }],
      staff: [], tables: [], washStations: [], serviceTables: [],
      serviceItems: [
        { id: 'dish', customerId: 'c1', kind: 'dish', menuItemId: 'toast', state: 'delivered' },
      ],
    });
    expect(result.customers[0]).toMatchObject({
      state: 'leaving', dishId: null, drinkId: null, orderTime: null,
    });
  });

  it.each([
    ['wrong menu ID', { id: 'i1', kind: 'dish', menuItemId: 'wrong', customerId: 'c1', state: 'ordered' }],
    ['non-fulfilment state', { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'to_clean' }],
  ])('cancels a malformed combined order for %s and clears ordering fields', (_reason, item) => {
    const result = normaliseServiceItemOwnership({ customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: 'water', orderTime: 42 }], staff: [], serviceTables: [],
      serviceItems: [item, { id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'delivered' }] });
    expect(result.customers[0]).toMatchObject({ state: 'leaving', dishId: null, drinkId: null, orderTime: null });
  });

  it('preserves unrelated valid worker and item ownership', () => {
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'carried' };
    const result = normaliseServiceItemOwnership({ customers: [{ id: 'c1', dishId: 'd1' }], serviceTables: [],
      staff: [{ id: 'w1', role: 'waiter', carryingServiceItemId: 'i1' }], serviceItems: [item] });
    expect(result.staff[0].carryingServiceItemId).toBe('i1');
    expect(result.serviceItems[0]).toEqual(item);
  });

  it.each([
    ['dish only', { id: 'c1', dishId: 'd1' }, [{ customerId: 'c1', kind: 'dish', state: 'delivered' }], true],
    ['drink only', { id: 'c1', drinkId: 'water' }, [{ customerId: 'c1', kind: 'drink', state: 'delivered' }], true],
    ['combined before second item', { id: 'c1', dishId: 'd1', drinkId: 'water' }, [{ customerId: 'c1', kind: 'dish', state: 'delivered' }], false],
    ['combined after second item', { id: 'c1', dishId: 'd1', drinkId: 'water' }, [
      { customerId: 'c1', kind: 'dish', state: 'delivered' },
      { customerId: 'c1', kind: 'drink', state: 'delivered' },
    ], true],
  ])('reports whether all ordered items are delivered for %s', (_label, customer, serviceItems, expected) => {
    expect(allOrderedItemsDelivered(customer, serviceItems)).toBe(expected);
  });
});
