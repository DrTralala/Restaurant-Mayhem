import { describe, expect, it } from 'vitest';
import { getKitchenBlockerSummary } from './kitchenBlockerSummary';
import { createDishOrderSnapshot, getResolvedDish } from '../simulation/cookbook';
import { withOwnedAuthoredDishes } from '../simulation/menuTestFixtures';

function owner(id, overrides = {}) {
  return {
    id,
    state: 'seated',
    foodOutcome: 'pending',
    cancelledServiceItemIds: [],
    ...overrides,
  };
}

function dishItem(id, customerId = `customer-${id}`, overrides = {}) {
  return {
    id,
    customerId,
    kind: 'dish',
    menuItemId: 'toast',
    state: 'ordered',
    assignedStaffId: null,
    ...overrides,
  };
}

function makeState(overrides = {}) {
  const defaultDishes = [{ id: 'toast', cookbookId: 'toast', name: 'Dish toast' }];
  const authored = withOwnedAuthoredDishes({
    customers: [owner('customer-item-1')],
    serviceItems: [dishItem('item-1')],
    dishes: defaultDishes,
    staff: [{ id: 'cook-1', role: 'cook' }],
    equipment: [{ id: 'eq1', owned: true }],
    kitchenStations: [{ id: 'station-1', equipmentId: 'eq1' }],
    cookingBatches: [],
    ...overrides,
  }, overrides.dishes || defaultDishes);
  const serviceItems = authored.serviceItems.map(item => {
    if (item?.kind !== 'dish' || item.menuItemId == null || Object.hasOwn(item, 'dishOrderSnapshot')) return item;
    const dish = getResolvedDish(authored, item.menuItemId);
    if (!dish) return item;
    return { ...item, dishOrderSnapshot: createDishOrderSnapshot(dish, {
      serviceItemId: item.id,
      orderedAt: 0,
    }) };
  });
  return { ...authored, serviceItems };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('getKitchenBlockerSummary', () => {
  it('groups blocked orders by dish identity and name without double-counting reasons', () => {
    const state = freeze(makeState({
      dishes: [
        { id: 'toast', cookbookId: 'toast', name: 'Toast' },
        { id: 'other-toast', cookbookId: 'roast-vegetables', name: 'Toast' },
      ],
      serviceItems: [dishItem('item-1'), dishItem('item-2', 'customer-item-1'),
        dishItem('item-3', 'customer-item-1', { menuItemId: 'other-toast' })],
      staff: [],
    }));
    expect(getKitchenBlockerSummary(state)).toMatchObject({
      noCook: 3, noCompatibleStation: 1,
      byDish: [
        { menuItemId: 'toast', name: 'Toast', noCook: 2, noCompatibleStation: 0 },
        { menuItemId: 'other-toast', name: 'Toast', noCook: 1, noCompatibleStation: 1 },
      ],
    });
    expect(getKitchenBlockerSummary(makeState()).byDish).toEqual([]);
  });

  it('uses recorded snapshot names rather than renamed live dishes', () => {
    const authored = makeState({
      staff: [], kitchenStations: [],
      dishes: [{ id: 'toast', cookbookId: 'toast', name: 'Renamed toast' }],
      serviceItems: [dishItem('item-1')],
    });
    const item = authored.serviceItems[0];
    const dish = getResolvedDish(authored, item.menuItemId);
    const originalNameSnapshot = createDishOrderSnapshot({ ...dish, name: 'Original toast' }, {
      serviceItemId: item.id,
      orderedAt: 0,
    });
    const state = freeze({ ...authored,
      serviceItems: [{ ...item, dishOrderSnapshot: originalNameSnapshot }] });

    expect(getKitchenBlockerSummary(state).byDish).toEqual([
      { menuItemId: 'toast', name: 'Original toast', noCook: 1, noCompatibleStation: 1 },
    ]);
  });

  it('returns zero counts for an empty or incomplete state', () => {
    expect(getKitchenBlockerSummary({})).toEqual({ noCook: 0, noCompatibleStation: 0, byDish: [] });
    expect(getKitchenBlockerSummary({ serviceItems: [], customers: [] }))
      .toEqual({ noCook: 0, noCompatibleStation: 0, byDish: [] });
  });

  it('counts the same eligible dish under both independent structural blockers', () => {
    const state = makeState({ staff: [], kitchenStations: [] });

    expect(getKitchenBlockerSummary(state)).toEqual({ noCook: 1, noCompatibleStation: 1,
      byDish: [{ menuItemId: 'toast', name: 'Dish toast', noCook: 1, noCompatibleStation: 1 }] });
  });

  it('recognises owned equipment stations and rejects unowned or incompatible equipment', () => {
    const state = makeState();
    expect(getKitchenBlockerSummary(state).noCompatibleStation).toBe(0);

    expect(getKitchenBlockerSummary({ ...state, equipment: [{ id: 'eq1', owned: false }] }))
      .toMatchObject({ noCompatibleStation: 1 });
    expect(getKitchenBlockerSummary({
      ...state,
      kitchenStations: [{ id: 'station-2', equipmentId: 'eq2' }],
      equipment: [{ id: 'eq1', owned: true }, { id: 'eq2', owned: true }],
    })).toMatchObject({ noCompatibleStation: 1 });
  });

  it('counts a busy but compatible station as structurally present', () => {
    const state = makeState({
      serviceItems: [
        dishItem('item-1'),
        dishItem('busy-item', 'customer-busy', {
          state: 'preparing', batchId: 'batch-1', assignedStaffId: 'cook-1',
        }),
      ],
      customers: [owner('customer-item-1'), owner('customer-busy')],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook-1', stationId: 'station-1', serviceItemIds: ['busy-item'],
      }],
      staff: [{ id: 'cook-1', role: 'cook', task: { type: 'prepare_dish', batchId: 'batch-1' } }],
    });

    expect(getKitchenBlockerSummary(state)).toEqual({ noCook: 0, noCompatibleStation: 0, byDish: [] });
  });

  it('counts an employed cook even when currently off duty', () => {
    const state = makeState({
      staff: [{ id: 'cook-1', role: 'cook', effectiveDuty: 'rest' }],
    });

    expect(getKitchenBlockerSummary(state).noCook).toBe(0);
  });

  it('excludes cancelled, orphaned, leaving, drink, assigned and batched items', () => {
    const state = makeState({
      customers: [
        owner('customer-item-1'),
        owner('cancelled-owner', { cancelledServiceItemIds: ['cancelled-by-owner'] }),
        owner('outcome-cancelled', { foodOutcome: 'cancelled' }),
        owner('leaving-owner', { state: 'leaving' }),
      ],
      serviceItems: [
        dishItem('item-1'),
        dishItem('cancelled-flag', 'customer-item-1', { foodCancelled: true }),
        dishItem('prohibited', 'customer-item-1', { deliveryProhibited: true }),
        dishItem('cancelled-by-owner', 'cancelled-owner'),
        dishItem('cancelled-outcome', 'outcome-cancelled'),
        dishItem('orphan', 'missing-owner'),
        dishItem('leaving', 'leaving-owner'),
        dishItem('drink', 'customer-item-1', { kind: 'drink' }),
        dishItem('assigned', 'customer-item-1', { assignedStaffId: 'cook-1' }),
        dishItem('item-batch-marker', 'customer-item-1', { batchId: 'batch-marker' }),
        dishItem('item-batch-ledger', 'customer-item-1'),
      ],
      cookingBatches: [{
        id: 'batch-ledger', cookId: 'cook-1', stationId: 'station-1',
        serviceItemIds: ['item-batch-ledger'],
      }],
      staff: [],
      kitchenStations: [],
    });

    expect(getKitchenBlockerSummary(state)).toEqual({ noCook: 1, noCompatibleStation: 1,
      byDish: [{ menuItemId: 'toast', name: 'Dish toast', noCook: 1, noCompatibleStation: 1 }] });
  });

  it('skips items with an unresolved menu dish or malformed order snapshot', () => {
    const state = makeState({
      serviceItems: [
        dishItem('missing-menu', 'customer-item-1', { menuItemId: 'missing' }),
        dishItem('bad-snapshot', 'customer-item-1', {
          dishOrderSnapshot: { schemaVersion: 1, menuItemId: 'toast' },
        }),
      ],
      staff: [],
      kitchenStations: [],
    });

    expect(getKitchenBlockerSummary(state)).toEqual({ noCook: 0, noCompatibleStation: 0, byDish: [] });
  });

  it('does not mutate frozen input', () => {
    const state = freeze(makeState({ staff: [], kitchenStations: [] }));
    const snapshot = JSON.stringify(state);

    expect(getKitchenBlockerSummary(state)).toEqual({ noCook: 1, noCompatibleStation: 1,
      byDish: [{ menuItemId: 'toast', name: 'Dish toast', noCook: 1, noCompatibleStation: 1 }] });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
