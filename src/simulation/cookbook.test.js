import { describe, expect, it } from 'vitest';
import {
  applyCookbookPaidVisit, createCookbookState, createDishOrderSnapshot,
  getCookbookEntryStatus, getDishForServiceItem, getResolvedDish, normaliseCookbookState,
  reconcileCookbookDiscoveries, reduceCookbookAction, validateCookbookState,
  validateDishOrderSnapshot, validateDishOrderSnapshots,
} from './cookbook';

function fixture() {
  return {
    cookbook: createCookbookState(), paidVisitSequence: 0,
    dishes: [{ id: 'starter-toast', cookbookId: 'toast', name: 'Toasted Bread', base: 'Bread',
      method: 'Toasted', requiredEquipmentId: 'eq1', cuisine: 'generic', price: 12,
      quality: 1, prepTime: 60, popularity: 50, unlocked: true }],
    equipment: [{ id: 'eq1', owned: true }, { id: 'eq2', owned: false }, { id: 'eq3', owned: false }],
    kitchenStations: [{ id: 'k1', equipmentId: 'eq1' }],
    restaurant: { funds: 600, totalServed: 0 }, recipeSlots: 1, customers: [], serviceItems: [],
  };
}

function outcome(sequence, overrides = {}) {
  return {
    schemaVersion: 1, sequence, customerId: `c${sequence}`, partyId: `p${sequence}`, paidAt: 36000 + sequence,
    menuOutcome: 'ordered', foodOutcome: 'delivered', serviceContractId: null, serviceContractGuestId: null,
    dish: { serviceItemId: `i${sequence}`, menuItemId: 'starter-toast', cookbookId: 'toast',
      priceAtOrder: 12, chargedAmount: 12, fulfilled: true, paid: true },
    subtotal: 12, tip: 2, totalPaid: 14, ...overrides,
  };
}

