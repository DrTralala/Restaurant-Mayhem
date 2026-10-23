import { describe, expect, it, vi } from 'vitest';
import {
  buildAffordableBaskets,
  chooseAffordableBasket,
  createSpendingProfile,
  estimateMenuDemand,
  estimateMenuItemDemand,
  getBasketWeight,
  getMenuAffordabilitySummary,
  getSpendingTierProbabilities,
  hasAvailableWalkInMenu,
  hasValidSpendingProfile,
  isMenuItemSuspended,
  normaliseCustomerEconomy,
  SPENDING_TIER_RANGES,
} from './menuEconomy';

describe('customer spending profiles', () => {
  it.each([
    [1, { budget: 0.70, value: 0.25, premium: 0.05 }],
    [3, { budget: 0.425, value: 0.30, premium: 0.275 }],
    [5, { budget: 0.15, value: 0.35, premium: 0.50 }],
  ])('uses the approved tier mix at rating %s', (rating, expected) => {
    expect(getSpendingTierProbabilities(rating)).toEqual(expected);
  });

  it('clamps malformed ratings and always sums to one', () => {
    for (const rating of [Number.NaN, -20, 2.5, 99]) {
      const probabilities = getSpendingTierProbabilities(rating);
      expect(Object.values(probabilities).reduce((sum, value) => sum + value, 0))
        .toBeCloseTo(1);
      expect(Object.values(probabilities).every(value => value >= 0 && value <= 1)).toBe(true);
    }
  });

  it.each([
    [1, [0, 0], { spendingTier: 'budget', spendingBudget: 6 }],
    [1, [0.699999, 0.999999], { spendingTier: 'budget', spendingBudget: 18 }],
    [1, [0.70, 0], { spendingTier: 'value', spendingBudget: 15 }],
    [5, [0.999999, 0.999999], { spendingTier: 'premium', spendingBudget: 120 }],
  ])('maps rating %s and rolls %j to a bounded profile', (rating, rolls, expected) => {
    const values = [...rolls];
    expect(createSpendingProfile(rating, () => values.shift())).toEqual(expected);
  });

  it('recognises only matching tier ranges as valid profiles', () => {
    expect(hasValidSpendingProfile({ spendingTier: 'budget', spendingBudget: 18 })).toBe(true);
    expect(hasValidSpendingProfile({ spendingTier: 'budget', spendingBudget: 19 })).toBe(false);
    expect(hasValidSpendingProfile({ spendingTier: 'premium', spendingBudget: 35.5 })).toBe(false);
  });

  it('bounds malformed random rolls without throwing', () => {
    const lowRolls = [Number.NaN, Number.NEGATIVE_INFINITY];
    expect(createSpendingProfile(1, () => lowRolls.shift())).toEqual({
      spendingTier: 'budget', spendingBudget: 6,
    });
    const highRolls = [Number.POSITIVE_INFINITY, 4];
    expect(createSpendingProfile(5, () => highRolls.shift())).toEqual({
      spendingTier: 'budget', spendingBudget: 18,
    });
  });

  it('preserves valid customer economy data and removes invalid fields', () => {
    const valid = {
      id: 'valid', spendingTier: 'value', spendingBudget: 30,
      menuOutcome: 'ordered', dishPriceAtOrder: 12, drinkPriceAtOrder: null,
      orderSubtotal: 12,
    };
    expect(normaliseCustomerEconomy(valid)).toEqual(valid);

    expect(normaliseCustomerEconomy({
      id: 'waiting', menuOutcome: 'unaffordable', dishPriceAtOrder: 9,
    })).toEqual({
      id: 'waiting', menuOutcome: 'unaffordable', dishPriceAtOrder: null,
      drinkPriceAtOrder: null, orderSubtotal: null,
    });

    const invalid = normaliseCustomerEconomy({
      id: 'invalid', spendingTier: 'budget', spendingBudget: 99,
      menuOutcome: 'forged', dishPriceAtOrder: 1,
      drinkPriceAtOrder: 2, orderSubtotal: 3,
    });
    expect(invalid).toEqual({ id: 'invalid' });
  });

  it('clears an inconsistent ordered price tuple atomically while retaining its outcome', () => {
    const normalised = normaliseCustomerEconomy({
      id: 'malformed', menuOutcome: 'ordered',
      dishPriceAtOrder: 8, drinkPriceAtOrder: 3, orderSubtotal: 40,
    });

    expect(normalised).toEqual({ id: 'malformed', menuOutcome: 'ordered' });
  });
});

