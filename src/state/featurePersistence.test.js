import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCareerInitialState, createInitialState } from './initialState';
import { hydrateState, loadState, saveState } from './persistence';
import { validateSavedState } from './saveValidation';
import { acceptServiceContract } from '../simulation/serviceContracts';
import { createDishOrderSnapshot, getResolvedDish } from '../simulation/cookbook';
import { continueCareerAsSandbox, evaluateCareerRun } from '../simulation/careerRun';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
function legacy() {
  const raw = createInitialState();
  delete raw.cookbook;
  delete raw.serviceContracts;
  delete raw.paidVisitSequence;
  delete raw.careerRun;
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
  });
  it('migrates recoverable raw order stats/price before starter adoption with no authored provenance', () => {
    const raw = orderFixture();
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
  it.each([0, -1, 2, 0.5, null])('rejects invalid live marker %s against root 1', value => {
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
    raw.restaurant = { ...raw.restaurant, day: 8, gameTime: 636300, reputation: 2 };
    raw = acceptServiceContract(raw, { templateId: 'office-lunch' });
    // Office lasts 900 prep + 3600 service: its deadline coincides with Opening Week.
    expect(raw.serviceContracts.active.deadlineAt).toBe(640800);
    raw.restaurant.gameTime = 640800;
    raw.paused = true;
    raw.paidVisitSequence = 80;
    raw.careerRun = { ...raw.careerRun, paidMeals: 80, lastPaidVisitSequence: 80 };
    raw.cookbook.lastAppliedPaidVisitSequence = 80;
    raw.completedCustomers = [{ customerId: 'legacy-payment', revenue: 25 }];
    const hydrated = hydrateState(raw, createInitialState());
    expect(hydrated.restaurant).toMatchObject({ funds: 625, gameTime: 640800 });
    expect(hydrated.completedCustomers).toEqual([]);
    expect(hydrated.careerRun).toMatchObject({ status: 'won', paidMeals: 80, needsDecision: true });
    expect(hydrated.cookbook.entries.toast.paidPortions).toBe(0);
    expect(hydrated.serviceContracts.active).toBeNull();
    expect(hydrated.serviceContracts.results[0]).toMatchObject({ status: 'failed', bonusPaid: 0 });
    expect(hydrated.paused).toBe(true);
    const again = hydrateState(hydrated, createInitialState());
    expect(again.restaurant.funds).toBe(625);
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
});
