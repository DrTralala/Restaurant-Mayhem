import { isCheckoutState } from './checkout';
import {
  completeCookingBatchItem,
} from './cookingBatches';
import {
  getCarriedServiceItemIds,
  withCarriedServiceItemIds,
} from './staffInventory';
import { clearNavigationGoal } from './movement/navigationGoal';

const DIRTY_ITEM_STATES = new Set([
  'dirty_at_table',
  'carried_dirty',
  'queued_for_wash',
  'washing',
]);

const PENDING_ITEM_STATES = new Set([
  'ordered',
  'preparing',
  'ready',
  'on_service',
  'carried',
]);

const TERMINAL_ITEM_STATES = new Set([
  'delivered',
  'dirty_at_table',
  'carried_dirty',
  'queued_for_wash',
  'washing',
]);

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function uniqueIds(ids) {
  const seen = new Set();
  return (Array.isArray(ids) ? ids : []).filter(id => {
    if (id == null || seen.has(String(id))) return false;
    seen.add(String(id));
    return true;
  });
}

function finiteTime(now, fallback = null) {
  return Number.isFinite(now) ? now : fallback;
}

function positivePatienceBudget(customer) {
  return Number.isFinite(customer?.patienceMax) && customer.patienceMax > 0
    ? customer.patienceMax
    : null;
}

function hasFoodTimer(customer) {
  return Number.isFinite(customer?.foodDeadlineAt)
    && Number.isFinite(customer?.foodPatienceBudget)
    && customer.foodPatienceBudget > 0;
}

function itemWasDelivered(item) {
  return Boolean(item
    && !item.foodCancelled
    && (item.state === 'delivered'
      || DIRTY_ITEM_STATES.has(item.state)
      || Number.isFinite(item.consumedAt)));
}

function customerCancelledItemIds(customer) {
  return uniqueIds(customer?.cancelledServiceItemIds);
}

function isCancelledFoodItem(customer, item) {
  return item?.foodCancelled === true
    || customerCancelledItemIds(customer).some(id => sameId(id, item?.id));
}

function clearFoodPatienceFields(customer) {
  return {
    ...customer,
    foodOrderedAt: null,
    foodPatienceBudget: null,
    foodDeadlineAt: null,
    foodOutcome: null,
    foodCancelledAt: null,
    cancelledServiceItemIds: [],
  };
}

/** Start the independent food timer for a newly committed food order. */
export function startFoodPatience(customer, now) {
  if (!customer || customer.foodOutcome === 'delivered' || customer.foodOutcome === 'cancelled') {
    return customer;
  }

  const budget = positivePatienceBudget(customer);
  const orderedAt = finiteTime(now);
  if (budget == null || orderedAt == null) return clearFoodPatienceFields(customer);

  return {
    ...customer,
    foodOrderedAt: orderedAt,
    foodPatienceBudget: budget,
    foodDeadlineAt: orderedAt + budget,
    foodOutcome: 'pending',
    foodCancelledAt: null,
    cancelledServiceItemIds: [],
  };
}

/** Mark food fulfilled only after a real dish delivery has occurred. */
export function markFoodDelivered(customer) {
  if (!customer || customer.foodOutcome === 'cancelled' || customer.foodOutcome === 'delivered') {
    return customer;
  }
  return {
    ...customer,
    foodOutcome: 'delivered',
    foodCancelledAt: null,
    cancelledServiceItemIds: uniqueIds(customer.cancelledServiceItemIds),
  };
}

/** Return the active patience fraction, or null once no timer is applicable. */
export function getFoodPatienceFraction(customer, now) {
  if (customer?.foodOutcome === 'delivered' || customer?.foodOutcome === 'cancelled') return null;
  if (!hasFoodTimer(customer) || !Number.isFinite(now)) return null;
  return Math.min(1, Math.max(0,
    (customer.foodDeadlineAt - now) / customer.foodPatienceBudget));
}

/** Delivery callers must check this immediately before committing a dish. */
export function canDeliverFoodItem(customer, item, now) {
  if (item?.kind !== 'dish') return true;
  if (item.foodCancelled === true || customer?.foodOutcome === 'cancelled') return false;
  if (itemWasDelivered(item)) return true;
  return !(customer?.foodOutcome === 'pending'
    && Number.isFinite(customer.foodDeadlineAt)
    && Number.isFinite(now)
    && now >= customer.foodDeadlineAt);
}

// Descriptive aliases make the boundary easy for delivery implementations to use
// without creating another source of truth for the deadline rule.
export const isFoodDeliveryAllowed = canDeliverFoodItem;
export const canDeliverDish = canDeliverFoodItem;

