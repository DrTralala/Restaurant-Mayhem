import { describe, expect, it } from 'vitest';
import {
  applyCookbookPaidVisit, createCookbookState, getCookbookEntryStatus, getDishForServiceItem,
  reconcileCookbookDiscoveries, reduceCookbookAction,
} from './cookbook';
import { createCustomerOrder } from './serviceItems';
import { getEligibleCookingItems } from './cookingBatches';
import { processKitchen } from './kitchen';
import { getDishPricing } from './dishPricing';
import { buildAffordableBaskets } from './menuEconomy';
import { createPurchaseBalanceState } from './cookbookPurchaseBalance.testSupport';

function baseState(fryerOwned = false) {
  const state = {
    cookbook: createCookbookState(),
    paidVisitSequence: 0,
    restaurant: { gameTime: 36000, funds: 600, reputation: 1 },
    dishes: [{ id: 'starter-toast', cookbookId: 'toast', name: 'Toasted Bread', base: 'Bread',
      method: 'Toasted', requiredEquipmentId: 'eq1', cuisine: 'generic', price: 12,
      quality: 1, prepTime: 60, popularity: 50, unlocked: true }],
    equipment: [{ id: 'eq1', owned: true }, { id: 'eq3', owned: fryerOwned }],
    kitchenStations: [],
    recipeSlots: 1,
    customers: [],
    serviceItems: [],
    cookingBatches: [],
    unlockedDrinkIds: [],
    drinkOverrides: {},
  };
  return { ...state, cookbook: reconcileCookbookDiscoveries(state) };
}

function addCrispyFries(state) {
  state = reduceCookbookAction(state, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'fries' });
  return reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'fries' });
}

function payForCrispyFries(state) {
  const sequence = state.paidVisitSequence + 1;
  const outcome = {
    schemaVersion: 1,
    sequence,
    customerId: `customer-${sequence}`,
    partyId: `party-${sequence}`,
    paidAt: 36000 + sequence,
    menuOutcome: 'ordered',
    foodOutcome: 'delivered',
    serviceContractId: null,
    serviceContractGuestId: null,
    subtotal: 10,
    tip: 0,
    totalPaid: 10,
    dish: { serviceItemId: `service-item-${sequence}`, menuItemId: 'cookbook:fries',
      cookbookId: 'fries', priceAtOrder: 10, chargedAmount: 10, fulfilled: true, paid: true },
  };
  const paid = { ...state, paidVisitSequence: sequence,
    cookbook: applyCookbookPaidVisit(state.cookbook, outcome) };
  return { ...paid, cookbook: reconcileCookbookDiscoveries(paid) };
}

function fryerState() {
  return addCrispyFries(baseState(true));
}

function menuForShoestringService() {
  const state = createPurchaseBalanceState({
    equipmentId: 'eq3', reputation: 1, quality: 1, policy: 'reference',
  });
  return {
    ...state,
    restaurant: { ...state.restaurant, gameTime: 36000 },
    dishes: state.dishes.filter(dish => ['fries', 'shoestring-fries'].includes(dish.cookbookId)),
    kitchenStations: [{ id: 'fryer-station', equipmentId: 'eq3', x: 100, y: 100 }],
    customers: [],
    serviceItems: [],
    cookingBatches: [],
  };
}

