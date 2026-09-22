export const MASTERY_PORTION_THRESHOLD = 15;

const equipment = equipmentId => ({ type: 'equipment', equipmentId });
const portions = (cookbookId, count) => ({ type: 'paidPortions', cookbookId, count });

export const COOKBOOK_RECIPES = Object.freeze([
  { id: 'toast', name: 'Toasted Bread', base: 'Bread', method: 'Toasted', requiredEquipmentId: 'eq1',
    prepTime: 60, popularity: 50, price: 12, requirements: [] },
  { id: 'cheese-toast', name: 'Cheese Toast', base: 'Cheese', method: 'Toasted', requiredEquipmentId: 'eq1',
    prepTime: 90, popularity: 65, price: 14, requirements: [portions('toast', 3)] },
  { id: 'roast-vegetables', name: 'Roast Vegetables', base: 'Vegetables', method: 'Roasted', requiredEquipmentId: 'eq2',
    prepTime: 150, popularity: 70, price: 18, requirements: [equipment('eq2')] },
  { id: 'baked-potato', name: 'Baked Potato', base: 'Potato', method: 'Baked', requiredEquipmentId: 'eq2',
    prepTime: 210, popularity: 82, price: 22, requirements: [equipment('eq2'), portions('roast-vegetables', 5)] },
  { id: 'fries', name: 'Crispy Fries', base: 'Potato', method: 'Fried', requiredEquipmentId: 'eq3',
    prepTime: 105, popularity: 55, price: 10, requirements: [equipment('eq3')] },
  { id: 'fried-chicken', name: 'Fried Chicken', base: 'Chicken', method: 'Fried', requiredEquipmentId: 'eq3',
    prepTime: 165, popularity: 78, price: 20, requirements: [equipment('eq3'), portions('fries', 5)] },
].map(recipe => Object.freeze({
  ...recipe, quality: 1, cuisine: 'generic',
  requirements: Object.freeze(recipe.requirements.map(requirement => Object.freeze(requirement))),
})));

export function getCookbookRecipe(cookbookId) {
  return COOKBOOK_RECIPES.find(recipe => recipe.id === cookbookId) || null;
}