function counterSlotPosition(serviceTable, serviceSlotIndex) {
  if (!serviceTable || !Number.isInteger(serviceSlotIndex)) return null;
  const rotation = Number.isInteger(serviceTable.rotation)
    ? ((serviceTable.rotation % 4) + 4) % 4
    : 0;
  if (rotation === 1) {
    return { x: serviceTable.x + 10, y: serviceTable.y + 10 + serviceSlotIndex * 30 };
  }
  if (rotation === 2) {
    return { x: serviceTable.x + 110 - serviceSlotIndex * 30, y: serviceTable.y + 10 };
  }
  if (rotation === 3) {
    return { x: serviceTable.x + 10, y: serviceTable.y + 110 - serviceSlotIndex * 30 };
  }
  return { x: serviceTable.x + 10 + serviceSlotIndex * 30, y: serviceTable.y + 10 };
}

function getWasteOrigin(state, item) {
  const serviceTable = (state.serviceTables || []).find(table =>
    sameId(table.id, item.serviceTableId));
  const station = (state.kitchenStations || []).find(candidate =>
    sameId(candidate.id, item.stationId));
  const slotPosition = counterSlotPosition(serviceTable, item.serviceSlotIndex);
  const stationPosition = Number.isFinite(station?.x) && Number.isFinite(station?.y)
    ? { x: station.x + 20, y: station.y + 20 }
    : null;
  const slotX = Number.isFinite(slotPosition?.x) ? slotPosition.x : null;
  const slotY = Number.isFinite(slotPosition?.y) ? slotPosition.y : null;
  const x = Number.isFinite(item.x) ? item.x : slotX ?? stationPosition?.x ?? null;
  const y = Number.isFinite(item.y) ? item.y : slotY ?? stationPosition?.y ?? null;
  return {
    state: item.state,
    serviceTableId: item.serviceTableId ?? null,
    serviceSlotIndex: Number.isInteger(item.serviceSlotIndex) ? item.serviceSlotIndex : null,
    stationId: item.stationId ?? null,
    tableId: item.tableId ?? null,
    x,
    y,
  };
}

/** The canonical origin retained until a cancelled physical item is removed. */
export function getCancelledFoodWasteOrigin(item) {
  return item?.wasteOrigin || null;
}

function batchIdsForItems(items) {
  return new Set(items.map(item => item?.batchId)
    .filter(id => id != null)
    .map(id => String(id)));
}

function taskItemIds(task) {
  return uniqueIds([
    ...(Array.isArray(task?.serviceItemIds) ? task.serviceItemIds : []),
    task?.serviceItemId,
  ]);
}

function taskReferencesCancellation(task, itemIds, batchIds) {
  return Boolean(task && (
    (task.batchId != null && batchIds.has(String(task.batchId)))
      || taskItemIds(task).some(id => itemIds.has(String(id)))
  ));
}

function batchRemainder(state, batch, cancelledIds) {
  if (!batch) return [];
  const liveItems = new Set((state.serviceItems || []).map(item => String(item.id)));
  return uniqueIds(batch.serviceItemIds ?? batch.itemIds ?? batch.serviceItemId)
    .filter(id => !cancelledIds.has(String(id)) && liveItems.has(String(id)));
}

function prepareBatchTask(batch, ids) {
  return {
    type: 'prepare_dish',
    batchId: batch.id,
    serviceItemId: ids[0] ?? null,
    serviceItemIds: ids,
    stationId: batch.stationId,
  };
}

function reconcileStaffTasks(state, cancelledIds, affectedBatchIds) {
  const batchesById = new Map((state.cookingBatches || []).map(batch => [String(batch.id), batch]));
  return (state.staff || []).map(worker => {
    const carried = getCarriedServiceItemIds(worker);
    const task = worker.task;
    if (!taskReferencesCancellation(task, cancelledIds, affectedBatchIds)) {
      return withCarriedServiceItemIds(worker, carried);
    }

    const batch = task?.batchId == null ? null : batchesById.get(String(task.batchId));
    const remaining = batchRemainder(state, batch, cancelledIds);
    if (batch && remaining.length > 0) {
      return clearNavigationGoal({
        ...withCarriedServiceItemIds(worker, carried),
        task: prepareBatchTask(batch, remaining),
      });
    }

    // A delivery/preparation claim is released, but a carried item is never
    // removed from its owner's physical load by cancellation.
    return clearNavigationGoal({
      ...withCarriedServiceItemIds(worker, carried),
      task: null,
    });
  });
}

