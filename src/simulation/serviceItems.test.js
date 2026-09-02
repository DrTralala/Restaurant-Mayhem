import { describe, expect, it } from 'vitest';
import {
  createCustomerOrder,
  findAvailableServiceSlot,
  getServiceSlotPosition,
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

  it('creates scalar-owned items and snapshots an affordable combined basket', () => {
    const state = {
      restaurant: { reputation: 3, gameTime: 42 },
      dishes: [{ id: 'toast', price: 12, quality: 1, popularity: 50, prepTime: 120 }],
      unlockedDrinkIds: ['water'], drinkOverrides: {}, serviceItems: [],
    };
    const rolls = [0.8, 0];
    const result = createCustomerOrder(state, {
      id: 'c1', partyId: 'p1', tableId: 't1', state: 'seated',
      archetype: 'regular', spendingTier: 'value', spendingBudget: 20,
    }, () => rolls.shift());

    expect(result.customer).toMatchObject({
      state: 'waiting_for_items',
      menuOutcome: 'ordered',
      dishId: 'toast',
      drinkId: 'water',
      dishPriceAtOrder: 12,
      drinkPriceAtOrder: 2,
      orderSubtotal: 14,
      orderTime: 42,
    });
    expect(result.serviceItems).toEqual([
      expect.objectContaining({ kind: 'dish', menuItemId: 'toast', customerId: 'c1' }),
      expect.objectContaining({ kind: 'drink', menuItemId: 'water', customerId: 'c1' }),
    ]);
  });

  it('creates no service item when every basket is unaffordable', () => {
    const expensiveState = {
      restaurant: { reputation: 3, gameTime: 42 },
      dishes: [{ id: 'toast', price: 100, quality: 1, popularity: 50, prepTime: 120 }],
      unlockedDrinkIds: ['water'], drinkOverrides: { water: { price: 100 } },
      serviceItems: [],
    };
    const result = createCustomerOrder(expensiveState, {
      id: 'c1', partyId: 'p1', state: 'seated', tableId: 't1',
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 6,
    }, () => 0);
    expect(result.customer).toMatchObject({
      state: 'waiting_for_party', menuOutcome: 'unaffordable',
      dishId: null, drinkId: null, orderSubtotal: null,
    });
    expect(result.serviceItems).toEqual(expensiveState.serviceItems);
  });

  it('assigns one lazy profile and preserves it on repeated order calls', () => {
    const state = {
      restaurant: { reputation: 1, gameTime: 42 },
      dishes: [], unlockedDrinkIds: ['water'], drinkOverrides: {}, serviceItems: [],
    };
    const rolls = [0, 0, 0, 0];
    const first = createCustomerOrder(state, {
      id: 'legacy', partyId: 'p1', tableId: 't1', state: 'seated',
      archetype: 'regular',
    }, () => rolls.shift());
    expect(first.customer).toMatchObject({ spendingTier: 'budget', spendingBudget: 6 });

    const second = createCustomerOrder({ ...state, serviceItems: first.serviceItems }, first.customer, () => 0.99);
    expect(second.customer.spendingTier).toBe(first.customer.spendingTier);
    expect(second.customer.spendingBudget).toBe(first.customer.spendingBudget);
    expect(second.serviceItems).toEqual(first.serviceItems);
  });

  it('creates one scalar-owned item per selected kind', () => {
    const state = {
      dishes: [{ id: 'toast', popularity: 50, quality: 1, price: 12 }],
      unlockedDrinkIds: ['water'], serviceItems: [],
    };
    const customer = {
      id: 'c1', tableId: 't1', state: 'seated',
      spendingTier: 'value', spendingBudget: 20,
    };
    const rolls = [0.8, 0];

    const result = createCustomerOrder(state, customer, () => rolls.shift());

    expect(result.customer).toMatchObject({
      state: 'waiting_for_items', dishId: 'toast', drinkId: 'water',
    });
    expect(result.serviceItems).toEqual([
      expect.objectContaining({ kind: 'dish', menuItemId: 'toast', customerId: 'c1', tableId: 't1', state: 'ordered' }),
      expect.objectContaining({ kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1', state: 'ordered' }),
    ]);
    expect(result.customer.orderedServiceItemIds).toEqual(
      result.serviceItems.filter(item => item.customerId === result.customer.id).map(item => item.id),
    );
    expect(result.customer.consumedServiceItemIds).toEqual([]);
    expect(result.serviceItems.every(item => !Array.isArray(item.customerId))).toBe(true);
  });

  it('allocates stable IDs and initialises every service-item field', () => {
    const rolls = [0.8, 0];
    const existing = [{ id: 'service-item-4', kind: 'dish', customerId: 'other' }];
    const result = createCustomerOrder({
      dishes: [{ id: 'toast', popularity: 50, quality: 1, price: 12 }],
      unlockedDrinkIds: ['water'], serviceItems: existing,
      restaurant: { gameTime: 42 },
    }, {
      id: 'c1', tableId: 't1', state: 'seated', orderTime: null,
      spendingTier: 'value', spendingBudget: 20,
    }, () => rolls.shift());

    expect(result.customer.orderTime).toBe(42);
    expect(result.serviceItems.slice(1)).toEqual([
      expect.objectContaining({ id: 'service-item-5', kind: 'dish', state: 'ordered' }),
      expect.objectContaining({ id: 'service-item-6', kind: 'drink', state: 'ordered' }),
    ]);
  });

  it('reserves a service-counter slot while a cook carries a finished dish to it', () => {
    const state = {
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'dish1', kind: 'dish', state: 'carried', assignedStaffId: 'cook1',
        serviceTableId: 'st1', serviceSlotIndex: 0,
      }],
      staff: [{
        id: 'cook1', role: 'cook', carryingServiceItemId: 'dish1',
        task: {
          type: 'place_dish_on_service', serviceItemId: 'dish1',
          serviceTableId: 'st1', serviceSlotIndex: 0,
        },
      }],
    };

    expect(findAvailableServiceSlot(state)).toEqual({
      serviceTableId: 'st1', serviceSlotIndex: 1, x: 180, y: 130,
    });
  });

  it('does not create a duplicate customer-kind item', () => {
    const existing = [{ id: 'service-item-1', kind: 'dish', customerId: 'c1' }];
    expect(hasDuplicateOwner(existing, 'c1', 'dish')).toBe(true);
    expect(hasDuplicateOwner(existing, 'c1', 'drink')).toBe(false);

    const customer = {
      id: 'c1', tableId: 't1', state: 'seated',
      spendingTier: 'value', spendingBudget: 20,
    };
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
    }, {
      id: 'c1', tableId: 't1', state: 'seated',
      spendingTier: 'budget', spendingBudget: 6,
    }, () => rolls.shift());

    expect(result.customer).toMatchObject({ dishId: null, drinkId: 'water' });
    expect(result.serviceItems.map(item => item.kind)).toEqual(['drink']);
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

  it('places service slots down a quarter-turned counter', () => {
    expect(getServiceSlotPosition({ x: 140, y: 120, rotation: 1 }, 2)).toEqual({
      x: 150, y: 190,
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

  it('keeps an eating combined order active after its consumed drink is removed', () => {
    const customer = {
      id: 'c1', state: 'eating', dishId: 'toast', drinkId: 'water',
      orderedServiceItemIds: ['dish', 'drink'], consumedServiceItemIds: ['drink'],
    };
    const result = normaliseServiceItemOwnership({
      customers: [customer], staff: [], tables: [], washStations: [], serviceTables: [],
      serviceItems: [
        { id: 'dish', customerId: 'c1', kind: 'dish', menuItemId: 'toast', state: 'delivered' },
      ],
    });

    expect(result.customers[0]).toEqual(customer);
  });

  it('does not let a removed consumed drink excuse a mismatched dish item', () => {
    const result = normaliseServiceItemOwnership({
      customers: [{
        id: 'c1', state: 'eating', dishId: 'toast', drinkId: 'water',
        orderedServiceItemIds: ['dish', 'drink'], consumedServiceItemIds: ['drink'],
      }],
      staff: [], tables: [], washStations: [], serviceTables: [],
      serviceItems: [
        { id: 'dish', customerId: 'c1', kind: 'drink', menuItemId: 'water', state: 'delivered' },
      ],
    });

    expect(result.customers[0]).toMatchObject({
      state: 'leaving', dishId: null, drinkId: null, orderTime: null,
    });
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
