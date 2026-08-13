function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function clampReputation(value) {
  return Math.min(5, Math.max(1, finiteNumber(value, 1)));
}

export function getUpgradeEffect(state, type) {
  const upgrade = (state?.upgrades || []).find(candidate => candidate?.effects?.type === type);
  if (!upgrade) return 0;
  return finiteNumber(upgrade.effects?.value) * finiteNumber(upgrade.level);
}

export function getQueuePatienceMultiplier(queue) {
  const parties = new Set((queue || []).map((customer, index) => customer?.partyId ?? customer?.id ?? index)).size;
  return Math.min(2, 1 + Math.max(0, parties - 1) * 0.1);
}

export function getTipRate(happiness) {
  return Math.min(0.25, Math.max(0, finiteNumber(happiness) / 400));
}

export function getDishValueScore(dish) {
  return finiteNumber(dish?.popularity) + finiteNumber(dish?.quality) * 8 - finiteNumber(dish?.price) * 2;
}
