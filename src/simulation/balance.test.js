import { describe, expect, it } from 'vitest';
import {
  clampReputation,
  getDishValueScore,
  getQueuePatienceMultiplier,
  getTipRate,
  getUpgradeEffect,
} from './balance';

describe('balance helpers', () => {
  it('clamps reputation to the 1.0 through 5.0 range', () => {
    expect(clampReputation(0.5)).toBe(1);
    expect(clampReputation(3.2)).toBe(3.2);
    expect(clampReputation(5.5)).toBe(5);
  });

  it('calculates configured upgrade effects and tolerates absent upgrade state', () => {
    const state = {
      upgrades: [{ level: 2, effects: { type: 'happiness', value: 5 } }],
    };

    expect(getUpgradeEffect(state, 'happiness')).toBe(10);
    expect(getUpgradeEffect({}, 'happiness')).toBe(0);
  });

  it('adds queue pressure after the first party', () => {
    const oneParty = [{ id: 'c1', partyId: 'p1' }, { id: 'c2', partyId: 'p1' }];
    const sixParties = Array.from({ length: 6 }, (_, index) => ({
      id: `c${index}`,
      partyId: `p${index}`,
    }));

    expect(getQueuePatienceMultiplier(oneParty)).toBe(1);
    expect(getQueuePatienceMultiplier(sixParties)).toBe(1.5);
  });

  it('preserves a 20% tip at 80 happiness', () => {
    expect(getTipRate(80)).toBe(0.2);
  });

  it('values a reasonably priced dish over an exploitatively priced one', () => {
    const goodValue = { popularity: 70, quality: 7, price: 20 };
    const overpriced = { popularity: 90, quality: 8, price: 100 };

    expect(getDishValueScore(goodValue)).toBeGreaterThan(getDishValueScore(overpriced));
  });
});
