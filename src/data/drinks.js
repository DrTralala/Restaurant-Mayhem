export const DRINKS = Object.freeze([
  Object.freeze({ id: 'water', name: 'Water', price: 2, unlockCost: null }),
  Object.freeze({ id: 'tea', name: 'Tea', price: 4, unlockCost: 150 }),
  Object.freeze({ id: 'soda', name: 'Soda', price: 5, unlockCost: 200 }),
  Object.freeze({ id: 'coffee', name: 'Coffee', price: 6, unlockCost: 250 }),
  Object.freeze({ id: 'juice', name: 'Juice', price: 7, unlockCost: 350 }),
]);

export function getDrink(drinkId) {
  return DRINKS.find(drink => drink.id === drinkId) || null;
}
