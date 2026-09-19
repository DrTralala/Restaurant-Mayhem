import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { saveState, loadState, hydrateState } from './persistence';
import { saveRepositoryState } from './repositorySaves';
import { createInitialState } from './initialState';
import { processKitchen } from '../simulation/kitchen';
import { runTick } from '../simulation/gameLoop';
import { advanceCharacterMovementBatch, createMovementCoordinator } from '../simulation/movement';
import { SAVE_VERSION } from './saveVersion';
import { getCustomerMovementEntries, prepareCustomersForMovement, updateCustomers } from '../simulation/customers';
import { buildCustomerQueueStressState } from '../simulation/customerQueueStress';
import { recordSeatResidency } from '../simulation/movement/seatedDeparture';
import { createGrid } from '../simulation/navigation/grid';
import { isAtPreparationPosition } from '../simulation/preparationPosition';
import { findAvailableServiceSlot } from '../simulation/serviceItems';

beforeEach(() => {
  localStorage.clear();
});

it('normalises legacy two-seat tables regardless of ID without changing their other properties', () => {
  const fresh = createInitialState();
  const saved = {
    ...fresh,
    tables: fresh.tables.map((table, index) => ({ ...table, seats: 2,
      id: index === 0 ? 'custom-table' : table.id, status: index === 0 ? 'dirty' : table.status })),
    chairs: fresh.chairs.map(chair => chair.tableId === 't1' ? { ...chair, tableId: 'custom-table' } : chair),
  };
  const hydrated = hydrateState(saved, fresh);
  expect(hydrated.tables).toEqual(saved.tables.map(table => ({ ...table, seats: 4 })));
  expect(hydrated.chairs).toEqual(saved.chairs);
  expect(saved.tables[0].seats).toBe(2);
  expect(hydrateState(hydrated, fresh).tables).toEqual(hydrated.tables);
});

it('hydrates a partly delivered order into independent consumption without timing pending food', () => {
  const fresh = createInitialState();
  const saved = { ...fresh,
    restaurant: { ...fresh.restaurant, gameTime: 100 },
    tables: fresh.tables.map(table => table.id === 't1' ? { ...table, status: 'occupied' } : table),
    customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1', chairId: 'ch1', x: 220, y: 190,
      menuOutcome: 'ordered', dishId: fresh.dishes[0].id, drinkId: 'water',
      foodOutcome: 'pending', foodOrderedAt: 0, foodPatienceBudget: 300, foodDeadlineAt: 300,
      orderedServiceItemIds: ['dish', 'drink'], consumedServiceItemIds: [] }],
    serviceItems: [
      { id: 'dish', kind: 'dish', menuItemId: fresh.dishes[0].id, customerId: 'c1', tableId: 't1', state: 'ordered' },
      { id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1', state: 'delivered', x: 224, y: 208 },
    ],
  };
  const hydrated = hydrateState(saved, fresh);
  expect(hydrated.customers[0]).toMatchObject({ state: 'eating', foodOutcome: 'pending', orderedServiceItemIds: ['dish', 'drink'] });
  expect(hydrated.serviceItems[0]).not.toHaveProperty('consumptionStartedAt');
  expect(hydrated.serviceItems[1].consumptionStartedAt).toBe(100);
  expect(hydrateState(hydrated, fresh).serviceItems).toEqual(hydrated.serviceItems);
});

it('normalises a saved cook out of a blocked station cell before preparation resumes', () => {
  const fresh = createInitialState();
  const station = fresh.kitchenStations.find(candidate => candidate.id === 'k1');
  const saved = {
    ...fresh,
    restaurant: { ...fresh.restaurant, gameTime: 100 },
    customers: [
      { id: 'c1', state: 'waiting_for_items', dishId: 'starter-toast' },
      { id: 'c2', state: 'waiting_for_items', dishId: 'starter-toast' },
    ],
    serviceItems: [
      {
        id: 'dish', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1', batchId: 'batch-1',
        state: 'preparing', stationId: station.id, assignedStaffId: 'starter-cook',
        preparationStartedAt: 20, accumulatedWork: 12, lastProgressAt: 20,
      },
      {
        id: 'dish-2', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c2', batchId: 'batch-1',
        state: 'preparing', stationId: station.id, assignedStaffId: 'starter-cook',
        preparationStartedAt: 20, accumulatedWork: 18, lastProgressAt: 20,
      },
    ],
    cookingBatches: [{
      id: 'batch-1', cookId: 'starter-cook', stationId: station.id,
      serviceItemIds: ['dish', 'dish-2'], status: 'preparing', startedAt: 20,
    }],
    staff: fresh.staff.map(worker => worker.id === 'starter-cook'
      ? {
        ...worker,
        x: station.x + 20,
        y: station.y + 20,
        navigationGoal: { x: station.x + 20, y: station.y + 20 },
        task: {
          type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'dish',
          serviceItemIds: ['dish', 'dish-2'], stationId: station.id,
        },
      }
      : worker),
  };

  const hydrated = hydrateState(saved, fresh);
  const cook = hydrated.staff.find(worker => worker.id === 'starter-cook');

  expect(createGrid(hydrated).isOpen(cook)).toBe(true);
  expect(isAtPreparationPosition(cook, station)).toBe(false);
  expect(cook.task).toMatchObject(saved.staff.find(worker => worker.id === 'starter-cook').task);
  expect(hydrated.serviceItems).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'dish', accumulatedWork: 12, lastProgressAt: 20 }),
    expect.objectContaining({ id: 'dish-2', accumulatedWork: 18, lastProgressAt: 20 }),
  ]));

  const legalSaved = {
    ...saved,
    staff: saved.staff.map(worker => worker.id === 'starter-cook'
      ? { ...worker, x: station.x - 10, y: station.y + 10,
        navigationGoal: { x: station.x - 10, y: station.y + 10 } }
      : worker),
  };
  const legalHydrated = hydrateState(legalSaved, fresh);
  expect(legalHydrated.staff.find(worker => worker.id === 'starter-cook'))
    .toMatchObject({ x: station.x - 10, y: station.y + 10 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function savedRecoveryState(fresh) {
  const table = {
    id: 't6', seats: 1, status: 'occupied', x: 340, y: 340,
    diningPartyId: 'p1', diningCustomerIds: ['c186'],
  };
  const chair = { id: 'ch15', tableId: table.id, x: 350, y: 380, rotation: 0 };
  const seatOriginCustomer = {
    id: 'c186', partyId: 'p1', partySize: 1, state: 'leaving',
    exitPhase: 'to_door', exitDoorId: 'door2', tableId: table.id, chairId: chair.id,
    x: 360, y: 390,
  };
  const c186 = { ...seatOriginCustomer, ...recordSeatResidency(seatOriginCustomer, chair, table) };
  const cashierStation = { ...fresh.cashierStations[0] };
  const c165 = {
    id: 'c165', partyId: 'p2', partySize: 1, state: 'checkout_moving',
    menuOutcome: 'ordered', dishId: null, drinkId: 'water',
    dishPriceAtOrder: null, drinkPriceAtOrder: 15, orderSubtotal: 15, tipAmount: 0,
    x: 840, y: 200, cashierStationId: cashierStation.id,
    checkoutPosition: { x: 840, y: 200 }, checkoutQueueIndex: 1,
    checkoutLineMember: true,
    checkoutLineGeometry: {
      stationId: cashierStation.id, x: cashierStation.x, y: cashierStation.y,
      w: cashierStation.w, h: cashierStation.h,
    },
    paymentReady: false, paymentQueuedAt: 1,
  };
  const c168 = {
    id: 'c168', partyId: 'p3', partySize: 1, state: 'leaving',
    exitPhase: 'to_door', exitDoorId: 'door2', x: 840, y: 180,
    checkoutDeparture: { stationId: cashierStation.id, position: { x: 840, y: 180 } },
    cashierStationId: null, checkoutPosition: null, checkoutQueueIndex: null,
    checkoutLineMember: false, checkoutLineGeometry: null, paymentReady: false,
  };
  const mario = {
    ...fresh.staff.find(worker => worker.role === 'waiter'),
    id: 'mario', name: 'Mario', gender: 'male', role: 'waiter', skill: 2,
    morale: 73, salary: 150, x: 360, y: 400,
    task: { type: 'deliver_service_item', serviceItemId: 'carried-dish', customerId: c165.id },
    carryingServiceItemId: 'carried-dish', navigationGoal: { x: 260, y: 380 },
    carryingServiceItemIds: undefined,
    activityPhase: 'task_assigned', idleUntil: null,
  };
  const cashier = {
    ...fresh.staff.find(worker => worker.id === cashierStation.assignedStaffId),
    x: 840, y: 100, task: null, activityPhase: 'stationed', idleUntil: null,
  };

  return {
    ...fresh,
    version: SAVE_VERSION,
    restaurant: {
      ...fresh.restaurant, funds: 87.06, gameTime: 168306, day: 2, totalServed: 119,
    },
    tables: [table],
    chairs: [chair],
    doors: [
      { id: 'door1', y: 340, role: 'entrance' },
      { id: 'door2', y: 180, role: 'exit' },
    ],
    cashierStations: [cashierStation],
    kitchenStations: [],
    serviceTables: [],
    customers: [c165, c168, c186],
    staff: [cashier, mario],
    serviceItems: [{
      id: 'carried-dish', kind: 'dish', state: 'carried', customerId: c165.id,
      x: mario.x, y: mario.y,
    }],
    queue: [],
    queueSlots: [],
    queueDepartures: [],
    queueAdmissionGate: null,
    doorAdmissions: {
      nextSequence: 3,
      requests: {
        c186: { doorId: 'door2', sequence: 1 },
        c168: { doorId: 'door2', sequence: 2 },
      },
    },
  };
}

describe('saveState', () => {
  it('does not overwrite a valid save when snapshot fixture geometry is invalid', () => {
    const state = createInitialState();
    saveState(state);
    const before = localStorage.getItem('restaurant-sim-save');
    state.cashierStations[0].w = -1;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      saveState(state);
      expect(localStorage.getItem('restaurant-sim-save')).toBe(before);
      expect(warning).toHaveBeenCalledWith('Failed to save state:', expect.any(Error));
    } finally {
      warning.mockRestore();
    }
  });
  it('omits the runtime coordinator without mutating it', () => {
    const movementCoordinator = createMovementCoordinator();
    movementCoordinator.requests.set('actor', { privateSearch: true });
    movementCoordinator.circular = movementCoordinator;
    const state = { ...createInitialState(), movementCoordinator };
    saveState(state);
    expect(loadState()).not.toBeNull();
    expect(loadState()).not.toHaveProperty('movementCoordinator');
    expect(movementCoordinator.requests.size).toBe(1);
    expect(movementCoordinator.circular).toBe(movementCoordinator);
  });
  it('saves state to localStorage under correct key', () => {
    const state = { restaurant: { funds: 999 } };
    saveState(state);
    const stored = localStorage.getItem('restaurant-sim-save');
    expect(JSON.parse(stored)).toEqual(state);
  });
  it('hydrates fresh empty runtime plans through the LOCAL save transport', () => {
    const fresh = createInitialState();
    const staff = [
      { ...fresh.staff[0], id: 'a', x: 100, y: 100, navigationGoal: { x: 400, y: 100 } },
      { ...fresh.staff[1], id: 'b', x: 100, y: 300, navigationGoal: { x: 400, y: 300 } },
    ];
    const entry = character => ({
      character, speed: 20, ignoredIds: [], doorFlow: { doorId: null, direction: 'none' },
      queueRank: null, terminalPolicy: 'hold', provenance: 'staff',
    });
    let state = { ...fresh, staff };
    let result = advanceCharacterMovementBatch(state, staff.map(entry), 0.5);
    state = { ...state, staff: [...result.moved.values()], movementCoordinator: result.coordinator };
    result = advanceCharacterMovementBatch(state, state.staff.map(entry), 0.5);
    state = { ...state, staff: [...result.moved.values()], movementCoordinator: result.coordinator };
    expect(result.coordinator.plans.size).toBeGreaterThan(0);
    saveState(state);
    const restored = hydrateState(loadState(), fresh);
    expect(restored.movementCoordinator.plans instanceof Map).toBe(true);
    expect(restored.movementCoordinator.plans.size).toBe(0);
  });
});

describe('loadState', () => {
  it('releases a saved cooking batch whose station no longer exists', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      version: SAVE_VERSION,
      kitchenStations: [],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'recipe' }],
      dishes: [{ id: 'recipe', prepTime: 60 }],
      staff: [{
        ...fresh.staff.find(worker => worker.role === 'cook'),
        id: 'cook', role: 'cook', skill: 5, morale: 80, x: 200, y: 200,
        task: {
          type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i1',
          serviceItemIds: ['i1'], stationId: 'missing-station',
        },
      }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'recipe', customerId: 'c1',
        state: 'preparing', batchId: 'batch-1', stationId: 'missing-station',
        assignedStaffId: 'cook', preparationStartedAt: 50,
      }],
      cookingBatches: [{
        id: 'batch-1', cookId: 'cook', stationId: 'missing-station',
        serviceItemIds: ['i1'], status: 'preparing', startedAt: 50,
      }],
    };

    const restored = hydrateState(saved, fresh);

    expect(restored.cookingBatches).toEqual([]);
    expect(restored.staff[0].task).toBeNull();
    expect(restored.serviceItems[0]).toMatchObject({
      state: 'ordered', stationId: null, assignedStaffId: null, preparationStartedAt: null,
    });
    expect(restored.serviceItems[0]).not.toHaveProperty('batchId');
  });

  it('hydrates an explicit empty batch ledger from its matching task member', () => {
    const fresh = createInitialState();
    const cook = {
      ...fresh.staff.find(worker => worker.id === 'starter-cook'),
      x: 80,
      y: 160,
      task: {
        type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i1',
        serviceItemIds: ['i1'], stationId: 'k1', startedAt: 50,
      },
    };
    const saved = {
      ...fresh,
      version: SAVE_VERSION,
      restaurant: { ...fresh.restaurant, gameTime: 80 },
      staff: [cook],
      customers: [{
        id: 'c1', state: 'waiting_for_items', tableId: 't1', dishId: 'starter-toast',
      }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1', tableId: 't1',
        state: 'preparing', stationId: null, assignedStaffId: null,
        preparationStartedAt: 50, readyAt: null,
      }],
      cookingBatches: [{
        id: 'batch-1', cookId: 'starter-cook', stationId: 'k1', serviceItemIds: [],
        status: 'preparing', startedAt: 50,
      }],
    };

    const restored = hydrateState(saved, fresh);

    expect(restored.cookingBatches).toHaveLength(1);
    expect(restored.cookingBatches[0].serviceItemIds).toEqual(['i1']);
    expect(restored.serviceItems[0]).toMatchObject({
      state: 'preparing', batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'starter-cook',
    });
    expect(restored.staff[0].task).toMatchObject({
      type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'i1',
    });
  });

  it('rejects invalid fixture geometry without discarding the saved JSON', () => {
    const saved = createInitialState();
    saved.cashierStations[0].w = -1;
    const serialized = JSON.stringify(saved);
    localStorage.setItem('restaurant-sim-save', serialized);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(loadState()).toBeNull();
      expect(localStorage.getItem('restaurant-sim-save')).toBe(serialized);
      expect(warning).toHaveBeenCalledWith('Failed to load state:', expect.any(Error));
    } finally {
      warning.mockRestore();
    }
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('rejects obsolete version %s local saves without deleting evidence or attempting migration', version => {
    localStorage.setItem('restaurant-sim-save', JSON.stringify({ version, restaurant: { funds: 999 } }));
    expect(loadState()).toBeNull();
    expect(JSON.parse(localStorage.getItem('restaurant-sim-save')).version).toBe(version);
  });

  it('does not delete a save from a future version', () => {
    const saved = { version: SAVE_VERSION + 1 };
    localStorage.setItem('restaurant-sim-save', JSON.stringify(saved));
    expect(loadState()).toBeNull();
    expect(localStorage.getItem('restaurant-sim-save')).not.toBeNull();
  });
  it('returns null when no save exists', () => {
    expect(loadState()).toBeNull();
  });

  it('returns parsed state when save exists', () => {
    const fresh = createInitialState();
    const { movementCoordinator: _movementCoordinator, ...withoutRuntime } = fresh;
    const state = { ...withoutRuntime, restaurant: { ...fresh.restaurant, funds: 500 } };
    localStorage.setItem('restaurant-sim-save', JSON.stringify(state));
    expect(loadState()).toEqual(state);
  });

  it('preserves the layout of a prior saved empty kitchen station', () => {
    const fresh = createInitialState();
    const priorSave = {
      ...fresh,
      kitchenStations: fresh.kitchenStations.map(station => station.id === 'k2'
        ? { ...station, x: 200, y: 120 }
        : station),
    };

    saveState(priorSave);
    const loaded = loadState();
    const restored = hydrateState(loaded, fresh);

    expect(restored.kitchenStations.find(station => station.id === 'k2'))
      .toMatchObject({ x: 200, y: 120 });
  });
});