const menuState = {
  restaurant: { reputation: 3 },
  dishes: [
    { id: 'cheap', price: 10, quality: 2, popularity: 50, prepTime: 120 },
    { id: 'premium', price: 40, quality: 9, popularity: 90, prepTime: 300 },
  ],
  unlockedDrinkIds: ['water', 'coffee'],
  drinkOverrides: {},
};

describe('affordable weighted menu selection', () => {
  it('builds only baskets within the whole customer budget', () => {
    const baskets = buildAffordableBaskets(menuState, {
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 12,
    });
    expect(baskets.map(basket => [basket.kind, basket.dish?.id, basket.drink?.id]))
      .toEqual([
        ['dish', 'cheap', undefined],
        ['drink', undefined, 'water'],
        ['drink', undefined, 'coffee'],
        ['dish_drink', 'cheap', 'water'],
      ]);
    expect(baskets.every(basket => basket.price <= 12)).toBe(true);
  });

  it('gives every affordable basket positive weight and honours archetype priorities', () => {
    const cheap = { price: 10, quality: 0.2, popularity: 0.2, speed: 0.8 };
    const acclaimed = { price: 10, quality: 0.9, popularity: 0.9, speed: 0.2 };
    const fast = { price: 10, quality: 0.2, popularity: 0.2, speed: 0.95 };
    const profile = { spendingTier: 'value', spendingBudget: 30 };
    expect(getBasketWeight(cheap, { ...profile, archetype: 'regular' })).toBeGreaterThan(0);
    expect(getBasketWeight(acclaimed, { ...profile, archetype: 'foodie' }))
      .toBeGreaterThan(getBasketWeight(cheap, { ...profile, archetype: 'foodie' }));
    expect(getBasketWeight(fast, { ...profile, archetype: 'rusher' }))
      .toBeGreaterThan(getBasketWeight(acclaimed, { ...profile, archetype: 'rusher' }));
    expect(getBasketWeight(acclaimed, { ...profile, archetype: 'influencer' }))
      .toBeGreaterThan(getBasketWeight(cheap, { ...profile, archetype: 'influencer' }));
  });

  it('renormalises kinds and uses the second roll for weighted choice', () => {
    const customer = {
      id: 'c1', archetype: 'regular', spendingTier: 'value', spendingBudget: 45,
    };
    const first = chooseAffordableBasket(menuState, customer, (() => {
      const rolls = [0, 0];
      return () => rolls.shift();
    })());
    const later = chooseAffordableBasket(menuState, customer, (() => {
      const rolls = [0, 0.999999];
      return () => rolls.shift();
    })());
    expect(first.basket.kind).toBe('dish');
    expect(later.basket.kind).toBe('dish');
    expect(new Set([first.basket.dish.id, later.basket.dish.id]).size).toBeGreaterThan(1);
  });

  it('renormalises base kind weights after combined baskets become unaffordable', () => {
    const result = chooseAffordableBasket(menuState, {
      id: 'c1', archetype: 'regular', spendingTier: 'budget', spendingBudget: 11,
    }, (() => {
      const rolls = [0.94, 0];
      return () => rolls.shift();
    })());
    expect(result.basket.kind).toBe('drink');
    expect(result.basket.drink.id).toBe('water');
  });

  it('weights the equal-price Iced Tea trade-off by archetype', () => {
    const teaState = {
      restaurant: { reputation: 3 },
      dishes: [],
      unlockedDrinkIds: ['tea', 'iced-tea'],
      drinkOverrides: {},
    };
    const customer = { spendingTier: 'value', spendingBudget: 45 };
    const baskets = buildAffordableBaskets(teaState, customer);
    const icedTea = baskets.find(basket => basket.drink?.id === 'iced-tea');
    const tea = baskets.find(basket => basket.drink?.id === 'tea');

    expect(icedTea).toBeDefined();
    expect(tea).toBeDefined();
    expect([icedTea.price, tea.price]).toEqual([4, 4]);
    expect(icedTea.quality).toBe(tea.quality);
    expect(getBasketWeight(icedTea, { ...customer, archetype: 'rusher' }))
      .toBeGreaterThan(getBasketWeight(tea, { ...customer, archetype: 'rusher' }));
    expect(getBasketWeight(tea, { ...customer, archetype: 'influencer' }))
      .toBeGreaterThan(getBasketWeight(icedTea, { ...customer, archetype: 'influencer' }));
  });

  it('excludes locked Iced Tea from affordable baskets until it is unlocked', () => {
    const locked = {
      restaurant: { reputation: 3 }, dishes: [], unlockedDrinkIds: ['tea'], drinkOverrides: {},
    };
    const budget = { spendingTier: 'value', spendingBudget: 45 };
    expect(buildAffordableBaskets(locked, budget)
      .some(basket => basket.drink?.id === 'iced-tea')).toBe(false);
    const unlocked = { ...locked, unlockedDrinkIds: ['tea', 'iced-tea'] };
    expect(buildAffordableBaskets(unlocked, budget)
      .some(basket => basket.drink?.id === 'iced-tea')).toBe(true);
  });

  it('returns null only when no basket is affordable', () => {
    const result = chooseAffordableBasket({
      ...menuState,
      dishes: [{ ...menuState.dishes[0], price: 100 }],
      drinkOverrides: { water: { price: 100 }, coffee: { price: 100 } },
    }, { archetype: 'regular', spendingTier: 'budget', spendingBudget: 6 }, () => 0);
    expect(result.basket).toBeNull();
  });
});

