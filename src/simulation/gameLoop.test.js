import { afterEach, describe, it, expect, vi } from 'vitest';
import { mergeMovementEntries, runTick } from './gameLoop';
import { advanceCharacterMovementBatch } from './movement';
import * as customerDomain from './customers';
import * as staffDomain from './staff';
import * as movementDomain from './movement';
import { createInitialState } from '../state/initialState';
import { hydrateState, loadState, saveState } from '../state/persistence';
import { buildCustomerQueueStressState } from './customerQueueStress';
import { getQueueVisibleMembers, reconcileQueueSlots } from './customerQueue';

const emptyState = {
  restaurant: { funds: 500, gameTime: 100, day: 1, openHour: 10, closeHour: 22, totalServed: 0, reputation: 2.0 },
  paused: false,
  speed: 1,
  tables: [],
  kitchenStations: [],
  queue: [],
  customers: [],
  chairs: [],
  serviceItems: [],
  serviceTables: [],
  staff: [],
  dishes: [],
  equipment: [],
  upgrades: [],
  milestones: [],
  recipeSlots: 0,
  staffSlots: 0,
  completedCustomers: [],
  dailyHistory: [],
  notifications: [],
};

function deterministicMovementProjection(state, statuses) {
  const actors = [...state.staff, ...state.customers]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map(({ id, x, y, navigationGoal, state: lifecycleState, task }) => ({
      id, x, y, navigationGoal, state: lifecycleState, task,
    }));
  return {
    actors,
    statuses: [...statuses.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
    coordinator: {
      tick: state.movementCoordinator.tick,
      claims: [...state.movementCoordinator.claims.entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
      plans: [...state.movementCoordinator.plans.entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    },
  };
}

function runDeterministicMovementSequence(reverseEntries) {
  let state = {
    ...emptyState,
    restaurant: { ...emptyState.restaurant, expansionLevel: 1 },
    staff: [{
      id: 'staff', role: 'waiter', x: 100, y: 100,
      navigationGoal: { x: 220, y: 100 }, task: null,
    }],
    customers: [{
      id: 'customer', state: 'guided', x: 100, y: 180,
      navigationGoal: { x: 220, y: 180 }, task: null,
    }],
  };
  const projections = [];

  for (let tick = 0; tick < 5; tick += 1) {
    const entries = [
      {
        character: state.staff[0], speed: 40, ignoredIds: [],
        doorFlow: { doorId: null, direction: 'none' },
        queueRank: null, terminalPolicy: 'hold', provenance: 'staff',
      },
      {
        character: state.customers[0], speed: 40, ignoredIds: [],
        doorFlow: { doorId: null, direction: 'none' },
        queueRank: null, terminalPolicy: 'hold', provenance: 'customer',
      },
    ];
    const orderedEntries = reverseEntries ? [...entries].reverse() : entries;
    const batch = advanceCharacterMovementBatch(state, orderedEntries, 0.5);
    state = {
      ...state,
      staff: [batch.moved.get('staff')],
      customers: [batch.moved.get('customer')],
      movementCoordinator: batch.coordinator,
    };
    projections.push(deterministicMovementProjection(state, batch.statuses));
  }

  return projections;
}

describe('runTick', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns same state when paused', () => {
    const state = { ...emptyState, paused: true };
    const result = runTick(state, 1);
    expect(result).toBe(state);
  });

  it('advances only by the supplied game-time duration', () => {
    const result = runTick(emptyState, { gameDt: 2, movementDt: 1 / 30 });
    expect(result.restaurant.gameTime).toBe(102);
  });

  it('does not apply the speed multiplier a second time', () => {
    const state = { ...emptyState, speed: 2 };
    const result = runTick(state, { gameDt: 4, movementDt: 2 / 30 });
    expect(result.restaurant.gameTime).toBe(104);
  });

  it('persists one movement coordinator across ordered tick stages', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 12 * 3600 },
      doors: [{ id: 'door1', y: 340 }],
      staff: [{
        id: 'staff', role: 'waiter', x: 300, y: 300,
        navigationGoal: { x: 360, y: 300 }, task: null,
      }],
      customers: [{
        id: 'customer', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
        x: 993, y: 360, navigationGoal: { x: 1113, y: 360 },
      }],
    };

    const first = runTick(state, { gameDt: 0, movementDt: 1 });
    const second = runTick(first, { gameDt: 0, movementDt: 1 });

    expect(first.movementCoordinator.tick).toBe(1);
    expect(second.movementCoordinator.tick).toBe(2);
    expect(second.movementCoordinator.version).toBe(1);
    expect(second.staff.map(actor => actor.id)).toEqual(state.staff.map(actor => actor.id));
    expect(second.customers.map(actor => actor.id)).toEqual(state.customers.map(actor => actor.id));
  });

  it('keeps repeated movement projections deterministic when descriptors are reversed', () => {
    expect(runDeterministicMovementSequence(false))
      .toEqual(runDeterministicMovementSequence(true));
  });

  it('keeps runTick lifecycle output deterministic when production descriptors are reversed', () => {
    const createState = () => ({
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 12 * 3600, expansionLevel: 1 },
      doors: [{ id: 'door1', y: 340 }],
      staff: [{
        id: 'staff', role: 'waiter', x: 300, y: 300,
        navigationGoal: { x: 360, y: 300 }, task: null,
      }],
      customers: [{
        id: 'customer', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
        x: 993, y: 360, navigationGoal: { x: 1113, y: 360 },
      }],
    });
    const project = state => ({
      customers: state.customers.map(({ id, x, y, state: lifecycleState, exitPhase, navigationGoal }) => ({
        id, x, y, state: lifecycleState, exitPhase, navigationGoal,
      })),
      staff: state.staff.map(({ id, x, y, task, navigationGoal }) => ({
        id, x, y, task, navigationGoal,
      })),
      statuses: [...state.movementCoordinator.statuses.entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
      coordinator: {
        tick: state.movementCoordinator.tick,
        claims: [...state.movementCoordinator.claims].sort(([a], [b]) => a.localeCompare(b)),
        commitments: [...state.movementCoordinator.records].map(([id, record]) => [id, record.commitment])
          .sort(([a], [b]) => a.localeCompare(b)),
      },
    });
    const run = reverse => {
      const customerGetter = customerDomain.getCustomerMovementEntries;
      const staffGetter = staffDomain.getStaffMovementEntries;
      vi.spyOn(customerDomain, 'getCustomerMovementEntries')
        .mockImplementation((...args) => {
          const entries = customerGetter(...args);
          return reverse ? [...entries].reverse() : entries;
        });
      vi.spyOn(staffDomain, 'getStaffMovementEntries')
        .mockImplementation((...args) => {
          const entries = staffGetter(...args);
          return reverse ? [...entries].reverse() : entries;
        });
      let state = createState();
      const snapshots = [];
      for (let tick = 0; tick < 5; tick += 1) {
        state = runTick(state, { gameDt: 0, movementDt: 1 });
        snapshots.push(project(state));
      }
      vi.restoreAllMocks();
      return snapshots;
    };

    const normal = run(false);
    const reversed = run(true);

    expect(normal).toEqual(reversed);
    expect(normal.some(snapshot => snapshot.customers.length === 0)).toBe(true);
  });

  it('stores the returned batch before forwarding one status map to both resolvers', () => {
    const trace = [];
    const originalPrepareCustomers = customerDomain.prepareCustomersForMovement;
    const originalPrepareStaff = staffDomain.prepareStaffForMovement;
    const originalAdvance = movementDomain.advanceCharacterMovementBatch;
    const originalResolveCustomers = customerDomain.resolveCustomersAfterMovement;
    const originalResolveStaff = staffDomain.resolveStaffAfterMovement;
    let returnedBatch;

    vi.spyOn(customerDomain, 'prepareCustomersForMovement').mockImplementation((...args) => {
      trace.push('prepare-customers');
      return originalPrepareCustomers(...args);
    });
    vi.spyOn(staffDomain, 'prepareStaffForMovement').mockImplementation((...args) => {
      trace.push('prepare-staff');
      return originalPrepareStaff(...args);
    });
    vi.spyOn(movementDomain, 'advanceCharacterMovementBatch').mockImplementation((...args) => {
      trace.push('batch');
      returnedBatch = originalAdvance(...args);
      return returnedBatch;
    });
    vi.spyOn(customerDomain, 'resolveCustomersAfterMovement').mockImplementation((state, dt, statuses) => {
      trace.push('resolve-customers');
      expect(state.movementCoordinator).toBe(returnedBatch.coordinator);
      expect(statuses).toBe(returnedBatch.statuses);
      return originalResolveCustomers(state, dt, statuses);
    });
    vi.spyOn(staffDomain, 'resolveStaffAfterMovement').mockImplementation((state, dt, statuses) => {
      trace.push('resolve-staff');
      expect(state.movementCoordinator).toBe(returnedBatch.coordinator);
      expect(statuses).toBe(returnedBatch.statuses);
      return originalResolveStaff(state, dt, statuses);
    });

    runTick({
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 12 * 3600, expansionLevel: 1 },
      doors: [{ id: 'door1', y: 340 }],
      staff: [{ id: 'staff', role: 'waiter', x: 300, y: 300, task: null }],
      customers: [{
        id: 'customer', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
        x: 500, y: 300, navigationGoal: { x: 620, y: 300 },
      }],
    }, { gameDt: 0, movementDt: 1 });

    expect(trace).toEqual([
      'prepare-customers', 'prepare-staff', 'batch', 'resolve-customers', 'resolve-staff',
    ]);
  });

  it('completes hydrated legacy checkout items before an in-flight payment resolves', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      restaurant: {
        ...fresh.restaurant,
        gameTime: 100,
        funds: 500,
        dailyRevenue: 0,
        totalServed: 0,
      },
      queue: [],
      tables: [{ id: 't1', status: 'occupied', seats: 1, x: 400, y: 300 }],
      chairs: [],
      customers: [{
        id: 'legacy-checkout', state: 'checkout_processing', paymentQueuedAt: 20,
        cashierStationId: 'cashier1', paymentReady: false, x: 840, y: 180,
        happiness: 80, dishId: 'starter-toast', drinkId: null, tableId: 't1',
      }],
      serviceItems: [{
        id: 'legacy-dish', customerId: 'legacy-checkout', kind: 'dish',
        menuItemId: 'starter-toast', tableId: 't1', state: 'delivered', consumptionStartedAt: 0,
      }],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, salary: 150, x: 840, y: 100, carryingServiceItemId: null,
        task: {
          type: 'take_payment', customerId: 'legacy-checkout',
          stationId: 'cashier1', startedAt: 41,
        },
      }],
      completedCustomers: [],
    };
    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.customers[0]).toMatchObject({
      state: 'checkout_processing', consumedServiceItemIds: [],
    });
    expect(hydrated.serviceItems[0]).toMatchObject({ state: 'delivered' });

    const paid = runTick(hydrated, { gameDt: 1, movementDt: 0 });
    expect(paid.customers[0]).toMatchObject({
      state: 'leaving', consumedServiceItemIds: ['legacy-dish'],
    });
    expect(paid.serviceItems[0]).toMatchObject({
      state: 'dirty_at_table', consumedAt: 101, dirtyAt: 101,
    });
    expect(paid.restaurant.totalServed).toBe(1);
    expect(paid.restaurant.dailyRevenue).toBeGreaterThan(0);
    expect(paid.restaurant.funds).toBeGreaterThan(500);
    expect(paid.completedCustomers).toEqual([]);

    const next = runTick(paid, { gameDt: 0, movementDt: 0 });
    expect(next.restaurant).toMatchObject({
      totalServed: 1,
      dailyRevenue: paid.restaurant.dailyRevenue,
      funds: paid.restaurant.funds,
    });
    expect(next.serviceItems[0]).toMatchObject({
      state: 'dirty_at_table', consumedAt: 101, dirtyAt: 101,
    });
  });

  it('resolves customer and staff movement from one tick snapshot', () => {
    const state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 12 * 3600, openHour: 10, closeHour: 22, reputation: 3 },
      doors: [{ id: 'door1', y: 340 }],
      floorDirt: [], washStations: [], cashierStations: [],
      customers: [{
        id: 'z-customer', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 940, y: 360, patience: 10, happiness: 50,
      }],
      staff: [{
        id: 'a-staff', role: 'waiter', morale: 80, x: 960, y: 340,
        activityPhase: 'idle_roaming', navigationGoal: { x: 960, y: 360 }, task: null,
      }],
    };

    const first = runTick(state, { gameDt: 1, movementDt: 1 });
    const result = runTick(first, { gameDt: 1, movementDt: 1 });
    expect(Math.hypot(
      result.customers[0].x - result.staff[0].x,
      result.customers[0].y - result.staff[0].y,
    )).toBeGreaterThanOrEqual(16 - 1e-6);
    expect([result.customers[0], result.staff[0]].filter(actor => actor.x === 960 && actor.y === 360))
      .toHaveLength(1);
    expect(result.staff[0]).toMatchObject({ x: 960, y: 360 });
    expect(result.customers[0]).not.toMatchObject({ x: 960, y: 360 });
  });

  it('prefers the guide-provenance staff descriptor over the duplicate customer descriptor', () => {
    const customerEntry = {
      character: { id: 'party-1', state: 'guided', guideStaffId: 'guide' },
      speed: 62, ignoredIds: [],
    };
    const guideStaffEntry = {
      character: { id: 'party-1', state: 'guided', guideStaffId: 'guide' },
      speed: 0, ignoredIds: ['guide', 'party-1'], provenance: 'guide',
    };

    const merged = mergeMovementEntries([customerEntry], [guideStaffEntry]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(guideStaffEntry);
    expect(merged[0].ignoredIds).toEqual(['guide', 'party-1']);
    expect(merged[0].provenance).toBe('guide');
  });

  it('prefers the staff guide descriptor over a genuine customer guide duplicate', () => {
    const state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, expansionLevel: 1 },
      staff: [{
        id: 'guide', role: 'waiter', x: 100, y: 100,
        navigationGoal: { x: 260, y: 100 },
        task: { type: 'guide_customer', customerIds: ['party-1'], tableId: 't1' },
      }],
      customers: [{
        id: 'party-1', state: 'guided', guideStaffId: 'guide', entryDoorId: 'door1',
        x: 80, y: 120, navigationGoal: { x: 88, y: 112 },
      }],
    };
    const customerEntry = customerDomain.getCustomerMovementEntries(state, 1)
      .find(entry => entry.character.id === 'party-1');
    const staffEntry = staffDomain.getStaffMovementEntries(state)
      .find(entry => entry.character.id === 'party-1');

    expect(customerEntry.provenance).toBe('guide');
    expect(staffEntry.provenance).toBe('guide');
    expect(mergeMovementEntries([customerEntry], [staffEntry])[0]).toBe(staffEntry);
  });

  it('never lets a stationary staff filler override a moving customer descriptor', () => {
    const customerEntry = {
      character: { id: 'z-customer', state: 'leaving', exitPhase: 'fading' },
      speed: 30, ignoredIds: [],
    };
    const fillerEntry = {
      character: { id: 'z-customer', state: 'leaving', exitPhase: 'fading' },
      speed: 0, ignoredIds: [],
    };

    const merged = mergeMovementEntries([customerEntry], [fillerEntry]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(customerEntry);
  });

  it('keeps a stale guided customer stationary when only the staff filler reaches the merge', () => {
    const staleFillerEntry = {
      character: { id: 'party-1', state: 'guided', guideStaffId: 'guide' },
      speed: 0, ignoredIds: [],
    };

    const merged = mergeMovementEntries([], [staleFillerEntry]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(staleFillerEntry);
    expect(merged[0].speed).toBe(0);
    expect(merged[0].ignoredIds).toEqual([]);
    expect(merged[0].provenance).toBeUndefined();
  });

  it.each([
    ['null task', null, []],
    ['non-guide task', { type: 'clean_table', tableId: 'missing' }, []],
    ['excluded party', { type: 'guide_customer', customerIds: ['other-party'], tableId: 't1' }, [
      { id: 'other-party', state: 'guided', guideStaffId: 'guide', x: 60, y: 140, patience: 100, happiness: 80 },
    ]],
  ])('keeps a stale guided customer stationary through the world batch for a %s', (_name, task, otherCustomers) => {
    const state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 12 * 3600, reputation: 3 },
      floorDirt: [], washStations: [], cashierStations: [],
      tables: task?.type === 'guide_customer'
        ? [{ id: 't1', seats: 1, status: 'reserved', x: 400, y: 300 }]
        : [],
      staff: [{
        id: 'guide', role: 'waiter', morale: 80, x: 100, y: 100,
        task,
      }],
      customers: [{
        id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 80, y: 120, patience: 100, happiness: 80,
      }, ...otherCustomers],
    };

    const result = runTick(state, { gameDt: 0, movementDt: 1 });
    const stale = result.customers.find(customer => customer.id === 'party-1');

    expect(stale).toMatchObject({ x: 80, y: 120 });
  });

  it.each([
    ['plural', { customerIds: ['party-1'] }],
    ['legacy singular', { customerId: 'party-1' }],
  ])('moves a genuine %s guided party through the merged world batch', (_name, partyFields) => {
    const state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 12 * 3600, reputation: 3 },
      floorDirt: [], washStations: [], cashierStations: [],
      tables: [{ id: 't1', seats: 1, status: 'reserved', x: 500, y: 300 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 510, y: 280 }],
      staff: [{
        id: 'guide', role: 'waiter', morale: 80, x: 100, y: 100,
        navigationGoal: { x: 260, y: 100 },
        task: { type: 'guide_customer', ...partyFields, tableId: 't1' },
      }],
      customers: [{
        id: 'party-1', state: 'guided', guideStaffId: 'guide', tableId: 't1',
        x: 80, y: 120, navigationGoal: { x: 88, y: 112 }, patience: 100, happiness: 80,
      }],
    };

    const result = runTick(state, { gameDt: 0, movementDt: 0.1 });
    const next = runTick(result, { gameDt: 0, movementDt: 0.1 });

    expect(next.staff[0].x).toBeGreaterThan(100);
    expect(next.customers[0].x).toBeGreaterThan(80);
  });

  it('emits exactly one entry per actor including stationary actors', () => {
    const entries = mergeMovementEntries([
      { character: { id: 'moving', state: 'leaving' }, speed: 55, ignoredIds: [] },
      { character: { id: 'filler', state: 'eating' }, speed: 0, ignoredIds: [] },
    ], [
      { character: { id: 'moving', state: 'leaving' }, speed: 0, ignoredIds: [] },
      { character: { id: 'moving', state: 'leaving' }, speed: 0, ignoredIds: [] },
      { character: { id: 'guide', state: 'guided' }, speed: 62, ignoredIds: [], provenance: 'guide' },
      { character: { id: 'filler', state: 'eating' }, speed: 0, ignoredIds: [] },
    ]);

    const ids = entries.map(entry => entry.character.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['filler', 'guide', 'moving']);
  });

  it('serialises non-fading customers at one door without blocking independent exits', () => {
    let state = {
      ...emptyState,
      restaurant: {
        ...emptyState.restaurant, gameTime: 12 * 3600, openHour: 10, closeHour: 22,
        reputation: 3, expansionLevel: 1,
      },
      doors: [{ id: 'door1', y: 340 }, { id: 'door2', y: 180 }],
      floorDirt: [], washStations: [], cashierStations: [],
      customers: [
        {
          id: 'c1', state: 'leaving', x: 860, y: 280, exitPhase: 'to_door', exitDoorId: 'door1',
          navigationGoal: { x: 993, y: 360 }, patience: 10, happiness: 50,
        },
        {
          id: 'c2', state: 'leaving', x: 860, y: 440, exitPhase: 'to_door', exitDoorId: 'door1',
          navigationGoal: { x: 993, y: 360 }, patience: 10, happiness: 50,
        },
        {
          id: 'c3', state: 'leaving', x: 860, y: 200, exitPhase: 'to_door', exitDoorId: 'door2',
          navigationGoal: { x: 993, y: 200 }, patience: 10, happiness: 50,
        },
      ],
    };
    const fadingIds = new Set();
    let independentDoorMoved = false;
    let secondDoorCustomerMovedTooEarly = false;
    let earlyEvidence = null;
    for (let tick = 0; tick < 80 && state.customers.length; tick += 1) {
      const beforeSecond = state.customers.find(customer => customer.id === 'c2');
      const beforeFirst = state.customers.find(customer => customer.id === 'c1');
      state = runTick(state, { gameDt: 1, movementDt: 1 });
      const first = state.customers.find(customer => customer.id === 'c1');
      const second = state.customers.find(customer => customer.id === 'c2');
      const independent = state.customers.find(customer => customer.id === 'c3');
      for (const customer of state.customers) {
        if (customer.exitPhase === 'fading') fadingIds.add(customer.id);
      }
      independentDoorMoved ||= independent?.x > 860;
      if (beforeFirst && beforeFirst.exitPhase !== 'fading'
        && first && first.exitPhase !== 'fading'
        && beforeSecond && second && second.x > beforeSecond.x) {
        secondDoorCustomerMovedTooEarly = true;
        earlyEvidence = {
          tick: tick + 1,
          beforeFirst,
          first,
          beforeSecond,
          second,
        };
      }
      if (state.customers.filter(customer => customer.exitDoorId === 'door1').length === 2) {
        expect(Math.hypot(
          state.customers.find(customer => customer.id === 'c1').x
            - state.customers.find(customer => customer.id === 'c2').x,
          state.customers.find(customer => customer.id === 'c1').y
            - state.customers.find(customer => customer.id === 'c2').y,
        )).toBeGreaterThanOrEqual(16 - 1e-6);
      }
    }
    expect(independentDoorMoved).toBe(true);
    expect(secondDoorCustomerMovedTooEarly, JSON.stringify(earlyEvidence)).toBe(false);
    expect(fadingIds).toEqual(new Set(['c1', 'c2', 'c3']));
    expect(state.customers).toHaveLength(0);
  });

  it('preserves the incumbent door admission when an earlier array member starts leaving later', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = {
      ...emptyState,
      restaurant: {
        ...emptyState.restaurant, gameTime: 12 * 3600, openHour: 10, closeHour: 22,
        reputation: 3, expansionLevel: 1,
      },
      doors: [{ id: 'door1', y: 340 }],
      floorDirt: [], washStations: [], cashierStations: [],
      customers: [
        {
          id: 'older', state: 'waiting', x: 860, y: 280, patience: 100, happiness: 80,
        },
        {
          id: 'younger', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
          x: 860, y: 440, navigationGoal: { x: 993, y: 360 }, patience: 100, happiness: 80,
        },
      ],
    };

    for (let tick = 0; tick < 100; tick += 1) {
      state = runTick(state, { gameDt: 0, movementDt: 0.1 });
      const younger = state.customers.find(customer => customer.id === 'younger');
      if (younger?.exitPhase === 'to_door'
        && Math.hypot(younger.x - 993, younger.y - 360) < 16) break;
    }

    const approaching = state.customers.find(customer => customer.id === 'younger');
    expect(approaching).toMatchObject({ state: 'leaving', exitPhase: 'to_door' });
    expect(Math.hypot(approaching.x - 993, approaching.y - 360)).toBeLessThan(16);

    state = {
      ...state,
      customers: state.customers.map(customer => customer.id === 'older'
        ? { ...customer, patience: 0 }
        : customer),
    };
    state = runTick(state, { gameDt: 1, movementDt: 0.1 });

    const dynamicEntries = customerDomain.getCustomerMovementEntries(state, 0.1);
    expect(dynamicEntries.find(entry => entry.character.id === 'younger')).toMatchObject({ speed: 55 });
    expect(dynamicEntries.find(entry => entry.character.id === 'older')).toMatchObject({ speed: 0 });

    const fadingOrRemoved = new Set();
    for (let tick = 0; tick < 120 && state.customers.length; tick += 1) {
      const older = state.customers.find(customer => customer.id === 'older');
      const younger = state.customers.find(customer => customer.id === 'younger');
      if (older && younger) {
        expect(Math.hypot(older.x - younger.x, older.y - younger.y))
          .toBeGreaterThanOrEqual(16 - 1e-6);
      }
      for (const customer of state.customers) {
        if (customer.exitPhase === 'fading') fadingOrRemoved.add(customer.id);
      }
      state = runTick(state, { gameDt: 0, movementDt: 0.1 });
    }
    for (const id of ['older', 'younger']) {
      if (!state.customers.some(customer => customer.id === id)) fadingOrRemoved.add(id);
    }

    expect(fadingOrRemoved).toEqual(new Set(['older', 'younger']));
    expect(state.customers).toHaveLength(0);
  });

  it('advances only fading customers whose committed batch displacement is proven', () => {
    const state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 12 * 3600, openHour: 10, closeHour: 22, reputation: 3 },
      doors: [{ id: 'door1', y: 340 }],
      floorDirt: [], washStations: [], cashierStations: [],
      customers: [{
        id: 'fading-customer', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
        exitHeading: { angleDegrees: 0, x: 1, y: 0 }, exitFadeProgress: 0.5,
        x: 993, y: 360, navigationGoal: { x: 1113, y: 360 }, patience: 10, happiness: 50,
      }],
    };

    const first = runTick(state, { gameDt: 0, movementDt: 1 });
    const result = runTick(first, { gameDt: 0, movementDt: 1 });

    expect(first.customers[0]).toMatchObject({ exitPhase: 'fading', x: 1023, exitFadeProgress: 0.25 });
    expect(result.customers[0]).toMatchObject({ exitPhase: 'fading', x: 1053, exitFadeProgress: 0.5 });
  });

  it('creates floor dirt before staff assignment so a janitor can claim it in the same tick', () => {
    const state = {
      ...emptyState,
      tables: [{ id: 't1', status: 'occupied', seats: 1, x: 220, y: 180 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 200, y: 200 }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', chairId: 'ch1', x: 200, y: 200, dirtFactor: 9.975, happiness: 80, patience: 100 }],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, task: null }],
      floorDirt: [],
    };
    const result = runTick(state, 1);
    expect(result.floorDirt).toHaveLength(1);
    expect(result.staff[0].task).toMatchObject({ type: 'clean_floor', dirtId: 'dirt-1' });
  });

  it('releases stale carried service items for cleanup without leaving a carrier reference', () => {
    const state = {
      ...emptyState,
      customers: [{
        id: 'c1', state: 'leaving', happiness: 40, patience: 0,
        dishId: 'd1', tableId: 't1', x: 200, y: 200,
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
        state: 'carried', x: 150, y: 130,
      }],
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, salary: 150,
        x: 180, y: 220, carryingServiceItemId: 'i1',
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' },
      }],
    };

    const result = runTick(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.serviceItems).toEqual([expect.objectContaining({ id: 'i1', state: 'to_clean' })]);
  });

  it("preserves another worker's carried service item through stale delivery cancellation", () => {
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 400, y: 400,
    };
    const state = {
      ...emptyState,
      customers: [{
        id: 'c1', state: 'ordering', happiness: 80, patience: 100,
        dishId: 'd1', tableId: 't1', x: 200, y: 200,
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      serviceItems: [item],
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, salary: 150,
          x: 180, y: 220, carryingServiceItemId: null,
          task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'missing' },
        },
        {
          id: 'w2', role: 'waiter', morale: 80, salary: 150,
          x: 400, y: 400, navigationGoal: { x: 600, y: 400 }, carryingServiceItemId: 'i1',
          task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' },
        },
      ],
    };

    const result = runTick(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.staff[1]).toMatchObject({ carryingServiceItemId: 'i1' });
    expect(result.serviceItems).toEqual([item]);
  });

  function runServiceJourney(orderRoll) {
    vi.spyOn(Math, 'random').mockReturnValue(orderRoll);
    const customerId = `journey-${String(orderRoll).replace('.', '-')}`;
    const kindsForJourney = orderRoll < 0.75 ? ['dish'] : orderRoll < 0.95 ? ['dish', 'drink'] : ['drink'];
    let state = createInitialState();
    state = {
      ...state,
      queue: [{
        id: customerId, partyId: `${customerId}-party`, partySize: 1,
        partyType: 'solo', archetype: 'regular', gender: 'female', patience: 2000,
        happiness: 80, state: 'queued', dishId: null, tableId: null, chairId: null,
      }],
    };
    const seen = new Set();
    const deliveredKinds = new Set();
    const stages = new Set();
    const cleanedItemIds = new Set();
    const cleaningTasks = new Set();
    const journeyItemIds = new Set();
    const pickupTaskItemIds = new Set();
    const deliveryTaskItemIds = new Set();
    const removedAfterCleaningIds = new Set();
    const checkoutAbandonments = new Set();
    const consumedAtByKind = new Map();
    const firstDirtyStateByKind = new Map();
    const itemKindById = new Map();
    let previousItems = new Map();
    let previousCustomer = null;
    let reputationBeforePayment = null;
    let reputationAfterPayment = null;
    let consumptionStart = null;
    let checkoutStartedAt = null;
    let paymentStartedAt = null;
    let drinkClearedWhileDishUnfinished = false;
    let bothDelivered = false;
    let progressedAfterBoth = false;
    let elapsed = 0;
    let completed = false;
    for (; elapsed < 1800; elapsed += 1) {
      // Keep this long-running journey at the pre-scale game-time pace.
      const previousTotalServed = state.restaurant.totalServed;
      const previousReputation = state.restaurant.reputation;
      state = runTick(state, 1 / 60);
      const customer = state.customers.find(candidate => candidate.id === customerId);
      if (state.restaurant.totalServed > previousTotalServed && reputationBeforePayment == null) {
        reputationBeforePayment = previousReputation;
        reputationAfterPayment = state.restaurant.reputation;
      }
      const journeyItems = state.serviceItems.filter(candidate => candidate.customerId === customerId);
      for (const item of journeyItems) {
        journeyItemIds.add(item.id);
        itemKindById.set(item.id, item.kind);
        seen.add(`${item.kind}:${item.state}`);
        if (item.state === 'to_clean') cleanedItemIds.add(item.id);
        if (Number.isFinite(item.consumptionStartedAt) && consumptionStart == null) {
          consumptionStart = item.consumptionStartedAt;
        }
        if (Number.isFinite(item.consumedAt) && !consumedAtByKind.has(item.kind)) {
          consumedAtByKind.set(item.kind, item.consumedAt);
        }
        if (['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing'].includes(item.state)
          && !firstDirtyStateByKind.has(item.kind)) {
          firstDirtyStateByKind.set(item.kind, item.state);
        }
      }
      for (const id of previousItems.keys()) {
        if (!journeyItems.some(item => item.id === id) && cleaningTasks.has(id)) removedAfterCleaningIds.add(id);
      }
      if (customer) {
        seen.add(`customer:${customer.state}:${customer.exitPhase || ''}`);
        if (customer.state === 'seated') stages.add('seated');
        if (customer.state === 'waiting_for_items') stages.add('waiting_for_items');
        if (customer.state === 'eating') stages.add('eating');
        if (['checkout_queued', 'checkout_moving', 'checkout_processing'].includes(customer.state)) {
          stages.add(customer.state);
          if (checkoutStartedAt == null) checkoutStartedAt = state.restaurant.gameTime;
        }
        if (customer.state === 'leaving' && customer.departureReason) stages.add(`departure:${customer.departureReason}`);
      }
      const dish = journeyItems.find(item => item.kind === 'dish');
      const drink = journeyItems.find(item => item.kind === 'drink');
      const removedDrink = [...itemKindById].some(([id, kind]) => kind === 'drink'
        && !journeyItems.some(item => item.id === id));
      const dishUnfinished = dish?.state === 'delivered' && !Number.isFinite(dish.consumedAt);
      if (customer?.state === 'eating' && dishUnfinished
        && (['carried_dirty', 'queued_for_wash'].includes(drink?.state) || removedDrink)) {
        drinkClearedWhileDishUnfinished = true;
      }
      if (previousCustomer
        && ['checkout_queued', 'checkout_moving', 'checkout_processing'].includes(previousCustomer.state)
        && customer?.state === 'leaving'
        && customer.departureReason !== 'served') {
        checkoutAbandonments.add(customer.id);
      }
      previousCustomer = customer ? { ...customer } : null;
      for (const staff of state.staff) {
        const task = staff.task;
        if (task?.customerId === customerId && task.type === 'take_order') stages.add('take_order');
        if (task?.customerId === customerId && task.type === 'take_payment') {
          stages.add('take_payment');
          if (paymentStartedAt == null) paymentStartedAt = state.restaurant.gameTime;
        }
        if (task?.serviceItemId && journeyItems.some(item => item.id === task.serviceItemId)) {
          if (task.type === 'prepare_dish') stages.add('prepare_dish');
          if (task.type === 'pickup_service_item') {
            stages.add(`pickup:${task.serviceItemId}`);
            pickupTaskItemIds.add(task.serviceItemId);
          }
          if (task.type === 'deliver_service_item') {
            stages.add(`deliver:${task.serviceItemId}`);
            deliveryTaskItemIds.add(task.serviceItemId);
          }
          if (task.type === 'clean_service_item') {
            stages.add(`clean:${task.serviceItemId}`);
            cleaningTasks.add(task.serviceItemId);
          }
        }
      }
      for (const item of journeyItems) {
        if (item.state !== 'delivered' || previousItems.get(item.id) === 'delivered') continue;
        deliveredKinds.add(item.kind);
      }
      if (kindsForJourney.length === 2 && deliveredKinds.size === 1) {
        expect(customer).toBeDefined();
        expect(customer.state).toBe('waiting_for_items');
      }
      if (deliveredKinds.size === 2) {
        bothDelivered = true;
        stages.add('both_delivered');
        if (customer?.state !== 'waiting_for_items') progressedAfterBoth = true;
      }
      previousItems = new Map(journeyItems.map(item => [item.id, item.state]));
      const ownerKinds = state.serviceItems.map(item => `${item.customerId}:${item.kind}`);
      expect(new Set(ownerKinds).size).toBe(ownerKinds.length);
      expect(state.serviceItems.every(item => typeof item.customerId === 'string')).toBe(true);
      const occupiedSlots = state.serviceItems.filter(item => item.state === 'on_service').map(item => `${item.serviceTableId}:${item.serviceSlotIndex}`);
      expect(new Set(occupiedSlots).size).toBe(occupiedSlots.length);
      for (const staff of state.staff) if (staff.carryingServiceItemId !== null && staff.carryingServiceItemId !== undefined) expect(state.serviceItems).toContainEqual(expect.objectContaining({ id: staff.carryingServiceItemId, state: expect.stringMatching(/^carried(_dirty)?$/) }));
      if (!customer && state.restaurant.totalServed === 1) { completed = true; break; }
    }
    return {
      state, customerId, seen, deliveredKinds, stages, cleaningTasks, cleanedItemIds,
      journeyItemIds, pickupTaskItemIds, deliveryTaskItemIds, removedAfterCleaningIds,
      checkoutAbandonments, reputationBeforePayment, reputationAfterPayment,
      consumedAtByKind, firstDirtyStateByKind, consumptionStart, checkoutStartedAt,
      paymentStartedAt, drinkClearedWhileDishUnfinished,
      bothDelivered, progressedAfterBoth, elapsed: elapsed + 1, completed,
    };
  }

  it.each([[0.5, ['dish'], 14.4], [0.8, ['dish', 'drink'], 16.8], [0.97, ['drink'], 2.4]])('completes the %j fresh-game service journey', (roll, kinds, expectedRevenue) => {
    const result = runServiceJourney(roll);
    const {
      state, seen, deliveredKinds, stages, cleaningTasks, cleanedItemIds, journeyItemIds,
      pickupTaskItemIds, deliveryTaskItemIds, removedAfterCleaningIds,
      checkoutAbandonments, reputationBeforePayment, reputationAfterPayment,
      consumedAtByKind, firstDirtyStateByKind, paymentStartedAt,
      drinkClearedWhileDishUnfinished,
      bothDelivered, progressedAfterBoth, elapsed, completed,
    } = result;
    for (const kind of kinds) for (const status of ['on_service', 'carried', 'delivered']) expect(seen).toContain(`${kind}:${status}`);
    if (kinds.includes('drink')) expect(seen).toContain('drink:preparing');
    expect([...seen].some(entry => entry.startsWith('customer:leaving:'))).toBe(true);
    expect(state.restaurant.totalServed).toBeGreaterThanOrEqual(0);
    expect(state.restaurant.dailyRevenue).toBeGreaterThanOrEqual(0);
    expect(state.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(state.serviceItems.every(item => ['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing'].includes(item.state))).toBe(true);
    expect(completed || state.customers.length === 0 || state.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(1801);
    expect(deliveredKinds).toEqual(new Set(kinds));
    for (const stage of ['seated', 'waiting_for_items', 'eating', 'checkout_queued', 'checkout_moving', 'checkout_processing']) {
      expect(stages).toContain(stage);
    }
    expect(checkoutAbandonments).toEqual(new Set());
    if (reputationBeforePayment != null) {
      expect(reputationAfterPayment).toBeGreaterThan(reputationBeforePayment);
    }
    expect(stages.has('take_order')).toBe(true);
    expect(stages.has('take_payment') || state.restaurant.totalServed === 0).toBe(true);
    expect(bothDelivered).toBe(kinds.length === 2 ? true : false);
    expect(progressedAfterBoth).toBe(kinds.length === 2 ? true : false);
    expect(stages.has('prepare_dish')).toBe(kinds.includes('dish'));
    expect(kinds.every(kind => [...seen].some(entry => entry === `${kind}:delivered`))).toBe(true);
    expect(pickupTaskItemIds).toEqual(journeyItemIds);
    expect(deliveryTaskItemIds).toEqual(journeyItemIds);
    expect(cleanedItemIds).toEqual(expect.any(Set));
    expect(cleaningTasks).toEqual(expect.any(Set));
    expect(removedAfterCleaningIds).toEqual(expect.any(Set));
    if (kinds.length === 1) {
      const kind = kinds[0];
      const duration = kind === 'dish' ? 480 : 180;
      expect(consumedAtByKind.get(kind) - result.consumptionStart).toBe(duration);
      expect(firstDirtyStateByKind.get(kind)).toBe('dirty_at_table');
      expect(paymentStartedAt).toBeGreaterThanOrEqual(consumedAtByKind.get(kind));
    } else {
      expect(result.consumedAtByKind.get('drink') - result.consumptionStart).toBe(180);
      expect(result.consumedAtByKind.get('dish') - result.consumptionStart).toBe(480);
      expect(result.consumedAtByKind.get('drink')).toBeLessThan(result.consumedAtByKind.get('dish'));
      expect(result.checkoutStartedAt).toBeGreaterThanOrEqual(result.consumedAtByKind.get('dish'));
      expect(drinkClearedWhileDishUnfinished).toBe(true);
    }
  });

  it('lets a newly purchased second cashier station process payment alongside the staffed starter station', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const initial = createInitialState();
    let state = {
      ...initial,
      tables: initial.tables.map(table => ['t1', 't2'].includes(table.id)
        ? { ...table, status: 'occupied' }
        : table),
      cashierStations: [
        initial.cashierStations[0],
        { id: 'cashier2', x: 600, y: 300, w: 80, h: 40, assignedStaffId: 'starter-waiter' },
      ],
      customers: [
        {
          id: 'c1', state: 'checkout_queued', x: 780, y: 140, patience: 100,
          happiness: 80, paymentQueuedAt: 10, dishId: 'starter-toast', tableId: 't1',
        },
        {
          id: 'c2', state: 'checkout_queued', x: 580, y: 320, patience: 100,
          happiness: 80, paymentQueuedAt: 20, dishId: 'starter-toast', tableId: 't2',
        },
      ],
    };
    let secondStationTookPayment = false;

    state.customers = state.customers.map(customer => ({
      ...customer,
      x: customer.id === 'c1' ? 840 : 640,
      y: customer.id === 'c1' ? 180 : 360,
      paymentReady: customer.id === 'c1',
    }));
    for (let tick = 0; tick < 70; tick += 1) {
      state = runTick(state, 1 / 60);
      secondStationTookPayment ||= state.staff.some(staff =>
        staff.id === 'starter-waiter'
          && staff.task?.type === 'take_payment'
          && staff.task.stationId === 'cashier2'
          && staff.task.customerId === 'c2');
    }

    expect(secondStationTookPayment).toBe(true);
    expect(state.customers.find(customer => customer.id === 'c2'))
      .toMatchObject({ state: 'leaving', departureReason: 'served' });
    expect(state.restaurant.totalServed).toBe(2);
  });

  it('schedules seated departure from the actual consumed chair centre before checkout readiness', () => {
    const initial = createInitialState();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = {
      ...initial,
      restaurant: { ...initial.restaurant, gameTime: 479 },
      tables: initial.tables.map(t => t.id === 't1' ? { ...t, status: 'occupied' } : t),
      staff: [{ ...initial.staff.find(s => s.id === 'starter-cashier-waiter'), x: 840, y: 100, task: null }],
      customers: [{
        id: 'departure', partyId: 'solo', partySize: 1, state: 'eating',
        tableId: 't1', chairId: 'ch1', x: 220, y: 190, patience: 5000,
        happiness: 80, dirtFactor: 0, dishId: 'starter-toast',
        orderedServiceItemIds: ['dish'], consumedServiceItemIds: [],
      }],
      serviceItems: [{
        id: 'dish', kind: 'dish', customerId: 'departure', tableId: 't1',
        menuItemId: 'starter-toast', state: 'delivered', consumptionStartedAt: 0,
        x: 220, y: 220,
      }],
    };
    state = runTick(state, { gameDt: 1, movementDt: 0.1 });
    expect(state.customers[0]).toMatchObject({ state: 'checkout_queued', x: 220, y: 190 });
    state = runTick(state, { gameDt: 1, movementDt: 0.1 });
    expect(state.customers[0].paymentReady).toBe(false);
    expect(Math.hypot(state.customers[0].x - 220, state.customers[0].y - 190)).toBeLessThanOrEqual(6.2 + 1e-9);
    expect(movementDomain.getCharacterMovementStatus(state, 'departure').plan).toBe('scheduled');
    let arrived = false;
    for (let tick = 0; tick < 150; tick += 1) {
      const before = state.customers[0];
      state = runTick(state, { gameDt: 0, movementDt: 0.1 });
      const customer = state.customers[0];
      expect(Math.hypot(customer.x - before.x, customer.y - before.y)).toBeLessThanOrEqual(6.2 + 1e-6);
      if (customer.x !== 840 || customer.y !== 180) expect(customer.paymentReady).toBe(false);
      if (customer.paymentReady) { arrived = true; break; }
    }
    expect(arrived).toBe(true);
    expect(state.customers[0]).toMatchObject({ x: 840, y: 180 });
  });

  it('completes one deterministic full-service lifecycle and its independent cleanup path', () => {
    const initial = createInitialState();
    const customerId = 'lifecycle-customer';
    let state = {
      ...initial,
      restaurant: { ...initial.restaurant, gameTime: 0 },
      queue: [],
      customers: [{
        id: customerId,
        partyId: 'lifecycle-party',
        partySize: 1,
        partyType: 'solo',
        archetype: 'regular',
        gender: 'female',
        patience: 5000,
        happiness: 80,
        state: 'seated',
        dishId: null,
        drinkId: null,
        tableId: 't1',
        chairId: 'ch1',
        x: 220,
        y: 190,
        dirtFactor: 0,
      }],
      tables: initial.tables.map(table => table.id === 't1'
        ? { ...table, status: 'occupied' }
        : table),
      staff: initial.staff
        .filter(staff => ['starter-cook', 'starter-waiter', 'starter-cashier-waiter', 'starter-janitor'].includes(staff.id))
        .map(staff => ({
          ...staff,
          x: {
            'starter-cook': 80,
            'starter-waiter': 180,
            'starter-cashier-waiter': 840,
            'starter-janitor': 600,
          }[staff.id],
          y: {
            'starter-cook': 80,
            'starter-waiter': 180,
            'starter-cashier-waiter': 100,
            'starter-janitor': 360,
          }[staff.id],
          task: null,
          carryingServiceItemId: null,
        })),
    };

    let useDeterministicDishRoll = false;
    vi.spyOn(Math, 'random').mockImplementation(() => (useDeterministicDishRoll ? 0.5 : 1));

    const requiredStages = [
      'take_order', 'prepare_dish', 'pickup_service_item', 'deliver_service_item',
      'eating', 'paying_at_cashier', 'dirty_at_table', 'carried_dirty',
      'clean_table', 'queued_for_wash', 'washing', 'washed', 'leaving',
    ];
    const observedStages = [];
    const observe = stage => {
      if (!observedStages.includes(stage)) observedStages.push(stage);
    };
    const stageIndex = stage => observedStages.indexOf(stage);
    const observedCompletionIds = new Set();
    let observedPaymentHappiness = null;
    let completed = false;
    let previousTableStatus = state.tables.find(table => table.id === 't1').status;
    let emptyTransitions = 0;

    for (let tick = 0; tick < 5000; tick += 1) {
      const previousItem = state.serviceItems.find(item => item.customerId === customerId);
      const previousTotalServed = state.restaurant.totalServed;
      useDeterministicDishRoll = state.staff.some(staff =>
        staff.task?.type === 'take_order' && staff.task.startedAt != null);

      state = runTick(state, 1 / 60);
      if (state.restaurant.totalServed > previousTotalServed) {
        observedCompletionIds.add(customerId);
        observedPaymentHappiness = state.customers.find(customer => customer.id === customerId)?.happiness;
      }

      const item = state.serviceItems.find(candidate => candidate.customerId === customerId);
      const customer = state.customers.find(candidate => candidate.id === customerId);
      for (const staff of state.staff) {
        const task = staff.task;
        if (task?.type === 'clean_table' && task.tableId === 't1') {
          observe('clean_table');
        }
      }
      if (state.staff.some(staff => staff.task?.type === 'take_order' && staff.task.customerId === customerId)) observe('take_order');
      if (state.staff.some(staff => staff.task?.type === 'prepare_dish' && staff.task.serviceItemId === item?.id)
        || item?.state === 'preparing') observe('prepare_dish');
      if (state.staff.some(staff => staff.task?.type === 'pickup_service_item' && staff.task.serviceItemId === item?.id)
        || (previousItem?.state === 'on_service' && item?.state === 'carried')) observe('pickup_service_item');
      if (state.staff.some(staff => staff.task?.type === 'deliver_service_item' && staff.task.serviceItemId === item?.id)
        || (previousItem?.state === 'carried' && item?.state === 'delivered')) observe('deliver_service_item');
      if (customer?.state === 'eating') observe('eating');
      if (['checkout_queued', 'checkout_moving', 'checkout_processing'].includes(customer?.state)
        || state.staff.some(staff => staff.task?.type === 'take_payment' && staff.task.customerId === customerId)) {
        observe('paying_at_cashier');
      }
      if (item?.state === 'dirty_at_table') observe('dirty_at_table');
      if (item?.state === 'carried_dirty') observe('carried_dirty');
      if (item?.state === 'queued_for_wash') observe('queued_for_wash');
      if (item?.state === 'washing') observe('washing');
      if (previousItem?.state === 'washing' && !item) observe('washed');
      if (customer?.state === 'leaving') observe('leaving');

      const lifecycleTable = state.tables.find(table => table.id === 't1');
      if (previousTableStatus === 'empty') {
        expect(lifecycleTable.status).toBe('empty');
      }
      if (previousTableStatus !== 'empty' && lifecycleTable.status === 'empty') {
        emptyTransitions += 1;
      }
      previousTableStatus = lifecycleTable.status;

      completed = requiredStages.every(stage => observedStages.includes(stage))
        && observedCompletionIds.size === 1
        && state.serviceItems.length === 0
        && state.tables[0].status === 'empty'
        && state.customers.length === 0;
      if (completed) break;
    }

    const finalState = state;
    expect(completed, `lifecycle stalled after observing: ${observedStages.join(' -> ')}; final=${JSON.stringify({
      customers: finalState.customers,
      completedCustomers: finalState.completedCustomers,
      serviceItems: finalState.serviceItems,
      tables: finalState.tables,
    })}`).toBe(true);
    expect(observedStages).toEqual(expect.arrayContaining(requiredStages));
    expect(observedCompletionIds).toEqual(new Set([customerId]));
    expect(finalState.restaurant.totalServed).toBe(1);
    expect(finalState.completedCustomers).toEqual([]);
    expect(finalState.serviceItems).toEqual([]);
    expect(finalState.tables[0].status).toBe('empty');
    const lifecycleDish = initial.dishes.find(dish => dish.id === 'starter-toast');
    const expectedRevenue = lifecycleDish.price
      + Math.round(lifecycleDish.price * (observedPaymentHappiness / 400) * 100) / 100;
    expect(Math.round(expectedRevenue * 100) / 100).toBe(14.4);
    expect(Math.round(finalState.restaurant.dailyRevenue * 100) / 100).toBe(14.4);
    expect(JSON.stringify(finalState)).not.toContain('revenueProcessed');

    expect(stageIndex('take_order')).toBeLessThan(stageIndex('prepare_dish'));
    expect(stageIndex('prepare_dish')).toBeLessThan(stageIndex('pickup_service_item'));
    expect(stageIndex('pickup_service_item')).toBeLessThan(stageIndex('deliver_service_item'));
    expect(stageIndex('deliver_service_item')).toBeLessThan(stageIndex('eating'));
    expect(stageIndex('eating')).toBeLessThan(stageIndex('paying_at_cashier'));
    expect(stageIndex('paying_at_cashier')).toBeLessThan(stageIndex('dirty_at_table'));
    expect(stageIndex('paying_at_cashier')).toBeLessThan(stageIndex('leaving'));
    expect(stageIndex('dirty_at_table')).toBeLessThan(stageIndex('carried_dirty'));
    expect(stageIndex('carried_dirty')).toBeLessThan(stageIndex('clean_table'));
    expect(emptyTransitions).toBe(1);
    expect(stageIndex('carried_dirty')).toBeLessThan(stageIndex('queued_for_wash'));
    expect(stageIndex('queued_for_wash')).toBeLessThan(stageIndex('washing'));
    expect(stageIndex('washing')).toBeLessThan(stageIndex('washed'));
  });

  it('completes a mixed-affordability party lifecycle with one payment and one review', () => {
    const initial = createInitialState();
    let state = {
      ...initial,
      unlockedDrinkIds: [],
      queue: [],
      customers: [
        {
          id: 'payer', partyId: 'mixed-party', partySize: 2, partyType: 'couple',
          archetype: 'regular', gender: 'female', spendingTier: 'budget', spendingBudget: 18,
          patience: 5000, patienceMax: 5000, happiness: 100, state: 'seated',
          dishId: null, drinkId: null, tableId: 't1', chairId: 'ch1',
          x: 220, y: 190, dirtFactor: 0,
        },
        {
          id: 'waiter', partyId: 'mixed-party', partySize: 2, partyType: 'couple',
          archetype: 'regular', gender: 'male', spendingTier: 'budget', spendingBudget: 6,
          patience: 5000, patienceMax: 5000, happiness: 100, state: 'seated',
          dishId: null, drinkId: null, tableId: 't1', chairId: 'ch2',
          x: 220, y: 250, dirtFactor: 0,
        },
      ],
      tables: initial.tables.map(table => table.id === 't1'
        ? { ...table, status: 'occupied' }
        : table),
      staff: initial.staff
        .filter(staff => [
          'starter-cook', 'starter-waiter', 'starter-cashier-waiter', 'starter-janitor',
        ].includes(staff.id))
        .map(staff => ({
          ...staff,
          x: {
            'starter-cook': 80,
            'starter-waiter': 180,
            'starter-cashier-waiter': 840,
            'starter-janitor': 600,
          }[staff.id],
          y: {
            'starter-cook': 80,
            'starter-waiter': 180,
            'starter-cashier-waiter': 100,
            'starter-janitor': 360,
          }[staff.id], task: null, carryingServiceItemId: null,
        })),
    };
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const checkoutStates = ['checkout_queued', 'checkout_moving', 'checkout_processing'];
    const departureReasons = new Map();
    const tableStates = new Set(['occupied']);
    let unaffordableServiceItemCreated = false;
    let unaffordableEnteredCheckout = false;
    let waitedWhilePayerDined = false;
    let paymentsObserved = 0;
    let completed = false;

    for (let tick = 0; tick < 6000; tick += 1) {
      const previousServed = state.restaurant.totalServed;
      state = runTick(state, 1 / 60);
      paymentsObserved += state.restaurant.totalServed - previousServed;
      unaffordableServiceItemCreated ||= state.serviceItems.some(item => item.customerId === 'waiter');
      const payer = state.customers.find(customer => customer.id === 'payer');
      const waitingMember = state.customers.find(customer => customer.id === 'waiter');
      unaffordableEnteredCheckout ||= checkoutStates.includes(waitingMember?.state);
      if (payer && waitingMember
        && ['waiting_for_items', 'eating'].includes(payer.state)
        && waitingMember.state === 'waiting_for_party') {
        waitedWhilePayerDined = true;
        expect(waitingMember.tableId).toBe('t1');
        expect(state.tables.find(table => table.id === 't1').status).toBe('occupied');
      }
      for (const customer of state.customers) {
        if (customer.state === 'leaving') departureReasons.set(customer.id, customer.departureReason);
      }
      tableStates.add(state.tables.find(table => table.id === 't1').status);
      completed = state.customers.every(customer =>
        !['payer', 'waiter'].includes(customer.id))
        && state.tables.find(table => table.id === 't1').status === 'empty'
        && state.serviceItems.every(item => !['payer', 'waiter'].includes(item.customerId));
      if (completed) break;
    }

    expect(completed).toBe(true);
    expect(unaffordableServiceItemCreated).toBe(false);
    expect(unaffordableEnteredCheckout).toBe(false);
    expect(waitedWhilePayerDined).toBe(true);
    expect(departureReasons).toEqual(new Map([
      ['payer', 'served'],
      ['waiter', 'menu_unaffordable'],
    ]));
    expect(tableStates.has('dirty')).toBe(true);
    expect(tableStates.has('empty')).toBe(true);
    expect(paymentsObserved).toBe(1);
    expect(state.restaurant).toMatchObject({
      totalServed: 1, dailyRevenue: 15, reputation: 1.998,
    });
    expect(state.partyReviewHistory).toEqual([
      expect.objectContaining({
        partyId: 'mixed-party', score: -5, memberCount: 2, paidCount: 1,
        unaffordableCount: 1, reputationDelta: -0.002,
      }),
    ]);
    expect(state.pendingPartyReviews).toEqual([]);

    const settledRestaurant = state.restaurant;
    const settledHistory = state.partyReviewHistory;
    for (let tick = 0; tick < 120; tick += 1) state = runTick(state, 1 / 60);
    expect(state.restaurant).toMatchObject({
      totalServed: settledRestaurant.totalServed,
      dailyRevenue: settledRestaurant.dailyRevenue,
      funds: settledRestaurant.funds,
      reputation: settledRestaurant.reputation,
    });
    expect(state.partyReviewHistory).toEqual(settledHistory);
  });

  it('wipes once and keeps the table empty through delayed checkout departure', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = {
      ...emptyState,
      restaurant: {
        ...emptyState.restaurant, gameTime: 0, reputation: 3,
        openHour: 10, closeHour: 22,
      },
      dishes: [{ id: 'd1', price: 10 }],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      customers: [{
        id: 'former', state: 'checkout_queued', paymentQueuedAt: 1,
        cashierStationId: null, checkoutPosition: null, paymentReady: false,
        x: 400, y: 300, tableId: 't1', happiness: 80,
        patience: 1000, dishId: 'd1', drinkId: null,
        orderedServiceItemIds: ['dirty'], consumedServiceItemIds: ['dirty'],
      }],
      serviceItems: [{
        id: 'dirty', kind: 'dish', menuItemId: 'd1', customerId: 'former',
        tableId: 't1', state: 'dirty_at_table', dirtyAt: 0, consumedAt: 0,
      }],
      staff: [{
        id: 'cleaner', role: 'waiter', morale: 80,
        x: 180, y: 220, task: null, carryingServiceItemId: null,
      }],
      washStations: [{
        id: 'sink', type: 'manual', x: 300, y: 200, w: 40, h: 40,
      }],
      cashierStations: [],
      floorDirt: [],
    };
    let sawCarriedDirty = false;
    let sawCleanTable = false;
    let wiped = false;

    for (let tick = 0; tick < 500; tick += 1) {
      state = runTick(state, 1 / 60);
      if (state.serviceItems.some(item => item.state === 'carried_dirty')) {
        sawCarriedDirty = true;
      }
      if (state.staff.some(worker => worker.task?.type === 'clean_table'
        && worker.task.tableId === 't1')) {
        sawCleanTable = true;
      }
      if (state.tables[0].status === 'empty') {
        wiped = true;
        break;
      }
    }

    expect(sawCarriedDirty).toBe(true);
    expect(sawCleanTable).toBe(true);
    expect(wiped).toBe(true);
    expect(state.customers.find(customer => customer.id === 'former')).toMatchObject({
      state: 'checkout_queued', tableId: 't1',
    });

    state = {
      ...state,
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40,
        assignedStaffId: 'cashier',
      }],
      staff: [...state.staff, {
        id: 'cashier', role: 'waiter', morale: 80,
        x: 840, y: 100, task: null,
      }],
    };
    let observedLeaving = false;

    for (let tick = 0; tick < 1000; tick += 1) {
      state = runTick(state, 1 / 60);
      expect(state.tables[0].status).toBe('empty');
      const customer = state.customers.find(candidate => candidate.id === 'former');
      if (customer?.state === 'leaving') observedLeaving = true;
      if (!customer) break;
    }

    expect(observedLeaving).toBe(true);
    expect(state.customers.some(customer => customer.id === 'former')).toBe(false);
    expect(state.restaurant.totalServed).toBe(1);
    expect(state.tables[0].status).toBe('empty');
  });

  it('processes manual and automatic dirty items concurrently while returning the janitor to floor dirt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, gameTime: 0 },
      tables: [
        { id: 't1', status: 'dirty', seats: 2, x: 200, y: 200 },
        { id: 't2', status: 'dirty', seats: 2, x: 360, y: 200 },
        { id: 't3', status: 'occupied', seats: 2, x: 200, y: 360 },
      ],
      chairs: [],
      kitchenStations: [],
      serviceTables: [],
      cashierStations: [],
      washStations: [
        { id: 'manual-wash', type: 'manual', x: 300, y: 120, w: 40, h: 40 },
        { id: 'automatic-wash', type: 'automatic', x: 400, y: 120, w: 40, h: 40 },
      ],
      customers: [
        { id: 'manual-owner', state: 'leaving', tableId: 't1', patience: 1000, happiness: 80 },
        { id: 'automatic-owner', state: 'leaving', tableId: 't2', patience: 1000, happiness: 80 },
        {
          id: 'dirt-maker', state: 'seated', tableId: 't3', x: 220, y: 380,
          patience: 1000, happiness: 80, dirtFactor: 9.8,
        },
      ],
      serviceItems: [
        {
          id: 'manual-item', kind: 'dish', menuItemId: 'manual-dish', customerId: 'manual-owner', tableId: 't1',
          state: 'queued_for_wash', washStationId: 'manual-wash', washQueuedAt: 0,
        },
        {
          id: 'automatic-item', kind: 'dish', menuItemId: 'automatic-dish', customerId: 'automatic-owner', tableId: 't2',
          state: 'queued_for_wash', washStationId: 'automatic-wash', washQueuedAt: 0,
        },
      ],
      staff: [{
        id: 'janitor-1', role: 'janitor', morale: 80, salary: 120,
        x: 300, y: 100, task: null, carryingServiceItemId: null,
      }],
      floorDirt: [],
      dishes: [],
      unlockedDrinkIds: [],
      equipment: [],
    };

    const janitorWashClaims = new Set();
    let sawAutomaticWashing = false;
    let sawAutomaticCompletion = false;
    let sawManualWashing = false;
    let sawManualCompletion = false;
    let sawAutomaticCompleteWhileManualWashing = false;
    let previousManual = state.serviceItems.find(item => item.id === 'manual-item');
    let previousAutomatic = state.serviceItems.find(item => item.id === 'automatic-item');

    for (let tick = 0; tick < 600; tick += 1) {
      state = runTick(state, 1 / 60);
      const manual = state.serviceItems.find(item => item.id === 'manual-item');
      const automatic = state.serviceItems.find(item => item.id === 'automatic-item');
      const janitor = state.staff.find(staff => staff.id === 'janitor-1');
      if (janitor?.task?.type === 'wash_item') janitorWashClaims.add(janitor.task.serviceItemId);
      sawAutomaticWashing ||= automatic?.state === 'washing';
      sawManualWashing ||= manual?.state === 'washing';
      sawAutomaticCompletion ||= previousAutomatic?.state === 'washing' && !automatic;
      sawManualCompletion ||= previousManual?.state === 'washing' && !manual;
      sawAutomaticCompleteWhileManualWashing ||= sawAutomaticCompletion && manual?.state === 'washing';
      previousManual = manual;
      previousAutomatic = automatic;
      if (sawManualCompletion && state.floorDirt.length > 0
        && janitor?.task?.type === 'clean_floor'
        && janitor.task.dirtId === state.floorDirt[0].id) break;
    }

    expect(sawAutomaticWashing).toBe(true);
    expect(sawAutomaticCompletion).toBe(true);
    expect(sawManualWashing).toBe(true);
    expect(sawManualCompletion).toBe(true);
    expect(sawAutomaticCompleteWhileManualWashing).toBe(true);
    expect(janitorWashClaims).toEqual(new Set(['manual-item']));
    expect(state.floorDirt.length).toBeGreaterThan(0);
    expect(state.staff[0].task).toMatchObject({ type: 'clean_floor', dirtId: state.floorDirt[0].id });
  });

  it('credits each completed payment once without retaining or marking the consumed queue', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = {
      ...emptyState,
      restaurant: { ...emptyState.restaurant, funds: 500, dailyRevenue: 0 },
      completedCustomers: [{ customerId: 'c1', revenue: 12 }],
    };

    state = runTick(state, 0);
    expect(state.restaurant.funds).toBe(512);
    expect(state.restaurant.dailyRevenue).toBe(12);
    expect(state.completedCustomers).toEqual([]);
    expect(JSON.stringify(state)).not.toContain('revenueProcessed');

    state = runTick(state, 0);
    expect(state.restaurant.funds).toBe(512);
    expect(state.restaurant.dailyRevenue).toBe(12);
    expect(state.completedCustomers).toEqual([]);

    state = runTick({
      ...state,
      completedCustomers: [{ customerId: 'c2', revenue: 8 }],
    }, 0);
    expect(state.restaurant.funds).toBe(520);
    expect(state.restaurant.dailyRevenue).toBe(20);
    expect(state.completedCustomers).toEqual([]);
    expect(JSON.stringify(state)).not.toContain('revenueProcessed');

    state = runTick(state, 0);
    expect(state.restaurant.funds).toBe(520);
    expect(state.restaurant.dailyRevenue).toBe(20);
    expect(state.completedCustomers).toEqual([]);
  });
});

