import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCookbookState, createDishOrderSnapshot, getResolvedDish, reduceCookbookAction } from './cookbook';
import { createCareerRun } from './careerRun';
import { createCustomerOrder, normaliseServiceItemOwnership } from './serviceItems';
import { buildAffordableBaskets } from './menuEconomy';
import { createCookingBatch, getEligibleCookingItems, normaliseCookingBatches } from './cookingBatches';
import { processKitchen } from './kitchen';
import { getStaffTaskDuration } from './staffPerformance';
import { updateStaff } from './staff';
import { expireFoodPatience } from './foodPatience';
import { calculateRevenue } from './revenue';
import { acceptServiceContract } from './serviceContracts';
import { createInitialState } from '../state/initialState';

afterEach(() => vi.restoreAllMocks());

function baseState(perk = null) {
  const cookbook = createCookbookState();
  Object.assign(cookbook.entries.toast, { paidPortions: perk ? 15 : 0, perk });
  return { cookbook, paidVisitSequence: perk ? 15 : 0,
    careerRun: createCareerRun({ scenarioId: 'opening-week', runId: 'run-1', startedAt: 36000 }),
    restaurant: { gameTime: 36000, expansionLevel: 1, day: 1, funds: 600, dailyRevenue: 0, totalServed: 0, reputation: 3 },
    dishes: [{ id: 'starter-toast', cookbookId: 'toast', name: 'Toasted Bread', base: 'Bread', method: 'Toasted',
      cuisine: 'generic', requiredEquipmentId: 'eq1', price: 12, quality: 1, prepTime: 60, popularity: 50 }],
    customers: [], serviceItems: [], staff: [], queue: [], tables: [], chairs: [], cookingBatches: [],
    equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1 }], upgrades: [],
    kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 100 }],
    serviceTables: [{ id: 'st1', x: 140, y: 120 }], doors: [{ id: 'door1', y: 340, role: 'exit' }],
    unlockedDrinkIds: [], completedCustomers: [], pendingPartyReviews: [], partyReviewHistory: [] };
}

function diner(id = 'c1') {
  return { id, partyId: `party-${id}`, tableId: 't1', state: 'waiting_to_order', happiness: 80,
    archetype: 'regular', spendingTier: 'value', spendingBudget: 45 };
}

function order(state = baseState(), id = 'c1') {
  const result = createCustomerOrder(state, diner(id), () => 0);
  return { ...state, customers: [...state.customers, result.customer], serviceItems: result.serviceItems };
}

function committedFixture(perk = null) {
  const state = baseState(perk);
  const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'service-item-1', orderedAt: 36000 });
  return { ...state,
    customers: [{ ...diner(), state: 'waiting_for_items', menuOutcome: 'ordered', foodOutcome: 'pending',
      foodOrderedAt: 36000, foodDeadlineAt: 36900, dishId: 'starter-toast', drinkId: null,
      dishPriceAtOrder: 12, drinkPriceAtOrder: null, orderSubtotal: 12,
      orderedServiceItemIds: ['service-item-1'], consumedServiceItemIds: [], cancelledServiceItemIds: [],
      dishOrderSnapshot: snapshot }],
    serviceItems: [{ id: 'service-item-1', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1',
      tableId: 't1', state: 'ordered', assignedStaffId: null, dishOrderSnapshot: { ...snapshot } }] };
}

function preparing(state, batch = false) {
  const item = state.serviceItems[0];
  state = { ...state, staff: [{ id: 'cook', role: 'cook', skill: 1, morale: 50, x: 90, y: 110,
    task: { type: 'prepare_dish', serviceItemId: item.id, stationId: 'k1',
      ...(batch ? { batchId: 'batch-1', serviceItemIds: [item.id] } : {}) } }],
    serviceItems: state.serviceItems.map(value => ({ ...value, state: 'preparing', stationId: 'k1', assignedStaffId: 'cook',
      preparationStartedAt: 36000, accumulatedWork: 0, lastProgressAt: 36000,
      ...(batch ? { batchId: 'batch-1' } : {}) })) };
  return batch ? createCookingBatch(state, { id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: [item.id], startedAt: 36000 }) : state;
}