describe('hydrateState', () => {
  it('round-trips a waiter pickup after reusing its freed slot but rejects a cook-carried duplicate', () => {
    const fresh = createInitialState();
    const waiter = {
      ...fresh.staff.find(worker => worker.id === 'starter-waiter'),
      x: 130,
      y: 130,
      task: {
        type: 'pickup_service_item', serviceItemId: 'picked', serviceTableId: 'st1',
      },
      activityPhase: 'task_assigned',
    };
    const cook = {
      ...fresh.staff.find(worker => worker.id === 'starter-cook'),
      x: 350,
      y: 130,
      task: null,
    };
    const base = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 100 },
      cashierStations: [],
      staff: [waiter, cook],
      customers: [
        { id: 'picked-customer', state: 'waiting_for_items', tableId: 't1', dishId: 'starter-toast' },
        { id: 'replacement-customer', state: 'waiting_for_items', tableId: 't2', dishId: 'starter-toast' },
      ],
      serviceItems: [{
        id: 'picked', kind: 'dish', menuItemId: 'starter-toast', customerId: 'picked-customer',
        tableId: 't1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 0,
        x: 155, y: 150,
      }],
    };

    const picked = runTick(base, { gameDt: 0, movementDt: 0 });
    expect(picked.serviceItems[0]).toMatchObject({ state: 'carried', serviceSlotIndex: 0 });
    expect(picked.staff.find(worker => worker.id === waiter.id)?.carryingServiceItemIds)
      .toEqual(['picked']);

    const reusedSlot = findAvailableServiceSlot(picked);
    expect(reusedSlot).toMatchObject({ serviceTableId: 'st1', serviceSlotIndex: 0 });
    const validRuntimeSave = {
      ...picked,
      serviceItems: [...picked.serviceItems, {
        id: 'replacement', kind: 'dish', menuItemId: 'starter-toast',
        customerId: 'replacement-customer', tableId: 't2', state: 'on_service',
        ...reusedSlot,
      }],
    };

    saveState(validRuntimeSave);
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(hydrateState(loaded, fresh).serviceItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'picked', state: 'carried', serviceSlotIndex: 0 }),
        expect.objectContaining({ id: 'replacement', state: 'on_service', serviceSlotIndex: 0 }),
      ]),
    );

    const cookCarriedDuplicate = {
      ...validRuntimeSave,
      customers: [...validRuntimeSave.customers,
        { id: 'cook-customer', state: 'waiting_for_items', tableId: 't3', dishId: 'starter-toast' }],
      staff: validRuntimeSave.staff.map(worker => worker.id === cook.id
        ? {
          ...worker,
          carryingServiceItemIds: ['cook-carried'],
          task: {
            type: 'place_dish_on_service', serviceItemId: 'cook-carried',
            serviceTableId: 'st1', serviceSlotIndex: 0,
          },
        }
        : worker),
      serviceItems: [...validRuntimeSave.serviceItems, {
        id: 'cook-carried', kind: 'dish', menuItemId: 'starter-toast',
        customerId: 'cook-customer', tableId: 't3', state: 'carried',
        serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: cook.id,
        x: cook.x, y: cook.y,
      }],
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      saveState(cookCarriedDuplicate);
      expect(loadState()).toBeNull();
    } finally {
      warning.mockRestore();
    }
  });

  it('rejects duplicate service-item IDs instead of silently merging owners', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff: [],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'starter-toast', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: 'starter-toast', tableId: 't2' },
      ],
      serviceItems: [
        { id: 'duplicate', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1', tableId: 't1', state: 'ordered' },
        { id: 'duplicate', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c2', tableId: 't2', state: 'ordered' },
      ],
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/service-item inventory/i);
  });

  it('rejects same-customer same-kind duplicates while preserving a legitimate dish and drink pair', () => {
    const fresh = createInitialState();
    const duplicate = {
      ...fresh,
      staff: [],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'starter-toast', tableId: 't1' }],
      serviceItems: [
        { id: 'first', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1', tableId: 't1', state: 'ordered' },
        { id: 'second', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1', tableId: 't1', state: 'ordered' },
      ],
    };
    expect(() => hydrateState(duplicate, fresh)).toThrow(/service-item inventory/i);

    const valid = {
      ...fresh,
      staff: [],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'starter-toast', drinkId: 'water', tableId: 't1' }],
      serviceItems: [
        { id: 'dish', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1', tableId: 't1', state: 'ordered' },
        { id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1', state: 'ordered' },
      ],
    };
    expect(hydrateState(valid, fresh).serviceItems.map(item => item.id)).toEqual(['dish', 'drink']);
  });

  it('accepts upper counter slots for on-counter items, reservations and waste origins', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      customers: [
        { id: 'counter-owner', state: 'waiting_for_items', tableId: 't1', dishId: 'starter-toast' },
        { id: 'drink-owner', state: 'waiting_for_items', tableId: 't2', drinkId: 'water' },
        { id: 'carried-owner', state: 'waiting_for_items', tableId: 't3', dishId: 'starter-toast' },
        {
          id: 'waste-owner', state: 'seated', tableId: 't4', dishId: null,
          foodOutcome: 'cancelled', foodOrderedAt: 100, foodPatienceBudget: 50,
          foodDeadlineAt: 150, foodCancelledAt: 150, foodCancelledPrice: 12,
          cancelledServiceItemIds: ['waste'], consumedServiceItemIds: [],
        },
      ],
      staff: fresh.staff.map(worker => {
        if (worker.id === 'starter-cook') {
          return {
            ...worker,
            id: 'drink-cook',
            x: 200,
            y: 200,
            task: {
              type: 'prepare_drink', serviceItemId: 'drink',
              serviceTableId: 'st1', serviceSlotIndex: 7,
            },
          };
        }
        if (worker.id === 'starter-waiter') {
          return {
            ...worker,
            id: 'dish-cook',
            role: 'cook',
            x: 220,
            y: 200,
            carryingServiceItemIds: ['carried'],
            task: {
              type: 'place_dish_on_service', serviceItemId: 'carried',
              serviceTableId: 'st1', serviceSlotIndex: 5,
            },
          };
        }
        return worker;
      }),
      serviceItems: [
        {
          id: 'counter', kind: 'dish', menuItemId: 'starter-toast', customerId: 'counter-owner',
          tableId: 't1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 4,
          x: 155, y: 150,
        },
        {
          id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'drink-owner',
          tableId: 't2', state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 7,
          assignedStaffId: 'drink-cook', preparationStartedAt: 10, x: 200, y: 200,
        },
        {
          id: 'carried', kind: 'dish', menuItemId: 'starter-toast', customerId: 'carried-owner',
          tableId: 't3', state: 'carried', serviceTableId: 'st1', serviceSlotIndex: 5,
          assignedStaffId: 'dish-cook', x: 220, y: 200,
        },
        {
          id: 'waste', kind: 'dish', menuItemId: 'starter-toast', customerId: 'waste-owner',
          tableId: 't4', state: 'to_clean', foodCancelled: true, deliveryProhibited: true,
          cancelledAt: 150, serviceTableId: 'st1', serviceSlotIndex: 6, x: 185, y: 150,
          wasteOrigin: {
            state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 7,
            stationId: null, tableId: 't4', x: 185, y: 150,
          },
        },
      ],
    };

    saveState(saved);
    const restored = hydrateState(loadState(), fresh);
    const byId = id => restored.serviceItems.find(item => item.id === id);

    expect(byId('counter')).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 4, state: 'on_service',
    });
    expect(byId('drink')).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 7, state: 'preparing', assignedStaffId: 'drink-cook',
    });
    expect(byId('carried')).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 5, state: 'carried',
    });
    expect(byId('waste')).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 6, state: 'to_clean', foodCancelled: true,
      wasteOrigin: expect.objectContaining({ serviceSlotIndex: 7 }),
    });
  });

  it('round-trips a new drink station reservation and carried upper-slot delivery', () => {
    const fresh = createInitialState();
    const dispenser = fresh.kitchenStations.find(station => station.equipmentId == null);
    const firstCook = fresh.staff.find(worker => worker.role === 'cook');
    const secondCook = { ...firstCook, id: 'delivery-cook', x: 220, y: 200 };
    const saved = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 100 },
      customers: [
        { id: 'preparing-customer', state: 'waiting_for_items', tableId: 't1', drinkId: 'water' },
        { id: 'carried-customer', state: 'waiting_for_items', tableId: 't2', drinkId: 'water' },
      ],
      staff: [
        {
          ...firstCook,
          task: {
            type: 'prepare_drink', serviceItemId: 'preparing-drink', stationId: dispenser.id,
            serviceTableId: 'st1', serviceSlotIndex: 6,
          },
        },
        {
          ...secondCook,
          carryingServiceItemIds: ['carried-drink'],
          task: {
            type: 'place_dish_on_service', serviceItemId: 'carried-drink',
            serviceTableId: 'st1', serviceSlotIndex: 7,
          },
        },
      ],
      serviceItems: [
        {
          id: 'preparing-drink', kind: 'drink', menuItemId: 'water', customerId: 'preparing-customer',
          tableId: 't1', state: 'preparing', stationId: dispenser.id,
          serviceTableId: 'st1', serviceSlotIndex: 6, assignedStaffId: firstCook.id,
          preparationStartedAt: 20, accumulatedWork: 12, lastProgressAt: 20,
        },
        {
          id: 'carried-drink', kind: 'drink', menuItemId: 'water', customerId: 'carried-customer',
          tableId: 't2', state: 'carried', serviceTableId: 'st1', serviceSlotIndex: 7,
          assignedStaffId: secondCook.id, x: 220, y: 200,
        },
      ],
    };

    saveState(saved);
    const restored = hydrateState(loadState(), fresh);

    expect(restored.staff.find(worker => worker.id === firstCook.id)?.task).toMatchObject({
      type: 'prepare_drink', stationId: dispenser.id, serviceSlotIndex: 6,
    });
    expect(restored.serviceItems.find(item => item.id === 'preparing-drink')).toMatchObject({
      state: 'preparing', stationId: dispenser.id, serviceSlotIndex: 6,
      accumulatedWork: 12, lastProgressAt: 20,
    });
    expect(restored.serviceItems.find(item => item.id === 'carried-drink')).toMatchObject({
      state: 'carried', serviceSlotIndex: 7, assignedStaffId: secondCook.id,
    });
  });

  it('rejects a counter slot beyond the shared capacity', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff: [],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1', dishId: 'starter-toast' }],
      serviceItems: [{
        id: 'out-of-range', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1',
        tableId: 't1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 8,
        x: 155, y: 170,
      }],
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/serviceSlotIndex|at most/i);
  });

  it('rejects duplicate ownership of an upper counter slot', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff: [],
      customers: [
        { id: 'c1', state: 'waiting_for_items', tableId: 't1', dishId: 'starter-toast' },
        { id: 'c2', state: 'waiting_for_items', tableId: 't2', dishId: 'starter-toast' },
      ],
      serviceItems: [
        {
          id: 'first', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1',
          tableId: 't1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 7,
          x: 155, y: 170,
        },
        {
          id: 'second', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c2',
          tableId: 't2', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 7,
          x: 155, y: 170,
        },
      ],
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/duplicates occupied service slot/i);
  });

  it('rejects a carried drink that duplicates an occupied upper counter slot', () => {
    const fresh = createInitialState();
    const cook = {
      ...fresh.staff.find(worker => worker.role === 'cook'),
      id: 'drink-cook', x: 220, y: 200,
      carryingServiceItemIds: ['carried-drink'],
      task: {
        type: 'place_dish_on_service', serviceItemId: 'carried-drink',
        serviceTableId: 'st1', serviceSlotIndex: 7,
      },
    };
    const saved = {
      ...fresh,
      staff: [cook],
      customers: [
        { id: 'on-counter-customer', state: 'waiting_for_items', tableId: 't1', dishId: 'starter-toast' },
        { id: 'carried-customer', state: 'waiting_for_items', tableId: 't2', drinkId: 'water' },
      ],
      serviceItems: [
        {
          id: 'on-counter', kind: 'dish', menuItemId: 'starter-toast', customerId: 'on-counter-customer',
          tableId: 't1', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 7,
          x: 155, y: 170,
        },
        {
          id: 'carried-drink', kind: 'drink', menuItemId: 'water', customerId: 'carried-customer',
          tableId: 't2', state: 'carried', serviceTableId: 'st1', serviceSlotIndex: 7,
          assignedStaffId: 'drink-cook', x: 220, y: 200,
        },
      ],
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/duplicates occupied service slot/i);
  });

  it('rejects conflicting drink preparation tasks that claim one dispenser', () => {
    const fresh = createInitialState();
    const drinkStation = fresh.kitchenStations.find(station => station.equipmentId == null);
    const starterCook = fresh.staff.find(worker => worker.role === 'cook');
    const cooks = [starterCook, { ...starterCook, id: 'second-cook' }];
    const saved = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 100 },
      customers: [
        { id: 'c1', state: 'waiting_for_items', tableId: 't1', drinkId: 'water' },
        { id: 'c2', state: 'waiting_for_items', tableId: 't2', drinkId: 'water' },
      ],
      staff: cooks.map((worker, index) => ({
        ...worker,
        task: {
          type: 'prepare_drink', serviceItemId: `drink-${index + 1}`, stationId: drinkStation.id,
          serviceTableId: 'st1', serviceSlotIndex: index,
        },
      })),
      serviceItems: cooks.map((worker, index) => ({
        id: `drink-${index + 1}`, kind: 'drink', menuItemId: 'water', customerId: `c${index + 1}`,
        tableId: `t${index + 1}`, state: 'preparing', stationId: drinkStation.id,
        serviceTableId: 'st1', serviceSlotIndex: index, assignedStaffId: worker.id,
        preparationStartedAt: 20, accumulatedWork: 12, lastProgressAt: 20,
      })),
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/already owned by staff member/i);
  });

  it('rejects a carried load that mixes clean and dirty service items', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff: [{ ...fresh.staff[0], id: 'carrier', role: 'waiter', carryingServiceItemIds: ['clean', 'dirty'] }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'starter-toast', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: 'starter-toast', tableId: 't2' },
      ],
      serviceItems: [
        { id: 'clean', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1', tableId: 't1', state: 'carried' },
        { id: 'dirty', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c2', tableId: 't2', state: 'carried_dirty' },
      ],
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/service-item inventory/i);
  });

  it('rejects malformed inventory through loadState without deleting the saved JSON', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff: [],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'starter-toast', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: 'starter-toast', tableId: 't2' },
      ],
      serviceItems: [
        { id: 'duplicate', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1', tableId: 't1', state: 'ordered' },
        { id: 'duplicate', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c2', tableId: 't2', state: 'ordered' },
      ],
    };
    const serialized = JSON.stringify(saved);
    localStorage.setItem('restaurant-sim-save', serialized);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(loadState()).toBeNull();
      expect(localStorage.getItem('restaurant-sim-save')).toBe(serialized);
    } finally {
      warning.mockRestore();
    }
  });

  it('round-trips directional door roles in a new-format save', () => {
    const fresh = createInitialState();
    const state = {
      ...fresh,
      doors: [
        { ...fresh.doors[0], role: 'exit' },
        { ...fresh.doors[1], role: 'entrance' },
      ],
    };

    saveState(state);
    const restored = hydrateState(loadState(), fresh);

    expect(restored.doors).toEqual(state.doors);
    expect(restored.doors.map(door => door.role)).toEqual(['exit', 'entrance']);
  });

  it('rejects invalid door roles without discarding the saved JSON', () => {
    const saved = { ...createInitialState(), doors: [{ id: 'door1', y: 340, role: 'sideways' }] };
    const serialized = JSON.stringify(saved);
    localStorage.setItem('restaurant-sim-save', serialized);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(loadState()).toBeNull();
      expect(localStorage.getItem('restaurant-sim-save')).toBe(serialized);
    } finally {
      warning.mockRestore();
    }
  });

  // A synchronous raster-loop regression must never lock the Vitest process itself.
  it.each([
    ['valid fractional coordinates', null, null, null],
    ['chair x beyond safe unit-step cells', 'chairs', 'x', 2 ** 60],
    ['chair negative y beyond safe unit-step cells', 'chairs', 'y', -(2 ** 60)],
    ['cashier excessive width', 'cashierStations', 'w', 2 ** 40],
    ['wash excessive height', 'washStations', 'h', 2 ** 40],
    ['door y beyond safe unit-step cells', 'doors', 'y', 2 ** 60],
    ['unbounded world expansion', 'restaurant', 'expansionLevel', 2 ** 60],
  ])('bounds imported raster geometry: %s', (_name, collection, field, value) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { registerHooks } from 'node:module';
      import assert from 'node:assert/strict';
      registerHooks({ resolve(specifier, context, nextResolve) {
        try { return nextResolve(specifier, context); }
        catch (error) {
          if (specifier.startsWith('.') && ['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code)) {
            return nextResolve(specifier + '.js', context);
          }
          throw error;
        }
      } });
      const { createInitialState } = await import('./src/state/initialState.js');
      const { hydrateState } = await import('./src/state/persistence.js');
      const fresh = createInitialState();
      const saved = JSON.parse(JSON.stringify(fresh));
      delete saved.movementCoordinator;
      saved.chairs[0].x = 210.125;
      saved.staff[0].x = 123.125;
      saved.staff[0].y = 456.875;
      const [collection, field, value] = ${JSON.stringify([collection, field, value])};
      if (collection) (collection === 'restaurant' ? saved.restaurant : saved[collection][0])[field] = value;
      const before = JSON.stringify(saved);
      process.stdout.write('READY\\n');
      try {
        const hydrated = hydrateState(saved, fresh);
        assert.equal(JSON.stringify(saved), before);
        assert.equal(hydrated.staff[0].x, 123.125);
        assert.equal(hydrated.staff[0].y, 456.875);
        assert.equal(hydrated.chairs[0].x, saved.chairs[0].x);
        process.stdout.write('ACCEPTED\\n');
      } catch (error) {
        assert.equal(JSON.stringify(saved), before);
        process.stdout.write('REJECTED ' + error.message + '\\n');
      }
    `], { encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL' });
    expect(child.stdout, child.stderr).toContain('READY\n');
    expect(child.error, child.stdout).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toBe('');
    expect(child.stdout).toContain(collection ? 'REJECTED Invalid saved navigation geometry' : 'ACCEPTED');
  });
  it('preserves door admissions and concurrent movement through reload', () => {
    const fresh = createInitialState();
    let state = { ...fresh, staff: [], customers: [{ id: 'z', x: 990, y: 360,
      state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1' }] };
    state = prepareCustomersForMovement(state, 0);
    state.customers.unshift({ id: 'a', x: 860, y: 440,
      state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1' });
    state = prepareCustomersForMovement(state, 0);
    const admissions = state.doorAdmissions;
    saveState(state);
    let restored = hydrateState(loadState(), fresh);
    expect(restored.doorAdmissions).toEqual(admissions);
    const moving = current => getCustomerMovementEntries(current).filter(entry => entry.speed === 55)
      .map(entry => entry.character.id).sort();
    expect(moving(restored)).toEqual(['a', 'z']);
    restored.customers.reverse();
    restored = prepareCustomersForMovement(restored, 0);
    expect(moving(restored)).toEqual(['a', 'z']);
    restored.customers = restored.customers.filter(actor => actor.id !== 'z');
    restored.customers.unshift({ id: '0-new', x: 860, y: 280,
      state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1' });
    restored = prepareCustomersForMovement(restored, 0);
    expect(moving(restored)).toEqual(['0-new', 'a']);
    expect(restored.doorAdmissions.requests['0-new'].sequence)
      .toBeGreaterThan(restored.doorAdmissions.requests.a.sequence);
  });

  it('validates door identities, positive unique safe sequences and counters independently of array order', () => {
    const fresh = createInitialState();
    const customers = ['b', 'a', 'z', 'negative', 'wrong', 'unsafe'].map((id, index) => ({
      id, x: 800, y: 200 + index * 40, state: 'leaving', exitDoorId: 'door1',
    }));
    const saved = { ...fresh, customers, doorAdmissions: { nextSequence: -10, requests: {
      z: { doorId: 'door1', sequence: 2 },
      a: { doorId: 'door1', sequence: 5 }, b: { doorId: 'door1', sequence: 5 },
      negative: { doorId: 'door1', sequence: -3 }, wrong: { doorId: 'missing', sequence: 1 },
      unsafe: { doorId: 'door1', sequence: Number.MAX_SAFE_INTEGER + 1 },
      removed: { doorId: 'door1', sequence: 1 },
    } } };
    const restored = hydrateState(saved, fresh);
    const reversed = hydrateState({ ...saved, customers: [...customers].reverse() }, fresh);
    expect(restored.doorAdmissions).toEqual(reversed.doorAdmissions);
    expect(restored.doorAdmissions.requests.z.sequence).toBe(2);
    expect(restored.doorAdmissions.requests).not.toHaveProperty('removed');
    const sequences = Object.values(restored.doorAdmissions.requests).map(record => record.sequence);
    expect(new Set(sequences).size).toBe(customers.length);
    expect(sequences.every(value => Number.isSafeInteger(value) && value > 0)).toBe(true);
    expect(restored.doorAdmissions.nextSequence).toBeGreaterThan(Math.max(...sequences));
    expect(Object.values(restored.doorAdmissions.requests).every(record => record.doorId === 'door1')).toBe(true);
    expect(hydrateState(restored, fresh).doorAdmissions).toEqual(restored.doorAdmissions);
  });

  it('compacts exhausted FIFO counters without changing incumbent order or retaining inactive admissions', () => {
    const fresh = createInitialState();
    const saved = { ...fresh, customers: [
      { id: 'z', state: 'leaving', exitDoorId: 'door1', x: 990, y: 360 },
      { id: 'a', state: 'leaving', exitDoorId: 'door1', x: 860, y: 440 },
      { id: 'fading', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1', x: 1000, y: 360 },
      { id: 'inactive', state: 'eating', exitDoorId: 'door1', x: 500, y: 400 },
    ], doorAdmissions: { nextSequence: Number.MAX_SAFE_INTEGER, requests: {
      z: { doorId: 'door1', sequence: Number.MAX_SAFE_INTEGER - 2 },
      a: { doorId: 'door1', sequence: Number.MAX_SAFE_INTEGER - 1 },
      fading: { doorId: 'door1', sequence: 1 }, inactive: { doorId: 'door1', sequence: 2 },
    } } };
    expect(hydrateState(saved, fresh).doorAdmissions).toEqual({ nextSequence: 3, requests: {
      z: { doorId: 'door1', sequence: 1 }, a: { doorId: 'door1', sequence: 2 },
    } });
  });
  it('hydrates an aggregate legacy meal into independent item timers idempotently', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 200 },
      customers: [{
        id: 'c1', state: 'eating', dishId: 'toast', drinkId: 'water',
        consumptionStartedAt: 100, consumptionDuration: 600,
      }],
      serviceItems: [
        { id: 'dish', customerId: 'c1', kind: 'dish', state: 'delivered' },
        { id: 'drink', customerId: 'c1', kind: 'drink', state: 'delivered' },
      ],
    };
    const hydrated = hydrateState(saved, fresh);
    expect(hydrated.customers[0]).toMatchObject({
      orderedServiceItemIds: ['dish', 'drink'], consumedServiceItemIds: [],
    });
    expect(hydrated.serviceItems.map(item => item.consumptionStartedAt)).toEqual([100, 100]);
    expect(hydrateState(hydrated, fresh)).toEqual(hydrated);
  });

  it('hydrates a legacy checkout item without advancing it or re-enqueuing checkout', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 200 },
      customers: [{
        id: 'c1', state: 'checkout_processing', paymentQueuedAt: 150,
      }],
      serviceItems: [{
        id: 'dish', customerId: 'c1', kind: 'dish', state: 'delivered',
        consumptionStartedAt: 100,
      }],
    };

    const hydrated = hydrateState(saved, fresh);
    expect(hydrated.customers[0]).toMatchObject({
      state: 'checkout_processing', paymentQueuedAt: 150,
      orderedServiceItemIds: ['dish'], consumedServiceItemIds: [],
    });
    expect(hydrated.serviceItems[0]).toMatchObject({
      state: 'delivered', consumptionStartedAt: 100,
    });

    const advanced = processKitchen(hydrated);
    expect(advanced.customers[0]).toMatchObject({
      state: 'checkout_processing', paymentQueuedAt: 150,
      consumedServiceItemIds: ['dish'],
    });
    expect(advanced.serviceItems[0].state).toBe('dirty_at_table');
  });

  it('canonicalises reversed legacy combined-order IDs before the next normal tick', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 100 },
      queue: [],
      staff: [],
      cashierStations: [],
      customers: [{
        id: 'c1', state: 'eating', dishId: 'toast', drinkId: 'water',
        consumptionStartedAt: 100, x: 400, y: 300,
      }],
      serviceItems: [
        {
          id: 'drink', customerId: 'c1', kind: 'drink', menuItemId: 'water',
          state: 'delivered',
        },
        {
          id: 'dish', customerId: 'c1', kind: 'dish', menuItemId: 'toast',
          state: 'delivered',
        },
      ],
    };

    const hydrated = hydrateState(saved, fresh);
    expect(hydrated.customers[0]).toMatchObject({
      state: 'eating',
      orderedServiceItemIds: ['dish', 'drink'],
      consumedServiceItemIds: [],
    });
    expect(hydrated.serviceItems.map(item => item.id)).toEqual(['drink', 'dish']);

    const ticked = runTick(hydrated, { gameDt: 0, movementDt: 0 });
    expect(ticked.customers[0]).toMatchObject({
      state: 'eating',
      dishId: 'toast',
      drinkId: 'water',
      orderedServiceItemIds: ['dish', 'drink'],
    });
    expect(ticked.serviceItems.map(item => item.id)).toEqual(['drink', 'dish']);
  });

  it('hydrates missing, malformed, and legacy operating hours safely', () => {
    const fresh = createInitialState();
    const fallbackFresh = {
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 10, closeHour: 22 },
    };
    const missing = hydrateState({ ...fresh, restaurant: { funds: 900 } }, fallbackFresh);
    const malformed = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 10.25, closeHour: '22' },
    }, fallbackFresh);
    const daytime = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 10, closeHour: 22 },
    }, fallbackFresh);
    const overnight = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 18, closeHour: 2 },
    }, fallbackFresh);
    const legacy = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 0, closeHour: 24 },
    }, fallbackFresh);

    expect(missing.restaurant).toMatchObject({ openHour: 0, closeHour: 0 });
    expect(malformed.restaurant).toMatchObject({ openHour: 0, closeHour: 0 });
    expect(daytime.restaurant).toMatchObject({ openHour: 10, closeHour: 22 });
    expect(overnight.restaurant).toMatchObject({ openHour: 18, closeHour: 2 });
    expect(legacy.restaurant).toMatchObject({ openHour: 0, closeHour: 0 });
  });

  it('fills fields added after an existing same-version save was created', () => {
    const fresh = {
      version: SAVE_VERSION,
      restaurant: { funds: 500, totalServed: 0 },
      staff: [{ id: 'starter-cook' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [],
      floorDirt: [],
      washStations: [],
    };
    const saved = {
      restaurant: { funds: 999 },
      staff: [{ id: 'custom-cook' }],
    };

    expect(hydrateState(saved, fresh)).toEqual({
      version: SAVE_VERSION,
      movementCoordinator: createMovementCoordinator(),
      restaurant: { funds: 999, totalServed: 0, openHour: 0, closeHour: 0 },
      staff: [{ id: 'custom-cook', gender: 'male', carryingServiceItemIds: [] }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [],
      customers: [],
      queue: [],
      queueSlots: [],
      queueDepartures: [],
      queueAdmissionGate: null,
      pendingPartyReviews: [],
      partyReviewHistory: [],
      drinkOverrides: {},
      floorDirt: [],
      washStations: [],
    });
  });

  function reservedPartySave() {
    const fresh = createInitialState();
    return {
      fresh,
      saved: {
        ...fresh,
        customers: [{
          id: 'customer-a', partyId: 'party-a', partySize: 1, state: 'entering',
          tableId: 't1', chairId: 'ch1', x: 180, y: 180,
        }],
        tables: fresh.tables.map(table => table.id === 't1'
          ? {
              ...table, status: 'reserved', diningPartyId: 'party-a',
              diningCustomerIds: ['customer-a'],
              seatingAssignments: [{
                customerId: 'customer-a', chairId: 'ch1',
                approachCell: { x: 9, y: 9 }, approachPoint: { x: 180, y: 180 },
              }],
            }
          : table),
      },
    };
  }

  it('retains a reserved self-seating party and its approach across hydration', () => {
    const { fresh, saved } = reservedPartySave();
    const hydrated = hydrateState(saved, fresh);
    const table = hydrated.tables.find(candidate => candidate.id === 't1');

    expect(table).toMatchObject({
      status: 'reserved', diningPartyId: 'party-a', diningCustomerIds: ['customer-a'],
    });
    expect(table.seatingAssignments).toHaveLength(1);
    expect(hydrated.customers[0]).toMatchObject({
      state: 'entering', tableId: 't1', chairId: 'ch1',
    });
  });

  it('rejects a current-version save with a seated actor whose chair origin occupies the top wall', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      tables: fresh.tables.map(table => table.id === 't1'
        ? {
            ...table, status: 'occupied', diningPartyId: 'wall-party',
            diningCustomerIds: ['wall-customer'],
          }
        : table),
      chairs: fresh.chairs.map(chair => chair.id === 'ch1'
        ? { ...chair, x: 100, y: 60 }
        : chair),
      customers: [{
        id: 'wall-customer', partyId: 'wall-party', state: 'seated',
        tableId: 't1', chairId: 'ch1', x: 110, y: 70,
      }],
    };

    expect(() => hydrateState(saved, fresh)).toThrow('Invalid saved navigation geometry');
  });

  it.each(['staff', 'customer'])('rejects a current-version save with a %s position inside the top wall', kind => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      ...(kind === 'staff'
        ? { staff: fresh.staff.map((worker, index) => index === 0
          ? { ...worker, x: 90, y: 75 } : worker) }
        : { customers: [{ id: 'wall-customer', state: 'moving', x: 100, y: 75 }] }),
    };

    expect(() => hydrateState(saved, fresh)).toThrow('Invalid saved navigation geometry');
  });

  it('releases a reserved table whose recorded party members are absent', () => {
    const { fresh, saved } = reservedPartySave();
    const orphaned = { ...saved, customers: [] };
    const table = hydrateState(orphaned, fresh).tables.find(candidate => candidate.id === 't1');

    expect(table).toEqual(expect.objectContaining({ id: 't1', status: 'empty' }));
    expect(table).not.toHaveProperty('diningPartyId');
    expect(table).not.toHaveProperty('seatingAssignments');
  });

  it('leaves an occupied table untouched across hydration', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      tables: fresh.tables.map(table => table.id === 't1'
        ? { ...table, status: 'occupied', diningPartyId: 'party-a' }
        : table),
    };

    const table = hydrateState(saved, fresh).tables.find(candidate => candidate.id === 't1');

    expect(table).toMatchObject({ id: 't1', status: 'occupied', diningPartyId: 'party-a' });
  });

  it('hydrates missing wash collections from fresh state and preserves populated saves', () => {
    const fresh = createInitialState();
    const missing = hydrateState({ ...fresh, version: undefined, floorDirt: undefined, washStations: undefined }, fresh);
    const saved = [{ id: 'd1' }];
    const stations = [{ id: 'wash9', type: 'automatic', x: 500, y: 300, w: 40, h: 40 }];
    const populated = hydrateState({ ...fresh, floorDirt: saved, washStations: stations }, fresh);

    expect(missing.floorDirt).toEqual([]);
    expect(missing.washStations).toEqual(fresh.washStations);
    expect(populated.floorDirt).toEqual(saved);
    expect(populated.washStations).toEqual(stations);
  });

  it('adds stable genders to same-version character records with missing fields', () => {
    const fresh = {
      version: SAVE_VERSION,
      restaurant: { funds: 500 },
      staff: [], customers: [], queue: [],
    };
    const saved = {
      restaurant: { funds: 900 },
      staff: [{ id: 's1', name: 'Sofia' }],
      customers: [{ id: 'c1' }],
      queue: [{ id: 'c2' }],
    };

    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.staff[0].gender).toBe('female');
    expect(['male', 'female']).toContain(hydrated.customers[0].gender);
    expect(['male', 'female']).toContain(hydrated.queue[0].members[0].gender);
    expect(hydrateState(saved, fresh)).toEqual(hydrated);
  });

  it('hydrates flat legacy queues into nested party records without losing order or gender', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      queue: [
        { id: 'a1', partyId: 'a', name: 'Sofia' },
        { id: 'b1', partyId: 'b' },
        { id: 'a2', partyId: 'a' },
      ],
    };
    const hydrated = hydrateState(saved, fresh);
    expect(hydrated.queue.map(party => party.partyId)).toEqual(['a', 'b']);
    expect(hydrated.queue[0].members.map(member => member.id)).toEqual(['a1', 'a2']);
    expect(hydrated.queue[0].members[0].gender).toBe('female');
    expect(hydrateState(hydrated, fresh)).toEqual(hydrated);
  });

  it('hydrates a consistent active self-seating gate and reservation twice without changing their identity', () => {
    const fresh = createInitialState();
    const gate = {
      partyId: 'party-a',
      customerIds: ['customer-a'],
      tableId: 't1',
      doorId: 'door1',
    };
    const saved = {
      ...fresh,
      queueAdmissionGate: gate,
      customers: [{
        id: 'customer-a', partyId: 'party-a', state: 'entering',
        tableId: 't1', chairId: 'ch1', x: 1000, y: 360,
      }],
      tables: fresh.tables.map(table => table.id === 't1'
        ? {
            ...table, status: 'reserved', diningPartyId: 'party-a',
            diningCustomerIds: ['customer-a'],
            seatingAssignments: [{
              customerId: 'customer-a', chairId: 'ch1',
              approachCell: { x: 9, y: 9 }, approachPoint: { x: 180, y: 180 },
            }],
          }
        : table),
    };

    const once = hydrateState(saved, fresh);
    const twice = hydrateState(once, fresh);
    const onceReservation = once.tables.find(table => table.id === gate.tableId);
    const twiceReservation = twice.tables.find(table => table.id === gate.tableId);

    expect(once.queueAdmissionGate).toEqual(gate);
    expect(twice.queueAdmissionGate).toEqual(gate);
    expect(twiceReservation).toEqual(onceReservation);
    expect(twiceReservation).toMatchObject({
      id: 't1', status: 'reserved', diningPartyId: 'party-a',
    });
  });

  it('repairs the saved seat-origin overlap without mutating the save or fixtures', () => {
    const fresh = createInitialState();
    const saved = savedRecoveryState(fresh);
    const before = JSON.stringify(saved);
    const hydrated = hydrateState(saved, fresh);
    const customer = hydrated.customers.find(candidate => candidate.id === 'c186');
    const mario = hydrated.staff.find(candidate => candidate.id === 'mario');
    const carriedDish = hydrated.serviceItems.find(item => item.id === 'carried-dish');

    expect(JSON.stringify(saved)).toBe(before);
    expect(customer).toMatchObject({ id: 'c186', x: 360, y: 390, state: 'leaving' });
    expect(mario).toMatchObject({ task: null, carryingServiceItemIds: ['carried-dish'], activityPhase: null });
    expect(mario).not.toHaveProperty('navigationGoal');
    expect(Math.hypot(mario.x - customer.x, mario.y - customer.y)).toBeGreaterThanOrEqual(16);
    expect(carriedDish).toMatchObject({ state: 'carried', x: mario.x, y: mario.y });
    expect(hydrated.tables).toEqual(saved.tables);
    expect(hydrated.chairs).toEqual(saved.chairs);

    const initialFunds = hydrated.restaurant.funds;
    const initialServed = hydrated.restaurant.totalServed;
    let state = { ...hydrated, paused: false };
    for (let tick = 0; tick < 400 && state.restaurant.totalServed === initialServed; tick += 1) {
      state = runTick(state, { gameDt: 8, movementDt: 4 / 30 });
    }
    const paid = state.customers.find(candidate => candidate.id === 'c165');
    expect(paid.state).toBe('leaving');
    expect(state.restaurant.totalServed).toBe(initialServed + 1);
    expect(state.restaurant.funds).toBeGreaterThan(initialFunds);
  });

  it('normalises equipment multipliers from saved levels', () => {
    const fresh = {
      version: SAVE_VERSION,
      restaurant: { funds: 500 },
      staff: [], customers: [], queue: [],
      equipment: [
        { id: 'eq1', level: 1, speedMultiplier: 1, qualityBonus: 0, owned: true },
        { id: 'eq2', level: 1, speedMultiplier: 1, qualityBonus: 0, owned: false },
      ],
    };
    const saved = {
      restaurant: { funds: 900 },
      equipment: [
        { id: 'eq1', level: 4, speedMultiplier: 0.85, qualityBonus: null, owned: true },
        { id: 'eq2', level: 'bad', owned: false },
      ],
    };

    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.version).toBe(SAVE_VERSION);
    expect(hydrated.equipment[0].level).toBe(4);
    expect(hydrated.equipment[0].speedMultiplier).toBeCloseTo(1.3);
    expect(hydrated.equipment[0].qualityBonus).toBeCloseTo(0.15);
    expect(hydrated.equipment[1]).toMatchObject({
      level: 1,
      speedMultiplier: 1,
      qualityBonus: 0,
    });
  });

  it('normalises malformed dish prices while preserving valid dish data', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      version: SAVE_VERSION,
      dishes: [
        { id: 'valid', name: 'Valid', price: 37, marker: 'preserved' },
        { id: 'rounded', name: 'Rounded', price: 37.6 },
        { id: 'low', name: 'Low', price: -20 },
        { id: 'high', name: 'High', price: 101 },
        { ...fresh.dishes[0], price: Number.POSITIVE_INFINITY },
        { id: 'nan', name: 'NaN', price: Number.NaN },
        { id: 'null', name: 'Null', price: null },
        { id: 'string', name: 'String', price: '12' },
      ],
    };

    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.version).toBe(SAVE_VERSION);
    expect(hydrated.dishes.map(dish => dish.price)).toEqual([37, 38, 1, 100, 12, 1, 1, 1]);
    expect(hydrated.dishes[0]).toMatchObject({ name: 'Valid', marker: 'preserved' });
  });

  it('ignores legacy staff capacity values during hydration', () => {
    const fresh = createInitialState();
    const legacy = hydrateState({ ...fresh, staffSlots: 3 }, fresh);
    const crowdedStaff = [...fresh.staff, ...Array.from({ length: 3 }, (_, index) => ({
      id: `extra-${index}`,
      name: `Extra ${index}`,
    }))];
    const crowded = hydrateState({ ...fresh, version: undefined, staff: crowdedStaff, staffSlots: 3 }, fresh);
    const expanded = hydrateState({ ...fresh, staffSlots: 9 }, fresh);

    expect(legacy).not.toHaveProperty('staffSlots');
    expect(crowded).not.toHaveProperty('staffSlots');
    expect(expanded).not.toHaveProperty('staffSlots');
    expect(crowded.staff).toHaveLength(8);
    expect(legacy.version).toBe(SAVE_VERSION);
  });

  it('ignores legacy staff slots and normalises retired milestone rewards without losing history', () => {
    const fresh = createInitialState();
    const savedMilestones = fresh.milestones.map(milestone => milestone.id === 'm6'
      ? {
          ...milestone,
          condition: { type: 'reputation', threshold: 4 },
          reward: { type: 'newStaffSlot' },
          achieved: true,
        }
      : milestone);

    const hydrated = hydrateState({ ...fresh, staffSlots: 99, milestones: savedMilestones }, fresh);

    expect(hydrated).not.toHaveProperty('staffSlots');
    expect(hydrated.milestones).toEqual(savedMilestones.map(milestone => milestone.id === 'm6'
      ? { ...milestone, reward: { type: 'none' } }
      : milestone));
  });

  it('normalises drink overrides and defaults missing state', () => {
    const hydrated = hydrateState({
      drinkOverrides: {
        water: { price: -10, quality: 22, popularity: 99 },
        tea: { price: 9.7, quality: 3 },
        missing: { price: 20 },
      },
    }, createInitialState());
    expect(hydrated.drinkOverrides).toEqual({
      water: { price: 1, quality: 10 },
      tea: { price: 10, quality: 3 },
    });
    expect(hydrateState({}, createInitialState()).drinkOverrides).toEqual({});
  });

  it('round-trips valid sparse drink overrides', () => {
    const fresh = createInitialState();
    saveState({ ...fresh, drinkOverrides: { tea: { price: 10, quality: 3 } } });
    expect(hydrateState(loadState(), fresh).drinkOverrides).toEqual({
      tea: { price: 10, quality: 3 },
    });
  });

  it('preserves valid profiles and snapshots while removing invalid economy fields', () => {
    const fresh = createInitialState();
    const valid = {
      id: 'valid', gender: 'female', spendingTier: 'value', spendingBudget: 30,
      menuOutcome: 'ordered', dishPriceAtOrder: 12, drinkPriceAtOrder: null,
      orderSubtotal: 12,
    };
    const invalid = {
      id: 'invalid', gender: 'male', spendingTier: 'budget', spendingBudget: 99,
      menuOutcome: 'forged', dishPriceAtOrder: -1,
      drinkPriceAtOrder: '2', orderSubtotal: Number.NaN,
    };
    const queuedValid = {
      id: 'queued-valid', partyId: 'queued-party', gender: 'female',
      spendingTier: 'premium', spendingBudget: 120,
    };
    const queuedInvalid = {
      id: 'queued-invalid', partyId: 'queued-party', gender: 'male',
      spendingTier: 'premium', spendingBudget: 121,
    };
    const hydrated = hydrateState({
      ...fresh,
      customers: [valid, invalid],
      queue: [{ partyId: 'queued-party', members: [queuedValid, queuedInvalid] }],
    }, fresh);

    expect(hydrated.customers[0]).toMatchObject(valid);
    expect(hydrated.customers[1]).toEqual({ id: 'invalid', gender: 'male' });
    expect(hydrated.queue[0].members[0]).toMatchObject(queuedValid);
    expect(hydrated.queue[0].members[1]).toEqual({
      id: 'queued-invalid', partyId: 'queued-party', gender: 'male',
    });
  });

  it('defaults missing party review state in the current save version', () => {
    const fresh = createInitialState();
    const hydrated = hydrateState({}, fresh);
    expect(hydrated.pendingPartyReviews).toEqual([]);
    expect(hydrated.partyReviewHistory).toEqual([]);
  });

  it('round-trips valid pending and completed party reviews', () => {
    const fresh = createInitialState();
    const pendingPartyReviews = [{
      partyId: 'p1', memberIds: ['a', 'b'], orderedMemberIds: ['a'],
      unaffordableMemberIds: ['b'], paidReviews: [],
    }];
    const partyReviewHistory = [{
      partyId: 'old', day: 2, score: -5, memberCount: 2,
      paidCount: 1, unaffordableCount: 1, reputationDelta: -0.002,
    }];
    saveState({ ...fresh, pendingPartyReviews, partyReviewHistory });
    const hydrated = hydrateState(loadState(), fresh);
    expect(hydrated.pendingPartyReviews).toEqual(pendingPartyReviews);
    expect(hydrated.partyReviewHistory).toEqual(partyReviewHistory);
  });

  it('reconciles completed visits and reviews across malformed version-five collections', () => {
    const fresh = createInitialState();
    const completedReview = {
      partyId: 'p1', day: 2, score: 80, memberCount: 1,
      paidCount: 1, unaffordableCount: 0, reputationDelta: 0.016,
    };
    const completedPayment = { customerId: 'c1', revenue: 12 };
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const hydrated = hydrateState({
      ...fresh,
      customers: [{
        id: 'c1', partyId: 'p1', state: 'checkout_processing',
        cashierStationId: 'cashier1', checkoutPosition: { x: 840, y: 180 },
        paymentReady: false, checkoutLineMember: true,
        navigationGoal: { x: 840, y: 180 },
      }],
      completedCustomers: [completedPayment, { ...completedPayment, revenue: 99 }],
      pendingPartyReviews: [{
        partyId: 'p1', memberIds: ['c1'], orderedMemberIds: ['c1'],
        unaffordableMemberIds: [], paidReviews: [{ customerId: 'c1', score: 80 }],
      }],
      partyReviewHistory: [completedReview],
    }, fresh);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(hydrated.completedCustomers).toEqual([completedPayment]);
    expect(hydrated.pendingPartyReviews).toEqual([]);
    expect(hydrated.partyReviewHistory).toEqual([completedReview]);
    expect(hydrated.customers[0]).toMatchObject({
      id: 'c1', state: 'leaving', cashierStationId: null,
      checkoutPosition: null, paymentReady: false, checkoutLineMember: false,
    });
    expect(hydrated.customers[0]).not.toHaveProperty('navigationGoal');
  });

  it('preserves or reconstructs checkout departure clearance through a new save round trip', () => {
    const fresh = createInitialState();
    const departure = {
      stationId: fresh.cashierStations[0].id,
      position: { x: 820, y: 180 },
    };
    const state = {
      ...fresh,
      customers: [{ id: 'departing', state: 'leaving', x: 820, y: 180,
        checkoutDeparture: departure }],
    };

    saveState(state);
    const restored = hydrateState(loadState(), fresh);
    expect(restored.customers[0].checkoutDeparture).toEqual({
      stationId: departure.stationId,
      position: { x: 820, y: 180 },
    });

    const holdState = {
      ...fresh,
      customers: [
        { id: 'departing', state: 'leaving', x: 820, y: 180,
          checkoutDeparture: departure },
        { id: 'next', state: 'checkout_moving', cashierStationId: fresh.cashierStations[0].id,
          paymentQueuedAt: 2, x: 820, y: 200 },
      ],
    };
    saveState(holdState);
    const resumed = prepareCustomersForMovement(hydrateState(loadState(), fresh), 0);
    expect(resumed.customers.find(customer => customer.id === 'next')).toMatchObject({
      checkoutPosition: { x: 820, y: 200 }, paymentReady: false,
    });

    const reconstructed = hydrateState({
      ...fresh,
      customers: [{ id: 'legacy-paid', state: 'checkout_processing', x: 820, y: 180,
        cashierStationId: fresh.cashierStations[0].id,
        checkoutPosition: { x: 820, y: 180 } }],
      completedCustomers: [{ customerId: 'legacy-paid' }],
    }, fresh);
    expect(reconstructed.customers[0].checkoutDeparture).toEqual({
      stationId: departure.stationId,
      position: { x: 820, y: 180 },
    });
  });

  it('preserves checkout line membership through a save round trip', () => {
    const fresh = createInitialState();
    const state = {
      ...fresh,
      customers: [{
        id: 'line-member', state: 'checkout_moving', cashierStationId: 'cashier1',
        checkoutQueueIndex: 0, checkoutPosition: { x: 820, y: 180 },
        checkoutLineMember: true, x: 820, y: 200,
      }],
    };

    saveState(state);
    const restored = hydrateState(loadState(), fresh);

    expect(restored.customers[0].checkoutLineMember).toBe(true);
  });

  it('canonicalises legacy cashier geometry and active checkout routes during hydration', () => {
    const fresh = createInitialState();
    const legacyStation = { ...fresh.cashierStations[0], w: 80, h: 40 };
    const cashier = {
      ...fresh.staff.find(worker => worker.id === legacyStation.assignedStaffId),
      x: 840,
      y: 100,
      task: {
        type: 'take_payment', customerId: 'legacy-customer', stationId: legacyStation.id,
      },
      activityPhase: 'task_assigned',
      navigationGoal: { x: 840, y: 100 },
    };
    const customer = {
      id: 'legacy-customer',
      partyId: 'legacy-party',
      partySize: 1,
      state: 'checkout_moving',
      cashierStationId: legacyStation.id,
      paymentQueuedAt: 10,
      checkoutQueueIndex: 0,
      checkoutPosition: { x: 840, y: 180 },
      checkoutLineMember: true,
      checkoutLineGeometry: {
        stationId: legacyStation.id, x: legacyStation.x, y: legacyStation.y,
        w: legacyStation.w, h: legacyStation.h,
      },
      paymentReady: true,
      x: 840,
      y: 180,
    };
    const departing = {
      id: 'legacy-departing',
      state: 'leaving',
      x: 840,
      y: 220,
      checkoutDeparture: {
        stationId: legacyStation.id,
        position: { x: 840, y: 180 },
      },
    };
    const saved = {
      ...fresh,
      version: undefined,
      cashierStations: [legacyStation],
      staff: [cashier],
      customers: [customer, departing],
    };

    const restored = hydrateState(saved, fresh);

    expect(saved.cashierStations[0]).toMatchObject({ w: 80, h: 40 });
    expect(restored.cashierStations[0]).toMatchObject({
      id: legacyStation.id, x: 800, y: 120, w: 40, h: 40,
    });
    expect(restored.customers[0]).toMatchObject({
      state: 'checkout_moving',
      checkoutPosition: { x: 820, y: 180 },
      navigationGoal: { x: 820, y: 180 },
      checkoutLineGeometry: { stationId: legacyStation.id, w: 40, h: 40 },
      paymentReady: false,
      checkoutLineMember: false,
    });
    expect(restored.customers[1].checkoutDeparture).toEqual({
      stationId: legacyStation.id,
      position: { x: 820, y: 180 },
    });
    expect(restored.staff[0]).toMatchObject({ navigationGoal: { x: 820, y: 100 } });
  });

  function legacyDepartureState(position) {
    const fresh = createInitialState();
    const legacyStation = { ...fresh.cashierStations[0], w: 80, h: 40 };
    return {
      ...fresh,
      version: SAVE_VERSION,
      cashierStations: [legacyStation],
      customers: [
        {
          id: 'legacy-departing', state: 'leaving', x: position.x, y: position.y,
          checkoutDeparture: { stationId: legacyStation.id, position },
        },
        {
          id: 'next-customer', state: 'checkout_moving',
          cashierStationId: legacyStation.id, paymentQueuedAt: 2,
          x: position.x, y: position.y,
        },
      ],
    };
  }

  it('clears an invalid finite departure claim instead of upgrading it during hydration', () => {
    const saved = legacyDepartureState({ x: 700, y: 700 });
    const restored = hydrateState(saved, createInitialState());
    const prepared = prepareCustomersForMovement(restored, 0);

    expect(restored.customers[0].checkoutDeparture).toEqual({
      stationId: 'cashier1', position: { x: 700, y: 700 },
    });
    expect(prepared.customers[0].checkoutDeparture).toBeNull();
    expect(prepared.customers[1]).toMatchObject({
      checkoutQueueIndex: 0,
      checkoutPosition: { x: 820, y: 180 },
    });
  });

  it('reanchors a valid legacy departure payment point after cashier normalisation', () => {
    const saved = legacyDepartureState({ x: 840, y: 180 });
    const restored = hydrateState(saved, createInitialState());
    const prepared = prepareCustomersForMovement(restored, 0);

    expect(restored.customers[0].checkoutDeparture).toEqual({
      stationId: 'cashier1', position: { x: 820, y: 180 },
    });
    expect(prepared.customers[0].checkoutDeparture).toEqual({
      stationId: 'cashier1', position: { x: 820, y: 180 },
    });
    expect(prepared.customers[1]).toMatchObject({
      checkoutQueueIndex: 1,
      checkoutPosition: { x: 820, y: 200 },
    });
  });
});

describe('queue slot lease persistence across both transports', () => {
  beforeEach(() => localStorage.clear());

  function persistParties(partyCount, queuePatienceByIndex = () => 100) {
    return Array.from({ length: partyCount }, (_, partyIndex) => ({
      partyId: `persist-party-${partyIndex + 1}`,
      members: Array.from({ length: 4 }, (_, memberIndex) => ({
        id: `persist-${partyIndex + 1}-${memberIndex + 1}`,
        partyId: `persist-party-${partyIndex + 1}`,
        partySize: 4,
        state: 'queued',
        patience: 100,
        happiness: 80,
        dishId: null,
        drinkId: null,
        tableId: null,
        chairId: null,
        queuePatience: queuePatienceByIndex(partyIndex),
        queuePatienceMax: 100,
      })),
    }));
  }

  function midAbandonmentState() {
    const fresh = createInitialState();
    // The third party abandons while its front member owns the last lease;
    // its hidden members become pending records. Parties 1-2 stay standing.
    const queue = persistParties(8, index => (index === 2 ? 0 : 100));
    let state = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 12 * 3600 },
      queue,
      queueSlots: [],
      queueDepartures: [],
      customers: [],
      staff: [],
      serviceItems: [],
    };
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.1 });
    expect(state.customers.filter(customer => customer.state === 'leaving')).toHaveLength(1);
    expect(state.queueDepartures).toHaveLength(3);
    expect(state.queueSlots).toHaveLength(9);
    return state;
  }

  it('round-trips standing leases, retained departure leases and pending records exactly through local saves', () => {
    const state = midAbandonmentState();
    saveState(state);
    const restored = hydrateState(loadState(), createInitialState());
    expect(restored.queueSlots).toEqual(state.queueSlots);
    expect(restored.queueDepartures.map(record => record.id)).toEqual(
      state.queueDepartures.map(record => record.id),
    );
    expect(restored.customers.map(customer => customer.id)).toEqual(
      state.customers.map(customer => customer.id),
    );
    // Hydration reconciliation is idempotent.
    expect(hydrateState(loadState(), createInitialState()).queueSlots).toEqual(restored.queueSlots);
  });

  it('round-trips the same exact queueSlots through the repository transport', async () => {
    const state = midAbandonmentState();
    let body;
    const fetchImpl = async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ filename: 'lease.json' }) };
    };
    await saveRepositoryState(state, fetchImpl);
    expect(body.queueSlots).toEqual(state.queueSlots);
    expect(body).not.toHaveProperty('movementCoordinator');
    const restored = hydrateState(body, createInitialState());
    expect(restored.queueSlots).toEqual(state.queueSlots);
    expect(restored.queueDepartures.map(record => record.id)).toEqual(
      state.queueDepartures.map(record => record.id),
    );
  });

  it('backfills a legacy v6 save without queueSlots deterministically on both transports', async () => {
    const state = midAbandonmentState();
    delete state.queueSlots;
    const allIds = new Set([
      ...state.queue.flatMap(party => party.members).map(member => member.id),
      ...state.queueDepartures.map(record => record.id),
      ...state.customers.map(customer => customer.id),
    ]);
    expect(allIds.size).toBe(32);

    // Local transport.
    saveState(state);
    const localRestored = hydrateState(loadState(), createInitialState());

    // Repository transport.
    let body;
    const fetchImpl = async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ filename: 'backfill.json' }) };
    };
    await saveRepositoryState(state, fetchImpl);
    const repositoryRestored = hydrateState(body, createInitialState());
    expect(repositoryRestored.queueSlots).toEqual(localRestored.queueSlots);

    // The 28 queued members are granted FIFO onto the legal current candidates
    // (the leaver still owns slot 8), and the 3 hidden pending records wait.
    expect(localRestored.queueSlots).toHaveLength(8);
    const memberIds = new Set(localRestored.queueSlots.map(record => record.memberId));
    expect(memberIds.size).toBe(8);
    for (const record of localRestored.queueSlots) {
      expect(record.x).toBe(973);
      expect(record.y % 30).toBe(390 % 30);
      expect([390, 420, 450, 480, 510, 540, 570, 600]).toContain(record.y);
    }
    expect(localRestored.queue.flatMap(party => party.members)).toHaveLength(28);
    expect(localRestored.queueDepartures).toHaveLength(3);
    expect(repositoryRestored.queueDepartures.map(record => record.id)).toEqual(
      localRestored.queueDepartures.map(record => record.id),
    );
    const restoredIds = new Set([
      ...localRestored.queue.flatMap(party => party.members).map(member => member.id),
      ...localRestored.queueDepartures.map(record => record.id),
      ...localRestored.customers.map(customer => customer.id),
    ]);
    expect(restoredIds.size).toBe(32);
    for (const id of allIds) expect(restoredIds.has(id)).toBe(true);
    // Deterministic: a second hydrate of each transport's snapshot is identical.
    expect(hydrateState(loadState(), createInitialState()).queueSlots)
      .toEqual(localRestored.queueSlots);
    expect(hydrateState(body, createInitialState()).queueSlots)
      .toEqual(localRestored.queueSlots);
    // No other legacy-version migration occurred.
    expect(localRestored.version).toBe(SAVE_VERSION);
  });

  it('rejects malformed and duplicate leases fail-closed on every load path without creating overlap', async () => {
    const fresh = createInitialState();
    const fixture = buildCustomerQueueStressState();
    const queue = fixture.queue.map((party, index) => ({
      partyId: `malformed-party-${index + 1}`,
      members: party.members.map((member, memberIndex) => ({
        ...member,
        id: `malformed-${index + 1}-${memberIndex + 1}`,
        partyId: `malformed-party-${index + 1}`,
      })),
    }));
    const malformedSlots = [
      { memberId: 'malformed-1-1', partyId: 'malformed-party-1', x: 973, y: 390, slot: 0 },
      { memberId: 'malformed-1-2', partyId: 'malformed-party-1', x: 973, y: 400, slot: 1 },
      { memberId: 'malformed-1-1', partyId: 'malformed-party-1', x: 973, y: 390, slot: 2 },
      { memberId: 'malformed-ghost', partyId: 'malformed-party-1', x: 973, y: 450 },
      { memberId: 'malformed-1-3', partyId: 'malformed-party-1', x: Number.NaN, y: 480 },
    ];
    const saved = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 12 * 3600 },
      queue,
      queueSlots: malformedSlots,
      queueDepartures: [],
      customers: [],
      staff: [],
    };

    saveState(saved);
    const localRestored = hydrateState(loadState(), createInitialState());
    expect(localRestored.queueSlots.length).toBe(9);
    expect(new Set(localRestored.queueSlots.map(record => record.memberId)).size).toBe(9);
    for (let left = 0; left < localRestored.queueSlots.length; left += 1) {
      for (let right = left + 1; right < localRestored.queueSlots.length; right += 1) {
        expect(Math.hypot(
          localRestored.queueSlots[left].x - localRestored.queueSlots[right].x,
          localRestored.queueSlots[left].y - localRestored.queueSlots[right].y,
        )).toBeGreaterThanOrEqual(16);
      }
    }

    let body;
    const fetchImpl = async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ filename: 'lease.json' }) };
    };
    await saveRepositoryState(saved, fetchImpl);
    const repositoryRestored = hydrateState(body, createInitialState());
    expect(repositoryRestored.queueSlots).toEqual(localRestored.queueSlots);
  });
});

describe('version ten lifecycle save validation', () => {
  function currentSave(overrides = {}) {
    const fresh = createInitialState();
    return { ...fresh, ...overrides, version: SAVE_VERSION };
  }

  it('increments the shared save version exactly once from the previous format', () => {
    expect(SAVE_VERSION).toBe(10);
    expect(createInitialState().version).toBe(10);
  });

  it('rejects an old autosave without deleting the evidence', () => {
    const old = JSON.stringify({ version: 9, restaurant: { funds: 999 } });
    localStorage.setItem('restaurant-sim-save', old);

    expect(loadState()).toBeNull();
    expect(localStorage.getItem('restaurant-sim-save')).toBe(old);
  });

  it.each([0, 11, 1.5, '2', null])(
    'rejects an automatic dishwasher with invalid level %s before hydration',
    level => {
      const saved = currentSave({
        washStations: [{ id: 'auto', type: 'automatic', level, x: 500, y: 120, w: 40, h: 40 }],
      });

      expect(() => hydrateState(saved, createInitialState())).toThrow(/saved state|dishwasher/i);
    },
  );

  it('rejects invalid cyclic schedules before a wellbeing default can repair them', () => {
    const saved = currentSave({
      staff: createInitialState().staff.map(worker => worker.id === 'starter-cook'
        ? { ...worker, schedule: Array.from({ length: 48 }, (_mode, index) => index === 0 ? 'pto' : 'work') }
        : worker),
    });

    expect(() => hydrateState(saved, createInitialState())).toThrow(/schedule/i);
  });

  it.each([
    ['effective duty', { effectiveDuty: 'holiday' }],
    ['duty phase', { dutyPhase: 'teleporting' }],
    ['activity phase', { activityPhase: 'sleeping' }],
    ['morale', { morale: Number.POSITIVE_INFINITY }],
    ['well-rested buff', { wellRestedUntil: Number.NaN }],
  ])('rejects malformed staff lifecycle field: %s', (_name, changes) => {
    const saved = currentSave({
      staff: createInitialState().staff.map(worker => worker.id === 'starter-cook'
        ? { ...worker, ...changes }
        : worker),
    });

    expect(() => hydrateState(saved, createInitialState())).toThrow(/staff|duty|activity|morale|buff/i);
  });

  it('round-trips a reserved couch and an occupied bed without converting either to walking state', () => {
    const fresh = createInitialState();
    const reserved = {
      id: 'amenity-couch', type: 'couch', x: 600, y: 300, rotation: 0,
      slots: [
        { index: 0, reservedBy: 'resting', occupiedBy: null },
        { index: 1, reservedBy: null, occupiedBy: null },
      ],
    };
    const occupied = {
      id: 'amenity-bed', type: 'bed', x: 700, y: 300, rotation: 1,
      slots: [{ index: 0, reservedBy: null, occupiedBy: 'sleeping' }],
    };
    const sleeping = {
      ...fresh.staff[0], id: 'sleeping', role: 'janitor', x: 720, y: 310,
      effectiveDuty: 'pto', dutyPhase: 'active',
      amenityUse: {
        amenityId: 'amenity-bed', slotIndex: 0, phase: 'occupied',
        activityStartedAt: 100, activityEndsAt: 25_300, lastRecoveryAt: 100,
      },
      ptoSession: {
        sleepStartedAt: 100, minimumEndAt: 25_300, startingMorale: 40,
      },
      movementResidency: { kind: 'staff_amenity', amenityId: 'amenity-bed', slotIndex: 0 },
      wellRestedUntil: 0,
    };
    const resting = {
      ...fresh.staff[1], id: 'resting', role: 'waiter', x: 500, y: 300,
      effectiveDuty: 'rest', dutyPhase: 'travelling',
      navigationGoal: { x: 610, y: 330 },
      amenityUse: {
        amenityId: 'amenity-couch', slotIndex: 0, phase: 'reserved',
        activityStartedAt: null, activityEndsAt: null, lastRecoveryAt: null,
      },
      ptoSession: null,
      movementResidency: undefined,
    };
    const state = {
      ...fresh,
      staff: [resting, sleeping],
      staffAmenities: [reserved, occupied],
    };
    delete state.staff[0].movementResidency;

    saveState(state);
    const restored = hydrateState(loadState(), fresh);

    expect(restored.staff.find(worker => worker.id === 'resting')).toMatchObject({
      effectiveDuty: 'rest', dutyPhase: 'travelling',
      amenityUse: { amenityId: 'amenity-couch', slotIndex: 0, phase: 'reserved' },
    });
    expect(restored.staff.find(worker => worker.id === 'resting')).not.toHaveProperty('movementResidency');
    expect(restored.staff.find(worker => worker.id === 'sleeping')).toMatchObject({
      effectiveDuty: 'pto',
      amenityUse: { amenityId: 'amenity-bed', slotIndex: 0, phase: 'occupied', activityStartedAt: 100 },
      ptoSession: { sleepStartedAt: 100, minimumEndAt: 25_300, startingMorale: 40 },
      movementResidency: { kind: 'staff_amenity', amenityId: 'amenity-bed', slotIndex: 0 },
    });
    expect(restored.staffAmenities).toEqual([reserved, occupied]);
  });

  it('round-trips an occupied arcade standing worker and a buff-expiry timestamp', () => {
    const fresh = createInitialState();
    const amenity = {
      id: 'arcade-1', type: 'arcade', x: 600, y: 300, rotation: 0,
      slots: [{ index: 0, reservedBy: null, occupiedBy: 'arcade-user' }],
    };
    const worker = {
      ...fresh.staff[1], id: 'arcade-user', x: 610, y: 330,
      effectiveDuty: 'rest', dutyPhase: 'active',
      amenityUse: {
        amenityId: 'arcade-1', slotIndex: 0, phase: 'occupied',
        activityStartedAt: 100, activityEndsAt: 700, lastRecoveryAt: 100,
      },
      ptoSession: null,
      wellRestedUntil: 86_500,
      wellbeingWakeAt: 500,
    };

    saveState({ ...fresh, staff: [worker], staffAmenities: [amenity] });
    const restored = hydrateState(loadState(), fresh);

    expect(restored.staff[0]).toMatchObject({
      amenityUse: { phase: 'occupied', activityEndsAt: 700 },
      wellRestedUntil: 86_500,
      wellbeingWakeAt: 500,
    });
    expect(restored.staff[0]).not.toHaveProperty('movementResidency');
  });

  it('round-trips active automatic washing progress at an upgraded level', () => {
    const fresh = createInitialState();
    const state = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 240 },
      staff: [],
      washStations: [{ id: 'auto', type: 'automatic', level: 2, x: 500, y: 120, w: 40, h: 40 }],
      serviceItems: [{
        id: 'dirty', kind: 'dish', state: 'washing', washStationId: 'auto',
        washQueuedAt: 0, washStartedAt: 100, accumulatedWork: 120,
        lastProgressAt: 200, x: 520, y: 140,
      }],
    };

    saveState(state);
    const restored = hydrateState(loadState(), fresh);

    expect(restored.washStations[0]).toMatchObject({ type: 'automatic', level: 2 });
    expect(restored.serviceItems[0]).toMatchObject({
      state: 'washing', washStationId: 'auto', washStartedAt: 100,
      accumulatedWork: 120, lastProgressAt: 200,
    });
  });

  it('round-trips a resolved cleaning decision and durable target progress', () => {
    const fresh = createInitialState();
    const state = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 250 },
      staff: fresh.staff.map(worker => worker.id === 'starter-janitor'
        ? {
          ...worker, x: 180, y: 220,
          task: { type: 'clean_table', tableId: 't1', cleaningStartedAt: 100,
            accumulatedWork: 75, lastProgressAt: 200 },
        }
        : worker),
      tables: fresh.tables.map(table => table.id === 't1'
        ? {
          ...table, status: 'dirty', cleaningAction: {
            id: 't1', eligibleAt: 50, staffId: 'starter-janitor',
            startedAt: 100, cleaningStartedAt: 100,
            accumulatedWork: 75, lastProgressAt: 200,
            instantResolved: true, instantComplete: false,
          },
        }
        : table),
    };

    saveState(state);
    const restored = hydrateState(loadState(), fresh);

    expect(restored.tables.find(table => table.id === 't1')).toMatchObject({
      cleaningAction: {
        id: 't1', staffId: 'starter-janitor', instantResolved: true,
        instantComplete: false, accumulatedWork: 75, lastProgressAt: 200,
      },
    });
    expect(restored.staff.find(worker => worker.id === 'starter-janitor').task)
      .toMatchObject({ type: 'clean_table', tableId: 't1', accumulatedWork: 75 });
  });

  it('preserves occupied cancelled waste and terminal IDs after the removed item is gone', () => {
    const fresh = createInitialState();
    const counterCustomer = {
      id: 'cancel-counter', partyId: 'cancel-party', state: 'seated',
      tableId: 't1', dishId: null, drinkId: null,
      foodOrderedAt: 100, foodPatienceBudget: 50, foodDeadlineAt: 150,
      foodOutcome: 'cancelled', foodCancelledAt: 150,
      foodCancellationReason: 'food-patience-expired', foodCancelledPrice: 12,
      dishPriceAtOrder: null, drinkPriceAtOrder: null, orderSubtotal: 0,
      orderedServiceItemIds: ['removed-dish', 'counter-waste'],
      consumedServiceItemIds: [], cancelledServiceItemIds: ['removed-dish', 'counter-waste'],
    };
    const carriedCustomer = {
      ...counterCustomer, id: 'cancel-carried', tableId: 't2',
      orderedServiceItemIds: ['carried-waste'], cancelledServiceItemIds: ['carried-waste'],
    };
    const state = {
      ...fresh,
      staff: fresh.staff.map(worker => worker.id === 'starter-waiter'
        ? {
          ...worker, id: 'waste-carrier', x: 500, y: 300,
          carryingServiceItemIds: ['carried-waste'],
          task: { type: 'deliver_dirty_item', serviceItemId: 'carried-waste', washStationId: 'wash1' },
        }
        : worker).filter(worker => worker.id !== 'starter-janitor'),
      customers: [counterCustomer, carriedCustomer],
      serviceItems: [
        {
          id: 'counter-waste', kind: 'dish', menuItemId: 'toast', customerId: counterCustomer.id,
          tableId: 't1', state: 'to_clean', foodCancelled: true, deliveryProhibited: true,
          cancelledAt: 150, serviceTableId: 'st1', serviceSlotIndex: 0, x: 150, y: 130,
          wasteOrigin: {
            state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 0,
            stationId: null, tableId: 't1', x: 150, y: 130,
          },
        },
        {
          id: 'carried-waste', kind: 'dish', menuItemId: 'toast', customerId: carriedCustomer.id,
          tableId: 't2', state: 'carried_dirty', foodCancelled: true, deliveryProhibited: true,
          cancelledAt: 150, x: 500, y: 300,
        },
      ],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    saveState(state);
    const restored = hydrateState(loadState(), fresh);

    expect(restored.customers[0].cancelledServiceItemIds).toEqual(['removed-dish', 'counter-waste']);
    expect(restored.serviceItems.find(item => item.id === 'counter-waste')).toMatchObject({
      state: 'to_clean', serviceTableId: 'st1', serviceSlotIndex: 0,
    });
    expect(restored.staff.find(worker => worker.id === 'waste-carrier').carryingServiceItemIds)
      .toEqual(['carried-waste']);
    expect(restored.serviceItems.find(item => item.id === 'carried-waste')).toMatchObject({
      state: 'carried_dirty', foodCancelled: true,
    });
  });

  it('round-trips a waiter to_clean collection task without a table identity', () => {
    const fresh = createInitialState();
    const state = {
      ...fresh,
      serviceItems: [{ id: 'abandoned-dish', kind: 'dish', state: 'to_clean', x: 220, y: 220 }],
      staff: fresh.staff.map(worker => worker.id === 'starter-waiter'
        ? {
          ...worker,
          task: { type: 'collect_dirty_item', serviceItemId: 'abandoned-dish' },
        }
        : worker),
    };

    saveState(state);
    const restored = hydrateState(loadState(), fresh);

    expect(restored.staff.find(worker => worker.id === 'starter-waiter').task).toEqual({
      type: 'collect_dirty_item', serviceItemId: 'abandoned-dish',
    });
    expect(restored.serviceItems[0]).toMatchObject({
      id: 'abandoned-dish', state: 'to_clean', x: 220, y: 220,
    });
  });

  it('rejects a contradictory incoming wash reservation instead of clearing it', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      washStations: [
        { id: 'manual', type: 'manual', x: 300, y: 120, w: 40, h: 40 },
        { id: 'auto', type: 'automatic', level: 1, x: 500, y: 120, w: 40, h: 40 },
      ],
      serviceItems: [{
        id: 'dirty', kind: 'dish', state: 'queued_for_wash', washStationId: 'manual',
        reservedWashStationId: 'auto', washQueuedAt: 10,
      }],
      staff: fresh.staff.map(worker => worker.id === 'starter-janitor'
        ? { ...worker, task: null }
        : worker),
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/reservation|inventory|wash/i);
  });

  it('rejects duplicate amenity occupants and one-sided worker reservations', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff: [fresh.staff[0]],
      staffAmenities: [{
        id: 'couch', type: 'couch', x: 600, y: 300, rotation: 0,
        slots: [
          { index: 0, reservedBy: 'starter-cook', occupiedBy: null },
          { index: 1, reservedBy: 'starter-cook', occupiedBy: null },
        ],
      }],
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/amenity|reservation|occup/i);
  });
});
