export const ACTIVITY_DURATIONS = Object.freeze({
  takeOrder: 60,
  prepareDrink: 120,
  consumeDrink: 180,
  consumeFood: 480,
  consumeBoth: 600,
  takePayment: 60,
  wipeFloor: 120,
  manualWash: 300,
  automaticWash: 180,
});

export function getRemainingFraction(now, startedAt, duration) {
  if (![now, startedAt, duration].every(Number.isFinite) || duration <= 0) return null;
  return Math.min(1, Math.max(0, (duration - (now - startedAt)) / duration));
}
