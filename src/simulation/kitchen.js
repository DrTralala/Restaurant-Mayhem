import { getUpgradeEffect } from './balance';
import { findAvailableServiceSlot } from './serviceItems';
import { markCustomerItemsDirty } from './dishwashing';
import { ACTIVITY_DURATIONS } from './activity';

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

  return { dish, equipment };
}

export function processKitchen(state) {
  const customers = (state.customers || []).map(customer => {
    if (customer.state === 'eating'
      && Number.isFinite(customer.consumptionStartedAt)
      && Number.isFinite(customer.consumptionDuration)
      && state.restaurant.gameTime - customer.consumptionStartedAt >= customer.consumptionDuration) {
      return {
        ...customer,
        state: 'paying',
        paymentQueuedAt: state.restaurant.gameTime,
        path: [],
      };
    }
    return customer;
  });

  let serviceItems = (state.serviceItems || []).map(item => {
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

    const preparation = canProgressDish(state, item);
    if (!preparation) return item;

    const speedMultiplier = preparation.equipment?.speedMultiplier || 1;
    const globalSpeedEffect = getUpgradeEffect(state, 'globalSpeed');
    const cookTime = (preparation.dish.prepTime || 60)
      / (speedMultiplier * (1 + globalSpeedEffect));
    const elapsed = state.restaurant.gameTime - item.preparationStartedAt;
    if (elapsed < cookTime) return item;

    return {
      ...item,
      state: 'ready',
      readyAt: state.restaurant.gameTime,
      assignedStaffId: null,
    };
  }).filter(Boolean);

  const newlyPaying = customers.filter((customer, index) => customer.state === 'paying'
    && state.customers?.[index]?.state === 'eating');
  for (const customer of newlyPaying) {
    serviceItems = markCustomerItemsDirty(serviceItems, customer.id, state.restaurant.gameTime);
  }

  const readyItems = serviceItems
    .filter(item => item.kind === 'dish' && item.state === 'ready')
    .sort((left, right) =>
      (left.readyAt ?? 0) - (right.readyAt ?? 0)
      || String(left.id).localeCompare(String(right.id)));

  for (const ready of readyItems) {
    const slot = findAvailableServiceSlot({ ...state, customers, serviceItems });
    if (!slot) continue;
    serviceItems = serviceItems.map(item => item.id === ready.id
      ? { ...item, ...slot, state: 'on_service' }
      : item);
  }

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
    const validActiveTask = item?.state === 'preparing'
      && item.assignedStaffId === worker.id
      && item.stationId === worker.task.stationId
      && canProgressDish({ ...state, customers, serviceItems }, item);
    const validPreparation = validOrderedTask || validActiveTask;
    return validPreparation ? worker : { ...worker, task: null, path: [] };
  });
  const result = { ...state, customers, serviceItems, staff,
    tables: (state.tables || []).map(table => newlyPaying.some(customer => customer.tableId === table.id)
      && !customers.some(candidate => !newlyPaying.some(customer => customer.id === candidate.id)
        && candidate.tableId === table.id && candidate.state !== 'leaving')
      ? { ...table, status: 'dirty' } : table) };
  return result;
}