describe('estimated menu demand', () => {
  it('never increases when only price rises and decreases under competing affordability', () => {
    const low = estimateMenuItemDemand(menuState, 'dish', 'cheap');
    const high = estimateMenuItemDemand({
      ...menuState,
      dishes: menuState.dishes.map(dish => dish.id === 'cheap' ? { ...dish, price: 35 } : dish),
    }, 'dish', 'cheap');
    expect(high).toBeLessThan(low);
  });

  it('retains demand for a cheap item at five stars', () => {
    expect(estimateMenuItemDemand({
      ...menuState, restaurant: { reputation: 5 },
    }, 'dish', 'cheap')).toBeGreaterThan(0);
  });

  it('makes the expensive dish more viable as rating attracts higher budgets', () => {
    const oneStar = estimateMenuItemDemand({
      ...menuState, restaurant: { reputation: 1 },
    }, 'dish', 'premium');
    const fiveStars = estimateMenuItemDemand({
      ...menuState, restaurant: { reputation: 5 },
    }, 'dish', 'premium');
    expect(fiveStars).toBeGreaterThan(oneStar);
  });

  it('allows quality to improve demand without changing affordability', () => {
    const low = estimateMenuItemDemand(menuState, 'dish', 'cheap');
    const high = estimateMenuItemDemand({
      ...menuState,
      dishes: menuState.dishes.map(dish => dish.id === 'cheap'
        ? { ...dish, quality: 10 }
        : dish),
    }, 'dish', 'cheap');
    expect(high).toBeGreaterThan(low);
  });

  it('returns zero for unknown or locked items without mutating state', () => {
    const before = structuredClone(menuState);
    expect(estimateMenuItemDemand(menuState, 'drink', 'tea')).toBe(0);
    expect(estimateMenuItemDemand(menuState, 'dish', 'missing')).toBe(0);
    expect(menuState).toEqual(before);
  });
});

const singleDishState = (price, reputation = 1) => ({
  restaurant: { reputation },
  dishes: [{ id: 'test', name: 'Test', price, quality: 1, popularity: 50, prepTime: 60 }],
  unlockedDrinkIds: [],
});

