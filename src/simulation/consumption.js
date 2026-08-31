import { ACTIVITY_DURATIONS, getRemainingFraction } from './activity';
import { enterCheckout, isCheckoutState } from './checkout';

const DIRTY_STATES = new Set([
  'dirty_at_table',
  'carried_dirty',
  'queued_for_wash',
  'washing',
]);

const PHYSICAL_ITEM_STATES = new Set([
  'ready',
  'on_service',
  'carried',
  'delivered',
  'to_clean',
  ...DIRTY_STATES,
]);

export function getItemConsumptionDuration(kind) {
  if (kind === 'dish') return ACTIVITY_DURATIONS.consumeFood;
  if (kind === 'drink') return ACTIVITY_DURATIONS.consumeDrink;
  return null;
}

export function startCustomerConsumption(customer, serviceItems, gameTime) {
  const orderedItems = serviceItems.filter(item =>
    item.customerId === customer.id && item.state === 'delivered');
  const orderedServiceItemIds = orderedItems.map(item => item.id);
  const orderedIds = new Set(orderedServiceItemIds);
  const consumedServiceItemIds = (customer.consumedServiceItemIds || [])
    .filter(id => orderedIds.has(id));
  return {
    customer: {
      ...customer,
      state: 'eating',
      eatTime: gameTime,
      orderedServiceItemIds,
      consumedServiceItemIds,
    },
    serviceItems: serviceItems.map(item => orderedIds.has(item.id)
      ? { ...item, consumptionStartedAt: item.consumptionStartedAt ?? gameTime }
      : item),
  };
}

function isPhysicalItem(item) {
  return PHYSICAL_ITEM_STATES.has(item.state);
}

function isConsumedItem(item) {
  return Number.isFinite(item.consumedAt) || DIRTY_STATES.has(item.state);
}

function uniqueIds(ids) {
  return [...new Set(ids)];
}

function getLegacyPhysicalIds(customer, items) {
  const expectedKinds = [
    customer.dishId ? 'dish' : null,
    customer.drinkId ? 'drink' : null,
  ].filter(Boolean);
  if (expectedKinds.length < 2) return items.map(item => item.id);

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftKind = expectedKinds.indexOf(left.item.kind);
      const rightKind = expectedKinds.indexOf(right.item.kind);
      const leftRank = leftKind === -1 ? expectedKinds.length : leftKind;
      const rightRank = rightKind === -1 ? expectedKinds.length : rightKind;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ item }) => item.id);
}

export function normaliseConsumptionState(customers, serviceItems, gameTime) {
  const customerList = customers || [];
  const itemList = serviceItems || [];
  const normalisedItems = itemList.map(item => {
    const owner = customerList.find(customer => customer.id === item.customerId);
    if (owner?.state !== 'eating' || !isPhysicalItem(item)
      || Number.isFinite(item.consumptionStartedAt)) return item;

    const consumptionStartedAt = Number.isFinite(owner.consumptionStartedAt)
      ? owner.consumptionStartedAt
      : gameTime;
    return consumptionStartedAt == null
      ? item
      : { ...item, consumptionStartedAt };
  });

  const normalisedCustomers = customerList.map(customer => {
    if (customer.state !== 'eating' && !isCheckoutState(customer)) return customer;

    const ownedItems = normalisedItems.filter(item => item.customerId === customer.id);
    const physicalItems = ownedItems.filter(isPhysicalItem);
    const existingOrderedIds = Array.isArray(customer.orderedServiceItemIds)
      ? customer.orderedServiceItemIds
      : [];
    const physicalIds = existingOrderedIds.length > 0
      ? physicalItems.map(item => item.id)
      : getLegacyPhysicalIds(customer, physicalItems);
    const orderedServiceItemIds = uniqueIds([...existingOrderedIds, ...physicalIds]);
    const orderedIds = new Set(orderedServiceItemIds);
    const existingConsumedIds = Array.isArray(customer.consumedServiceItemIds)
      ? customer.consumedServiceItemIds
      : [];
    const consumedServiceItemIds = uniqueIds(existingConsumedIds.filter(id => orderedIds.has(id)));
    const consumedIds = new Set(consumedServiceItemIds);

    for (const item of ownedItems) {
      if (!isConsumedItem(item) || !orderedIds.has(item.id) || consumedIds.has(item.id)) continue;
      consumedIds.add(item.id);
      consumedServiceItemIds.push(item.id);
    }

    return {
      ...customer,
      orderedServiceItemIds,
      consumedServiceItemIds,
    };
  });

  return { customers: normalisedCustomers, serviceItems: normalisedItems };
}

function isDue(item, gameTime) {
  const duration = getItemConsumptionDuration(item.kind);
  return Number.isFinite(gameTime)
    && Number.isFinite(item.consumptionStartedAt)
    && duration != null
    && gameTime - item.consumptionStartedAt >= duration;
}

function completeServiceItem(item, gameTime) {
  return {
    ...item,
    state: 'dirty_at_table',
    consumedAt: Number.isFinite(item.consumedAt) ? item.consumedAt : gameTime,
    dirtyAt: Number.isFinite(item.dirtyAt) ? item.dirtyAt : gameTime,
  };
}

export function advanceConsumption(state) {
  const gameTime = state.restaurant?.gameTime;
  const normalised = normaliseConsumptionState(
    state.customers || [],
    state.serviceItems || [],
    gameTime,
  );
  let serviceItems = normalised.serviceItems;
  const customers = normalised.customers.map(customer => {
    if (customer.state !== 'eating' && !isCheckoutState(customer)) return customer;

    const orderedServiceItemIds = Array.isArray(customer.orderedServiceItemIds)
      ? customer.orderedServiceItemIds
      : [];
    const consumedServiceItemIds = Array.isArray(customer.consumedServiceItemIds)
      ? [...customer.consumedServiceItemIds]
      : [];
    const consumedIds = new Set(consumedServiceItemIds);
    const checkoutCustomer = isCheckoutState(customer);

    serviceItems = serviceItems.map(item => {
      if (item.customerId !== customer.id
        || item.state !== 'delivered'
        || !orderedServiceItemIds.includes(item.id)
        || consumedIds.has(item.id)) return item;

      if (!checkoutCustomer && !isDue(item, gameTime)) return item;

      consumedIds.add(item.id);
      consumedServiceItemIds.push(item.id);
      return completeServiceItem(item, gameTime);
    });

    const updatedCustomer = {
      ...customer,
      consumedServiceItemIds,
    };
    const complete = orderedServiceItemIds.length > 0
      && orderedServiceItemIds.every(id => consumedIds.has(id));
    return complete && !isCheckoutState(customer)
      ? enterCheckout(updatedCustomer, gameTime)
      : updatedCustomer;
  });

  return { ...state, customers, serviceItems };
}

export function getCustomerConsumptionRemainingFraction(customer, serviceItems, gameTime) {
  const normalised = normaliseConsumptionState([customer], serviceItems || [], gameTime);
  const normalisedCustomer = normalised.customers[0] || customer;
  const consumedIds = new Set(normalisedCustomer.consumedServiceItemIds || []);
  let greatest = null;

  for (const item of normalised.serviceItems) {
    if (item.customerId !== customer.id
      || consumedIds.has(item.id)
      || isConsumedItem(item)) continue;
    const fraction = getRemainingFraction(
      gameTime,
      item.consumptionStartedAt,
      getItemConsumptionDuration(item.kind),
    );
    if (fraction == null) continue;
    greatest = greatest == null ? fraction : Math.max(greatest, fraction);
  }

  return greatest;
}
