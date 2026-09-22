import { describe, expect, it } from 'vitest';
import { COOKBOOK_RECIPES, getCookbookRecipe, MASTERY_PORTION_THRESHOLD } from './cookbook';

describe('authored catalogue', () => {
  it('provides the six deterministic equipment and discovery choices', () => {
    expect(COOKBOOK_RECIPES.map(({ id, base, method, requiredEquipmentId, prepTime, popularity, price }) =>
      [id, base, method, requiredEquipmentId, prepTime, popularity, price])).toEqual([
      ['toast', 'Bread', 'Toasted', 'eq1', 60, 50, 12],
      ['cheese-toast', 'Cheese', 'Toasted', 'eq1', 90, 65, 14],
      ['roast-vegetables', 'Vegetables', 'Roasted', 'eq2', 150, 70, 18],
      ['baked-potato', 'Potato', 'Baked', 'eq2', 210, 82, 22],
      ['fries', 'Potato', 'Fried', 'eq3', 105, 55, 10],
      ['fried-chicken', 'Chicken', 'Fried', 'eq3', 165, 78, 20],
    ]);
    expect(MASTERY_PORTION_THRESHOLD).toBe(15);
    expect(getCookbookRecipe('missing')).toBeNull();
    expect(getCookbookRecipe('toString')).toBeNull();
    expect(Object.isFrozen(COOKBOOK_RECIPES)).toBe(true);
    for (const recipe of COOKBOOK_RECIPES) {
      expect(recipe).toMatchObject({ quality: 1, cuisine: 'generic' });
      expect(Object.isFrozen(recipe)).toBe(true);
      expect(Object.isFrozen(recipe.requirements)).toBe(true);
      recipe.requirements.forEach(requirement => expect(Object.isFrozen(requirement)).toBe(true));
    }
  });
});
