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
  const entry = state.cookbook.entries[cookbookId];
  if (entry?.discovered && !entry.owned) {
    state = buy(state, cookbookId);
  }
  for (let i = 0; i < count; i += 1) {
    const event = outcome(state.paidVisitSequence + 1);
    event.dish.cookbookId = cookbookId;
    state = { ...state, paidVisitSequence: event.sequence, cookbook: applyCookbookPaidVisit(state.cookbook, event) };
    state = { ...state, cookbook: reconcileCookbookDiscoveries(state) };
  }
  return state;
}

function buy(state, cookbookId, overrides = {}) {
  const next = reduceCookbookAction(state, { type: 'BUY_COOKBOOK_RECIPE', cookbookId, ...overrides });
  return next ?? state;
}

function addCookbookDish(state, cookbookId) {
  state = buy(state, cookbookId);
  return reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId });
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
    expect(getCookbookEntryStatus(state, 'cheese-toast')).toMatchObject({
      discovered: true, owned: false, purchaseCost: 75, canAfford: true, canBuy: true, canAdd: false,
    });
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
      expect(getCookbookEntryStatus(state, second)).toMatchObject({
        discovered: true, owned: false, equipmentOwned: false, canBuy: false, canAdd: false,
      });
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

  it('buys a discovered recipe at its canonical cost and ignores forged price or ownership fields', () => {
    const paid = pay(fixture(), 3);
    expect(getCookbookEntryStatus(paid, 'cheese-toast')).toMatchObject({
      discovered: true, owned: false, purchaseCost: 75, canAfford: true, canBuy: true, canAdd: false,
    });

    const bought = buy(paid, 'cheese-toast', { cost: 0, owned: true, purchaseCost: 0 });
    expect(bought.restaurant.funds).toBe(525);
    expect(bought.dishes).toBe(paid.dishes);
    expect(bought.cookbook.entries['cheese-toast'].owned).toBe(true);
    expect(getCookbookEntryStatus(bought, 'cheese-toast')).toMatchObject({
      discovered: true, owned: true, canBuy: false, canAdd: true,
    });
    expect(buy(bought, 'cheese-toast')).toBe(bought);
  });

  it('allows a purchase with exactly the canonical funds and rejects a single dollar short', () => {
    const discovered = pay(fixture(), 3);
    const exact = { ...discovered, restaurant: { funds: 75 } };
    expect(getCookbookEntryStatus(exact, 'cheese-toast')).toMatchObject({ canAfford: true, canBuy: true });
    const bought = buy(exact, 'cheese-toast');
    expect(bought.restaurant.funds).toBe(0);
    expect(bought.cookbook.entries['cheese-toast'].owned).toBe(true);

    const oneShort = { ...discovered, restaurant: { funds: 74 } };
    expect(getCookbookEntryStatus(oneShort, 'cheese-toast')).toMatchObject({ canAfford: false, canBuy: false });
    expect(reduceCookbookAction(oneShort, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'cheese-toast' })).toBe(oneShort);
  });

  it.each([
    ['toast', 0], ['cheese-toast', 75], ['roast-vegetables', 150], ['baked-eggs', 175],
    ['baked-potato', 250], ['fries', 100], ['fried-chicken', 250], ['gazpacho', 125], ['fish-bisque', 225],
  ])('uses the canonical purchase cost for %s', (cookbookId, purchaseCost) => {
    const state = fixture();
    state.cookbook = {
      ...state.cookbook,
      entries: { ...state.cookbook.entries,
        [cookbookId]: { ...state.cookbook.entries[cookbookId], discovered: true } },
    };
    const recipe = { toast: 'eq1', 'cheese-toast': 'eq1', 'roast-vegetables': 'eq2', 'baked-eggs': 'eq2',
      'baked-potato': 'eq2', fries: 'eq3', 'fried-chicken': 'eq3', gazpacho: 'eq4', 'fish-bisque': 'eq4' }[cookbookId];
    state.equipment = [...state.equipment, ...['eq1', 'eq2', 'eq3', 'eq4']
      .filter(id => id === recipe && !state.equipment.some(item => item.id === id))
      .map(id => ({ id, owned: true }))];
    expect(getCookbookEntryStatus(state, cookbookId).purchaseCost).toBe(purchaseCost);
  });

  it.each([74, Number.NaN, Number.POSITIVE_INFINITY])('rejects an unaffordable or invalid-funds purchase (%s)', funds => {
    const state = { ...pay(fixture(), 3), restaurant: { funds } };
    expect(getCookbookEntryStatus(state, 'cheese-toast')).toMatchObject({ canAfford: false, canBuy: false });
    expect(buy(state, 'cheese-toast')).toBe(state);
  });

  it('does not buy undiscovered, unknown or unequipped recipes and retains entitlement after equipment is sold', () => {
    const undiscovered = fixture();
    expect(buy(undiscovered, 'cheese-toast')).toBe(undiscovered);
    expect(buy(undiscovered, 'unknown')).toBe(undiscovered);

    let discovered = { ...pay(fixture(), 3), equipment: [] };
    expect(getCookbookEntryStatus(discovered, 'cheese-toast')).toMatchObject({
      discovered: true, equipmentOwned: false, canBuy: false, canAdd: false,
    });
    expect(buy(discovered, 'cheese-toast')).toBe(discovered);

    discovered = addCookbookDish(pay(fixture(), 3), 'cheese-toast');
    discovered = { ...discovered, equipment: [] };
    expect(getCookbookEntryStatus(discovered, 'cheese-toast')).toMatchObject({
      discovered: true, owned: true, equipmentOwned: false, canBuy: false, canAdd: false,
    });
    discovered = reduceCookbookAction(discovered, { type: 'REMOVE_DISH', id: 'cookbook:cheese-toast' });
    expect(discovered.cookbook.entries['cheese-toast'].owned).toBe(true);
    expect(reduceCookbookAction(discovered, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'cheese-toast' })).toBe(discovered);
  });

  it('only credits paid progress for a recipe the restaurant owns', () => {
    const cookbook = createCookbookState();
    const paidCheese = outcome(1);
    paidCheese.dish.cookbookId = 'cheese-toast';
    paidCheese.dish.menuItemId = 'cookbook:cheese-toast';
    const next = applyCookbookPaidVisit(cookbook, paidCheese);
    expect(next.entries['cheese-toast'].paidPortions).toBe(0);
    expect(next.lastAppliedPaidVisitSequence).toBe(1);
  });

  it('retains purchase ownership, edits, mastery and progress across removal and re-add without charging again', () => {
    let state = addCookbookDish(pay(fixture(), 3), 'cheese-toast');
    state = reduceCookbookAction(pay(state, 15, 'cheese-toast'), {
      type: 'CHOOSE_DISH_MASTERY', cookbookId: 'cheese-toast', perk: 'appeal',
    });
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'cookbook:cheese-toast',
      changes: { name: 'House Cheese Toast', price: 18 } });
    expect(state.cookbook.entries['cheese-toast']).toMatchObject({ owned: true, paidPortions: 15, perk: 'appeal' });
    const funds = state.restaurant.funds;
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'cookbook:cheese-toast' });
    state = reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'cheese-toast' });
    expect(getResolvedDish(state, 'cookbook:cheese-toast')).toMatchObject({
      name: 'House Cheese Toast', price: 17, popularity: 75, quality: 1,
    });
    expect(state.cookbook.entries['cheese-toast']).toMatchObject({ owned: true, paidPortions: 15, perk: 'appeal' });
    expect(state.restaurant.funds).toBe(funds);
  });

  it('does not resolve an authored menu record until its cookbook entry is owned', () => {
    const state = fixture();
    state.cookbook = { ...state.cookbook,
      entries: { ...state.cookbook.entries, 'cheese-toast': {
        ...state.cookbook.entries['cheese-toast'], discovered: true,
      } },
    };
    const cheese = { id: 'cookbook:cheese-toast', cookbookId: 'cheese-toast', name: 'Cheese Toast',
      base: 'Cheese', method: 'Toasted', cuisine: 'generic', requiredEquipmentId: 'eq1',
      price: 14, quality: 1, prepTime: 90, popularity: 65, unlocked: true };
    state.dishes.push(cheese);
    expect(getResolvedDish(state, cheese.id)).toBeNull();
    state.cookbook.entries['cheese-toast'].owned = true;
    const resolved = getResolvedDish(state, cheese.id);
    expect(resolved).toMatchObject({ id: cheese.id, cookbookId: 'cheese-toast', name: 'Cheese Toast' });
    expect(resolved).not.toHaveProperty('purchaseCost');
    expect(resolved).not.toHaveProperty('requirements');
  });
});

