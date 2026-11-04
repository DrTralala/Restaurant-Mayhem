import { describe, expect, it, vi } from 'vitest';
import {
  buildAffordableBaskets,
  chooseAffordableBasket,
  createSpendingProfile,
  estimateMenuDemand,
  estimateMenuItemDemand,
  getMenuAnalysis,
  getBasketWeight,
  getMenuAffordabilitySummary,
  getMenuItemSalesThreshold,
  getSpendingTierProbabilities,
  hasAvailableWalkInMenu,
  hasValidSpendingProfile,
  isMenuItemSalesThresholdReached,
  isMenuItemSuspended,
  normaliseCustomerEconomy,
  SPENDING_TIER_RANGES,
} from './menuEconomy';
import { getDishValueAcceptance } from './dishPricing';
import { createInitialState } from '../state/initialState';
import { reduceCookbookAction } from './cookbook';
import { withOwnedAuthoredDishes } from './menuTestFixtures';
import { COOKBOOK_RECIPES, getCookbookRecipe } from '../data/cookbook';

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
    expect(normaliseCustomerEconomy({
      id: 'poor-value', menuOutcome: 'poor_value', dishPriceAtOrder: 9,
      drinkPriceAtOrder: 2, orderSubtotal: 11,
    })).toEqual({
      id: 'poor-value', menuOutcome: 'poor_value', dishPriceAtOrder: null,
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

const menuState = withOwnedAuthoredDishes({
  restaurant: { reputation: 3 },
  dishes: [
    { id: 'cheap', cookbookId: 'fries', price: 10, quality: 2 },
    { id: 'premium', cookbookId: 'baked-potato', price: 40, quality: 10 },
  ],
  unlockedDrinkIds: ['water', 'coffee'],
  drinkOverrides: {},
});

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

  it.each([
    [0.5, 'dish'],
    [0.85, 'dish_drink'],
    [0.99, 'drink'],
  ])('keeps normal order-kind weights for a booked guest at roll %s', (kindRoll, kind) => {
    const rolls = [kindRoll, 0];
    const choice = chooseAffordableBasket(menuState, {
      id: 'booked-guest', archetype: 'regular', spendingTier: 'value', spendingBudget: 45,
      serviceContractId: 'sc-1',
    }, () => rolls.shift());

    expect(choice.basket.kind).toBe(kind);
    expect(rolls).toEqual([]);
  });

  it('renormalises only affordable kinds for a booked guest on a low budget', () => {
    const customer = {
      id: 'booked-guest', archetype: 'regular', spendingTier: 'budget', spendingBudget: 11,
      serviceContractId: 'sc-1',
    };
    const availableKinds = new Set(buildAffordableBaskets(menuState, customer).map(basket => basket.kind));
    const chooseAt = kindRoll => chooseAffordableBasket(menuState, customer, (() => {
      const rolls = [kindRoll, 0];
      return () => rolls.shift();
    })()).basket.kind;

    expect(availableKinds).toEqual(new Set(['dish', 'drink']));
    expect(chooseAt(0.93749)).toBe('dish');
    expect(chooseAt(0.9375)).toBe('drink');
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
      drinkOverrides: { water: { price: 100 }, coffee: { price: 100 } },
    }, { archetype: 'regular', spendingTier: 'budget', spendingBudget: 6 }, () => 0);
    expect(result.basket).toBeNull();
  });

  it('rejects the selected $15 toast at the value boundary without rerolling', () => {
    const initial = createInitialState();
    const state = reduceCookbookAction(initial, {
      type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 15 },
    });
    const rolls = [0, 0, 0.9];
    const result = chooseAffordableBasket(state, {
      id: 'guest', archetype: 'regular', spendingTier: 'budget', spendingBudget: 18,
    }, () => {
      const roll = rolls.shift();
      return roll;
    });

    expect(result).toMatchObject({ basket: null, menuOutcome: 'poor_value' });
    expect(rolls).toEqual([]);
    expect(getDishValueAcceptance(state.dishes[0], 'budget')).toBeCloseTo(0.64);
  });

  it.each([
    ['just below acceptance', 0.639999, 'ordered'],
    ['exactly acceptance', (12 / 15) ** 2, 'poor_value'],
    ['negative draw is bounded to zero', -1, 'ordered'],
    ['draw above one is bounded below one', 2, 'poor_value'],
    ['non-finite draw is bounded to zero', Number.NaN, 'ordered'],
  ])('uses a bounded acceptance draw (%s)', (_label, acceptanceRoll, menuOutcome) => {
    const initial = createInitialState();
    const state = reduceCookbookAction(initial, {
      type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 15 },
    });
    const rolls = [0, 0, acceptanceRoll];
    const result = chooseAffordableBasket(state, {
      id: 'guest', archetype: 'regular', spendingTier: 'budget', spendingBudget: 18,
    }, () => rolls.shift());

    expect(result.menuOutcome).toBe(menuOutcome);
    if (menuOutcome === 'ordered') expect(result.basket).not.toBeNull();
    else expect(result.basket).toBeNull();
    expect(rolls).toEqual([]);
  });

  it('uses no acceptance draw at reference value, for drinks, or for contracts', () => {
    const initial = createInitialState();
    const atReference = reduceCookbookAction(initial, {
      type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 12 },
    });
    const chooseWithCount = (state, customer, values) => {
      let calls = 0;
      const result = chooseAffordableBasket(state, customer, () => {
        calls += 1;
        return values[calls - 1] ?? 0;
      });
      return { result, calls };
    };
    const reference = chooseWithCount(atReference,
      { archetype: 'regular', spendingTier: 'budget', spendingBudget: 18 }, [0, 0]);
    const drinks = chooseWithCount({ ...atReference, dishes: [], unlockedDrinkIds: ['water'] },
      { archetype: 'regular', spendingTier: 'budget', spendingBudget: 18 }, [0, 0]);
    const contract = chooseWithCount(reduceCookbookAction(initial, {
      type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 15 },
    }), {
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 18,
      serviceContractId: 'contract-1',
    }, [0, 0]);

    expect(reference.result.menuOutcome).toBe('ordered');
    expect(reference.calls).toBe(2);
    expect(drinks.result.menuOutcome).toBe('ordered');
    expect(drinks.calls).toBe(2);
    expect(contract.result.menuOutcome).toBe('ordered');
    expect(contract.calls).toBe(2);

    const unaffordableContract = chooseWithCount({
      ...reduceCookbookAction(initial, {
        type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 15 },
      }),
      unlockedDrinkIds: [],
    }, {
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 6,
      serviceContractId: 'contract-1',
    }, []);
    expect(unaffordableContract.result).toMatchObject({ basket: null, menuOutcome: 'unaffordable' });
    expect(unaffordableContract.calls).toBe(0);
  });

  it('does not fall back to a drink when the selected combined basket fails value acceptance', () => {
    const initial = createInitialState();
    const state = reduceCookbookAction(initial, {
      type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 15 },
    });
    const rolls = [0.8, 0, 0.9];
    const result = chooseAffordableBasket(state, {
      id: 'guest', archetype: 'regular', spendingTier: 'value', spendingBudget: 20,
    }, () => rolls.shift());

    expect(result).toMatchObject({ basket: null, menuOutcome: 'poor_value' });
    expect(rolls).toEqual([]);
  });

  it('does not offer custom or unowned dishes from a menu state', () => {
    const bakedEggs = getCookbookRecipe('baked-eggs');
    const state = {
      ...menuState,
      dishes: [...menuState.dishes,
        { id: 'unowned', ...bakedEggs, price: 15, quality: 1 },
        { id: 'custom', price: 8, quality: 1, popularity: 100, prepTime: 30 },
      ],
      cookbook: {
        ...menuState.cookbook,
        entries: {
          ...menuState.cookbook.entries,
          'baked-eggs': {
            discovered: true, owned: false, paidPortions: 0, perk: null,
            menuSettings: { name: 'Baked Eggs', price: 15, quality: 1 },
          },
        },
      },
    };
    const baskets = buildAffordableBaskets(state, {
      archetype: 'regular', spendingTier: 'value', spendingBudget: 45,
    });

    expect(baskets.some(basket => basket.dish?.id === 'custom')).toBe(false);
    expect(baskets.some(basket => basket.dish?.id === 'unowned')).toBe(false);
    expect(baskets.some(basket => basket.dish?.id === 'cheap')).toBe(true);
    expect(buildAffordableBaskets(state, {
      archetype: 'regular', spendingTier: 'value', spendingBudget: 45,
      serviceContractId: 'contract-1',
    }).some(basket => basket.dish?.id === 'unowned')).toBe(false);
  });
});

