import {
  advanceStaffTaskProgress,
  getStaffTaskLegacyRate,
  getStaffTaskRate,
  getStaffTaskSource,
} from './staffPerformance';
import {
  getCarriedServiceItemIds,
  withCarriedServiceItemIds,
} from './staffInventory';
import {
  getBatchServiceItemIds,
  getCookingBatch,
  getCookingBatchForCook,
} from './cookingBatches';
import {
  isCleaningTask,
  releaseCleaningAction,
  updateCleaningActionProgress,
} from './cleaningActions';
import { clearNavigationGoal } from './movement/navigationGoal';
import { requeueCheckoutCustomer, isCheckoutState } from './checkout';

const PROGRESS_TASK_TYPES = new Set([
  'take_order',
  'take_payment',
  'prepare_dish',
  'prepare_drink',
  'wash_item',
  'clean_table',
  'clean_floor',
]);

const PHYSICAL_STATES = new Set(['carried', 'carried_dirty']);

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function finite(value) {
  return Number.isFinite(value);
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

function taskItemIds(task) {
  return uniqueIds([
    ...(Array.isArray(task?.serviceItemIds) ? task.serviceItemIds : []),
    task?.serviceItemId,
  ]);
}

function removeMapEntry(value, id) {
  if (value instanceof Map) {
    const next = new Map(value);
    next.delete(id);
    next.delete(String(id));
    return next;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const next = { ...value };
    delete next[id];
    delete next[String(id)];
    return next;
  }
  return value;
}

function clearNavigationClaims(state, staffId) {
  const coordinator = state?.movementCoordinator;
  if (!coordinator || typeof coordinator !== 'object') return state;
  const nextCoordinator = {
    ...coordinator,
    requests: removeMapEntry(coordinator.requests, staffId),
    statuses: removeMapEntry(coordinator.statuses, staffId),
    claims: removeMapEntry(coordinator.claims, staffId),
    records: removeMapEntry(coordinator.records, staffId),
    plans: removeMapEntry(coordinator.plans, staffId),
  };
  if (coordinator.diagnostics && typeof coordinator.diagnostics === 'object') {
    nextCoordinator.diagnostics = {
      ...coordinator.diagnostics,
      waiting: removeMapEntry(coordinator.diagnostics.waiting, staffId),
      actorExpansions: removeMapEntry(coordinator.diagnostics.actorExpansions, staffId),
      recoveries: removeMapEntry(coordinator.diagnostics.recoveries, staffId),
    };
  }
  return { ...state, movementCoordinator: nextCoordinator };
}

function progressStart(source, task) {
  if (task?.type === 'prepare_dish' || task?.type === 'prepare_drink') {
    return source?.preparationStartedAt
      ?? source?.startedAt
      ?? task?.preparationStartedAt
      ?? task?.startedAt;
  }
  if (task?.type === 'wash_item') {
    return source?.washStartedAt
      ?? source?.cleaningStartedAt
      ?? source?.startedAt
      ?? task?.washingStartedAt
      ?? task?.startedAt;
  }
  if (task?.type === 'clean_table' || task?.type === 'clean_floor') {
    return source?.cleaningStartedAt ?? source?.startedAt
      ?? task?.cleaningStartedAt ?? task?.cleaningStartedAt
      ?? task?.startedAt;
  }
  return source?.startedAt ?? task?.startedAt;
}

function taskHasStarted(state, worker) {
  const task = worker?.task;
  if (!task || !PROGRESS_TASK_TYPES.has(task.type)) return false;
  const source = getStaffTaskSource(state, worker) || task;
  return [
    source?.startedAt,
    source?.preparationStartedAt,
    source?.cleaningStartedAt,
    source?.washStartedAt,
    source?.washingStartedAt,
    task.startedAt,
    task.preparationStartedAt,
    task.cleaningStartedAt,
    task.washingStartedAt,
  ].some(finite)
    || finite(source?.accumulatedWork)
    || finite(task.accumulatedWork);
}

function batchForWorkerTask(state, worker, task) {
  if (task?.batchId != null) return getCookingBatch(state, task.batchId);
  if (task?.type === 'place_dish_on_service') return getCookingBatchForCook(state, worker?.id);
  return null;
}

function batchHasStarted(state, worker) {
  const task = worker?.task;
  const batch = batchForWorkerTask(state, worker, task);
  if (!batch) return false;
  const ids = new Set(getBatchServiceItemIds(batch).map(id => String(id)));
  return (state?.serviceItems || []).some(item => ids.has(String(item.id))
    && (finite(item.preparationStartedAt)
      || finite(item.accumulatedWork)
      || finite(item.lastProgressAt)));
}

function taskOwnershipIsValid(state, worker) {
  const task = worker?.task;
  if (!task) return true;
  const itemFor = id => (state?.serviceItems || []).find(item => sameId(item.id, id));
  const itemIds = taskItemIds(task);
  const itemsBelongToWorker = itemIds.every(id => {
    const item = itemFor(id);
    return !item || item.assignedStaffId == null || sameId(item.assignedStaffId, worker.id);
  });

  if (task.type === 'wash_item') {
    const item = itemFor(task.serviceItemId);
    return itemsBelongToWorker
      && (!item || task.washStationId == null || sameId(item.washStationId, task.washStationId));
  }
  if (isCleaningTask(task)) {
    const target = task.type === 'clean_table'
      ? (state?.tables || []).find(candidate => sameId(candidate.id, task.tableId))
      : task.type === 'clean_floor'
        ? (state?.floorDirt || []).find(candidate => sameId(candidate.id, task.dirtId))
        : itemFor(task.serviceItemId);
    const actionStaffId = target?.cleaningAction?.staffId;
    return actionStaffId == null || sameId(actionStaffId, worker.id);
  }
  if (task.type === 'take_payment') {
    const station = (state?.cashierStations || []).find(candidate =>
      sameId(candidate.id, task.stationId));
    return station?.assignedStaffId == null || sameId(station.assignedStaffId, worker.id);
  }
  if (task.type === 'prepare_dish' || task.type === 'prepare_drink') {
    const batch = batchForWorkerTask(state, worker, task);
    return (!batch?.cookId || sameId(batch.cookId, worker.id)) && itemsBelongToWorker;
  }
  return itemsBelongToWorker;
}

function updateItemProgress(items, itemIds, rate, now, state, worker, task) {
  const ids = new Set(itemIds.map(id => String(id)));
  return items.map(item => {
    if (!ids.has(String(item.id))) return item;
    const start = progressStart(item, task);
    if (!finite(start) && !finite(item.accumulatedWork)) return item;
    const progress = advanceStaffTaskProgress(
      item,
      now,
      rate,
      start,
      getStaffTaskLegacyRate(state, worker, task),
    );
    return {
      ...item,
      accumulatedWork: progress.accumulatedWork,
      lastProgressAt: progress.lastProgressAt,
    };
  });
}

function settleWorkerProgress(state, worker, now) {
  const task = worker?.task;
  if (!task || !taskOwnershipIsValid(state, worker)
    || (!taskHasStarted(state, worker) && !batchHasStarted(state, worker)) || !finite(now)) {
    return { state, worker };
  }

  const batch = batchForWorkerTask(state, worker, task);
  const isBatchDelivery = task.type === 'place_dish_on_service' && batch;
  if (isBatchDelivery) {
    const itemIds = getBatchServiceItemIds(batch);
    const preparationTask = {
      type: 'prepare_dish',
      batchId: batch.id,
      stationId: batch.stationId ?? task.stationId,
      serviceItemId: task.serviceItemId ?? itemIds[0],
      serviceItemIds: itemIds,
    };
    const rate = getStaffTaskRate(state, worker, preparationTask);
    const nextItems = updateItemProgress(
      state.serviceItems || [],
      itemIds,
      rate,
      now,
      state,
      worker,
      preparationTask,
    );
    const primary = nextItems.find(item => sameId(item.id, preparationTask.serviceItemId));
    return {
      state: { ...state, serviceItems: nextItems },
      worker: primary && finite(primary.accumulatedWork)
        ? {
          ...worker,
          task: {
            ...task,
            accumulatedWork: primary.accumulatedWork,
            lastProgressAt: primary.lastProgressAt,
          },
        }
        : worker,
    };
  }

  const source = getStaffTaskSource(state, worker) || task;
  const rate = getStaffTaskRate(state, worker, task);
  const start = progressStart(source, task);
  const progress = advanceStaffTaskProgress(
    source,
    now,
    rate,
    start,
    getStaffTaskLegacyRate(state, worker, task),
  );
  let nextState = state;
  let nextWorker = {
    ...worker,
    task: {
      ...task,
      accumulatedWork: progress.accumulatedWork,
      lastProgressAt: progress.lastProgressAt,
    },
  };

  if (task.type === 'clean_table' || task.type === 'clean_floor' || task.type === 'wash_item') {
    nextState = updateCleaningActionProgress(nextState, worker.id, task, progress);
  }

  if (Array.isArray(nextState.serviceItems)) {
    const itemIds = task.type === 'prepare_dish' && task.batchId != null
      ? uniqueIds([
        ...taskItemIds(task),
        ...getBatchServiceItemIds(getCookingBatch(nextState, task.batchId)),
      ])
      : taskItemIds(task);
    if (itemIds.length > 0 && ['prepare_dish', 'prepare_drink', 'wash_item'].includes(task.type)) {
      const itemRate = getStaffTaskRate(nextState, worker, task);
      const nextItems = updateItemProgress(
        nextState.serviceItems,
        itemIds,
        itemRate,
        now,
        nextState,
        worker,
        task,
      );
      nextState = { ...nextState, serviceItems: nextItems };
      const primary = nextItems.find(item => sameId(item.id, task.serviceItemId));
      if (primary && finite(primary.accumulatedWork)) {
        nextWorker = {
          ...nextWorker,
          task: {
            ...nextWorker.task,
            accumulatedWork: primary.accumulatedWork,
            lastProgressAt: primary.lastProgressAt,
          },
        };
      }
    }
  }
  return { state: nextState, worker: nextWorker };
}

function removeBatchId(item) {
  if (!item || !Object.hasOwn(item, 'batchId')) return item;
  const { batchId: _batchId, ...withoutBatch } = item;
  return withoutBatch;
}

function releasePreparationItem(item, workerId, { preserveReady = true, now = null } = {}) {
  if (!item || item.assignedStaffId !== workerId) return item;
  if (item.state === 'preparing' || item.state === 'ordered') {
    const withoutBatch = removeBatchId(item);
    const hasProgress = finite(item.accumulatedWork) && item.accumulatedWork > 0;
    return {
      ...withoutBatch,
      state: 'ordered',
      stationId: null,
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
      ...(hasProgress
        ? (finite(now)
          ? { lastProgressAt: Math.max(finite(item.lastProgressAt) ? item.lastProgressAt : now, now) }
          : {})
        : { preparationStartedAt: null, readyAt: null, lastProgressAt: null }),
    };
  }
  if (item.state === 'ready' && preserveReady) {
    return {
      ...removeBatchId(item),
      stationId: null,
      assignedStaffId: null,
    };
  }
  return item;
}

function releaseWashItem(item, workerId) {
  if (!item || (item.assignedStaffId != null && item.assignedStaffId !== workerId)
    || !['queued_for_wash', 'washing'].includes(item.state)) return item;
  return {
    ...item,
    state: 'queued_for_wash',
    assignedStaffId: null,
    washStationId: item.washStationId ?? null,
    ...(finite(item.accumulatedWork) && item.accumulatedWork > 0
      ? {} : { washStartedAt: null }),
  };
}

function otherCarriers(state, workerId, itemId) {
  return (state.staff || []).some(worker => worker.id !== workerId
    && getCarriedServiceItemIds(worker).some(id => sameId(id, itemId)));
}

function requeueFiredItem(state, item, worker, loadIds) {
  const workerId = worker?.id;
  if (!loadIds.has(String(item.id)) || otherCarriers(state, workerId, item.id)) return item;
  const base = {
    ...item,
    assignedStaffId: null,
    x: Number.isFinite(item.x) ? item.x : worker?.x ?? null,
    y: Number.isFinite(item.y) ? item.y : worker?.y ?? null,
  };
  if (item.state === 'carried_dirty') {
    return item.tableId != null && (state.tables || []).some(table => sameId(table.id, item.tableId))
      ? {
        ...base,
        state: 'dirty_at_table',
        washStationId: null,
        reservedWashStationId: null,
        washStartedAt: null,
      }
      : {
        ...base,
        state: 'queued_for_wash',
        washStationId: null,
        reservedWashStationId: null,
        washStartedAt: null,
      };
  }
  return {
    ...base,
    state: 'to_clean',
    stationId: null,
    serviceTableId: item.foodCancelled ? item.serviceTableId ?? null : null,
    serviceSlotIndex: item.foodCancelled ? item.serviceSlotIndex ?? null : null,
  };
}

function safeCarriedTask(state, worker, serviceItems) {
  const carrying = getCarriedServiceItemIds(worker);
  for (const id of carrying) {
    const item = serviceItems.find(candidate => sameId(candidate.id, id));
    if (!item || !PHYSICAL_STATES.has(item.state)) continue;
    const customer = (state.customers || []).find(candidate => sameId(candidate.id, item.customerId));
    const foodExpired = finite(state.restaurant?.gameTime)
      && finite(customer?.foodDeadlineAt)
      && state.restaurant.gameTime >= customer.foodDeadlineAt;
    if (item.state === 'carried_dirty') {
      const stationId = item.reservedWashStationId ?? item.washStationId
        ?? (['transfer_dirty_item', 'deliver_dirty_item'].includes(worker.task?.type)
          ? worker.task.washStationId : null);
      if (stationId != null && (state.washStations || []).some(station => sameId(station.id, stationId))) {
        return { type: 'deliver_dirty_item', serviceItemId: item.id, washStationId: stationId };
      }
      continue;
    }
    if (item.foodCancelled === true || foodExpired) continue;
    if (worker.role === 'waiter' && customer && customer.state !== 'leaving') {
      return { type: 'deliver_service_item', serviceItemId: item.id, customerId: item.customerId };
    }
  }
  return null;
}

function releaseCookingClaims(state, workerId, task, now) {
  const batches = (state.cookingBatches || []).filter(batch => sameId(batch.cookId, workerId)
    || sameId(batch.id, task?.batchId));
  const batchIds = new Set(batches.map(batch => String(batch.id)));
  const memberIds = new Set(batches.flatMap(getBatchServiceItemIds).map(id => String(id)));
  for (const item of state.serviceItems || []) {
    if (batchIds.has(String(item.batchId)) || sameId(item.assignedStaffId, workerId)
      && item.kind === 'dish') memberIds.add(String(item.id));
  }
  let serviceItems = (state.serviceItems || []).map(item => {
    if (!memberIds.has(String(item.id))) return item;
    if (item.state === 'carried') return removeBatchId(item);
     return releasePreparationItem(item, workerId, { now });
  });
  const cookingBatches = (state.cookingBatches || []).filter(batch => !batchIds.has(String(batch.id)));
  return { ...state, serviceItems, cookingBatches, releasedBatchItemIds: memberIds };
}

function releaseTaskReservations(state, worker, now) {
  const task = worker.task;
  let next = state;
  if (!task) return next;
  if (task.type === 'take_payment') {
    next = {
      ...next,
      customers: (next.customers || []).map(customer =>
        sameId(customer.id, task.customerId) && isCheckoutState(customer)
          ? requeueCheckoutCustomer(customer) : customer),
    };
  }
  if (task.type === 'prepare_dish' || task.type === 'prepare_drink') {
    next = {
      ...next,
      serviceItems: (next.serviceItems || []).map(item =>
        taskItemIds(task).some(id => sameId(id, item.id))
           ? releasePreparationItem(item, worker.id, { now })
          : item),
    };
  }
  if (task.type === 'wash_item') {
    next = {
      ...next,
      serviceItems: (next.serviceItems || []).map(item =>
        sameId(item.id, task.serviceItemId) ? releaseWashItem(item, worker.id) : item),
    };
  }
  if (task.type === 'transfer_dirty_item') {
    next = {
      ...next,
      serviceItems: (next.serviceItems || []).map(item => sameId(item.id, task.serviceItemId)
        ? {
          ...item,
          state: 'queued_for_wash',
          assignedStaffId: null,
          reservedWashStationId: null,
          washStationId: task.sourceWashStationId ?? item.washStationId ?? null,
        }
        : item),
    };
  }
  if (isCleaningTask(task)) next = releaseCleaningAction(next, task, worker.id);
  return next;
}

function clearWorkerTask(state, worker, reason, fired) {
  const carried = getCarriedServiceItemIds(worker);
  let nextServiceItems = (state.serviceItems || []).map(item =>
    fired ? requeueFiredItem(state, item, worker, new Set(carried)) : item);
  const retainedIds = fired ? [] : carried;
  let nextWorker = withCarriedServiceItemIds(
    clearNavigationGoal({ ...worker, task: null }),
    retainedIds,
  );
  if (!fired) {
    const safeTask = safeCarriedTask(state, worker, nextServiceItems);
    if (safeTask) nextWorker = { ...nextWorker, task: safeTask };
    else if (carried.length > 0) {
      const abandonedIds = new Set(
        carried.filter(id => nextServiceItems.some(item => sameId(item.id, id)
          && item.state === 'carried'
          && item.foodCancelled === true)),
      );
      if (abandonedIds.size > 0) {
        nextServiceItems = nextServiceItems.map(item => abandonedIds.has(String(item.id))
          ? {
            ...item,
            state: 'to_clean', assignedStaffId: null, x: worker.x, y: worker.y,
            serviceTableId: null, serviceSlotIndex: null, stationId: null,
            washStationId: null, reservedWashStationId: null,
            washQueuedAt: null, washStartedAt: null,
          }
          : item);
        nextWorker = withCarriedServiceItemIds(nextWorker,
          carried.filter(id => !abandonedIds.has(String(id))));
      }
    }
  }
  // An explicit firing is the one caller that will remove the worker. Keep a
  // physical origin on any item requeued above; do not manufacture inventory.
  void reason;
  return { worker: nextWorker, serviceItems: nextServiceItems };
}

/**
 * Settle and release every reservation held by one staff member.
 *
 * The returned state keeps the worker in place (the reducer may then remove
 * them for `reason === 'fired'`). Work progress is settled at `now` using the
 * worker's pre-release rate. Physical loads are retained for ordinary duty
 * changes and converted to a local cleanup queue only when a firing leaves no
 * carrier behind. Repeated calls after the task/claims are gone are no-ops.
 */
export function releaseStaffWork(state, staffId, reason = 'released', now = state?.restaurant?.gameTime) {
  const workerIndex = (state?.staff || []).findIndex(worker => sameId(worker.id, staffId));
  if (workerIndex < 0) return state;
  const originalWorker = state.staff[workerIndex];
  const fired = reason === 'fired';
  let next = clearNavigationClaims(state, staffId);
  const settled = settleWorkerProgress(next, originalWorker, now);
  next = settled.state;
  let worker = settled.worker;
  next = releaseTaskReservations(next, worker, now);

  const released = releaseCookingClaims(next, staffId, worker.task, now);
  next = released;
  delete next.releasedBatchItemIds;

  if (isCleaningTask(worker.task)) next = releaseCleaningAction(next, worker.task, staffId);
  const cleared = clearWorkerTask(next, worker, reason, fired);
  worker = cleared.worker;
  next = { ...next, serviceItems: cleared.serviceItems };
  next = {
    ...next,
    staff: next.staff.map((candidate, index) => index === workerIndex ? worker : candidate),
  };
  return next;
}

export const releaseStaffTask = releaseStaffWork;