describe('queue overflow through the merged production pipeline', () => {
  it('keeps guiding and admitting parties with a hidden backlog, without invariants or false unreachable groups', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fixture = buildCustomerQueueStressState();
    const base = createInitialState();
    const queue = fixture.queue.map((party, partyIndex) => ({
      partyId: `merged-party-${partyIndex + 1}`,
      members: party.members.map((member, memberIndex) => ({
        ...member,
        id: `merged-${partyIndex + 1}-${memberIndex + 1}`,
        partyId: `merged-party-${partyIndex + 1}`,
      })),
    }));
    let state = {
      ...base,
      restaurant: { ...base.restaurant, gameTime: 12 * 3600 },
      queue,
      queueAdmissionGate: null,
    };
    const reconciledInitial = reconcileQueueSlots(state, state.queueSlots || []);
    const initialOwned = getQueueVisibleMembers(
      { ...state, queueSlots: reconciledInitial },
      state.queue,
    );
    expect(initialOwned).toHaveLength(9);
    expect(initialOwned.map(member => member.id))
      .toEqual(queue.flatMap(party => party.members).slice(0, 9).map(member => member.id));

    const statusesByTick = [];
    const staffByTick = [];
    for (let tick = 0; tick < 10; tick += 1) {
      // The movement batch is prepared from the queue as it stands after the
      // tick's ownership reconciliation (staff admission resolves only after
      // the batch). Reconcile is deterministic and is the only lease writer
      // between this pre-tick state and the batch, so the expected visible
      // band is the reconciled lease set.
      const reconciled = reconcileQueueSlots(state, state.queueSlots || []);
      const ownedMembers = getQueueVisibleMembers({ ...state, queueSlots: reconciled }, state.queue);
      const expectedVisible = new Set(ownedMembers.map(member => member.id));
      const expectedHidden = new Set(queue.flatMap(party => party.members).map(member => member.id)
        .filter(id => !expectedVisible.has(id)));
      state = runTick(state, { gameDt: 0, movementDt: 0.1 });
      const coordinator = state.movementCoordinator;
      expect(coordinator.diagnostics.invariantFailure).toBeUndefined();
      const stationaryQueueIds = new Set([...coordinator.requests]
        .filter(([id, request]) => request.speed === 0 && (expectedVisible.has(id) || expectedHidden.has(id)))
        .map(([id]) => id));
      expect(stationaryQueueIds).toEqual(expectedVisible);
      for (const id of stationaryQueueIds) {
        expect(coordinator.plans.get(id).every(action => action.from.x === action.to.x && action.from.y === action.to.y)).toBe(true);
      }
      const statuses = [...(coordinator.statuses?.values?.() || [])];
      statusesByTick.push(statuses);
      expect(statuses.every(status => !['unreachable', 'unschedulable'].includes(status.plan))).toBe(true);
      staffByTick.push(state.staff.map(worker => ({ id: worker.id, x: worker.x, y: worker.y })));
    }

    // The backlog is preserved while admission makes real progress.
    expect(state.queue.length).toBeGreaterThanOrEqual(5);
    // Some staff member physically progressed (the pipeline is not frozen).
    const first = staffByTick[0];
    const last = staffByTick.at(-1);
    expect(last.some((position, index) => {
      const before = first[index];
      return Math.hypot(position.x - before.x, position.y - before.y) > 1e-6;
    })).toBe(true);
    // No actor was ever terminalised as unreachable.
    expect(statusesByTick.flat().every(status => !['unreachable', 'unschedulable'].includes(status.plan)))
      .toBe(true);
  });

  it('keeps surviving and leaving queue members distinct across a partial abandonment', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fixture = buildCustomerQueueStressState();
    const base = createInitialState();
    const queue = fixture.queue.map((party, index) => ({
      partyId: `merged-party-${index + 1}`,
      members: party.members.map((member, memberIndex) => ({
        ...member,
        id: `merged-${index + 1}-${memberIndex + 1}`,
        partyId: `merged-party-${index + 1}`,
        queuePatience: index === 0 ? 0 : 100,
        queuePatienceMax: 100,
        patience: 100,
        patienceMax: 100,
      })),
    }));
    const seedIds = new Set(queue.flatMap(party => party.members).map(member => member.id));
    let state = {
      ...base,
      restaurant: { ...base.restaurant, gameTime: 12 * 3600 },
      queue,
      queueDepartures: [],
      queueAdmissionGate: null,
      customers: [],
      staff: fixture.staff,
      tables: fixture.tables,
      chairs: fixture.chairs,
      doors: fixture.doors,
    };

    for (let tick = 0; tick < 2; tick += 1) {
      state = runTick(state, { gameDt: 0, movementDt: 0.1 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      const retainedIds = new Set([
        ...state.queue.flatMap(party => party.members).map(member => member.id),
        ...state.queueDepartures.map(record => record.id),
        ...state.customers.map(customer => customer.id),
      ]);
      expect(retainedIds.size).toBe(32);
      for (const id of seedIds) expect(retainedIds.has(id)).toBe(true);
      const physical = [
        ...state.customers,
        ...state.staff,
        ...getQueueVisibleMembers(state, state.queue),
      ].filter(actor => actor?.id != null && Number.isFinite(actor.x) && Number.isFinite(actor.y));
      expect(minimumPhysicalSpacing(physical)).toBeGreaterThanOrEqual(16);
      // Door-gated leavers waiting their turn are not unreachable: only the
      // admitted leaver carries the active door goal.
      const statuses = [...(state.movementCoordinator.statuses?.values?.() || [])];
      expect(statuses.every(status => !['unreachable', 'unschedulable'].includes(status.plan)))
        .toBe(true);
      for (const customer of state.customers) {
        if (customer.state !== 'leaving' || customer.exitPhase === 'fading') continue;
        const status = state.movementCoordinator.statuses?.get(customer.id);
        const waiting = !status || status.plan === 'arrived';
        if (waiting) expect(Number.isFinite(customer.navigationGoal?.x)).toBe(false);
        expect(customer.exitDoorId).not.toBeNull();
      }
    }
    // The first party left as physical leavers at their exact standing points.
    expect(state.customers.filter(customer => customer.partyId === 'merged-party-1')).toHaveLength(4);
    // A free staging area admits the next party without stealing any leaver's
    // standing position. The other six parties retain their logical FIFO order.
    expect(state.queue.length).toBe(6);
    expect(state.customers.filter(customer => customer.partyId === 'merged-party-2'
      && customer.state === 'guided')).toHaveLength(4);

    // The queue-origin leavers still own their origins: no survivor or hidden
    // member has been relocated onto a leaver's slot, so the leavers clear and
    // the survivors keep standing until their own transition. A hidden member
    // may legally gain a new lease only at a slot freed after a leaver clears.
    const firstSeenPositions = new Map();
    for (let tick = 0; tick < 400; tick += 1) {
      state = runTick(state, { gameDt: 0, movementDt: 0.1 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      for (const member of getQueueVisibleMembers(state, state.queue)) {
        if (state.queue.flatMap(party => party.members).some(candidate => candidate.id === member.id)) {
          const seen = firstSeenPositions.get(member.id);
          if (seen === undefined) {
            firstSeenPositions.set(member.id, `${member.x},${member.y}`);
          } else {
            expect(seen).toBe(`${member.x},${member.y}`);
          }
        }
      }
      const physical = [
        ...state.customers,
        ...state.staff,
        ...getQueueVisibleMembers(state, state.queue),
      ].filter(actor => actor?.id != null && Number.isFinite(actor.x) && Number.isFinite(actor.y));
      expect(minimumPhysicalSpacing(physical)).toBeGreaterThanOrEqual(16);
      if (state.customers.every(customer => customer.partyId !== 'merged-party-1')) break;
    }
    expect(state.customers.every(customer => customer.partyId !== 'merged-party-1'), JSON.stringify({
      customers: state.customers.map(({ id, x, y, navigationGoal, exitPhase }) => ({ id, x, y, navigationGoal, exitPhase })),
      statuses: [...state.movementCoordinator.statuses],
    })).toBe(true);
  });

  it('never lets a new arrival coincide with an uncleared queue-origin leaver during staging', () => {
    const fixture = buildCustomerQueueStressState();
    const base = createInitialState();
    const queue = fixture.queue.map((party, index) => ({
      partyId: `merged-party-${index + 1}`,
      members: party.members.map((member, memberIndex) => ({
        ...member,
        id: `merged-${index + 1}-${memberIndex + 1}`,
        partyId: `merged-party-${index + 1}`,
        queuePatience: 0,
        queuePatienceMax: 100,
        patience: 100,
        patienceMax: 100,
      })),
    }));
    const seedIds = new Set(queue.flatMap(party => party.members).map(member => member.id));
    let state = {
      ...base,
      restaurant: { ...base.restaurant, gameTime: 12 * 3600 },
      queue,
      queueDepartures: [],
      queueAdmissionGate: null,
      customers: [],
      staff: fixture.staff,
      tables: fixture.tables,
      chairs: fixture.chairs,
      doors: fixture.doors,
    };
    // Decision tick: spawning disabled, every party abandons into staged records.
    vi.spyOn(Math, 'random').mockReturnValue(1);
    state = runTick(state, { gameDt: 0, movementDt: 0.1 });
    expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
    expect(state.queueDepartures.length).toBeGreaterThan(0);
    const leaversAfterDecision = state.customers.length;
    // Door-gated leavers waiting for admission carry no active goal, so their
    // intentional wait is not reported as an unreachable public status.
    const decisionStatuses = [...(state.movementCoordinator.statuses?.values?.() || [])];
    expect(decisionStatuses.every(status => !['unreachable', 'unschedulable'].includes(status.plan)))
      .toBe(true);

    // New-arrival tick: a fresh party spawns while the leavers still own their origins.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    state = runTick(state, { gameDt: 1, movementDt: 0.1 });
    expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
    const arrivalStatuses = [...(state.movementCoordinator.statuses?.values?.() || [])];
    expect(arrivalStatuses.every(status => !['unreachable', 'unschedulable'].includes(status.plan)))
      .toBe(true);
    for (const customer of state.customers) {
      if (customer.state !== 'leaving' || customer.exitPhase === 'fading') continue;
      const status = state.movementCoordinator.statuses?.get(customer.id);
      const waiting = !status || status.plan === 'arrived';
      if (waiting) expect(Number.isFinite(customer.navigationGoal?.x)).toBe(false);
      expect(customer.exitDoorId).not.toBeNull();
    }
    const idsAfterSpawn = new Set([
      ...state.queue.flatMap(party => party.members).map(member => member.id),
      ...state.queueDepartures.map(record => record.id),
      ...state.customers.map(customer => customer.id),
    ]);
    expect(idsAfterSpawn.size).toBe(33);
    for (const id of seedIds) expect(idsAfterSpawn.has(id)).toBe(true);
    const newIds = [...idsAfterSpawn].filter(id => !seedIds.has(id));
    expect(newIds).toHaveLength(1);
    const physical = [
      ...state.customers,
      ...state.staff,
      ...getQueueVisibleMembers(state, state.queue),
    ].filter(actor => actor?.id != null && Number.isFinite(actor.x) && Number.isFinite(actor.y));
    expect(minimumPhysicalSpacing(physical)).toBeGreaterThanOrEqual(16);
    // Queue-origin leases remain occupied, but a distinct admission staging
    // position can safely materialise the new arrival beside those leavers.
    expect(state.customers.find(customer => newIds.includes(customer.id)).state).toBe('guided');
    expect(getQueueVisibleMembers(state, state.queue).some(member => newIds.includes(member.id)))
      .toBe(false);
    expect(state.customers.filter(customer => seedIds.has(customer.id))).toHaveLength(leaversAfterDecision);
    expect(state.customers.length).toBe(leaversAfterDecision + 1);
  });

  it('keeps new arrivals logical while every candidate is held and claims only safe holes later', () => {
    const fixture = buildCustomerQueueStressState();
    const base = createInitialState();
    const queue = fixture.queue.map((party, index) => ({
      partyId: `merged-party-${index + 1}`,
      members: party.members.map((member, memberIndex) => ({
        ...member,
        id: `merged-${index + 1}-${memberIndex + 1}`,
        partyId: `merged-party-${index + 1}`,
        queuePatience: 0,
        queuePatienceMax: 100,
        patience: 100,
        patienceMax: 100,
      })),
    }));
    let state = {
      ...base,
      restaurant: { ...base.restaurant, gameTime: 12 * 3600 },
      queue,
      queueDepartures: [],
      queueAdmissionGate: null,
      customers: [],
      staff: fixture.staff,
      tables: [],   // no seatable table: the queue can only interact physically
      chairs: [],
      doors: fixture.doors,
    };
    vi.spyOn(Math, 'random').mockReturnValue(1);
    state = runTick(state, { gameDt: 0, movementDt: 0.1 });
    expect(state.queueDepartures.length).toBeGreaterThan(0);

    // A four-member party arrives while all nine origins are still owned by
    // uncleared queue-origin leavers.
    const arrival = {
      partyId: 'arrival-party',
      members: [1, 2, 3, 4].map(index => ({
        id: `arrival-${index}`,
        partyId: 'arrival-party',
        partySize: 4,
        state: 'queued',
        patience: 100,
        happiness: 80,
        queuePatience: 100,
        queuePatienceMax: 100,
        dishId: null,
        drinkId: null,
        tableId: null,
        chairId: null,
      })),
    };
    state = { ...state, queue: [...state.queue, arrival] };
    const arrivalIds = new Set(arrival.members.map(member => member.id));

    // While the leavers still block their origins the arrivals stay logical.
    for (let tick = 0; tick < 5; tick += 1) {
      state = runTick(state, { gameDt: 0, movementDt: 0.05 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      expect(getQueueVisibleMembers(state, state.queue).some(member => arrivalIds.has(member.id)))
        .toBe(false);
      expect(state.customers.some(customer => arrivalIds.has(customer.id))).toBe(false);
    }

    // As leavers clear their origins the arrivals claim only safe holes.
    let claimsSeen = 0;
    for (let tick = 0; tick < 4000; tick += 1) {
      state = runTick(state, { gameDt: 0, movementDt: 0.5 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      claimsSeen = Math.max(claimsSeen,
        getQueueVisibleMembers(state, state.queue).filter(member => arrivalIds.has(member.id)).length);
      const physical = [
        ...state.customers,
        ...state.staff,
        ...getQueueVisibleMembers(state, state.queue),
      ].filter(actor => actor?.id != null && Number.isFinite(actor.x) && Number.isFinite(actor.y));
      expect(minimumPhysicalSpacing(physical)).toBeGreaterThanOrEqual(16);
      if (claimsSeen === 4) break;
    }
    expect(claimsSeen).toBe(4);
  });
});

// The movement kernel exempts only genuinely authorised guide formations: a
// guided customer and its own guide staff, or guided customers of the same
// party under the same guide task. Every other pair (queue, leaver,
// new-arrival, admission, unrelated guided parties) stays strictly >= 16.
function isAuthorisedGuideFormationPair(left, right) {
  if (left.role || right.role) {
    const staff = left.role ? left : right;
    const guided = left.role ? right : left;
    return guided?.state === 'guided' && guided.guideStaffId === staff.id;
  }
  return left.state === 'guided' && right.state === 'guided'
    && left.guideStaffId != null
    && left.guideStaffId === right.guideStaffId
    && left.partyId === right.partyId;
}

function minimumPhysicalSpacing(actors) {
  let minimum = Infinity;
  for (let left = 0; left < actors.length; left += 1) {
    for (let right = left + 1; right < actors.length; right += 1) {
      if (isAuthorisedGuideFormationPair(actors[left], actors[right])) continue;
      minimum = Math.min(minimum, Math.hypot(
        actors[left].x - actors[right].x,
        actors[left].y - actors[right].y,
      ));
    }
  }
  return minimum;
}

describe('queue-lease occupancy is respected by the missing-coordinate guided materialiser', () => {
  function missingCoordinateGuideFixture() {
    const fixture = buildCustomerQueueStressState();
    const base = createInitialState();
    return {
      ...base,
      restaurant: { ...base.restaurant, gameTime: 12 * 3600 },
      queue: [{
        partyId: 'p',
        members: [{
          id: 'q', partyId: 'p', partySize: 1, state: 'queued', patience: 100,
          happiness: 80, dishId: null, drinkId: null, tableId: null, chairId: null,
          queuePatience: 100, queuePatienceMax: 100,
        }],
      }],
      queueSlots: [{ memberId: 'q', partyId: 'p', x: 973, y: 390, slot: 0 }],
      queueDepartures: [],
      queueAdmissionGate: null,
      customers: [{
        id: 'legacy-guided', partyId: 'guided-party', state: 'guided',
        guideStaffId: 'queue-guide', tableId: 'queue-table', x: 973,
        dishId: null, drinkId: null, chairId: null, patience: 100, happiness: 80,
      }],
      staff: fixture.staff.map(worker => ({
        ...worker,
        task: {
          type: 'guide_customer',
          customerId: 'legacy-guided',
          customerIds: ['legacy-guided'],
          partyId: 'guided-party',
          tableId: 'queue-table',
          stage: 'follow_guide',
          approaches: [],
        },
      })),
      tables: fixture.tables.map(table => ({
        ...table,
        status: 'reserved',
        reservationOwnerStaffId: 'queue-guide',
      })),
      chairs: fixture.chairs,
      doors: fixture.doors.map(door => ({ ...door, y: 370 })),
      serviceItems: [],
      floorDirt: [],
    };
  }

  function physicalActors(state) {
    return [
      ...(state.customers || []),
      ...(state.staff || []),
      ...getQueueVisibleMembers(state, state.queue),
    ].filter(actor => actor?.id != null && Number.isFinite(actor.x) && Number.isFinite(actor.y));
  }

  it('merged production ticks never place the guided customer on the standing lease', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = missingCoordinateGuideFixture();
    for (let tick = 0; tick < 2; tick += 1) {
      state = runTick(state, { gameDt: 0, movementDt: 0.1 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      expect(state.queueSlots).toEqual([{ memberId: 'q', partyId: 'p', x: 973, y: 390, slot: 0 }]);
      expect(minimumPhysicalSpacing(physicalActors(state))).toBeGreaterThanOrEqual(16);
      const guided = state.customers.find(customer => customer.id === 'legacy-guided');
      expect(guided).toBeDefined();
      if (Number.isFinite(guided.y)) expect(Math.abs(guided.y - 390)).toBeGreaterThanOrEqual(16);
    }
  });

  it('standalone staff updates respect the same canonical lease occupancy', () => {
    let state = missingCoordinateGuideFixture();
    for (let tick = 0; tick < 2; tick += 1) {
      state = staffDomain.updateStaff(state, { gameDt: 0, movementDt: 0.1 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      expect(state.queueSlots).toEqual([{ memberId: 'q', partyId: 'p', x: 973, y: 390, slot: 0 }]);
      expect(minimumPhysicalSpacing(physicalActors(state))).toBeGreaterThanOrEqual(16);
    }
  });

  it('the hydrated fixture keeps queue spacing through the two preparation phases', () => {
    const fixture = missingCoordinateGuideFixture();
    saveState(fixture);
    let state = hydrateState(loadState(), createInitialState());
    expect(state.queueSlots).toEqual([{ memberId: 'q', partyId: 'p', x: 973, y: 390, slot: 0 }]);
    state = customerDomain.prepareCustomersForMovement(state, 0);
    state = staffDomain.prepareStaffForMovement(state, 0);
    expect(state.queueSlots).toEqual([{ memberId: 'q', partyId: 'p', x: 973, y: 390, slot: 0 }]);
    expect(minimumPhysicalSpacing(physicalActors(state))).toBeGreaterThanOrEqual(16);
    const guided = state.customers.find(customer => customer.id === 'legacy-guided');
    expect(guided).toBeDefined();
    expect(Math.abs(guided.y - 390)).toBeGreaterThanOrEqual(16);
  });
});