describe('Shoestring Fries', () => {
  it('requires three paid Crispy Fries portions before discovering the recipe', () => {
    let state = fryerState();
    expect(getCookbookEntryStatus(state, 'shoestring-fries')).toMatchObject({
      discovered: false,
      requirements: [
        { type: 'equipment', id: 'eq3', current: 1, required: 1, met: true },
        { type: 'paidPortions', id: 'fries', current: 0, required: 3, met: false },
      ],
    });

    state = payForCrispyFries(payForCrispyFries(state));
    expect(state.cookbook.entries.fries.paidPortions).toBe(2);
    expect(getCookbookEntryStatus(state, 'shoestring-fries')).toMatchObject({
      discovered: false,
      requirements: [
        { type: 'equipment', id: 'eq3', current: 1, required: 1, met: true },
        { type: 'paidPortions', id: 'fries', current: 2, required: 3, met: false },
      ],
    });

    state = payForCrispyFries(state);
    expect(state.cookbook.entries.fries.paidPortions).toBe(3);
    expect(getCookbookEntryStatus(state, 'shoestring-fries')).toMatchObject({
      discovered: true, owned: false, purchaseCost: 100, canBuy: true, canAdd: false,
      requirements: [
        { type: 'equipment', id: 'eq3', current: 1, required: 1, met: true },
        { type: 'paidPortions', id: 'fries', current: 3, required: 3, met: true },
      ],
    });
  });

  it('keeps portions insufficient without a Fryer and unlocks after equipment ownership', () => {
    let state = baseState(false);
    state.cookbook = { ...state.cookbook, entries: { ...state.cookbook.entries,
      fries: { ...state.cookbook.entries.fries, discovered: true, owned: true, paidPortions: 3 },
    } };
    state.cookbook = reconcileCookbookDiscoveries(state);
    expect(getCookbookEntryStatus(state, 'shoestring-fries')).toMatchObject({
      discovered: false,
      requirements: [
        { type: 'equipment', id: 'eq3', current: 0, required: 1, met: false },
        { type: 'paidPortions', id: 'fries', current: 3, required: 3, met: true },
      ],
    });

    state = { ...state, equipment: state.equipment.map(item =>
      item.id === 'eq3' ? { ...item, owned: true } : item) };
    state.cookbook = reconcileCookbookDiscoveries(state);
    expect(getCookbookEntryStatus(state, 'shoestring-fries')).toMatchObject({
      discovered: true, equipmentOwned: true, canBuy: true,
    });

    state = { ...state, equipment: state.equipment.map(item =>
      item.id === 'eq3' ? { ...item, owned: false } : item) };
    expect(getCookbookEntryStatus(state, 'shoestring-fries')).toMatchObject({
      discovered: true, equipmentOwned: false, canBuy: false, canAdd: false,
    });
    expect(reduceCookbookAction(state, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'shoestring-fries' }))
      .toBe(state);
  });

  it('charges once and adds a distinct authored dish alongside Crispy Fries', () => {
    let state = fryerState();
    for (let index = 0; index < 3; index += 1) state = payForCrispyFries(state);
    state = { ...state, restaurant: { ...state.restaurant, funds: 100 } };
    expect(getCookbookEntryStatus(state, 'shoestring-fries')).toMatchObject({
      canAfford: true, canBuy: true, canAdd: false, activeDishId: null,
    });

    const beforeDishes = state.dishes;
    const bought = reduceCookbookAction(state, {
      type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'shoestring-fries', cost: 0,
    });
    expect(bought.restaurant.funds).toBe(0);
    expect(bought.dishes).toBe(beforeDishes);
    expect(bought.recipeSlots).toBe(1);
    expect(bought.cookbook.entries['shoestring-fries'].owned).toBe(true);
    expect(getCookbookEntryStatus(bought, 'shoestring-fries')).toMatchObject({
      canBuy: false, canAdd: true, activeDishId: null,
    });
    expect(reduceCookbookAction(bought, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'shoestring-fries' }))
      .toBe(bought);

    const added = reduceCookbookAction(bought, {
      type: 'ADD_COOKBOOK_DISH', cookbookId: 'shoestring-fries', price: 99,
    });
    expect(added.dishes).toHaveLength(beforeDishes.length + 1);
    expect(added.dishes.find(dish => dish.cookbookId === 'fries'))
      .toMatchObject({ id: 'cookbook:fries', name: 'Crispy Fries', price: 10 });
    expect(added.dishes.find(dish => dish.cookbookId === 'shoestring-fries'))
      .toMatchObject({ id: 'cookbook:shoestring-fries', cookbookId: 'shoestring-fries',
        name: 'Shoestring Fries', base: 'Potato', method: 'Fried', requiredEquipmentId: 'eq3',
        price: 8, quality: 1, prepTime: 70, popularity: 45, unlocked: true });
    expect(getCookbookEntryStatus(added, 'shoestring-fries').activeDishId).toBe('cookbook:shoestring-fries');
    expect(getCookbookEntryStatus(added, 'fries').activeDishId).toBe('cookbook:fries');
    expect(getCookbookEntryStatus(added, 'shoestring-fries').activeDishId)
      .not.toBe(getCookbookEntryStatus(added, 'fries').activeDishId);
    expect(getCookbookEntryStatus(added, 'fries').paidPortions).toBe(3);
  });

  it('offers the Q1 $8 budget niche while trading lower per-portion revenue for faster base work', () => {
    const state = createPurchaseBalanceState({
      equipmentId: 'eq3', reputation: 1, quality: 1, policy: 'reference',
    });
    const shoestring = state.dishes.find(dish => dish.cookbookId === 'shoestring-fries');
    const fries = state.dishes.find(dish => dish.cookbookId === 'fries');
    expect(getDishPricing('shoestring-fries', 1)).toEqual({ referenceValue: 8, minPrice: 6, maxPrice: 10 });
    expect(shoestring).toMatchObject({ price: 8, prepTime: 70, popularity: 45 });
    expect(fries).toMatchObject({ price: 10, prepTime: 105, popularity: 55 });

    const affordable = buildAffordableBaskets(state, {
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 8,
    });
    expect(affordable.map(basket => [basket.dish.cookbookId, basket.price]))
      .toEqual([['shoestring-fries', 8]]);
    expect(shoestring.price).toBeLessThan(fries.price);
    expect(shoestring.prepTime).toBeLessThan(fries.prepTime);
    expect(60 * shoestring.price / shoestring.prepTime)
      .toBeGreaterThan(60 * fries.price / fries.prepTime);
  });

  it('uses Shoestring Fries identity and Q1 stats in the real order and fryer cooking path', () => {
    const state = menuForShoestringService();
    const result = createCustomerOrder(state, {
      id: 'guest-1', partyId: 'party-1', tableId: 'table-1', state: 'waiting_to_order',
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 8,
    }, () => 0);
    expect(result.customer).toMatchObject({ menuOutcome: 'ordered', dishId: 'cookbook:shoestring-fries' });
    expect(result.customer.dishOrderSnapshot).toMatchObject({
      menuItemId: 'cookbook:shoestring-fries', cookbookId: 'shoestring-fries', name: 'Shoestring Fries',
      base: 'Potato', method: 'Fried', requiredEquipmentId: 'eq3', price: 8, quality: 1,
      prepTime: 70, popularity: 45, masteryPerk: null,
    });

    const ordered = { ...state, customers: [result.customer], serviceItems: result.serviceItems };
    const item = result.serviceItems[0];
    expect(getDishForServiceItem(ordered, item)).toMatchObject({
      id: 'cookbook:shoestring-fries', cookbookId: 'shoestring-fries', price: 8,
      prepTime: 70, popularity: 45,
    });
    const cook = { id: 'cook', role: 'cook', skill: 1, morale: 50, x: 90, y: 110 };
    const station = state.kitchenStations[0];
    expect(getEligibleCookingItems(ordered, cook, station)).toEqual([item]);
    expect(getEligibleCookingItems(ordered, cook, { id: 'oven-station', equipmentId: 'eq2' })).toHaveLength(0);

    const preparing = {
      ...ordered,
      staff: [{ ...cook, task: { type: 'prepare_dish', serviceItemId: item.id, stationId: station.id } }],
      serviceItems: ordered.serviceItems.map(serviceItem => ({ ...serviceItem, state: 'preparing',
        stationId: station.id, assignedStaffId: cook.id, preparationStartedAt: 36000,
        accumulatedWork: 0, lastProgressAt: 36000 })),
    };
    expect(processKitchen({ ...preparing,
      restaurant: { ...preparing.restaurant, gameTime: 36069 } }).serviceItems[0].state).toBe('preparing');
    expect(processKitchen({ ...preparing,
      restaurant: { ...preparing.restaurant, gameTime: 36070 } }).serviceItems[0].state).toBe('ready');
  });
});
