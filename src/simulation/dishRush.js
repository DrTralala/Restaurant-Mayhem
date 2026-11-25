import { getFoodPatienceFraction } from './foodPatience';

const PENDING_DISH_STAGES = new Set(['ordered', 'preparing', 'ready', 'on_service', 'carried']);

export function recordedIdentity(value) {
  return ((typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value)))
    ? value
    : null;
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

export function createDishRushIndex(state) {
  const byOwner = new Map();
  const byId = new Map();
  const customersById = new Map();
  const ownerCounts = new Map();
  const claimedServiceItemIds = new Set();
  const customers = Array.isArray(state?.customers) ? state.customers : [];
  const items = Array.isArray(state?.serviceItems) ? state.serviceItems : [];

  for (const customer of customers) {
    const ownerKey = identityKey(customer?.id);
    if (ownerKey === null) continue;
    ownerCounts.set(ownerKey, (ownerCounts.get(ownerKey) || 0) + 1);
    addToIndex(customersById, ownerKey, customer);
  }
  for (const item of items) {
    addToIndex(byOwner, identityKey(item?.customerId), item);
    addToIndex(byId, identityKey(item?.id), item);
  }
  for (const id of Array.isArray(state?.__staffClaimedServiceItemIds)
    ? state.__staffClaimedServiceItemIds : []) {
    const key = identityKey(id);
    if (key !== null) claimedServiceItemIds.add(key);
  }
  for (const worker of Array.isArray(state?.staff) ? state.staff : []) {
    const task = worker?.task;
    for (const id of [task?.serviceItemId,
      ...(Array.isArray(task?.serviceItemIds) ? task.serviceItemIds : [])]) {
      const key = identityKey(id);
      if (key !== null) claimedServiceItemIds.add(key);
    }
  }

  return { byOwner, byId, customersById, ownerCounts, claimedServiceItemIds };
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

function pinnedDishItem(customer, indexes, ownerKey) {
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

  return pendingDishStage(customer, item) === null ? null : item;
}

function legacyDishItem(customer, indexes, ownerKey) {
  const dishKey = identityKey(customer?.dishId);
  if (dishKey === null) return null;
  const matches = (indexes.byOwner.get(ownerKey) || []).filter(item =>
    item?.kind === 'dish' && identityKey(item.menuItemId) === dishKey);
  if (matches.length !== 1 || Object.hasOwn(matches[0], 'dishOrderSnapshot')) return null;
  return pendingDishStage(customer, matches[0]) === null ? null : matches[0];
}

export function getDishServiceItem(customer, indexes) {
  const ownerKey = identityKey(customer?.id);
  if (ownerKey === null || indexes.ownerCounts.get(ownerKey) !== 1) return null;
  return Object.hasOwn(customer, 'dishOrderSnapshot')
    ? pinnedDishItem(customer, indexes, ownerKey)
    : legacyDishItem(customer, indexes, ownerKey);
}

function hasPendingFoodOrder(customer) {
  return customer?.foodOutcome === 'pending'
    || (customer?.foodOutcome == null && getFoodPatienceFraction(customer, 0) !== null);
}

export function getRushableDishFromIndex(indexes, serviceItemId) {
  const itemKey = identityKey(serviceItemId);
  if (itemKey === null) return null;
  const matches = indexes.byId.get(itemKey) || [];
  if (matches.length !== 1) return null;
  const item = matches[0];
  if (item?.kind !== 'dish' || item?.state !== 'ordered'
    || item?.assignedStaffId != null || indexes.claimedServiceItemIds.has(itemKey)) return null;

  const ownerKey = identityKey(item?.customerId);
  if (ownerKey === null || indexes.ownerCounts.get(ownerKey) !== 1) return null;
  const customer = indexes.customersById.get(ownerKey)?.[0];
  if (!hasPendingFoodOrder(customer) || getDishServiceItem(customer, indexes) !== item) return null;
  return item;
}

export function getRushableDish(state, serviceItemId) {
  return getRushableDishFromIndex(createDishRushIndex(state), serviceItemId);
}
