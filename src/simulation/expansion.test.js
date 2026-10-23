import { describe, expect, it, vi } from 'vitest';
import { EXPANSION_COSTS, getExpansionPreview } from './expansion';

describe('expansion cost table', () => {
  it('keeps the shared cost table frozen for consumers', () => {
    expect(Object.isFrozen(EXPANSION_COSTS)).toBe(true);
  });
});

describe('getExpansionPreview', () => {
  it('describes the level 1 purchase with literal floor sizes and funds after purchase', () => {
    expect(getExpansionPreview({ expansionLevel: 1, funds: 1000 })).toEqual({
      level: 1,
      nextLevel: 2,
      cost: 1000,
      currentFloor: { width: 43, height: 31 },
      nextFloor: { width: 52, height: 37 },
      affordable: true,
      fundsAfterPurchase: 0,
    });
  });

  it.each([
    [1, 1000, 2, 1000, { width: 43, height: 31 }, { width: 52, height: 37 }, 0],
    [2, 3000, 3, 3000, { width: 52, height: 37 }, { width: 61, height: 43 }, 0],
    [3, 6000, 4, 6000, { width: 61, height: 43 }, { width: 70, height: 49 }, 0],
  ])('pins level %i terms, price and both floor sizes', (level, funds, nextLevel, cost, currentFloor, nextFloor, fundsAfterPurchase) => {
    expect(getExpansionPreview({ expansionLevel: level, funds })).toEqual({
      level,
      nextLevel,
      cost,
      currentFloor,
      nextFloor,
      affordable: true,
      fundsAfterPurchase,
    });
  });

  it('reports the maximum level without next-purchase terms', () => {
    expect(getExpansionPreview({ expansionLevel: 4, funds: 20000 })).toEqual({
      level: 4,
      nextLevel: null,
      cost: null,
      currentFloor: { width: 70, height: 49 },
      nextFloor: null,
      affordable: false,
      fundsAfterPurchase: null,
    });
  });

  it.each([
    ['exact funds', 1000, true, 0],
    ['just below funds', 999.99, false, null],
    ['funds above cost', 1000.5, true, 0.5],
  ])('resolves the %s boundary at level 1', (_label, funds, affordable, fundsAfterPurchase) => {
    expect(getExpansionPreview({ expansionLevel: 1, funds }))
      .toMatchObject({ affordable, fundsAfterPurchase });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['string', '1'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['above maximum', 5],
  ])('returns null for a %s expansion level', (_label, expansionLevel) => {
    expect(getExpansionPreview({ expansionLevel, funds: 20000 })).toBeNull();
  });

  it('returns null when the restaurant or its level is missing', () => {
    expect(getExpansionPreview()).toBeNull();
    expect(getExpansionPreview({})).toBeNull();
    expect(getExpansionPreview({ funds: 1000 })).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['string', '1000'],
  ])('marks %s funds as unaffordable without inventing a balance', (_label, funds) => {
    expect(getExpansionPreview({ expansionLevel: 1, funds }))
      .toMatchObject({ affordable: false, fundsAfterPurchase: null });
  });

  it('does not mutate its input, share nested values or consume randomness', () => {
    const restaurant = { expansionLevel: 2, funds: 5000 };
    const before = structuredClone(restaurant);
    const random = vi.spyOn(Math, 'random');
    try {
      const first = getExpansionPreview(restaurant);
      const second = getExpansionPreview(restaurant);

      expect(restaurant).toEqual(before);
      expect(first.currentFloor).not.toBe(second.currentFloor);
      expect(first.nextFloor).not.toBe(second.nextFloor);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});
