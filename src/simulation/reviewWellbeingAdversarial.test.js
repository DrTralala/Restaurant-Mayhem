import { expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { hydrateState } from '../state/persistence';
import { movementSaveSnapshot } from '../state/movementPersistence';
import { validateSavedState } from '../state/saveValidation';
import { createEmptyAmenitySlots } from '../data/staffAmenities';
import { runTick } from './gameLoop';

function liveState() {
  const initial = createInitialState();
  const schedule = Array.from({ length: 48 }, () => 'work');
  schedule[0] = 'rest';
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 0, funds: 10_000 },
    staff: [{
      ...initial.staff[0], x: 500, y: 530, schedule, effectiveDuty: 'work',
      dutyPhase: 'available', task: null, navigationGoal: undefined,
    }],
    staffAmenities: [{
      id: 'couch-1', type: 'couch', x: 500, y: 500, rotation: 0,
      slots: createEmptyAmenitySlots('couch'),
    }],
    tables: [], chairs: [], kitchenStations: [], serviceTables: [],
    cashierStations: [], washStations: [], customers: [], queue: [], queueSlots: [],
    doors: [{ id: 'door-1', y: 340, role: 'entrance' }], serviceItems: [],
    cookingBatches: [], floorDirt: [],
  };
}

function expectRejectedSave(state, pattern) {
  expect(() => validateSavedState(state)).toThrow(pattern);
  expect(() => hydrateState(movementSaveSnapshot(state), createInitialState()))
    .toThrow(pattern);
}

function liveDiningState() {
  const initial = createInitialState();
  return {
    ...initial,
    restaurant: {
      ...initial.restaurant, gameTime: 43_200, openHour: 10, closeHour: 12,
    },
    tables: initial.tables.map(table => table.id === 't1'
      ? {
        ...table, status: 'occupied', diningPartyId: 'dining-party',
        diningCustomerIds: ['diner'],
      }
      : table),
    customers: [{
      id: 'diner', partyId: 'dining-party', partySize: 1, state: 'eating',
      tableId: 't1', chairId: 'ch1', x: 220, y: 190,
      dishId: 'starter-toast', drinkId: null, foodOutcome: 'delivered',
      foodOrderedAt: 43_000, foodPatienceBudget: 600, foodDeadlineAt: 43_600,
      foodCancelledAt: null, orderedServiceItemIds: ['dining-dish'],
      consumedServiceItemIds: [], cancelledServiceItemIds: [],
    }],
    serviceItems: [{
      id: 'dining-dish', kind: 'dish', menuItemId: 'starter-toast', customerId: 'diner',
      tableId: 't1', state: 'delivered', x: 208, y: 208, consumptionStartedAt: 43_200,
    }],
  };
}

function partialCancellationState() {
  const initial = createInitialState();
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 0 },
    staff: [],
    cashierStations: [],
    kitchenStations: [],
    washStations: [],
    tables: initial.tables.map(table => table.id === 't1'
      ? {
        ...table, status: 'occupied', diningPartyId: 'partial-party',
        diningCustomerIds: ['partial-diner'],
      }
      : table),
    customers: [{
      id: 'partial-diner', partyId: 'partial-party', partySize: 1,
      state: 'waiting_for_items', tableId: 't1', chairId: 'ch1', x: 220, y: 190,
      menuOutcome: 'ordered', dishId: 'starter-toast', drinkId: 'water',
      dishPriceAtOrder: 12, drinkPriceAtOrder: 5, orderSubtotal: 17,
      foodOrderedAt: 0, foodPatienceBudget: 10, foodDeadlineAt: 10,
      foodOutcome: 'pending', foodCancelledAt: null, cancelledServiceItemIds: [],
      orderedServiceItemIds: ['cancelled-dish', 'surviving-drink'],
      consumedServiceItemIds: [],
    }],
    serviceItems: [
      {
        id: 'cancelled-dish', kind: 'dish', menuItemId: 'starter-toast',
        customerId: 'partial-diner', tableId: 't1', serviceTableId: 'st1',
        serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130,
      },
      {
        id: 'surviving-drink', kind: 'drink', menuItemId: 'water',
        customerId: 'partial-diner', tableId: 't1', state: 'delivered', x: 224, y: 208,
      },
    ],
  };
}

