import { describe, expect, it, vi } from 'vitest';
import { estimateMenuDemand, getMenuAnalysis } from './menuEconomy';
import { withOwnedAuthoredDishes } from './menuTestFixtures';
import { getCookbookRecipe } from '../data/cookbook';

const REFERENCE_TIERS = Object.freeze([
  { name: 'budget', minimum: 6, maximum: 18 },
  { name: 'value', minimum: 15, maximum: 45 },
  { name: 'premium', minimum: 35, maximum: 120 },
]);
const REFERENCE_KIND_WEIGHTS = Object.freeze({ dish: 0.75, dish_drink: 0.20, drink: 0.05 });
const REFERENCE_ARCHETYPES = Object.freeze([
  { name: 'regular', weight: 3 / 6 },
  { name: 'foodie', weight: 1 / 6 },
  { name: 'rusher', weight: 1 / 6 },
  { name: 'influencer', weight: 1 / 6 },
]);
const REFERENCE_ARCHETYPE_WEIGHTS = Object.freeze({
  regular: { price: 4, quality: 2, popularity: 2, speed: 1 },
  foodie: { price: 2, quality: 5, popularity: 2, speed: 1 },
  rusher: { price: 2, quality: 1, popularity: 1, speed: 6 },
  influencer: { price: 1, quality: 2, popularity: 6, speed: 1 },
});
const REFERENCE_TIER_PRICE_SENSITIVITY = Object.freeze({ budget: 1.5, value: 1, premium: 0.5 });

const clamp01 = value => Math.min(1, Math.max(0, value));

function referenceTierProbabilities(reputation) {
  const rating = Math.min(5, Math.max(1, Number.isFinite(reputation) ? reputation : 1));
  return {
    budget: 0.70 - 0.1375 * (rating - 1),
    value: 0.25 + 0.025 * (rating - 1),
    premium: 0.05 + 0.1125 * (rating - 1),
  };
}

function referenceBasket(kind, dish = null, drink = null) {
  const items = [dish, drink].filter(Boolean);
  return {
    kind,
    dish,
    drink,
    price: items.reduce((total, item) => total + item.price, 0),
    quality: clamp01(items.reduce((total, item) => total + item.quality, 0) / items.length / 10),
    popularity: clamp01(items.reduce((total, item) => total + item.popularity, 0) / items.length / 100),
    speed: clamp01(1 - Math.max(...items.map(item => item.prepTime)) / 600),
  };
}

