import { getCookbookRecipe } from '../data/cookbook';

const spendingTierSensitivity = Object.freeze({ budget: 2, value: 1, premium: 0.25 });

export function getDishPricing(cookbookId, quality) {
  const recipe = getCookbookRecipe(cookbookId);
  if (!recipe || !Number.isInteger(quality) || quality < 1 || quality > 10) return null;

  const numerator = recipe.price * (100 + 8 * (quality - 1));
  return {
    referenceValue: numerator / 100,
    minPrice: Math.floor((recipe.price * 3 + 3) / 4),
    maxPrice: Math.floor(numerator / 80),
  };
}

export function clampDishPrice(cookbookId, quality, candidate) {
  const pricing = getDishPricing(cookbookId, quality);
  if (!pricing || !Number.isFinite(candidate)) return null;
  return Math.max(pricing.minPrice, Math.min(pricing.maxPrice, Math.round(candidate)));
}

export function getDishValueAcceptance(dish, spendingTier) {
  if (dish == null) return 1;
  if (typeof dish !== 'object' || Array.isArray(dish)
    || typeof spendingTier !== 'string'
    || !Object.prototype.hasOwnProperty.call(spendingTierSensitivity, spendingTier)) return 0;

  const pricing = getDishPricing(dish.cookbookId, dish.quality);
  if (!pricing || !Number.isInteger(dish.price)
    || dish.price < pricing.minPrice || dish.price > pricing.maxPrice) return 0;
  if (dish.price <= pricing.referenceValue) return 1;
  return (pricing.referenceValue / dish.price) ** spendingTierSensitivity[spendingTier];
}
