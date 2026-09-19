import { advanceConsumption } from './consumption';
import {
  advanceStaffTaskProgress,
  getStaffTaskLegacyRate,
  getStaffTaskRate,
  getStaffTaskSource,
} from './staffPerformance';
import { getBatchServiceItemIds, normaliseCookingBatches } from './cookingBatches';
import { expireFoodPatience } from './foodPatience';
import { getCharacterMovementStatus } from './movement';
import { isAtPreparationPosition } from './preparationPosition';

const PHYSICAL_ITEM_STATES = new Set(['on_service', 'carried', 'delivered']);
const DIRTY_ITEM_STATES = new Set(['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing']);

function isActiveCustomer(customers, customerId) {
  return customers.some(customer => customer.id === customerId && customer.state !== 'leaving');
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function taskItemIds(task) {
  return [
    ...(Array.isArray(task?.serviceItemIds) ? task.serviceItemIds : []),
    task?.serviceItemId,
  ].filter(id => id != null).map(id => String(id));
}

function taskMatchesDish(state, cook, item) {
  const task = cook?.task;
  if (task?.type !== 'prepare_dish'
    || !sameId(task.stationId, item.stationId)
    || !sameId(item.assignedStaffId, cook.id)) return false;
  if (taskItemIds(task).includes(String(item.id))) return true;
  if (task.batchId == null) return false;
  const batch = (state.cookingBatches || []).find(candidate =>
    sameId(candidate.id, task.batchId));
  return getBatchServiceItemIds(batch).some(id => sameId(id, item.id));
}

function dishPreparation(state, item) {
  const customer = (state.customers || []).find(candidate => candidate.id === item.customerId);
  if (item.foodCancelled === true || customer?.foodOutcome === 'cancelled') return null;
  const dish = (state.dishes || []).find(candidate => candidate.id === item.menuItemId);
  const station = (state.kitchenStations || []).find(candidate => candidate.id === item.stationId);
  const cook = (state.staff || []).find(candidate =>
    sameId(candidate.id, item.assignedStaffId) && candidate.role === 'cook');
  if (!dish || !station || !cook || !taskMatchesDish(state, cook, item)) return null;

  if (dish.requiredEquipmentId && station.equipmentId !== dish.requiredEquipmentId) return null;
  const equipment = station.equipmentId
    ? (state.equipment || []).find(candidate => candidate.id === station.equipmentId && candidate.owned)
    : null;
  if (dish.requiredEquipmentId && !equipment) return null;

  return { dish, equipment, station, cook };
}

function isCertifiedPreparationArrival(state, preparation) {
  return isAtPreparationPosition(preparation.cook, preparation.station)
    && getCharacterMovementStatus(state, preparation.cook.id).plan === 'arrived';
}

function canProgressDish(state, item) {
  const preparation = dishPreparation(state, item);
  if (!preparation || !Number.isFinite(item.preparationStartedAt)
    || !isCertifiedPreparationArrival(state, preparation)) return null;
  return preparation;
}

function pausePreparationProgress(item, cookTask, now) {
  const taskIsPrimary = sameId(cookTask?.serviceItemId, item.id);
  const accumulatedWork = Number.isFinite(item.accumulatedWork)
    ? Math.max(0, item.accumulatedWork)
    : taskIsPrimary && Number.isFinite(cookTask?.accumulatedWork)
      ? Math.max(0, cookTask.accumulatedWork) : 0;
  const previousProgressTimes = [item.lastProgressAt, cookTask?.lastProgressAt]
    .filter(Number.isFinite);
  const lastProgressAt = Number.isFinite(now)
    ? Math.max(now, ...previousProgressTimes)
    : previousProgressTimes.length > 0 ? Math.max(...previousProgressTimes) : undefined;
  return {
    accumulatedWork,
    lastProgressAt,
  };
}

export function processKitchen(state) {
  const expired = expireFoodPatience(state, state.restaurant?.gameTime);
  const consumption = advanceConsumption(expired);
  const reconciled = normaliseCookingBatches({
    ...expired,
    customers: consumption.customers,
    serviceItems: consumption.serviceItems,
  });
  const customers = reconciled.customers;
  let serviceItems = reconciled.serviceItems;
  const cookingBatches = reconciled.cookingBatches;
  const progressByItemId = new Map();

  serviceItems = serviceItems.map(item => {
    if (item.kind !== 'dish') return item;

    const orphan = item.customerId != null && !isActiveCustomer(customers, item.customerId);
    if (item.foodCancelled === true && ['ordered', 'preparing'].includes(item.state)) {
      return null;
    }
    if (orphan && ['ordered', 'preparing'].includes(item.state)) {
      return null;
    }
    if (orphan && DIRTY_ITEM_STATES.has(item.state)) return item;
    if (orphan && (item.state === 'ready' || PHYSICAL_ITEM_STATES.has(item.state))) {
      return { ...item, state: 'to_clean' };
    }
    if (item.state !== 'preparing') return item;

    const kitchenState = { ...reconciled, customers, serviceItems };
    const preparation = dishPreparation(kitchenState, item);
    if (!preparation) return item;

    const preparationTask = {
      type: 'prepare_dish', serviceItemId: item.id, stationId: item.stationId,
    };
    const cookTask = preparation.cook.task?.type === 'prepare_dish'
      && (preparation.cook.task.serviceItemId === item.id
        || (preparation.cook.task.batchId != null
          && getBatchServiceItemIds(
            cookingBatches?.find(batch => batch.id === preparation.cook.task.batchId),
          ).includes(item.id)))
      ? {
        ...preparation.cook.task,
        serviceItemId: item.id,
      }
      : preparationTask;
    if (cookTask.batchId != null && cookTask.serviceItemId !== preparation.cook.task.serviceItemId) {
      delete cookTask.accumulatedWork;
      delete cookTask.lastProgressAt;
    }
    const attended = canProgressDish(kitchenState, item) != null;
    const progress = attended
      ? advanceStaffTaskProgress(
        getStaffTaskSource(kitchenState, {
          ...preparation.cook,
          task: cookTask,
        }),
        state.restaurant.gameTime,
        getStaffTaskRate(kitchenState, preparation.cook, preparationTask),
        item.preparationStartedAt,
        getStaffTaskLegacyRate(kitchenState, preparation.cook, preparationTask),
      )
      : pausePreparationProgress(item, preparation.cook.task, state.restaurant.gameTime);
    progressByItemId.set(item.id, progress);
    if (!attended || progress.accumulatedWork < (preparation.dish.prepTime || 60)) {
      return {
        ...item,
        accumulatedWork: progress.accumulatedWork,
        lastProgressAt: progress.lastProgressAt,
      };
    }

    return {
      ...item,
      state: 'ready',
      readyAt: expired.restaurant.gameTime,
      x: preparation.station.x + 20,
      y: preparation.station.y + 20,
    };
  }).filter(Boolean);

  const staff = (reconciled.staff || []).map(worker => {
    if (worker.task?.type !== 'prepare_dish') return worker;
    const item = serviceItems.find(candidate => candidate.id === worker.task.serviceItemId);
    const dish = item && (state.dishes || []).find(candidate => candidate.id === item.menuItemId);
    const station = (state.kitchenStations || []).find(candidate => candidate.id === worker.task.stationId);
    const requiredEquipmentOwned = !dish?.requiredEquipmentId
      || (state.equipment || []).some(candidate => candidate.id === dish.requiredEquipmentId && candidate.owned);
    const validOrderedTask = worker.role === 'cook' && item?.kind === 'dish' && item.state === 'ordered'
      && dish && station && requiredEquipmentOwned
      && (!dish.requiredEquipmentId || station.equipmentId === dish.requiredEquipmentId);
    const validActiveTask = ['preparing', 'ready'].includes(item?.state)
      && item.assignedStaffId === worker.id
      && item.stationId === worker.task.stationId
      && dishPreparation({ ...state, customers, serviceItems, cookingBatches }, item);
    const validPreparation = validOrderedTask || validActiveTask;
    if (!validPreparation) return { ...worker, task: null };
    const progress = progressByItemId.get(item?.id);
    return progress
      ? { ...worker, task: {
        ...worker.task,
        accumulatedWork: progress.accumulatedWork,
        lastProgressAt: progress.lastProgressAt,
      } }
      : worker;
  });
  return normaliseCookingBatches({ ...expired, customers, serviceItems, staff });
}
