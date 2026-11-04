import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCareerInitialState, createInitialState } from './initialState';
import { hydrateState, loadState, loadStateResult, saveState } from './persistence';
import { SAVE_VERSION } from './saveVersion';
import { validateSavedState } from './saveValidation';
import { acceptServiceContract } from '../simulation/serviceContracts';
import { createDishOrderSnapshot, getResolvedDish } from '../simulation/cookbook';
import { continueCareerAsSandbox, evaluateCareerRun } from '../simulation/careerRun';
import { getResolvedDrink } from '../data/drinks';
import { getStaffTaskDuration } from '../simulation/staffPerformance';
import { findPreparationTarget } from '../simulation/preparationPosition';
import { resolveStaffAfterMovement } from '../simulation/staff';
import { buildAffordableBaskets } from '../simulation/menuEconomy';
import { prioritiseQueuedParty } from '../simulation/queuePriority';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
function orderFixture() {
  const raw = createInitialState();
  const starter = raw.dishes[0];
  const entry = raw.cookbook.entries.toast;
  const priorSettings = { ...entry.menuSettings, price: 25, quality: 10 };
  raw.cookbook.entries.toast = { ...entry, menuSettings: priorSettings };
  raw.dishes[0] = { ...starter, ...priorSettings };
  const snapshot = createDishOrderSnapshot(getResolvedDish(raw, starter.id), {
    serviceItemId: 'dish-1', orderedAt: 35990,
  });
  raw.cookbook.entries.toast = entry;
  raw.dishes[0] = starter;
  raw.customers = [{ id: 'guest', state: 'waiting_for_items', tableId: 't1', chairId: 'ch1',
    dishId: starter.id, drinkId: null, menuOutcome: 'ordered', foodOutcome: 'pending',
    foodOrderedAt: 35990, foodPatienceBudget: 300, foodDeadlineAt: 36290,
    dishPriceAtOrder: snapshot.price, drinkPriceAtOrder: null, orderSubtotal: snapshot.price,
    orderedServiceItemIds: ['dish-1'], consumedServiceItemIds: [], cancelledServiceItemIds: [],
    dishOrderSnapshot: snapshot }];
  raw.serviceItems = [{ id: 'dish-1', customerId: 'guest', menuItemId: starter.id,
    kind: 'dish', state: 'ordered', dishOrderSnapshot: { ...snapshot } }];
  return raw;
}