function cashierReady(state) {
  return { ...state,
    cashierStations: state.customers.map((customer, i) => ({ id: `cashier-${i}`, x: 800, y: 120 + i * 160, w: 80, h: 40, assignedStaffId: `worker-${i}` })),
    staff: state.customers.map((customer, i) => ({ id: `worker-${i}`, role: 'waiter', morale: 50, x: 840, y: 100 + i * 160,
      task: { type: 'take_payment', customerId: customer.id, stationId: `cashier-${i}`, startedAt: state.restaurant.gameTime - 60 } })),
    customers: state.customers.map((customer, i) => ({ ...customer, state: 'checkout_processing',
      cashierStationId: `cashier-${i}`, x: 840, y: 180 + i * 160, paymentReady: false, tableId: null })) };
}

describe('committed food snapshots through real consumers', () => {
  it('captures the selected resolved basket once on the new customer and item, and reserves cleaned retained IDs', () => {
    let state = baseState('speed');
    const baskets = buildAffordableBaskets(state, diner());
    expect(baskets[0].dish.prepTime).toBe(51);
    state = order(state);
    const snapshot = state.customers[0].dishOrderSnapshot;
    expect(snapshot).toMatchObject({ menuItemId: 'starter-toast', cookbookId: 'toast', prepTime: 51, popularity: 50, masteryPerk: 'speed', price: 12 });
    expect(state.serviceItems[0].dishOrderSnapshot).toEqual(snapshot);
    const repeat = createCustomerOrder(state, state.customers[0], () => { throw new Error('already committed order rerolled'); });
    expect(repeat.customer.dishOrderSnapshot).toBe(snapshot);
    state = order({ ...state, serviceItems: [] }, 'c2');
    expect(state.serviceItems[0].id).toBe('service-item-2');
    expect(state.customers[0].dishOrderSnapshot.serviceItemId).toBe('service-item-1');
  });

  it('never produces an authored snapshot for incomplete legacy custom fixtures or unaffordable orders', () => {
    const state = { ...baseState(), dishes: [{ id: 'legacy', price: 12, prepTime: 60, popularity: 50, quality: 1 }] };
    const result = createCustomerOrder(state, diner(), () => 0);
    expect(result.customer).not.toHaveProperty('dishOrderSnapshot');
    expect(result.serviceItems[0]).not.toHaveProperty('dishOrderSnapshot');
    const unaffordable = createCustomerOrder(baseState(), { ...diner(), spendingTier: 'budget', spendingBudget: 6 }, () => 0);
    expect(unaffordable.customer).not.toHaveProperty('dishOrderSnapshot');
    expect(unaffordable.serviceItems).toEqual([]);
  });

  it('rejects invalid present snapshots instead of rerolling or rewriting an existing order', () => {
    const state = committedFixture();
    state.customers[0].dishOrderSnapshot = { ...state.customers[0].dishOrderSnapshot, prepTime: 1 };
    expect(() => createCustomerOrder(state, state.customers[0], () => 0)).toThrow();
  });

  it('rejects an orphaned present item snapshot instead of committing a replacement customer copy', () => {
    const state = committedFixture();
    delete state.customers[0].dishOrderSnapshot;
    expect(() => createCustomerOrder(state, state.customers[0], () => 0)).toThrow();
  });

  it('snapshots the already-selected effective basket even when the choice state changes during selection', () => {
    const state = baseState('speed');
    const result = createCustomerOrder(state, diner(), () => {
      state.cookbook.entries.toast.perk = 'appeal';
      return 0;
    });
    expect(result.customer.dishOrderSnapshot).toMatchObject({ prepTime: 51, popularity: 50, masteryPerk: 'speed' });
    expect(getResolvedDish(state, 'starter-toast')).toMatchObject({ prepTime: 60, popularity: 60 });
  });

  it('invalid present food work cannot become a default 60-second staff task', () => {
    const state = preparing(committedFixture('speed'));
    state.serviceItems[0].dishOrderSnapshot = { ...state.serviceItems[0].dishOrderSnapshot, prepTime: 1 };
    expect(getStaffTaskDuration(state, state.staff[0])).toBeNull();
    expect(processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36060 } }).serviceItems[0].state).not.toBe('ready');
  });

  it.each([false, true])('toastKitchenWorkWindow: speed ready at 51, appeal only at 60 (batch %s)', batch => {
    const speed = preparing(committedFixture('speed'), batch);
    const appeal = preparing(committedFixture('appeal'), batch);
    const at51 = state => processKitchen({ ...state, dishes: [], restaurant: { ...state.restaurant, gameTime: 36051 } });
    const quick = at51(speed);
    const favourite = at51(appeal);
    expect(quick.serviceItems[0].state).toBe('ready');
    expect(favourite.serviceItems[0]).toMatchObject({ state: 'preparing', accumulatedWork: 51 });
    expect(getStaffTaskDuration({ ...speed, dishes: [] }, speed.staff[0])).toBe(51);
    expect(processKitchen({ ...favourite, restaurant: { ...favourite.restaurant, gameTime: 36060 } }).serviceItems[0].state).toBe('ready');
    expect(processKitchen({ ...quick, restaurant: { ...quick.restaurant, gameTime: 36060 } }).serviceItems[0].state).toBe('ready');
    if (batch) expect(quick.cookingBatches).toHaveLength(1);
  });

  it('retains eligibility and batch reconciliation after removal, without accepting invalid present food stats', () => {
    const state = { ...committedFixture(), dishes: [] };
    expect(getEligibleCookingItems(state, { id: 'cook', role: 'cook', skill: 1 }, state.kitchenStations[0])).toHaveLength(1);
    const batch = preparing(state, true);
    expect(normaliseCookingBatches(JSON.parse(JSON.stringify(batch))).cookingBatches).toHaveLength(1);
    batch.serviceItems[0].dishOrderSnapshot = { ...batch.serviceItems[0].dishOrderSnapshot, prepTime: 0 };
    expect(normaliseCookingBatches(batch).cookingBatches).toHaveLength(0);
  });

  it('choosing speed after commitment changes new baskets but not the already-ordered kitchen target', () => {
    let state = committedFixture();
    state.paidVisitSequence = 15;
    state.cookbook.entries.toast.paidPortions = 15;
    state = reduceCookbookAction(state, { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'speed' });
    expect(buildAffordableBaskets(state, diner())[0].dish.prepTime).toBe(51);
    state = preparing(state);
    const at51 = processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36051 } });
    expect(at51.serviceItems[0]).toMatchObject({ state: 'preparing', accumulatedWork: 51, dishOrderSnapshot: { prepTime: 60, masteryPerk: null } });
    expect(processKitchen({ ...at51, restaurant: { ...state.restaurant, gameTime: 36060 } }).serviceItems[0].state).toBe('ready');
  });

  it('removedAuthoredDishInFlight: actual order, edit/removal, cooking, delivery, consumption, cleanup and checkout keep committed facts', () => {
    let state = baseState();
    state.dishes[0].quality = 4;
    state.cookbook.entries.toast.menuSettings.quality = 4;
    state = order(state);
    expect(state.customers[0].dishOrderSnapshot).toMatchObject({ prepTime: 60, quality: 4, price: 12 });
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 99, name: 'Changed' } });
    state = reduceCookbookAction(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' });
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'starter-toast' });
    state = preparing(state);
    state = processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36060 } });
    expect(state.serviceItems[0].state).toBe('ready');
    const itemId = state.serviceItems[0].id;
    state = updateStaff({ ...state, cookingBatches: [], tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      staff: [{ id: 'waiter', role: 'waiter', morale: 50, x: 180, y: 220,
        carryingServiceItemIds: [itemId], task: { type: 'deliver_service_item', serviceItemId: itemId, customerId: 'c1' } }],
      serviceItems: state.serviceItems.map(item => ({ ...item, state: 'carried', assignedStaffId: 'waiter', stationId: null })) }, 0);
    expect(state.customers[0]).toMatchObject({ foodOutcome: 'delivered', happiness: 86 });
    state = processKitchen({ ...state, restaurant: { ...state.restaurant, gameTime: 36540 } });
    expect(state.serviceItems[0].state).toBe('dirty_at_table');
    // Physical cleanup deletes the plate; checkout must rely on the retained customer copy.
    state = cashierReady({ ...state, serviceItems: [] });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    state = updateStaff(state, 0);
    expect(state.completedCustomers[0]).toMatchObject({ revenue: 14.4, tip: 2.4, totalPaid: 14.4, reviewScore: 100, paidVisitSequence: 1 });
    expect(state.cookbook.entries.toast.paidPortions).toBe(1);
    expect(state.careerRun.paidMeals).toBe(1);
    expect(state.customers[0].dishOrderSnapshot).toMatchObject({ name: 'Toasted Bread', price: 12, quality: 4, prepTime: 60 });
  });
});

