import { getQueuePartyCount } from './customerQueue';

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export const CUSTOMER_PATIENCE = Object.freeze({
  regular: 15 * 60,
  foodie: 20 * 60,
  rusher: 10 * 60,
  influencer: 18 * 60,
});

export function getCustomerPatience(archetype, partySize = 1) {
  const basePatience = CUSTOMER_PATIENCE[archetype];
  if (!Number.isFinite(basePatience)) return 0;
  const size = Math.min(4, Math.max(1, Math.floor(finiteNumber(partySize, 1))));
  return basePatience * (1 + (size - 1) * 0.25);
}

export const ABANDONMENT_REPUTATION_PENALTY = 0.1;

export function clampReputation(value) {
  return Math.min(5, Math.max(1, finiteNumber(value, 1)));
}

export function getUpgradeEffect(state, type) {
  const upgrade = (state?.upgrades || []).find(candidate => candidate?.effects?.type === type);
  if (!upgrade) return 0;
  return finiteNumber(upgrade.effects?.value) * finiteNumber(upgrade.level);
}

export function getBaseArrivalRate(reputation) {
  const stars = clampReputation(reputation);
  return 0.00055 + (stars - 1) * 0.00005;
}

export function getQueuePatienceMultiplier(queue) {
  const parties = getQueuePartyCount(queue);
  return Math.min(1.5, 1 + Math.max(0, parties - 1) * 0.1);
}

export function getTipRate(happiness) {
  return Math.min(0.25, Math.max(0, finiteNumber(happiness) / 400));
}

export function getDishValueScore(dish) {
  return finiteNumber(dish?.popularity) + finiteNumber(dish?.quality) * 8 - finiteNumber(dish?.price) * 2;
}