describe('menu affordability summary', () => {
  it('weights dish coverage by each tier probability over its integer budgets', () => {
    const { dishShare, anyOrderShare } = getMenuAffordabilitySummary(singleDishState(19));
    expect(dishShare).toBeCloseTo(0.25 * 27 / 31 + 0.05, 12);
    expect(anyOrderShare).toBeCloseTo(0.25 * 27 / 31 + 0.05, 12);
  });

  it('reports zero coverage for an empty menu and ignores off-menu recipes', () => {
    expect(getMenuAffordabilitySummary({
      restaurant: { reputation: 1 }, dishes: [], unlockedDrinkIds: [],
    })).toEqual({ dishShare: 0, anyOrderShare: 0 });

    const offMenu = {
      ...singleDishState(19),
      cookbook: {
        schemaVersion: 2,
        lastAppliedPaidVisitSequence: 0,
        entries: {
          gazpacho: {
            discovered: true, paidPortions: 0, perk: null,
            menuSettings: { name: 'Gazpacho', price: 6, quality: 1 },
          },
        },
      },
    };
    expect(getMenuAffordabilitySummary(offMenu).dishShare).toBeCloseTo(0.25 * 27 / 31 + 0.05, 12);
    expect(getMenuAffordabilitySummary(offMenu).anyOrderShare).toBeCloseTo(0.25 * 27 / 31 + 0.05, 12);
  });

  it('counts unlocked and repriced drinks but never locked ones', () => {
    const drinksOnly = {
      restaurant: { reputation: 1 }, dishes: [], unlockedDrinkIds: ['water'],
      drinkOverrides: { water: { price: 6 } },
    };
    expect(getMenuAffordabilitySummary(drinksOnly)).toEqual({ dishShare: 0, anyOrderShare: 1 });

    expect(getMenuAffordabilitySummary({
      restaurant: { reputation: 1 }, dishes: [], unlockedDrinkIds: ['water'], drinkOverrides: {},
    }).anyOrderShare).toBeCloseTo(1, 12);

    expect(getMenuAffordabilitySummary({
      restaurant: { reputation: 1 }, dishes: [], unlockedDrinkIds: [],
    })).toEqual({ dishShare: 0, anyOrderShare: 0 });

    const repriced = getMenuAffordabilitySummary({
      ...drinksOnly, drinkOverrides: { water: { price: 100 } },
    });
    expect(repriced.dishShare).toBe(0);
    expect(repriced.anyOrderShare).toBeCloseTo(0.05 * 21 / 86, 12);

    const boundary = getMenuAffordabilitySummary({
      ...drinksOnly, drinkOverrides: { water: { price: 18 } },
    });
    expect(boundary.anyOrderShare).toBeCloseTo(0.70 / 13 + 0.25 * 28 / 31 + 0.05, 12);
  });

  it.each([
    [5.5, 1],
    [6, 1],
    [15, 0.70 * 4 / 13 + 0.25 + 0.05],
    [18, 0.70 / 13 + 0.25 * 28 / 31 + 0.05],
    [18.5, 0.25 * 27 / 31 + 0.05],
    [35, 0.25 * 11 / 31 + 0.05],
    [45, 0.25 / 31 + 0.05 * 76 / 86],
    [45.5, 0.05 * 75 / 86],
    [120, 0.05 / 86],
    [120.5, 0],
  ])('counts inclusive integer budgets for a $%s dish', (price, expected) => {
    const { dishShare, anyOrderShare } = getMenuAffordabilitySummary(singleDishState(price));
    expect(dishShare).toBeCloseTo(expected, 12);
    expect(anyOrderShare).toBeCloseTo(expected, 12);
  });

  it('reweights coverage when reputation rises and clamps out-of-range values', () => {
    const oneStar = getMenuAffordabilitySummary(singleDishState(19, 1)).dishShare;
    const fiveStar = getMenuAffordabilitySummary(singleDishState(19, 5)).dishShare;
    expect(oneStar).toBeCloseTo(0.25 * 27 / 31 + 0.05, 12);
    expect(fiveStar).toBeCloseTo(0.35 * 27 / 31 + 0.5, 12);
    expect(fiveStar).toBeGreaterThan(oneStar);
    expect(getMenuAffordabilitySummary(singleDishState(19, 9)).dishShare).toBeCloseTo(fiveStar, 12);
  });

  it.each([1, 2, 3, 4, 5])('returns the exact one endpoint when every budget is covered at reputation %s', reputation => {
    const { dishShare, anyOrderShare } = getMenuAffordabilitySummary(singleDishState(6, reputation));
    expect(dishShare).toBe(1);
    expect(anyOrderShare).toBe(1);
  });

  it('returns the exact one endpoint for universal drink-only coverage at reputation 3', () => {
    expect(getMenuAffordabilitySummary({
      restaurant: { reputation: 3 }, dishes: [], unlockedDrinkIds: ['water'], drinkOverrides: {},
    })).toEqual({ dishShare: 0, anyOrderShare: 1 });
  });

  it('resolves cookbook dish menu settings instead of the raw stored price', () => {
    const state = {
      restaurant: { reputation: 1 },
      dishes: [{
        id: 'cookbook:toast', cookbookId: 'toast', name: 'Toasted Bread', base: 'Bread',
        method: 'Toasted', requiredEquipmentId: 'eq1', price: 100, quality: 1, popularity: 50, prepTime: 60,
      }],
      cookbook: {
        schemaVersion: 2, lastAppliedPaidVisitSequence: 0,
        entries: {
          toast: {
            discovered: true, paidPortions: 0, perk: null,
            menuSettings: { name: 'Toasted Bread', price: 12, quality: 1 },
          },
        },
      },
      unlockedDrinkIds: [],
    };
    const { dishShare, anyOrderShare } = getMenuAffordabilitySummary(state);
    expect(dishShare).toBeCloseTo(0.70 * 7 / 13 + 0.25 + 0.05, 12);
    expect(anyOrderShare).toBeCloseTo(0.70 * 7 / 13 + 0.25 + 0.05, 12);
  });

  it('never increases coverage as prices rise and keeps dish share within any-order share', () => {
    for (const reputation of [1, 3, 5]) {
      const shares = [5.5, 6, 18, 18.5, 35, 45, 45.5, 120, 120.5]
        .map(price => getMenuAffordabilitySummary(singleDishState(price, reputation)));
      shares.forEach((share, index) => {
        expect(share.dishShare).toBeLessThanOrEqual(share.anyOrderShare);
        if (index > 0) {
          expect(share.dishShare).toBeLessThanOrEqual(shares[index - 1].dishShare);
          expect(share.anyOrderShare).toBeLessThanOrEqual(shares[index - 1].anyOrderShare);
        }
      });
    }
  });

  it('leaves frozen input untouched and consumes no randomness', () => {
    const state = {
      restaurant: Object.freeze({ reputation: 3 }),
      dishes: Object.freeze([Object.freeze({
        id: 'test', name: 'Test', price: 19, quality: 1, popularity: 50, prepTime: 60,
      })]),
      unlockedDrinkIds: Object.freeze(['water']),
      drinkOverrides: Object.freeze({ water: Object.freeze({ price: 8 }) }),
    };
    const before = structuredClone(state);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('menu affordability must not consume randomness');
    });
    try {
      const first = getMenuAffordabilitySummary(state);
      expect(first.anyOrderShare).toBeCloseTo(0.425 * 11 / 13 + 0.30 + 0.275, 12);
      expect(first.dishShare).toBeCloseTo(0.30 * 27 / 31 + 0.275, 12);
      expect(getMenuAffordabilitySummary(state)).toEqual(first);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
    expect(state).toEqual(before);
  });
});