describe('actual cashier integration', () => {
  it('does not replay an old pending receipt into features during duplicate cashier recovery', () => {
    let state = committedFixture();
    state.customers[0].foodOutcome = 'delivered';
    const oldReceipt = { customerId: 'c1', revenue: 14, totalPaid: 14, tip: 2 };
    state = cashierReady({ ...state, serviceItems: [], completedCustomers: [oldReceipt] });
    const random = vi.spyOn(Math, 'random');
    const recovered = updateStaff(state, 0);
    expect(recovered.completedCustomers).toEqual([oldReceipt]);
    expect(recovered.paidVisitSequence).toBe(0);
    expect(recovered.cookbook.entries.toast.paidPortions).toBe(0);
    expect(recovered.careerRun.paidMeals).toBe(0);
    expect(recovered.customers[0].paidVisitSequence).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it('direct updateStaff is an identity operation while a career decision is pending', () => {
    const state = cashierReady(committedFixture());
    state.careerRun.needsDecision = true;
    expect(updateStaff(state, 60)).toBe(state);
    expect(state.customers[0].dishOrderSnapshot.prepTime).toBe(60);
  });

  it('preserves two contract guest awards and both other consumers through a later invalid-worker recovery', () => {
    let state = committedFixture();
    const accepted = acceptServiceContract(createInitialState(), { templateId: 'office-lunch' });
    const active = accepted.serviceContracts.active;
    state.serviceContracts = { ...accepted.serviceContracts, active: { ...active,
      parties: active.parties.map((party, i) => i === 0 ? { ...party, status: 'admitted', admittedAt: 36900 } : party),
      guests: active.guests.map((guest, i) => i < 2 ? { ...guest, status: 'pending' } : guest) } };
    state.restaurant.gameTime = 36900;
    state.customers = active.guests.slice(0, 2).map((guest, i) => ({ ...state.customers[0],
      id: guest.guestId, partyId: guest.partyId, serviceContractId: active.instanceId, serviceContractGuestId: guest.guestId,
      foodOutcome: 'delivered', dishOrderSnapshot: { ...state.customers[0].dishOrderSnapshot, serviceItemId: `service-item-${i + 1}` },
      orderedServiceItemIds: [`service-item-${i + 1}`] }));
    state = cashierReady({ ...state, serviceItems: [] });
    state.staff.push({ id: 'invalid-cook', role: 'cook', morale: 50, x: 600, y: 600,
      task: { type: 'prepare_dish', serviceItemId: 'missing', stationId: 'missing' } });
    const paid = updateStaff(state, 0);
    expect(paid.serviceContracts.active.guests.slice(0, 2).map(row => [row.status, row.paidVisitSequence]))
      .toEqual([['fulfilled_paid', 1], ['fulfilled_paid', 2]]);
    expect(paid.cookbook.entries.toast.paidPortions).toBe(2);
    expect(paid.careerRun.paidMeals).toBe(2);
    expect(paid.customers.map(customer => customer.paidVisitSequence)).toEqual([1, 2]);
    expect(paid.staff[2].task).toBeNull();
  });

  it('threads two cashier completions in sequence and blocks replay after revenue drain without another RNG/review/served update', () => {
    let state = committedFixture();
    const snapshot = { ...state.customers[0].dishOrderSnapshot, serviceItemId: 'service-item-2' };
    state.customers = [state.customers[0], { ...state.customers[0], id: 'c2', partyId: 'party-c2', dishOrderSnapshot: snapshot,
      orderedServiceItemIds: ['service-item-2'] }].map(customer => ({ ...customer, foodOutcome: 'delivered' }));
    state = cashierReady({ ...state, serviceItems: [] });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const paid = updateStaff(state, 0);
    expect(paid.paidVisitSequence).toBe(2);
    expect(paid.customers.map(customer => customer.paidVisitSequence)).toEqual([1, 2]);
    expect(paid.completedCustomers.map(payment => payment.paidVisitSequence)).toEqual([1, 2]);
    expect(paid.cookbook.entries.toast.paidPortions).toBe(2);
    expect(paid.careerRun).toMatchObject({ paidMeals: 2, lastPaidVisitSequence: 2 });
    expect(paid.restaurant.totalServed).toBe(2);
    const drained = calculateRevenue(paid);
    const calls = random.mock.calls.length;
    const replayed = updateStaff(cashierReady(drained), 0);
    expect(random.mock.calls.length).toBe(calls);
    expect(replayed.completedCustomers).toEqual([]);
    expect(replayed.cookbook).toEqual(paid.cookbook);
    expect(replayed.restaurant).toEqual(drained.restaurant);
  });

  it('cancellation at the exact deadline followed by drink checkout never charges or credits food', () => {
    let state = committedFixture();
    state.unlockedDrinkIds = ['water'];
    state.customers[0] = { ...state.customers[0], drinkId: 'water', drinkPriceAtOrder: 5, orderSubtotal: 17,
      orderedServiceItemIds: ['service-item-1', 'drink-item'] };
    state.serviceItems.push({ id: 'drink-item', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'delivered', tableId: 't1' });
    state = expireFoodPatience({ ...state, restaurant: { ...state.restaurant, gameTime: 36900 } }, 36900);
    state = normaliseServiceItemOwnership(state);
    expect(state.customers[0]).toMatchObject({ foodOutcome: 'cancelled', dishId: null, orderSubtotal: 5,
      dishOrderSnapshot: { price: 12, cookbookId: 'toast' } });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const paid = updateStaff(cashierReady(state), 0);
    expect(paid.completedCustomers[0]).toMatchObject({ revenue: 6, tip: 1 });
    expect(paid.cookbook.entries.toast.paidPortions).toBe(0);
    expect(paid.careerRun.paidMeals).toBe(0);
    expect(paid.paidVisitSequence).toBe(1);
  });

  it('diagnoses sequence exhaustion from the real payment branch before publishing a receipt or progress', () => {
    const state = committedFixture();
    state.customers[0].foodOutcome = 'delivered';
    state.serviceItems = [];
    state.paidVisitSequence = Number.MAX_SAFE_INTEGER;
    expect(() => updateStaff(cashierReady(state), 0)).toThrow(/exhaust/i);
    expect(state.completedCustomers).toEqual([]);
    expect(state.cookbook.entries.toast.paidPortions).toBe(0);
  });
});
