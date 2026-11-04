import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCookbookPaidVisit, createCookbookState, getCookbookEntryStatus, getDishForServiceItem, getResolvedDish,
  reconcileCookbookDiscoveries, reduceCookbookAction,
} from './cookbook';
import { createCustomerOrder } from './serviceItems';
import { getEligibleCookingItems } from './cookingBatches';
import { processKitchen } from './kitchen';
import { updateStaff } from './staff';
import { createCareerRun } from './careerRun';
import { runRealService, seededRandom } from './realServiceHarness.testSupport';

afterEach(() => vi.restoreAllMocks());

function baseState() {
  const state = {
    cookbook: createCookbookState(), paidVisitSequence: 0,
    careerRun: createCareerRun({ scenarioId: 'opening-week', runId: 'run-1', startedAt: 36000 }),
    restaurant: { gameTime: 36000, expansionLevel: 1, day: 1, funds: 600, dailyRevenue: 0,
      totalServed: 0, reputation: 3 },
    dishes: [], customers: [], serviceItems: [], staff: [], queue: [], tables: [], chairs: [],
    cookingBatches: [],
    equipment: [{ id: 'eq4', owned: true, speedMultiplier: 1 }, { id: 'eq2', owned: true, speedMultiplier: 1 }],
    upgrades: [], kitchenStations: [], serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    doors: [{ id: 'door1', y: 340, role: 'exit' }], unlockedDrinkIds: [],
    completedCustomers: [], pendingPartyReviews: [], partyReviewHistory: [],
  };
  return { ...state, cookbook: reconcileCookbookDiscoveries(state) };
}

function addGazpacho(state) {
  state = reduceCookbookAction(state, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'gazpacho' }) ?? state;
  return reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'gazpacho' });
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
  cookbookId = 'gazpacho', menuOutcome = 'ordered', foodOutcome = 'delivered', chargedAmount,
} = {}) {
  const price = cookbookId === 'fish-bisque' ? 20 : 16;
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
  if (state.cookbook.entries[cookbookId]?.discovered && !state.cookbook.entries[cookbookId].owned) {
    state = reduceCookbookAction(state, { type: 'BUY_COOKBOOK_RECIPE', cookbookId }) ?? state;
  }
  for (let index = 0; index < count; index += 1) state = applyVisit(state, { cookbookId });
  return state;
}

function payGazpacho(state, count) {
  return payRecipe(state, 'gazpacho', count);
}

function addFishBisque(state) {
  state = reduceCookbookAction(state, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'fish-bisque' }) ?? state;
  return reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'fish-bisque' });
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