function cancelledItemForState(state, item, carriersByItem, cancellationTime) {
  const origin = getWasteOrigin(state, item);
  const carrier = carriersByItem.get(String(item.id));
  const carriedPosition = Number.isFinite(carrier?.x) && Number.isFinite(carrier?.y)
    ? { x: carrier.x, y: carrier.y }
    : null;
  const base = {
    ...item,
    foodCancelled: true,
    deliveryProhibited: true,
    cancelledAt: cancellationTime,
    cancellationReason: state.__foodCancellationReason,
    wasteOrigin: item.wasteOrigin || origin,
    x: Number.isFinite(item.x) ? item.x : carriedPosition?.x ?? origin.x,
    y: Number.isFinite(item.y) ? item.y : carriedPosition?.y ?? origin.y,
  };

  if (item.state === 'ordered' || item.state === 'preparing') return null;

  if (item.state === 'carried') {
    // A waiter may carry cancelled cooked waste as a temporary dirty load. A
    // cook keeps the clean physical item until a safe handoff is scheduled.
    if (carrier?.role === 'waiter') {
      return {
        ...base,
        state: 'carried_dirty',
        assignedStaffId: null,
        serviceTableId: null,
        serviceSlotIndex: null,
        stationId: null,
      };
    }
    return {
      ...base,
      state: 'carried',
      serviceTableId: null,
      serviceSlotIndex: null,
      stationId: null,
    };
  }

  if (item.state === 'ready' || item.state === 'on_service') {
    return {
      ...base,
      state: 'to_clean',
      assignedStaffId: null,
    };
  }

  if (TERMINAL_ITEM_STATES.has(item.state) || item.state === 'to_clean') {
    return {
      ...base,
      assignedStaffId: item.state === 'carried_dirty' ? item.assignedStaffId : null,
    };
  }

  return base;
}

function updateCustomerAfterFoodCancellation(state, customer, itemIds, now, reason) {
  const cancelledIds = uniqueIds([
    ...customerCancelledItemIds(customer),
    ...itemIds,
  ]);
  const orderedIds = uniqueIds([
    ...(Array.isArray(customer.orderedServiceItemIds) ? customer.orderedServiceItemIds : []),
    ...itemIds,
  ]);
  const consumedIds = uniqueIds(customer.consumedServiceItemIds)
    .filter(id => !cancelledIds.some(cancelledId => sameId(cancelledId, id)));
  const foodPrice = Number.isFinite(customer.dishPriceAtOrder)
    && customer.dishPriceAtOrder >= 0
    ? customer.dishPriceAtOrder
    : 0;
  const drinkPrice = Number.isFinite(customer.drinkPriceAtOrder)
    && customer.drinkPriceAtOrder >= 0
    ? customer.drinkPriceAtOrder
    : null;
  const nextSubtotal = Number.isFinite(customer.orderSubtotal) && customer.orderSubtotal >= 0
    ? Math.max(0, customer.orderSubtotal - foodPrice)
    : customer.drinkId != null ? drinkPrice : 0;
  const next = {
    ...customer,
    menuOutcome: customer.menuOutcome || 'ordered',
    dishId: null,
    dishPriceAtOrder: null,
    orderSubtotal: nextSubtotal,
    foodOutcome: 'cancelled',
    foodCancelledAt: now,
    foodCancellationReason: reason,
    foodCancelledPrice: foodPrice,
    cancelledServiceItemIds: cancelledIds,
    orderedServiceItemIds: orderedIds,
    consumedServiceItemIds: consumedIds,
  };

  if (isCheckoutState(customer) || customer.state === 'leaving') return next;

  const drinkItems = (state.serviceItems || []).filter(item =>
    item.customerId === customer.id && item.kind === 'drink' && !isCancelledFoodItem(customer, item));
  const deliveredDrink = drinkItems.some(item => item.state === 'delivered');
  const consumedDrink = drinkItems.some(item =>
    itemWasDelivered(item) && (DIRTY_ITEM_STATES.has(item.state) || Number.isFinite(item.consumedAt)));
  const pendingDrink = drinkItems.some(item => PENDING_ITEM_STATES.has(item.state));

  if (deliveredDrink) {
    return {
      ...next,
      state: 'eating',
      eatTime: Number.isFinite(customer.eatTime) ? customer.eatTime : now,
    };
  }
  if (pendingDrink) return { ...next, state: 'waiting_for_items' };
  if (consumedDrink || drinkItems.length === 0) return { ...next, state: 'seated' };
  return next;
}

/**
 * Atomically cancel one customer's un-delivered food order. Physical items
 * which already exist are retained as waste, while unstarted/preparing food is
 * removed. The returned state is safe to call again with the same customer.
 */
