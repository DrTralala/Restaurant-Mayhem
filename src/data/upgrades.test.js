import { describe, expect, it, vi } from 'vitest';
import { getGlobalUpgradeQuote, UPGRADES } from './upgrades';

const upgrade = (level, costs, extra = {}) => ({
  id: 'u3', name: 'Faster Oven', level, costs, ...extra,
});

describe('getGlobalUpgradeQuote', () => {
  it('quotes the current level cost without requiring a known id', () => {
    expect(getGlobalUpgradeQuote(upgrade(0, [400, 800]), 1000)).toEqual({
      level: 0,
      nextLevel: 1,
      cost: 400,
      affordable: true,
    });
    expect(getGlobalUpgradeQuote({ level: 2, costs: [400, 800, 1600] }, 1600)).toEqual({
      level: 2,
      nextLevel: 3,
      cost: 1600,
      affordable: true,
    });
    expect(getGlobalUpgradeQuote(UPGRADES[0], 0)).toEqual({
      level: 0,
      nextLevel: 1,
      cost: 400,
      affordable: false,
    });
  });

  it('accepts a genuine zero cost and exact funds', () => {
    expect(getGlobalUpgradeQuote(upgrade(0, [0]), 0)).toEqual({
      level: 0,
      nextLevel: 1,
      cost: 0,
      affordable: true,
    });
    expect(getGlobalUpgradeQuote(upgrade(1, [400, 800]), 800)).toEqual({
      level: 1,
      nextLevel: 2,
      cost: 800,
      affordable: true,
    });
    expect(getGlobalUpgradeQuote(upgrade(1, [400, 800]), 799.99))
      .toMatchObject({ cost: 800, affordable: false });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', []],
    ['non-array', 'expensive'],
  ])('refuses %s costs instead of inventing a $0 price', (_label, costs) => {
    expect(getGlobalUpgradeQuote(upgrade(0, costs), 10000)).toBeNull();
  });

  it('refuses a sparse cost array at the current level', () => {
    const sparse = [400];
    sparse[2] = 1600;
    expect(getGlobalUpgradeQuote(upgrade(1, sparse), 10000)).toBeNull();
  });

  it.each([
    ['negative', [-100, 200]],
    ['NaN', [Number.NaN, 200]],
    ['infinite', [Number.POSITIVE_INFINITY]],
    ['negative infinite', [Number.NEGATIVE_INFINITY]],
  ])('refuses a %s current cost', (_label, costs) => {
    expect(getGlobalUpgradeQuote(upgrade(0, costs), 10000)).toBeNull();
  });

  it('ignores invalid costs outside the current level', () => {
    expect(getGlobalUpgradeQuote(upgrade(0, [400, Number.NaN]), 400)).toEqual({
      level: 0,
      nextLevel: 1,
      cost: 400,
      affordable: true,
    });
    expect(getGlobalUpgradeQuote(upgrade(1, [-5, 800, 'later']), 800)).toEqual({
      level: 1,
      nextLevel: 2,
      cost: 800,
      affordable: true,
    });
  });

  it.each([
    ['fractional', 0.5],
    ['negative', -1],
    ['at the cap', 2],
    ['above the cap', 3],
    ['missing', undefined],
    ['NaN', Number.NaN],
  ])('refuses a %s level', (_label, level) => {
    expect(getGlobalUpgradeQuote(upgrade(level, [400, 800]), 10000)).toBeNull();
  });

  it('keeps real terms but marks nonfinite funds unaffordable', () => {
    for (const funds of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null]) {
      expect(getGlobalUpgradeQuote(upgrade(0, [400]), funds)).toEqual({
        level: 0,
        nextLevel: 1,
        cost: 400,
        affordable: false,
      });
    }
  });

  it('does not mutate or reroll frozen input and does not use RNG', () => {
    const frozen = Object.freeze({
      id: 'custom',
      level: 1,
      costs: Object.freeze([400, 800]),
      effects: Object.freeze({ type: 'reputation', value: 0.1 }),
    });
    const random = vi.spyOn(Math, 'random');
    try {
      const first = getGlobalUpgradeQuote(frozen, 800);
      const second = getGlobalUpgradeQuote(frozen, 800);
      expect(first).toEqual(second);
      expect(first).toEqual({
        level: 1,
        nextLevel: 2,
        cost: 800,
        affordable: true,
      });
      expect(random).not.toHaveBeenCalled();
      expect(frozen).toEqual({
        id: 'custom',
        level: 1,
        costs: [400, 800],
        effects: { type: 'reputation', value: 0.1 },
      });
    } finally {
      random.mockRestore();
    }
  });

  it('returns null for missing upgrades without throwing', () => {
    expect(getGlobalUpgradeQuote(undefined, 1000)).toBeNull();
    expect(getGlobalUpgradeQuote(null, 1000)).toBeNull();
  });
});
