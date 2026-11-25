import { getFoodPatienceFraction } from '../simulation/foodPatience';
import {
  createDishRushIndex,
  getDishServiceItem,
  getRushableDishFromIndex,
  recordedIdentity,
} from '../simulation/dishRush';

const MAX_FOOD_TRIAGE_ORDERS = 5;

function hasValidFoodTimer(customer) {
  return getFoodPatienceFraction(customer, 0) !== null;
}

function pendingFoodCustomers(state) {
  const entries = [];
  const customers = Array.isArray(state?.customers) ? state.customers : [];
  customers.forEach((customer, index) => {
    const outcome = customer?.foodOutcome;
    const hasValidTimer = hasValidFoodTimer(customer);
    if (outcome !== 'pending' && !(outcome == null && hasValidTimer)) return;
    entries.push({ customer, index, hasValidTimer });
  });
  return entries;
}

export function getFoodDeadlineSummary(state, now = state?.restaurant?.gameTime) {
  let pendingCount = 0;
  let knownCount = 0;
  let unknownCount = 0;
  let deadlineAt = null;
  let target = null;

  for (const { customer, hasValidTimer } of pendingFoodCustomers(state)) {
    pendingCount++;
    if (!hasValidTimer) {
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

export function getFoodServiceTriage(state, now = state?.restaurant?.gameTime) {
  const indexes = createDishRushIndex(state);
  const orders = pendingFoodCustomers(state).map(({ customer, index, hasValidTimer }) => {
    const deadlineAt = hasValidTimer ? customer.foodDeadlineAt : null;
    const dish = getDishServiceItem(customer, indexes);
    const rushableDish = dish ? getRushableDishFromIndex(indexes, dish.id) : null;
    return {
      customerId: recordedIdentity(customer?.id),
      dishId: recordedIdentity(customer?.dishId),
      tableId: recordedIdentity(customer?.tableId),
      deadlineAt,
      remainingSeconds: Number.isFinite(now) && deadlineAt !== null
        ? Math.max(0, deadlineAt - now)
        : null,
      stage: dish?.state ?? null,
      rushableDishId: recordedIdentity(rushableDish?.id),
      inputIndex: index,
    };
  });

  orders.sort((left, right) => {
    if (left.deadlineAt === null && right.deadlineAt !== null) return 1;
    if (left.deadlineAt !== null && right.deadlineAt === null) return -1;
    if (left.deadlineAt !== null && right.deadlineAt !== null
      && left.deadlineAt !== right.deadlineAt) return left.deadlineAt - right.deadlineAt;
    return left.inputIndex - right.inputIndex;
  });

  return {
    orders: orders.slice(0, MAX_FOOD_TRIAGE_ORDERS).map(({ inputIndex, ...order }) => order),
    omittedCount: Math.max(0, orders.length - MAX_FOOD_TRIAGE_ORDERS),
  };
}