describe('Blender recipe gameplay', () => {
  it('discovers and adds off-station, guards duplicates and missing equipment, and retains menu edits through removal', () => {
    let state = baseState();
    expect(getCookbookEntryStatus(state, 'gazpacho')).toMatchObject({
      discovered: true, owned: false, equipmentOwned: true, stationAvailable: false,
      purchaseCost: 125, canBuy: true, canAdd: false,
    });
    state = addGazpacho(state);
    expect(state.dishes).toHaveLength(1);
    expect(state.dishes[0]).toMatchObject({ cookbookId: 'gazpacho', prepTime: 75, popularity: 55,
      price: 16, quality: 1 });
    expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'gazpacho' })).toBe(state);

    const missing = baseState();
    missing.equipment = [];
    missing.cookbook = reconcileCookbookDiscoveries(missing);
    expect(getCookbookEntryStatus(missing, 'gazpacho').canAdd).toBe(false);
    expect(reduceCookbookAction(missing, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'gazpacho' })).toBe(missing);

    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'cookbook:gazpacho',
      changes: { name: 'House Gazpacho', price: 21 } });
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'cookbook:gazpacho' });
    expect(state.dishes).toHaveLength(0);
    state = addGazpacho(state);
    expect(getResolvedDish(state, 'cookbook:gazpacho')).toMatchObject({ name: 'House Gazpacho', price: 20 });
  });

  it('requires five paid Gazpacho portions and an owned Blender to discover Fish Bisque', () => {
    let state = payGazpacho(baseState(), 4);
    expect(getCookbookEntryStatus(state, 'fish-bisque')).toMatchObject({
      discovered: false, equipmentOwned: true, canAdd: false,
      requirements: [
        { type: 'equipment', id: 'eq4', current: 1, required: 1, met: true },
        { type: 'paidPortions', id: 'gazpacho', current: 4, required: 5, met: false },
      ],
    });
    state = payGazpacho(state, 1);
    expect(getCookbookEntryStatus(state, 'fish-bisque')).toMatchObject({
      discovered: true, owned: false, equipmentOwned: true, stationAvailable: false,
      purchaseCost: 225, canBuy: true, canAdd: false,
      requirements: [
        { type: 'equipment', id: 'eq4', current: 1, required: 1, met: true },
        { type: 'paidPortions', id: 'gazpacho', current: 5, required: 5, met: true },
      ],
    });

    let missing = baseState();
    missing.equipment = missing.equipment.map(item => item.id === 'eq4' ? { ...item, owned: false } : item);
    missing.cookbook = reconcileCookbookDiscoveries(missing);
    missing = payGazpacho(missing, 5);
    expect(getCookbookEntryStatus(missing, 'fish-bisque')).toMatchObject({
      discovered: false, equipmentOwned: false, canAdd: false,
    });
    missing.equipment = missing.equipment.map(item => item.id === 'eq4' ? { ...item, owned: true } : item);
    missing = { ...missing, cookbook: reconcileCookbookDiscoveries(missing) };
    missing = reduceCookbookAction(missing, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'gazpacho' });
    missing = payGazpacho(missing, 5);
    expect(getCookbookEntryStatus(missing, 'fish-bisque')).toMatchObject({
      discovered: true, owned: false, canBuy: true, canAdd: false,
    });
  });

  it.each([
    ['an unrelated authored dish', { cookbookId: 'toast' }],
    ['a custom dish', { cookbookId: null }],
    ['a free delivered dish', { chargedAmount: 0 }],
    ['a cancelled dish', { foodOutcome: 'cancelled' }],
    ['an unpaid, undelivered portion', { foodOutcome: 'pending' }],
  ])('does not count %s towards Fish Bisque discovery', (_label, options) => {
    let state = payGazpacho(baseState(), 4);
    state = applyVisit(state, options);
    expect(state.cookbook.entries.gazpacho.paidPortions).toBe(4);
    const status = getCookbookEntryStatus(state, 'fish-bisque');
    expect(status.discovered).toBe(false);
    expect(status.requirements.find(requirement => requirement.id === 'gazpacho'))
      .toMatchObject({ current: 4, required: 5, met: false });
  });

  it('adds Fish Bisque explicitly, guards duplicates and retains menu edits through removal', () => {
    let state = payGazpacho(baseState(), 5);
    state = addFishBisque(state);
    expect(state.dishes.at(-1)).toMatchObject({ id: 'cookbook:fish-bisque', cookbookId: 'fish-bisque',
      name: 'Fish Bisque', base: 'Fish', method: 'Blended', requiredEquipmentId: 'eq4',
      cuisine: 'generic', price: 20, quality: 1, prepTime: 135, popularity: 68, unlocked: true });
    expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'fish-bisque' })).toBe(state);

    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'cookbook:fish-bisque',
      changes: { name: 'House Fish Bisque', price: 27 } });
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'cookbook:fish-bisque' });
    expect(state.dishes).toHaveLength(0);
    state = addFishBisque(state);
    expect(getResolvedDish(state, 'cookbook:fish-bisque')).toMatchObject({ name: 'House Fish Bisque', price: 25 });
  });

  it('prepares Gazpacho at a Blender station and not at a mismatched Oven station', () => {
    let state = withStation(addGazpacho(baseState()), 'k4', 'eq4');
    state = order(state);
    expect(state.customers[0].dishOrderSnapshot).toMatchObject({ cookbookId: 'gazpacho',
      prepTime: 75, popularity: 55, price: 16, masteryPerk: null });
    const cook = { id: 'cook', role: 'cook', skill: 1 };
    expect(getEligibleCookingItems(state, cook, state.kitchenStations[0])).toHaveLength(1);
    const oven = withStation(state, 'k2', 'eq2');
    expect(getEligibleCookingItems(oven, cook, oven.kitchenStations[0])).toHaveLength(0);
    state = preparing(state, 'k4');
    expect(processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36074 } })
      .serviceItems[0].state).toBe('preparing');
    expect(processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36075 } })
      .serviceItems[0].state).toBe('ready');
  });

  it('prepares Fish Bisque only at an owned matching Blender station', () => {
    const added = addFishBisque(payGazpacho(baseState(), 5));
    const state = order(added);
    const cook = { id: 'cook', role: 'cook', skill: 1 };
    expect(state.customers[0].dishOrderSnapshot).toMatchObject({ cookbookId: 'fish-bisque',
      name: 'Fish Bisque', base: 'Fish', method: 'Blended', requiredEquipmentId: 'eq4',
      prepTime: 135, popularity: 68, price: 20, quality: 1, masteryPerk: null });
    expect(getEligibleCookingItems({ ...state, kitchenStations: [] }, cook, undefined)).toHaveLength(0);
    const unownedBlender = withStation({ ...state,
      equipment: state.equipment.map(item => item.id === 'eq4' ? { ...item, owned: false } : item),
    }, 'k4', 'eq4');
    expect(getEligibleCookingItems(unownedBlender, cook, unownedBlender.kitchenStations[0])).toHaveLength(0);
    const oven = withStation(state, 'k2', 'eq2');
    expect(getEligibleCookingItems(oven, cook, oven.kitchenStations[0])).toHaveLength(0);
    const blender = withStation(state, 'k4', 'eq4');
    expect(getEligibleCookingItems(blender, cook, blender.kitchenStations[0])).toHaveLength(1);
  });

  it('credits one paid Gazpacho portion at checkout, never on delivery alone', () => {
    let state = withStation(addGazpacho(baseState()), 'k4', 'eq4');
    state = order(state);
    state = preparing(state, 'k4');
    state = processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36075 } });
    expect(state.serviceItems[0].state).toBe('ready');
    const itemId = state.serviceItems[0].id;
    state = updateStaff({ ...state, cookingBatches: [], tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      staff: [{ id: 'waiter', role: 'waiter', morale: 50, x: 180, y: 220, carryingServiceItemIds: [itemId],
        task: { type: 'deliver_service_item', serviceItemId: itemId, customerId: 'c1' } }],
      serviceItems: state.serviceItems.map(item => ({ ...item, state: 'carried',
        assignedStaffId: 'waiter', stationId: null })) }, 0);
    expect(state.customers[0]).toMatchObject({ foodOutcome: 'delivered' });
    expect(state.cookbook.entries.gazpacho.paidPortions).toBe(0);
    expect(state.paidVisitSequence).toBe(0);

    state = cashierReady({ ...state, serviceItems: [] });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const paid = updateStaff(state, 0);
    expect(paid.completedCustomers[0]).toMatchObject({ paidVisitSequence: 1 });
    expect(paid.customers[0]).toMatchObject({ paidVisitSequence: 1 });
    expect(paid.cookbook.entries.gazpacho.paidPortions).toBe(1);
    expect(paid.cookbook.lastAppliedPaidVisitSequence).toBe(1);
    expect(paid.careerRun.paidMeals).toBe(1);
  });

  it('credits one paid Fish Bisque portion at real checkout, never on delivery alone', () => {
    let state = withStation(addFishBisque(payGazpacho(baseState(), 5)), 'k4', 'eq4');
    state = order(state);
    state = preparing(state, 'k4');
    state = processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36135 } });
    expect(state.serviceItems[0].state).toBe('ready');
    const itemId = state.serviceItems[0].id;
    state = updateStaff({ ...state, cookingBatches: [], tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      staff: [{ id: 'waiter', role: 'waiter', morale: 50, x: 180, y: 220, carryingServiceItemIds: [itemId],
        task: { type: 'deliver_service_item', serviceItemId: itemId, customerId: 'c1' } }],
      serviceItems: state.serviceItems.map(item => ({ ...item, state: 'carried',
        assignedStaffId: 'waiter', stationId: null })) }, 0);
    expect(state.customers[0]).toMatchObject({ foodOutcome: 'delivered' });
    expect(state.cookbook.entries['fish-bisque'].paidPortions).toBe(0);
    expect(state.paidVisitSequence).toBe(5);

    state = cashierReady({ ...state, serviceItems: [] });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const paid = updateStaff(state, 0);
    expect(paid.completedCustomers[0]).toMatchObject({ paidVisitSequence: 6 });
    expect(paid.customers[0]).toMatchObject({ paidVisitSequence: 6 });
    expect(paid.cookbook.entries['fish-bisque'].paidPortions).toBe(1);
    expect(paid.cookbook.lastAppliedPaidVisitSequence).toBe(6);
  });

  it.each([
    ['speed', 115, 68],
    ['appeal', 135, 78],
  ])('commits %s mastery to Fish Bisque order snapshots without later menu edits changing them', (perk, prepTime, popularity) => {
    let state = payGazpacho(baseState(), 5);
    state = addFishBisque(state);
    state = payRecipe(state, 'fish-bisque', 15);
    state = reduceCookbookAction(state, { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'fish-bisque', perk });
    state = order(state);
    const snapshot = state.customers[0].dishOrderSnapshot;
    expect(snapshot).toMatchObject({ cookbookId: 'fish-bisque', name: 'Fish Bisque', base: 'Fish',
      method: 'Blended', requiredEquipmentId: 'eq4', price: 20, quality: 1,
      prepTime, popularity, masteryPerk: perk });

    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'cookbook:fish-bisque',
      changes: { name: 'Edited Fish Bisque', price: 31 } });
    expect(state.customers[0].dishOrderSnapshot).toEqual(snapshot);
    expect(getDishForServiceItem(state, state.serviceItems[0])).toMatchObject({
      name: 'Fish Bisque', price: 20, prepTime, popularity, masteryPerk: perk,
    });
    expect(getResolvedDish(state, 'cookbook:fish-bisque')).toMatchObject({
      name: 'Edited Fish Bisque', price: 25, prepTime, popularity,
    });
  });

  it('captures chosen mastery terms in committed snapshots and keeps them through later menu edits', () => {
    const speedBase = withStation(addGazpacho(baseState()), 'k4', 'eq4');
    let speed = reduceCookbookAction(payGazpacho(speedBase, 15), {
      type: 'CHOOSE_DISH_MASTERY', cookbookId: 'gazpacho', perk: 'speed' });
    speed = order(speed);
    const snapshot = speed.customers[0].dishOrderSnapshot;
    expect(snapshot).toMatchObject({ cookbookId: 'gazpacho', prepTime: 64, popularity: 55,
      price: 16, masteryPerk: 'speed' });
    speed = reduceCookbookAction(speed, { type: 'UPDATE_DISH', id: 'cookbook:gazpacho',
      changes: { name: 'Edited Gazpacho', price: 30 } });
    expect(getResolvedDish(speed, 'cookbook:gazpacho')).toMatchObject({ name: 'Edited Gazpacho',
      price: 20, prepTime: 64, popularity: 55 });
    expect(speed.customers[0].dishOrderSnapshot).toEqual(snapshot);

    const appeal = reduceCookbookAction(payGazpacho(withStation(addGazpacho(baseState()), 'k4', 'eq4'), 15), {
      type: 'CHOOSE_DISH_MASTERY', cookbookId: 'gazpacho', perk: 'appeal' });
    expect(getResolvedDish(appeal, 'cookbook:gazpacho')).toMatchObject({ prepTime: 75, popularity: 65 });
  });

  it('inactiveNewRecipesFixedSeed: dormant Blender recipes leave the fixed-seed service run unchanged', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(11));
    const { state, report } = runRealService({ mode: 'contract', seed: 1, strategy: 'compact-service',
      gameStep: 8, duration: 5400, maxWallMs: 90000 });
    const fingerprint = { status: report.status, ticks: report.ticks, sequence: report.sequence,
      funds: report.funds, reputation: report.reputation, queuePeak: report.queuePeak,
      served: state.restaurant.totalServed, customers: state.customers.length };
    // The current compact-service run completes its full 5,400-second horizon
    // (675 native 8-second ticks) and the active staff scheduler serves one
    // additional guest versus the committed scheduler. Gazpacho remains dormant.
    expect(fingerprint).toEqual({ status: 'completed', ticks: 675, sequence: 8,
      funds: 358.99000000000007, reputation: 1.0274999999999999,
      queuePeak: 1, served: 8, customers: 3 });
    expect(state.cookbook.schemaVersion).toBe(3);
    expect(state.cookbook.entries.gazpacho).toMatchObject({ discovered: false, paidPortions: 0, perk: null });
    expect(state.cookbook.entries['fish-bisque']).toMatchObject({ discovered: false, paidPortions: 0, perk: null });
    expect(state.cookbook.entries['baked-eggs']).toMatchObject({ discovered: false, paidPortions: 0, perk: null });
    expect(state.dishes.some(dish => dish.cookbookId === 'gazpacho')).toBe(false);
    expect(state.dishes.some(dish => dish.cookbookId === 'fish-bisque')).toBe(false);
    expect(state.dishes.some(dish => dish.cookbookId === 'baked-eggs')).toBe(false);
  });
});
