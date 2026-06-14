export function updateStaff(state, dt) {
  let customers = [...state.customers];

  const updatedStaff = state.staff.map(s => ({
    ...s,
    morale: Math.max(0, s.morale - 0.01 * dt),
  }));

  const waiters = updatedStaff.filter(s => s.role === 'waiter');
  const hosts = updatedStaff.filter(s => s.role === 'host');
  const hostSpeedBonus = hosts.length > 0 ? 1 + hosts.length * 0.3 : 1;

  for (const waiter of waiters) {
    const waitingCustomer = customers.find(c => c.state === 'waiting');
    if (waitingCustomer) {
      const seatTime = (3 / (waiter.skill * 0.5 + 1)) / hostSpeedBonus;
      if (seatTime <= dt) {
        customers = customers.map(c =>
          c.id === waitingCustomer.id ? { ...c, state: 'seated', seatTime: Date.now() } : c
        );
        continue;
      }
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

  return { ...state, staff: updatedStaff, customers };
}
