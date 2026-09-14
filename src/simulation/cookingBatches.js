import { clearNavigationGoal } from './movement/navigationGoal';
import {
  getCarriedServiceItemIds,
  getStaffCarryCapacity,
  withCarriedServiceItemIds,
} from './staffInventory';

const BATCH_ITEM_STATES = new Set(['ordered', 'preparing', 'ready', 'carried']);
const COMPLETED_BATCH_ITEM_STATES = new Set(['on_service', 'delivered']);
const PHYSICAL_BATCH_ITEM_STATES = new Set(['ready', 'carried', 'on_service', 'delivered']);

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function uniqueIds(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const seen = new Set();
  return values.filter(id => {
    if (id == null || seen.has(String(id))) return false;
    seen.add(String(id));
    return true;
  });
}

function nextBatchId(batches) {
  const greatest = (batches || []).reduce((maximum, batch) => {
    const match = /^cooking-batch-(\d+)$/.exec(String(batch?.id || ''));
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `cooking-batch-${greatest + 1}`;
}

function hasCustomerRecord(state) {
  return Array.isArray(state?.customers);
}

function customerIsActive(state, customerId) {
  if (customerId == null) return true;
  if (!hasCustomerRecord(state)) return true;
  const customer = state.customers.find(candidate => sameId(candidate?.id, customerId));
  return Boolean(customer && customer.state !== 'leaving');
}

function customerCancelledItemIds(state, customerId) {
  const customer = (state?.customers || []).find(candidate =>
    sameId(candidate?.id, customerId));
  return new Set((customer?.cancelledServiceItemIds || []).map(id => String(id)));
}

function isCancelledFoodItem(state, item) {
  return item?.foodCancelled === true
    || customerCancelledItemIds(state, item?.customerId).has(String(item?.id));
}

function itemById(serviceItems, itemId) {
  return (serviceItems || []).find(item => sameId(item?.id, itemId));
}

function cookForBatch(state, batch) {
  return (state?.staff || []).find(worker => sameId(worker?.id, batch?.cookId));
}

function stationForBatch(state, batch) {
  return (state?.kitchenStations || []).find(station => sameId(station?.id, batch?.stationId));
}

function dishForItem(state, item) {
  return (state?.dishes || []).find(dish => sameId(dish?.id, item?.menuItemId));
}

function equipmentForStation(state, station) {
  return (state?.equipment || []).find(equipment =>
    sameId(equipment?.id, station?.equipmentId));
}

/** A dish can use any station when it has no equipment restriction. */
export function isDishCompatibleWithStation(state, dish, station) {
  if (!dish || !station) return false;
  if (dish.requiredEquipmentId == null) return true;
  const equipment = equipmentForStation(state, station);
  return sameId(station.equipmentId, dish.requiredEquipmentId) && equipment?.owned === true;
}

export function getCookingBatchCapacity(worker) {
  return getStaffCarryCapacity(worker);
}

export function getBatchServiceItemIds(batch) {
  return uniqueIds(batch?.serviceItemIds ?? batch?.itemIds ?? batch?.serviceItemId);
}

export function getCookingBatch(state, batchId) {
  return (state?.cookingBatches || []).find(batch => sameId(batch?.id, batchId)) || null;
}

export function getCookingBatchForItem(state, serviceItemId) {
  return (state?.cookingBatches || []).find(batch =>
    getBatchServiceItemIds(batch).some(id => sameId(id, serviceItemId))) || null;
}

export function getCookingBatchForCook(state, cookId) {
  return (state?.cookingBatches || []).find(batch => sameId(batch?.cookId, cookId)) || null;
}

export function createCookingBatchRecord({ id, cookId, stationId, serviceItemIds, startedAt = null } = {}) {
  const hasStarted = Number.isFinite(startedAt);
  return {
    id,
    cookId,
    stationId,
    serviceItemIds: uniqueIds(serviceItemIds),
    status: hasStarted ? 'preparing' : 'reserved',
    startedAt: hasStarted ? startedAt : null,
    readyAt: null,
  };
}

export function createCookingBatch(state, options = {}) {
  const id = options.id ?? nextBatchId(state?.cookingBatches || []);
  const batch = createCookingBatchRecord({ ...options, id });
  return {
    ...state,
    cookingBatches: [...(state?.cookingBatches || []), batch],
  };
}

function orderTimeFor(state, item, index) {
  const customer = (state.customers || []).find(candidate =>
    sameId(candidate?.id, item?.customerId));
  const candidates = [item?.orderedAt, item?.orderTime, customer?.orderTime, item?.createdAt];
  return candidates.find(value => Number.isFinite(value)) ?? index;
}

/** Return current, unclaimed dish orders in deterministic FIFO order. */
export function getEligibleCookingItems(state, cook, station, claimedServiceItemIds = new Set()) {
  const claimed = claimedServiceItemIds instanceof Set
    ? claimedServiceItemIds
    : new Set(claimedServiceItemIds || []);
  return (state?.serviceItems || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (item?.kind !== 'dish' || item.state !== 'ordered'
        || item.assignedStaffId != null || item.batchId != null
        || claimed.has(item.id)) return false;
      if (isCancelledFoodItem(state, item)) return false;
      if (!customerIsActive(state, item.customerId)) return false;
      return isDishCompatibleWithStation(state, dishForItem(state, item), station);
    })
    .sort((left, right) => orderTimeFor(state, left.item, left.index)
      - orderTimeFor(state, right.item, right.index)
      || left.index - right.index
      || String(left.item.id).localeCompare(String(right.item.id)))
    .map(({ item }) => item);
}

/** Fill one cook/station batch from orders already present at assignment time. */
export function selectCookingBatchItems(state, cook, station, firstItem, claimedServiceItemIds = new Set()) {
  const eligible = getEligibleCookingItems(state, cook, station, claimedServiceItemIds);
  if (!eligible.some(item => sameId(item.id, firstItem?.id))) return [];
  return eligible.slice(0, getCookingBatchCapacity(cook));
}

function withoutBatchId(item) {
  if (!item || !Object.hasOwn(item, 'batchId')) return item;
  const { batchId: _batchId, ...without } = item;
  return without;
}

function resetBatchPreparation(item) {
  if (!item) return item;
  const without = withoutBatchId(item);
  return {
    ...without,
    state: 'ordered',
    stationId: null,
    serviceTableId: null,
    serviceSlotIndex: null,
    assignedStaffId: null,
    preparationStartedAt: null,
    readyAt: null,
  };
}

function recoverBatchPhysicalItem(item) {
  if (!item) return item;
  const without = withoutBatchId(item);
  if (item.foodCancelled === true && item.state === 'carried') {
    // Cancellation has already invalidated the destination, but the cook's
    // physical load remains authoritative until a safe waste handoff.
    return without;
  }
  if (item.foodCancelled === true
    && ['ready', 'on_service', 'delivered'].includes(item.state)) {
    return {
      ...without,
      state: 'to_clean',
      assignedStaffId: null,
    };
  }
  if (item.state === 'carried') {
    return {
      ...without,
      state: 'to_clean',
      stationId: null,
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
    };
  }
  if (item.state === 'ready' || item.state === 'preparing' || item.state === 'ordered') {
    return resetBatchPreparation(item);
  }
  return without;
}

function clearBatchTask(worker, batchId, itemIds) {
  const task = worker?.task;
  if (!task) return worker;
  const taskIds = uniqueIds(task.serviceItemIds ?? task.serviceItemId);
  const referencesBatch = sameId(task.batchId, batchId)
    || taskIds.some(id => itemIds.some(itemId => sameId(itemId, id)));
  return referencesBatch ? { ...clearNavigationGoal(worker), task: null } : worker;
}

/** Cancel a batch and return all of its members to a safe unassigned state. */
export function releaseCookingBatch(state, batchId) {
  const batch = getCookingBatch(state, batchId);
  const memberIds = new Set([
    ...getBatchServiceItemIds(batch),
    ...(state?.serviceItems || [])
      .filter(item => sameId(item?.batchId, batchId))
      .map(item => item.id),
  ].map(id => String(id)));
  if (memberIds.size === 0 && !batch) return state;

  const serviceItems = (state.serviceItems || []).map(item => {
    if (!memberIds.has(String(item.id))) return item;
    return recoverBatchPhysicalItem(item);
  });
  const staff = (state.staff || []).map(worker => {
    const nextIds = getCarriedServiceItemIds(worker)
      .filter(id => !memberIds.has(String(id))
        || serviceItems.some(item => sameId(item.id, id)
          && item.foodCancelled === true && item.state === 'carried'));
    const cleared = clearBatchTask(worker, batchId, [...memberIds]);
    return withCarriedServiceItemIds(cleared, nextIds);
  });
  const cookingBatches = (state.cookingBatches || []).filter(candidate =>
    !sameId(candidate?.id, batchId));
  return { ...state, staff, serviceItems, cookingBatches };
}

/** Cancel batches whose worker/station/customer ownership was invalidated. */
export function recoverCookingBatches(state, {
  batchIds = [],
  cookIds = [],
  stationIds = [],
} = {}) {
  const batchIdSet = new Set(batchIds.map(id => String(id)));
  const cookIdSet = new Set(cookIds.map(id => String(id)));
  const stationIdSet = new Set(stationIds.map(id => String(id)));
  const affected = (state?.cookingBatches || [])
    .filter(batch => batchIdSet.has(String(batch.id))
      || cookIdSet.has(String(batch.cookId))
      || stationIdSet.has(String(batch.stationId)))
    .map(batch => batch.id);
  return affected.reduce((current, id) => releaseCookingBatch(current, id), state);
}

function inferredBatches(state) {
  const explicit = Array.isArray(state.cookingBatches)
    ? state.cookingBatches.map(batch => ({
      ...batch,
      ...(Array.isArray(batch?.serviceItemIds)
        ? { serviceItemIds: [...batch.serviceItemIds] }
        : {}),
    }))
    : [];
  const byId = new Map(explicit
    .filter(batch => batch?.id != null)
    .map(batch => [String(batch.id), batch]));
  for (const worker of state.staff || []) {
    const task = worker?.task;
    if (task?.type !== 'prepare_dish' || task.batchId == null) continue;
    const key = String(task.batchId);
    const taskItemIds = uniqueIds(task.serviceItemIds ?? task.serviceItemId);
    if (!byId.has(key)) {
      byId.set(key, {
        id: task.batchId,
        cookId: worker.id,
        stationId: task.stationId,
        serviceItemIds: taskItemIds,
        status: task.startedAt == null ? 'reserved' : 'preparing',
        startedAt: Number.isFinite(task.startedAt) ? task.startedAt : null,
        readyAt: null,
      });
      continue;
    }
    const batch = byId.get(key);
    batch.serviceItemIds = uniqueIds([...getBatchServiceItemIds(batch), ...taskItemIds]);
    if (batch.cookId == null) batch.cookId = worker.id;
    if (batch.stationId == null) batch.stationId = task.stationId;
    if (!Number.isFinite(batch.startedAt) && Number.isFinite(task.startedAt)) {
      batch.startedAt = task.startedAt;
    }
  }
  for (const item of state.serviceItems || []) {
    if (item?.batchId == null) continue;
    const key = String(item.batchId);
    if (!byId.has(key)) {
      byId.set(key, {
        id: item.batchId,
        cookId: item.assignedStaffId,
        stationId: item.stationId,
        serviceItemIds: [],
        status: 'preparing',
        startedAt: Number.isFinite(item.preparationStartedAt) ? item.preparationStartedAt : null,
        readyAt: null,
      });
    }
    const batch = byId.get(key);
    batch.serviceItemIds = uniqueIds([...getBatchServiceItemIds(batch), item.id]);
  }
  return [...byId.values()];
}

function taskForBatch(worker, batch, itemIds) {
  const task = worker.task;
  if (!task || !sameId(task.batchId, batch.id)) return task;
  const firstId = itemIds.find(id => sameId(id, task.serviceItemId)) ?? itemIds[0];
  return {
    ...task,
    batchId: batch.id,
    serviceItemId: firstId,
    serviceItemIds: itemIds,
    stationId: batch.stationId,
  };
}

function deriveBatchStatus(batch, items) {
  if (items.some(item => item.state === 'ordered')) {
    return Number.isFinite(batch.startedAt) ? 'preparing' : 'reserved';
  }
  if (items.some(item => item.state === 'preparing')) return 'preparing';
  if (items.some(item => item.state === 'carried')) return 'delivering';
  return 'ready';
}

/**
 * Reconcile durable batch records after a save or an ownership-changing
 * operation. Invalid reservations are released rather than left stranded.
 */
export function normaliseCookingBatches(state) {
  const hasBatchData = Array.isArray(state?.cookingBatches)
    || (state?.serviceItems || []).some(item => item?.batchId != null)
    || (state?.staff || []).some(worker => worker?.task?.batchId != null);
  if (!hasBatchData) return state;

  const serviceItems = [...(state.serviceItems || [])];
  const itemMap = new Map(serviceItems.map(item => [String(item.id), item]));
  const acceptedItemIds = new Set();
  const acceptedBatchIds = new Set();
  const acceptedCookIds = new Set();
  const acceptedStationIds = new Set();
  const droppedItemIds = new Set();
  const releasedItemIds = new Set();
  const cookingBatches = [];

  for (const rawBatch of inferredBatches({ ...state, serviceItems })) {
    const batchId = rawBatch?.id;
    if (batchId == null || acceptedBatchIds.has(String(batchId))) continue;
    const cook = cookForBatch(state, rawBatch);
    const station = stationForBatch(state, rawBatch);
    const rawIds = getBatchServiceItemIds(rawBatch);
    if (!cook || cook.role !== 'cook' || !station || rawIds.length === 0) {
      rawIds.forEach(id => releasedItemIds.add(String(id)));
      continue;
    }
    if (acceptedCookIds.has(String(cook.id)) || acceptedStationIds.has(String(station.id))) {
      rawIds.forEach(id => releasedItemIds.add(String(id)));
      continue;
    }

    const memberIds = [];
    for (const itemId of rawIds) {
      const key = String(itemId);
      const item = itemMap.get(key);
      if (!item || acceptedItemIds.has(key)) {
        if (item) releasedItemIds.add(key);
        continue;
      }
      const dish = dishForItem(state, item);
      const customerActive = customerIsActive(state, item.customerId);
      if (isCancelledFoodItem(state, item)) {
        itemMap.set(key, { ...item, foodCancelled: true, deliveryProhibited: true });
        if (item.state === 'ordered' || item.state === 'preparing') {
          droppedItemIds.add(key);
        } else {
          releasedItemIds.add(key);
        }
        continue;
      }
      if (item.kind !== 'dish' || !customerActive
        || !isDishCompatibleWithStation(state, dish, station)) {
        if (!customerActive && (item.state === 'ordered' || item.state === 'preparing')) {
          droppedItemIds.add(key);
        } else {
          releasedItemIds.add(key);
        }
        continue;
      }
      if (COMPLETED_BATCH_ITEM_STATES.has(item.state)) {
        // A delivered item no longer keeps the station reserved. Strip only
        // the batch marker; the normal consumption/cleaning flow owns it now.
        itemMap.set(key, withoutBatchId(item));
        continue;
      }
      if (!BATCH_ITEM_STATES.has(item.state)) {
        releasedItemIds.add(key);
        continue;
      }
      acceptedItemIds.add(key);
      memberIds.push(item.id);
      itemMap.set(key, {
        ...item,
        batchId,
        stationId: station.id,
        assignedStaffId: cook.id,
      });
    }

    if (memberIds.length === 0) continue;
    acceptedBatchIds.add(String(batchId));
    acceptedCookIds.add(String(cook.id));
    acceptedStationIds.add(String(station.id));
    const memberItems = memberIds.map(id => itemMap.get(String(id))).filter(Boolean);
    const readyTimes = memberItems.map(item => item.readyAt).filter(Number.isFinite);
    cookingBatches.push({
      ...rawBatch,
      id: batchId,
      cookId: cook.id,
      stationId: station.id,
      serviceItemIds: memberIds,
      status: deriveBatchStatus(rawBatch, memberItems),
      startedAt: Number.isFinite(rawBatch.startedAt)
        ? rawBatch.startedAt
        : memberItems.find(item => Number.isFinite(item.preparationStartedAt))?.preparationStartedAt ?? null,
      ...(Number.isFinite(rawBatch.readyAt) || readyTimes.length > 0
        ? { readyAt: Number.isFinite(rawBatch.readyAt) ? rawBatch.readyAt : Math.max(...readyTimes) }
        : { readyAt: null }),
    });
  }

  // Any item that names a missing/duplicate batch must be made available again
  // rather than permanently occupying a station or cook.
  for (const item of serviceItems) {
    const key = String(item.id);
    if (item.batchId == null || acceptedItemIds.has(key)) continue;
    if (droppedItemIds.has(key)) continue;
    if (PHYSICAL_BATCH_ITEM_STATES.has(item.state)) releasedItemIds.add(key);
    else releasedItemIds.add(key);
  }

  let nextServiceItems = serviceItems.map(item => {
    const key = String(item.id);
    if (droppedItemIds.has(key)) return null;
    const accepted = itemMap.get(key);
    if (accepted && acceptedItemIds.has(key)) return accepted;
    if (!releasedItemIds.has(key)) return itemMap.get(key) || item;
    return recoverBatchPhysicalItem(itemMap.get(key) || item);
  }).filter(Boolean);

  const batchById = new Map(cookingBatches.map(batch => [String(batch.id), batch]));
  let nextStaff = (state.staff || []).map(worker => {
    const task = worker.task;
    if (!task?.batchId) return worker;
    const batch = batchById.get(String(task.batchId));
    if (!batch) return { ...clearNavigationGoal(worker), task: null };
    const itemIds = getBatchServiceItemIds(batch);
    return { ...worker, task: taskForBatch(worker, batch, itemIds) };
  });
  nextStaff = nextStaff.map(worker => {
    const carrying = getCarriedServiceItemIds(worker);
    const validCarrying = carrying.filter(id => nextServiceItems.some(item =>
      sameId(item.id, id) && ['carried', 'carried_dirty'].includes(item.state)));
    return withCarriedServiceItemIds(worker, validCarrying);
  });

  // If a batch member was dropped because its customer left, make sure no
  // remaining carrier/task still references it.
  const liveIds = new Set(nextServiceItems.map(item => String(item.id)));
  nextStaff = nextStaff.map(worker => {
    if (!worker.task?.batchId) return worker;
    const batch = batchById.get(String(worker.task.batchId));
    const ids = getBatchServiceItemIds(batch).filter(id => liveIds.has(String(id)));
    return ids.length > 0
      ? { ...worker, task: taskForBatch(worker, batch, ids) }
      : { ...clearNavigationGoal(worker), task: null };
  });

  return {
    ...state,
    staff: nextStaff,
    serviceItems: nextServiceItems,
    cookingBatches,
  };
}

/** Remove one delivered item from its batch and release the station if empty. */
export function completeCookingBatchItem(state, batchId, serviceItemId) {
  const batch = getCookingBatch(state, batchId);
  if (!batch) return state;
  const remaining = getBatchServiceItemIds(batch).filter(id => !sameId(id, serviceItemId));
  const serviceItems = (state.serviceItems || []).map(item => sameId(item.id, serviceItemId)
    ? withoutBatchId(item)
    : item);
  if (remaining.length === 0) {
    const cookingBatches = (state.cookingBatches || []).filter(candidate =>
      !sameId(candidate.id, batchId));
    return { ...state, serviceItems, cookingBatches };
  }
  const nextBatch = { ...batch, serviceItemIds: remaining };
  const cookingBatches = (state.cookingBatches || []).map(candidate =>
    sameId(candidate.id, batchId) ? nextBatch : candidate);
  const staff = (state.staff || []).map(worker => worker.task?.batchId != null
    && sameId(worker.task.batchId, batchId)
    ? { ...worker, task: { ...worker.task, serviceItemIds: remaining,
      serviceItemId: remaining.includes(worker.task.serviceItemId)
        ? worker.task.serviceItemId : remaining[0] } }
    : worker);
  return { ...state, staff, serviceItems, cookingBatches };
}

export function getCookingBatchRemainder(state, batch) {
  return getBatchServiceItemIds(batch)
    .map(id => itemById(state?.serviceItems, id))
    .filter(item => item && !COMPLETED_BATCH_ITEM_STATES.has(item.state));
}
