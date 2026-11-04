import { describe, expect, it } from 'vitest';
import { COOKBOOK_RECIPES, getCookbookRecipe, MASTERY_PORTION_THRESHOLD } from './cookbook';
import { BASES, BASE_EQUIPMENT_MAP, METHODS } from './recipes';

describe('authored catalogue', () => {
  it('keeps canonical purchase costs separate from menu prices', () => {
    expect(COOKBOOK_RECIPES.map(({ id, purchaseCost, price }) => [id, purchaseCost, price])).toEqual([
      ['toast', 0, 12],
      ['cheese-toast', 75, 14],
      ['roast-vegetables', 150, 18],
      ['baked-eggs', 175, 15],
      ['baked-potato', 250, 22],
      ['fries', 100, 10],
      ['fried-chicken', 250, 20],
      ['gazpacho', 125, 16],
      ['fish-bisque', 225, 20],
    ]);
  });

  it('provides the nine deterministic equipment and discovery choices', () => {
    expect(COOKBOOK_RECIPES.map(({ id, base, method, requiredEquipmentId, prepTime, popularity, price }) =>
      [id, base, method, requiredEquipmentId, prepTime, popularity, price])).toEqual([
      ['toast', 'Bread', 'Toasted', 'eq1', 60, 50, 12],
      ['cheese-toast', 'Cheese', 'Toasted', 'eq1', 90, 65, 14],
      ['roast-vegetables', 'Vegetables', 'Roasted', 'eq2', 150, 70, 18],
      ['baked-eggs', 'Eggs', 'Baked', 'eq2', 120, 60, 15],
      ['baked-potato', 'Potato', 'Baked', 'eq2', 210, 82, 22],
      ['fries', 'Potato', 'Fried', 'eq3', 105, 55, 10],
      ['fried-chicken', 'Chicken', 'Fried', 'eq3', 165, 78, 20],
      ['gazpacho', 'Vegetables', 'Blended', 'eq4', 75, 55, 16],
      ['fish-bisque', 'Fish', 'Blended', 'eq4', 135, 68, 20],
    ]);
    expect(getCookbookRecipe('gazpacho').requirements).toEqual([{ type: 'equipment', equipmentId: 'eq4' }]);
    expect(getCookbookRecipe('fish-bisque')).toMatchObject({ name: 'Fish Bisque', base: 'Fish',
      method: 'Blended', requiredEquipmentId: 'eq4', prepTime: 135, popularity: 68,
      price: 20, quality: 1, cuisine: 'generic', requirements: [
        { type: 'equipment', equipmentId: 'eq4' },
        { type: 'paidPortions', cookbookId: 'gazpacho', count: 5 },
      ] });
    expect(getCookbookRecipe('baked-eggs')).toMatchObject({ name: 'Baked Eggs', base: 'Eggs',
      method: 'Baked', requiredEquipmentId: 'eq2', prepTime: 120, popularity: 60,
      price: 15, quality: 1, cuisine: 'generic', requirements: [
        { type: 'equipment', equipmentId: 'eq2' },
        { type: 'paidPortions', cookbookId: 'roast-vegetables', count: 3 },
      ] });
    expect(MASTERY_PORTION_THRESHOLD).toBe(15);
    expect(getCookbookRecipe('missing')).toBeNull();
    expect(getCookbookRecipe('toString')).toBeNull();
    expect(Object.isFrozen(COOKBOOK_RECIPES)).toBe(true);
    for (const recipe of COOKBOOK_RECIPES) {
      expect(recipe).toMatchObject({ quality: 1, cuisine: 'generic' });
      expect(BASES).toContain(recipe.base);
      expect(METHODS).toContain(recipe.method);
      expect(BASE_EQUIPMENT_MAP[recipe.method]).toBe(recipe.requiredEquipmentId);
      expect(Object.isFrozen(recipe)).toBe(true);
      expect(Object.isFrozen(recipe.requirements)).toBe(true);
      recipe.requirements.forEach(requirement => expect(Object.isFrozen(requirement)).toBe(true));
    }
  });
});
