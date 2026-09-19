import { describe, expect, it } from 'vitest';
import { processKitchen } from './kitchen';
import { updateStaff } from './staff';
import {
  getCookingBatchCapacity,
  getEligibleCookingItems,
  normaliseCookingBatches,
} from './cookingBatches';

function kitchenState({ skill = 3, gameTime = 0, serviceItems = [], customers = [], staffTask = null,
  serviceTables = [{ id: 'st1', x: 140, y: 120 }], counterItems = [] } = {}) {
  return {
    restaurant: { gameTime, expansionLevel: 1 },
    staff: [{ id: 'cook', role: 'cook', skill, morale: 50, x: 90, y: 130, task: staffTask }],
    customers,
    serviceItems: [...counterItems, ...serviceItems],
    dishes: [
      { id: 'toast', name: 'Toast', prepTime: 60, requiredEquipmentId: 'eq1' },
      { id: 'pie', name: 'Pie', prepTime: 90, requiredEquipmentId: 'eq1' },
    ],
    equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1 }],
    kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 100, y: 120 }],
    serviceTables,
    tables: [],
    chairs: [],
    queue: [],
    floorDirt: [],
    washStations: [],
    unlockedDrinkIds: [],
    upgrades: [],
  };
}

function orderedDish(id, customerId, menuItemId = 'toast') {
  return {
    id, kind: 'dish', menuItemId, customerId, tableId: `table-${customerId}`,
    state: 'ordered', stationId: null, assignedStaffId: null,
    preparationStartedAt: null, readyAt: null,
  };
}

function waitingCustomer(id, orderTime) {
  return {
    id, state: 'waiting_for_items', tableId: `table-${id}`, dishId: 'toast', orderTime,
  };
}