function sleepingState() {
  const initial = createInitialState();
  const schedule = Array.from({ length: 48 }, () => 'pto');
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 0 },
    staff: [{
      ...initial.staff[0], x: 490, y: 520, schedule, effectiveDuty: 'pto',
      dutyPhase: 'seeking_amenity', task: null, navigationGoal: undefined, morale: 35,
    }],
    staffAmenities: [{
      id: 'bed-1', type: 'bed', x: 500, y: 500, rotation: 0,
      slots: createEmptyAmenitySlots('bed'),
    }],
    tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
    washStations: [], customers: [], queue: [], queueSlots: [],
    doors: [{ id: 'door-1', y: 340, role: 'entrance' }],
    serviceItems: [], cookingBatches: [], floorDirt: [],
  };
}

it('round-trips actual runTick amenity occupancy without losing ownership', () => {
  let state = liveState();
  state = runTick(state, { gameDt: 1, movementDt: 1 });
  expect(state.staff[0].amenityUse?.phase).toBe('occupied');

  const snapshot = movementSaveSnapshot(state);
  const restored = hydrateState(snapshot, createInitialState());
  expect(restored.staff[0].amenityUse).toEqual(state.staff[0].amenityUse);
  expect(restored.staffAmenities[0].slots).toEqual(state.staffAmenities[0].slots);
  expect(restored.staff[0].movementResidency).toEqual(state.staff[0].movementResidency);
});

it('routes a real resident out of a couch before returning to work', () => {
  let state = liveState();
  state = runTick(state, { gameDt: 1, movementDt: 1 });
  expect(state.staff[0].amenityUse?.phase).toBe('occupied');
  const workSchedule = Array.from({ length: 48 }, () => 'work');
  state = {
    ...state,
    staff: [{ ...state.staff[0], schedule: workSchedule }],
  };
  state = runTick(state, { gameDt: 900, movementDt: 0 });
  expect(state.staff[0].dutyPhase).toBe('exiting');
  const exit = state.staff[0].navigationGoal;
  expect(exit).toBeTruthy();
  state = runTick(state, { gameDt: 1, movementDt: 1 });
  expect(state.staff[0]).toMatchObject({
    effectiveDuty: 'work', dutyPhase: 'available', amenityUse: null,
  });
  expect(state.staff[0].movementResidency).toBeUndefined();
  expect(state.staff[0]).toMatchObject({ x: exit.x, y: exit.y });
  expect(state.staffAmenities[0].slots[0]).toEqual({
    index: 0, reservedBy: null, occupiedBy: null,
  });
});

it('rejects v10 saves with an out-of-floor, overlapping amenity', () => {
  const state = liveState();
  state.staffAmenities = [{
    id: 'bad-amenity', type: 'bed', x: 40, y: 50, rotation: 0,
    slots: createEmptyAmenitySlots('bed'),
  }, {
    id: 'bad-overlap', type: 'arcade', x: 50, y: 50, rotation: 0,
    slots: createEmptyAmenitySlots('arcade'),
  }];
  state.tables = [{ id: 'blocking-table', x: 50, y: 50, status: 'empty', seats: 2 }];
  expect(() => validateSavedState(state)).toThrow(/saved navigation geometry|overlap|floor/i);
  expect(() => hydrateState(movementSaveSnapshot(state), createInitialState()))
    .toThrow(/saved navigation geometry|overlap|floor/i);
});

