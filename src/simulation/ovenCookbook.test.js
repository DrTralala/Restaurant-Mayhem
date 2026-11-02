import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCookbookPaidVisit, createCookbookState, getCookbookEntryStatus, getDishForServiceItem,
  getResolvedDish, reconcileCookbookDiscoveries, reduceCookbookAction,
} from './cookbook';
import { createCustomerOrder } from './serviceItems';
import { getEligibleCookingItems } from './cookingBatches';
import { processKitchen } from './kitchen';
import { updateStaff } from './staff';
import { createCareerRun } from './careerRun';

afterEach(() => vi.restoreAllMocks());

function baseState() {
  const state = {
    cookbook: createCookbookState(), paidVisitSequence: 0,
    careerRun: createCareerRun({ scenarioId: 'opening-week', runId: 'run-1', startedAt: 36000 }),
    restaurant: { gameTime: 36000, expansionLevel: 1, day: 1, funds: 600, dailyRevenue: 0,
      totalServed: 0, reputation: 3 },
    dishes: [], customers: [], serviceItems: [], staff: [], queue: [], tables: [], chairs: [], cookingBatches: [],
    equipment: [{ id: 'eq2', owned: true, speedMultiplier: 1 }],
    upgrades: [], kitchenStations: [], serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    doors: [{ id: 'door1', y: 340, role: 'exit' }], unlockedDrinkIds: [],
    completedCustomers: [], pendingPartyReviews: [], partyReviewHistory: [],
  };
  return { ...state, cookbook: reconcileCookbookDiscoveries(state) };
}

function withStation(state, id, equipmentId) {
  return { ...state, kitchenStations: [{ id, equipmentId, x: 100, y: 100 }] };
}

function diner(id = 'c1') {
  return { id, partyId: `party-${id}`, tableId: 't1', state: 'waiting_to_order', happiness: 80,
    archetype: 'regular', spendingTier: 'value', spendingBudget: 45 };
}

function order(state, id = 'c1') {
  const result = createCustomerOrder(state, diner(id), () => 0);
  return { ...state, customers: [...state.customers, result.customer], serviceItems: result.serviceItems };
}

function preparing(state, stationId) {
  const item = state.serviceItems[0];
  return { ...state, staff: [{ id: 'cook', role: 'cook', skill: 1, morale: 50, x: 90, y: 110,
    task: { type: 'prepare_dish', serviceItemId: item.id, stationId } }],
    serviceItems: state.serviceItems.map(value => ({ ...value, state: 'preparing', stationId,
      assignedStaffId: 'cook', preparationStartedAt: 36000, accumulatedWork: 0, lastProgressAt: 36000 })) };
}

function paidVisitOutcome(sequence, {
  cookbookId = 'roast-vegetables', menuOutcome = 'ordered', foodOutcome = 'delivered', chargedAmount,
} = {}) {
  const price = cookbookId === 'baked-eggs' ? 15 : cookbookId === 'roast-vegetables' ? 18 : 12;
  const charged = chargedAmount ?? (foodOutcome === 'delivered' ? price : 0);
  const fulfilled = foodOutcome === 'delivered';
  return {
    schemaVersion: 1, sequence, customerId: `c${sequence}`, partyId: `p${sequence}`,
    paidAt: 36000 + sequence, menuOutcome, foodOutcome,
    serviceContractId: null, serviceContractGuestId: null,
    subtotal: charged, tip: 2, totalPaid: charged + 2,
    dish: { serviceItemId: `i${sequence}`,
      menuItemId: cookbookId ? `cookbook:${cookbookId}` : `custom-${sequence}`,
      cookbookId, priceAtOrder: price, chargedAmount: charged,
      fulfilled, paid: fulfilled && charged > 0 },
  };
}

function applyVisit(state, options) {
  const sequence = state.paidVisitSequence + 1;
  const outcome = paidVisitOutcome(sequence, options);
  state = { ...state, paidVisitSequence: sequence,
    cookbook: applyCookbookPaidVisit(state.cookbook, outcome) };
  return { ...state, cookbook: reconcileCookbookDiscoveries(state) };
}

function payRecipe(state, cookbookId, count) {
  for (let index = 0; index < count; index += 1) state = applyVisit(state, { cookbookId });
  return state;
}

function addBakedEggs(state) {
  return reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'baked-eggs' });
}

function cashierReady(state) {
  return { ...state,
    cashierStations: [{ id: 'cashier-0', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'worker-0' }],
    staff: [{ id: 'worker-0', role: 'waiter', morale: 50, x: 840, y: 100,
      task: { type: 'take_payment', customerId: state.customers[0].id, stationId: 'cashier-0',
        startedAt: state.restaurant.gameTime - 60 } }],
    customers: state.customers.map(customer => ({ ...customer, state: 'checkout_processing',
      cashierStationId: 'cashier-0', x: 840, y: 180, paymentReady: false, tableId: null })) };
}

