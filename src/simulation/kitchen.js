import { getUpgradeEffect } from './balance';
import { advanceConsumption } from './consumption';

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

  return { dish, equipment, station };
}

export function processKitchen(state) {
  const consumption = advanceConsumption(state);
  const customers = consumption.customers;
  let serviceItems = consumption.serviceItems;

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

    const kitchenState = { ...state, customers, serviceItems };
    const preparation = canProgressDish(kitchenState, item);
    if (!preparation) return item;

    const speedMultiplier = preparation.equipment?.speedMultiplier || 1;
    const globalSpeedEffect = getUpgradeEffect(kitchenState, 'globalSpeed');
    const cookTime = (preparation.dish.prepTime || 60)
      / (speedMultiplier * (1 + globalSpeedEffect));
    const elapsed = state.restaurant.gameTime - item.preparationStartedAt;
    if (elapsed < cookTime) return item;

    return {
      ...item,
      state: 'ready',
      readyAt: state.restaurant.gameTime,
      x: preparation.station.x + 20,
      y: preparation.station.y + 20,
    };
  }).filter(Boolean);

  const staff = (state.staff || []).map(worker => {
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
    return validPreparation ? worker : { ...worker, task: null, path: [] };
  });
  const result = { ...state, customers, serviceItems, staff };
  return result;
}
