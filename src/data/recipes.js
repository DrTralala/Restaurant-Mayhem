export const CUSTOM_RECIPE_STATS = Object.freeze({
  prepTime: Object.freeze({ min: 120, max: 239 }),
  popularity: Object.freeze({ min: 30, max: 59 }),
});

export const BASES = [
  'Bread', 'Pasta', 'Rice', 'Potato', 'Chicken', 'Beef', 'Fish', 'Vegetables', 'Eggs', 'Cheese',
];

export const METHODS = [
  'Grilled', 'Fried', 'Baked', 'Toasted', 'Steamed', 'Roasted', 'Boiled', 'Sauteed', 'Blended', 'Brewed',
];

export const BASE_EQUIPMENT_MAP = {
  'Grilled': 'eq2',
  'Fried': 'eq3',
  'Baked': 'eq2',
  'Toasted': 'eq1',
  'Steamed': 'eq2',
  'Roasted': 'eq2',
  'Boiled': 'eq2',
  'Sauteed': 'eq3',
  'Blended': 'eq4',
  'Brewed': 'eq5',
};
