// Timing only: callers retain their distinct assignment and reservation policies.
export function getInterruptedPreparationTiming(item, now) {
  if (!Number.isFinite(item.accumulatedWork) || item.accumulatedWork <= 0) {
    return { preparationStartedAt: null, readyAt: null, lastProgressAt: null };
  }
  if (!Number.isFinite(now)) return {};
  return { lastProgressAt: Math.max(Number.isFinite(item.lastProgressAt) ? item.lastProgressAt : now, now) };
}
