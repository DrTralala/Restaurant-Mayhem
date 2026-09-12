import { describe, expect, it } from 'vitest';
import { buildBlockedCells, cellToWorld } from './pathfinding';
import { getQueueAdmissionGateStatus, planQueuePartyAdmission } from './queueAdmission';
import { getRestaurantWorld } from './world';

function buildAdmissionState() {
  return {
    restaurant: { expansionLevel: 1 },
    queue: [{
      partyId: 'p1',
      members: [
        { id: 'q1', partyId: 'p1', partySize: 2, state: 'queued' },
        { id: 'q2', partyId: 'p1', partySize: 2, state: 'queued' },
      ],
    }],
    customers: [],
    staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360 }],
    tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
    chairs: [
      { id: 'ch1', tableId: 't1', x: 210, y: 180 },
      { id: 'ch2', tableId: 't1', x: 210, y: 260 },
    ],
    doors: [{ id: 'door1', y: 340 }],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
  };
}

function buildGuidedGateState() {
  const state = buildAdmissionState();
  return {
    ...state,
    queue: [],
    queueAdmissionGate: {
      partyId: 'p1',
      customerIds: ['q1', 'q2'],
      guideStaffId: 'w1',
      tableId: 't1',
      doorId: 'door1',
    },
    customers: state.queue[0].members.map((customer, index) => ({
      ...customer,
      state: 'guided',
      entryDoorId: 'door1',
      guideStaffId: 'w1',
      tableId: 't1',
      x: 1000 + index * 20,
      y: 360,
    })),
    staff: [{
      ...state.staff[0],
      task: {
        type: 'guide_customer',
        partyId: 'p1',
        customerId: 'q1',
        customerIds: ['q1', 'q2'],
        tableId: 't1',
      },
    }],
    tables: [{
      ...state.tables[0],
      status: 'reserved',
      reservationOwnerStaffId: 'w1',
    }],
  };
}

