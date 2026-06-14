export function processKitchen(state) {
  let queue = [...state.kitchenQueue];
  let customers = [...state.customers];
  let completed = [...state.completedCustomers];

  // Add ordering customers to queue
  const ordering = customers.filter(c => c.state === 'ordering' && !queue.find(q => q.customerId === c.id));
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
        startTime: state.restaurant.gameTime,
        completedAt: null,
      });
    }
  }

  // Progress cooking
  for (const item of queue) {
    if (item.completedAt) continue;
    const dish = state.dishes.find(d => d.id === item.dishId);
    const station = state.kitchenStations.find(s => s.id === item.stationId);
    const equipment = station?.equipmentId
      ? state.equipment.find(e => e.id === station.equipmentId)
      : null;
    const speedMultiplier = equipment?.speedMultiplier || 1;
    const cookTime = (dish?.prepTime || 60) / speedMultiplier;
    const elapsed = state.restaurant.gameTime - item.startTime;

    if (elapsed >= cookTime) {
      item.completedAt = state.restaurant.gameTime;
      customers = customers.map(c =>
        c.id === item.customerId
          ? { ...c, state: 'eating', eatTime: state.restaurant.gameTime }
          : c
      );
    }
  }

  // Track customers already paying before this tick
  const alreadyPaying = new Set(state.customers.filter(c => c.state === 'paying').map(c => c.id));

  // Eating → paying transition
  customers = customers.map(c => {
    if (c.state === 'eating' && c.eatTime != null && state.restaurant.gameTime - c.eatTime >= 30) {
      return { ...c, state: 'paying' };
    }
    return c;
  });

  // Paying → completed (only customers that were already paying before this tick)
  const toComplete = customers.filter(c => c.state === 'paying' && alreadyPaying.has(c.id));
  const completedTableIds = new Set(toComplete.map(c => c.tableId).filter(Boolean));
  for (const pc of toComplete) {
    const dish = state.dishes.find(d => d.id === pc.dishId);
    const price = dish?.price || 0;
    const tip = price * 0.15;
    completed.push({
      customerId: pc.id,
      day: state.restaurant.day || Math.floor(state.restaurant.gameTime / 86400) + 1,
      dishId: pc.dishId,
      revenue: price + tip,
      tip,
      totalPaid: price + tip,
    });
  }

  // Clean completed queue items and completed customers
  queue = queue.filter(q => !q.completedAt);
  if (toComplete.length > 0) {
    const completedIds = new Set(toComplete.map(c => c.id));
    customers = customers.filter(c => !completedIds.has(c.id));
  }

  // Free tables that belonged to completed paying customers
  let updatedTables = state.tables;
  if (completedTableIds.size > 0) {
    updatedTables = state.tables.map(t =>
      completedTableIds.has(t.id) ? { ...t, status: 'empty' } : t
    );
  }

  return {
    ...state,
    kitchenQueue: queue,
    customers,
    completedCustomers: completed,
    restaurant: { ...state.restaurant, totalServed: completed.length },
    tables: updatedTables,
  };
}
