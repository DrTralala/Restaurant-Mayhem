import { describe, expect, it } from 'vitest';
import { moveStaff, repairInvalidStaffOverlaps, validateStaffMove } from './staffMoves';
import { createInitialState } from './initialState';
import { recordSeatResidency } from '../simulation/movement/seatedDeparture';
import { updateStaff } from '../simulation/staff';
import { findAvailableServiceSlot } from '../simulation/serviceItems';

function movementCoordinator() {
  return {
    version: 1,
    tick: 4,
    requests: new Map([['worker', { id: 'worker', goal: { x: 400, y: 200 } }]]),
    statuses: new Map([['worker', { plan: 'arrived', motion: 'holding' }]]),
    claims: new Map([['worker', { x: 400, y: 200 }]]),
    records: new Map([['worker', { goal: { x: 400, y: 200 } }]]),
    plans: new Map([['worker', [{ from: { x: 200, y: 200 }, to: { x: 400, y: 200 } }]]]),
    diagnostics: { waiting: new Map([['worker', { reason: 'traffic' }]]) },
  };
}

function makeState(overrides = {}) {
  return {
    restaurant: { expansionLevel: 1, gameTime: 100 },
    tables: [],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    customers: [],
    queue: [],
    queueSlots: [],
    serviceItems: [],
    staff: [{
      id: 'worker', name: 'Sofia', role: 'waiter', salary: 150,
      morale: 80, skill: 3, x: 200, y: 200, task: null,
      carryingServiceItemId: null,
    }],
    movementCoordinator: movementCoordinator(),
    ...overrides,
  };
}

function seatOriginOverlapState() {
  const fresh = createInitialState();
  const table = {
    id: 't6', status: 'occupied', seats: 1, x: 340, y: 340,
    diningPartyId: 'p1', diningCustomerIds: ['customer'],
  };
  const chair = { id: 'ch15', tableId: 't6', x: 350, y: 380, rotation: 0 };
  const customer = {
    id: 'customer', partyId: 'p1', partySize: 1, state: 'leaving',
    exitPhase: 'to_door', exitDoorId: 'door2', tableId: table.id, chairId: chair.id,
    x: 360, y: 390, patience: 100, happiness: 80,
  };
  return {
    ...fresh,
    tables: [table],
    chairs: [chair],
    customers: [{ ...customer, ...recordSeatResidency(customer, chair, table) }],
    staff: [{
      id: 'mario', role: 'waiter', x: 360, y: 400,
      task: { type: 'collect_dirty_item', serviceItemId: 'dirty', tableId: table.id },
      carryingServiceItemId: null,
    }],
    serviceItems: [{ id: 'dirty', tableId: table.id, state: 'dirty_at_table' }],
  };
}

describe('validateStaffMove', () => {
  it('accepts a free point on the navigable restaurant floor', () => {
    expect(validateStaffMove(makeState(), 'worker', { x: 500, y: 300 }))
      .toEqual({ valid: true, reason: null });
  });

  it.each([
    ['a fixture', { tables: [{ id: 'table', x: 500, y: 300 }] }, 'overlap'],
    ['another staff member', { staff: [
      { id: 'worker', role: 'waiter', x: 200, y: 200 },
      { id: 'other', role: 'cook', x: 500, y: 300 },
    ] }, 'occupied'],
    ['a customer', { customers: [{ id: 'customer', state: 'waiting', x: 500, y: 300 }] }, 'occupied'],
    ['a visible queue member', {
      queue: [{ partyId: 'party', members: [{ id: 'queued', partyId: 'party', state: 'queued' }] }],
      queueSlots: [{ memberId: 'queued', partyId: 'party', x: 500, y: 300, slot: 0 }],
    }, 'occupied'],
    ['the exterior', {}, 'outside-floor'],
  ])('rejects %s occupancy', (_label, overrides, reason) => {
    const point = _label === 'the exterior' ? { x: 20, y: 300 } : { x: 500, y: 300 };
    expect(validateStaffMove(makeState(overrides), 'worker', point))
      .toEqual({ valid: false, reason });
  });

  it('rejects non-finite points and missing staff', () => {
    const state = makeState();

    expect(validateStaffMove(state, 'worker', { x: Number.NaN, y: 200 }))
      .toEqual({ valid: false, reason: 'non-finite-coordinate' });
    expect(validateStaffMove(state, 'missing', { x: 500, y: 300 }))
      .toEqual({ valid: false, reason: 'missing-staff' });
  });

  it('rejects relocation during protected PTO sleep before checking the destination', () => {
    const state = makeState({
      restaurant: { expansionLevel: 1, gameTime: 200 },
      staff: [{
        ...makeState().staff[0], effectiveDuty: 'pto', dutyPhase: 'active',
        ptoSession: { sleepStartedAt: 100, minimumEndAt: 300 },
        amenityUse: { amenityId: 'bed', slotIndex: 0, phase: 'occupied' },
      }],
    });

    expect(validateStaffMove(state, 'worker', { x: 700, y: 300 }))
      .toEqual({ valid: false, reason: 'protected-sleep' });
  });
});

