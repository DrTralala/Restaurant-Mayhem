import { describe, expect, it } from 'vitest';
import {
  buildAffordableBaskets,
  chooseAffordableBasket,
  createSpendingProfile,
  estimateMenuItemDemand,
  getBasketWeight,
  getSpendingTierProbabilities,
  hasValidSpendingProfile,
  normaliseCustomerEconomy,
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