export function cancelCustomerFood(state, customerId, now, reason = 'food-patience-expired') {
  const customer = (state?.customers || []).find(candidate => sameId(candidate.id, customerId));
  if (!customer || customer.foodOutcome === 'delivered' || customer.foodOutcome === 'cancelled') return state;

  const ownedFood = (state.serviceItems || []).filter(item =>
    sameId(item.customerId, customer.id) && item.kind === 'dish');
  if (ownedFood.some(item => itemWasDelivered(item))) {
    const customers = (state.customers || []).map(candidate => sameId(candidate.id, customer.id)
      ? markFoodDelivered(candidate)
      : candidate);
    return { ...state, customers };
  }

  const hasFoodOrder = customer.dishId != null
    || customer.foodOutcome === 'pending'
    || hasFoodTimer(customer)
    || ownedFood.length > 0;
  if (!hasFoodOrder) return state;

  const cancellationTime = finiteTime(now, state.restaurant?.gameTime);
  if (cancellationTime == null) return state;

  const itemIds = new Set(ownedFood.map(item => String(item.id)));
  const affectedBatchIds = batchIdsForItems(ownedFood);
  let working = state;
  for (const item of ownedFood) {
    if (item.batchId != null) {
      working = completeCookingBatchItem(working, item.batchId, item.id);
    }
  }

  const carriersByItem = new Map();
  for (const worker of working.staff || []) {
    for (const id of getCarriedServiceItemIds(worker)) {
      if (itemIds.has(String(id))) carriersByItem.set(String(id), worker);
    }
  }

  const cancellationState = { ...working, __foodCancellationReason: reason };
  const serviceItems = (working.serviceItems || [])
    .map(item => itemIds.has(String(item.id))
      ? cancelledItemForState(cancellationState, item, carriersByItem, cancellationTime)
      : item)
    .filter(Boolean);
  const serviceItemsWithDrinkStart = serviceItems.map(item =>
    item.customerId === customer.id
      && item.kind === 'drink'
      && item.state === 'delivered'
      && !Number.isFinite(item.consumptionStartedAt)
      ? { ...item, consumptionStartedAt: cancellationTime }
      : item);
  const nextState = { ...working, serviceItems: serviceItemsWithDrinkStart };
  const removedFromWorldIds = new Set([...itemIds]
    .filter(id => !serviceItemsWithDrinkStart.some(item => sameId(item.id, id))));
  const staff = reconcileStaffTasks(nextState, itemIds, affectedBatchIds)
    .map(worker => withCarriedServiceItemIds(
      worker,
      getCarriedServiceItemIds(worker).filter(id => !removedFromWorldIds.has(String(id))),
    ));
  const customers = (working.customers || []).map(candidate =>
    sameId(candidate.id, customer.id)
      ? updateCustomerAfterFoodCancellation({ ...nextState, staff }, candidate,
        [...itemIds], cancellationTime, reason)
      : candidate);
  const claimed = Array.isArray(working.__staffClaimedServiceItemIds)
    ? working.__staffClaimedServiceItemIds.filter(id => !itemIds.has(String(id)))
    : undefined;
  const {
    __foodCancellationReason: _reason,
    ...withoutInternalCancellation
  } = { ...nextState, staff, customers };
  return claimed
    ? { ...withoutInternalCancellation, __staffClaimedServiceItemIds: claimed }
    : withoutInternalCancellation;
}

/** Expire every due customer in stable collection order. */
export function expireFoodPatience(state, now = state?.restaurant?.gameTime) {
  if (!Number.isFinite(now)) return state;
  let current = state;
  for (const originalCustomer of state.customers || []) {
    const customer = (current.customers || []).find(candidate =>
      sameId(candidate.id, originalCustomer.id));
    if (!customer || customer.foodOutcome === 'cancelled') continue;

    const ownedFood = (current.serviceItems || []).filter(item =>
      sameId(item.customerId, customer.id) && item.kind === 'dish');
    if (ownedFood.some(item => itemWasDelivered(item))) {
      if (customer.foodOutcome !== 'delivered') {
        current = {
          ...current,
          customers: current.customers.map(candidate => sameId(candidate.id, customer.id)
            ? markFoodDelivered(candidate)
            : candidate),
        };
      }
      continue;
    }

    const deadline = customer.foodDeadlineAt;
    const pending = customer.foodOutcome === 'pending'
      || (customer.foodOutcome == null && hasFoodTimer(customer));
    if (pending && Number.isFinite(deadline) && now >= deadline) {
      current = cancelCustomerFood(current, customer.id, now);
    }
  }
  return current;
}
