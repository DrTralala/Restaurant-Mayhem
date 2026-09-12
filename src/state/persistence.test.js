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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
      { id: 'a', x: 100, y: 100, navigationGoal: { x: 400, y: 100 } },
      { id: 'b', x: 100, y: 300, navigationGoal: { x: 400, y: 300 } },
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
  it.each([1, 2, 3, 4, 5, 6, 7])('rejects obsolete version %s local saves without deleting evidence or attempting migration', version => {
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
    const state = { version: SAVE_VERSION, restaurant: { funds: 500 } };
    localStorage.setItem('restaurant-sim-save', JSON.stringify(state));
    expect(loadState()).toEqual(state);
  });
});

describe('hydrateState', () => {
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
  it('preserves the near-door incumbent and deterministic FIFO hand-off through reload', () => {
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
    const admitted = current => getCustomerMovementEntries(current).filter(entry => entry.speed === 55)
      .map(entry => entry.character.id);
    expect(admitted(restored)).toEqual(['z']);
    restored.customers.reverse();
    restored = prepareCustomersForMovement(restored, 0);
    expect(admitted(restored)).toEqual(['z']);
    restored.customers = restored.customers.filter(actor => actor.id !== 'z');
    restored.customers.unshift({ id: '0-new', x: 860, y: 280,
      state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1' });
    restored = prepareCustomersForMovement(restored, 0);
    expect(admitted(restored)).toEqual(['a']);
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
    const missing = hydrateState({ ...fresh, restaurant: { funds: 900 } }, fresh);
    const malformed = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 10.25, closeHour: '22' },
    }, fresh);
    const legacy = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 0, closeHour: 24 },
    }, fresh);

    expect(missing.restaurant).toMatchObject({ openHour: 10, closeHour: 22 });
    expect(malformed.restaurant).toMatchObject({ openHour: 10, closeHour: 22 });
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
      version: SAVE_VERSION,
      restaurant: { funds: 999 },
      staff: [{ id: 'custom-cook' }],
    };

    expect(hydrateState(saved, fresh)).toEqual({
      version: SAVE_VERSION,
      movementCoordinator: createMovementCoordinator(),
      restaurant: { funds: 999, totalServed: 0, openHour: 10, closeHour: 22 },
      staff: [{ id: 'custom-cook', gender: 'male' }],
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
    const missing = hydrateState({ ...fresh, floorDirt: undefined, washStations: undefined }, fresh);
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
      version: SAVE_VERSION,
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
      version: SAVE_VERSION,
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

  it('hydrates staff capacity to the fresh default, current headcount, or larger saved capacity', () => {
    const fresh = createInitialState();
    const legacy = hydrateState({ ...fresh, staffSlots: 3 }, fresh);
    const crowdedStaff = [...fresh.staff, ...Array.from({ length: 3 }, (_, index) => ({
      id: `extra-${index}`,
      name: `Extra ${index}`,
    }))];
    const crowded = hydrateState({ ...fresh, staff: crowdedStaff, staffSlots: 3 }, fresh);
    const expanded = hydrateState({ ...fresh, staffSlots: 9 }, fresh);

    expect(legacy.staffSlots).toBe(7);
    expect(crowded.staffSlots).toBe(8);
    expect(expanded.staffSlots).toBe(9);
    expect(legacy.version).toBe(SAVE_VERSION);
  });

  it('normalises drink overrides and defaults missing state', () => {
    const hydrated = hydrateState({
      version: SAVE_VERSION,
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
    expect(hydrateState({ version: SAVE_VERSION }, createInitialState()).drinkOverrides).toEqual({});
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
    const hydrated = hydrateState({ version: SAVE_VERSION }, fresh);
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
        paymentReady: false, navigationGoal: { x: 840, y: 180 },
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
      checkoutPosition: null, paymentReady: false,
    });
    expect(hydrated.customers[0]).not.toHaveProperty('navigationGoal');
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
