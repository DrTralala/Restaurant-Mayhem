import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../data/upgrades';
import { getGlobalUpgradeEffectPreview } from './globalUpgradePurchase';

const wallArt = UPGRADES.find(upgrade => upgrade.id === 'u7');

describe('getGlobalUpgradeEffectPreview', () => {
  it('projects the ordinary reputation gain', () => {
    const result = getGlobalUpgradeEffectPreview(wallArt, 2);

    expect(result).toMatchObject({ canApply: true, reputationAfterPurchase: 2.1 });
    expect(result.reputationGain).toBeCloseTo(0.1);
  });

  it('rejects a reputation gain when already at the cap', () => {
    expect(getGlobalUpgradeEffectPreview(wallArt, 5)).toEqual({
      canApply: false,
      reputationAfterPurchase: 5,
      reputationGain: 0,
    });
  });

  it('projects only the achievable partial gain below the cap', () => {
    const result = getGlobalUpgradeEffectPreview(wallArt, 4.95);

    expect(result).toMatchObject({ canApply: true, reputationAfterPurchase: 5 });
    expect(result.reputationGain).toBeCloseTo(0.05);
  });

  it('preserves reputation for non-reputation upgrades', () => {
    expect(getGlobalUpgradeEffectPreview(UPGRADES[0], 4.25)).toEqual({
      canApply: true,
      reputationAfterPurchase: 4.25,
      reputationGain: 0,
    });
  });

  it.each([
    ['a non-finite current reputation', wallArt, Number.NaN],
    ['a missing effect value', { effects: { type: 'reputation' } }, 3],
    ['a zero effect value', { effects: { type: 'reputation', value: 0 } }, 3],
    ['a negative effect value', { effects: { type: 'reputation', value: -0.1 } }, 3],
    ['a non-finite effect value', { effects: { type: 'reputation', value: Number.NaN } }, 3],
    ['an infinite effect value', { effects: { type: 'reputation', value: Number.POSITIVE_INFINITY } }, 3],
  ])('rejects %s without projecting a gain', (_label, upgrade, reputation) => {
    const result = getGlobalUpgradeEffectPreview(upgrade, reputation);

    expect(result.canApply).toBe(false);
    expect(result.reputationAfterPurchase).toBe(reputation);
    expect(result.reputationGain).toBe(0);
  });

  it('does not mutate the upgrade or depend on mutable caller inputs', () => {
    const frozenUpgrade = Object.freeze({
      effects: Object.freeze({ type: 'reputation', value: 0.1 }),
    });

    const first = getGlobalUpgradeEffectPreview(frozenUpgrade, 4.95);
    const second = getGlobalUpgradeEffectPreview(frozenUpgrade, 4.95);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ canApply: true, reputationAfterPurchase: 5 });
    expect(first.reputationGain).toBeCloseTo(0.05);
    expect(frozenUpgrade.effects).toEqual({ type: 'reputation', value: 0.1 });
  });
});
