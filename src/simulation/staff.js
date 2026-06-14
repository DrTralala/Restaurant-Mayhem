export function updateStaff(state, dt) {
  let customers = [...state.customers];
  let tables = [...state.tables];

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

  // Waiters: seat waiting customers, take orders from seated ones
  for (const waiter of waiters) {
    const waitingCustomer = customers.find(c => c.state === 'waiting');
    if (waitingCustomer) {
      customers = customers.map(c =>
        c.id === waitingCustomer.id ? { ...c, state: 'seated', seatTime: Date.now() } : c
      );
    }

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
    }
  }

  return { ...state, staff: updatedStaff, customers, tables };
}