function pay(state, count, cookbookId = 'toast') {
  for (let i = 0; i < count; i += 1) {
    const event = outcome(state.paidVisitSequence + 1);
    event.dish.cookbookId = cookbookId;
    state = { ...state, paidVisitSequence: event.sequence, cookbook: applyCookbookPaidVisit(state.cookbook, event) };
    state = { ...state, cookbook: reconcileCookbookDiscoveries(state) };
  }
  return state;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('cookbook discovery and mastery', () => {
  it('starterCookbookProgress: discovers Cheese Toast only on the third paid toast, without costs or slots', () => {
    let state = fixture();
    expect(getCookbookEntryStatus(state, 'cheese-toast')).toMatchObject({ discovered: false,
      requirements: [{ type: 'paidPortions', id: 'toast', current: 0, required: 3, met: false }] });
    state = pay(freeze(state), 2);
    expect(state.cookbook.entries['cheese-toast'].discovered).toBe(false);
    state = pay(freeze(state), 1);
    expect(getCookbookEntryStatus(state, 'cheese-toast')).toMatchObject({ discovered: true, canAdd: true });
    expect(state.restaurant.funds).toBe(600);
    expect(state.recipeSlots).toBe(1);
    expect(state.dishes).toHaveLength(1);
    expect(reconcileCookbookDiscoveries(state)).toBe(state.cookbook);
  });

  it.each([['eq2', 'roast-vegetables', 'baked-potato'], ['eq3', 'fries', 'fried-chicken']])(
    'discovers equipment branches monotonically: %s', (equipmentId, first, second) => {
      let state = fixture();
      state.equipment = state.equipment.map(e => ({ ...e, owned: e.id === equipmentId || e.owned }));
      state.cookbook = reconcileCookbookDiscoveries(state);
      expect(state.cookbook.entries[first].discovered).toBe(true);
      expect(state.cookbook.entries[second].discovered).toBe(false);
      state = pay(state, 4, first);
      expect(getCookbookEntryStatus(state, second).requirements[1]).toMatchObject({ current: 4, required: 5, met: false });
      state = pay(state, 1, first);
      expect(state.cookbook.entries[second].discovered).toBe(true);
      state.equipment = [];
      state.cookbook = reconcileCookbookDiscoveries(state);
      expect(getCookbookEntryStatus(state, second)).toMatchObject({ discovered: true, equipmentOwned: false, canAdd: false });
    },
  );

  it('requires 15 portions, permanently applies speed once and caps subsequent payments', () => {
    let state = pay(fixture(), 14);
    const choice = { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'speed' };
    expect(reduceCookbookAction(state, choice)).toBe(state);
    expect(getCookbookEntryStatus(state, 'toast').canChoosePerk).toBe(false);
    state = pay(state, 1);
    expect(getCookbookEntryStatus(state, 'toast').canChoosePerk).toBe(true);
    state = reduceCookbookAction(freeze(state), choice);
    expect(getResolvedDish(state, 'starter-toast').prepTime).toBe(51);
    expect(getResolvedDish(state, 'starter-toast').popularity).toBe(50);
    expect(getResolvedDish(state, 'starter-toast').prepTime).toBe(51);
    expect(state.dishes[0].prepTime).toBe(60);
    expect(reduceCookbookAction(state, choice)).toBe(state);
    expect(reduceCookbookAction(state, { ...choice, perk: 'appeal' })).toBe(state);
    state = pay(state, 2);
    expect(state.cookbook.entries.toast.paidPortions).toBe(15);
    expect(state.cookbook.lastAppliedPaidVisitSequence).toBe(17);
    expect(state.restaurant.funds).toBe(600);
  });

  it('appeal keeps 60 seconds and raises toast popularity to 60 without changing quality', () => {
    const state = reduceCookbookAction(pay(fixture(), 15), {
      type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'appeal', cost: -100,
    });
    expect(getResolvedDish(state, 'starter-toast')).toMatchObject({ prepTime: 60, popularity: 60, quality: 1 });
  });
});

describe('canonicalCookbookOutcomes', () => {
  it.each([
    ['paid authored dish', {}, 1],
    ['dish plus drink', { subtotal: 20, tip: 3, totalPaid: 23 }, 1],
    ['contract tags', { serviceContractId: 'contract-1', serviceContractGuestId: 'guest-1' }, 1],
    ['custom', { dish: { ...outcome(1).dish, cookbookId: null } }, 0],
    ['drink only', { dish: null, foodOutcome: 'none' }, 0],
    ['unknown legacy', { foodOutcome: 'unknown', dish: { ...outcome(1).dish, cookbookId: null, fulfilled: false, paid: false } }, 0],
    ['pending food', { foodOutcome: 'pending', dish: { ...outcome(1).dish, fulfilled: false, paid: false, chargedAmount: 0 } }, 0],
    ['cancelled with drink paid', { foodOutcome: 'cancelled', dish: { ...outcome(1).dish, fulfilled: false, paid: false, chargedAmount: 0 } }, 0],
    ['historical asking price not a charge', { dish: { ...outcome(1).dish, chargedAmount: 0, paid: false } }, 0],
  ])('%s credits %s', (_name, overrides, portions) => {
    const cookbook = applyCookbookPaidVisit(freeze(createCookbookState()), outcome(1, overrides));
    expect(cookbook.entries.toast.paidPortions).toBe(portions);
    expect(cookbook.lastAppliedPaidVisitSequence).toBe(1);
  });

  it.each([
    { schemaVersion: 2 }, { foodOutcome: null }, { foodOutcome: 'late' }, { menuOutcome: 'unaffordable' },
    { sequence: 0 }, { sequence: NaN }, { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { customerId: '' }, { partyId: '' }, { paidAt: Infinity }, { serviceContractId: undefined },
    { serviceContractGuestId: '' }, { totalPaid: 99 }, { tip: -1 }, { dish: undefined },
    { dish: { ...outcome(1).dish, cookbookId: 'fake' } },
    { dish: { ...outcome(1).dish, chargedAmount: 13 } },
    { dish: { ...outcome(1).dish, chargedAmount: 0 } },
    { foodOutcome: 'cancelled' },
  ])('rejects malformed or contradictory canonical outcome %j without advancing', overrides => {
    const cookbook = createCookbookState();
    expect(applyCookbookPaidVisit(cookbook, outcome(1, overrides))).toBe(cookbook);
  });

  it('does not grant portions without an actual event or with missing authored service identity', () => {
    const cookbook = createCookbookState();
    expect(applyCookbookPaidVisit(cookbook, null)).toBe(cookbook);
    expect(applyCookbookPaidVisit(cookbook, outcome(1, {
      dish: { ...outcome(1).dish, serviceItemId: null },
    })).entries.toast.paidPortions).toBe(0);
    expect(applyCookbookPaidVisit(cookbook, outcome(1, {
      dish: { ...outcome(1).dish, cookbookId: 'cheese-toast' },
    })).entries['cheese-toast'].paidPortions).toBe(0);
  });

  it('rejects replays, permits gaps and produces identical sequential results regardless of grouping', () => {
    const initial = createCookbookState();
    const first = applyCookbookPaidVisit(initial, outcome(5));
    expect(applyCookbookPaidVisit(first, outcome(5))).toBe(first);
    expect(applyCookbookPaidVisit(first, outcome(4))).toBe(first);
    const events = Array.from({ length: 20 }, (_, i) => outcome(i + 6));
    const all = events.reduce(applyCookbookPaidVisit, first);
    const grouped = events.slice(10).reduce(applyCookbookPaidVisit, events.slice(0, 10).reduce(applyCookbookPaidVisit, first));
    expect(all).toEqual(grouped);
    expect(all.entries.toast.paidPortions).toBe(15);
  });
});

describe('canonical identity and reducer ownership', () => {
  it('preserves renamed, upgraded settings and mastery through removal, normalisation and re-add', () => {
    let state = reduceCookbookAction(pay(fixture(), 15), { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'speed' });
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: {
      name: '  House Toast  ', price: 23.6, quality: 10, prepTime: 1, popularity: 100,
      cookbookId: 'fries', id: 'fake', method: 'Fried', masteryPerk: 'appeal',
    } });
    state = reduceCookbookAction(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast', cost: 0, quality: 10 });
    expect(state.restaurant.funds).toBe(550);
    expect(state.dishes[0]).toMatchObject({ id: 'starter-toast', cookbookId: 'toast', name: 'House Toast', price: 24, quality: 2, prepTime: 60, method: 'Toasted' });
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'starter-toast' });
    expect(state.dishes).toEqual([]);
    state = { ...state, ...normaliseCookbookState(state, { legacy: false, lastPaidVisitSequence: 15 }) };
    state = reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast', id: 'fake', quality: 10 });
    expect(getResolvedDish(state, 'cookbook:toast')).toMatchObject({ name: 'House Toast', price: 24, quality: 2, prepTime: 51 });
    expect(state.cookbook.entries.toast).toMatchObject({ paidPortions: 15, perk: 'speed' });
    expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' })).toBe(state);
    expect(state.restaurant.funds).toBe(550);
  });

  it('allocates the smallest free menu ID avoiding live dishes and both retained snapshot locations', () => {
    let state = fixture();
    state.dishes = [{ ...state.dishes[0], id: 'cookbook:toast', cookbookId: null }];
    state.customers = [{ dishOrderSnapshot: { menuItemId: 'cookbook:toast:2' } }];
    state.serviceItems = [{ dishOrderSnapshot: { menuItemId: 'cookbook:toast:4' } }];
    state = reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' });
    expect(state.dishes[1].id).toBe('cookbook:toast:3');
  });

  it('keeps custom operations unowned, with no mastery resolution or recipe-slot restriction', () => {
    const state = fixture();
    state.dishes = Array.from({ length: 8 }, (_, i) => ({ ...state.dishes[0], id: `custom-${i}`, cookbookId: null, masteryPerk: 'speed', prepTime: 150 }));
    expect(getResolvedDish(state, 'custom-0')).toMatchObject({ cookbookId: null, masteryPerk: null, prepTime: 150 });
    for (const type of ['ADD_DISH', 'UPDATE_DISH', 'REMOVE_DISH', 'UPGRADE_DISH_QUALITY', 'UNKNOWN']) {
      expect(reduceCookbookAction(state, { type, id: 'custom-0' })).toBeNull();
    }
    expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' }).dishes).toHaveLength(9);
  });

  it('rejects locked/unknown/equipment-missing additions and invalid choices without side effects', () => {
    const state = fixture();
    for (const cookbookId of ['fries', 'fake', 'toString']) {
      expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId })).toBe(state);
    }
    expect(reduceCookbookAction(pay(state, 15), { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'fake' }).cookbook.entries.toast.perk).toBeNull();
    const missing = { ...state, dishes: [], equipment: [] };
    expect(reduceCookbookAction(missing, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' })).toBe(missing);
    expect(getCookbookEntryStatus(state, 'fake')).toBeNull();
    expect(getResolvedDish(state, 'missing')).toBeNull();
  });

  it('retains price clamp/round, nonempty names, fixed quality cost and cap', () => {
    let state = fixture();
    expect(reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { name: ' ', price: NaN } })).toBe(state);
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 1000 } });
    expect(state.dishes[0].price).toBe(100);
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: -1 } });
    expect(state.dishes[0].price).toBe(1);
    for (let i = 0; i < 9; i += 1) state = reduceCookbookAction(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' });
    expect(state.dishes[0].quality).toBe(10);
    expect(state.restaurant.funds).toBe(150);
    expect(reduceCookbookAction(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' })).toBe(state);
    const poor = { ...fixture(), restaurant: { funds: 49 } };
    expect(reduceCookbookAction(poor, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' })).toBe(poor);
  });
});

describe('immutable snapshots and conservative legacy resolution', () => {
  it('rejects two customer owners of the same retained snapshot even after plate cleanup', () => {
    const state = fixture();
    const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'i1', orderedAt: 0 });
    state.customers = [
      { id: 'c1', dishId: 'starter-toast', dishOrderSnapshot: snapshot },
      { id: 'c2', dishId: 'starter-toast', dishOrderSnapshot: snapshot },
    ];
    expect(() => validateDishOrderSnapshots(state)).toThrow();
  });

  it('rejects a present customer monetary snapshot inconsistent with its food snapshot', () => {
    const state = fixture();
    const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'i1', orderedAt: 0 });
    state.customers = [{ id: 'c1', dishId: 'starter-toast', dishPriceAtOrder: 99, dishOrderSnapshot: snapshot }];
    expect(() => validateDishOrderSnapshots(state)).toThrow();
    state.customers[0].dishPriceAtOrder = 12;
    expect(() => validateDishOrderSnapshots(state)).not.toThrow();
    Object.assign(state.customers[0], { dishId: null, foodOutcome: 'cancelled', dishPriceAtOrder: null });
    expect(() => validateDishOrderSnapshots(state)).not.toThrow();
  });

  it('custom snapshots preserve committed stats and always have null mastery identity', () => {
    const state = fixture();
    Object.assign(state.dishes[0], { cookbookId: null, prepTime: 213, popularity: 47 });
    const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'i1', orderedAt: 36000 });
    expect(snapshot).toMatchObject({ cookbookId: null, masteryPerk: null, prepTime: 213, popularity: 47 });
    expect(() => validateDishOrderSnapshot({ ...snapshot, masteryPerk: 'speed' })).toThrow();
  });

  it('validates snapshot copies, ownership and cancelled retained history without requiring a plate', () => {
    const state = fixture();
    const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'i1', orderedAt: 0 });
    expect(() => validateDishOrderSnapshot(snapshot)).not.toThrow();
    const customer = { id: 'c1', dishId: 'starter-toast', dishOrderSnapshot: snapshot };
    const item = { id: 'i1', kind: 'dish', customerId: 'c1', menuItemId: 'starter-toast', dishOrderSnapshot: { ...snapshot } };
    state.customers = [customer];
    state.serviceItems = [item];
    expect(() => validateDishOrderSnapshots(state)).not.toThrow();
    item.dishOrderSnapshot.price = 13;
    expect(() => validateDishOrderSnapshots(state)).toThrow();
    item.dishOrderSnapshot = snapshot;
    item.customerId = 'c2';
    expect(() => validateDishOrderSnapshots(state)).toThrow();
    state.serviceItems = [];
    customer.dishId = null;
    customer.foodOutcome = 'cancelled';
    expect(() => validateDishOrderSnapshots(state)).not.toThrow();
  });

  it('retains a pre-choice removed dish snapshot without applying current mastery, price or quality', () => {
    let state = pay(fixture(), 15);
    const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'i1', orderedAt: 36000 });
    expect(snapshot).toEqual({ schemaVersion: 1, serviceItemId: 'i1', menuItemId: 'starter-toast', cookbookId: 'toast',
      orderedAt: 36000, name: 'Toasted Bread', base: 'Bread', method: 'Toasted', cuisine: 'generic',
      requiredEquipmentId: 'eq1', price: 12, quality: 1, prepTime: 60, popularity: 50, masteryPerk: null });
    state = reduceCookbookAction(state, { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'speed' });
    expect(getResolvedDish(state, 'starter-toast').prepTime).toBe(51);
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'starter-toast' });
    const item = { id: 'i1', kind: 'dish', menuItemId: 'starter-toast', dishOrderSnapshot: freeze(snapshot) };
    expect(getDishForServiceItem(state, item)).toMatchObject({ id: 'starter-toast', prepTime: 60, price: 12, quality: 1, masteryPerk: null });
  });

  it('legacy fallback uses raw unbuffed stats and removes canonical provenance', () => {
    const state = reduceCookbookAction(pay(fixture(), 15), { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'speed' });
    expect(getDishForServiceItem(state, { kind: 'dish', menuItemId: 'starter-toast' })).toMatchObject({ prepTime: 60, cookbookId: null, masteryPerk: null });
    expect(getDishForServiceItem(state, { kind: 'dish', menuItemId: 'missing' })).toBeNull();
    expect(getDishForServiceItem(state, { kind: 'drink', menuItemId: 'starter-toast' })).toBeNull();
  });

  it.each([{ prepTime: 0 }, { price: 1.5 }, { quality: 11 }, { popularity: NaN }, { name: '' },
    { cookbookId: 'fake' }, { masteryPerk: 'appeal' }, { method: 'Fried' }, { base: null }])(
    'rejects incomplete or inconsistent resolved input %j', changes => {
      expect(() => createDishOrderSnapshot({ ...getResolvedDish(fixture(), 'starter-toast'), ...changes }, { serviceItemId: 'i1', orderedAt: 0 })).toThrow();
    },
  );

  it.each([null, {}, { serviceItemId: 'different' }, { menuItemId: 'other' }, { prepTime: 51 }, { schemaVersion: 2 }])(
    'invalid present snapshot never silently falls back: %j', changes => {
      const state = fixture();
      const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'i1', orderedAt: 0 });
      const invalid = changes === null ? null : Object.keys(changes).length ? { ...snapshot, ...changes } : {};
      expect(getDishForServiceItem(state, { kind: 'dish', id: 'i1', menuItemId: 'starter-toast', dishOrderSnapshot: invalid })).toBeNull();
    },
  );
});

