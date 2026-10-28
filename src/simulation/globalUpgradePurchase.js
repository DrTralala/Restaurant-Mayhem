import { clampReputation } from './balance';

export function getGlobalUpgradeEffectPreview(upgrade, reputation) {
  if (upgrade?.effects?.type !== 'reputation') {
    return { canApply: true, reputationAfterPurchase: reputation, reputationGain: 0 };
  }

  const effectValue = upgrade.effects.value;
  if (!Number.isFinite(effectValue) || effectValue <= 0 || !Number.isFinite(reputation)) {
    return { canApply: false, reputationAfterPurchase: reputation, reputationGain: 0 };
  }

  const reputationAfterPurchase = clampReputation(reputation + effectValue);
  return {
    canApply: reputationAfterPurchase > reputation,
    reputationAfterPurchase,
    reputationGain: reputationAfterPurchase - reputation,
  };
}
