import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCareerInitialState, createInitialState } from './initialState';
import { hydrateState, loadState, saveState } from './persistence';
import { validateSavedState } from './saveValidation';
import { createCustomerOrder, normaliseServiceItemOwnership } from '../simulation/serviceItems';
import { expireFoodPatience } from '../simulation/foodPatience';
import { getOrderSnapshotSubtotal } from '../simulation/menuEconomy';
import { getCheckoutBill } from '../simulation/paidVisits';
import { updateStaff } from '../simulation/staff';
import { calculateRevenue } from '../simulation/revenue';
import { recordPartyOrderOutcome } from '../simulation/partyReviews';
import { getCashierCustomerPosition, getCashierWorkPosition } from '../simulation/world';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

function orderedState(mixed = false) {
  const state = createCareerInitialState({ scenarioId: 'opening-week', runId: 'fix-regression' });
  state.unlockedDrinkIds = mixed ? ['water'] : [];
  const order = createCustomerOrder(state, { id: 'guest', partyId: 'party', state: 'seated',
    archetype: 'regular', spendingTier: 'value', spendingBudget: 45, patienceMax: 900 }, () => mixed ? 0.8 : 0);
  return { ...state, customers: [order.customer], serviceItems: order.serviceItems,
    pendingPartyReviews: recordPartyOrderOutcome([], [order.customer], order.customer, 'ordered') };
}

function cashierReady(state) {
  const station = { ...state.cashierStations[0], assignedStaffId: 'cashier' };
  return { ...state, cashierStations: [station], staff: [{
    ...state.staff.find(worker => worker.role === 'waiter'), id: 'cashier', morale: 50,
    ...getCashierWorkPosition(station),
    task: { type: 'take_payment', customerId: state.customers[0].id, stationId: station.id,
      startedAt: state.restaurant.gameTime - 60 },
  }], customers: state.customers.map(customer => ({ ...customer, state: 'checkout_processing',
    cashierStationId: station.id, paymentReady: false, ...getCashierCustomerPosition(station, 0) })) };
}

function reload(state) {
  expect(saveState(state)).toBe(true);
  const saved = loadState();
  expect(saved).not.toBeNull();
  const hydrated = hydrateState(saved, createInitialState());
  expect(() => validateSavedState(hydrated)).not.toThrow();
  return hydrated;
}

function legacyOrder() {
  const state = createInitialState();
  for (const key of ['cookbook', 'careerRun', 'serviceContracts', 'paidVisitSequence']) delete state[key];
  state.dishes = state.dishes.map(({ cookbookId, ...dish }) => dish);
  state.restaurant.reputation = 3;
  state.customers = [{ id: 'guest', state: 'waiting_for_items', dishId: 'starter-toast', drinkId: null,
    menuOutcome: 'ordered', foodOutcome: 'pending', foodOrderedAt: 35990, foodPatienceBudget: 300,
    foodDeadlineAt: 36290, orderTime: 35990, dishPriceAtOrder: 9, drinkPriceAtOrder: null, orderSubtotal: 9,
    orderedServiceItemIds: ['dish-1'], consumedServiceItemIds: [] }];
  state.serviceItems = [{ id: 'dish-1', customerId: 'guest', menuItemId: 'starter-toast', kind: 'dish', state: 'ordered' }];
  return state;
}

function completeCheckout(state) {
  return updateStaff(cashierReady({ ...state, serviceItems: [], customers: state.customers.map(customer => ({ ...customer,
    foodOutcome: customer.foodOutcome === 'cancelled' ? 'cancelled' : 'delivered' })) }), 0);
}

