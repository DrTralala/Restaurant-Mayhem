import { expect, it } from 'vitest';
import { createInitialState } from '../../state/initialState';
import { updateCustomers } from '../customers';

it('lets a waiting leaver occupying the exit approach clear it before the older blocked leaver', () => {
  let state = { ...createInitialState(), staff: [], queue: [], queueSlots: [],
    doors: [
      { id: 'door1', y: 340, role: 'exit' },
      { id: 'door2', y: 440, role: 'entrance' },
    ],
    customers: [
      { id: 'older', x: 972.6666666666666, y: 360 },
      { id: 'mouth', x: 1000, y: 371.73333333333335 },
    ].map(customer => ({ ...customer, state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1' })),
    doorAdmissions: { nextSequence: 3, requests: { older: { doorId: 'door1', sequence: 1 }, mouth: { doorId: 'door1', sequence: 2 } } },
  };
  for (let tick = 0; tick < 300 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 4 / 30 });
    if (state.customers.length === 2) expect(Math.hypot(state.customers[0].x - state.customers[1].x,
      state.customers[0].y - state.customers[1].y)).toBeGreaterThanOrEqual(16 - 1e-9);
  }
  expect(state.customers).toHaveLength(0);
});