// Independent oracle: re-derives marginal item demand from the public basket
// builder and weighting primitive using literal kind weights and the live
// six-entry archetype list, without touching the batch implementation.
const REFERENCE_KIND_WEIGHTS = Object.freeze({ dish: 0.75, dish_drink: 0.20, drink: 0.05 });
const REFERENCE_ARCHETYPES = Object.freeze([
  'regular', 'regular', 'regular', 'foodie', 'rusher', 'influencer',
]);

function referenceMenuDemand(state) {
  const tierMix = getSpendingTierProbabilities(state?.restaurant?.reputation);
  const totals = new Map();
  const add = (key, probability) => totals.set(key, (totals.get(key) || 0) + probability);
  for (const [tier, [minimum, maximum]] of Object.entries(SPENDING_TIER_RANGES)) {
    const rangeSize = maximum - minimum + 1;
    for (let budget = minimum; budget <= maximum; budget += 1) {
      for (const archetype of REFERENCE_ARCHETYPES) {
        const customer = { spendingTier: tier, spendingBudget: budget, archetype };
        const groups = { dish: [], dish_drink: [], drink: [] };
        for (const basket of buildAffordableBaskets(state, customer)) groups[basket.kind].push(basket);
        const kinds = ['dish', 'dish_drink', 'drink'].filter(kind => groups[kind].length > 0);
        const kindWeightTotal = kinds.reduce((sum, kind) => sum + REFERENCE_KIND_WEIGHTS[kind], 0);
        for (const kind of kinds) {
          const group = groups[kind];
          const weights = group.map(basket => getBasketWeight(basket, customer));
          const basketWeightTotal = weights.reduce((sum, weight) => sum + weight, 0);
          if (!(basketWeightTotal > 0)) continue;
          const share = tierMix[tier] / rangeSize / REFERENCE_ARCHETYPES.length
            * REFERENCE_KIND_WEIGHTS[kind] / kindWeightTotal;
          group.forEach((basket, index) => {
            const probability = share * weights[index] / basketWeightTotal;
            if (basket.dish) add(`dish:${basket.dish.id}`, probability);
            if (basket.drink) add(`drink:${basket.drink.id}`, probability);
          });
        }
      }
    }
  }
  const rounded = prefix => new Map([...totals]
    .filter(([key]) => key.startsWith(`${prefix}:`))
    .map(([key, probability]) => [
      key.slice(prefix.length + 1),
      Math.round(Math.min(1, Math.max(0, probability)) * 100),
    ]));
  return { dishes: rounded('dish'), drinks: rounded('drink') };
}