describe('Blender recipe', () => {
  function blenderFixture() {
    const state = fixture();
    state.equipment = [...state.equipment, { id: 'eq4', owned: true }];
    state.cookbook = reconcileCookbookDiscoveries(state);
    return state;
  }

  it('constructs schema 3 with undiscovered default Oven and Blender recipe entries', () => {
    const cookbook = createCookbookState(3);
    expect(cookbook).toMatchObject({ schemaVersion: 3, lastAppliedPaidVisitSequence: 3 });
    expect(Object.keys(cookbook.entries)).toHaveLength(9);
    expect(cookbook.entries.gazpacho).toEqual({ discovered: false, owned: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Gazpacho', price: 16, quality: 1 } });
    expect(cookbook.entries['fish-bisque']).toEqual({ discovered: false, owned: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Fish Bisque', price: 20, quality: 1 } });
    expect(cookbook.entries['baked-eggs']).toEqual({ discovered: false, owned: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Baked Eggs', price: 15, quality: 1 } });
    expect(() => validateCookbookState({ ...fixture(), cookbook, paidVisitSequence: 3 })).not.toThrow();
  });

  it('discovers Gazpacho from owning the Blender, without requiring a placed station', () => {
    const state = blenderFixture();
    expect(getCookbookEntryStatus(state, 'gazpacho')).toMatchObject({
      discovered: true, owned: false, equipmentOwned: true, stationAvailable: false,
      canBuy: true, canAdd: false,
    });
  });

  it('does not discover or add Gazpacho without the Blender', () => {
    const state = fixture();
    expect(getCookbookEntryStatus(state, 'gazpacho')).toMatchObject({
      discovered: false, equipmentOwned: false, canAdd: false,
    });
    expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'gazpacho' })).toBe(state);
  });

  it('adds Gazpacho explicitly, guards duplicates and retains settings through removal', () => {
    let state = addCookbookDish(blenderFixture(), 'gazpacho');
    expect(state.dishes.at(-1)).toMatchObject({ id: 'cookbook:gazpacho', cookbookId: 'gazpacho',
      name: 'Gazpacho', base: 'Vegetables', method: 'Blended', requiredEquipmentId: 'eq4',
      cuisine: 'generic', price: 16, quality: 1, prepTime: 75, popularity: 55, unlocked: true });
    expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'gazpacho' })).toBe(state);
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'cookbook:gazpacho',
      changes: { name: 'House Gazpacho', price: 21 } });
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'cookbook:gazpacho' });
    expect(state.dishes.some(candidate => candidate.cookbookId === 'gazpacho')).toBe(false);
    state = reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'gazpacho' });
    expect(getResolvedDish(state, 'cookbook:gazpacho')).toMatchObject({ name: 'House Gazpacho', price: 20 });
  });

  it('offers speed 64 seconds or appeal 65 popularity at 15 paid Gazpacho portions', () => {
    let state = addCookbookDish(blenderFixture(), 'gazpacho');
    state = pay(state, 15, 'gazpacho');
    expect(getCookbookEntryStatus(state, 'gazpacho')).toMatchObject({ paidPortions: 15, canChoosePerk: true });
    const speed = reduceCookbookAction(state, { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'gazpacho', perk: 'speed' });
    expect(getResolvedDish(speed, 'cookbook:gazpacho')).toMatchObject({ prepTime: 64, popularity: 55 });
    const appeal = reduceCookbookAction(state, { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'gazpacho', perk: 'appeal' });
    expect(getResolvedDish(appeal, 'cookbook:gazpacho')).toMatchObject({ prepTime: 75, popularity: 65 });
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
  it('preserves paid entitlement, renamed settings, upgrades and mastery through removal and re-add', () => {
    let state = reduceCookbookAction(pay(fixture(), 15), { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'speed' });
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: {
      name: '  House Toast  ', price: 23.6, quality: 10, prepTime: 1, popularity: 100,
      cookbookId: 'fries', id: 'fake', method: 'Fried', masteryPerk: 'appeal',
    } });
    state = reduceCookbookAction(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast', cost: 0, quality: 10 });
    expect(state.restaurant.funds).toBe(550);
    expect(state.dishes[0]).toMatchObject({ id: 'starter-toast', cookbookId: 'toast', name: 'House Toast', price: 15, quality: 2, prepTime: 60, method: 'Toasted' });
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'starter-toast' });
    expect(state.dishes).toEqual([]);
    state = { ...state, ...normaliseCookbookState(state, { legacy: false, lastPaidVisitSequence: 15 }) };
    state = reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast', id: 'fake', quality: 10 });
    expect(getResolvedDish(state, 'cookbook:toast')).toMatchObject({ name: 'House Toast', price: 15, quality: 2, prepTime: 51 });
    expect(state.cookbook.entries.toast).toMatchObject({ paidPortions: 15, perk: 'speed' });
    expect(reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' })).toBe(state);
    expect(state.restaurant.funds).toBe(550);
  });

  it('keeps the active menu settings through cookbook removal and re-add', () => {
    let state = reduceCookbookAction(fixture(), { type: 'UPDATE_DISH', id: 'starter-toast',
      changes: { name: 'House Toast', price: 27 } });
    state = reduceCookbookAction(state, { type: 'REMOVE_DISH', id: 'starter-toast' });
    expect(state.dishes).toEqual([]);
    state = reduceCookbookAction(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' });
    expect(getResolvedDish(state, 'cookbook:toast')).toMatchObject({ name: 'House Toast', price: 15 });
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
    expect(getResolvedDish(state, 'custom-0')).toBeNull();
    for (const type of ['ADD_DISH', 'UPDATE_DISH', 'REMOVE_DISH', 'UPGRADE_DISH_QUALITY']) {
      expect(reduceCookbookAction(state, { type, id: 'custom-0' })).toBe(state);
    }
    expect(reduceCookbookAction(state, { type: 'UNKNOWN' })).toBeNull();
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
    expect(state.dishes[0].price).toBe(15);
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: -1 } });
    expect(state.dishes[0].price).toBe(9);
    for (let i = 0; i < 9; i += 1) state = reduceCookbookAction(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' });
    expect(state.dishes[0].quality).toBe(10);
    state = reduceCookbookAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 1000 } });
    expect(state.dishes[0].price).toBe(25);
    expect(state.restaurant.funds).toBe(150);
    expect(reduceCookbookAction(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' })).toBe(state);
    const poor = { ...fixture(), restaurant: { funds: 49 } };
    expect(reduceCookbookAction(poor, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' })).toBe(poor);
  });

  it('pins the cookbook quality cost boundary, cap and forged cost', () => {
    const exact = { ...fixture(), restaurant: { funds: 50 } };
    const upgraded = reduceCookbookAction(exact, {
      type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast', cost: 1,
    });
    expect(upgraded.restaurant.funds).toBe(0);
    expect(upgraded.dishes[0].quality).toBe(2);
    expect(upgraded.cookbook.entries.toast.menuSettings.quality).toBe(2);

    const short = { ...fixture(), restaurant: { funds: 49.99 } };
    expect(reduceCookbookAction(short, {
      type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast', cost: -50,
    })).toBe(short);

    const base = fixture();
    const capped = {
      ...base,
      dishes: [{ ...base.dishes[0], quality: 10 }],
      cookbook: {
        ...base.cookbook,
        entries: {
          ...base.cookbook.entries,
          toast: {
            ...base.cookbook.entries.toast,
            menuSettings: { ...base.cookbook.entries.toast.menuSettings, quality: 10 },
          },
        },
      },
      restaurant: { funds: 50 },
    };
    expect(reduceCookbookAction(capped, {
      type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast',
    })).toBe(capped);
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

  it('authored snapshots preserve committed stats and validate price using their own quality', () => {
    const state = fixture();
    let upgraded = reduceCookbookAction(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' });
    upgraded = reduceCookbookAction(upgraded, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 16 } });
    const snapshot = createDishOrderSnapshot(getResolvedDish(upgraded, 'starter-toast'), { serviceItemId: 'i1', orderedAt: 36000 });
    expect(snapshot).toMatchObject({ cookbookId: 'toast', masteryPerk: null, quality: 2, price: 16 });
    expect(() => validateDishOrderSnapshot(snapshot)).not.toThrow();
    expect(() => validateDishOrderSnapshot({ ...snapshot, price: 17 })).toThrow();
    expect(() => validateDishOrderSnapshot({ ...snapshot, quality: 1 })).toThrow();
    expect(() => validateDishOrderSnapshot({ ...snapshot, cookbookId: 'custom' })).toThrow();
    expect(() => validateDishOrderSnapshot({ ...snapshot, cookbookId: null })).toThrow();
  });

  it('resolves a committed authored dish snapshot after the dish is removed from the menu', () => {
    const state = fixture();
    const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'i1', orderedAt: 36000 });
    const removed = { ...state, dishes: [] };
    expect(removed.dishes).toEqual([]);
    expect(getDishForServiceItem(removed, { id: 'i1', kind: 'dish', menuItemId: 'starter-toast',
      dishOrderSnapshot: snapshot })).toMatchObject({ id: 'starter-toast', cookbookId: 'toast', masteryPerk: null,
      name: 'Toasted Bread', price: 12, quality: 1, prepTime: 60, popularity: 50 });
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

  it('does not resolve a partial legacy dish without an immutable snapshot', () => {
    const state = reduceCookbookAction(pay(fixture(), 15), { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'speed' });
    expect(getDishForServiceItem(state, { kind: 'dish', menuItemId: 'starter-toast' })).toBeNull();
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
  it('does not adopt missing legacy cookbook data', () => {
    const state = fixture();
    delete state.cookbook;
    delete state.dishes[0].cookbookId;
    Object.assign(state.dishes[0], { name: 'My Toast', price: 22, quality: 4 });
    expect(() => validateCookbookState(state)).toThrow();
    expect(() => normaliseCookbookState(freeze(state), { legacy: true, lastPaidVisitSequence: 9 })).toThrow();
  });

  it('does not fill in a missing cookbook, even if no menu dishes remain', () => {
    const state = fixture();
    delete state.cookbook;
    expect(() => normaliseCookbookState(state, { legacy: true })).toThrow();
    expect(() => normaliseCookbookState({ ...state, dishes: [] }, { legacy: true })).toThrow();
  });

  it('rejects absent, null or partially present cookbook data', () => {
    expect(() => validateCookbookState({ dishes: [] })).toThrow();
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
    state => { delete state.cookbook.entries.gazpacho; },
    state => { state.cookbook.entries.fake = state.cookbook.entries.toast; },
    state => { state.cookbook.entries.toast.paidPortions = -1; },
    state => { state.cookbook.entries.toast.paidPortions = 16; },
    state => { state.cookbook.entries.toast.paidPortions = NaN; },
    state => { state.cookbook.entries.toast.perk = 'speed'; },
    state => { state.cookbook.entries.toast.perk = 'fake'; },
    state => { state.cookbook.entries.toast.discovered = false; },
    state => { state.cookbook.entries.toast.owned = false; },
    state => { delete state.cookbook.entries.toast.owned; },
    state => { state.cookbook.entries.toast.owned = 'yes'; },
    state => { state.cookbook.lastAppliedPaidVisitSequence = 1; },
    state => { state.cookbook.entries.toast.menuSettings.price = 0; },
    state => { state.cookbook.entries.toast.menuSettings.name = ' '; },
    state => { state.cookbook.entries.fries.paidPortions = 1; },
    state => { state.cookbook.entries.fries.perk = 'speed'; },
    state => { state.cookbook.entries.fries.owned = true; },
    state => { state.dishes.push({ ...state.dishes[0], id: 'duplicate' }); },
    state => { state.dishes.push({ ...state.dishes[0], id: 'custom', cookbookId: null }); },
    state => { state.dishes.push({ ...state.dishes[0], id: 'duplicate-id' }); state.dishes.push({ ...state.dishes[0], id: 'duplicate-id' }); },
    state => { state.dishes[0].cookbookId = 'fake'; },
    state => { state.dishes[0].price = 30; },
    state => { state.cookbook.entries.toast.menuSettings.price = 16; },
    state => { state.dishes[0].prepTime = 51; },
    state => { state.dishes[0].method = 'Fried'; },
  ])('rejects corrupt canonical state %#', corrupt => {
    const state = fixture();
    corrupt(state);
    expect(() => validateCookbookState(state)).toThrow();
  });
});
