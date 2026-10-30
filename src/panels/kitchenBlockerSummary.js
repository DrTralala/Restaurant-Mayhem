import { getCookingBatchForItem, isDishCompatibleWithStation } from '../simulation/cookingBatches';
import { getDishForServiceItem } from '../simulation/cookbook';

export function getKitchenBlockerSummary(state = {}) {
  const safeState = {
    ...state,
    customers: Array.isArray(state.customers) ? state.customers : [],
    dishes: Array.isArray(state.dishes) ? state.dishes : [],
    staff: Array.isArray(state.staff) ? state.staff : [],
    equipment: Array.isArray(state.equipment) ? state.equipment : [],
    kitchenStations: Array.isArray(state.kitchenStations) ? state.kitchenStations : [],
    cookingBatches: Array.isArray(state.cookingBatches) ? state.cookingBatches : [],
    serviceItems: Array.isArray(state.serviceItems) ? state.serviceItems : [],
  };
  const owners = new Map(safeState.customers
    .filter(customer => customer?.id != null)
    .map(customer => [String(customer.id), customer]));
  const hasCook = safeState.staff.some(worker => worker?.role === 'cook');
  const summary = { noCook: 0, noCompatibleStation: 0 };
  const byDish = new Map();

  for (const item of safeState.serviceItems) {
    if (!item || item.kind !== 'dish' || item.state !== 'ordered'
      || item.id == null || item.customerId == null
      || item.assignedStaffId != null || item.batchId != null
      || item.foodCancelled === true || item.deliveryProhibited === true) continue;

    const owner = owners.get(String(item.customerId));
    if (!owner || owner.state === 'leaving' || owner.foodOutcome === 'cancelled'
      || (Array.isArray(owner.cancelledServiceItemIds)
        && owner.cancelledServiceItemIds.some(id => String(id) === String(item.id)))) continue;

    let batch;
    let dish;
    try {
      batch = getCookingBatchForItem(safeState, item.id);
      dish = getDishForServiceItem(safeState, item);
    } catch {
      continue;
    }
    if (batch || !dish) continue;

    if (!hasCook) summary.noCook += 1;
    let compatibleStation = false;
    for (const station of safeState.kitchenStations) {
      try {
        if (isDishCompatibleWithStation(safeState, dish, station)) {
          compatibleStation = true;
          break;
        }
      } catch {
        // Malformed station/equipment data cannot establish compatibility.
      }
    }
    if (!compatibleStation) summary.noCompatibleStation += 1;
    if (!hasCook || !compatibleStation) {
      const name = typeof dish.name === 'string' && dish.name.trim()
        ? dish.name : `Dish ${item.menuItemId}`;
      const key = JSON.stringify([item.menuItemId, name]);
      if (!byDish.has(key)) {
        byDish.set(key, { menuItemId: item.menuItemId, name, noCook: 0, noCompatibleStation: 0 });
      }
      const detail = byDish.get(key);
      if (!hasCook) detail.noCook += 1;
      if (!compatibleStation) detail.noCompatibleStation += 1;
    }
  }

  return { ...summary, byDish: [...byDish.values()] };
}