describe('estimated menu demand', () => {
  it('never increases when only price rises and decreases under competing affordability', () => {
    const low = estimateMenuItemDemand(menuState, 'dish', 'cheap');
    const higherPrice = withOwnedAuthoredDishes({
      ...menuState,
    }, menuState.dishes.map(dish => dish.id === 'cheap'
      ? { ...dish, cookbookId: 'toast', price: 15 }
      : dish));
    const high = estimateMenuItemDemand(higherPrice, 'dish', 'cheap');
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
    const higherQuality = withOwnedAuthoredDishes({
      ...menuState,
    }, menuState.dishes.map(dish => dish.id === 'cheap'
      ? { ...dish, quality: 10 }
      : dish));
    const high = estimateMenuItemDemand(higherQuality, 'dish', 'cheap');
    expect(high).toBeGreaterThan(low);
  });

  it('returns zero for unknown or locked items without mutating state', () => {
    const before = structuredClone(menuState);
    expect(estimateMenuItemDemand(menuState, 'drink', 'tea')).toBe(0);
    expect(estimateMenuItemDemand(menuState, 'dish', 'missing')).toBe(0);
    expect(menuState).toEqual(before);
  });
});

const singleDishState = (price, reputation = 1) => withOwnedAuthoredDishes({
  restaurant: { reputation },
  dishes: [{ id: 'test', name: 'Test', price }],
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

    const oneDish = singleDishState(19);
    const offMenu = {
      ...oneDish,
      cookbook: {
        ...oneDish.cookbook,
        entries: {
          ...oneDish.cookbook.entries,
          gazpacho: {
            discovered: true, owned: false, paidPortions: 0, perk: null,
            menuSettings: { name: 'Gazpacho', price: 16, quality: 1 },
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
    [8, 0.70 * 11 / 13 + 0.25 + 0.05],
    [9, 0.70 * 10 / 13 + 0.25 + 0.05],
    [15, 0.70 * 4 / 13 + 0.25 + 0.05],
    [18, 0.70 / 13 + 0.25 * 28 / 31 + 0.05],
    [19, 0.25 * 27 / 31 + 0.05],
    [35, 0.25 * 11 / 31 + 0.05],
    [45, 0.25 / 31 + 0.05 * 76 / 86],
    [47, 0.05 * 74 / 86],
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

  it.each([
    [1, 0.70 * 11 / 13 + 0.30],
    [2, 0.5625 * 11 / 13 + 0.4375],
    [3, 0.425 * 11 / 13 + 0.575],
    [4, 0.2875 * 11 / 13 + 0.7125],
    [5, 0.15 * 11 / 13 + 0.85],
  ])('reports exact coverage for the lowest legal authored dish at reputation %s', (reputation, expected) => {
    const { dishShare, anyOrderShare } = getMenuAffordabilitySummary(singleDishState(8, reputation));
    expect(dishShare).toBe(expected);
    expect(anyOrderShare).toBe(expected);
  });

  it('returns the exact one endpoint for universal drink-only coverage at reputation 3', () => {
    expect(getMenuAffordabilitySummary({
      restaurant: { reputation: 3 }, dishes: [], unlockedDrinkIds: ['water'], drinkOverrides: {},
    })).toEqual({ dishShare: 0, anyOrderShare: 1 });
  });

  it('resolves cookbook dish menu settings instead of the raw stored price', () => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 1 },
      dishes: [{ id: 'cookbook:toast', cookbookId: 'toast', price: 12, quality: 1 }],
      unlockedDrinkIds: [],
    });
    const { dishShare, anyOrderShare } = getMenuAffordabilitySummary(state);
    expect(dishShare).toBeCloseTo(0.70 * 7 / 13 + 0.25 + 0.05, 12);
    expect(anyOrderShare).toBeCloseTo(0.70 * 7 / 13 + 0.25 + 0.05, 12);
  });

  it('never increases coverage as prices rise and keeps dish share within any-order share', () => {
    for (const reputation of [1, 3, 5]) {
      const shares = [8, 9, 15, 18, 19, 35, 45, 47]
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
    const authored = singleDishState(19, 3);
    const state = {
      ...authored,
      restaurant: Object.freeze({ ...authored.restaurant }),
      dishes: Object.freeze(authored.dishes.map(dish => Object.freeze(dish))),
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
            const recipe = basket.dish
              ? COOKBOOK_RECIPES.find(candidate => candidate.id === basket.dish.cookbookId)
              : null;
            const referenceValue = recipe
              ? recipe.price * (100 + 8 * (basket.dish.quality - 1)) / 100
              : null;
            const sensitivity = { budget: 2, value: 1, premium: 0.25 }[tier];
            const acceptance = !basket.dish || basket.dish.price <= referenceValue
              ? 1 : (referenceValue / basket.dish.price) ** sensitivity;
            const acceptedProbability = probability * acceptance;
            if (basket.dish) add(`dish:${basket.dish.id}`, acceptedProbability);
            if (basket.drink) add(`drink:${basket.drink.id}`, acceptedProbability);
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

const competingMenuState = reputation => withOwnedAuthoredDishes({
  restaurant: { reputation },
  dishes: [
    { id: 'floor', cookbookId: 'fries', price: 8, quality: 1 },
    { id: 'value-edge', cookbookId: 'toast', price: 15, quality: 4 },
    { id: 'premium-edge', cookbookId: 'baked-potato', price: 35, quality: 8 },
    { id: 'value-cap', cookbookId: 'fried-chicken', price: 40, quality: 10 },
    { id: 'ceiling', cookbookId: 'fish-bisque', price: 43, quality: 10 },
  ],
  unlockedDrinkIds: ['water', 'tea', 'iced-tea'],
  drinkOverrides: { tea: { price: 18 } },
});

describe('batch menu demand', () => {
  it('reads the archetype distribution from the shared source', async () => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 1 },
      dishes: [
        { id: 'plain', cookbookId: 'fries', price: 8, quality: 1 },
        { id: 'quality', cookbookId: 'toast', price: 9, quality: 10 },
      ],
      unlockedDrinkIds: [],
    });
    const existingDistribution = estimateMenuDemand(state);

    vi.resetModules();
    vi.doMock('../data/customerArchetypes', () => ({
      WALK_IN_ARCHETYPE_MIX: { foodie: 1 },
    }));

    try {
      const { estimateMenuDemand: estimateWithSharedDistribution } = await import('./menuEconomy');
      const mockedDistribution = estimateWithSharedDistribution(state);

      expect(mockedDistribution.dishes.get('quality'))
        .toBeGreaterThan(existingDistribution.dishes.get('quality'));
      expect(mockedDistribution.dishes.get('plain'))
        .toBeLessThan(existingDistribution.dishes.get('plain'));
    } finally {
      vi.doUnmock('../data/customerArchetypes');
      vi.resetModules();
    }
  });

  it('weights every integer budget rather than five representative points', () => {
    expect(estimateMenuItemDemand(singleDishState(8), 'dish', 'test')).toBe(89);
  });

  it('renormalises combined baskets across every integer budget', () => {
    const state = { ...singleDishState(8), unlockedDrinkIds: ['water'] };
    const demand = estimateMenuDemand(state);
    const dishProbability = 0.7 * (2 * 0.75 / 0.8 + 9 * 0.95) / 13 + 0.3 * 0.95;
    const waterProbability = 0.7 * (2 + 2 * 0.05 / 0.8 + 9 * 0.25) / 13 + 0.3 * 0.25;
    expect(demand.dishes.get('test')).toBe(Math.round(100 * dishProbability));
    expect(demand.drinks.get('water')).toBe(Math.round(100 * waterProbability));
  });

  it('keeps unrounded accepted demand and gross separate from affordability', () => {
    const initial = createInitialState();
    const state = reduceCookbookAction(initial, {
      type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 15 },
    });
    state.unlockedDrinkIds = [];
    const analysis = getMenuAnalysis(state);
    const expectedAcceptance = 0.70 * (4 / 13) * ((12 / 15) ** 2)
      + 0.25 * (12 / 15)
      + 0.05 * ((12 / 15) ** 0.25);

    expect(analysis.demandProbabilities.dishes.get('starter-toast'))
      .toBeCloseTo(expectedAcceptance, 12);
    expect(analysis.demand.dishes.get('starter-toast'))
      .toBe(Math.round(expectedAcceptance * 100));
    expect(analysis.demandProbabilities.drinks.size).toBe(0);
    expect(analysis.expectedGrossPer100).toBeCloseTo(100 * 15 * expectedAcceptance, 10);
    expect(analysis.affordability.dishShare).toBeCloseTo(0.70 * 4 / 13 + 0.25 + 0.05, 12);
  });

  it.each([1, 3, 5])('matches the exhaustive reference at reputation %s', reputation => {
    const state = competingMenuState(reputation);
    expect(estimateMenuDemand(state)).toEqual(referenceMenuDemand(state));
  });

  it('matches the reference for exact tier boundary prices', () => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 1 },
      dishes: [
        { id: 'dish-8', cookbookId: 'fries', price: 8, quality: 1 },
        { id: 'dish-15', cookbookId: 'toast', price: 15, quality: 4 },
        { id: 'dish-18', cookbookId: 'roast-vegetables', price: 18, quality: 1 },
        { id: 'dish-35', cookbookId: 'baked-potato', price: 35, quality: 8 },
        { id: 'dish-43', cookbookId: 'fried-chicken', price: 43, quality: 10 },
      ],
      unlockedDrinkIds: [],
    });
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

  it('returns empty maps for an empty menu and retains a customer-specific unaffordable item', () => {
    const empty = { restaurant: { reputation: 3 }, dishes: [], unlockedDrinkIds: [], drinkOverrides: {} };
    const emptyDemand = estimateMenuDemand(empty);
    expect(emptyDemand.dishes.size).toBe(0);
    expect(emptyDemand.drinks.size).toBe(0);
    expect(estimateMenuItemDemand(empty, 'dish', 'anything')).toBe(0);
    expect(emptyDemand).toEqual(referenceMenuDemand(empty));

    const expensive = singleDishState(47);
    const expensiveDemand = estimateMenuDemand(expensive);
    expect(buildAffordableBaskets(expensive, {
      spendingTier: 'budget', spendingBudget: 6,
    })).toEqual([]);
    expect(expensiveDemand.dishes.get('test')).toBeGreaterThan(0);
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
  cookbook: menuState.cookbook,
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
      cookbook: menuState.cookbook,
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

  it('keeps an active offering even when a particular guest cannot afford it', () => {
    const expensive = singleDishState(47);
    expect(buildAffordableBaskets(expensive, {
      spendingTier: 'budget', spendingBudget: 6,
    })).toEqual([]);
    expect(hasAvailableWalkInMenu(expensive)).toBe(true);
    expect(hasAvailableWalkInMenu({
      ...expensive,
      restaurant: { reputation: 1, suspendedDishIds: ['test'] },
    })).toBe(false);
  });
});

describe('combined menu analysis', () => {
  const cookbookState = withOwnedAuthoredDishes({
    restaurant: { reputation: 1 },
    dishes: [{ id: 'cookbook-toast', cookbookId: 'toast', price: 12, quality: 1 }],
    unlockedDrinkIds: ['water'],
  });
  const fixtures = {
    mixed: {
      state: menuState,
      expected: {
        affordability: getMenuAffordabilitySummary(menuState),
        demand: referenceMenuDemand(menuState),
        hasAvailableMenu: true,
      },
    },
    suspended: {
      state: suspensionState,
      expected: {
        affordability: getMenuAffordabilitySummary(suspensionState),
        demand: referenceMenuDemand(suspensionState),
        hasAvailableMenu: true,
      },
    },
    cookbook: {
      state: cookbookState,
      expected: {
        affordability: getMenuAffordabilitySummary(cookbookState),
        demand: referenceMenuDemand(cookbookState),
        hasAvailableMenu: true,
      },
    },
    empty: {
      state: { restaurant: { reputation: 3 }, dishes: [], unlockedDrinkIds: [], drinkOverrides: {} },
      expected: {
        affordability: { dishShare: 0, anyOrderShare: 0 },
        demand: { dishes: new Map(), drinks: new Map() },
        hasAvailableMenu: false,
      },
    },
  };

  it.each(Object.entries(fixtures))('pins existing helper results for the %s menu', (_name, fixture) => {
    const { expectedGrossPer100, demandProbabilities, affordabilityByTier, ...existingAnalysis } = getMenuAnalysis(fixture.state);
    expect(existingAnalysis).toEqual(fixture.expected);
    expect(demandProbabilities).toEqual(expect.objectContaining({ dishes: expect.any(Map), drinks: expect.any(Map) }));
    expect(affordabilityByTier).toBeDefined();
    expect(Number.isFinite(expectedGrossPer100)).toBe(true);
    expect(expectedGrossPer100).toBeGreaterThanOrEqual(0);
  });

  it.each(Object.entries(fixtures))('matches the public wrappers for the %s menu', (_name, { state }) => {
    const { expectedGrossPer100, demandProbabilities, affordabilityByTier, ...existingAnalysis } = getMenuAnalysis(state);
    expect(existingAnalysis).toEqual({
      affordability: getMenuAffordabilitySummary(state),
      demand: estimateMenuDemand(state),
      hasAvailableMenu: hasAvailableWalkInMenu(state),
    });
    expect(affordabilityByTier).toEqual(getMenuAnalysis(state).affordabilityByTier);
    expect(Number.isFinite(expectedGrossPer100)).toBe(true);
    expect(expectedGrossPer100).toBeGreaterThanOrEqual(0);
  });
});

describe('tier affordability analysis', () => {
  const expectedZeroCoverage = {
    budget: { dishShare: 0, anyOrderShare: 0 },
    value: { dishShare: 0, anyOrderShare: 0 },
    premium: { dishShare: 0, anyOrderShare: 0 },
  };

  it('reports each tier while keeping the weighted aggregate and summary shape unchanged', () => {
    const state = singleDishState(18);
    const analysis = getMenuAnalysis(state);

    expect(analysis.affordabilityByTier).toEqual({
      budget: { dishShare: 1 / 13, anyOrderShare: 1 / 13 },
      value: { dishShare: 28 / 31, anyOrderShare: 28 / 31 },
      premium: { dishShare: 1, anyOrderShare: 1 },
    });
    expect(analysis.affordability).toEqual({
      dishShare: 0.70 / 13 + 0.25 * 28 / 31 + 0.05,
      anyOrderShare: 0.70 / 13 + 0.25 * 28 / 31 + 0.05,
    });
    expect(getMenuAffordabilitySummary(state)).toEqual({
      dishShare: analysis.affordability.dishShare,
      anyOrderShare: analysis.affordability.anyOrderShare,
    });

    const draft = getMenuAnalysis(state, { kind: 'dish', id: 'test', price: 19 });
    expect(draft.affordabilityByTier).toEqual({
      budget: { dishShare: 1 / 13, anyOrderShare: 1 / 13 },
      value: { dishShare: 28 / 31, anyOrderShare: 28 / 31 },
      premium: { dishShare: 1, anyOrderShare: 1 },
    });
    expect(state.dishes[0].price).toBe(18);
  });

  it.each([
    [8, {
      budget: { dishShare: 11 / 13, anyOrderShare: 11 / 13 },
      value: { dishShare: 1, anyOrderShare: 1 },
      premium: { dishShare: 1, anyOrderShare: 1 },
    }],
    [15, {
      budget: { dishShare: 4 / 13, anyOrderShare: 4 / 13 },
      value: { dishShare: 1, anyOrderShare: 1 },
      premium: { dishShare: 1, anyOrderShare: 1 },
    }],
    [18, {
      budget: { dishShare: 1 / 13, anyOrderShare: 1 / 13 },
      value: { dishShare: 28 / 31, anyOrderShare: 28 / 31 },
      premium: { dishShare: 1, anyOrderShare: 1 },
    }],
    [35, {
      budget: { dishShare: 0, anyOrderShare: 0 },
      value: { dishShare: 11 / 31, anyOrderShare: 11 / 31 },
      premium: { dishShare: 1, anyOrderShare: 1 },
    }],
    [45, {
      budget: { dishShare: 0, anyOrderShare: 0 },
      value: { dishShare: 1 / 31, anyOrderShare: 1 / 31 },
      premium: { dishShare: 76 / 86, anyOrderShare: 76 / 86 },
    }],
    [47, {
      budget: { dishShare: 0, anyOrderShare: 0 },
      value: { dishShare: 0, anyOrderShare: 0 },
      premium: { dishShare: 74 / 86, anyOrderShare: 74 / 86 },
    }],
  ])('counts inclusive integer budget points at the $%s tier edges', (price, expected) => {
    expect(getMenuAnalysis(singleDishState(price)).affordabilityByTier).toEqual(expected);
  });

  it('returns zero for empty menus and full any-order coverage for a drink-only menu', () => {
    expect(getMenuAnalysis({
      restaurant: { reputation: 3 }, dishes: [], unlockedDrinkIds: [],
    }).affordabilityByTier).toEqual(expectedZeroCoverage);

    const drinksOnly = {
      restaurant: { reputation: 3 },
      dishes: [],
      unlockedDrinkIds: ['water'],
      drinkOverrides: { water: { price: 1 } },
    };
    expect(getMenuAnalysis(drinksOnly).affordabilityByTier).toEqual({
      budget: { dishShare: 0, anyOrderShare: 1 },
      value: { dishShare: 0, anyOrderShare: 1 },
      premium: { dishShare: 0, anyOrderShare: 1 },
    });
  });

  it('keeps suspended and reached-threshold dishes excluded from current and draft tiers', () => {
    const base = {
      ...singleDishState(18),
      restaurant: {
        reputation: 3,
        suspendedDishIds: ['test'],
        menuSalesThresholds: [{ kind: 'dish', id: 'test', threshold: 1 }],
        day: 1,
      },
      menuSales: { day: 1, dishes: [{ key: 'test', count: 1 }], drinks: [] },
    };
    for (const state of [base, {
      ...base,
      restaurant: { ...base.restaurant, suspendedDishIds: [] },
    }]) {
      expect(getMenuAnalysis(state).affordabilityByTier).toEqual(expectedZeroCoverage);
      expect(getMenuAnalysis(state, { kind: 'dish', id: 'test', price: 6 }).affordabilityByTier)
        .toEqual(expectedZeroCoverage);
    }
  });

  it('keeps the source state unchanged while analysing a frozen price draft', () => {
    const authored = singleDishState(18, 1);
    const state = {
      ...authored,
      restaurant: Object.freeze({ ...authored.restaurant }),
      dishes: Object.freeze(authored.dishes.map(dish => Object.freeze(dish))),
      unlockedDrinkIds: Object.freeze([]),
    };
    const before = structuredClone(state);
    const draft = getMenuAnalysis(state, { kind: 'dish', id: 'test', price: 19 });

    expect(draft.affordabilityByTier.budget.dishShare).toBe(1 / 13);
    expect(draft.affordabilityByTier.value.dishShare).toBe(28 / 31);
    expect(state).toEqual(before);
  });
});

describe('paid-sales menu thresholds', () => {
  const stateWithThresholds = () => withOwnedAuthoredDishes({
    restaurant: {
      day: 1,
      reputation: 3,
      menuSalesThresholds: [
        { kind: 'dish', id: '__proto__', threshold: 2 },
        { kind: 'drink', id: 'water', threshold: 2 },
      ],
    },
    dishes: [{ id: '__proto__', cookbookId: 'fries', price: 10, quality: 2 }],
    unlockedDrinkIds: ['water'],
    drinkOverrides: {},
    menuSales: {
      day: 1,
      dishes: [{ key: '__proto__', count: 1 }],
      drinks: [{ key: 'water', count: 1 }],
    },
  });

  it('reads array-backed policy IDs safely and treats missing or invalid policies as unlimited', () => {
    const state = stateWithThresholds();
    expect(getMenuItemSalesThreshold(state, 'dish', '__proto__')).toBe(2);
    expect(getMenuItemSalesThreshold(state, 'drink', 'water')).toBe(2);
    expect(getMenuItemSalesThreshold(state, 'dish', 'water')).toBeNull();
    expect(getMenuItemSalesThreshold(state, 'side', '__proto__')).toBeNull();
    expect(getMenuItemSalesThreshold({ restaurant: {} }, 'dish', 'anything')).toBeNull();
    expect(isMenuItemSalesThresholdReached(state, 'dish', '__proto__')).toBe(false);
    expect(isMenuItemSalesThresholdReached(state, 'drink', 'water')).toBe(false);
  });

  it('excludes dishes, drinks and combined baskets at the exact paid threshold across shared previews', () => {
    const before = stateWithThresholds();
    const customer = { spendingBudget: 100 };
    expect(buildAffordableBaskets(before, customer).map(basketShape)).toEqual([
      ['dish', '__proto__', undefined],
      ['drink', undefined, 'water'],
      ['dish_drink', '__proto__', 'water'],
    ]);
    expect(hasAvailableWalkInMenu(before)).toBe(true);

    const reached = {
      ...before,
      menuSales: {
        day: 1,
        dishes: [{ key: '__proto__', count: 2 }],
        drinks: [{ key: 'water', count: 2 }],
      },
    };
    expect(isMenuItemSalesThresholdReached(reached, 'dish', '__proto__')).toBe(true);
    expect(isMenuItemSalesThresholdReached(reached, 'drink', 'water')).toBe(true);
    expect(buildAffordableBaskets(reached, customer)).toEqual([]);
    expect(hasAvailableWalkInMenu(reached)).toBe(false);
    expect(getMenuAnalysis(reached)).toMatchObject({
      hasAvailableMenu: false,
      demand: { dishes: new Map(), drinks: new Map() },
      affordability: { dishShare: 0, anyOrderShare: 0 },
    });
  });

  it('applies the same threshold filter to price previews while allowing below-threshold items', () => {
    const state = stateWithThresholds();
    const reachedDish = {
      ...state,
      menuSales: { ...state.menuSales, dishes: [{ key: '__proto__', count: 2 }] },
    };
    const analysis = getMenuAnalysis(reachedDish, {
      kind: 'dish', id: '__proto__', price: 99,
    });
    expect(analysis.hasAvailableMenu).toBe(true);
    expect(analysis.demand.dishes.has('__proto__')).toBe(false);
    expect(analysis.demand.drinks.has('water')).toBe(true);
    expect(buildAffordableBaskets(reachedDish, { spendingBudget: 100 }).map(basketShape))
      .toEqual([['drink', undefined, 'water']]);
  });

  it('lets contracts bypass both manual suspension and reached thresholds without changing policy or ledger', () => {
    const state = {
      ...stateWithThresholds(),
      restaurant: {
        ...stateWithThresholds().restaurant,
        suspendedDishIds: ['__proto__'],
      },
      menuSales: {
        day: 1,
        dishes: [{ key: '__proto__', count: 2 }],
        drinks: [{ key: 'water', count: 2 }],
      },
    };
    const before = structuredClone(state);
    expect(buildAffordableBaskets(state, { spendingBudget: 100 }).map(basketShape)).toEqual([]);
    expect(buildAffordableBaskets(state, {
      spendingBudget: 100, serviceContractId: 'contract-1',
    }).map(basketShape)).toEqual([
      ['dish', '__proto__', undefined],
      ['drink', undefined, 'water'],
      ['dish_drink', '__proto__', 'water'],
    ]);
    expect(state).toEqual(before);
  });

  it('keeps policies across days while stale sales telemetry no longer reaches them', () => {
    const yesterday = stateWithThresholds();
    const today = {
      ...yesterday,
      restaurant: { ...yesterday.restaurant, day: 2 },
    };
    expect(getMenuItemSalesThreshold(today, 'dish', '__proto__')).toBe(2);
    expect(isMenuItemSalesThresholdReached(today, 'dish', '__proto__')).toBe(false);
    expect(buildAffordableBaskets(today, { spendingBudget: 100 })
      .some(basket => basket.dish?.id === '__proto__')).toBe(true);
    expect(today.restaurant.menuSalesThresholds).toBe(yesterday.restaurant.menuSalesThresholds);
  });
});