it('rejects v10 saves with missing fixture and staff IDs', () => {
  const state = liveState();
  delete state.tables;
  state.staff = [{ ...state.staff[0] }];
  delete state.staff[0].id;
  expect(() => validateSavedState(state)).toThrow(/tables|staff.*id/i);
});

it('rejects a v10 service item reference after its target collection is emptied', () => {
  const state = liveState();
  state.serviceTables = [];
  state.serviceItems = [{
    id: 'orphan-dish', kind: 'dish', state: 'on_service',
    serviceTableId: 'missing-counter', serviceSlotIndex: 0,
  }];
  expect(() => validateSavedState(state)).toThrow(/serviceTableId|service table/i);
  expect(() => hydrateState(movementSaveSnapshot(state), createInitialState()))
    .toThrow(/serviceTableId|service table/i);
});

it.each([
  ['assigned staff', state => {
    state.serviceItems = [{ id: 'item', kind: 'dish', state: 'preparing', assignedStaffId: 'missing-staff' }];
  }, /assignedStaffId|staff/i],
  ['batch', state => {
    state.serviceItems = [{ id: 'item', kind: 'dish', state: 'preparing', batchId: 'missing-batch' }];
  }, /batch/i],
  ['batch cook', state => {
    state.kitchenStations = [{ id: 'station-1', equipmentId: null, x: 100, y: 120 }];
    state.cookingBatches = [{
      id: 'batch-1', cookId: 'missing-cook', stationId: 'station-1',
      serviceItemIds: [], status: 'reserved', startedAt: null, readyAt: null,
    }];
  }, /cookId|staff/i],
  ['batch station', state => {
    state.cookingBatches = [{
      id: 'batch-1', cookId: 'starter-cook', stationId: 'missing-station',
      serviceItemIds: [], status: 'reserved', startedAt: null, readyAt: null,
    }];
  }, /stationId|station/i],
])('rejects a dangling %s foreign key even when its target collection is empty',
  (_name, configure, pattern) => {
    const state = liveState();
    configure(state);
    expectRejectedSave(state, pattern);
  });

it.each([
  ['clean table', 'janitor', { type: 'clean_table', tableId: 'missing-table' }],
  ['clean floor', 'janitor', { type: 'clean_floor', dirtId: 'missing-dirt' }],
  ['wash item', 'janitor', { type: 'wash_item', serviceItemId: 'missing-item', washStationId: 'missing-wash' }],
  ['collect dirty item', 'waiter', { type: 'collect_dirty_item', serviceItemId: 'missing-item', tableId: 'missing-table' }],
  ['transfer dirty item', 'waiter', {
    type: 'transfer_dirty_item', serviceItemId: 'missing-item',
    washStationId: 'missing-wash', sourceWashStationId: 'missing-source',
  }],
  ['deliver dirty item', 'waiter', { type: 'deliver_dirty_item', serviceItemId: 'missing-item', washStationId: 'missing-wash' }],
  ['pickup service item', 'waiter', { type: 'pickup_service_item', serviceItemId: 'missing-item' }],
  ['take order', 'waiter', { type: 'take_order', customerId: 'missing-customer' }],
  ['take payment', 'waiter', { type: 'take_payment', customerId: 'missing-customer', stationId: 'missing-cashier' }],
  ['prepare drink', 'cook', {
    type: 'prepare_drink', serviceItemId: 'missing-item', serviceTableId: 'missing-counter', serviceSlotIndex: 0,
  }],
  ['prepare dish', 'cook', { type: 'prepare_dish', serviceItemId: 'missing-item', stationId: 'missing-kitchen' }],
  ['place dish', 'cook', {
    type: 'place_dish_on_service', serviceItemId: 'missing-item', serviceTableId: 'missing-counter', serviceSlotIndex: 0,
  }],
  ['deliver service item', 'waiter', { type: 'deliver_service_item', serviceItemId: 'missing-item', customerId: 'missing-customer' }],
])('rejects a %s task whose target reference is missing', (_name, role, task) => {
  const state = liveState();
  state.staff[0] = { ...state.staff[0], role, task };
  expectRejectedSave(state, /task|missing|serviceItem|customer|table|station|dirt/i);
});

