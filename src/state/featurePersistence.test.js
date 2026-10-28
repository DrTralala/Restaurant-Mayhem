import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCareerInitialState, createInitialState } from './initialState';
import { hydrateState, loadState, saveState } from './persistence';
import { validateSavedState } from './saveValidation';
import { acceptServiceContract } from '../simulation/serviceContracts';
import { createDishOrderSnapshot, getResolvedDish } from '../simulation/cookbook';
import { continueCareerAsSandbox, evaluateCareerRun } from '../simulation/careerRun';
import { getResolvedDrink } from '../data/drinks';
import { getStaffTaskDuration } from '../simulation/staffPerformance';
import { buildAffordableBaskets } from '../simulation/menuEconomy';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
function legacy() {
  const raw = createInitialState();
  delete raw.cookbook;
  delete raw.serviceContracts;
  delete raw.paidVisitSequence;
  delete raw.careerRun;
  delete raw.menuSales;
  raw.dishes = raw.dishes.map(({ cookbookId, ...dish }) => dish);
  return raw;
}
function orderFixture() {
  const raw = legacy();
  raw.customers = [{ id: 'guest', state: 'waiting_for_items', dishId: 'starter-toast', drinkId: null,
    menuOutcome: 'ordered', foodOutcome: 'pending', foodOrderedAt: 35990,
    foodPatienceBudget: 300, foodDeadlineAt: 36290, orderTime: 35990,
    dishPriceAtOrder: 9, orderedServiceItemIds: ['dish-1'], consumedServiceItemIds: [] }];
  raw.serviceItems = [{ id: 'dish-1', customerId: 'guest', menuItemId: 'starter-toast', kind: 'dish', state: 'ordered' }];
  return raw;
}