describe('strict v11 feature persistence', () => {
  it('starts a new sandbox with an empty day-1 sales branch', () => {
    const fresh = createInitialState();
    expect(fresh.menuSales).toEqual({
      day: fresh.restaurant.day, dishes: [], drinks: [],
    });
  });

  it('round-trips the existing cashier assignedStaffId without adding a preference field', () => {
    const raw = createInitialState();
    raw.cashierStations = raw.cashierStations.map((station, index) => index === 0
      ? { ...station, assignedStaffId: 'starter-cashier-waiter' }
      : station);

    expect(saveState(raw)).toBe(true);

    const loaded = loadState();
    expect(loaded.cashierStations[0].assignedStaffId).toBe('starter-cashier-waiter');
    const hydrated = hydrateState(loaded, createInitialState());
    expect(hydrated.cashierStations[0].assignedStaffId).toBe('starter-cashier-waiter');
    expect(hydrated.cashierStations[0]).not.toHaveProperty('staffPreference');
  });

  it('round-trips current-build Fish Bisque progress, mastery, menu settings and active dish', () => {
    const raw = createInitialState();
    raw.paidVisitSequence = 20;
    raw.cookbook.lastAppliedPaidVisitSequence = 20;
    raw.equipment = raw.equipment.map(item => item.id === 'eq4' ? { ...item, owned: true } : item);
    raw.cookbook.entries.gazpacho = { ...raw.cookbook.entries.gazpacho,
      discovered: true, owned: true, paidPortions: 5 };
    raw.cookbook.entries['fish-bisque'] = { ...raw.cookbook.entries['fish-bisque'],
      discovered: true, owned: true, paidPortions: 15, perk: 'appeal',
      menuSettings: { name: 'House Fish Bisque', price: 27, quality: 3 } };
    raw.dishes.push({ id: 'cookbook:fish-bisque', cookbookId: 'fish-bisque',
      name: 'House Fish Bisque', base: 'Fish', method: 'Blended', cuisine: 'generic',
      requiredEquipmentId: 'eq4', price: 27, quality: 3, prepTime: 135, popularity: 68, unlocked: true });

    expect(saveState(raw)).toBe(true);
    const loaded = loadState();
    expect(loaded.cookbook.entries.gazpacho.paidPortions).toBe(5);
    expect(loaded.cookbook.entries['fish-bisque']).toMatchObject({
      discovered: true, paidPortions: 15, perk: 'appeal',
      menuSettings: { name: 'House Fish Bisque', price: 27, quality: 3 },
    });
    expect(loaded.dishes.find(dish => dish.cookbookId === 'fish-bisque'))
      .toMatchObject({ id: 'cookbook:fish-bisque', name: 'House Fish Bisque', price: 27, quality: 3 });
    const hydrated = hydrateState(loaded, createInitialState());
    expect(getResolvedDish(hydrated, 'cookbook:fish-bisque')).toMatchObject({
      cookbookId: 'fish-bisque', name: 'House Fish Bisque', base: 'Fish', method: 'Blended',
      requiredEquipmentId: 'eq4', price: 27, quality: 3, prepTime: 135, popularity: 78, masteryPerk: 'appeal',
    });
  });

  it('rejects a current-version save with a missing recipe entry instead of auto-filling it', () => {
    const old = createInitialState();
    delete old.cookbook.entries['baked-eggs'];
    expect(() => validateSavedState(old)).toThrow(/Invalid cookbook/);
    expect(() => hydrateState(old, createInitialState())).toThrow(/Invalid cookbook/);

    localStorage.setItem('restaurant-sim-save', JSON.stringify(old));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadStateResult()).toEqual({ state: null, reason: 'invalid' });
  });

  it('rejects a previous-version sandbox without changing its progress or evidence', () => {
    const raw = createInitialState();
    raw.version = SAVE_VERSION - 1;
    raw.restaurant.totalServed = 1000;
    const serialized = JSON.stringify(raw);
    localStorage.setItem('restaurant-sim-save', serialized);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadStateResult()).toEqual({ state: null, reason: 'incompatible' });
    expect(() => hydrateState(raw, createInitialState())).toThrow(/incompatible/i);
    expect(localStorage.getItem('restaurant-sim-save')).toBe(serialized);
  });
  it('rejects malformed current menu sales before normalisation can hide invalid identifiers', () => {
    const raw = {
      ...createInitialState(),
      menuSales: {
        day: 1,
        dishes: [
          { key: 'starter-toast', count: 2, strayId: 7 },
          { key: 'removed-dish', count: 4 },
          { key: 'starter-toast', count: 99 },
        ],
        drinks: [{ key: 'water', count: 3, nestedId: 9 }],
        strayMenuId: 42,
      },
    };
    expect(() => validateSavedState(raw)).toThrow();

    expect(() => hydrateState(raw, createInitialState())).toThrow();

    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadStateResult()).toEqual({ state: null, reason: 'invalid' });
  });

  it.each([
    null,
    {},
    { day: 1, dishes: 'bad', drinks: [] },
    { day: 1, dishes: [], drinks: 'bad' },
    { day: 2, dishes: [{ key: 'starter-toast', count: 4 }], drinks: [] },
  ])('rejects malformed current menu sales value %s before filling defaults', value => {
    const raw = { ...createInitialState(), menuSales: value };

    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it('round-trips multi-dish menu sales for distinct authored IDs, including one ending in Id', () => {
    const raw = createInitialState();
    raw.dishes[0] = { ...raw.dishes[0], id: 'custom-menuId' };
    raw.cookbook.entries.toast = { ...raw.cookbook.entries.toast, paidPortions: 3 };
    const cheeseToast = raw.cookbook.entries['cheese-toast'];
    raw.cookbook.entries['cheese-toast'] = {
      ...cheeseToast, discovered: true, owned: true,
    };
    raw.dishes.push({
      id: 'cookbook:cheese-toast', cookbookId: 'cheese-toast',
      name: cheeseToast.menuSettings.name, base: 'Cheese', method: 'Toasted', cuisine: 'generic',
      price: cheeseToast.menuSettings.price, quality: cheeseToast.menuSettings.quality,
      prepTime: 90, popularity: 65, requiredEquipmentId: 'eq1', unlocked: true,
    });
    raw.menuSales = {
      day: 1,
      dishes: [
        { key: 'custom-menuId', count: 2, gross: 0, grossComplete: false },
        { key: 'cookbook:cheese-toast', count: 3, gross: 0, grossComplete: false },
      ],
      drinks: [{ key: 'iced-tea', count: 3, gross: 0, grossComplete: false }],
    };
    expect(saveState(raw)).toBe(true);

    const loaded = loadState();
    const expectedMenuSales = {
      day: 1,
      dishes: [
        { key: 'custom-menuId', count: 2, gross: 0, grossComplete: false },
        { key: 'cookbook:cheese-toast', count: 3, gross: 0, grossComplete: false },
      ],
      drinks: [{ key: 'iced-tea', count: 3, gross: 0, grossComplete: false }],
    };
    expect(loaded.menuSales).toEqual(expectedMenuSales);
    const hydrated = hydrateState(loaded, createInitialState());
    expect(hydrated.menuSales).toEqual(expectedMenuSales);
    expect(hydrated.dishes.find(dish => dish.id === 'custom-menuId'))
      .toMatchObject({ id: 'custom-menuId', cookbookId: 'toast', price: 12 });
    expect(hydrated.dishes.find(dish => dish.id === 'cookbook:cheese-toast'))
      .toMatchObject({ id: 'cookbook:cheese-toast', cookbookId: 'cheese-toast', price: 14 });
  });

  it('round-trips incomplete gross completeness through save, load and hydration', () => {
    const raw = createInitialState();
    raw.menuSales = {
      day: raw.restaurant.day,
      dishes: [{ key: 'starter-toast', count: 2, gross: 6.5, grossComplete: false }],
      drinks: [],
    };

    expect(saveState(raw)).toBe(true);
    const loaded = loadState();
    expect(loaded.menuSales).toEqual(raw.menuSales);
    expect(hydrateState(loaded, createInitialState()).menuSales).toEqual(raw.menuSales);
  });

  it('rejects contradictory current gross metadata before normalisation can hide it', () => {
    const raw = createInitialState();
    raw.menuSales = {
      day: raw.restaurant.day,
      dishes: [
        { key: raw.dishes[0].id, count: 0, gross: 10, grossComplete: true },
      ],
      drinks: [
        { key: 'water', count: 2, gross: 0, grossComplete: true },
        { key: 'tea', count: 3, gross: 0, grossComplete: false },
        { key: 'soda', count: 0, gross: 0, grossComplete: true },
        { key: 'coffee', count: 0, gross: 10, grossComplete: false },
      ],
    };

    expect(saveState(raw)).toBe(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadStateResult()).toEqual({ state: null, reason: 'invalid' });
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it('preserves an in-flight snapshot at its captured quality after the current menu changes', () => {
    const raw = orderFixture();
    const hydrated = hydrateState(raw, createInitialState());
    const snapshot = raw.customers[0].dishOrderSnapshot;
    expect(snapshot).toMatchObject({ serviceItemId: 'dish-1', menuItemId: 'starter-toast',
      orderedAt: 35990, cookbookId: 'toast', price: 25, quality: 10 });
    expect(hydrated.customers[0].dishOrderSnapshot).toEqual(snapshot);
    expect(hydrated.serviceItems[0].dishOrderSnapshot).toEqual(snapshot);
    expect(hydrated.dishes[0]).toMatchObject({ cookbookId: 'toast', price: 12, quality: 1 });
    expect(hydrateState(hydrated, createInitialState()).customers[0].dishOrderSnapshot).toEqual(snapshot);
  });
  it('round-trips off-menu owned mastery, poor-value party outcomes and an in-flight snapshot', () => {
    const raw = orderFixture();
    raw.cookbook.entries['cheese-toast'] = {
      ...raw.cookbook.entries['cheese-toast'],
      discovered: true, owned: true, paidPortions: 15, perk: 'speed',
      menuSettings: { name: 'House Cheese Toast', price: 14, quality: 1 },
    };
    raw.pendingPartyReviews = [{
      partyId: 'party-pending', memberIds: ['ordered-member', 'refused-member'],
      orderedMemberIds: ['ordered-member'], unaffordableMemberIds: [],
      poorValueMemberIds: ['refused-member'], paidReviews: [],
    }];
    const snapshot = raw.customers[0].dishOrderSnapshot;

    expect(saveState(raw)).toBe(true);
    const hydrated = hydrateState(loadState(), createInitialState());

    expect(hydrated.dishes.some(dish => dish.cookbookId === 'cheese-toast')).toBe(false);
    expect(hydrated.cookbook.entries['cheese-toast']).toMatchObject({
      discovered: true, owned: true, paidPortions: 15, perk: 'speed',
      menuSettings: { name: 'House Cheese Toast', price: 14, quality: 1 },
    });
    expect(hydrated.pendingPartyReviews).toEqual(raw.pendingPartyReviews);
    expect(hydrated.customers[0].dishOrderSnapshot).toEqual(snapshot);
    expect(hydrated.serviceItems[0].dishOrderSnapshot).toEqual(snapshot);
  });

  it('rejects non-authored active dishes and snapshots with custom recipe identities', () => {
    const customMenu = createInitialState();
    customMenu.dishes.push({ ...customMenu.dishes[0], id: 'custom-dish', cookbookId: null });
    expect(() => hydrateState(customMenu, createInitialState())).toThrow(/Invalid cookbook/);

    const customSnapshot = orderFixture();
    customSnapshot.customers[0].dishOrderSnapshot = {
      ...customSnapshot.customers[0].dishOrderSnapshot, cookbookId: null,
    };
    expect(() => hydrateState(customSnapshot, createInitialState())).toThrow(/Invalid cookbook/);
  });

  it('rejects an out-of-range authored price before menu normalisation', () => {
    const raw = createInitialState();
    const invalidSettings = { ...raw.cookbook.entries.toast.menuSettings, price: 26, quality: 10 };
    raw.cookbook.entries.toast = { ...raw.cookbook.entries.toast, menuSettings: invalidSettings };
    raw.dishes[0] = { ...raw.dishes[0], ...invalidSettings };

    expect(() => hydrateState(raw, createInitialState())).toThrow(/Invalid cookbook/);
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadStateResult()).toEqual({ state: null, reason: 'invalid' });
  });

  it('rejects unpaid progress on a recipe that is not owned', () => {
    const raw = createInitialState();
    raw.cookbook.entries['cheese-toast'] = {
      ...raw.cookbook.entries['cheese-toast'], discovered: true, owned: false, paidPortions: 1,
    };

    expect(() => validateSavedState(raw)).toThrow(/Invalid cookbook/);
    expect(() => hydrateState(raw, createInitialState())).toThrow(/Invalid cookbook/);
  });

  it('does not manufacture a missing current-version order snapshot from fresh defaults', () => {
    const raw = orderFixture();
    delete raw.customers[0].dishOrderSnapshot;
    delete raw.serviceItems[0].dishOrderSnapshot;
    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.customers[0]).not.toHaveProperty('dishOrderSnapshot');
    expect(hydrated.serviceItems[0]).not.toHaveProperty('dishOrderSnapshot');
  });
  it.each(['cookbook', 'serviceContracts'])('rejects a present malformed %s branch instead of legacy resetting it', key => {
    for (const value of [null, {}, { version: 999 }]) {
      const raw = { ...createInitialState(), [key]: value };
      expect(() => validateSavedState(raw)).toThrow();
      expect(() => hydrateState(raw, createInitialState())).toThrow();
    }
  });
  it('rejects explicitly present undefined cookbook rather than treating it as absence', () => {
    const raw = { ...createInitialState(), cookbook: undefined };
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });
  it.each([-1, 1.1, Number.MAX_SAFE_INTEGER + 1, null, undefined])('rejects invalid present root sequence %s', value => {
    expect(() => validateSavedState({ ...createInitialState(), paidVisitSequence: value })).toThrow();
  });
  it.each([0, -1, 2, 0.5, undefined])('rejects invalid live marker %s against root 1', value => {
    const raw = createInitialState();
    raw.paidVisitSequence = 1;
    raw.customers = [{ id: 'paid', state: 'leaving', paidVisitSequence: value }];
    expect(() => validateSavedState(raw)).toThrow();
  });
  it('rejects duplicate live sequences and contradictory receipt correlation without replay', () => {
    const raw = createInitialState();
    raw.paidVisitSequence = 2;
    raw.customers = [{ id: 'a', state: 'leaving', paidVisitSequence: 1 },
      { id: 'b', state: 'leaving', paidVisitSequence: 1 }];
    expect(() => validateSavedState(raw)).toThrow();
    raw.customers = [{ id: 'a', state: 'leaving', paidVisitSequence: 1 }];
    raw.completedCustomers = [{ customerId: 'a', revenue: 12, paidVisitSequence: 2 }];
    expect(() => validateSavedState(raw)).toThrow();
    raw.completedCustomers[0].paidVisitSequence = 1;
    expect(() => validateSavedState(raw)).not.toThrow();
  });
  it('validates full snapshot copies before any cooking normalisation', () => {
    const raw = orderFixture();
    raw.customers[0].dishOrderSnapshot = null;
    expect(() => hydrateState(raw, createInitialState())).toThrow();
    const mismatched = orderFixture();
    const good = createInitialState();
    const snapshot = createDishOrderSnapshot(getResolvedDish(good, 'starter-toast'), { serviceItemId: 'dish-1', orderedAt: 35990 });
    mismatched.customers[0] = { ...mismatched.customers[0], dishPriceAtOrder: 12,
      orderSubtotal: 12, dishOrderSnapshot: snapshot };
    mismatched.serviceItems[0].dishOrderSnapshot = { ...snapshot, price: 13 };
    expect(() => hydrateState(mismatched, createInitialState())).toThrow();
  });
  it.each(['queue', 'queueDepartures'])('rejects malformed present snapshots on %s actors too', key => {
    const raw = createInitialState();
    raw[key] = [{ id: 'queued-guest', partyId: 'queued-party', departureReason: 'closed' }];
    expect(() => validateSavedState(raw)).not.toThrow();
    raw[key][0].dishOrderSnapshot = null;
    expect(() => validateSavedState(raw)).toThrow();
  });
  it('rejects sequence-correlated receipts without canonical customer/money facts', () => {
    const raw = createInitialState();
    raw.paidVisitSequence = 1;
    raw.completedCustomers = [{ paidVisitSequence: 1, revenue: 12 }];
    expect(() => validateSavedState(raw)).toThrow();
    raw.completedCustomers = [{ customerId: 'paid', paidVisitSequence: 1, revenue: NaN }];
    expect(() => validateSavedState(raw)).toThrow();
  });
  it('normalises only corrupt career data without discarding the restaurant', () => {
    const raw = createInitialState();
    raw.restaurant.funds = -321;
    raw.careerRun = { schemaVersion: 999 };
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    expect(loadState()).not.toBeNull();
    const hydrated = hydrateState(loadState(), createInitialState());
    expect(hydrated.restaurant.funds).toBe(-321);
    expect(hydrated.careerRun).toMatchObject({ status: 'invalid', needsDecision: true, result: null,
      issue: 'unsupported-career-version' });
  });
  it('keeps corrupt career identity/nested ID data out of strict world ID validation', () => {
    const raw = createInitialState();
    raw.careerRun = { runId: 42, checkpoint: { customerId: 7 } };
    expect(() => validateSavedState(raw)).not.toThrow();
    expect(hydrateState(raw, createInitialState()).careerRun).toMatchObject({ status: 'invalid', result: null });
  });
  it('drains money only and settles due persisted contracts before exact-deadline career evaluation even paused', () => {
    let raw = createCareerInitialState({ scenarioId: 'opening-week', runId: 'run' });
    raw.restaurant = { ...raw.restaurant, day: 8, gameTime: 634650, reputation: 2 };
    raw.menuSales = { day: 8, dishes: [], drinks: [] };
    raw = acceptServiceContract(raw, { templateId: 'office-lunch' });
    // Office lasts 900 prep + 5250 service: its deadline coincides with Opening Week.
    expect(raw.serviceContracts.active.deadlineAt).toBe(640800);
    raw.restaurant.gameTime = 640800;
    raw.paused = true;
    raw.paidVisitSequence = 80;
    raw.careerRun = { ...raw.careerRun, paidMeals: 80, lastPaidVisitSequence: 80 };
    raw.cookbook.lastAppliedPaidVisitSequence = 80;
    raw.completedCustomers = [{ customerId: 'legacy-payment', revenue: 25 }];
    const hydrated = hydrateState(raw, createInitialState());
    // V5 failure refunds the $22.50 deposit and pays $22.50 compensation,
    // rather than the former $45 compensation; the legacy $25 receipt settles once.
    expect(hydrated.restaurant).toMatchObject({ funds: 602.5, gameTime: 640800, reputation: 1.75 });
    expect(hydrated.completedCustomers).toEqual([]);
    expect(hydrated.careerRun).toMatchObject({ status: 'lost', paidMeals: 80, needsDecision: true });
    expect(hydrated.cookbook.entries.toast.paidPortions).toBe(0);
    expect(hydrated.serviceContracts.active).toBeNull();
    expect(hydrated.serviceContracts.results[0]).toMatchObject({
      status: 'failed', bonusPaid: 0, depositPaid: 22.5, depositRefunded: 22.5,
      compensationPaid: 22.5, reputationPenalty: 0.25,
    });
    expect(hydrated.paused).toBe(true);
    const again = hydrateState(hydrated, createInitialState());
    expect(again.restaurant.funds).toBe(602.5);
    expect(again.careerRun).toEqual(hydrated.careerRun);
  });
  it('retains future booked arrivals at the cutoff without admission or missed-resume changes', () => {
    let raw = createCareerInitialState({ scenarioId: 'opening-week', runId: 'run' });
    raw.restaurant = { ...raw.restaurant, day: 8, gameTime: 639900 };
    raw.menuSales = { day: 8, dishes: [], drinks: [] };
    raw = acceptServiceContract(raw, { templateId: 'office-lunch' });
    raw.restaurant.gameTime = 640800;
    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.serviceContracts).toEqual(raw.serviceContracts);
    expect(hydrated.customers).toEqual([]);
    expect(hydrated.queue).toEqual([]);
  });
  it('keeps terminal and continued scores frozen on reload, without drain/recount', () => {
    const raw = createCareerInitialState({ scenarioId: 'opening-week', runId: 'run' });
    raw.restaurant = { ...raw.restaurant, day: 8, gameTime: 640800 };
    raw.menuSales = { day: 8, dishes: [], drinks: [] };
    raw.careerRun = evaluateCareerRun(raw.careerRun, raw.restaurant);
    const frozen = raw.careerRun.result;
    raw.careerRun = continueCareerAsSandbox(raw.careerRun);
    raw.restaurant.reputation = 5;
    raw.restaurant.gameTime = 650000;
    expect(hydrateState(raw, createInitialState()).careerRun).toMatchObject({ status: 'continued', needsDecision: false, result: frozen });
  });
  it('returns save success/failure explicitly while retaining navigation quarantine', () => {
    expect(saveState(createInitialState())).toBe(true);
    const old = localStorage.getItem('restaurant-sim-save');
    expect(saveState({ ...createInitialState(), navigationFault: { issues: [] } })).toBe(false);
    expect(localStorage.getItem('restaurant-sim-save')).toBe(old);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(saveState(createInitialState())).toBe(false);
  });
  it.each([1, 2])('rejects current-version cookbook schema %s instead of migrating it', schemaVersion => {
    const raw = createInitialState();
    raw.cookbook.schemaVersion = schemaVersion;
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadStateResult()).toEqual({ state: null, reason: 'invalid' });
    expect(() => hydrateState(raw, createInitialState())).toThrow(/Invalid cookbook/);
  });

  function drinkPreparationFixture({
    menuItemId = 'iced-tea', drinkOverrides = {}, unlockedDrinkIds = null,
  } = {}) {
    const raw = createInitialState();
    const cook = raw.staff.find(worker => worker.role === 'cook');
    const dispenser = raw.kitchenStations.find(station => station.equipmentId == null);
    return {
      ...raw,
      restaurant: { ...raw.restaurant, gameTime: 100 },
      unlockedDrinkIds: unlockedDrinkIds
        ?? (menuItemId === 'water' ? ['water'] : ['water', menuItemId]),
      drinkOverrides,
      customers: [{
        id: 'drink-guest', state: 'waiting_for_items', tableId: 't1', dishId: null,
        drinkId: menuItemId, orderedServiceItemIds: ['drink-1'], x: 190, y: 210,
      }],
      serviceItems: [{
        id: 'drink-1', kind: 'drink', menuItemId, customerId: 'drink-guest',
        tableId: 't1', state: 'preparing', stationId: dispenser.id, serviceTableId: 'st1',
        serviceSlotIndex: 0, assignedStaffId: cook.id, preparationStartedAt: 55,
        accumulatedWork: 45, lastProgressAt: 100,
      }],
      staff: raw.staff.map(worker => worker.id === cook.id
        ? {
          ...worker,
          task: {
            type: 'prepare_drink', serviceItemId: 'drink-1', stationId: dispenser.id,
            serviceTableId: 'st1', serviceSlotIndex: 0,
          },
        }
        : worker),
    };
  }

  it('round-trips an unlocked, overridden Iced Tea with active preparation work', () => {
    const saved = drinkPreparationFixture({ drinkOverrides: { 'iced-tea': { price: 12 } } });
    expect(saveState(saved)).toBe(true);

    const hydrated = hydrateState(loadState(), createInitialState());
    expect(hydrated.unlockedDrinkIds).toEqual(['water', 'iced-tea']);
    expect(hydrated.drinkOverrides).toEqual({ 'iced-tea': { price: 12 } });
    expect(getResolvedDrink(hydrated, 'iced-tea')).toEqual({
      id: 'iced-tea', name: 'Iced Tea', price: 12, unlockCost: 150,
      quality: 1, popularity: 45, prepTime: 90, cuisine: 'beverage', requiredEquipmentId: null,
    });

    const cook = hydrated.staff.find(worker => worker.role === 'cook');
    expect(hydrated.serviceItems.find(item => item.id === 'drink-1')).toMatchObject({
      state: 'preparing', accumulatedWork: 45, lastProgressAt: 100,
    });
    expect(cook.task).toMatchObject({ type: 'prepare_drink', serviceItemId: 'drink-1' });
    expect(getStaffTaskDuration(hydrated, cook)).toBe(90);
  });

  it('round-trips unlocked Premium Lemonade overrides and active work through its 180 boundary', () => {
    const saved = drinkPreparationFixture({
      menuItemId: 'premium-lemonade',
      unlockedDrinkIds: ['water', 'premium-lemonade'],
      drinkOverrides: { 'premium-lemonade': { price: 12, quality: 2 } },
    });
    saved.staff = saved.staff.map(worker => worker.role === 'cook'
      ? { ...worker, morale: 50 }
      : worker);
    expect(saveState(saved)).toBe(true);

    const hydrated = hydrateState(loadState(), createInitialState());
    expect(hydrated.unlockedDrinkIds).toEqual(['water', 'premium-lemonade']);
    expect(hydrated.drinkOverrides).toEqual({ 'premium-lemonade': { price: 12, quality: 2 } });
    expect(getResolvedDrink(hydrated, 'premium-lemonade')).toEqual({
      id: 'premium-lemonade', name: 'Premium Lemonade', price: 12, unlockCost: 450,
      quality: 2, popularity: 75, prepTime: 180, cuisine: 'beverage', requiredEquipmentId: null,
    });

    const cook = hydrated.staff.find(worker => worker.role === 'cook');
    const item = hydrated.serviceItems.find(candidate => candidate.id === 'drink-1');
    expect(item).toMatchObject({ state: 'preparing', accumulatedWork: 45, lastProgressAt: 100 });
    expect(cook.task).toMatchObject({ type: 'prepare_drink', serviceItemId: 'drink-1' });
    expect(getStaffTaskDuration(hydrated, cook)).toBe(180);

    const station = hydrated.kitchenStations.find(candidate => candidate.id === item.stationId);
    const target = findPreparationTarget({ ...hydrated, staff: [cook] }, station, cook);
    expect(target).not.toBeNull();
    const { navigationGoal: _navigationGoal, ...arrivedCook } = cook;
    const placed = {
      ...hydrated,
      staff: hydrated.staff.map(worker => worker.id === cook.id
        ? { ...arrivedCook, x: target.goal.x, y: target.goal.y }
        : worker),
    };
    const at179 = resolveStaffAfterMovement({
      ...placed, restaurant: { ...placed.restaurant, gameTime: 234 },
    }, 0);
    expect(at179.serviceItems.find(candidate => candidate.id === item.id))
      .toMatchObject({ state: 'preparing', accumulatedWork: 179 });
    const at180 = resolveStaffAfterMovement({
      ...placed, restaurant: { ...placed.restaurant, gameTime: 235 },
    }, 0);
    expect(at180.serviceItems.find(candidate => candidate.id === item.id))
      .toMatchObject({ state: 'carried' });
  });

  it('keeps the persisted drink set unchanged without auto-unlocking later drinks', () => {
    const raw = {
      ...createInitialState(),
      unlockedDrinkIds: ['water', 'tea', 'soda', 'coffee', 'juice'],
      drinkOverrides: {},
    };
    expect(() => validateSavedState(raw)).not.toThrow();

    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.unlockedDrinkIds).toEqual(['water', 'tea', 'soda', 'coffee', 'juice']);
    expect(hydrated.unlockedDrinkIds).not.toContain('iced-tea');
    expect(hydrated.unlockedDrinkIds).not.toContain('premium-lemonade');
    expect(hydrated.version).toBe(createInitialState().version);
  });

  it('keeps an old active Water preparation at 120 work after reload', () => {
    const saved = drinkPreparationFixture({ menuItemId: 'water' });
    expect(saveState(saved)).toBe(true);

    const hydrated = hydrateState(loadState(), createInitialState());
    const cook = hydrated.staff.find(worker => worker.role === 'cook');
    expect(hydrated.serviceItems.find(item => item.id === 'drink-1')).toMatchObject({
      state: 'preparing', accumulatedWork: 45, lastProgressAt: 100,
    });
    expect(getStaffTaskDuration(hydrated, cook)).toBe(120);
  });

  it('drops unknown drink overrides and never resolves a non-catalogue drink', () => {
    const raw = {
      ...createInitialState(),
      unlockedDrinkIds: ['water', 'boba'],
      drinkOverrides: { boba: { price: 9 } },
    };
    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.drinkOverrides).toEqual({});
    expect(hydrated.unlockedDrinkIds).toEqual(['water', 'boba']);
    expect(getResolvedDrink(hydrated, 'boba')).toBeNull();
    expect(buildAffordableBaskets(hydrated, { spendingTier: 'value', spendingBudget: 45 })
      .some(basket => basket.drink?.id === 'boba')).toBe(false);
  });

  it('round-trips an optional walk-in pause flag and treats absence as effectively false', () => {
    for (const value of [true, false]) {
      localStorage.clear();
      const raw = { ...createInitialState() };
      raw.restaurant = { ...raw.restaurant, walkInsPaused: value };
      expect(saveState(raw)).toBe(true);
      const hydrated = hydrateState(loadState(), createInitialState());
      expect(hydrated.restaurant.walkInsPaused).toBe(value);
    }

    localStorage.clear();
    expect(() => validateSavedState(createInitialState())).not.toThrow();
    const hydrated = hydrateState(createInitialState(), createInitialState());
    expect(hydrated.restaurant.walkInsPaused).not.toBe(true);
    expect(createInitialState().restaurant).not.toHaveProperty('walkInsPaused');
  });

  it('round-trips optional table admission holds in v11 and treats absence as false', () => {
    const fresh = createInitialState();
    expect(fresh.tables[0]).not.toHaveProperty('admissionHeld');
    expect(() => validateSavedState(fresh)).not.toThrow();
    expect(hydrateState(fresh, createInitialState()).tables[0]).not.toHaveProperty('admissionHeld');

    for (const value of [true, false]) {
      localStorage.clear();
      const raw = createInitialState();
      raw.tables = raw.tables.map((table, index) => index === 0
        ? { ...table, admissionHeld: value }
        : table);

      expect(saveState(raw)).toBe(true);
      expect(loadState().tables[0].admissionHeld).toBe(value);
      expect(hydrateState(loadState(), createInitialState()).tables[0].admissionHeld).toBe(value);
      expect(hydrateState(loadState(), createInitialState()).version).toBe(raw.version);
    }
  });

  it('round-trips the optional seating policy in current-build saves without adding a default', () => {
    const fresh = createInitialState();
    expect(fresh.restaurant).not.toHaveProperty('seatingPolicy');
    expect(() => validateSavedState(fresh)).not.toThrow();
    expect(hydrateState(fresh, createInitialState()).restaurant)
      .not.toHaveProperty('seatingPolicy');

    for (const seatingPolicy of ['automatic', 'best-fit']) {
      localStorage.clear();
      const raw = createInitialState();
      raw.restaurant = { ...raw.restaurant, seatingPolicy };

      expect(saveState(raw)).toBe(true);
      expect(loadState().restaurant.seatingPolicy).toBe(seatingPolicy);
      const hydrated = hydrateState(loadState(), createInitialState());
      expect(hydrated.restaurant.seatingPolicy).toBe(seatingPolicy);
      expect(hydrated.version).toBe(raw.version);
    }
  });

  it.each(['smallest', 'BEST-FIT', 1, null])(
    'rejects malformed persisted seating policy %s', seatingPolicy => {
      const raw = createInitialState();
      raw.restaurant = { ...raw.restaurant, seatingPolicy };
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => validateSavedState(raw)).toThrow();
      expect(() => hydrateState(raw, createInitialState())).toThrow();
      localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
      expect(loadState()).toBeNull();
    },
  );

  it('round-trips optional rest amenity preferences without adding a default field', () => {
    const fresh = createInitialState();
    expect(fresh.staff[0]).not.toHaveProperty('restAmenityPreference');
    expect(() => validateSavedState(fresh)).not.toThrow();
    expect(hydrateState(fresh, createInitialState()).staff[0])
      .not.toHaveProperty('restAmenityPreference');

    for (const preference of ['automatic', 'couch', 'arcade']) {
      localStorage.clear();
      const raw = createInitialState();
      raw.staff = raw.staff.map((worker, index) => index === 0
        ? { ...worker, restAmenityPreference: preference }
        : worker);

      expect(saveState(raw)).toBe(true);
      expect(loadState().staff[0].restAmenityPreference).toBe(preference);
      const hydrated = hydrateState(loadState(), createInitialState());
      expect(hydrated.staff[0].restAmenityPreference).toBe(preference);
      expect(hydrated.version).toBe(raw.version);
    }
  });

  it.each(['bed', 'yes', 1, null])('rejects invalid present rest amenity preference %s', preference => {
    const raw = createInitialState();
    raw.staff[0] = { ...raw.staff[0], restAmenityPreference: preference };

    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it('round-trips optional janitor cleaning focus without adding a fresh default', () => {
    const fresh = createInitialState();
    const janitorId = fresh.staff.find(worker => worker.role === 'janitor').id;
    expect(fresh.staff.find(worker => worker.id === janitorId)).not.toHaveProperty('cleaningFocus');
    expect(() => validateSavedState(fresh)).not.toThrow();
    expect(hydrateState(fresh, createInitialState()).staff.find(worker => worker.id === janitorId))
      .not.toHaveProperty('cleaningFocus');

    for (const cleaningFocus of ['balanced', 'tables', 'floors', 'washing']) {
      localStorage.clear();
      const raw = createInitialState();
      raw.staff = raw.staff.map(worker => worker.id === janitorId
        ? { ...worker, cleaningFocus }
        : worker);

      expect(saveState(raw)).toBe(true);
      expect(loadState().staff.find(worker => worker.id === janitorId).cleaningFocus)
        .toBe(cleaningFocus);
      expect(hydrateState(loadState(), createInitialState()).staff
        .find(worker => worker.id === janitorId).cleaningFocus).toBe(cleaningFocus);
    }
  });

  it.each(['automatic', 'invalid', 1, null])('rejects malformed persisted cleaning focus %s', cleaningFocus => {
    const raw = createInitialState();
    const janitorIndex = raw.staff.findIndex(worker => worker.role === 'janitor');
    raw.staff[janitorIndex] = { ...raw.staff[janitorIndex], cleaningFocus };

    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it('rejects a non-default cleaning focus on non-janitor staff', () => {
    const raw = createInitialState();
    const cookIndex = raw.staff.findIndex(worker => worker.role === 'cook');
    raw.staff[cookIndex] = { ...raw.staff[cookIndex], cleaningFocus: 'tables' };

    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it('round-trips an optional nullable cook station preference and tolerates stale IDs', () => {
    const fresh = createInitialState();
    const cookId = fresh.staff.find(worker => worker.role === 'cook').id;
    expect(fresh.staff.find(worker => worker.id === cookId)).not.toHaveProperty('preferredStationId');
    expect(() => validateSavedState(fresh)).not.toThrow();
    expect(hydrateState(fresh, createInitialState()).staff.find(worker => worker.id === cookId))
      .not.toHaveProperty('preferredStationId');

    for (const preferredStationId of [null, fresh.kitchenStations[0].id, 'removed-station']) {
      localStorage.clear();
      const raw = createInitialState();
      raw.staff = raw.staff.map(worker => worker.id === cookId
        ? { ...worker, preferredStationId }
        : worker);

      expect(saveState(raw)).toBe(true);
      expect(loadState().staff.find(worker => worker.id === cookId).preferredStationId)
        .toBe(preferredStationId);
      expect(hydrateState(loadState(), createInitialState()).staff
        .find(worker => worker.id === cookId).preferredStationId).toBe(preferredStationId);
    }

    const partial = createInitialState();
    partial.version = undefined;
    partial.staff = partial.staff.map(worker => worker.id === cookId
      ? { ...worker, preferredStationId: 7 }
      : worker);
    expect(() => validateSavedState(partial)).not.toThrow();
  });

  it.each(['', -1, 1.5, false, {}])('rejects malformed persisted preferred station ID %s', preferredStationId => {
    const raw = createInitialState();
    raw.version = undefined;
    const cookIndex = raw.staff.findIndex(worker => worker.role === 'cook');
    raw.staff[cookIndex] = { ...raw.staff[cookIndex], preferredStationId };

    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it('rejects a non-null preferred station on non-cook staff but accepts null', () => {
    const raw = createInitialState();
    const waiterIndex = raw.staff.findIndex(worker => worker.role === 'waiter');
    raw.staff[waiterIndex] = { ...raw.staff[waiterIndex], preferredStationId: 'k1' };

    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();

    raw.staff[waiterIndex] = { ...raw.staff[waiterIndex], preferredStationId: null };
    expect(() => validateSavedState(raw)).not.toThrow();
  });

  it.each(['yes', 1, 0, null])('rejects malformed table admission hold %s', admissionHeld => {
    const raw = createInitialState();
    raw.tables[0] = { ...raw.tables[0], admissionHeld };

    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it('round-trips the current logical queue order after a party is prioritised', () => {
    const raw = createInitialState();
    const originalQueue = [
      { partyId: 'older-party', members: [{ id: 'older-member', partyId: 'older-party', state: 'queued' }] },
      { partyId: 'later-party', members: [{ id: 'later-member', partyId: 'later-party', state: 'queued' }] },
      { partyId: 'last-party', members: [{ id: 'last-member', partyId: 'last-party', state: 'queued' }] },
    ];
    raw.queue = prioritiseQueuedParty(originalQueue, 'later-party');

    expect(saveState(raw)).toBe(true);
    const loaded = loadState();
    expect(loaded.queue.map(party => party.partyId))
      .toEqual(['later-party', 'older-party', 'last-party']);
    const hydrated = hydrateState(loaded, createInitialState());
    expect(hydrated.queue.map(party => party.partyId))
      .toEqual(['later-party', 'older-party', 'last-party']);
  });

  it.each(['yes', 1, 0, null])('rejects invalid walk-in pause value %s in both entry points', value => {
    const raw = { ...createInitialState() };
    raw.restaurant = { ...raw.restaurant, walkInsPaused: value };
    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadState()).toBeNull();
  });

  it.each([
    ['suspendedDishIds', ['starter-toast']],
    ['suspendedDrinkIds', ['water']],
  ])('round-trips a synthetic v11 %s list while absence stays inactive', (key, value) => {
    expect(createInitialState().restaurant).not.toHaveProperty('suspendedDishIds');
    expect(createInitialState().restaurant).not.toHaveProperty('suspendedDrinkIds');
    expect(() => validateSavedState(createInitialState())).not.toThrow();
    const hydratedActive = hydrateState(createInitialState(), createInitialState());
    expect(hydratedActive.restaurant).not.toHaveProperty('suspendedDishIds');
    expect(hydratedActive.restaurant).not.toHaveProperty('suspendedDrinkIds');

    const raw = { ...createInitialState() };
    raw.restaurant = { ...raw.restaurant, [key]: value };
    expect(saveState(raw)).toBe(true);

    const hydrated = hydrateState(loadState(), createInitialState());
    expect(hydrated.restaurant[key]).toEqual(value);
  });

  it('accepts optional empty suspension arrays and preserves order with stale IDs', () => {
    const empty = { ...createInitialState() };
    empty.restaurant = {
      ...empty.restaurant, suspendedDishIds: [], suspendedDrinkIds: [],
    };
    expect(() => validateSavedState(empty)).not.toThrow();
    const hydratedEmpty = hydrateState(empty, createInitialState());
    expect(hydratedEmpty.restaurant.suspendedDishIds).toEqual([]);
    expect(hydratedEmpty.restaurant.suspendedDrinkIds).toEqual([]);

    const stale = { ...createInitialState() };
    stale.restaurant = {
      ...stale.restaurant,
      suspendedDishIds: ['gone-dish', 'starter-toast'],
      suspendedDrinkIds: ['nobody'],
    };
    expect(() => validateSavedState(stale)).not.toThrow();
    const hydratedStale = hydrateState(stale, createInitialState());
    expect(hydratedStale.restaurant.suspendedDishIds).toEqual(['gone-dish', 'starter-toast']);
    expect(hydratedStale.restaurant.suspendedDrinkIds).toEqual(['nobody']);
  });

  it('keeps committed orders, snapshots and legacy recipe resolution unchanged with suspensions', () => {
    const withOrderFacts = () => orderFixture();
    const baseline = hydrateState(withOrderFacts(), createInitialState());
    const suspendedRaw = withOrderFacts();
    suspendedRaw.restaurant = {
      ...suspendedRaw.restaurant,
      suspendedDishIds: ['starter-toast'],
      suspendedDrinkIds: ['water'],
    };
    const suspended = hydrateState(suspendedRaw, createInitialState());

    expect(suspended.customers).toEqual(baseline.customers);
    expect(suspended.serviceItems).toEqual(baseline.serviceItems);
    expect(suspended.dishes).toEqual(baseline.dishes);
    expect(suspended.cookbook).toEqual(baseline.cookbook);
    expect(suspended.restaurant.suspendedDishIds).toEqual(['starter-toast']);
    expect(suspended.restaurant.suspendedDrinkIds).toEqual(['water']);
    expect(suspended.customers[0]).toMatchObject({
      state: 'waiting_for_items', menuOutcome: 'ordered',
      dishId: 'starter-toast', dishPriceAtOrder: 25, orderSubtotal: 25,
    });
    expect(suspended.customers[0].dishOrderSnapshot)
      .toMatchObject({ schemaVersion: 1, menuItemId: 'starter-toast', price: 25, quality: 10, cookbookId: 'toast' });
    expect(suspended.serviceItems[0]).toMatchObject({ id: 'dish-1', kind: 'dish', state: 'ordered' });
    expect(getResolvedDish(suspended, 'starter-toast')).not.toBeNull();
    expect(suspended.dishes[0].cookbookId).toBe('toast');
  });

  it.each(['suspendedDishIds', 'suspendedDrinkIds'])('rejects non-array %s values in both entry points', key => {
    for (const value of [null, 'starter-toast', {}, 42]) {
      const raw = { ...createInitialState() };
      raw.restaurant = { ...raw.restaurant, [key]: value };
      expect(() => validateSavedState(raw)).toThrow();
      expect(() => hydrateState(raw, createInitialState())).toThrow();
      localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(loadState()).toBeNull();
    }
  });

  it.each(['suspendedDishIds', 'suspendedDrinkIds'])('rejects non-string entries and duplicates in %s', key => {
    for (const value of [[42], [''], [null], [true], ['a', 'a']]) {
      const raw = { ...createInitialState() };
      raw.restaurant = { ...raw.restaurant, [key]: value };
      expect(() => validateSavedState(raw)).toThrow();
      expect(() => hydrateState(raw, createInitialState())).toThrow();
    }
  });

  it('round-trips optional paid-sales thresholds without adding a default or coercing custom IDs', () => {
    const fresh = createInitialState();
    expect(fresh.restaurant).not.toHaveProperty('menuSalesThresholds');
    expect(() => validateSavedState(fresh)).not.toThrow();
    expect(hydrateState(fresh, createInitialState()).restaurant)
      .not.toHaveProperty('menuSalesThresholds');

    const empty = createInitialState();
    empty.restaurant = { ...empty.restaurant, menuSalesThresholds: [] };
    expect(saveState(empty)).toBe(true);
    expect(loadState().restaurant.menuSalesThresholds).toEqual([]);
    expect(hydrateState(loadState(), createInitialState()).restaurant.menuSalesThresholds).toEqual([]);

    const raw = createInitialState();
    raw.dishes = raw.dishes.map(dish => ({ ...dish, id: '__proto__' }));
    raw.restaurant = {
      ...raw.restaurant,
      menuSalesThresholds: [
        { kind: 'dish', id: '__proto__', threshold: 2 },
        { kind: 'dish', id: 'stale:custom|id', threshold: 8 },
        { kind: 'drink', id: '__proto__', threshold: 3 },
        { kind: 'drink', id: 'water', threshold: Number.MAX_SAFE_INTEGER },
      ],
    };

    expect(saveState(raw)).toBe(true);
    expect(loadState().restaurant.menuSalesThresholds).toEqual(raw.restaurant.menuSalesThresholds);
    expect(hydrateState(loadState(), createInitialState()).restaurant.menuSalesThresholds)
      .toEqual(raw.restaurant.menuSalesThresholds);
  });

  it.each([
    ['non-array', null],
    ['non-array object', {}],
    ['string', 'bad'],
    ['undefined property', undefined],
  ])('rejects a present %s paid-sales threshold branch', (_label, menuSalesThresholds) => {
    const raw = createInitialState();
    raw.restaurant = { ...raw.restaurant, menuSalesThresholds };

    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it.each([
    ['null record', null],
    ['invalid kind', { kind: 'side', id: 'starter-toast', threshold: 2 }],
    ['empty ID', { kind: 'dish', id: '', threshold: 2 }],
    ['non-string ID', { kind: 'dish', id: 1, threshold: 2 }],
    ['missing ID', { kind: 'dish', threshold: 2 }],
    ['missing threshold', { kind: 'dish', id: 'starter-toast' }],
    ['null threshold', { kind: 'dish', id: 'starter-toast', threshold: null }],
    ['zero threshold', { kind: 'dish', id: 'starter-toast', threshold: 0 }],
    ['negative threshold', { kind: 'dish', id: 'starter-toast', threshold: -1 }],
    ['decimal threshold', { kind: 'dish', id: 'starter-toast', threshold: 1.5 }],
    ['unsafe threshold', { kind: 'dish', id: 'starter-toast', threshold: Number.MAX_SAFE_INTEGER + 1 }],
    ['coerced threshold', { kind: 'dish', id: 'starter-toast', threshold: '2' }],
    ['extra record field', { kind: 'dish', id: 'starter-toast', threshold: 2, extra: true }],
  ])('rejects malformed paid-sales threshold record: %s', (_label, record) => {
    const raw = createInitialState();
    raw.restaurant = { ...raw.restaurant, menuSalesThresholds: [record] };

    expect(() => validateSavedState(raw)).toThrow();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
  });

  it('rejects duplicate kind/ID threshold policies but permits a same-text ID in the other kind', () => {
    const raw = createInitialState();
    raw.restaurant = {
      ...raw.restaurant,
      menuSalesThresholds: [
        { kind: 'dish', id: 'same', threshold: 2 },
        { kind: 'dish', id: 'same', threshold: 3 },
      ],
    };
    expect(() => validateSavedState(raw)).toThrow(/duplicate/i);
    expect(() => hydrateState(raw, createInitialState())).toThrow(/duplicate/i);

    raw.restaurant.menuSalesThresholds = [
      { kind: 'dish', id: 'same', threshold: 2 },
      { kind: 'drink', id: 'same', threshold: 3 },
    ];
    expect(() => validateSavedState(raw)).not.toThrow();
  });
});