it.each([
  ['clean service item', 'janitor', { type: 'clean_service_item', serviceItemId: 'missing-item' }],
  ['cancelled-waste handoff', 'waiter', { type: 'handoff_cancelled_waste', serviceItemId: 'missing-item' }],
])('rejects retired %s tasks as unsupported', (_name, role, task) => {
  const state = liveState();
  state.staff[0] = { ...state.staff[0], role, task };
  expectRejectedSave(state, /unsupported/i);
});

it.each([
  ['prepare dish batch', 'cook', {
    type: 'prepare_dish', serviceItemId: 'item', stationId: 'kitchen-1', batchId: 'missing-batch',
  }, state => {
    state.kitchenStations = [{ id: 'kitchen-1', equipmentId: null, x: 100, y: 120 }];
    state.serviceItems = [{ id: 'item', kind: 'dish', state: 'preparing' }];
  }, /batch/i],
  ['place dish station', 'cook', {
    type: 'place_dish_on_service', serviceItemId: 'item', serviceTableId: 'st1',
    stationId: 'missing-kitchen', serviceSlotIndex: 0,
  }, state => {
    state.serviceTables = [{ id: 'st1', x: 140, y: 120, w: 80, h: 40 }];
    state.serviceItems = [{ id: 'item', kind: 'dish', state: 'ready' }];
  }, /station/i],
  ['place dish batch', 'cook', {
    type: 'place_dish_on_service', serviceItemId: 'item', serviceTableId: 'st1',
    stationId: 'kitchen-1', batchId: 'missing-batch', serviceSlotIndex: 0,
  }, state => {
    state.serviceTables = [{ id: 'st1', x: 140, y: 120, w: 80, h: 40 }];
    state.kitchenStations = [{ id: 'kitchen-1', equipmentId: null, x: 100, y: 120 }];
    state.serviceItems = [{ id: 'item', kind: 'dish', state: 'ready' }];
  }, /batch/i],
])('rejects a %s task optional target when present but dangling',
  (_name, role, task, configure, pattern) => {
    const state = liveState();
    configure(state);
    state.staff[0] = { ...state.staff[0], role, task };
    expectRejectedSave(state, pattern);
  });

it('rejects an occupied arcade whose actor is not at its approach point', () => {
  const state = liveState();
  const amenity = {
    id: 'arcade-1', type: 'arcade', x: 500, y: 500, rotation: 0,
    slots: [{ index: 0, reservedBy: null, occupiedBy: 'starter-cook' }],
  };
  state.staffAmenities = [amenity];
  state.staff[0] = {
    ...state.staff[0], x: 700, y: 530,
    effectiveDuty: 'rest', dutyPhase: 'active',
    amenityUse: {
      amenityId: amenity.id, slotIndex: 0, phase: 'occupied',
      activityStartedAt: 0, activityEndsAt: 600, lastRecoveryAt: 0,
    },
  };
  expect(() => validateSavedState(state)).toThrow(/approach|arcade|residen/i);
});

it('rejects a v10 staff record that omits emitted wellbeing fields', () => {
  const state = liveState();
  const worker = state.staff[0];
  for (const key of [
    'schedule', 'effectiveDuty', 'dutyPhase', 'dutyTransitionRequestedAt',
    'amenityUse', 'ptoSession', 'wellRestedUntil', 'amenityWaitingSince',
    'lastRestActivityType',
  ]) delete worker[key];
  expect(() => validateSavedState(state)).toThrow(/schedule|effectiveDuty|staff/i);
  expect(() => hydrateState(movementSaveSnapshot(state), createInitialState()))
    .toThrow(/schedule|effectiveDuty|staff/i);
});

