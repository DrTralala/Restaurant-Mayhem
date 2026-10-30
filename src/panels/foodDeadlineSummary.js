import { getFoodPatienceFraction } from '../simulation/foodPatience';

const MAX_FOOD_TRIAGE_ORDERS = 5;
const PENDING_DISH_STAGES = new Set(['ordered', 'preparing', 'ready', 'on_service', 'carried']);

function hasValidFoodTimer(customer) {
  return getFoodPatienceFraction(customer, 0) !== null;
}

function recordedIdentity(value) {
  return (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : null;
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

function identityKey(value) {
  const identity = recordedIdentity(value);
  return identity === null ? null : String(identity);
}

function addToIndex(index, key, value) {
  if (key === null) return;
  const values = index.get(key) || [];
  values.push(value);
  index.set(key, values);
}

function serviceItemIndexes(state) {
  const byOwner = new Map();
  const byId = new Map();
  const ownerCounts = new Map();
  const customers = Array.isArray(state?.customers) ? state.customers : [];
  const items = Array.isArray(state?.serviceItems) ? state.serviceItems : [];

  for (const customer of customers) {
    const ownerKey = identityKey(customer?.id);
    if (ownerKey !== null) ownerCounts.set(ownerKey, (ownerCounts.get(ownerKey) || 0) + 1);
  }
  for (const item of items) {
    addToIndex(byOwner, identityKey(item?.customerId), item);
    addToIndex(byId, identityKey(item?.id), item);
  }

  return { byOwner, byId, ownerCounts };
}

function hasCancelledServiceItem(customer, item) {
  const itemKey = identityKey(item?.id);
  return itemKey !== null
    && (Array.isArray(customer?.cancelledServiceItemIds)
      ? customer.cancelledServiceItemIds
      : []).some(id => identityKey(id) === itemKey);
}

function pendingDishStage(customer, item) {
  if (customer?.state === 'leaving' || customer?.foodOutcome === 'cancelled'
    || item?.kind !== 'dish' || !PENDING_DISH_STAGES.has(item?.state)
    || item?.foodCancelled === true || item?.deliveryProhibited === true
    || hasCancelledServiceItem(customer, item)) return null;
  return item.state;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pinnedDishStage(customer, indexes, ownerKey) {
  const snapshot = customer.dishOrderSnapshot;
  const itemKey = identityKey(snapshot?.serviceItemId);
  if (!isObject(snapshot) || itemKey === null) return null;

  const matches = indexes.byId.get(itemKey) || [];
  if (matches.length !== 1) return null;
  const item = matches[0];
  if (identityKey(item?.customerId) !== ownerKey || item?.kind !== 'dish') return null;

  const snapshotDishKey = identityKey(snapshot.menuItemId);
  const customerDishKey = identityKey(customer?.dishId);
  const itemDishKey = identityKey(item?.menuItemId);
  if ((snapshotDishKey !== null && snapshotDishKey !== itemDishKey)
    || (customerDishKey !== null && customerDishKey !== itemDishKey)) return null;

  if (Object.hasOwn(item, 'dishOrderSnapshot')) {
    const itemSnapshot = item.dishOrderSnapshot;
    if (!isObject(itemSnapshot)
      || identityKey(itemSnapshot.serviceItemId) !== itemKey
      || (identityKey(itemSnapshot.menuItemId) !== null
        && identityKey(itemSnapshot.menuItemId) !== itemDishKey)) return null;
  }

  return pendingDishStage(customer, item);
}

function legacyDishStage(customer, indexes, ownerKey) {
  const dishKey = identityKey(customer?.dishId);
  if (dishKey === null) return null;
  const matches = (indexes.byOwner.get(ownerKey) || []).filter(item =>
    item?.kind === 'dish' && identityKey(item.menuItemId) === dishKey);
  if (matches.length !== 1 || Object.hasOwn(matches[0], 'dishOrderSnapshot')) return null;
  return pendingDishStage(customer, matches[0]);
}

function foodServiceStage(customer, indexes) {
  const ownerKey = identityKey(customer?.id);
  if (ownerKey === null || indexes.ownerCounts.get(ownerKey) !== 1) return null;
  return Object.hasOwn(customer, 'dishOrderSnapshot')
    ? pinnedDishStage(customer, indexes, ownerKey)
    : legacyDishStage(customer, indexes, ownerKey);
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
  const indexes = serviceItemIndexes(state);
  const orders = pendingFoodCustomers(state).map(({ customer, index, hasValidTimer }) => {
    const deadlineAt = hasValidTimer ? customer.foodDeadlineAt : null;
    return {
      customerId: recordedIdentity(customer?.id),
      dishId: recordedIdentity(customer?.dishId),
      tableId: recordedIdentity(customer?.tableId),
      deadlineAt,
      remainingSeconds: Number.isFinite(now) && deadlineAt !== null
        ? Math.max(0, deadlineAt - now)
        : null,
      stage: foodServiceStage(customer, indexes),
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
