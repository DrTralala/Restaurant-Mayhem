export const DRINKS = Object.freeze([
  Object.freeze({
    id: 'water', name: 'Water', price: 2, unlockCost: null, quality: 1,
    popularity: 50, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null,
  }),
  Object.freeze({
    id: 'tea', name: 'Tea', price: 4, unlockCost: 150, quality: 1,
    popularity: 55, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null,
  }),
  Object.freeze({
    id: 'soda', name: 'Soda', price: 5, unlockCost: 200, quality: 1,
    popularity: 60, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null,
  }),
  Object.freeze({
    id: 'coffee', name: 'Coffee', price: 6, unlockCost: 250, quality: 1,
    popularity: 65, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null,
  }),
  Object.freeze({
    id: 'juice', name: 'Juice', price: 7, unlockCost: 350, quality: 1,
    popularity: 70, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null,
  }),
]);

export function getDrink(drinkId) {
  return DRINKS.find(drink => drink.id === drinkId) || null;
}

export function normaliseDrinkOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const normalised = {};
  for (const [drinkId, override] of Object.entries(value)) {
    const canonical = getDrink(drinkId);
    if (!canonical || !override || typeof override !== 'object' || Array.isArray(override)) continue;

    const changes = {};
    for (const key of ['price', 'quality']) {
      if (!Number.isFinite(override[key])) continue;
      const maximum = key === 'price' ? 100 : 10;
      const nextValue = Math.min(maximum, Math.max(1, Math.round(override[key])));
      if (nextValue !== canonical[key]) changes[key] = nextValue;
    }
    if (Object.keys(changes).length) normalised[drinkId] = changes;
  }
  return normalised;
}

export function getResolvedDrink(state, drinkId) {
  const canonical = getDrink(drinkId);
  if (!canonical) return null;
  const override = normaliseDrinkOverrides(state?.drinkOverrides)[drinkId] || {};
  return { ...canonical, ...override };
}
