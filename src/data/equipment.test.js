import { describe, expect, it, vi } from 'vitest';
import { getEquipmentUpgradeQuote } from './equipment';

const owned = (level, upgradeCosts) => ({
  id: 'eq1', name: 'Toaster', owned: true, level, upgradeCosts, purchaseCost: 200,
});

describe('getEquipmentUpgradeQuote', () => {
  it('quotes a level 1 upgrade from the canonical cost and next-level multipliers', () => {
    expect(getEquipmentUpgradeQuote(owned(1, [100, 200]), 1000)).toEqual({
      level: 1,
      nextLevel: 2,
      cost: 100,
      affordable: true,
      speedMultiplier: 1.1,
      qualityBonus: 0.05,
    });
  });

  it('quotes a level 9 upgrade to the level 10 cap', () => {
    const costs = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];
    expect(getEquipmentUpgradeQuote(owned(9, costs), 25600)).toEqual({
      level: 9,
      nextLevel: 10,
      cost: 25600,
      affordable: true,
      speedMultiplier: 1.9,
      qualityBonus: 0.45,
    });
  });

  it('treats level 10 as the upgrade maximum', () => {
    const costs = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];
    expect(getEquipmentUpgradeQuote(owned(10, costs), 100000)).toBeNull();
    expect(getEquipmentUpgradeQuote(owned(11, costs), 100000)).toBeNull();
  });

  it.each([
    ['fractional', 1.5],
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['missing', undefined],
  ])('refuses a %s level instead of inventing a $0 price', (_label, level) => {
    expect(getEquipmentUpgradeQuote(owned(level, [100, 200]), 1000)).toBeNull();
  });

  it.each([
    ['empty', []],
    ['missing', undefined],
    ['short', [100]],
    ['non-numeric', [Number.NaN]],
    ['infinite', [Number.POSITIVE_INFINITY]],
    ['negative', [-100]],
  ])('refuses a %s cost entry', (_label, upgradeCosts) => {
    expect(getEquipmentUpgradeQuote(owned(2, upgradeCosts), 1000)).toBeNull();
  });

  it('refuses unowned equipment', () => {
    expect(getEquipmentUpgradeQuote({ ...owned(1, [100]), owned: false }, 1000)).toBeNull();
  });

  it('refuses a level 1 upgrade with no cost entry without inventing $0', () => {
    expect(getEquipmentUpgradeQuote(owned(1, []), 1000)).toBeNull();
    expect(getEquipmentUpgradeQuote({ id: 'eq1', owned: true, level: 1 }, 1000)).toBeNull();
  });

  it('keeps the canonical cost and marks nonfinite funds as unaffordable', () => {
    for (const funds of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
      expect(getEquipmentUpgradeQuote(owned(1, [100]), funds)).toMatchObject({
        cost: 100,
        affordable: false,
      });
    }
  });

  it('accepts a zero-cost upgrade exactly when funds cover zero', () => {
    expect(getEquipmentUpgradeQuote(owned(1, [0]), 0)).toMatchObject({ cost: 0, affordable: true });
    expect(getEquipmentUpgradeQuote(owned(1, [0]), -1)).toMatchObject({ cost: 0, affordable: false });
  });

  it('does not mutate or reroll frozen equipment and does not use RNG', () => {
    const equipment = Object.freeze({
      id: 'eq1', name: 'Toaster', owned: true, level: 1,
      upgradeCosts: Object.freeze([100, 200]), purchaseCost: 200,
    });
    const random = vi.spyOn(Math, 'random');
    try {
      const first = getEquipmentUpgradeQuote(equipment, 1000);
      const second = getEquipmentUpgradeQuote(equipment, 1000);
      expect(first).toEqual(second);
      expect(first).toMatchObject({ cost: 100, speedMultiplier: 1.1 });
      expect(random).not.toHaveBeenCalled();
      expect(equipment).toEqual({
        id: 'eq1', name: 'Toaster', owned: true, level: 1,
        upgradeCosts: [100, 200], purchaseCost: 200,
      });
    } finally {
      random.mockRestore();
    }
  });

  it('returns null for missing equipment without throwing', () => {
    expect(getEquipmentUpgradeQuote(undefined, 1000)).toBeNull();
    expect(getEquipmentUpgradeQuote(null, 1000)).toBeNull();
  });
});