const competingMenuState = reputation => ({
  restaurant: { reputation },
  dishes: [
    { id: 'floor', name: 'Floor', price: 6, quality: 2, popularity: 35, prepTime: 45 },
    { id: 'value-edge', name: 'Value Edge', price: 15, quality: 4, popularity: 55, prepTime: 90 },
    { id: 'premium-edge', name: 'Premium Edge', price: 35, quality: 6, popularity: 65, prepTime: 180 },
    { id: 'value-cap', name: 'Value Cap', price: 45, quality: 8, popularity: 75, prepTime: 240 },
    { id: 'ceiling', name: 'Ceiling', price: 120, quality: 10, popularity: 90, prepTime: 420 },
  ],
  unlockedDrinkIds: ['water', 'tea', 'iced-tea'],
  drinkOverrides: { tea: { price: 18 } },
});

describe('batch menu demand', () => {
  it('weights every integer budget rather than five representative points', () => {
    expect(estimateMenuItemDemand(singleDishState(7), 'dish', 'test')).toBe(95);
  });

  it('renormalises combined baskets across every integer budget', () => {
    const state = { ...singleDishState(7), unlockedDrinkIds: ['water'] };
    const demand = estimateMenuDemand(state);
    const dishProbability = 0.7 * (2 * 0.75 / 0.8 + 10 * 0.95) / 13 + 0.3 * 0.95;
    const waterProbability = 0.7 * (1 + 2 * 0.05 / 0.8 + 10 * 0.25) / 13 + 0.3 * 0.25;
    expect(demand.dishes.get('test')).toBe(Math.round(100 * dishProbability));
    expect(demand.drinks.get('water')).toBe(Math.round(100 * waterProbability));
  });

  it.each([1, 3, 5])('matches the exhaustive reference at reputation %s', reputation => {
    const state = competingMenuState(reputation);
    expect(estimateMenuDemand(state)).toEqual(referenceMenuDemand(state));
  });

  it('matches the reference for exact tier boundary prices', () => {
    const state = {
      restaurant: { reputation: 1 },
      dishes: [6, 15, 18, 35, 45, 120].map(price => ({
        id: `dish-${price}`, name: `Dish ${price}`, price,
        quality: 5, popularity: 50, prepTime: 120,
      })),
      unlockedDrinkIds: [],
    };
    expect(estimateMenuDemand(state)).toEqual(referenceMenuDemand(state));
  });

  it('agrees between batch maps and the single-item wrapper', () => {
    const state = competingMenuState(3);
    const demand = estimateMenuDemand(state);
    for (const dish of state.dishes) {
      expect(estimateMenuItemDemand(state, 'dish', dish.id)).toBe(demand.dishes.get(dish.id) ?? 0);
    }
    for (const drinkId of state.unlockedDrinkIds) {
      expect(estimateMenuItemDemand(state, 'drink', drinkId)).toBe(demand.drinks.get(drinkId) ?? 0);
    }
    expect(estimateMenuItemDemand(state, 'dish', 'missing-dish')).toBe(0);
    expect(estimateMenuItemDemand(state, 'drink', 'coffee')).toBe(0);
    expect(estimateMenuItemDemand(state, 'side', 'floor')).toBe(0);
  });

  it('returns empty maps for an empty menu and an unaffordable menu', () => {
    const empty = { restaurant: { reputation: 3 }, dishes: [], unlockedDrinkIds: [], drinkOverrides: {} };
    const emptyDemand = estimateMenuDemand(empty);
    expect(emptyDemand.dishes.size).toBe(0);
    expect(emptyDemand.drinks.size).toBe(0);
    expect(estimateMenuItemDemand(empty, 'dish', 'anything')).toBe(0);
    expect(emptyDemand).toEqual(referenceMenuDemand(empty));

    const expensive = {
      restaurant: { reputation: 1 },
      dishes: [{
        id: 'expensive', name: 'Expensive', price: 150, quality: 5, popularity: 50, prepTime: 120,
      }],
      unlockedDrinkIds: [],
    };
    const expensiveDemand = estimateMenuDemand(expensive);
    expect(expensiveDemand.dishes.size).toBe(0);
    expect(estimateMenuItemDemand(expensive, 'dish', 'expensive')).toBe(0);
    expect(expensiveDemand).toEqual(referenceMenuDemand(expensive));
  });

  it('leaves frozen input untouched, is deterministic and consumes no randomness', () => {
    const frozenSource = competingMenuState(3);
    const state = {
      restaurant: Object.freeze({ reputation: 3 }),
      dishes: Object.freeze(frozenSource.dishes.map(dish => Object.freeze(dish))),
      unlockedDrinkIds: Object.freeze([...frozenSource.unlockedDrinkIds]),
      drinkOverrides: Object.freeze({ tea: Object.freeze({ price: 18 }) }),
    };
    const before = structuredClone(state);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('menu demand must not consume randomness');
    });
    try {
      const first = estimateMenuDemand(state);
      expect(estimateMenuDemand(state)).toEqual(first);
      expect(first).toEqual(referenceMenuDemand(state));
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
    expect(state).toEqual(before);
  });
});