describe('queue admission', () => {
  it('plans every member without changing input state', () => {
    const state = buildAdmissionState();
    const snapshot = structuredClone(state);
    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    });

    expect(planned.admittedCustomers).toHaveLength(state.queue[0].members.length);
    expect(planned.admittedCustomers.every(customer => customer.entryDoorId === 'door1')).toBe(true);
    expect(planned.admittedCustomers[0]).toMatchObject({
      state: 'guided', entryDoorId: 'door1', guideStaffId: 'w1', tableId: 't1',
    });
    expect(planned.admittedCustomers[0]).not.toHaveProperty('path');
    expect(planned.admittedCustomers[0]).not.toHaveProperty('navigationGoal');
    expect(planned.gate).toEqual({
      partyId: 'p1', customerIds: ['q1', 'q2'], guideStaffId: 'w1', tableId: 't1',
      doorId: 'door1',
    });
    expect(state).toEqual(snapshot);
  });

  it('clears inherited domain goals atomically without mutating queued input or adding route fields', () => {
    const state = buildAdmissionState();
    state.queue[0].members = state.queue[0].members.map((customer, index) => ({
      ...customer,
      navigationGoal: { x: 500 + index * 20, y: 300 },
    }));
    const snapshot = structuredClone(state);
    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    });

    expect(planned).not.toBeNull();
    expect(planned.admittedCustomers).toHaveLength(2);
    expect(planned.admittedCustomers.every(customer => !Object.hasOwn(customer, 'navigationGoal')))
      .toBe(true);
    expect(planned.admittedCustomers.every(customer => !Object.hasOwn(customer, 'path')))
      .toBe(true);
    expect(planned.admittedCustomers[0]).not.toBe(state.queue[0].members[0]);
    expect(state).toEqual(snapshot);
  });

  it('reserves a door while a non-fading customer is leaving through it', () => {
    const state = buildAdmissionState();
    state.customers = [{
      id: 'out', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
      x: 900, y: 360,
    }];

    expect(planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    })).toBeNull();
  });

  it.each([{ x: 100, y: 600 }, { x: 973, y: 600 }])('does not reserve the doorway for a distant departing customer at %j', position => {
    const state = buildAdmissionState();
    state.customers = [{ id: 'out', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1', ...position }];
    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0], door: state.doors[0], guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }), tableId: 't1',
    });
    expect(planned).not.toBeNull();
    for (const customer of planned.admittedCustomers) {
      expect(Math.hypot(customer.x - position.x, customer.y - position.y)).toBeGreaterThanOrEqual(16);
    }
  });

  it('ignores a fading customer assigned to the requested door', () => {
    const state = buildAdmissionState();
    state.customers = [{
      id: 'out', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
      x: 980, y: 360,
    }];

    expect(planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    })).not.toBeNull();
  });

  it('preserves queue patience and resets service patience when admission starts', () => {
    const state = buildAdmissionState();
    state.queue[0].members = state.queue[0].members.map(customer => ({
      ...customer,
      patience: 20,
      patienceMax: 100,
      queuePatience: 40,
      queuePatienceMax: 100,
    }));

    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    });

    expect(planned.admittedCustomers[0]).toMatchObject({
      patience: 100,
      patienceMax: 100,
      queuePatience: 40,
      queuePatienceMax: 100,
    });
  });

  it('returns null without changing input when every admission cell is occupied', () => {
    const state = buildAdmissionState();
    const world = getRestaurantWorld(state.restaurant);
    const first = {
      x: Math.ceil((world.queueX + 60) / world.gridSize),
      y: Math.ceil(world.kitchenY / world.gridSize),
    };
    const last = {
      x: Math.floor((world.queueX + world.queueW) / world.gridSize),
      y: Math.floor((world.diningY + world.areaH + 50) / world.gridSize),
    };
    for (let y = first.y; y <= last.y; y += 1) {
      for (let x = first.x; x <= last.x; x += 1) {
        state.customers.push({ id: `blocker-${x}-${y}`, state: 'eating', ...cellToWorld({ x, y }) });
      }
    }
    const before = JSON.stringify(state);

    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    });

    expect(planned).toBeNull();
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rolls back when a later party member has no safe admission cell', () => {
    const state = buildAdmissionState();
    const args = {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    };
    const baseline = planQueuePartyAdmission(state, args);
    const freePoint = baseline.admittedCustomers[0];
    const world = getRestaurantWorld(state.restaurant);
    const first = {
      x: Math.ceil((world.queueX + 60) / world.gridSize),
      y: Math.ceil(world.kitchenY / world.gridSize),
    };
    const last = {
      x: Math.floor((world.queueX + world.queueW) / world.gridSize),
      y: Math.floor((world.diningY + world.areaH + 50) / world.gridSize),
    };
    const blocked = buildBlockedCells(state);
    const blockers = [];
    for (let y = first.y; y <= last.y; y += 1) {
      for (let x = first.x; x <= last.x; x += 1) {
        if (blocked.has(`${x},${y}`)) continue;
        const point = cellToWorld({ x, y });
        if (point.x === freePoint.x && point.y === freePoint.y) continue;
        blockers.push({ id: `blocker-${x}-${y}`, state: 'eating', ...point });
      }
    }
    state.customers = blockers;
    const before = structuredClone(state);

    const planned = planQueuePartyAdmission(state, args);

    expect(planned).toBeNull();
    expect(state).toEqual(before);
  });

  it('accepts a statically reachable candidate despite a temporary route occupant', () => {
    const state = buildAdmissionState();
    state.customers = [{ id: 'route-occupant', state: 'eating', x: 1000, y: 340 }];

    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    });

    expect(planned).not.toBeNull();
    expect(planned.admittedCustomers[0]).not.toHaveProperty('path');
  });

  it('does not treat logical waiting projections as admission occupancy', () => {
    const state = buildAdmissionState();
    state.queue.push({
      partyId: 'waiting',
      members: [{ id: 'waiting-1', partyId: 'waiting', partySize: 1, state: 'queued', x: 1000, y: 360 }],
    });

    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    });

    expect(planned.admittedCustomers[0]).toMatchObject({ x: 1000, y: 360 });
  });

  it('reports occupied, clear, and stale gate states deterministically', () => {
    const state = buildGuidedGateState();
    expect(getQueueAdmissionGateStatus(state)).toMatchObject({
      occupied: true, clear: false, stale: false,
    });
    const inside = {
      ...state,
      customers: state.customers.map(customer => ({ ...customer, x: 800 })),
    };
    expect(getQueueAdmissionGateStatus(inside).clear).toBe(true);
    expect(getQueueAdmissionGateStatus({ ...state, staff: [] }).stale).toBe(true);
  });

  it.each([
    ['a different task party', state => {
      state.staff[0].task.partyId = 'other-party';
    }],
    ['a task customer-ID superset', state => {
      state.staff[0].task.customerIds.push('other-customer');
    }],
    ['reordered task customer IDs', state => {
      state.staff[0].task.customerIds.reverse();
    }],
    ['a missing materialised gate member', state => {
      state.customers.pop();
    }],
    ['a member owned by a different party', state => {
      state.customers[0].partyId = 'other-party';
    }],
    ['a member owned by a different guide', state => {
      state.customers[0].guideStaffId = 'other-guide';
    }],
    ['a member owned by a different table', state => {
      state.customers[0].tableId = 'other-table';
    }],
  ])('marks an occupied gate stale for %s', (_label, mutate) => {
    const state = buildGuidedGateState();
    mutate(state);

    expect(getQueueAdmissionGateStatus(state)).toMatchObject({
      occupied: true,
      clear: false,
      stale: true,
    });
  });

  it.each([
    ['a same-length string', 'xx'],
    ['a same-length array-like object', { 0: 'q1', 1: 'q2', length: 2 }],
  ])('safely marks non-array task customer IDs stale for %s', (_label, customerIds) => {
    const state = buildGuidedGateState();
    state.staff[0].task.customerIds = customerIds;

    expect(() => getQueueAdmissionGateStatus(state)).not.toThrow();
    expect(getQueueAdmissionGateStatus(state).stale).toBe(true);
  });

  it('plans a partially visible four-member party atomically at candidates clear of its own exact leases', () => {
    const state = buildAdmissionState();
    state.queue = [{
      partyId: 'p1',
      members: [1, 2, 3, 4].map(index => ({
        id: `q${index}`,
        partyId: 'p1',
        partySize: 4,
        state: 'queued',
        patience: 100,
        happiness: 80,
      })),
    }];
    state.queueSlots = [
      { memberId: 'q1', partyId: 'p1', x: 973, y: 390, slot: 0 },
      { memberId: 'q2', partyId: 'p1', x: 973, y: 420, slot: 1 },
    ];
    const snapshot = structuredClone(state);

    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guideGoal: cellToWorld({ x: 9, y: 11 }),
      tableId: 't1',
    });

    // Admission does not wait for the two hidden members to acquire queue
    // leases: the whole logical party is planned or nothing changes.
    expect(planned).not.toBeNull();
    expect(planned.admittedCustomers).toHaveLength(4);
    const occupants = [
      ...state.staff,
      ...state.queueSlots,
      ...planned.admittedCustomers,
    ].filter(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y));
    for (let left = 0; left < occupants.length; left += 1) {
      for (let right = left + 1; right < occupants.length; right += 1) {
        expect(Math.hypot(
          occupants[left].x - occupants[right].x,
          occupants[left].y - occupants[right].y,
        )).toBeGreaterThanOrEqual(16);
      }
    }
    expect(planned.gate.customerIds).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(state).toEqual(snapshot);
  });
});