// Deliberately exhaustive reference model: it enumerates every integer budget
// and archetype without calling menuEconomy's basket, weight, or probability helpers.
function referenceExpectedGrossPer100({ reputation, dishes, drinks }) {
  const tierProbabilities = referenceTierProbabilities(reputation);
  const baskets = [
    ...dishes.map(dish => referenceBasket('dish', dish)),
    ...drinks.map(drink => referenceBasket('drink', null, drink)),
    ...dishes.flatMap(dish => drinks.map(drink => referenceBasket('dish_drink', dish, drink))),
  ];
  let expectedGross = 0;

  for (const tier of REFERENCE_TIERS) {
    const rangeSize = tier.maximum - tier.minimum + 1;
    const budgetProbability = tierProbabilities[tier.name] / rangeSize;
    for (let budget = tier.minimum; budget <= tier.maximum; budget += 1) {
      const affordable = baskets.filter(basket => basket.price <= budget);
      const groups = new Map();
      for (const basket of affordable) {
        if (!groups.has(basket.kind)) groups.set(basket.kind, []);
        groups.get(basket.kind).push(basket);
      }
      const kindTotal = [...groups.keys()]
        .reduce((total, kind) => total + REFERENCE_KIND_WEIGHTS[kind], 0);
      if (!(kindTotal > 0)) continue;

      for (const archetype of REFERENCE_ARCHETYPES) {
        const coefficients = REFERENCE_ARCHETYPE_WEIGHTS[archetype.name];
        for (const [kind, group] of groups) {
          const basketWeights = group.map(basket => {
            const priceFit = clamp01(1 - basket.price / Math.max(1, budget));
            return 0.1
              + coefficients.price * REFERENCE_TIER_PRICE_SENSITIVITY[tier.name] * priceFit
              + coefficients.quality * basket.quality
              + coefficients.popularity * basket.popularity
              + coefficients.speed * basket.speed;
          });
          const basketTotal = basketWeights.reduce((total, weight) => total + weight, 0);
          if (!(basketTotal > 0)) continue;
          const kindShare = budgetProbability * archetype.weight
            * REFERENCE_KIND_WEIGHTS[kind] / kindTotal;
          group.forEach((basket, index) => {
            const selectionProbability = kindShare * basketWeights[index] / basketTotal;
            const recipe = basket.dish ? getCookbookRecipe(basket.dish.cookbookId) : null;
            const referenceValue = recipe
              ? recipe.price * (100 + 8 * (basket.dish.quality - 1)) / 100
              : null;
            const sensitivity = { budget: 2, value: 1, premium: 0.25 }[tier.name];
            const acceptance = !basket.dish || basket.dish.price <= referenceValue
              ? 1 : (referenceValue / basket.dish.price) ** sensitivity;
            expectedGross += selectionProbability * acceptance * basket.price;
          });
        }
      }
    }
  }

  return expectedGross * 100;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('whole-menu gross price preview', () => {
  it('adds a dish price override without changing the source state', () => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 1 },
      dishes: [{
        id: 'meal', cookbookId: 'toast', name: 'Meal', price: 12, quality: 1,
      }],
      unlockedDrinkIds: [],
    });
    const before = structuredClone(state);
    const reference = {
      reputation: 1,
      dishes: [{ id: 'meal', cookbookId: 'toast', price: 12, quality: 1, popularity: 50, prepTime: 60 }],
      drinks: [],
    };

    expect(getMenuAnalysis(state).expectedGrossPer100)
      .toBeCloseTo(referenceExpectedGrossPer100(reference), 12);
    expect(getMenuAnalysis(state, { kind: 'dish', id: 'meal', price: 100 }).expectedGrossPer100)
      .toBeCloseTo(referenceExpectedGrossPer100({
        ...reference,
        dishes: reference.dishes.map(dish => ({ ...dish, price: 15 })),
      }), 12);
    expect(state).toEqual(before);
  });

  it('returns zero gross when no walk-in profile can afford any basket', () => {
    expect(getMenuAnalysis({
      restaurant: { reputation: 3 }, dishes: [], unlockedDrinkIds: [],
    }).expectedGrossPer100).toBe(0);
    const expensive = withOwnedAuthoredDishes({
      restaurant: { reputation: 1 },
      dishes: [{ id: 'too-costly', cookbookId: 'baked-potato', price: 47, quality: 10 }],
      unlockedDrinkIds: [],
    });
    expect(getMenuAnalysis(expensive).expectedGrossPer100)
      .toBeCloseTo(referenceExpectedGrossPer100({
        reputation: 1,
        dishes: [{ id: 'too-costly', cookbookId: 'baked-potato', price: 47, quality: 10,
          popularity: 82, prepTime: 210 }],
        drinks: [],
      }), 12);
  });

  it('reduces expected gross above reference despite unchanged premium-tier budget fit', () => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 3 },
      dishes: [{ id: 'toast', cookbookId: 'toast', price: 12, quality: 1 }],
      unlockedDrinkIds: [],
    });
    const atReference = getMenuAnalysis(state, { kind: 'dish', id: 'toast', price: 12 });
    const aboveReference = getMenuAnalysis(state, { kind: 'dish', id: 'toast', price: 15 });

    expect(atReference.affordabilityByTier.premium.dishShare).toBe(1);
    expect(aboveReference.affordabilityByTier.premium.dishShare).toBe(1);
    expect(aboveReference.expectedGrossPer100).toBeLessThan(atReference.expectedGrossPer100);
    expect(aboveReference.expectedGrossPer100).toBeCloseTo(referenceExpectedGrossPer100({
      reputation: 3,
      dishes: [{ id: 'toast', cookbookId: 'toast', price: 15, quality: 1,
        popularity: 50, prepTime: 60 }],
      drinks: [],
    }), 12);
  });

  it('matches an independent exhaustive oracle for resolved dishes and unlocked drinks', () => {
    const state = deepFreeze(withOwnedAuthoredDishes({
      restaurant: {
        reputation: 3,
        suspendedDishIds: ['suspended-dish'],
        suspendedDrinkIds: ['coffee'],
      },
      dishes: [
        { id: 'toast-menu-id', cookbookId: 'toast', price: 13, quality: 3 },
        { id: 'soup', cookbookId: 'roast-vegetables', name: 'Soup', price: 15, quality: 6 },
        { id: 'suspended-dish', cookbookId: 'fries', name: 'Suspended', price: 8, quality: 1 },
      ],
      unlockedDrinkIds: ['water', 'coffee'],
      drinkOverrides: {
        water: { price: 9, quality: 4 },
        coffee: { price: 7 },
      },
    }));
    const resolvedMenu = {
      reputation: 3,
      dishes: [
        { id: 'toast-menu-id', cookbookId: 'toast', price: 13, quality: 3, popularity: 50, prepTime: 60 },
        { id: 'soup', cookbookId: 'roast-vegetables', price: 15, quality: 6, popularity: 70, prepTime: 150 },
      ],
      drinks: [{ id: 'water', price: 9, quality: 4, popularity: 50, prepTime: 120 }],
    };
    const ordinaryGross = referenceExpectedGrossPer100(resolvedMenu);
      const expectedDishPriceGross = referenceExpectedGrossPer100({
        ...resolvedMenu,
        dishes: resolvedMenu.dishes.map(dish => dish.id === 'toast-menu-id'
        ? { ...dish, price: 17 }
        : dish),
    });
    const expectedDrinkPriceGross = referenceExpectedGrossPer100({
      ...resolvedMenu,
      drinks: resolvedMenu.drinks.map(drink => drink.id === 'water'
        ? { ...drink, price: 17 }
        : drink),
    });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('menu analysis must not consume randomness');
    });

    try {
      expect(Number.isInteger(ordinaryGross)).toBe(false);
      expect(getMenuAnalysis(state).expectedGrossPer100).toBeCloseTo(ordinaryGross, 12);
      expect(getMenuAnalysis(state, {
        kind: 'dish', id: 'toast-menu-id', price: 20,
      }).expectedGrossPer100).toBeCloseTo(expectedDishPriceGross, 12);
      expect(getMenuAnalysis(state, {
        kind: 'drink', id: 'water', price: 17,
      }).expectedGrossPer100).toBeCloseTo(expectedDrinkPriceGross, 12);
      expect(getMenuAnalysis(state, {
        kind: 'dish', id: 'suspended-dish', price: 50,
      }).expectedGrossPer100).toBeCloseTo(ordinaryGross, 12);
      expect(getMenuAnalysis(state, {
        kind: 'drink', id: 'coffee', price: 50,
      }).expectedGrossPer100).toBeCloseTo(ordinaryGross, 12);
      expect(getMenuAnalysis(state, {
        kind: 'drink', id: 'iced-tea', price: 50,
      }).expectedGrossPer100).toBeCloseTo(ordinaryGross, 12);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }

    expect(state.dishes[0].price).toBe(13);
    expect(state.drinkOverrides.water.price).toBe(9);
  });

  it('leaves ordinary analysis unchanged for malformed price overrides', () => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 1 },
      dishes: [{ id: 'meal', cookbookId: 'toast', price: 12, quality: 5 }],
      unlockedDrinkIds: ['water'],
    });
    const ordinary = getMenuAnalysis(state);
    const invalidOverrides = [
      { kind: 'side', id: 'meal', price: 20 },
      { kind: 'dish', id: '', price: 20 },
      { kind: 'dish', id: 12, price: 20 },
      { kind: 'dish', id: 'meal', price: '20' },
      { kind: 'dish', id: 'meal', price: Number.POSITIVE_INFINITY },
      { kind: 'dish', price: 20 },
      'not an override',
    ];

    for (const override of invalidOverrides) {
      expect(getMenuAnalysis(state, override)).toEqual(ordinary);
    }
  });

  it('rounds and clamps a fractional or out-of-range authored dish draft', () => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 1 },
      dishes: [{ id: 'meal', cookbookId: 'toast', price: 12, quality: 5 }],
      unlockedDrinkIds: [],
    });
    const reference = {
      reputation: 1,
      drinks: [],
      dishes: [{ id: 'meal', cookbookId: 'toast', price: 13, quality: 5, popularity: 50, prepTime: 60 }],
    };

    expect(getMenuAnalysis(state, { kind: 'dish', id: 'meal', price: 12.5 }).expectedGrossPer100)
      .toBeCloseTo(referenceExpectedGrossPer100(reference), 12);
    expect(getMenuAnalysis(state, { kind: 'dish', id: 'meal', price: 0 }).expectedGrossPer100)
      .toBeCloseTo(referenceExpectedGrossPer100({
        ...reference,
        dishes: reference.dishes.map(dish => ({ ...dish, price: 9 })),
      }), 12);
    expect(getMenuAnalysis(state, { kind: 'dish', id: 'meal', price: 101 }).expectedGrossPer100)
      .toBeCloseTo(referenceExpectedGrossPer100({
        ...reference,
        dishes: reference.dishes.map(dish => ({ ...dish, price: 19 })),
      }), 12);
  });

  it('keeps demand projection shape and default demand independent of price previews', () => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 3 },
      dishes: [{ id: 'meal', cookbookId: 'toast', price: 12, quality: 1 }],
      unlockedDrinkIds: ['water'],
    });
    const demand = estimateMenuDemand(state);

    expect(Object.keys(demand).sort()).toEqual(['dishes', 'drinks']);
    expect(getMenuAnalysis(state).demand).toEqual(demand);
    getMenuAnalysis(state, { kind: 'dish', id: 'meal', price: 30 });
    expect(estimateMenuDemand(state)).toEqual(demand);
  });
});