it('round-trips actual canonical runtime states at dining, cancellation, rest and sleep boundaries', () => {
  const cases = [
    ['live dining', liveDiningState(), { gameDt: 1, movementDt: 0 }],
    ['partial food cancellation', partialCancellationState(), { gameDt: 20, movementDt: 0 }],
    ['rest', liveState(), { gameDt: 1, movementDt: 1 }],
    ['sleep', sleepingState(), { gameDt: 1, movementDt: 0 }],
  ];

  for (const [label, initial, timing] of cases) {
    const ticked = runTick(initial, timing);
    const snapshot = movementSaveSnapshot(ticked);
    const restored = hydrateState(snapshot, createInitialState());
    expect(restored.version, label).toBe(snapshot.version);
    expect(restored.restaurant.gameTime, label).toBe(ticked.restaurant.gameTime);
  }
});

it('rejects mixed numeric and string IDs at the versioned import boundary', () => {
  const state = liveState();
  state.customers = [{ id: 1, state: 'waiting_for_items' }];
  state.serviceItems = [{
    id: 'mixed-item', kind: 'dish', state: 'ordered', customerId: '1',
  }];

  expect(() => validateSavedState(state)).toThrow(/ID|represent/i);
  expect(() => hydrateState(movementSaveSnapshot(state), createInitialState()))
    .toThrow(/ID|represent/i);
});

it('round-trips real automatic-wash progress after runTick', () => {
  const initial = createInitialState();
  let state = {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 0 },
    staff: [],
    washStations: [{ id: 'auto-1', type: 'automatic', level: 2, x: 300, y: 200, w: 40, h: 40 }],
    serviceItems: [{
      id: 'dirty-1', kind: 'dish', state: 'queued_for_wash', washStationId: 'auto-1',
      washQueuedAt: 0, accumulatedWork: 0, lastProgressAt: 0,
    }],
    customers: [],
  };
  state = runTick(state, { gameDt: 10, movementDt: 0 });
  expect(state.serviceItems[0]).toMatchObject({ state: 'washing', washStartedAt: 0 });
  const snapshot = movementSaveSnapshot(state);
  const restored = hydrateState(snapshot, createInitialState());
  expect(restored.serviceItems[0]).toMatchObject({
    id: 'dirty-1', state: 'washing', washStationId: 'auto-1',
    accumulatedWork: state.serviceItems[0].accumulatedWork,
    lastProgressAt: state.serviceItems[0].lastProgressAt,
  });
});

it('round-trips an actual bed arrival with the seven-hour PTO ledger', () => {
  const initial = createInitialState();
  const schedule = Array.from({ length: 48 }, () => 'pto');
  let state = {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 0 },
    staff: [{
      ...initial.staff[0], x: 490, y: 520, schedule, effectiveDuty: 'pto',
      dutyPhase: 'seeking_amenity', task: null, navigationGoal: undefined, morale: 35,
    }],
    staffAmenities: [{
      id: 'bed-1', type: 'bed', x: 500, y: 500, rotation: 0,
      slots: createEmptyAmenitySlots('bed'),
    }],
    tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
    washStations: [], customers: [], queue: [], queueSlots: [], doors: [{ id: 'door-1', y: 340, role: 'entrance' }],
    serviceItems: [], cookingBatches: [], floorDirt: [],
  };
  state = runTick(state, { gameDt: 1, movementDt: 0 });
  expect(state.staff[0].amenityUse?.phase).toBe('occupied');
  expect(state.staff[0].ptoSession.minimumEndAt - state.staff[0].ptoSession.sleepStartedAt)
    .toBe(25_200);
  const restored = hydrateState(movementSaveSnapshot(state), createInitialState());
  expect(restored.staff[0].ptoSession).toEqual(state.staff[0].ptoSession);
  expect(restored.staff[0].amenityUse).toEqual(state.staff[0].amenityUse);
  expect(restored.staffAmenities[0].slots[0]).toEqual(state.staffAmenities[0].slots[0]);
});
