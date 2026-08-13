let foodItemCounter = 0;

export function processKitchen(state) {
  let queue = [...state.kitchenQueue];
  let customers = [...state.customers];
  let completed = [...state.completedCustomers];
  let foodItems = [...state.foodItems];

  // Remove queue items for customers that no longer exist or are leaving
  const activeCustomerIds = new Set(customers.filter(c => c.state !== 'leaving').map(c => c.id));
  queue = queue.filter(q => activeCustomerIds.has(q.customerId));

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
      !queue.find(q => q.stationId === s.id && !q.completedAt)
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
      nextQueue.push(item);
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
    const cookTime = (dish?.prepTime || 60) / speedMultiplier;
    const elapsed = state.restaurant.gameTime - item.startTime;

    if (elapsed >= cookTime) {
      nextQueue.push({ ...item, completedAt: state.restaurant.gameTime });
      // Place food on first available service table
      const serviceTable = state.serviceTables[0];
      if (serviceTable) {
        const foodCol = foodItems.filter(f => f.state === 'on_service').length % 4;
        foodItems.push({
          id: `food-${++foodItemCounter}`,
          dishId: item.dishId,
          customerId: item.customerId,
          tableId: customers.find(c => c.id === item.customerId)?.tableId || null,
          state: 'on_service',
          x: serviceTable.x + 10 + foodCol * 30,
          y: serviceTable.y + 10,
        });
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

  // Payment completion is handled by a cashier or dual-role cashier-waiter.
  queue = queue.filter(q => !q.completedAt);

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
