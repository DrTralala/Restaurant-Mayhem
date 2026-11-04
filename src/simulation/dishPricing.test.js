import { describe, expect, it } from 'vitest';
import { COOKBOOK_RECIPES } from '../data/cookbook';
import { clampDishPrice, getDishPricing, getDishValueAcceptance } from './dishPricing';

const recipeBasePrices = [
  ['toast', 12],
  ['cheese-toast', 14],
  ['roast-vegetables', 18],
  ['baked-eggs', 15],
  ['baked-potato', 22],
  ['fries', 10],
  ['fried-chicken', 20],
  ['gazpacho', 16],
  ['fish-bisque', 20],
];

describe('canonical cookbook dish pricing', () => {
  it.each(recipeBasePrices)('derives all ten quality bounds for %s', (cookbookId, basePrice) => {
    let previousMaximum = 0;
    for (let quality = 1; quality <= 10; quality += 1) {
      const numerator = basePrice * (100 + 8 * (quality - 1));
      const pricing = getDishPricing(cookbookId, quality);

      expect(pricing).toEqual({
        referenceValue: numerator / 100,
        minPrice: Math.ceil(basePrice * 3 / 4),
        maxPrice: Math.floor(numerator / 80),
      });
      expect(pricing.minPrice).toBe(getDishPricing(cookbookId, 1).minPrice);
      expect(pricing.maxPrice).toBeGreaterThanOrEqual(previousMaximum);
      previousMaximum = pricing.maxPrice;
    }
  });

  it('preserves fractional references and exact rational price boundaries', () => {
    expect(getDishPricing('toast', 1)).toEqual({ referenceValue: 12, minPrice: 9, maxPrice: 15 });
    expect(getDishPricing('toast', 10)).toEqual({ referenceValue: 20.64, minPrice: 9, maxPrice: 25 });
    expect(getDishPricing('toast', 6).maxPrice).toBe(21);
    expect(getDishPricing('fish-bisque', 10).maxPrice).toBe(43);
  });

  it.each(['missing', 'toString', '__proto__', null, undefined, 3])(
    'returns null for unknown recipe identity %s', cookbookId => {
      expect(getDishPricing(cookbookId, 1)).toBeNull();
      expect(clampDishPrice(cookbookId, 1, 12)).toBeNull();
    },
  );

  it.each([0, 11, 1.5, NaN, Infinity, -Infinity, '1', null, undefined])(
    'returns null for invalid quality %s', quality => {
      expect(getDishPricing('toast', quality)).toBeNull();
      expect(clampDishPrice('toast', quality, 12)).toBeNull();
    },
  );

  it.each([
    [100, 15],
    [9.6, 10],
    [9.5, 10],
    [9.4, 9],
    [0, 9],
    [-100, 9],
  ])('rounds and clamps toast price candidate %s to %s', (candidate, expected) => {
    expect(clampDishPrice('toast', 1, candidate)).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity, '12', null, undefined, {}, true])(
    'rejects non-finite or non-number price candidate %s', candidate => {
      expect(clampDishPrice('toast', 1, candidate)).toBeNull();
    },
  );

  it('uses cookbook identities and quality to validate every recipe boundary', () => {
    for (const recipe of COOKBOOK_RECIPES) {
      for (let quality = 1; quality <= 10; quality += 1) {
        const { minPrice, maxPrice } = getDishPricing(recipe.id, quality);
        expect(clampDishPrice(recipe.id, quality, minPrice - 100)).toBe(minPrice);
        expect(clampDishPrice(recipe.id, quality, maxPrice + 100)).toBe(maxPrice);
      }
    }
  });
});

describe('dish value acceptance', () => {
  it('treats an absent dish as certain without requiring a valid spending tier', () => {
    expect(getDishValueAcceptance(null, 'budget')).toBe(1);
    expect(getDishValueAcceptance(undefined, 'unknown')).toBe(1);
  });

  it('applies tier-specific power laws to a valid toast markup', () => {
    const toast = { cookbookId: 'toast', quality: 1, price: 15 };
    expect(getDishValueAcceptance(toast, 'budget')).toBeCloseTo(0.64, 12);
    expect(getDishValueAcceptance(toast, 'value')).toBeCloseTo(0.8, 12);
    expect(getDishValueAcceptance(toast, 'premium')).toBeCloseTo(0.8 ** 0.25, 12);
    expect(getDishValueAcceptance(toast, 'premium'))
      .toBeGreaterThan(getDishValueAcceptance(toast, 'value'));
    expect(getDishValueAcceptance(toast, 'value'))
      .toBeGreaterThan(getDishValueAcceptance(toast, 'budget'));
  });

  it.each(['budget', 'value', 'premium'])('accepts a price at or below reference for %s', spendingTier => {
    expect(getDishValueAcceptance({ cookbookId: 'toast', quality: 1, price: 12 }, spendingTier)).toBe(1);
    expect(getDishValueAcceptance({ cookbookId: 'toast', quality: 1, price: 9 }, spendingTier)).toBe(1);
  });

  it('decreases monotonically over every valid markup price for all recipes and qualities', () => {
    for (const [cookbookId] of recipeBasePrices) {
      for (let quality = 1; quality <= 10; quality += 1) {
        const { referenceValue, maxPrice } = getDishPricing(cookbookId, quality);
        const previous = { budget: 1, value: 1, premium: 1 };
        for (let price = Math.floor(referenceValue) + 1; price <= maxPrice; price += 1) {
          const dish = { cookbookId, quality, price };
          const acceptance = Object.fromEntries(['budget', 'value', 'premium'].map(spendingTier =>
            [spendingTier, getDishValueAcceptance(dish, spendingTier)]));
          for (const spendingTier of ['budget', 'value', 'premium']) {
            expect(acceptance[spendingTier]).toBeLessThanOrEqual(previous[spendingTier]);
            previous[spendingTier] = acceptance[spendingTier];
          }
          expect(acceptance.premium).toBeGreaterThan(acceptance.value);
          expect(acceptance.value).toBeGreaterThan(acceptance.budget);
        }
      }
    }
  });

  it.each([
    [{ cookbookId: 'missing', quality: 1, price: 12 }, 'value'],
    [{ cookbookId: 'toast', quality: 0, price: 12 }, 'value'],
    [{ cookbookId: 'toast', quality: 1, price: 8 }, 'value'],
    [{ cookbookId: 'toast', quality: 1, price: 16 }, 'value'],
    [{ cookbookId: 'toast', quality: 1, price: 12.5 }, 'value'],
    [{ cookbookId: 'toast', quality: 1, price: '12' }, 'value'],
    [{ cookbookId: 'toast', quality: 1, price: 12 }, 'unknown'],
    [12, 'budget'],
  ])('returns zero for invalid present dish/tier %j', (dish, spendingTier) => {
    expect(getDishValueAcceptance(dish, spendingTier)).toBe(0);
  });
});
