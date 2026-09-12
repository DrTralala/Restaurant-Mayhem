import { afterEach, expect, it, vi } from 'vitest';
import { createInitialState } from '../../state/initialState';
import { runTick } from '../gameLoop';
import { prepareSelfSeating } from '../selfSeating';

afterEach(() => vi.restoreAllMocks());

it('does not assign a departing customer’s occupied chair, but reuses it after physical clearance', () => {
  const initial = createInitialState();
  const members = Array.from({ length: 4 }, (_, index) => ({ id: `new-${index}`, partyId: 'new-party',
    partySize: 4, state: 'queued', patience: 900, patienceMax: 900, happiness: 80 }));
  const state = { ...initial, tables: initial.tables.filter(table => table.id === 't4'),
    chairs: initial.chairs.filter(chair => chair.tableId === 't4'),
    queue: [{ partyId: 'new-party', members }],
    customers: [{ id: 'departing', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
      tableId: 't4', chairId: 'ch11', x: 350, y: 380 }] };
  const held = prepareSelfSeating(state);
  expect(held.queue).toHaveLength(1);
  expect(held.customers.some(customer => customer.partyId === 'new-party')).toBe(false);
  const cleared = prepareSelfSeating({
    ...state, customers: [{ ...state.customers[0], x: 500, y: 500 }],
  });
  expect(cleared.queue).toHaveLength(0);
  expect(cleared.customers.filter(customer => customer.partyId === 'new-party'
    && customer.state === 'entering')).toHaveLength(4);
});

it('admits and seats a fresh queued customer before patience expires while a distant customer exits', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const initial = createInitialState();
  const member = { id: 'incoming', partyId: 'incoming-party', partyType: 'solo', partySize: 1,
    state: 'queued', archetype: 'regular', gender: 'female', spendingTier: 'value', spendingBudget: 45,
    patience: 900, patienceMax: 900, queuePatience: 900, queuePatienceMax: 900, happiness: 80 };
  let state = { ...initial, queue: [{ partyId: member.partyId, members: [member] }],
    customers: [{ id: 'outgoing', partyId: 'outgoing-party', state: 'leaving', exitPhase: 'to_door',
      exitDoorId: 'door1', x: 100, y: 600, happiness: 80, reputationApplied: true }] };
  let admittedAt = null;
  let seated = false;
  for (let tick = 0; tick < 240; tick += 1) {
    state = runTick(state, { movementDt: 4 / 30, gameDt: 8 });
    expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
    const customer = state.customers.find(actor => actor.id === member.id);
    if (customer?.state === 'entering' && admittedAt === null) admittedAt = tick * 8;
    if (customer?.state === 'seated') seated = true;
  }
  expect(admittedAt, JSON.stringify({ queue: state.queue, customers: state.customers })).not.toBeNull();
  expect(admittedAt).toBeLessThan(member.queuePatience);
  expect(seated).toBe(true);
  expect(state.customers.some(customer => customer.id === 'outgoing')).toBe(false);
});
