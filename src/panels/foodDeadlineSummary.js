import { getFoodPatienceFraction } from '../simulation/foodPatience';

function hasValidFoodTimer(customer) {
  return getFoodPatienceFraction(customer, 0) !== null;
}

function recordedIdentity(value) {
  return (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : null;
}

export function getFoodDeadlineSummary(state, now = state?.restaurant?.gameTime) {
  let pendingCount = 0;
  let knownCount = 0;
  let unknownCount = 0;
  let deadlineAt = null;
  let target = null;

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
      target = {
        customerId: recordedIdentity(customer.id),
        dishId: recordedIdentity(customer.dishId),
        tableId: recordedIdentity(customer.tableId),
      };
    }
  }

  const remainingSeconds = Number.isFinite(now) && deadlineAt !== null
    ? Math.max(0, deadlineAt - now)
    : null;

  return { pendingCount, knownCount, unknownCount, deadlineAt, remainingSeconds, target };
}