describe('moveStaff', () => {
  it('returns the original state for an invalid move', () => {
    const state = makeState();

    expect(moveStaff(state, 'worker', { x: Number.NaN, y: 200 })).toBe(state);
  });

  it('moves staff without losing identity, employment data, or cashier assignment', () => {
    const worker = {
      ...makeState().staff[0],
      role: 'waiter', salary: 250, morale: 72, skill: 7,
      cashierStations: undefined,
    };
    const state = makeState({
      staff: [worker],
      cashierStations: [{ id: 'cashier', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'worker' }],
    });

    const result = moveStaff(state, 'worker', { x: 500, y: 300 });

    expect(result.staff[0]).toMatchObject({
      id: 'worker', name: 'Sofia', role: 'waiter', salary: 250,
      morale: 72, skill: 7, x: 500, y: 300,
    });
    expect(result.cashierStations).toEqual(state.cashierStations);
  });

  it('preserves a carried waiter item and moves its physical position with the worker', () => {
    const state = makeState({
      staff: [{
        ...makeState().staff[0], carryingServiceItemId: 'dish',
        task: { type: 'deliver_service_item', serviceItemId: 'dish', customerId: 'customer' },
        navigationGoal: { x: 400, y: 200 }, activityPhase: 'working',
      }],
      serviceItems: [{ id: 'dish', kind: 'dish', state: 'carried', customerId: 'customer', x: 200, y: 200 }],
    });

    const result = moveStaff(state, 'worker', { x: 500, y: 300 });

    expect(result.staff[0]).toMatchObject({ x: 500, y: 300, carryingServiceItemIds: ['dish'] });
    expect(result.serviceItems[0]).toMatchObject({ id: 'dish', state: 'carried', x: 500, y: 300 });
    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
  });

  it('resumes a carried cook dish through a fresh service route after relocation', () => {
    const state = makeState({
      staff: [{
        ...makeState().staff[0], role: 'cook', x: 200, y: 200,
        carryingServiceItemId: 'dish', task: {
          type: 'place_dish_on_service', serviceItemId: 'dish',
          serviceTableId: 'service', serviceSlotIndex: 0,
        }, navigationGoal: { x: 600, y: 120 }, activityPhase: 'working',
      }],
      serviceTables: [{ id: 'service', x: 600, y: 120 }],
      serviceItems: [{
        id: 'dish', kind: 'dish', state: 'carried', menuItemId: 'recipe',
        customerId: 'customer', serviceTableId: 'service', serviceSlotIndex: 0,
        assignedStaffId: 'worker', x: 200, y: 200,
      }],
      customers: [{ id: 'customer', state: 'waiting_for_items' }],
    });

    const moved = moveStaff(state, 'worker', { x: 500, y: 300 });
    expect(moved.staff[0]).toMatchObject({ x: 500, y: 300, task: null, carryingServiceItemIds: ['dish'] });
    expect(moved.serviceItems[0]).toMatchObject({ state: 'carried', x: 500, y: 300 });
    expect(findAvailableServiceSlot(moved)).toMatchObject({ serviceTableId: 'service', serviceSlotIndex: 1 });

    const resumed = updateStaff(moved, { movementDt: 0, gameDt: 0 });
    expect(resumed.staff[0].task).toMatchObject({
      type: 'place_dish_on_service', serviceItemId: 'dish',
      serviceTableId: 'service', serviceSlotIndex: 0,
    });
  });

  it('requeues a cashier customer that was processing when the cashier moves', () => {
    const state = makeState({
      staff: [{
        ...makeState().staff[0], task: {
          type: 'take_payment', customerId: 'customer', stationId: 'cashier', startedAt: 80,
        }, navigationGoal: { x: 840, y: 100 }, activityPhase: 'working',
      }],
      cashierStations: [{ id: 'cashier', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'worker' }],
      customers: [{
        id: 'customer', state: 'checkout_processing', cashierStationId: 'cashier',
        checkoutPosition: { x: 840, y: 180 }, paymentReady: false, x: 840, y: 180,
      }],
    });

    const result = moveStaff(state, 'worker', { x: 500, y: 300 });

    expect(result.customers[0]).toMatchObject({
      state: 'checkout_queued', cashierStationId: null,
      checkoutPosition: null, paymentReady: false,
    });
    expect(result.cashierStations[0]).toHaveProperty('assignedStaffId', 'worker');
  });

  it('resets cooking work so a moved cook cannot finish preparation remotely', () => {
    const state = makeState({
      staff: [{
        id: 'worker', name: 'Marco', role: 'cook', salary: 200, morale: 80, skill: 3,
        x: 200, y: 200, carryingServiceItemId: null,
        task: { type: 'prepare_dish', serviceItemId: 'dish', stationId: 'station' },
        navigationGoal: { x: 120, y: 120 }, activityPhase: 'working',
      }],
      kitchenStations: [{ id: 'station', equipmentId: null, x: 100, y: 120 }],
      serviceItems: [{
        id: 'dish', kind: 'dish', menuItemId: 'recipe', customerId: 'customer',
        state: 'preparing', stationId: 'station', assignedStaffId: 'worker',
        preparationStartedAt: 1,
      }],
      customers: [{ id: 'customer', state: 'waiting_for_items' }],
      dishes: [{ id: 'recipe', prepTime: 60 }],
      equipment: [],
    });

    const result = moveStaff(state, 'worker', { x: 500, y: 300 });

    expect(result.staff[0]).not.toHaveProperty('navigationGoal');
    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', stationId: null, assignedStaffId: null,
      preparationStartedAt: null,
    });
  });

  it('releases every member when a cook carrying a cooking batch is moved', () => {
    const state = makeState({
      kitchenStations: [{ id: 'station', equipmentId: null, x: 100, y: 120 }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'recipe' },
        { id: 'c2', state: 'waiting_for_items', dishId: 'recipe' },
      ],
      dishes: [{ id: 'recipe', prepTime: 60 }],
      staff: [{
        id: 'worker', role: 'cook', skill: 5, morale: 80, x: 200, y: 200,
        task: {
          type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i1',
          serviceItemIds: ['i1', 'i2'], stationId: 'station',
        },
        carryingServiceItemIds: [],
      }],
      serviceItems: [
        {
          id: 'i1', kind: 'dish', menuItemId: 'recipe', customerId: 'c1',
          state: 'preparing', batchId: 'batch-1', stationId: 'station', assignedStaffId: 'worker',
          preparationStartedAt: 50,
        },
        {
          id: 'i2', kind: 'dish', menuItemId: 'recipe', customerId: 'c2',
          state: 'ready', batchId: 'batch-1', stationId: 'station', assignedStaffId: 'worker',
          readyAt: 80,
        },
      ],
      cookingBatches: [{
        id: 'batch-1', cookId: 'worker', stationId: 'station',
        serviceItemIds: ['i1', 'i2'], status: 'preparing', startedAt: 50,
      }],
    });

    const result = moveStaff(state, 'worker', { x: 500, y: 300 });

    expect(result.cookingBatches).toEqual([]);
    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'i1', state: 'ordered', assignedStaffId: null }),
      expect.objectContaining({ id: 'i2', state: 'ordered', assignedStaffId: null }),
    ]));
    expect(result.serviceItems.find(item => item.id === 'i1')).not.toHaveProperty('batchId');
    expect(result.serviceItems.find(item => item.id === 'i2')).not.toHaveProperty('batchId');
  });

  it('removes stale movement runtime and task arrival evidence for the moved worker', () => {
    const state = makeState({
      staff: [{ ...makeState().staff[0], navigationGoal: { x: 400, y: 200 }, task: { type: 'clean_floor', dirtId: 'd1' } }],
    });

    const result = moveStaff(state, 'worker', { x: 500, y: 300 });

    expect(result.movementCoordinator).not.toBe(state.movementCoordinator);
    expect(result.movementCoordinator.requests.has('worker')).toBe(false);
    expect(result.movementCoordinator.statuses.has('worker')).toBe(false);
    expect(result.movementCoordinator.records.has('worker')).toBe(false);
    expect(result.movementCoordinator.plans.has('worker')).toBe(false);
    expect(result.movementCoordinator.claims.has('worker')).toBe(false);
  });

  it('releases a resident rest slot only through a legal exit before relocating', () => {
    const state = makeState({
      tables: [], chairs: [],
      staffAmenities: [{
        id: 'couch', type: 'couch', x: 500, y: 300, rotation: 0,
        slots: [{ index: 0, reservedBy: null, occupiedBy: 'worker' }, { index: 1, reservedBy: null, occupiedBy: null }],
      }],
      staff: [{
        ...makeState().staff[0], x: 510, y: 310, dutyPhase: 'active',
        amenityUse: {
          amenityId: 'couch', slotIndex: 0, phase: 'occupied',
          activityStartedAt: 0, activityEndsAt: 900, lastRecoveryAt: 0,
        },
      }],
    });

    const result = moveStaff(state, 'worker', { x: 700, y: 300 });

    expect(result.staff[0]).toMatchObject({ x: 700, y: 300, amenityUse: null });
    expect(result.staffAmenities[0].slots[0]).toEqual({
      index: 0, reservedBy: null, occupiedBy: null,
    });
  });

  it('clears a reserved rest slot when relocating before arrival', () => {
    const state = makeState({
      tables: [], chairs: [],
      staffAmenities: [{
        id: 'couch', type: 'couch', x: 500, y: 300, rotation: 0,
        slots: [{ index: 0, reservedBy: 'worker', occupiedBy: null }, { index: 1, reservedBy: null, occupiedBy: null }],
      }],
      staff: [{
        ...makeState().staff[0], x: 200, y: 200, dutyPhase: 'travelling',
        amenityUse: {
          amenityId: 'couch', slotIndex: 0, phase: 'reserved',
          activityStartedAt: null, activityEndsAt: null, lastRecoveryAt: null,
        },
      }],
    });

    const result = moveStaff(state, 'worker', { x: 700, y: 300 });

    expect(result.staff[0]).toMatchObject({ x: 700, y: 300, amenityUse: null });
    expect(result.staffAmenities[0].slots[0]).toEqual({
      index: 0, reservedBy: null, occupiedBy: null,
    });
  });

  it('repairs a staff overlap with a verified seat-origin customer without moving the customer', () => {
    const state = seatOriginOverlapState();
    const customerBefore = { ...state.customers[0] };
    const result = repairInvalidStaffOverlaps(state);
    const customer = result.customers[0];
    const worker = result.staff[0];

    expect(customer).toEqual(customerBefore);
    expect(Math.hypot(worker.x - customer.x, worker.y - customer.y)).toBeGreaterThanOrEqual(16);
    expect(worker.task).toBeNull();
    expect(result.tables).toEqual(state.tables);
    expect(result.chairs).toEqual(state.chairs);
  });

  it('leaves a valid state unchanged when no seat-origin overlap exists', () => {
    const state = seatOriginOverlapState();
    const valid = {
      ...state,
      staff: [{ ...state.staff[0], x: 500, y: 500 }],
    };

    expect(repairInvalidStaffOverlaps(valid)).toBe(valid);
  });

  it('avoids an active peer destination claim while repairing an overlap', () => {
    const state = seatOriginOverlapState();
    state.movementCoordinator.claims.set('peer', { x: 400, y: 400 });

    const result = repairInvalidStaffOverlaps(state);

    expect(result.staff[0]).not.toMatchObject({ x: 400, y: 400 });
    expect(Math.hypot(
      result.staff[0].x - result.customers[0].x,
      result.staff[0].y - result.customers[0].y,
    )).toBeGreaterThanOrEqual(16);
  });
});
