import { getFoodPatienceFraction } from '../simulation/foodPatience';

function hasValidFoodTimer(customer) {
  return getFoodPatienceFraction(customer, 0) !== null;
}

export function getFoodDeadlineSummary(state, now = state?.restaurant?.gameTime) {
  let pendingCount = 0;
  let knownCount = 0;
  let unknownCount = 0;
  let deadlineAt = null;

  for (const customer of Array.isArray(state?.customers) ? state.customers : []) {
    const outcome = customer?.foodOutcome;
    const explicitPending = outcome === 'pending';
    const legacyPending = outcome == null && hasValidFoodTimer(customer);
    if (!explicitPending && !legacyPending) continue;

    pendingCount++;
    if (!hasValidFoodTimer(customer)) {
      unknownCount++;
      continue;
    }

    knownCount++;
    if (deadlineAt === null || customer.foodDeadlineAt < deadlineAt) {
      deadlineAt = customer.foodDeadlineAt;
    }
  }

  const remainingSeconds = Number.isFinite(now) && deadlineAt !== null
    ? Math.max(0, deadlineAt - now)
    : null;

  return { pendingCount, knownCount, unknownCount, deadlineAt, remainingSeconds };
}
