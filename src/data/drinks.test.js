import { describe, expect, it } from 'vitest';
import { DRINKS, getResolvedDrink, normaliseDrinkOverrides } from './drinks';

describe('drink menu records', () => {
  it('pins the five original canonical drinks and appends the Iced Tea trade-off', () => {
    expect(DRINKS).toEqual([
      Object.freeze({ id: 'water', name: 'Water', price: 2, unlockCost: null, quality: 1, popularity: 50, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null }),
      Object.freeze({ id: 'tea', name: 'Tea', price: 4, unlockCost: 150, quality: 1, popularity: 55, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null }),
      Object.freeze({ id: 'soda', name: 'Soda', price: 5, unlockCost: 200, quality: 1, popularity: 60, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null }),
      Object.freeze({ id: 'coffee', name: 'Coffee', price: 6, unlockCost: 250, quality: 1, popularity: 65, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null }),
      Object.freeze({ id: 'juice', name: 'Juice', price: 7, unlockCost: 350, quality: 1, popularity: 70, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null }),
      Object.freeze({ id: 'iced-tea', name: 'Iced Tea', price: 4, unlockCost: 150,
        quality: 1, popularity: 45, prepTime: 90, cuisine: 'beverage', requiredEquipmentId: null }),
    ]);
    expect(Object.isFrozen(DRINKS)).toBe(true);
    expect(DRINKS.every(drink => Object.isFrozen(drink))).toBe(true);
  });

  it('resolves Iced Tea overrides for price and quality only', () => {
    const state = {
      drinkOverrides: {
        'iced-tea': { price: 12, quality: 3, popularity: 99, prepTime: 5 },
      },
    };
    expect(getResolvedDrink(state, 'iced-tea')).toEqual({
      id: 'iced-tea', name: 'Iced Tea', price: 12, unlockCost: 150,
      quality: 3, popularity: 45, prepTime: 90, cuisine: 'beverage', requiredEquipmentId: null,
    });
  });

  it('merges only validated mutable overrides', () => {
    const state = { drinkOverrides: { tea: { price: 19, quality: 4, popularity: 100 } } };
    expect(getResolvedDrink(state, 'tea')).toMatchObject({ price: 19, quality: 4, popularity: 55 });
    expect(getResolvedDrink(state, 'missing')).toBeNull();
  });

  it('normalises known finite values and rejects unknown metadata', () => {
    expect(normaliseDrinkOverrides({
      water: { price: -4, quality: 99, popularity: 99 },
      tea: { price: Number.NaN, quality: 3.6 },
      missing: { price: 10, quality: 2 },
    })).toEqual({
      water: { price: 1, quality: 10 },
      tea: { quality: 4 },
    });
  });

  it('drops overrides that equal canonical defaults', () => {
    expect(normaliseDrinkOverrides({
      water: { price: 2, quality: 1 },
      tea: {},
    })).toEqual({});
  });
});
