import { COOKBOOK_RECIPES, getCookbookRecipe } from '../data/cookbook';
import { clampDishPrice } from './dishPricing';
import { createCookbookState } from './cookbook';

/** Build test menus through the same owned, bounded cookbook boundary as saves. */
export function withOwnedAuthoredDishes(state, dishSpecs = state.dishes || []) {
  const usedRecipes = new Set();
  const cookbookSeed = createCookbookState(
    Number.isSafeInteger(state.paidVisitSequence) ? state.paidVisitSequence : 0,
  );
  const entries = {
    ...cookbookSeed.entries,
    ...(state.cookbook?.entries || {}),
  };

  const dishes = dishSpecs.map((spec, index) => {
    const preferredRecipe = getCookbookRecipe(spec.cookbookId);
    const fixedQuality = Number.isInteger(spec.quality) && spec.quality >= 1 && spec.quality <= 10
      ? spec.quality
      : null;
    const requestedPrice = Number.isFinite(spec.price) ? spec.price : null;
    const equipmentId = spec.requiredEquipmentId;
    const candidates = (preferredRecipe ? [preferredRecipe] : COOKBOOK_RECIPES)
      .filter(recipe => !usedRecipes.has(recipe.id))
      .flatMap(recipe => (fixedQuality == null ? Array.from({ length: 10 }, (_, i) => i + 1) : [fixedQuality])
        .map(quality => ({ recipe, quality,
          price: clampDishPrice(recipe.id, quality, requestedPrice ?? recipe.price),
          equipmentPenalty: equipmentId == null || equipmentId === recipe.requiredEquipmentId ? 0 : 1000,
          pricePenalty: requestedPrice == null
            ? 0 : Math.abs(clampDishPrice(recipe.id, quality, requestedPrice) - requestedPrice),
          qualityPenalty: fixedQuality == null ? quality - 1 : 0,
        })))
      .filter(candidate => candidate.price !== null)
      .sort((left, right) => left.equipmentPenalty - right.equipmentPenalty
        || left.pricePenalty - right.pricePenalty
        || left.qualityPenalty - right.qualityPenalty
        || left.recipe.id.localeCompare(right.recipe.id));
    const selected = candidates[0];
    if (!selected) throw new Error(`No unique authored test recipe for dish ${spec.id ?? index}`);

    const { recipe, price } = selected;
    usedRecipes.add(recipe.id);
    const name = typeof spec.name === 'string' && spec.name.trim()
      ? spec.name.trim()
      : recipe.name;
    entries[recipe.id] = {
      discovered: true,
      owned: true,
      paidPortions: 0,
      perk: null,
      menuSettings: { name, price, quality: selected.quality },
    };
    return {
      ...spec,
      id: spec.id ?? `test:${recipe.id}`,
      cookbookId: recipe.id,
      name,
      base: recipe.base,
      method: recipe.method,
      cuisine: recipe.cuisine,
      requiredEquipmentId: recipe.requiredEquipmentId,
      price,
      quality: selected.quality,
      prepTime: recipe.prepTime,
      popularity: recipe.popularity,
      masteryPerk: null,
      unlocked: true,
    };
  });

  return {
    ...state,
    cookbook: {
      ...cookbookSeed,
      ...state.cookbook,
      schemaVersion: 3,
      entries,
    },
    dishes,
  };
}
