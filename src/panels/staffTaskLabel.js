const taskLabels = {
  clean_table: 'Cleaning table',
  take_order: 'Taking order',
  take_payment: 'Taking payment',
  prepare_dish: 'Preparing dish',
  prepare_drink: 'Preparing drink',
  place_dish_on_service: 'Placing order on service counter',
  pickup_service_item: 'Collecting order',
  deliver_service_item: 'Delivering order',
  deliver_food_item: 'Delivering order',
  clean_floor: 'Cleaning floor',
  collect_dirty_item: 'Collecting dirty item',
  deliver_dirty_item: 'Delivering dirty item',
  transfer_dirty_item: 'Transferring dirty item',
  wash_item: 'Washing item',
};

export function getStaffTaskLabel(worker, cashierStations = []) {
  if (worker?.task == null) {
    const assignedToCashier = worker?.id != null
      && Array.isArray(cashierStations)
      && cashierStations.some(station => station?.assignedStaffId === worker.id);
    return worker?.role === 'waiter' && assignedToCashier ? 'Staffing cashier' : 'Available';
  }

  const type = worker.task.type;
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(taskLabels, type)
    ? taskLabels[type]
    : 'Task unavailable';
}