describe('additive v10 feature persistence', () => {
  it('starts a new sandbox with an empty day-1 sales branch', () => {
    const fresh = createInitialState();
    expect(fresh.menuSales).toEqual({
      day: fresh.restaurant.day, dishes: [], drinks: [],
    });
  });

  it('loads a truly old sandbox without changing cash/time or awarding historical credit', () => {
    const raw = legacy();
    raw.restaurant.totalServed = 1000;
    raw.completedCustomers = [{ customerId: 'old', revenue: 25 }];
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    const state = hydrateState(loaded, createInitialState());
    expect(state.restaurant).toEqual(raw.restaurant);
    expect(state.careerRun).toBeNull();
    expect(state.paidVisitSequence).toBe(0);
    expect(state.cookbook.entries.toast.paidPortions).toBe(0);
    expect(state.dishes[0].cookbookId).toBe('toast');
    expect(state.serviceContracts.active).toBeNull();
    expect(state.completedCustomers).toEqual(raw.completedCustomers);
    expect(state.menuSales).toEqual({ day: raw.restaurant.day, dishes: [], drinks: [] });
  });
  it('normalises malformed optional menu sales before strict validation in both entry points', () => {
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

    const expected = {
      day: 1,
      dishes: [{ key: 'starter-toast', count: 2 }],
      drinks: [{ key: 'water', count: 3 }],
    };
    expect(hydrateState(raw, createInitialState()).menuSales).toEqual(expected);

    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded.menuSales).toEqual(expected);
    expect(hydrateState(loaded, createInitialState()).menuSales).toEqual(expected);
  });

  it.each([
    null,
    {},
    { day: 1, dishes: 'bad', drinks: [] },
    { day: 1, dishes: [], drinks: 'bad' },
    { day: 2, dishes: [{ key: 'starter-toast', count: 4 }], drinks: [] },
  ])('fills empty current-day menu sales for malformed value %s', value => {
    const raw = { ...createInitialState(), menuSales: value };

    expect(hydrateState(raw, createInitialState()).menuSales).toEqual({
      day: 1, dishes: [], drinks: [],
    });
  });

  it('round-trips valid menu sales including a custom dish ID ending in Id', () => {
    const raw = createInitialState();
    raw.dishes = [...raw.dishes, {
      id: 'custom-menuId', name: 'Custom dish', price: 9, prepTime: 30,
      quality: 1, popularity: 50,
    }];
    raw.menuSales = {
      day: 1,
      dishes: [{ key: 'custom-menuId', count: 2 }, { key: 'starter-toast', count: 1 }],
      drinks: [{ key: 'iced-tea', count: 3 }],
    };
    expect(saveState(raw)).toBe(true);

    const loaded = loadState();
    expect(loaded.menuSales).toEqual(raw.menuSales);
    const hydrated = hydrateState(loaded, createInitialState());
    expect(hydrated.menuSales).toEqual(raw.menuSales);
    expect(hydrated.dishes.find(dish => dish.id === 'custom-menuId'))
      .toMatchObject({ id: 'custom-menuId', price: 9 });
  });

  it('migrates recoverable raw order stats/price before starter adoption with no authored provenance', () => {
    const raw = orderFixture();
    // Only a complete original bill can opt into strict snapshot checkout.
    Object.assign(raw.customers[0], { drinkPriceAtOrder: null, orderSubtotal: 9 });
    raw.dishes[0].quality = 4;
    const hydrated = hydrateState(raw, createInitialState());
    const snapshot = hydrated.customers[0].dishOrderSnapshot;
    expect(snapshot).toMatchObject({ schemaVersion: 1, serviceItemId: 'dish-1', menuItemId: 'starter-toast',
      orderedAt: 35990, cookbookId: null, masteryPerk: null, price: 9, quality: 4, prepTime: 60, popularity: 50 });
    expect(hydrated.serviceItems[0].dishOrderSnapshot).toEqual(snapshot);
    expect(hydrated.dishes[0]).toMatchObject({ cookbookId: 'toast', quality: 4 });
    expect(raw.customers[0]).not.toHaveProperty('dishOrderSnapshot');
    expect(hydrateState(hydrated, createInitialState()).customers[0].dishOrderSnapshot).toEqual(snapshot);
  });
  it('does not manufacture an incomplete legacy order snapshot from fresh defaults', () => {
    const raw = orderFixture();
    raw.dishes = [];
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
    const raw = { ...legacy(), cookbook: undefined };
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
  it('validates full snapshot copies before any legacy or cooking normalisation', () => {
    const raw = orderFixture();
    raw.customers[0].dishOrderSnapshot = null;
    expect(() => hydrateState(raw, createInitialState())).toThrow();
    const good = createInitialState();
    const snapshot = createDishOrderSnapshot(getResolvedDish(good, 'starter-toast'), { serviceItemId: 'dish-1', orderedAt: 35990 });
    raw.customers[0] = { ...raw.customers[0], dishPriceAtOrder: 12, dishOrderSnapshot: snapshot };
    raw.serviceItems[0].dishOrderSnapshot = { ...snapshot, price: 13 };
    expect(() => hydrateState(raw, createInitialState())).toThrow();
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
    raw.restaurant = { ...raw.restaurant, day: 8, gameTime: 635700, reputation: 2 };
    raw = acceptServiceContract(raw, { templateId: 'office-lunch' });
    // Office lasts 900 prep + 4200 service: its deadline coincides with Opening Week.
    expect(raw.serviceContracts.active.deadlineAt).toBe(640800);
    raw.restaurant.gameTime = 640800;
    raw.paused = true;
    raw.paidVisitSequence = 80;
    raw.careerRun = { ...raw.careerRun, paidMeals: 80, lastPaidVisitSequence: 80 };
    raw.cookbook.lastAppliedPaidVisitSequence = 80;
    raw.completedCustomers = [{ customerId: 'legacy-payment', revenue: 25 }];
    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.restaurant).toMatchObject({ funds: 580, gameTime: 640800, reputation: 1.75 });
    expect(hydrated.completedCustomers).toEqual([]);
    expect(hydrated.careerRun).toMatchObject({ status: 'lost', paidMeals: 80, needsDecision: true });
    expect(hydrated.cookbook.entries.toast.paidPortions).toBe(0);
    expect(hydrated.serviceContracts.active).toBeNull();
    expect(hydrated.serviceContracts.results[0]).toMatchObject({ status: 'failed', bonusPaid: 0 });
    expect(hydrated.paused).toBe(true);
    const again = hydrateState(hydrated, createInitialState());
    expect(again.restaurant.funds).toBe(580);
    expect(again.careerRun).toEqual(hydrated.careerRun);
  });
  it('retains future booked arrivals at the cutoff without admission or missed-resume changes', () => {
    let raw = createCareerInitialState({ scenarioId: 'opening-week', runId: 'run' });
    raw.restaurant = { ...raw.restaurant, day: 8, gameTime: 639900 };
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
  function v1Cookbook() {
    return { schemaVersion: 1, lastAppliedPaidVisitSequence: 0, entries: {
      toast: { discovered: true, paidPortions: 15, perk: 'speed',
        menuSettings: { name: 'Toasted Bread', price: 12, quality: 1 } },
      'cheese-toast': { discovered: false, paidPortions: 0, perk: null,
        menuSettings: { name: 'Cheese Toast', price: 14, quality: 1 } },
      'roast-vegetables': { discovered: false, paidPortions: 0, perk: null,
        menuSettings: { name: 'Roast Vegetables', price: 18, quality: 1 } },
      'baked-potato': { discovered: false, paidPortions: 0, perk: null,
        menuSettings: { name: 'Baked Potato', price: 22, quality: 1 } },
      fries: { discovered: false, paidPortions: 0, perk: null,
        menuSettings: { name: 'Crispy Fries', price: 10, quality: 1 } },
      'fried-chicken': { discovered: false, paidPortions: 0, perk: null,
        menuSettings: { name: 'Fried Chicken', price: 20, quality: 1 } },
    } };
  }
  it('upgrades a recognised v1 cookbook ahead of strict validation in both entry points', () => {
    const raw = createInitialState();
    raw.cookbook = v1Cookbook();
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    const loaded = loadState();
    expect(loaded.cookbook.schemaVersion).toBe(2);
    expect(loaded.cookbook.entries.toast).toMatchObject({ paidPortions: 15, perk: 'speed' });
    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.cookbook.schemaVersion).toBe(2);
    expect(hydrated.cookbook.entries.toast).toMatchObject({ paidPortions: 15, perk: 'speed',
      menuSettings: { name: 'Toasted Bread', price: 12, quality: 1 } });
    expect(hydrated.cookbook.entries.gazpacho).toEqual({ discovered: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Gazpacho', price: 16, quality: 1 } });
  });
  it('fails closed for a malformed v1 cookbook in both entry points', () => {
    const raw = createInitialState();
    raw.cookbook = v1Cookbook();
    delete raw.cookbook.entries.fries;
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadState()).toBeNull();
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

  it('keeps an old root-v10 drink set unchanged without auto-unlocking Iced Tea', () => {
    const raw = {
      ...createInitialState(),
      unlockedDrinkIds: ['water', 'tea', 'soda', 'coffee', 'juice'],
      drinkOverrides: {},
    };
    expect(() => validateSavedState(raw)).not.toThrow();

    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.unlockedDrinkIds).toEqual(['water', 'tea', 'soda', 'coffee', 'juice']);
    expect(hydrated.unlockedDrinkIds).not.toContain('iced-tea');
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
  ])('round-trips a synthetic v10 %s list while absence stays inactive', (key, value) => {
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
    const withOrderFacts = () => {
      const raw = orderFixture();
      Object.assign(raw.customers[0], { drinkPriceAtOrder: null, orderSubtotal: 9 });
      return raw;
    };
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
      dishId: 'starter-toast', dishPriceAtOrder: 9, orderSubtotal: 9,
    });
    expect(suspended.customers[0].dishOrderSnapshot)
      .toMatchObject({ schemaVersion: 1, menuItemId: 'starter-toast', price: 9, cookbookId: null });
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
});
