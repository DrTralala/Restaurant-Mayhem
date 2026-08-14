import { getUpgradeEffect } from './balance';

let foodItemCounter = 0;

function placeFoodOnServiceTable(state, foodItems, customers, item) {
  if (foodItems.some(food =>
    food.customerId === item.customerId
    && ['on_service', 'carried', 'delivered'].includes(food.state)
  )) return false;

  const serviceTable = state.serviceTables.find(table =>
    foodItems.filter(food => food.state === 'on_service' && food.serviceTableId === table.id).length < 4
  );
  if (!serviceTable) return false;

  const foodCol = foodItems.filter(food => food.state === 'on_service' && food.serviceTableId === serviceTable.id).length;
  foodItems.push({
    id: `food-${++foodItemCounter}`,
    dishId: item.dishId,
    customerId: item.customerId,
    tableId: customers.find(c => c.id === item.customerId)?.tableId || null,
    serviceTableId: serviceTable.id,
    state: 'on_service',
    x: serviceTable.x + 10 + foodCol * 30,
    y: serviceTable.y + 10,
  });
  return true;
}

export function processKitchen(state) {
  let queue = [...state.kitchenQueue];
  let customers = [...state.customers];
  let completed = [...state.completedCustomers];
  let foodItems = [...state.foodItems];

  foodItems = foodItems.map(food => {
    if (food.state !== 'on_service' || food.serviceTableId) return food;
    const serviceTable = state.serviceTables.find(table =>
      food.x >= table.x && food.x < table.x + 120
      && food.y >= table.y && food.y < table.y + 40
    );
    return serviceTable ? { ...food, serviceTableId: serviceTable.id } : food;
  });

  // Remove queue items for customers that no longer exist or are leaving
  const activeCustomerIds = new Set(customers.filter(c => c.state !== 'leaving').map(c => c.id));
  queue = queue.filter(q => activeCustomerIds.has(q.customerId));

  // Repair version-2 queue entries that reference a station incompatible with
  // their dish before they can progress or place food.
  const occupiedStationIds = new Set(queue
    .filter(item => {
      if (item.completedAt) return false;
      const dish = state.dishes.find(candidate => candidate.id === item.dishId);
      const station = state.kitchenStations.find(candidate => candidate.id === item.stationId);
      return !dish?.requiredEquipmentId || station?.equipmentId === dish.requiredEquipmentId;
    })
    .map(item => item.stationId)
    .filter(Boolean));
  queue = queue.map(item => {
    const dish = state.dishes.find(candidate => candidate.id === item.dishId);
    const station = state.kitchenStations.find(candidate => candidate.id === item.stationId);
    if (!dish?.requiredEquipmentId || station?.equipmentId === dish.requiredEquipmentId) return item;

    const replacement = state.kitchenStations.find(candidate =>
      candidate.equipmentId === dish.requiredEquipmentId && !occupiedStationIds.has(candidate.id)
    );
    if (replacement) occupiedStationIds.add(replacement.id);
    return {
      ...item,
      stationId: replacement?.id || null,
      startTime: null,
      completedAt: null,
    };
  });

  // Convert food for leaving/absent customers to to_clean so cleaning tasks handle it
  const leavingIds = new Set(customers.filter(c => c.state === 'leaving').map(c => c.id));
  const allCustomerIds = new Set(customers.map(c => c.id));
  foodItems = foodItems.map(f => {
    if (f.state === 'to_clean') return f;
    const orphan = !allCustomerIds.has(f.customerId) || leavingIds.has(f.customerId);
    if (orphan && (f.state === 'on_service' || f.state === 'carried' || f.state === 'delivered')) {
      return { ...f, state: 'to_clean' };
    }
    return f;
  });

  // Add ordering customers to queue
  const ordering = customers.filter(c => c.state === 'ordering' && !queue.find(q => q.customerId === c.id) && !foodItems.find(f => f.customerId === c.id));
  for (const customer of ordering) {
    const dish = state.dishes.find(d => d.id === customer.dishId);
    if (!dish) continue;

    const equipmentOk = dish.requiredEquipmentId
      ? state.equipment.some(e => e.id === dish.requiredEquipmentId && e.owned)
      : true;

    if (!equipmentOk) continue;

    const station = state.kitchenStations.find(s =>
      (!dish.requiredEquipmentId || s.equipmentId === dish.requiredEquipmentId)
      && !queue.find(q => q.stationId === s.id && !q.completedAt)
    );

    if (station) {
      queue.push({
        customerId: customer.id,
        dishId: dish.id,
        stationId: station.id,
        startTime: null,
        completedAt: null,
      });
    }
  }

  // Progress cooking → place food on service table
  let nextQueue = [];
  for (const item of queue) {
    if (item.completedAt) {
      if (!placeFoodOnServiceTable(state, foodItems, customers, item)) {
        nextQueue.push(item);
      }
      continue;
    }
    if (item.startTime === null) {
      nextQueue.push(item);
      continue;
    }
    const dish = state.dishes.find(d => d.id === item.dishId);
    const station = state.kitchenStations.find(s => s.id === item.stationId);
    const equipment = station?.equipmentId
      ? state.equipment.find(e => e.id === station.equipmentId)
      : null;
    const speedMultiplier = equipment?.speedMultiplier || 1;
    const globalSpeedEffect = getUpgradeEffect(state, 'globalSpeed');
    const cookTime = (dish?.prepTime || 60) / (speedMultiplier * (1 + globalSpeedEffect));
    const elapsed = state.restaurant.gameTime - item.startTime;

    if (elapsed >= cookTime) {
      const completedItem = { ...item, completedAt: state.restaurant.gameTime };
      if (!placeFoodOnServiceTable(state, foodItems, customers, completedItem)) {
        nextQueue.push(completedItem);
      }
    } else {
      nextQueue.push(item);
    }
  }
  queue = nextQueue;

  // Eating → paying transition (for customers with delivered food)
  customers = customers.map(c => {
    if (c.state === 'eating' && c.eatTime != null && state.restaurant.gameTime - c.eatTime >= 30) {
      return { ...c, state: 'paying', paymentQueuedAt: state.restaurant.gameTime, path: [] };
    }
    return c;
  });

  // Payment completion is handled by a waiter assigned to a cashier station.
  return {
    ...state,
    kitchenQueue: queue,
    customers,
    foodItems,
    completedCustomers: completed,
    restaurant: state.restaurant,
    tables: state.tables,
  };
}