describe('I1 cancelled dish-only checkout', () => {
  it.each([false, true])('commits one zero-value checkout without food credit, preserving review policy (reload %s)', shouldReload => {
    let state = orderedState();
    const deadline = state.customers[0].foodDeadlineAt;
    state = expireFoodPatience({ ...state, restaurant: { ...state.restaurant, gameTime: deadline } }, deadline);
    expect(state.customers[0]).toMatchObject({ foodOutcome: 'cancelled', dishId: null, drinkId: null,
      dishPriceAtOrder: null, drinkPriceAtOrder: null, orderSubtotal: 0, dishOrderSnapshot: { price: 12 } });
    state = cashierReady(state);
    if (shouldReload) state = reload(reload(state));
    expect(getCheckoutBill(state, state.customers[0])).toMatchObject({ subtotal: 0, dishAmount: 0 });
    const reputation = state.restaurant.reputation;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const paid = updateStaff(cashierReady(state), 0);
    expect(paid.completedCustomers).toEqual([expect.objectContaining({ revenue: 0, tip: 0, totalPaid: 0, reviewScore: 100, paidVisitSequence: 1 })]);
    expect(paid.restaurant.totalServed).toBe(1);
    expect(paid.restaurant.reputation).toBeCloseTo(reputation + 0.02);
    expect(paid.partyReviewHistory[0]).toMatchObject({ score: 100, paidCount: 1 });
    expect(paid.cookbook.entries.toast.paidPortions).toBe(0);
    expect(paid.careerRun.paidMeals).toBe(0);
    expect(paid.paidVisitSequence).toBe(1);
    expect(paid.customers[0].dishOrderSnapshot).toEqual(state.customers[0].dishOrderSnapshot);
    const drained = calculateRevenue(paid);
    const replayed = updateStaff(cashierReady(reload(drained)), 0);
    expect(replayed.completedCustomers).toEqual([]);
    expect(replayed.restaurant.totalServed).toBe(1);
    expect(replayed.paidVisitSequence).toBe(1);
  });

  it('recognises only the explicit cancelled no-line zero tuple, not missing or contradictory tuples', () => {
    const customer = { menuOutcome: 'ordered', foodOutcome: 'cancelled', dishId: null, drinkId: null,
      dishPriceAtOrder: null, drinkPriceAtOrder: null, orderSubtotal: 0 };
    expect(getOrderSnapshotSubtotal(customer)).toBe(0);
    for (const changes of [{ foodOutcome: 'pending' }, { foodOutcome: null }, { orderSubtotal: 1 },
      { orderSubtotal: undefined }, { dishPriceAtOrder: undefined }, { drinkId: 'water' }, { dishId: 'starter-toast' }]) {
      expect(getOrderSnapshotSubtotal({ ...customer, ...changes })).toBeNull();
    }
  });
});

describe('I2 complete legacy migration or conservative absence', () => {
  it.each([
    ['complete edited price', () => {}, true, 9, 3],
    ['partial tuple', customer => { delete customer.drinkPriceAtOrder; delete customer.orderSubtotal; }, false, 12, 3],
    ['absent menu outcome', customer => { delete customer.menuOutcome; }, false, 12, 3.02],
    ['inconsistent legacy tuple', customer => { customer.orderSubtotal = 99; }, false, 12, 3],
  ])('preserves billing and actual checkout/review semantics for %s', (_name, alter, hasSnapshot, subtotal, reputation) => {
    const raw = legacyOrder();
    alter(raw.customers[0]);
    expect(() => validateSavedState(raw)).not.toThrow();
    expect(getCheckoutBill(raw, raw.customers[0]).subtotal).toBe(subtotal);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const rawPaid = completeCheckout(raw);
    const hydrated = hydrateState(raw, createInitialState());
    expect(Boolean(hydrated.customers[0].dishOrderSnapshot)).toBe(hasSnapshot);
    if (hasSnapshot) expect(hydrated.customers[0].dishOrderSnapshot).toMatchObject({ price: 9, cookbookId: null, masteryPerk: null });
    else expect(hydrated.serviceItems[0]).not.toHaveProperty('dishOrderSnapshot');
    expect(getCheckoutBill(hydrated, hydrated.customers[0]).subtotal).toBe(subtotal);
    const again = hydrateState(hydrated, createInitialState());
    expect(again.customers[0].dishOrderSnapshot).toEqual(hydrated.customers[0].dishOrderSnapshot);
    const paid = completeCheckout(again);
    expect(paid.completedCustomers[0]).toMatchObject(subtotal === 9
      ? { revenue: 10.8, tip: 1.8, reviewScore: 100 } : { revenue: 14.4, tip: 2.4, reviewScore: 100 });
    expect(paid.completedCustomers[0]).toEqual(rawPaid.completedCustomers[0]);
    expect(paid.restaurant.reputation).toBeCloseTo(reputation);
    expect(paid.restaurant.reputation).toBe(rawPaid.restaurant.reputation);
    expect(paid.restaurant.totalServed).toBe(rawPaid.restaurant.totalServed);
    expect(paid.cookbook.entries.toast.paidPortions).toBe(0);
  });

  it('retains recoverable historical cancellation price but bills only the surviving zero tuple', () => {
    let raw = legacyOrder();
    raw.serviceItems[0] = { ...raw.serviceItems[0], state: 'ready', stationId: 'k1', x: 120, y: 140 };
    raw = cashierReady(expireFoodPatience({ ...raw, restaurant: { ...raw.restaurant, gameTime: 36290 } }, 36290));
    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.customers[0].dishOrderSnapshot).toMatchObject({ cookbookId: null, price: 9 });
    expect(getCheckoutBill(hydrated, hydrated.customers[0]).subtotal).toBe(0);
    const paid = completeCheckout(hydrated);
    expect(paid.completedCustomers[0]).toMatchObject({ revenue: 0, tip: 0 });
    expect(paid.cookbook.entries.toast.paidPortions).toBe(0);
  });

  it.each(['menuOutcome', 'orderSubtotal', 'drinkPriceAtOrder'])('rejects a present new snapshot missing %s before normalisation can hide it', key => {
    const state = orderedState();
    delete state.customers[0][key];
    expect(() => validateSavedState(state)).toThrow();
    expect(() => hydrateState(state, createInitialState())).toThrow();
  });
});

