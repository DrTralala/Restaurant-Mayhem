export function updateStaff(state, dt) {
  let customers = [...state.customers];
  let tables = [...state.tables];
  let foodItems = [...state.foodItems];

  const updatedStaff = state.staff.map(s => ({
    ...s,
    morale: Math.max(0, s.morale - 0.01 * dt),
  }));

  const waiters = updatedStaff.filter(s => s.role === 'waiter');
  const hosts = updatedStaff.filter(s => s.role === 'host');

  // Hosts: auto-clean dirty tables (1 per host per tick)
  for (const host of hosts) {
    const dirtyIdx = tables.findIndex(t => t.status === 'dirty');
    if (dirtyIdx !== -1) {
      tables = tables.map((t, i) => i === dirtyIdx ? { ...t, status: 'empty' } : t);
    }
  }

  // Waiters: seat, take orders, deliver food, clean tables
  for (const waiter of waiters) {
    // 1. Seat waiting customers
    const waitingCustomer = customers.find(c => c.state === 'waiting');
    if (waitingCustomer) {
      customers = customers.map(c =>
        c.id === waitingCustomer.id ? { ...c, state: 'seated', seatTime: Date.now() } : c
      );
      continue;
    }

    // 2. Take orders from seated customers
    const orderingCustomer = customers.find(c => c.state === 'seated' && !c.dishId);
    if (orderingCustomer && state.dishes.length > 0) {
      const popularDish = state.dishes.reduce((best, d) =>
        d.popularity > (best?.popularity || 0) ? d : best, state.dishes[0]
      );
      customers = customers.map(c =>
        c.id === orderingCustomer.id
          ? { ...c, state: 'ordering', dishId: popularDish.id, orderTime: Date.now() }
          : c
      );
      continue;
    }

    // 3. Deliver food from service table to customer's table
    const readyFood = foodItems.find(f => f.state === 'on_service');
    if (readyFood) {
      const customer = customers.find(c => c.id === readyFood.customerId);
      if (customer) {
        const targetTable = state.tables.find(t => t.id === customer.tableId);
        if (targetTable) {
          foodItems = foodItems.map(f =>
            f.id === readyFood.id
              ? { ...f, state: 'delivered', x: targetTable.x + 20, y: targetTable.y + 20 }
              : f
          );
          customers = customers.map(c =>
            c.id === readyFood.customerId
              ? { ...c, state: 'eating', eatTime: state.restaurant.gameTime }
              : c
          );
        }
      }
      continue;
    }

    // 4. Clean delivered food from tables of leaving/completed customers
    const toClean = foodItems.filter(f => f.state === 'to_clean');
    if (toClean.length > 0) {
      const cleanId = toClean[0].id;
      foodItems = foodItems.filter(f => f.id !== cleanId);
    }
  }

  return { ...state, staff: updatedStaff, customers, tables, foodItems };
}
