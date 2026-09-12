import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/initialState';
import { cellToWorld } from './pathfinding';
import { runTick } from './gameLoop';
import { prepareSelfSeating, reconcileSelfSeatingState, resolveSelfSeating } from './selfSeating';

function queuedState(overrides = {}) {
  const fresh = createInitialState();
  return {
    ...fresh,
    paused: false,
    staff: [],
    customers: [],
    tables: fresh.tables.filter(t => t.id === 't1'),
    chairs: fresh.chairs.filter(c => c.tableId === 't1'),
    queue: [{
      partyId: 'p1',
      members: [{
        id: 'c1', partyId: 'p1', partySize: 1, archetype: 'regular',
        state: 'queued', queuePatience: 10000, queuePatienceMax: 10000,
        patience: 10000, patienceMax: 10000, happiness: 80,
      }],
    }],
    ...overrides,
  };
}

function partyOf(size, id = 'p1') {
  return {
    partyId: id,
    members: Array.from({ length: size }, (_value, index) => ({
      id: `${id}-c${index + 1}`,
      partyId: id,
      partySize: size,
      archetype: 'regular',
      state: 'queued',
      queuePatience: 10000,
      queuePatienceMax: 10000,
      patience: 10000,
      patienceMax: 10000,
      happiness: 80,
    })),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('self seating admission', () => {
  it('admits without a waiter and reserves exactly one table', () => {
    const next = prepareSelfSeating(queuedState());
    expect(next.staff).toEqual([]);
    expect(next.queue).toHaveLength(0);
    expect(next.customers[0]).toMatchObject({ state: 'entering', tableId: 't1' });
    expect(next.tables[0]).toMatchObject({ status: 'reserved', diningPartyId: 'p1' });
    expect(prepareSelfSeating(next).customers).toHaveLength(1);
  });

  it.each(['dirty', 'occupied', 'reserved'])('will not admit to %s tables', status => {
    const state = queuedState();
    state.tables = state.tables.map(table => ({ ...table, status }));
    expect(prepareSelfSeating(state).queue).toHaveLength(1);
  });

  it('stores full chair approaches on the reserved table', () => {
    const next = prepareSelfSeating(queuedState());
    expect(next.tables[0].seatingAssignments).toHaveLength(1);
    expect(next.tables[0].seatingAssignments[0]).toMatchObject({
      customerId: 'c1', chairId: 'ch1',
    });
    expect(next.tables[0].seatingAssignments[0].approachPoint).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
    expect(next.tables[0].diningCustomerIds).toEqual(['c1']);
  });

  it('retries a temporarily blocked approach without releasing the reservation or teleporting', () => {
    const admitted = prepareSelfSeating(queuedState());
    const assignment = admitted.tables[0].seatingAssignments[0];
    const before = { x: admitted.customers[0].x, y: admitted.customers[0].y };
    const blockerPoint = cellToWorld(assignment.approachCell);
    const blocked = {
      ...admitted,
      washStations: [{
        id: 'block', type: 'manual', x: blockerPoint.x, y: blockerPoint.y, w: 20, h: 20,
      }],
    };

    const held = prepareSelfSeating(blocked);
    expect(held.tables[0]).toMatchObject({ status: 'reserved', diningPartyId: 'p1' });
    expect(held.queueAdmissionGate).toEqual(admitted.queueAdmissionGate);
    expect(held.customers[0]).toMatchObject(before);
    // A legal alternate approach was realigned without moving the customer.
    expect(held.tables[0].seatingAssignments[0].approachCell)
      .not.toEqual(assignment.approachCell);
    expect(held.customers[0].navigationGoal)
      .toEqual(held.tables[0].seatingAssignments[0].approachPoint);

    const placed = {
      ...held,
      customers: held.customers.map(customer => ({
        ...customer, x: customer.navigationGoal.x, y: customer.navigationGoal.y,
      })),
    };
    const statuses = new Map(placed.customers.map(customer => [customer.id, { plan: 'arrived' }]));
    const seated = resolveSelfSeating(placed, statuses);
    expect(seated.customers[0].state).toBe('seated');
    expect(seated.tables[0].status).toBe('occupied');
  });

  it('reconcile releases its own reservation and sends members away when chairs are removed', () => {
    const admitted = prepareSelfSeating(queuedState());
    const reconciled = reconcileSelfSeatingState({
      ...admitted,
      chairs: [],
      restaurant: { ...admitted.restaurant, reputation: 2 },
    });

    expect(reconciled.tables[0]).toMatchObject({ status: 'empty' });
    expect(reconciled.customers[0]).toMatchObject({ state: 'leaving', tableId: null, chairId: null });
    expect(reconciled.customers[0].reputationApplied).toBeUndefined();
    expect(reconciled.restaurant.reputation).toBe(2);
  });

  it('releases the admitted party queue-slot leases', () => {
    const state = queuedState();
    state.queueSlots = [{ memberId: 'c1', partyId: 'p1', x: 973, y: 390, slot: 0 }];
    const next = prepareSelfSeating(state);
    expect(next.queueSlots.some(record => record.partyId === 'p1')).toBe(false);
    expect(next.customers[0].state).toBe('entering');
  });

  it('selects the oldest compatible party ahead of a younger infeasible one', () => {
    const state = queuedState({ queue: [partyOf(4, 'p-big'), partyOf(1, 'p-small')] });
    const next = prepareSelfSeating(state);
    expect(next.customers.every(customer => customer.partyId === 'p-small')).toBe(true);
    expect(next.queue.map(party => party.partyId)).toEqual(['p-big']);
    expect(next.tables[0]).toMatchObject({ status: 'reserved', diningPartyId: 'p-small' });
  });

  it('leaves an infeasible party outside with identity and leases intact', () => {
    const state = queuedState({ queue: [partyOf(4, 'p-big')] });
    state.tables = state.tables.map(table => ({ ...table, seats: 4 }));
    state.chairs = state.chairs.filter(chair => chair.id === 'ch1');
    state.queueSlots = [{ memberId: 'p-big-c1', partyId: 'p-big', x: 973, y: 390, slot: 0 }];
    const next = prepareSelfSeating(state);
    expect(next.queue).toHaveLength(1);
    expect(next.queue[0].members).toHaveLength(4);
    expect(next.queueSlots).toHaveLength(1);
    expect(next.tables[0].status).toBe('empty');
  });

  it('does not double-reserve a table with two queued parties', () => {
    const state = queuedState({ queue: [partyOf(1, 'p1'), partyOf(1, 'p2')] });
    const next = prepareSelfSeating(state);
    expect(next.queue).toHaveLength(1);
    expect(next.tables[0].diningPartyId).toBe('p1');
    const again = prepareSelfSeating(next);
    expect(again.tables[0].diningPartyId).toBe('p1');
    expect(again.customers.filter(customer => customer.partyId === 'p2')).toHaveLength(0);
  });

  it('keeps safe queue-origin spacing for every admitted member', () => {
    const state = queuedState({ queue: [partyOf(2, 'p1')] });
    const next = prepareSelfSeating(state);
    const entering = next.customers.filter(customer => customer.state === 'entering');
    expect(entering).toHaveLength(2);
    for (let left = 0; left < entering.length; left += 1) {
      for (let right = left + 1; right < entering.length; right += 1) {
        expect(Math.hypot(
          entering[left].x - entering[right].x,
          entering[left].y - entering[right].y,
        )).toBeGreaterThanOrEqual(16);
      }
    }
  });
});

describe('self seating resolution', () => {
  it('is a no-op while a reserved party is still moving', () => {
    const admitted = prepareSelfSeating(queuedState());
    const stillMoving = resolveSelfSeating(admitted, new Map());
    expect(stillMoving.tables[0].status).toBe('reserved');
    expect(stillMoving.customers[0].state).toBe('entering');
  });

  it('seats every member and occupies the table once all approaches arrive', () => {
    const admitted = prepareSelfSeating(queuedState({ queue: [partyOf(2, 'p1')] }));
    const table = admitted.tables[0];
    const statuses = new Map();
    const customers = admitted.customers.map(customer => {
      const assignment = table.seatingAssignments
        .find(candidate => candidate.customerId === customer.id);
      statuses.set(customer.id, { plan: 'arrived' });
      return { ...customer, x: assignment.approachPoint.x, y: assignment.approachPoint.y };
    });
    const seated = resolveSelfSeating({ ...admitted, customers }, statuses);
    expect(seated.tables[0].status).toBe('occupied');
    expect(seated.customers.every(customer => customer.state === 'seated')).toBe(true);
    expect(seated.customers.every(customer => customer.seatResidency)).toBe(true);
  });
});

describe('zero-waiter integration loop', () => {
  it('seats a single diner without any guide task', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = queuedState();
    for (let tick = 0; tick < 1200; tick += 1) {
      state = runTick(state, { gameDt: 2, movementDt: 1 / 30 });
      if (state.customers[0]?.state === 'seated') break;
    }
    expect(state.customers[0]?.state).toBe('seated');
    expect(state.tables[0]).toMatchObject({ status: 'occupied', diningPartyId: 'p1' });
    expect(state.queue).toHaveLength(0);
    expect((state.staff || []).some(worker => worker.task?.type === 'guide_customer')).toBe(false);
  });

  it('seats a four-person party without any waiter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fresh = createInitialState();
    let state = {
      ...fresh,
      paused: false,
      staff: [],
      customers: [],
      tables: fresh.tables.filter(table => table.id === 't3'),
      chairs: fresh.chairs.filter(chair => chair.tableId === 't3'),
      queue: [partyOf(4, 'p4')],
    };
    for (let tick = 0; tick < 1200; tick += 1) {
      state = runTick(state, { gameDt: 2, movementDt: 1 / 30 });
      if (state.customers.length === 4 && state.customers.every(customer => customer.state === 'seated')) {
        break;
      }
    }
    expect(state.customers).toHaveLength(4);
    expect(state.customers.every(customer => customer.state === 'seated')).toBe(true);
    expect(state.tables[0]).toMatchObject({ status: 'occupied', diningPartyId: 'p4' });
    expect(state.tables[0].diningCustomerIds).toHaveLength(4);
    expect(state.queue).toHaveLength(0);
  });

  it('seats a two-person party without any waiter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fresh = createInitialState();
    let state = {
      ...fresh,
      paused: false,
      staff: [],
      customers: [],
      tables: fresh.tables.filter(table => table.id === 't1'),
      chairs: fresh.chairs.filter(chair => chair.tableId === 't1'),
      queue: [partyOf(2, 'p2')],
    };
    for (let tick = 0; tick < 1200; tick += 1) {
      state = runTick(state, { gameDt: 2, movementDt: 1 / 30 });
      if (state.customers.length === 2 && state.customers.every(customer => customer.state === 'seated')) {
        break;
      }
    }
    expect(state.customers).toHaveLength(2);
    expect(state.customers.every(customer => customer.state === 'seated')).toBe(true);
    expect(state.tables[0]).toMatchObject({ status: 'occupied', diningPartyId: 'p2' });
    expect(state.tables[0].diningCustomerIds).toHaveLength(2);
    expect(state.queue).toHaveLength(0);
  });

  it('admits a replacement party while an old checkout customer remains', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fresh = createInitialState();
    let state = {
      ...fresh,
      paused: false,
      staff: [],
      tables: fresh.tables.filter(table => table.id === 't1' || table.id === 't2')
        .map(table => table.id === 't1'
          ? { ...table, status: 'dirty', diningPartyId: 'old', diningCustomerIds: ['old-c'] }
          : table),
      chairs: fresh.chairs.filter(chair => chair.tableId === 't1' || chair.tableId === 't2'),
      customers: [{
        id: 'old-c', partyId: 'old', partySize: 1, state: 'checkout_processing',
        tableId: 't1', chairId: 'ch1', x: 840, y: 180, cashierStationId: 'cashier1',
        checkoutPosition: { x: 840, y: 180 }, seatResidency: { phase: 'clear' },
        happiness: 80, patience: 100, queuePatience: 100, queuePatienceMax: 100,
      }],
      queue: [partyOf(1, 'p-new')],
    };
    for (let tick = 0; tick < 900; tick += 1) {
      state = runTick(state, { gameDt: 2, movementDt: 1 / 30 });
      if (state.customers.some(customer => customer.partyId === 'p-new'
        && customer.state === 'seated')) break;
    }
    expect(state.customers.some(customer => customer.id === 'old-c')).toBe(true);
    const replacement = state.customers.find(customer => customer.partyId === 'p-new');
    expect(replacement?.state).toBe('seated');
    expect(state.tables.find(table => table.id === 't1').status).toBe('dirty');
  });
});