describe('Oven recipe gameplay', () => {
  it('discovers Baked Eggs only after three paid Roast Vegetables portions without changing menu or funds', () => {
    let state = baseState();
    expect(getCookbookEntryStatus(state, 'baked-eggs')).toMatchObject({
      discovered: false, equipmentOwned: true, stationAvailable: false, canAdd: false,
      requirements: [
        { type: 'equipment', id: 'eq2', current: 1, required: 1, met: true },
        { type: 'paidPortions', id: 'roast-vegetables', current: 0, required: 3, met: false },
      ],
    });
    const funds = state.restaurant.funds;
    state = payRecipe(state, 'roast-vegetables', 2);
    expect(getCookbookEntryStatus(state, 'baked-eggs')).toMatchObject({ discovered: false,
      requirements: [{ type: 'equipment', met: true }, { type: 'paidPortions', current: 2, required: 3, met: false }] });
    state = applyVisit(state, { cookbookId: 'roast-vegetables' });
    expect(getCookbookEntryStatus(state, 'baked-eggs')).toMatchObject({ discovered: true,
      equipmentOwned: true, stationAvailable: false, canAdd: true,
      requirements: [{ type: 'equipment', met: true }, { type: 'paidPortions', current: 3, required: 3, met: true }] });
    expect(state.dishes).toEqual([]);
    expect(state.restaurant.funds).toBe(funds);
  });

  it.each([
    ['an unrelated authored dish', { cookbookId: 'toast' }],
    ['a custom dish', { cookbookId: null }],
    ['a free delivered dish', { chargedAmount: 0 }],
    ['a cancelled dish', { foodOutcome: 'cancelled' }],
    ['an unpaid, undelivered portion', { foodOutcome: 'pending' }],
  ])('does not count %s towards Baked Eggs discovery', (_label, options) => {
    let state = payRecipe(baseState(), 'roast-vegetables', 2);
    state = applyVisit(state, options);
    expect(state.cookbook.entries['roast-vegetables'].paidPortions).toBe(2);
    expect(getCookbookEntryStatus(state, 'baked-eggs')).toMatchObject({ discovered: false,
      requirements: [
        { type: 'equipment', id: 'eq2', current: 1, required: 1, met: true },
        { type: 'paidPortions', id: 'roast-vegetables', current: 2, required: 3, met: false },
      ] });
  });

  it('adds Baked Eggs explicitly for free and retains edited menu settings after removal', () => {
    let state = payRecipe(baseState(), 'roast-vegetables', 3);
    const funds = state.restaurant.funds;
    state = addBakedEggs(state);
    expect(state.dishes.at(-1)).toMatchObject({ id: 'cookbook:baked-eggs', cookbookId: 'baked-eggs',
      name: 'Baked Eggs', base: 'Eggs', method: 'Baked', requiredEquipmentId: 'eq2', cuisine: 'generic',
      price: 15, quality: 1, prepTime: 120, popularity: 60, unlocked: true });
    expect(state.restaurant.funds).toBe(funds);
    expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'baked-eggs' })).toBe(state);
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'cookbook:baked-eggs',
      changes: { name: 'House Baked Eggs', price: 19 } });
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'cookbook:baked-eggs' });
    state = addBakedEggs(state);
    expect(getResolvedDish(state, 'cookbook:baked-eggs')).toMatchObject({ name: 'House Baked Eggs', price: 19 });
  });

  it('orders Baked Eggs only for a matching owned Oven and applies the authored 120-second prep time', () => {
    let state = withStation(addBakedEggs(payRecipe(baseState(), 'roast-vegetables', 3)), 'k2', 'eq2');
    state = order(state);
    expect(state.customers[0].dishOrderSnapshot).toMatchObject({ cookbookId: 'baked-eggs',
      name: 'Baked Eggs', base: 'Eggs', method: 'Baked', requiredEquipmentId: 'eq2',
      prepTime: 120, popularity: 60, price: 15, quality: 1, masteryPerk: null });
    const cook = { id: 'cook', role: 'cook', skill: 1 };
    expect(getEligibleCookingItems({ ...state, kitchenStations: [] }, cook, undefined)).toHaveLength(0);
    const unownedOven = withStation({ ...state,
      equipment: state.equipment.map(item => ({ ...item, owned: false })),
    }, 'k2', 'eq2');
    expect(getEligibleCookingItems(unownedOven, cook, unownedOven.kitchenStations[0])).toHaveLength(0);
    const mismatchedStation = withStation(state, 'k1', 'eq1');
    expect(getEligibleCookingItems(mismatchedStation, cook, mismatchedStation.kitchenStations[0])).toHaveLength(0);
    expect(getEligibleCookingItems(state, cook, state.kitchenStations[0])).toHaveLength(1);

    state = preparing(state, 'k2');
    const beforeReady = processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36119 } });
    expect(beforeReady.serviceItems[0].state).toBe('preparing');
    const ready = processKitchen({ ...beforeReady, restaurant: { ...beforeReady.restaurant, gameTime: 36120 } });
    expect(ready.serviceItems[0].state).toBe('ready');
  });

  it('is ready sooner than Roast Vegetables under the same actual kitchen conditions', () => {
    const ovenState = withStation(addBakedEggs(payRecipe(baseState(), 'roast-vegetables', 3)), 'k2', 'eq2');
    let eggs = preparing(order(ovenState), 'k2');
    let roast = preparing(order(withStation(reduceCookbookAction(baseState(), {
      type: 'ADD_COOKBOOK_DISH', cookbookId: 'roast-vegetables',
    }), 'k2', 'eq2')), 'k2');

    eggs = processKitchen({ ...eggs, restaurant: { ...eggs.restaurant, gameTime: 36120 } });
    roast = processKitchen({ ...roast, restaurant: { ...roast.restaurant, gameTime: 36149 } });
    expect(eggs.serviceItems[0].state).toBe('ready');
    expect(roast.serviceItems[0].state).toBe('preparing');
    roast = processKitchen({ ...roast, restaurant: { ...roast.restaurant, gameTime: 36150 } });
    expect(roast.serviceItems[0].state).toBe('ready');
  });

  it('credits a paid Baked Eggs portion only at real checkout, not on delivery', () => {
    let state = withStation(addBakedEggs(payRecipe(baseState(), 'roast-vegetables', 3)), 'k2', 'eq2');
    state = order(state);
    state = preparing(state, 'k2');
    state = processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36120 } });
    expect(state.serviceItems[0].state).toBe('ready');
    const itemId = state.serviceItems[0].id;
    state = updateStaff({ ...state, cookingBatches: [], tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      staff: [{ id: 'waiter', role: 'waiter', morale: 50, x: 180, y: 220,
        carryingServiceItemIds: [itemId], task: { type: 'deliver_service_item', serviceItemId: itemId, customerId: 'c1' } }],
      serviceItems: state.serviceItems.map(item => ({ ...item, state: 'carried', assignedStaffId: 'waiter', stationId: null })) }, 0);
    expect(state.customers[0]).toMatchObject({ foodOutcome: 'delivered' });
    expect(state.cookbook.entries['baked-eggs'].paidPortions).toBe(0);
    expect(state.paidVisitSequence).toBe(3);

    state = cashierReady({ ...state, serviceItems: [] });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const paid = updateStaff(state, 0);
    expect(paid.completedCustomers[0]).toMatchObject({ paidVisitSequence: 4 });
    expect(paid.cookbook.entries['baked-eggs'].paidPortions).toBe(1);
    expect(paid.cookbook.lastAppliedPaidVisitSequence).toBe(4);
  });

  it.each([
    ['speed', 102, 60],
    ['appeal', 120, 70],
  ])('commits %s mastery to actual Baked Eggs order snapshots without later menu edits changing them', (perk, prepTime, popularity) => {
    let state = payRecipe(baseState(), 'roast-vegetables', 3);
    state = addBakedEggs(state);
    state = payRecipe(state, 'baked-eggs', 15);
    state = reduceCookbookAction(state, { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'baked-eggs', perk });
    state = order(state);
    const snapshot = state.customers[0].dishOrderSnapshot;
    expect(snapshot).toMatchObject({ cookbookId: 'baked-eggs', name: 'Baked Eggs', base: 'Eggs',
      method: 'Baked', requiredEquipmentId: 'eq2', price: 15, quality: 1,
      prepTime, popularity, masteryPerk: perk });

    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'cookbook:baked-eggs',
      changes: { name: 'Edited Baked Eggs', price: 31 } });
    expect(state.customers[0].dishOrderSnapshot).toEqual(snapshot);
    expect(getDishForServiceItem(state, state.serviceItems[0])).toMatchObject({
      name: 'Baked Eggs', price: 15, prepTime, popularity, masteryPerk: perk,
    });
    expect(getResolvedDish(state, 'cookbook:baked-eggs')).toMatchObject({
      name: 'Edited Baked Eggs', price: 31, prepTime, popularity,
    });
  });

  it('keeps an unmastered order snapshot unchanged when mastery and menu settings change later', () => {
    let state = addBakedEggs(payRecipe(baseState(), 'roast-vegetables', 3));
    state = payRecipe(state, 'baked-eggs', 14);
    state = order(state);
    const snapshot = state.customers[0].dishOrderSnapshot;
    expect(snapshot).toMatchObject({ cookbookId: 'baked-eggs', price: 15, prepTime: 120,
      popularity: 60, masteryPerk: null });

    state = applyVisit(state, { cookbookId: 'baked-eggs' });
    state = reduceCookbookAction(state, { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'baked-eggs', perk: 'speed' });
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'cookbook:baked-eggs',
      changes: { name: 'Edited Baked Eggs', price: 31 } });
    expect(state.customers[0].dishOrderSnapshot).toEqual(snapshot);
    expect(getDishForServiceItem(state, state.serviceItems[0])).toMatchObject({
      name: 'Baked Eggs', price: 15, prepTime: 120, popularity: 60, masteryPerk: null,
    });
    expect(getResolvedDish(state, 'cookbook:baked-eggs')).toMatchObject({
      name: 'Edited Baked Eggs', price: 31, prepTime: 102, popularity: 60, masteryPerk: 'speed',
    });
  });
});
