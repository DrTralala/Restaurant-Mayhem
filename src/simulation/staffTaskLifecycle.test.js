import { describe, expect, it } from 'vitest';
import { releaseStaffWork } from './staffTaskLifecycle';
import { resolveStaffAfterMovement, updateStaff } from './staff';

function baseState(overrides = {}) {
  return {
    restaurant: { gameTime: 100, reputation: 2 },
    staff: [],
    customers: [],
    tables: [],
    floorDirt: [],
    serviceItems: [],
    cookingBatches: [],
    kitchenStations: [],
    serviceTables: [],
    washStations: [],
    ...overrides,
  };
}

describe('releaseStaffWork', () => {
  it('settles and preserves target-owned cleaning progress while releasing the claim', () => {
    const state = baseState({
      staff: [{
        id: 'j1', role: 'janitor', skill: 5, morale: 50, x: 180, y: 220,
        navigationGoal: { x: 180, y: 220 },
        task: { type: 'clean_table', tableId: 't1', cleaningStartedAt: 10 },
      }],
      tables: [{
        id: 't1', status: 'dirty', x: 200, y: 200,
        cleaningAction: {
          id: 't1', eligibleAt: 0, startedAt: 10, accumulatedWork: 20,
          lastProgressAt: 20, instantResolved: true, instantComplete: false,
          staffId: 'j1',
        },
      }],
      movementCoordinator: {
        requests: new Map([['j1', { id: 'j1' }]]),
        statuses: new Map([['j1', { plan: 'arrived' }]]),
        claims: new Map([['j1', { x: 180, y: 220 }]]),
        records: new Map([['j1', {}]]),
        plans: new Map([['j1', []]]),
      },
    });

    const released = releaseStaffWork(state, 'j1', 'break', 40);
    const action = released.tables[0].cleaningAction;

    expect(action).toMatchObject({
      accumulatedWork: 50,
      lastProgressAt: 40,
      instantResolved: true,
      instantComplete: false,
      staffId: null,
    });
    expect(released.staff[0].task).toBeNull();
    expect(released.staff[0]).not.toHaveProperty('navigationGoal');
    expect(released.movementCoordinator.claims.has('j1')).toBe(false);
  });

  it('requeues unfinished batch work without clearing a physical carried load', () => {
    const state = baseState({
      staff: [{
        id: 'cook', role: 'cook', morale: 50, skill: 3, x: 240, y: 180,
        carryingServiceItemIds: ['ready'],
        task: {
          type: 'place_dish_on_service', batchId: 'batch-1',
          serviceItemId: 'ready', serviceItemIds: ['partial', 'ready'], stationId: 'k1',
        },
      }],
      kitchenStations: [{ id: 'k1', equipmentId: null, x: 200, y: 160 }],
      serviceItems: [
        {
          id: 'partial', kind: 'dish', customerId: 'c1', state: 'preparing',
          batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook',
          preparationStartedAt: 0, accumulatedWork: 40, lastProgressAt: 20,
        },
        {
          id: 'ready', kind: 'dish', customerId: 'c2', state: 'carried',
          batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook', x: 240, y: 180,
        },
      ],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1',
        serviceItemIds: ['partial', 'ready'], status: 'delivering', startedAt: 0,
      }],
    });

    const released = releaseStaffWork(state, 'cook', 'break', 40);

    expect(released.cookingBatches).toEqual([]);
    expect(released.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'partial', state: 'ordered', assignedStaffId: null,
        accumulatedWork: 60, lastProgressAt: 40,
      }),
      expect.objectContaining({ id: 'ready', state: 'carried' }),
    ]));
    expect(released.staff[0].carryingServiceItemIds).toEqual(['ready']);
  });

  it('is idempotent when the same worker is released repeatedly', () => {
    const state = baseState({
      staff: [{ id: 'w1', role: 'waiter', x: 100, y: 100, task: null }],
    });

    const first = releaseStaffWork(state, 'w1', 'break', 100);
    expect(releaseStaffWork(first, 'w1', 'break', 100)).toEqual(first);
  });

  it('routes a cancelled carried-dirty load through waiter delivery when a station exists', () => {
    const state = baseState({
      restaurant: { gameTime: 100 },
      staff: [{
        id: 'w1', role: 'waiter', x: 180, y: 220,
        carryingServiceItemIds: ['waste'],
        task: { type: 'deliver_dirty_item', serviceItemId: 'waste', washStationId: 'wash1' },
      }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', foodOutcome: 'cancelled' }],
      serviceItems: [{
        id: 'waste', kind: 'dish', customerId: 'c1', state: 'carried_dirty',
        foodCancelled: true, deliveryProhibited: true, x: 180, y: 220,
      }],
      washStations: [{ id: 'wash1', type: 'manual', x: 180, y: 220, w: 40, h: 40 }],
    });

    const released = releaseStaffWork(state, 'w1', 'break', 100);

    expect(released.staff[0]).toMatchObject({
      task: { type: 'deliver_dirty_item', serviceItemId: 'waste', washStationId: 'wash1' },
      carryingServiceItemIds: ['waste'],
    });
    expect(released.staff[0].task.type).not.toBe('handoff_cancelled_waste');
    expect(released.serviceItems[0]).toMatchObject({
      id: 'waste', state: 'carried_dirty', foodCancelled: true,
    });
  });

  it('retains a cancelled carried-dirty load for a later retry when no station exists', () => {
    const state = baseState({
      restaurant: { gameTime: 100 },
      staff: [{
        id: 'w1', role: 'waiter', x: 180, y: 220,
        carryingServiceItemIds: ['waste'],
        task: { type: 'deliver_service_item', serviceItemId: 'waste', customerId: 'c1' },
      }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', foodOutcome: 'cancelled' }],
      serviceItems: [{
        id: 'waste', kind: 'dish', customerId: 'c1', state: 'carried_dirty',
        foodCancelled: true, deliveryProhibited: true, x: 180, y: 220,
      }],
      washStations: [],
    });

    const released = releaseStaffWork(state, 'w1', 'break', 100);

    expect(released.staff[0]).toMatchObject({
      task: null,
      carryingServiceItemIds: ['waste'],
    });
    expect(released.serviceItems[0]).toMatchObject({
      id: 'waste', state: 'carried_dirty', foodCancelled: true,
    });
  });

  it('requeues a malformed cancelled waiter clean load instead of delivering it', () => {
    const state = baseState({
      staff: [{
        id: 'w1', role: 'waiter', x: 180, y: 220,
        carryingServiceItemIds: ['waste'],
        task: { type: 'deliver_service_item', serviceItemId: 'waste', customerId: 'c1' },
      }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', foodOutcome: 'cancelled' }],
      serviceItems: [{
        id: 'waste', kind: 'dish', customerId: 'c1', tableId: 't1', state: 'carried',
        foodCancelled: true, deliveryProhibited: true, assignedStaffId: 'w1',
        x: 180, y: 220, washStationId: 'stale-sink', reservedWashStationId: 'stale-dishwasher',
        washQueuedAt: 40, washStartedAt: 50,
      }],
    });

    const released = releaseStaffWork(state, 'w1', 'break', 100);

    expect(released.staff[0]).toMatchObject({ task: null, carryingServiceItemIds: [] });
    expect(released.serviceItems[0]).toMatchObject({
      id: 'waste', state: 'to_clean', assignedStaffId: null,
      washStationId: null, reservedWashStationId: null,
      washQueuedAt: null, washStartedAt: null,
    });
  });

  it('repairs an expired malformed waiter clean load without creating a service delivery', () => {
    const state = baseState({
      staff: [{
        id: 'w1', role: 'waiter', x: 180, y: 220,
        carryingServiceItemIds: ['waste'], task: null,
      }],
      customers: [{
        id: 'c1', state: 'seated', tableId: 't1', foodOutcome: 'pending', foodDeadlineAt: 50,
      }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{
        id: 'waste', kind: 'dish', customerId: 'c1', tableId: 't1', state: 'carried',
        foodCancelled: false, assignedStaffId: 'w1', x: 180, y: 220,
      }],
    });

    const repaired = resolveStaffAfterMovement(state, 0);

    expect(repaired.serviceItems[0]).toMatchObject({
      id: 'waste', state: 'carried_dirty', assignedStaffId: null,
    });
    expect(repaired.staff[0].carryingServiceItemIds).toEqual(['waste']);
    expect(repaired.staff[0].task?.type).not.toBe('deliver_service_item');
  });

  it('assigns physical dirty-item collection to a waiter', () => {
    const state = baseState({
      staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220, task: null }],
      serviceItems: [{ id: 'i1', state: 'to_clean', x: 400, y: 300 }],
    });

    const assigned = updateStaff(state, 0);

    expect(assigned.staff[0].task).toMatchObject({
      type: 'collect_dirty_item', serviceItemId: 'i1',
    });
    expect(assigned.staff[0].task).not.toHaveProperty('tableId');
  });

  it('assigns table cleaning to a janitor once dirty items are gone', () => {
    const state = baseState({
      staff: [{ id: 'j1', role: 'janitor', x: 180, y: 220, task: null }],
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
    });

    const assigned = updateStaff(state, 0);

    expect(assigned.staff[0].task).toMatchObject({
      type: 'clean_table', tableId: 't1',
    });
  });

  it('snapshots all eligible seated party members for a level-ten waiter', () => {
    const state = baseState({
      dishes: [{ id: 'dish', price: 5, quality: 1, popularity: 50, prepTime: 60 }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      staff: [{ id: 'w1', role: 'waiter', skill: 10, morale: 50, x: 180, y: 220, task: null }],
      customers: [
        { id: 'c1', partyId: 'p1', state: 'seated', tableId: 't1' },
        { id: 'c2', partyId: 'p1', state: 'seated', tableId: 't1' },
      ],
    });

    const assigned = updateStaff(state, 0);

    expect(assigned.staff[0].task).toMatchObject({
      type: 'take_order', customerId: 'c1', customerIds: ['c1', 'c2'],
    });
  });

  it('orders valid snapshot members even when the anchor leaves before completion', () => {
    const state = baseState({
      restaurant: { gameTime: 100, reputation: 2, day: 1 },
      dishes: [{ id: 'dish', price: 5, quality: 1, popularity: 50, prepTime: 60 }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      staff: [{ id: 'w1', role: 'waiter', skill: 10, morale: 50, x: 180, y: 220,
        task: {
          type: 'take_order', customerId: 'c1', customerIds: ['c1', 'c2'],
          tableId: 't1', partyId: 'p1', startedAt: 0,
        } }],
      customers: [
        { id: 'c1', partyId: 'p1', state: 'leaving', tableId: 't1' },
        { id: 'c2', partyId: 'p1', state: 'seated', tableId: 't1' },
      ],
    });

    const completed = resolveStaffAfterMovement(state, 0);

    expect(completed.customers.find(customer => customer.id === 'c2')).toMatchObject({
      state: 'waiting_for_items', dishId: 'dish',
    });
    expect(completed.serviceItems).toEqual([
      expect.objectContaining({ customerId: 'c2', kind: 'dish', state: 'ordered' }),
    ]);
  });

  it('creates and advances a target-owned table cleaning action only after arrival', () => {
    const state = baseState({
      restaurant: { gameTime: 100 },
      staff: [{ id: 'j1', role: 'janitor', skill: 1, morale: 50, x: 180, y: 220,
        task: { type: 'clean_table', tableId: 't1' } }],
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
    });

    const started = resolveStaffAfterMovement(state, 0);
    expect(started.tables[0].cleaningAction).toMatchObject({
      staffId: 'j1', startedAt: 100, accumulatedWork: 0,
    });

    const progressed = resolveStaffAfterMovement({
      ...started,
      restaurant: { gameTime: 110 },
    }, 0);
    expect(progressed.tables[0].cleaningAction).toMatchObject({
      staffId: 'j1', accumulatedWork: 10, lastProgressAt: 110,
    });
  });
});