describe('legacy adoption and strict validation', () => {
  it('adopts only a canonical legacy starter, retaining edited settings without historical portions', () => {
    const state = fixture();
    delete state.cookbook;
    delete state.dishes[0].cookbookId;
    Object.assign(state.dishes[0], { name: 'My Toast', price: 22, quality: 4 });
    state.restaurant.totalServed = 10000;
    state.equipment.forEach(e => { e.owned = true; });
    const result = normaliseCookbookState(freeze(state), { legacy: true, lastPaidVisitSequence: 9 });
    expect(result.dishes[0]).toMatchObject({ id: 'starter-toast', cookbookId: 'toast', name: 'My Toast', price: 22, quality: 4 });
    expect(result.cookbook.entries.toast).toMatchObject({ paidPortions: 0, perk: null, menuSettings: { name: 'My Toast', price: 22, quality: 4 } });
    expect(result.cookbook.lastAppliedPaidVisitSequence).toBe(9);
    expect(result.cookbook.entries.fries.discovered).toBe(true);
    expect(result.cookbook.entries['baked-potato'].discovered).toBe(false);
    const hydrated = { ...state, ...result, paidVisitSequence: 9 };
    expect(normaliseCookbookState(hydrated, { legacy: false, lastPaidVisitSequence: 9 })).toEqual(result);
  });

  it('does not resurrect removed toast or adopt a noncanonical starter/custom copy', () => {
    const state = fixture();
    delete state.cookbook;
    delete state.dishes[0].cookbookId;
    const copy = { ...state.dishes[0], id: 'custom' };
    state.dishes[0].prepTime = 123;
    state.dishes.push(copy);
    expect(normaliseCookbookState(state, { legacy: true }).dishes).toEqual(state.dishes);
    expect(normaliseCookbookState({ ...state, dishes: [] }, { legacy: true }).dishes).toEqual([]);
  });

  it('accepts absent legacy cookbook but rejects null or partially present new data', () => {
    expect(() => validateCookbookState({ dishes: [] })).not.toThrow();
    expect(() => validateCookbookState({ ...fixture(), cookbook: null })).toThrow();
    const state = fixture();
    delete state.cookbook.entries.fries;
    expect(() => normaliseCookbookState(state, { legacy: true })).toThrow();
  });

  it('does not treat authored identity without its progress branch as a legacy custom recipe', () => {
    const state = fixture();
    delete state.cookbook;
    expect(() => validateCookbookState(state)).toThrow();
    expect(() => normaliseCookbookState(state, { legacy: true })).toThrow();
  });

  it.each([
    state => { state.cookbook.schemaVersion = 2; },
    state => { state.cookbook.entries.fake = state.cookbook.entries.toast; },
    state => { state.cookbook.entries.toast.paidPortions = -1; },
    state => { state.cookbook.entries.toast.paidPortions = 16; },
    state => { state.cookbook.entries.toast.paidPortions = NaN; },
    state => { state.cookbook.entries.toast.perk = 'speed'; },
    state => { state.cookbook.entries.toast.perk = 'fake'; },
    state => { state.cookbook.entries.toast.discovered = false; },
    state => { state.cookbook.lastAppliedPaidVisitSequence = 1; },
    state => { state.cookbook.entries.toast.menuSettings.price = 0; },
    state => { state.cookbook.entries.toast.menuSettings.name = ' '; },
    state => { state.cookbook.entries.fries.paidPortions = 1; },
    state => { state.dishes.push({ ...state.dishes[0], id: 'duplicate' }); },
    state => { state.dishes[0].cookbookId = 'fake'; },
    state => { state.dishes[0].price = 30; },
    state => { state.dishes[0].prepTime = 51; },
    state => { state.dishes[0].method = 'Fried'; },
  ])('rejects corrupt canonical state %#', corrupt => {
    const state = fixture();
    corrupt(state);
    expect(() => validateCookbookState(state)).toThrow();
  });
});
