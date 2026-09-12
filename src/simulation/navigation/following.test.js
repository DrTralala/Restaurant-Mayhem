import { expect, it } from 'vitest';
import { createInitialState } from '../../state/initialState';
import { prepareStaffForMovement, updateStaff } from '../staff';
import { createGrid } from './grid';

it('replaces formation offsets inside furniture or the guide destination and completes seating', () => {
  const fresh = createInitialState();
  let state = { ...fresh,
    tables: fresh.tables.map(table => table.id === 't1' ? { ...table, status: 'reserved', reservationOwnerStaffId: 'guide' } : table),
    staff: [{ id: 'guide', role: 'waiter', x: 260, y: 160, navigationGoal: { x: 240, y: 180 },
      task: { type: 'guide_customer', customerIds: ['first', 'second'], tableId: 't1', chairIds: ['ch1', 'ch2'], stage: 'follow_guide' } }],
    customers: [
      { id: 'first', x: 248, y: 172, navigationGoal: { x: 248, y: 172 } },
      { id: 'second', x: 280, y: 212, navigationGoal: { x: 236, y: 184 } },
    ].map(customer => ({ ...customer, state: 'guided', guideStaffId: 'guide', tableId: 't1',
      partyId: 'party', partySize: 2, happiness: 80, patience: 1125 })),
  };
  state = prepareStaffForMovement(state, 0);
  const grid = createGrid(state);
  for (const customer of state.customers) {
    expect(customer.navigationGoal).toBeDefined();
    expect(grid.isOpen(customer.navigationGoal)).toBe(true);
    expect(Math.hypot(customer.navigationGoal.x - 240, customer.navigationGoal.y - 180)).toBeGreaterThanOrEqual(16);
  }
  for (let tick = 0; tick < 600 && state.customers.some(customer => customer.state !== 'seated'); tick += 1) {
    state = updateStaff(state, 0.1);
    const actors = [...state.staff, ...state.customers];
    for (let left = 0; left < actors.length; left += 1) for (let right = left + 1; right < actors.length; right += 1) {
      expect(Math.hypot(actors[left].x - actors[right].x, actors[left].y - actors[right].y)).toBeGreaterThanOrEqual(16 - 1e-9);
    }
  }
  expect(state.customers.every(customer => customer.state === 'seated')).toBe(true);
  expect(state.tables.find(table => table.id === 't1').status).toBe('occupied');
});
