import { describe, expect, it } from 'vitest';
import { DRINKS, getResolvedDrink, normaliseDrinkOverrides } from './drinks';

describe('drink menu records', () => {
  it('exposes dish-equivalent canonical attributes without changing tiers', () => {
    expect(DRINKS).toEqual([
      expect.objectContaining({ id: 'water', price: 2, unlockCost: null, quality: 1, popularity: 50, prepTime: 120, cuisine: 'beverage', requiredEquipmentId: null }),
      expect.objectContaining({ id: 'tea', price: 4, unlockCost: 150, quality: 1, popularity: 55 }),
      expect.objectContaining({ id: 'soda', price: 5, unlockCost: 200, quality: 1, popularity: 60 }),
      expect.objectContaining({ id: 'coffee', price: 6, unlockCost: 250, quality: 1, popularity: 65 }),
      expect.objectContaining({ id: 'juice', price: 7, unlockCost: 350, quality: 1, popularity: 70 }),
    ]);
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