describe('I3 nullable uncommitted visit markers', () => {
  it('loads an explicitly uncommitted full order and commits exactly one safe marker', () => {
    let state = cashierReady(orderedState());
    state.serviceItems = [];
    state.customers[0] = { ...state.customers[0], foodOutcome: 'delivered', paidVisitSequence: null,
      consumedServiceItemIds: [...state.customers[0].orderedServiceItemIds] };
    expect(() => validateSavedState(state)).not.toThrow();
    state = reload(state);
    expect(state.customers[0].paidVisitSequence).toBeNull();
    const paid = completeCheckout(state);
    expect(paid.customers[0].paidVisitSequence).toBe(1);
    expect(paid.paidVisitSequence).toBe(1);
    expect(() => validateSavedState(paid)).not.toThrow();
  });

  it('permits multiple null actors but never a null marker contradicting a correlated receipt', () => {
    const state = createInitialState();
    state.customers = [{ id: 'a', state: 'seated', paidVisitSequence: null },
      { id: 'b', state: 'seated', paidVisitSequence: null }];
    expect(() => validateSavedState(state)).not.toThrow();
    state.paidVisitSequence = 1;
    state.completedCustomers = [{ customerId: 'a', revenue: 12, paidVisitSequence: 1 }];
    expect(() => validateSavedState(state)).toThrow(/contradicts the live payment marker/);
  });
});

describe('R2 mixed-order recovery retains committed history', () => {
  it.each(['discarded drink', 'missing drink'])('abandons %s without clearing snapshotted menu/bill facts or inventing consumption', cause => {
    let state = orderedState(true);
    expect(state.serviceItems.map(item => item.kind)).toEqual(['dish', 'drink']);
    state.customers[0] = { ...state.customers[0], state: 'eating', foodOutcome: 'delivered', x: 700, y: 500 };
    const committed = structuredClone(state.customers[0]);
    state.serviceItems = state.serviceItems.map(item => ({ ...item, state: item.kind === 'dish' ? 'delivered' : 'to_clean' }));
    if (cause === 'missing drink') state.serviceItems = state.serviceItems.filter(item => item.kind === 'dish');
    state = normaliseServiceItemOwnership(state);
    expect(state.customers[0]).toMatchObject({ state: 'leaving', dishId: 'starter-toast', drinkId: 'water',
      foodOutcome: 'delivered', dishPriceAtOrder: 12, drinkPriceAtOrder: 2, orderSubtotal: 14,
      orderedServiceItemIds: committed.orderedServiceItemIds, consumedServiceItemIds: [],
      dishOrderSnapshot: committed.dishOrderSnapshot });
    expect(state.customers[0]).not.toHaveProperty('paidVisitSequence');
    expect(state.cookbook.entries.toast.paidPortions).toBe(0);
    expect(state.careerRun.paidMeals).toBe(0);
    expect(() => validateSavedState(state)).not.toThrow();
    state = reload(state);
    expect(state.customers[0].dishOrderSnapshot).toEqual(committed.dishOrderSnapshot);
    const next = createCustomerOrder(state, { id: 'other', state: 'seated', spendingTier: 'value', spendingBudget: 45, patienceMax: 900 }, () => 0);
    state = { ...state, customers: [...state.customers, next.customer], serviceItems: next.serviceItems };
    expect(() => getCheckoutBill(state, next.customer)).not.toThrow();
    expect(getCheckoutBill(state, next.customer).subtotal).toBe(12);
  });
});

describe('real-service save boundaries at the original failures', () => {
  it.each([[1, 4408], [6, 2808]])('keeps seed %s valid through an in-flight reload at offset %s', async (seed, reloadAt) => {
    vi.resetModules();
    const harness = await import('../simulation/realServiceHarness.testSupport');
    vi.spyOn(Math, 'random').mockImplementation(harness.seededRandom(seed));
    const { state, report } = harness.runRealService({ seed, reloadAt, maxWallMs: 30000 });
    console.info('INTEGRATION_FIX_REAL_RELOAD', JSON.stringify({ seed, status: report.status, ticks: report.ticks,
      gameTime: report.gameTime, sequence: report.sequence, fulfilled: report.fulfilled,
      contractStatus: report.contractStatus, reloadFacts: report.reloadFacts,
      firstSnapshotMismatch: report.firstSnapshotMismatch, diagnostic: report.diagnostic?.message ?? null }));
    expect(report.status).toBe('completed');
    expect(report.gameTime).toBe(41100);
    expect(report.firstSnapshotMismatch).toBeNull();
    expect(report.reloadFacts).toMatchObject({ at: 36000 + reloadAt, contractLedgerEqual: true, cookbookEqual: true });
    expect(report.reloadFacts.sequenceAfter).toBe(report.reloadFacts.sequenceBefore);
    expect(() => validateSavedState(state)).not.toThrow();
  }, 40000);
});