describe('cooking batches', () => {
  it.each([
    [1, 1], [4, 1], [5, 2], [9, 2], [10, 3],
  ])('uses skill %s to permit %s simultaneous dishes', (skill, capacity) => {
    expect(getCookingBatchCapacity({ skill })).toBe(capacity);
  });

  it('reserves the oldest compatible orders, including duplicate recipes, on one station', () => {
    const state = kitchenState({
      skill: 5,
      customers: [waitingCustomer('c1', 10), waitingCustomer('c2', 20), waitingCustomer('c3', 30)],
      serviceItems: [orderedDish('i1', 'c1'), orderedDish('i2', 'c2'), orderedDish('i3', 'c3')],
    });

    const assigned = updateStaff(state, { gameDt: 0, movementDt: 0 });

    expect(assigned.cookingBatches).toHaveLength(1);
    expect(assigned.cookingBatches[0]).toMatchObject({
      cookId: 'cook', stationId: 'k1', status: 'reserved',
      serviceItemIds: ['i1', 'i2'],
    });
    expect(assigned.serviceItems.filter(item => item.batchId === assigned.cookingBatches[0].id))
      .toHaveLength(2);
    expect(assigned.serviceItems.find(item => item.id === 'i3')).toMatchObject({
      state: 'ordered', assignedStaffId: null, stationId: null,
    });
    expect(assigned.staff[0].task).toMatchObject({
      type: 'prepare_dish', batchId: assigned.cookingBatches[0].id,
      serviceItemIds: ['i1', 'i2'], stationId: 'k1',
    });
  });

  it('accepts different recipes requiring the same equipment and excludes drinks from a batch', () => {
    const state = kitchenState({
      skill: 5,
      customers: [waitingCustomer('c1', 10), waitingCustomer('c2', 20)],
      serviceItems: [orderedDish('i1', 'c1', 'toast'), orderedDish('i2', 'c2', 'pie'), {
        id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'ordered',
      }],
    });

    const assigned = updateStaff(state, { gameDt: 0, movementDt: 0 });

    expect(assigned.cookingBatches[0].serviceItemIds).toEqual(['i1', 'i2']);
    expect(assigned.serviceItems.find(item => item.id === 'drink')).not.toHaveProperty('batchId');
  });

  it('reserves separate stations for simultaneous cooks without sharing orders', () => {
    const state = kitchenState({
      customers: [
        waitingCustomer('c1', 10), waitingCustomer('c2', 20),
        waitingCustomer('c3', 30), waitingCustomer('c4', 40),
      ],
      serviceItems: [
        orderedDish('i1', 'c1'), orderedDish('i2', 'c2'),
        orderedDish('i3', 'c3'), orderedDish('i4', 'c4'),
      ],
    });
    const assigned = updateStaff({
      ...state,
      staff: [
        { id: 'cook-a', role: 'cook', skill: 5, morale: 50, x: 80, y: 160, task: null },
        { id: 'cook-b', role: 'cook', skill: 5, morale: 50, x: 280, y: 160, task: null },
      ],
      kitchenStations: [
        { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 },
        { id: 'k2', equipmentId: 'eq1', x: 300, y: 120 },
      ],
    });

    expect(assigned.cookingBatches).toHaveLength(2);
    expect(new Set(assigned.cookingBatches.map(batch => batch.stationId))).toEqual(new Set(['k1', 'k2']));
    expect(new Set(assigned.cookingBatches.flatMap(batch => batch.serviceItemIds)))
      .toEqual(new Set(['i1', 'i2', 'i3', 'i4']));
  });

  it('starts all reserved members on arrival and waits for the slowest member before carrying', () => {
    const reserved = updateStaff(kitchenState({
      skill: 5,
      customers: [waitingCustomer('c1', 10), waitingCustomer('c2', 20)],
      serviceItems: [orderedDish('i1', 'c1', 'toast'), orderedDish('i2', 'c2', 'pie')],
    }), { gameDt: 0, movementDt: 0 });
    const started = updateStaff(reserved, { gameDt: 0, movementDt: 0 });

    const at60 = processKitchen({ ...started, restaurant: { ...started.restaurant, gameTime: 60 } });
    expect(at60.serviceItems.find(item => item.id === 'i1')).toMatchObject({ state: 'ready' });
    expect(at60.serviceItems.find(item => item.id === 'i2')).toMatchObject({ state: 'preparing' });
    expect(at60.cookingBatches[0].status).toBe('preparing');
    expect(at60.staff[0].task).toMatchObject({ batchId: at60.cookingBatches[0].id });

    const at90 = processKitchen({ ...at60, restaurant: { ...at60.restaurant, gameTime: 90 } });
    expect(at90.serviceItems.every(item => item.state === 'ready')).toBe(true);
    expect(at90.cookingBatches[0].status).toBe('ready');
    expect(at90.staff[0].carryingServiceItemIds || []).toEqual([]);
  });

  it('delivers the available part of a ready batch and returns for the remainder', () => {
    const batchReady = {
      ...kitchenState({
        skill: 5,
        customers: [waitingCustomer('c1', 10), waitingCustomer('c2', 20),
          { id: 'counter-1', state: 'waiting_for_items' },
          { id: 'counter-2', state: 'waiting_for_items' },
          { id: 'counter-3', state: 'waiting_for_items' },
          { id: 'counter-4', state: 'waiting_for_items' },
          { id: 'counter-5', state: 'waiting_for_items' },
          { id: 'counter-6', state: 'waiting_for_items' },
          { id: 'counter-7', state: 'waiting_for_items' }],
        serviceItems: [
          { ...orderedDish('i1', 'c1'), state: 'ready', batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook', readyAt: 60 },
          { ...orderedDish('i2', 'c2'), state: 'ready', batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook', readyAt: 60 },
        ],
        counterItems: [
          { id: 'occupied-1', kind: 'dish', customerId: 'counter-1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 0 },
          { id: 'occupied-2', kind: 'dish', customerId: 'counter-2', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 1 },
          { id: 'occupied-3', kind: 'dish', customerId: 'counter-3', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 2 },
          { id: 'occupied-4', kind: 'dish', customerId: 'counter-4', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 3 },
          { id: 'occupied-5', kind: 'dish', customerId: 'counter-5', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 4 },
          { id: 'occupied-6', kind: 'dish', customerId: 'counter-6', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 5 },
          { id: 'occupied-7', kind: 'dish', customerId: 'counter-7', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 6 },
        ],
        staffTask: {
          type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i1',
          serviceItemIds: ['i1', 'i2'], stationId: 'k1',
        },
      }),
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: ['i1', 'i2'],
        status: 'ready', startedAt: 0, readyAt: 60,
      }],
    };

    const carrying = updateStaff(batchReady, { gameDt: 0, movementDt: 0 });
    expect(carrying.staff[0].carryingServiceItemIds).toEqual(['i1']);
    expect(carrying.serviceItems.find(item => item.id === 'i1')).toMatchObject({
      state: 'carried', serviceTableId: 'st1', serviceSlotIndex: 7,
    });
    expect(carrying.serviceItems.find(item => item.id === 'i2')).toMatchObject({
      state: 'ready', batchId: 'batch-1', stationId: 'k1',
    });

    const placed = updateStaff({
      ...carrying,
      staff: carrying.staff.map(worker => ({
        ...worker,
        x: worker.navigationGoal?.x ?? worker.x,
        y: worker.navigationGoal?.y ?? worker.y,
      })),
    }, { gameDt: 0, movementDt: 0 });
    expect(placed.serviceItems.find(item => item.id === 'i1').state).toBe('on_service');
    expect(placed.staff[0].task).toMatchObject({
      type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i2', stationId: 'k1',
    });
    expect(placed.cookingBatches[0].serviceItemIds).toEqual(['i2']);
  });

  it('removes a batch member and clears its reservation when its customer leaves', () => {
    const state = kitchenState({
      gameTime: 20,
      customers: [{ id: 'c1', state: 'leaving' }],
      serviceItems: [{
        ...orderedDish('i1', 'c1'), state: 'preparing', batchId: 'batch-1',
        stationId: 'k1', assignedStaffId: 'cook', preparationStartedAt: 0,
      }],
      staffTask: {
        type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i1',
        serviceItemIds: ['i1'], stationId: 'k1',
      },
    });
    const result = processKitchen({
      ...state,
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: ['i1'],
        status: 'preparing', startedAt: 0,
      }],
    });

    expect(result.cookingBatches).toEqual([]);
    expect(result.serviceItems).toEqual([]);
    expect(result.staff[0].task).toBeNull();
  });

  it('does not mutate durable batch records while normalising them', () => {
    const batch = {
      id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: [], status: 'reserved',
    };
    const state = kitchenState({
      customers: [waitingCustomer('c1', 10)],
      serviceItems: [{
        ...orderedDish('i1', 'c1'), batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook',
      }],
    });
    const before = JSON.parse(JSON.stringify(batch));

    normaliseCookingBatches({ ...state, cookingBatches: [batch] });

    expect(batch).toEqual(before);
  });

  it('returns an active order to the queue when a batch station becomes incompatible', () => {
    const state = kitchenState({
      customers: [waitingCustomer('c1', 10)],
      serviceItems: [{
        ...orderedDish('i1', 'c1'), state: 'preparing', batchId: 'batch-1',
        stationId: 'k1', assignedStaffId: 'cook', preparationStartedAt: 0,
      }],
    });
    const result = normaliseCookingBatches({
      ...state,
      kitchenStations: [{ id: 'k1', equipmentId: 'eq2', x: 100, y: 120 }],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: ['i1'],
        status: 'preparing', startedAt: 0,
      }],
    });

    expect(result.cookingBatches).toEqual([]);
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', stationId: null, assignedStaffId: null,
    });
    expect(result.serviceItems[0]).not.toHaveProperty('batchId');
  });

  it('preserves dirty inventory while normalising an otherwise empty batch ledger', () => {
    const state = kitchenState({
      customers: [],
      serviceItems: [{ id: 'dirty', kind: 'dish', state: 'carried_dirty' }],
    });
    const result = normaliseCookingBatches({
      ...state,
      staff: [{ ...state.staff[0], role: 'waiter', carryingServiceItemIds: ['dirty'] }],
      cookingBatches: [],
    });

    expect(result.staff[0].carryingServiceItemIds).toEqual(['dirty']);
    expect(result.serviceItems[0].state).toBe('carried_dirty');
  });

  it('keeps the remaining batch task when its station is temporarily unreachable', () => {
    const blockers = [
      [80, 100], [100, 100], [120, 100], [140, 100],
      [80, 120], [140, 120], [80, 140], [140, 140],
      [80, 160], [100, 160], [120, 160], [140, 160],
    ].map(([x, y], index) => ({ id: `block-${index}`, x, y }));
    const state = kitchenState({
      serviceTables: [{ id: 'st1', x: 500, y: 300 }],
      customers: [waitingCustomer('c1', 10), waitingCustomer('c2', 20)],
      serviceItems: [
        {
          ...orderedDish('i1', 'c1'), state: 'carried', batchId: 'batch-1',
          stationId: 'k1', assignedStaffId: 'cook', serviceTableId: 'st1', serviceSlotIndex: 0,
          readyAt: 60,
        },
        {
          ...orderedDish('i2', 'c2'), state: 'ready', batchId: 'batch-1',
          stationId: 'k1', assignedStaffId: 'cook', readyAt: 60,
        },
      ],
      staffTask: {
        type: 'place_dish_on_service', batchId: 'batch-1', serviceItemId: 'i1',
        serviceItemIds: ['i1', 'i2'], stationId: 'k1', serviceTableId: 'st1', serviceSlotIndex: 0,
      },
    });
    const result = updateStaff({
      ...state,
      chairs: blockers,
      staff: [{
          ...state.staff[0], x: 480, y: 340, carryingServiceItemIds: ['i1'],
      }],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: ['i1', 'i2'],
        status: 'delivering', startedAt: 0, readyAt: 60,
      }],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.serviceItems.find(item => item.id === 'i1').state).toBe('on_service');
    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i2',
    });
  });

  it('retains the first durable cook and station owners and requeues conflicts', () => {
    const state = kitchenState({
      customers: [waitingCustomer('c1', 10), waitingCustomer('c2', 20), waitingCustomer('c3', 30)],
      staffTask: null,
      serviceItems: [
        { ...orderedDish('i1', 'c1'), state: 'preparing', batchId: 'b1', stationId: 'k1', assignedStaffId: 'cook-a', preparationStartedAt: 0 },
        { ...orderedDish('i2', 'c2'), state: 'preparing', batchId: 'b2', stationId: 'k2', assignedStaffId: 'cook-a', preparationStartedAt: 0 },
        { ...orderedDish('i3', 'c3'), state: 'preparing', batchId: 'b3', stationId: 'k1', assignedStaffId: 'cook-b', preparationStartedAt: 0 },
      ],
    });
    const result = normaliseCookingBatches({
      ...state,
      staff: [
        { ...state.staff[0], id: 'cook-a', role: 'cook' },
        { ...state.staff[0], id: 'cook-b', role: 'cook' },
      ],
      kitchenStations: [
        { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 },
        { id: 'k2', equipmentId: 'eq1', x: 300, y: 120 },
      ],
      cookingBatches: [
        { id: 'b1', cookId: 'cook-a', stationId: 'k1', serviceItemIds: ['i1'], status: 'preparing', startedAt: 0 },
        { id: 'b2', cookId: 'cook-a', stationId: 'k2', serviceItemIds: ['i2'], status: 'preparing', startedAt: 0 },
        { id: 'b3', cookId: 'cook-b', stationId: 'k1', serviceItemIds: ['i3'], status: 'preparing', startedAt: 0 },
      ],
    });

    expect(result.cookingBatches).toHaveLength(1);
    expect(result.cookingBatches[0]).toMatchObject({ id: 'b1', cookId: 'cook-a', stationId: 'k1' });
    expect(result.serviceItems.find(item => item.id === 'i1')).toMatchObject({
      state: 'preparing', batchId: 'b1', assignedStaffId: 'cook-a', stationId: 'k1',
    });
    expect(result.serviceItems.filter(item => ['i2', 'i3'].includes(item.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'i2', state: 'ordered', assignedStaffId: null, stationId: null }),
        expect.objectContaining({ id: 'i3', state: 'ordered', assignedStaffId: null, stationId: null }),
      ]),
    );
    expect(result.serviceItems.find(item => item.id === 'i2')).not.toHaveProperty('batchId');
    expect(result.serviceItems.find(item => item.id === 'i3')).not.toHaveProperty('batchId');
  });

  it('resumes an existing batch owner when its durable task is missing', () => {
    const state = kitchenState({
      customers: [waitingCustomer('c1', 10), waitingCustomer('c2', 20)],
      serviceItems: [
        { ...orderedDish('i1', 'c1'), state: 'preparing', batchId: 'b1', stationId: 'k1', assignedStaffId: 'cook', preparationStartedAt: 0 },
        orderedDish('i2', 'c2'),
      ],
      staffTask: null,
    });
    const result = updateStaff({
      ...state,
      kitchenStations: [
        { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 },
        { id: 'k2', equipmentId: 'eq1', x: 300, y: 120 },
      ],
      cookingBatches: [{
        id: 'b1', cookId: 'cook', stationId: 'k1', serviceItemIds: ['i1'],
        status: 'preparing', startedAt: 0,
      }],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.cookingBatches).toHaveLength(1);
    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_dish', batchId: 'b1', serviceItemId: 'i1', stationId: 'k1',
    });
    expect(result.serviceItems.find(item => item.id === 'i2')).toMatchObject({
      state: 'ordered', assignedStaffId: null, stationId: null,
    });
    expect(result.serviceItems.find(item => item.id === 'i2')).not.toHaveProperty('batchId');
  });

  it('merges matching task members into an explicit empty batch ledger', () => {
    const state = kitchenState({
      customers: [waitingCustomer('c1', 10)],
      serviceItems: [{
        ...orderedDish('i1', 'c1'), state: 'preparing', stationId: null,
        assignedStaffId: null, preparationStartedAt: 0,
      }],
      staffTask: {
        type: 'prepare_dish', batchId: 'b1', serviceItemId: 'i1',
        serviceItemIds: ['i1'], stationId: 'k1', startedAt: 0,
      },
    });
    const result = normaliseCookingBatches({
      ...state,
      cookingBatches: [{
        id: 'b1', cookId: 'cook', stationId: 'k1', serviceItemIds: [],
        status: 'preparing', startedAt: 0,
      }],
    });

    expect(result.cookingBatches).toHaveLength(1);
    expect(result.cookingBatches[0].serviceItemIds).toEqual(['i1']);
    expect(result.serviceItems[0]).toMatchObject({
      state: 'preparing', batchId: 'b1', stationId: 'k1', assignedStaffId: 'cook',
    });
    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_dish', batchId: 'b1', serviceItemId: 'i1', serviceItemIds: ['i1'],
    });
  });

  it('keeps a competing cook off a station held by a partial batch remainder', () => {
    const batchReady = kitchenState({
      skill: 5,
      customers: [
        waitingCustomer('c1', 10), waitingCustomer('c2', 20), waitingCustomer('c3', 30),
        { id: 'counter-1', state: 'waiting_for_items' },
        { id: 'counter-2', state: 'waiting_for_items' },
        { id: 'counter-3', state: 'waiting_for_items' },
      ],
      serviceItems: [
        { ...orderedDish('i1', 'c1'), state: 'ready', batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook', readyAt: 60 },
        { ...orderedDish('i2', 'c2'), state: 'ready', batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook', readyAt: 60 },
        orderedDish('i3', 'c3'),
      ],
      counterItems: [
        { id: 'occupied-1', kind: 'dish', customerId: 'counter-1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 0 },
        { id: 'occupied-2', kind: 'dish', customerId: 'counter-2', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 1 },
        { id: 'occupied-3', kind: 'dish', customerId: 'counter-3', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 2 },
      ],
      staffTask: {
        type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i1',
        serviceItemIds: ['i1', 'i2'], stationId: 'k1',
      },
    });
    const carrying = updateStaff({
      ...batchReady,
      kitchenStations: [
        { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 },
        { id: 'k2', equipmentId: 'eq1', x: 300, y: 120 },
      ],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1', serviceItemIds: ['i1', 'i2'],
        status: 'ready', startedAt: 0, readyAt: 60,
      }],
    }, { gameDt: 0, movementDt: 0 });
    const result = updateStaff({
      ...carrying,
      staff: [
        {
          ...carrying.staff[0],
          x: carrying.staff[0].navigationGoal?.x ?? carrying.staff[0].x,
          y: carrying.staff[0].navigationGoal?.y ?? carrying.staff[0].y,
        },
        { id: 'cook-b', role: 'cook', skill: 3, morale: 50, x: 280, y: 160, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.cookingBatches.find(batch => batch.id === 'batch-1').serviceItemIds)
      .toEqual(['i2']);
    expect(result.staff.find(worker => worker.id === 'cook-b').task).toMatchObject({
      type: 'prepare_dish', stationId: 'k2',
    });
    expect(result.staff.find(worker => worker.id === 'cook-b').task.stationId).not.toBe('k1');
  });

  it('does not dispatch cancelled food back into a cook batch', () => {
    const state = kitchenState({
      customers: [
        { id: 'cancelled', state: 'seated', foodOutcome: 'cancelled' },
        waitingCustomer('live', 20),
      ],
      serviceItems: [
        { ...orderedDish('cancelled-item', 'cancelled'), foodCancelled: true },
        orderedDish('live-item', 'live'),
      ],
    });

    const eligible = getEligibleCookingItems(
      state,
      state.staff[0],
      state.kitchenStations[0],
    );

    expect(eligible.map(item => item.id)).toEqual(['live-item']);
  });

  it('drops a cancelled member while retaining the live batch remainder', () => {
    const state = kitchenState({
      customers: [
        { id: 'cancelled', state: 'seated', foodOutcome: 'cancelled' },
        waitingCustomer('live', 20),
      ],
      serviceItems: [
        {
          ...orderedDish('cancelled-item', 'cancelled'), state: 'preparing',
          batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook',
          preparationStartedAt: 0, foodCancelled: true,
        },
        {
          ...orderedDish('live-item', 'live'), state: 'preparing',
          batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook',
          preparationStartedAt: 0,
        },
      ],
      staffTask: {
        type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'cancelled-item',
        serviceItemIds: ['cancelled-item', 'live-item'], stationId: 'k1',
      },
    });
    const result = normaliseCookingBatches({
      ...state,
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1',
        serviceItemIds: ['cancelled-item', 'live-item'], status: 'preparing', startedAt: 0,
      }],
    });

    expect(result.serviceItems.find(item => item.id === 'cancelled-item')).toBeUndefined();
    expect(result.cookingBatches[0].serviceItemIds).toEqual(['live-item']);
    expect(result.staff[0].task).toMatchObject({
      serviceItemId: 'live-item', serviceItemIds: ['live-item'],
    });
  });

  it('keeps cancelled food in a cook load when its batch is released', () => {
    const state = kitchenState({
      customers: [{ id: 'cancelled', state: 'seated', foodOutcome: 'cancelled' }],
      serviceItems: [{
        ...orderedDish('cancelled-item', 'cancelled'), state: 'carried',
        batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook',
        foodCancelled: true,
      }],
      staffTask: {
        type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'cancelled-item',
        serviceItemIds: ['cancelled-item'], stationId: 'k1',
      },
    });
    const result = normaliseCookingBatches({
      ...state,
      staff: [{ ...state.staff[0], carryingServiceItemIds: ['cancelled-item'] }],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1',
        serviceItemIds: ['cancelled-item'], status: 'delivering', startedAt: 0,
      }],
    });

    expect(result.cookingBatches).toEqual([]);
    expect(result.serviceItems[0]).toMatchObject({
      id: 'cancelled-item', state: 'carried', foodCancelled: true,
    });
    expect(result.serviceItems[0]).not.toHaveProperty('batchId');
    expect(result.staff[0].carryingServiceItemIds).toEqual(['cancelled-item']);
    expect(result.staff[0].task).toBeNull();
  });

  it('honours terminal customer cancellation IDs for a legacy carried batch item', () => {
    const state = kitchenState({
      customers: [{
        id: 'cancelled', state: 'seated', foodOutcome: 'cancelled',
        cancelledServiceItemIds: ['cancelled-item'],
      }],
      serviceItems: [{
        ...orderedDish('cancelled-item', 'cancelled'), state: 'carried',
        batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'cook',
      }],
      staffTask: {
        type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'cancelled-item',
        serviceItemIds: ['cancelled-item'], stationId: 'k1',
      },
    });
    const result = normaliseCookingBatches({
      ...state,
      staff: [{ ...state.staff[0], carryingServiceItemIds: ['cancelled-item'] }],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'k1',
        serviceItemIds: ['cancelled-item'], status: 'delivering', startedAt: 0,
      }],
    });

    expect(result.serviceItems[0]).toMatchObject({
      state: 'carried', foodCancelled: true, deliveryProhibited: true,
    });
    expect(result.staff[0].carryingServiceItemIds).toEqual(['cancelled-item']);
  });
});
