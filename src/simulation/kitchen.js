import { advanceConsumption } from './consumption';
import {
  advanceStaffTaskProgress,
  getStaffTaskLegacyRate,
  getStaffTaskRate,
  getStaffTaskSource,
} from './staffPerformance';
import { getBatchServiceItemIds, normaliseCookingBatches } from './cookingBatches';

const PHYSICAL_ITEM_STATES = new Set(['on_service', 'carried', 'delivered']);
const DIRTY_ITEM_STATES = new Set(['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing']);

function isActiveCustomer(customers, customerId) {
  return customers.some(customer => customer.id === customerId && customer.state !== 'leaving');
}

function canProgressDish(state, item) {
  const dish = (state.dishes || []).find(candidate => candidate.id === item.menuItemId);
  const station = (state.kitchenStations || []).find(candidate => candidate.id === item.stationId);
  const cook = (state.staff || []).find(candidate =>
    candidate.id === item.assignedStaffId && candidate.role === 'cook');
  if (!dish || !station || !cook || !Number.isFinite(item.preparationStartedAt)) return null;

  if (dish.requiredEquipmentId && station.equipmentId !== dish.requiredEquipmentId) return null;
  const equipment = station.equipmentId
    ? (state.equipment || []).find(candidate => candidate.id === station.equipmentId && candidate.owned)
    : null;
  if (dish.requiredEquipmentId && !equipment) return null;

  return { dish, equipment, station, cook };
}

export function processKitchen(state) {
  const consumption = advanceConsumption(state);
  const reconciled = normaliseCookingBatches({
    ...state,
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
    if (orphan && ['ordered', 'preparing'].includes(item.state)) {
      return null;
    }
    if (orphan && DIRTY_ITEM_STATES.has(item.state)) return item;
    if (orphan && (item.state === 'ready' || PHYSICAL_ITEM_STATES.has(item.state))) {
      return { ...item, state: 'to_clean' };
    }
    if (item.state !== 'preparing') return item;

    const kitchenState = { ...reconciled, customers, serviceItems };
    const preparation = canProgressDish(kitchenState, item);
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
    const progressSource = getStaffTaskSource(kitchenState, {
      ...preparation.cook,
      task: cookTask,
    });
    const progress = advanceStaffTaskProgress(
      progressSource,
      state.restaurant.gameTime,
      getStaffTaskRate(kitchenState, preparation.cook, preparationTask),
      item.preparationStartedAt,
      getStaffTaskLegacyRate(kitchenState, preparation.cook, preparationTask),
    );
    progressByItemId.set(item.id, progress);
    if (progress.accumulatedWork < (preparation.dish.prepTime || 60)) {
      return {
        ...item,
        accumulatedWork: progress.accumulatedWork,
        lastProgressAt: progress.lastProgressAt,
      };
    }

    return {
      ...item,
      state: 'ready',
      readyAt: state.restaurant.gameTime,
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
      && canProgressDish({ ...state, customers, serviceItems }, item);
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
  return normaliseCookingBatches({ ...state, customers, serviceItems, staff });
}
