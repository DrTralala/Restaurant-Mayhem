const SECONDS_PER_DAY = 86400;

/** The current menu-telemetry day, matching the restaurant clock convention. */
export function getCurrentMenuDay(state) {
  const day = state?.restaurant?.day;
  if (Number.isSafeInteger(day) && day >= 1) return day;
  const gameTime = state?.restaurant?.gameTime;
  if (Number.isFinite(gameTime) && gameTime >= 0) return Math.floor(gameTime / SECONDS_PER_DAY) + 1;
  return 1;
}