const suspensionState = {
  restaurant: { reputation: 3, suspendedDishIds: ['cheap'], suspendedDrinkIds: ['coffee'] },
  dishes: menuState.dishes,
  unlockedDrinkIds: ['water', 'coffee'],
  drinkOverrides: {},
};
const walkInBudget = { archetype: 'regular', spendingTier: 'value', spendingBudget: 45 };
const basketShape = basket => [basket.kind, basket.dish?.id, basket.drink?.id];
const FULL_MENU_BASKETS = [
  ['dish', 'cheap', undefined],
  ['dish', 'premium', undefined],
  ['drink', undefined, 'water'],
  ['drink', undefined, 'coffee'],
  ['dish_drink', 'cheap', 'water'],
  ['dish_drink', 'cheap', 'coffee'],
  ['dish_drink', 'premium', 'water'],
];

describe('menu item suspension', () => {
  it('reports suspension per kind and treats absent lists as all active', () => {
    expect(isMenuItemSuspended(suspensionState, 'dish', 'cheap')).toBe(true);
    expect(isMenuItemSuspended(suspensionState, 'dish', 'premium')).toBe(false);
    expect(isMenuItemSuspended(suspensionState, 'drink', 'coffee')).toBe(true);
    expect(isMenuItemSuspended(suspensionState, 'drink', 'water')).toBe(false);
    expect(isMenuItemSuspended(menuState, 'dish', 'cheap')).toBe(false);
    expect(isMenuItemSuspended(menuState, 'drink', 'coffee')).toBe(false);
    expect(isMenuItemSuspended(undefined, 'dish', 'cheap')).toBe(false);
  });

  it('keeps kind-separated collisions apart and rejects unsupported kinds', () => {
    const collision = {
      restaurant: { suspendedDishIds: ['water'], suspendedDrinkIds: ['cheap'] },
      dishes: menuState.dishes,
      unlockedDrinkIds: ['water', 'coffee'],
      drinkOverrides: {},
    };
    expect(isMenuItemSuspended(collision, 'dish', 'water')).toBe(true);
    expect(isMenuItemSuspended(collision, 'drink', 'water')).toBe(false);
    expect(isMenuItemSuspended(collision, 'drink', 'cheap')).toBe(true);
    expect(isMenuItemSuspended(collision, 'dish', 'cheap')).toBe(false);
    expect(isMenuItemSuspended(collision, 'side', 'cheap')).toBe(false);
    expect(isMenuItemSuspended(collision, undefined, 'cheap')).toBe(false);
  });

  it('uses Array.isArray lists and exact includes without coercing IDs', () => {
    const malformed = {
      restaurant: { suspendedDishIds: 'cheap', suspendedDrinkIds: 7 },
      dishes: menuState.dishes,
      unlockedDrinkIds: ['water'],
      drinkOverrides: {},
    };
    expect(isMenuItemSuspended(malformed, 'dish', 'cheap')).toBe(false);
    expect(isMenuItemSuspended(malformed, 'drink', 'water')).toBe(false);
    const numeric = { restaurant: { suspendedDishIds: [1] } };
    expect(isMenuItemSuspended(numeric, 'dish', 1)).toBe(true);
    expect(isMenuItemSuspended(numeric, 'dish', '1')).toBe(false);
  });

  it('excludes a suspended dish and its combinations from walk-in baskets', () => {
    const baskets = buildAffordableBaskets(suspensionState, walkInBudget).map(basketShape);
    expect(baskets).toEqual([
      ['dish', 'premium', undefined],
      ['drink', undefined, 'water'],
      ['dish_drink', 'premium', 'water'],
    ]);
    expect(baskets.some(([, dishId]) => dishId === 'cheap')).toBe(false);
    expect(baskets.some(([, , drinkId]) => drinkId === 'coffee')).toBe(false);
  });

  it('excludes a suspended drink without affecting other drinks or dishes', () => {
    const state = {
      ...suspensionState,
      restaurant: { reputation: 3, suspendedDrinkIds: ['coffee'] },
    };
    expect(buildAffordableBaskets(state, walkInBudget).map(basketShape)).toEqual([
      ['dish', 'cheap', undefined],
      ['dish', 'premium', undefined],
      ['drink', undefined, 'water'],
      ['dish_drink', 'cheap', 'water'],
      ['dish_drink', 'premium', 'water'],
    ]);
  });

  it('bypasses exclusions only for a nonempty string contract ID', () => {
    const contract = buildAffordableBaskets(suspensionState, {
      ...walkInBudget, serviceContractId: 'contract-1',
    }).map(basketShape);
    expect(contract).toEqual(FULL_MENU_BASKETS);
    for (const serviceContractId of [undefined, '', null, 0]) {
      const walkIns = buildAffordableBaskets(suspensionState, {
        ...walkInBudget, serviceContractId,
      }).map(basketShape);
      expect(walkIns).not.toContainEqual(['dish', 'cheap', undefined]);
      expect(walkIns).not.toContainEqual(['drink', undefined, 'coffee']);
    }
  });

  it('preserves exact walk-in output and order for absent or empty lists without randomness', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('walk-in baskets must not consume randomness');
    });
    try {
      expect(buildAffordableBaskets(menuState, walkInBudget).map(basketShape))
        .toEqual(FULL_MENU_BASKETS);
      const emptyLists = {
        ...menuState,
        restaurant: { reputation: 3, suspendedDishIds: [], suspendedDrinkIds: [] },
      };
      expect(buildAffordableBaskets(emptyLists, walkInBudget).map(basketShape))
        .toEqual(buildAffordableBaskets(menuState, walkInBudget).map(basketShape));
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it('reflects exclusions in frozen demand and affordability without randomness', () => {
    const state = {
      restaurant: Object.freeze({
        reputation: 3,
        suspendedDishIds: Object.freeze(['cheap']),
        suspendedDrinkIds: Object.freeze(['water', 'coffee']),
      }),
      dishes: Object.freeze(menuState.dishes.map(dish => Object.freeze(dish))),
      unlockedDrinkIds: Object.freeze(['water', 'coffee']),
      drinkOverrides: Object.freeze({}),
    };
    const before = structuredClone(state);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('suspended menu analysis must not consume randomness');
    });
    try {
      expect(estimateMenuItemDemand(menuState, 'dish', 'cheap')).toBeGreaterThan(0);
      expect(estimateMenuItemDemand(state, 'dish', 'cheap')).toBe(0);
      const demand = estimateMenuDemand(state);
      expect(demand.dishes.get('cheap') ?? 0).toBe(0);
      expect(demand.drinks.size).toBe(0);
      const suspended = getMenuAffordabilitySummary(state);
      const active = getMenuAffordabilitySummary(menuState);
      expect(suspended.dishShare).toBeLessThan(active.dishShare);
      expect(suspended.anyOrderShare).toBeLessThan(active.anyOrderShare);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
    expect(state).toEqual(before);
  });

  it('yields no walk-in baskets and a null choice when every item is suspended', () => {
    const state = {
      restaurant: {
        reputation: 3,
        suspendedDishIds: ['cheap', 'premium'],
        suspendedDrinkIds: ['water', 'coffee'],
      },
      dishes: menuState.dishes,
      unlockedDrinkIds: ['water', 'coffee'],
      drinkOverrides: {},
    };
    expect(buildAffordableBaskets(state, walkInBudget)).toEqual([]);
    expect(chooseAffordableBasket(state, walkInBudget, () => 0)).toMatchObject({ basket: null });
    expect(hasAvailableWalkInMenu(state)).toBe(false);
    expect(hasAvailableWalkInMenu(menuState)).toBe(true);
    expect(chooseAffordableBasket(state, { ...walkInBudget, serviceContractId: 'contract-1' }, () => 0).basket)
      .not.toBeNull();
  });

  it('reports an active offering even when every walk-in basket is unaffordable', () => {
    const expensive = {
      restaurant: { reputation: 1 },
      dishes: [{ id: 'costly', price: 150, quality: 1, popularity: 50, prepTime: 60 }],
      unlockedDrinkIds: [],
    };
    expect(getMenuAffordabilitySummary(expensive).anyOrderShare).toBe(0);
    expect(hasAvailableWalkInMenu(expensive)).toBe(true);
    expect(hasAvailableWalkInMenu({
      ...expensive,
      restaurant: { reputation: 1, suspendedDishIds: ['costly'] },
    })).toBe(false);
  });
});
