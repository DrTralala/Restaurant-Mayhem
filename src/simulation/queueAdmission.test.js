import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pathfinding from './pathfinding';
import { cellToWorld } from './pathfinding';
import { getQueueAdmissionGateStatus, planQueuePartyAdmission } from './queueAdmission';
import { getRestaurantWorld } from './world';

afterEach(() => {
  vi.restoreAllMocks();
});

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
    staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360, path: [] }],
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
    },
    customers: state.queue[0].members.map((customer, index) => ({
      ...customer,
      state: 'guided',
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
      guidePath: [{ x: 20, y: 10 }],
      tableId: 't1',
    });

    expect(planned.admittedCustomers).toHaveLength(state.queue[0].members.length);
    expect(planned.gate).toEqual({
      partyId: 'p1', customerIds: ['q1', 'q2'], guideStaffId: 'w1', tableId: 't1',
    });
    expect(state).toEqual(snapshot);
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
      guidePath: [{ x: 20, y: 10 }],
      tableId: 't1',
    });

    expect(planned).toBeNull();
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rolls back when a later member route fails after an earlier member was staged', () => {
    const state = buildAdmissionState();
    const snapshot = structuredClone(state);
    const route = vi.spyOn(pathfinding, 'findPathWithDynamicFallback')
      .mockReturnValueOnce({ path: [{ x: 49, y: 18 }], usedStaticFallback: false })
      .mockReturnValueOnce({ path: [], usedStaticFallback: false });

    const planned = planQueuePartyAdmission(state, {
      party: state.queue[0],
      door: state.doors[0],
      guide: state.staff[0],
      guidePath: [{ x: 20, y: 10 }],
      tableId: 't1',
    });

    expect(route).toHaveBeenCalledTimes(2);
    expect(planned).toBeNull();
    expect(state).toEqual(snapshot);
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
      guidePath: [{ x: 20, y: 10 }],
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
});
