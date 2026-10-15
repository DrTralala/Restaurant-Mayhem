import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCookbookPaidVisit, createCookbookState, getCookbookEntryStatus, getResolvedDish,
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

function payGazpacho(state, count) {
  const start = state.paidVisitSequence;
  for (let sequence = start + 1; sequence <= start + count; sequence += 1) {
    const outcome = { schemaVersion: 1, sequence, customerId: `c${sequence}`, partyId: `p${sequence}`,
      paidAt: 36000 + sequence, menuOutcome: 'ordered', foodOutcome: 'delivered',
      serviceContractId: null, serviceContractGuestId: null, subtotal: 16, tip: 2, totalPaid: 18,
      dish: { serviceItemId: `i${sequence}`, menuItemId: 'cookbook:gazpacho', cookbookId: 'gazpacho',
        priceAtOrder: 16, chargedAmount: 16, fulfilled: true, paid: true } };
    state = { ...state, paidVisitSequence: sequence,
      cookbook: applyCookbookPaidVisit(state.cookbook, outcome) };
  }
  return state;
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
      discovered: true, equipmentOwned: true, stationAvailable: false, canAdd: true,
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
    expect(getResolvedDish(state, 'cookbook:gazpacho')).toMatchObject({ name: 'House Gazpacho', price: 21 });
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
      price: 30, prepTime: 64, popularity: 55 });
    expect(speed.customers[0].dishOrderSnapshot).toEqual(snapshot);

    const appeal = reduceCookbookAction(payGazpacho(withStation(addGazpacho(baseState()), 'k4', 'eq4'), 15), {
      type: 'CHOOSE_DISH_MASTERY', cookbookId: 'gazpacho', perk: 'appeal' });
    expect(getResolvedDish(appeal, 'cookbook:gazpacho')).toMatchObject({ prepTime: 75, popularity: 65 });
  });

  it('inactiveNewRecipeFixedSeed: a dormant Gazpacho leaves the old-equivalent fixed-seed service run unchanged', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(11));
    const { state, report } = runRealService({ mode: 'contract', seed: 1, strategy: 'compact-service',
      gameStep: 8, duration: 5400, maxWallMs: 90000 });
    const fingerprint = { status: report.status, ticks: report.ticks, sequence: report.sequence,
      funds: report.funds, reputation: report.reputation, queuePeak: report.queuePeak,
      served: state.restaurant.totalServed, customers: state.customers.length };
    // Captured from the six-recipe implementation; the dormant Gazpacho entry
    // must not perturb arrivals, service, payments or revenue.
    expect(fingerprint).toEqual({ status: 'completed', ticks: 638, sequence: 7,
      funds: 247.65999999999997, reputation: 1, queuePeak: 2, served: 7, customers: 4 });
    expect(state.cookbook.schemaVersion).toBe(2);
    expect(state.cookbook.entries.gazpacho).toMatchObject({ discovered: false, paidPortions: 0, perk: null });
    expect(state.dishes.some(dish => dish.cookbookId === 'gazpacho')).toBe(false);
  });
});
