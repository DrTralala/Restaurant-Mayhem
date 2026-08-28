import { getUpgradeEffect } from './balance';
import { findAvailableServiceSlot } from './serviceItems';

const PHYSICAL_ITEM_STATES = new Set(['on_service', 'carried', 'delivered']);

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
      && customer.eatTime != null
      && state.restaurant.gameTime - customer.eatTime >= 30) {
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

  const result = { ...state, customers, serviceItems };
  return result;
}
