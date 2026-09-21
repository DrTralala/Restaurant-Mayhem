import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../../state/initialState';
import { GameProvider, useDispatch, useGameState } from '../../state/GameContext';
import { runTick } from '../gameLoop';
import { updateStaff } from '../staff';
import { recordSeatResidency } from '../movement/seatedDeparture';
import { getQueueProjectedMembers } from '../customerQueue';
import { createGrid } from './grid';
import {
  finitePoint,
  physicalActors,
  positionAvailable,
  spatialIssues,
} from './occupancy';
import { allocateStaffPositions } from './staffAllocation';
import { getRestaurantWorld, GRID_SIZE } from '../world';
import {
  validateFixtureCopies,
  validateFixtureMoves,
  validatePlacement,
} from '../placement';
import { moveFixtures } from '../../state/fixtureMoves';
import { hydrateState, loadState, saveState } from '../../state/persistence';
import { movementSaveSnapshot } from '../../state/movementPersistence';
import { validateSavedState } from '../../state/saveValidation';
import { createMovementCoordinator } from '../movement';
import { createEmptyAmenitySlots, getAmenityGeometry } from '../../data/staffAmenities';
import { resolveStaffWellbeingAfterMovement } from '../staffWellbeing';

function BoundaryHarness({ current }) {
  const state = useGameState();
  const dispatch = useDispatch();
  current.state = state;
  current.dispatch = dispatch;
  return null;
}

function renderGame(overrides = {}) {
  localStorage.clear();
  const current = {};
  const fresh = createInitialState();
  const state = {
    ...fresh,
    ...overrides,
    restaurant: { ...fresh.restaurant, ...(overrides.restaurant || {}) },
  };
  render(<GameProvider><BoundaryHarness current={current} /></GameProvider>);
  act(() => current.dispatch({ type: 'LOAD_STATE', state }));
  return {
    get state() {
      return current.state;
    },
    dispatch(action) {
      act(() => current.dispatch(action));
    },
  };
}

function minimalState(staff = []) {
  return {
    restaurant: { expansionLevel: 1, gameTime: 12 * 3600, funds: 600 },
    tables: [],
    chairs: [],
    doors: [{ id: 'entrance', y: 340, role: 'entrance' }],
    cashierStations: [],
    kitchenStations: [],
    serviceTables: [],
    washStations: [],
    staffAmenities: [],
    staff,
    customers: [],
    queue: [],
    queueSlots: [],
    serviceItems: [],
    dishes: [],
    unlockedDrinkIds: [],
    completedCustomers: [],
    pendingPartyReviews: [],
    partyReviewHistory: [],
    floorDirt: [],
    paused: false,
    speed: 1,
  };
}

function candidateFloorPoints(state) {
  const world = getRestaurantWorld(state.restaurant || {});
  const points = [];
  for (let y = Math.ceil(world.diningY / GRID_SIZE) * GRID_SIZE;
    y <= world.kitchenY + world.floorH; y += GRID_SIZE) {
    for (let x = Math.ceil(world.floorX / GRID_SIZE) * GRID_SIZE;
      x < world.doorX; x += GRID_SIZE) {
      points.push({ x, y });
    }
  }
  return points;
}

function exhaustedState() {
  const state = minimalState();
  const preferred = { x: 480, y: 360 };
  state.tables = [{ id: 'blocked-table', status: 'empty', x: 480, y: 340 }];
  const blockers = candidateFloorPoints(state).map((point, index) => ({
    id: `blocker-${index}`,
    role: 'waiter',
    x: point.x,
    y: point.y,
    task: null,
  }));
  return {
    ...state,
    staff: [...blockers, { id: 'unplaced', role: 'waiter', x: null, y: null, task: null }],
    customers: [{ id: 'preferred-blocker', x: preferred.x, y: preferred.y, state: 'idle' }],
  };
}

function stationarySeatState(stateName = 'seated') {
  const table = { id: 'stationary-table', seats: 4, status: 'occupied', x: 200, y: 200 };
  const chair = { id: 'stationary-chair', tableId: table.id, x: 180, y: 200, rotation: 0 };
  const customer = {
    id: 'stationary-customer', partyId: 'stationary-party', state: stateName,
    chairId: chair.id, tableId: table.id, x: 190, y: 210,
  };
  return {
    ...minimalState([{ id: 'staff', role: 'waiter', x: 100, y: 100, task: null }]),
    tables: [table],
    chairs: [chair],
    customers: [{ ...customer, ...recordSeatResidency(customer, chair, table) }],
  };
}

describe('shared navigation boundaries', () => {
  beforeEach(() => localStorage.clear());

  it('T2 allocates missing workers deterministically around blocked defaults', () => {
    const initial = createInitialState();
    expect(initial.staff.find(worker => worker.id === 'starter-janitor'))
      .toMatchObject({ x: 580, y: 360 });

    const state = minimalState([
      { id: 'retained', role: 'cook', x: 100, y: 100, task: null },
      { id: 'worker-b', role: 'waiter', x: null, y: null, task: null },
      { id: 'worker-a', role: 'waiter', x: null, y: null, task: null },
    ]);
    state.tables = [{ id: 'blocking-table', status: 'empty', x: 500, y: 340 }];

    const allocated = allocateStaffPositions(state);
    expect(allocated).not.toBeNull();
    expect(allocated.slice(1).every(worker => createGrid({ ...state, staff: allocated }).isOpen(worker)))
      .toBe(true);
    expect(Math.hypot(
      allocated[1].x - allocated[2].x,
      allocated[1].y - allocated[2].y,
    )).toBeGreaterThanOrEqual(16);
    expect(allocated[0]).toEqual(state.staff[0]);

    const reversed = allocateStaffPositions({
      ...state,
      staff: [state.staff[0], state.staff[2], state.staff[1]],
    });
    expect(reversed).not.toBeNull();
    expect(reversed.every(worker => createGrid({ ...state, staff: reversed }).isOpen(worker)
      && (worker.id === 'retained' || finitePoint(worker)))).toBe(true);
    expect(allocateStaffPositions({
      ...state,
      staff: [state.staff[0], state.staff[2], state.staff[1]],
    })).toEqual(reversed);
  });

  it('T1 materialises a replacement at the reused starter index after a real fire and hire flow', () => {
    const game = renderGame();
    game.dispatch({ type: 'FIRE_STAFF', id: 'starter-janitor' });
    expect(game.state.staff.some(worker => worker.id === 'starter-janitor')).toBe(false);

    game.dispatch({ type: 'HIRE_STAFF', staff: { id: 'replacement-janitor', role: 'janitor' } });

    const replacement = game.state.staff.find(worker => worker.id === 'replacement-janitor');
    expect(replacement).toMatchObject({ x: 580, y: 360 });
    expect(game.state.staff.filter(worker => worker.id !== replacement.id)
      .every(worker => Math.hypot(worker.x - replacement.x, worker.y - replacement.y) >= 16)).toBe(true);
    expect(spatialIssues(runTick(game.state, { gameDt: 1, movementDt: 0 }))).toEqual([]);
  });

  it('T2 accepts exact sixteen-unit clearance and rejects a fifteen-point-nine-nine-nine gap', () => {
    const state = minimalState([{ id: 'anchor', role: 'waiter', x: 100, y: 100 }]);
    expect(positionAvailable(state, { x: 116, y: 100 }, 'candidate')).toBe(true);
    expect(positionAvailable(state, { x: 115.999, y: 100 }, 'candidate')).toBe(false);
  });

  it('T3 ignores blocked or overlapping finite coordinates during successful safe hire materialisation', () => {
    for (const [id, getPoint] of [
      ['blocked-hire', state => ({ x: state.tables[0].x + 10, y: state.tables[0].y + 10 })],
      ['overlapping-hire', state => ({ x: state.staff[0].x, y: state.staff[0].y })],
    ]) {
      const game = renderGame();
      const before = game.state;
      const funds = before.restaurant.funds;
      const unsafe = getPoint(before);

      game.dispatch({
        type: 'HIRE_STAFF',
        staff: { id, role: 'waiter', x: unsafe.x, y: unsafe.y },
      });

      expect(game.state.restaurant.funds).toBe(funds - 150);
      const hired = game.state.staff.find(worker => worker.id === id);
      expect(hired).toBeDefined();
      expect(finitePoint(hired)).toBe(true);
      expect(createGrid(game.state).isOpen(hired)).toBe(true);
      expect(game.state.staff
        .filter(worker => worker.id !== hired.id)
        .every(worker => !finitePoint(worker)
          || Math.hypot(worker.x - hired.x, worker.y - hired.y) >= 16)).toBe(true);
      expect(before.staff.find(worker => worker.id === 'starter-cook')).toMatchObject({ x: 90, y: 100 });
      expect(spatialIssues(runTick(game.state, { gameDt: 0, movementDt: 0 }))).toEqual([]);
    }
  });

  it('T3 rejects both unsafe finite coordinates atomically when hire capacity is exhausted', () => {
    for (const [id, point] of [
      ['blocked-exhausted-hire', { x: 490, y: 350 }],
      ['overlapping-exhausted-hire', { x: 60, y: 100 }],
    ]) {
      const exhausted = exhaustedState();
      const game = renderGame(exhausted);
      const before = game.state;

      game.dispatch({ type: 'HIRE_STAFF', staff: { id, role: 'waiter', ...point } });

      expect(game.state).toBe(before);
      expect(game.state.restaurant.funds).toBe(before.restaurant.funds);
      expect(game.state.staff).toEqual(before.staff);
    }
  });

  it('T4 rejects duplicate staff, customer, and logical queue IDs without charging', () => {
    const duplicateCases = [
      { id: 'starter-cook', customers: [], queue: [] },
      { id: 'active-customer', customers: [{ id: 'active-customer', state: 'seated', x: 200, y: 100 }], queue: [] },
      { id: 'queued-member', customers: [], queue: [{ partyId: 'party', members: [{ id: 'queued-member', partyId: 'party' }] }] },
    ];

    for (const duplicate of duplicateCases) {
      const game = renderGame({ customers: duplicate.customers, queue: duplicate.queue });
      const before = game.state;
      game.dispatch({ type: 'HIRE_STAFF', staff: { id: duplicate.id, role: 'waiter' } });
      expect(game.state).toBe(before);
      expect(game.state.restaurant.funds).toBe(before.restaurant.funds);
    }
  });

  it('T4 keeps an unleased logical queue member as display overflow but not a physical blocker', () => {
    const queueState = minimalState([{ id: 'staff', role: 'waiter', x: 100, y: 100 }]);
    queueState.queue = [
      { partyId: 'visible-party', members: [{ id: 'visible', partyId: 'visible-party' }] },
      { partyId: 'overflow-party', members: [{ id: 'overflow', partyId: 'overflow-party' }] },
    ];
    queueState.queueSlots = [
      { memberId: 'visible', partyId: 'visible-party', x: 900, y: 100 },
      { memberId: 'orphan', partyId: 'orphan-party', x: 100, y: 100 },
    ];

    expect(getQueueProjectedMembers(queueState, queueState.queue)).toEqual([
      expect.objectContaining({ id: 'visible', x: 900, y: 100 }),
      expect.objectContaining({ id: 'overflow', x: 973, y: 648 }),
    ]);
    expect(physicalActors(queueState).map(actor => actor.id)).toEqual(['staff', 'visible']);
  });

  it('T4 rejects retained-departure IDs as duplicate hires without charging', () => {
    const game = renderGame({
      queueDepartures: [{ id: 'retained-departure', partyId: 'party', departureReason: 'abandoned' }],
    });
    const before = game.state;

    game.dispatch({ type: 'HIRE_STAFF', staff: { id: 'retained-departure', role: 'waiter' } });

    expect(game.state).toBe(before);
    expect(game.state.restaurant.funds).toBe(before.restaurant.funds);
  });

  it('T4 accepts a canonical stationary seated residency without a movement connector', () => {
    for (const stateName of ['seated', 'ordering', 'waiting_for_party', 'checkout_moving']) {
      expect(spatialIssues(stationarySeatState(stateName))).toEqual([]);
    }
  });

  it('T4 reports a blocked start when stationary occupancy has a malformed departure connector', () => {
    const state = stationarySeatState();
    const customer = state.customers[0];
    state.customers = [{
      ...customer,
      seatResidency: {
        ...customer.seatResidency,
        phase: 'departing',
        connector: {
          from: { x: customer.x, y: customer.y },
          to: { x: 999, y: 999 },
          fraction: 0,
        },
      },
    }];

    expect(spatialIssues(state)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'blocked-start', ids: ['stationary-customer'] }),
    ]));
  });

  it('T2 does not allocate a duplicate-ID worker onto its finite duplicate', () => {
    const state = minimalState([
      { id: 'same-worker', role: 'waiter', x: 505, y: 360, task: null },
      { id: 'same-worker', role: 'waiter', x: null, y: null, task: null },
    ]);

    const allocated = allocateStaffPositions(state);

    expect(allocated).not.toBeNull();
    expect(Math.hypot(
      allocated[0].x - allocated[1].x,
      allocated[0].y - allocated[1].y,
    )).toBeGreaterThanOrEqual(16);
  });

  it('T5 allocates staff before completing the queued admission transaction', () => {
    const state = createInitialState();
    state.staff = state.staff.map((worker, index) => index === 0
      ? { ...worker, x: null, y: null }
      : worker);
    state.queue = [{ partyId: 'ready-party', members: [{ id: 'ready-member', partyId: 'ready-party' }] }];

    const admitted = runTick(state, { gameDt: 0, movementDt: 0 });
    expect(admitted.staff[0]).toMatchObject({ x: 90, y: 100 });
    expect(admitted.queue).toEqual([]);
    expect(admitted.customers).toEqual([
      expect.objectContaining({
        id: 'ready-member', state: 'entering', tableId: 't1', chairId: expect.any(String),
      }),
    ]);
    expect(admitted.tables.find(table => table.id === 't1')).toMatchObject({
      status: 'reserved', diningPartyId: 'ready-party', diningCustomerIds: ['ready-member'],
    });
    expect(admitted.queueAdmissionGate).toMatchObject({
      partyId: 'ready-party', customerIds: ['ready-member'], tableId: 't1', doorId: 'door1',
    });

  });

  it('T5 quarantines visible unplaced staff before spawn or admission on exhaustion', () => {
    const exhausted = exhaustedState();
    const exhaustedSnapshot = JSON.parse(JSON.stringify(exhausted));
    expect(allocateStaffPositions(exhausted)).toBeNull();
    expect(exhausted).toEqual(exhaustedSnapshot);

    const blockedHire = renderGame(exhausted);
    const blockedBefore = blockedHire.state;
    blockedHire.dispatch({ type: 'HIRE_STAFF', staff: { id: 'blocked-hire', role: 'waiter' } });
    expect(blockedHire.state).toBe(blockedBefore);
    expect(blockedHire.state.restaurant.funds).toBe(blockedBefore.restaurant.funds);
    expect(blockedHire.state.staff).toEqual(blockedBefore.staff);

    exhausted.queue = [{ partyId: 'blocked-party', members: [{ id: 'blocked-member', partyId: 'blocked-party' }] }];
    const quarantined = runTick(exhausted, { gameDt: 0, movementDt: 0 });
    expect(quarantined).toMatchObject({ paused: true, navigationFault: { kind: 'unsafe-navigation-state' } });
    expect(quarantined.navigationFault.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unplaced-staff', ids: ['unplaced'] }),
    ]));
    expect(quarantined.customers).toEqual(exhausted.customers);
    expect(quarantined.queue).toEqual(exhausted.queue);

    const standalone = updateStaff(exhausted, { gameDt: 0, movementDt: 0 });
    expect(standalone).toMatchObject({ paused: true, navigationFault: { kind: 'unsafe-navigation-state' } });
    expect(standalone.staff.at(-1)).toMatchObject({ id: 'unplaced', x: null, y: null });
  });
});

describe('S2 atomic editing boundaries', () => {
  it('T6 rejects placement, copy, and move into a janitor cell without charging or mutating', () => {
    const state = minimalState([
      { id: 'janitor', role: 'janitor', x: 500, y: 300, task: null },
    ]);
    state.tables = [{ id: 'source-table', seats: 4, status: 'empty', x: 200, y: 200 }];

    expect(validatePlacement(state, { itemType: 'table', x: 500, y: 300 }))
      .toMatchObject({ valid: false, reason: 'actor-occupied' });
    expect(validateFixtureMoves(state, [{ type: 'table', id: 'source-table', x: 500, y: 300 }]))
      .toMatchObject({ valid: false, reason: 'actor-occupied' });
    expect(validateFixtureCopies(state, [{ type: 'table', id: 'source-table', x: 500, y: 300 }]))
      .toMatchObject({ valid: false, reason: 'actor-occupied' });

    const game = renderGame(state);
    const before = game.state;
    game.dispatch({
      type: 'PLACE_ITEM', itemType: 'table', x: 500, y: 300, rotation: 0,
    });
    expect(game.state).toBe(before);
    expect(game.state.restaurant.funds).toBe(state.restaurant.funds);

    expect(validatePlacement(state, { itemType: 'table', x: 540, y: 300 }))
      .toMatchObject({ valid: true });
    expect(validateFixtureMoves(state, [{ type: 'table', id: 'source-table', x: 540, y: 300 }]))
      .toMatchObject({ valid: true });
    expect(validateFixtureCopies(state, [{ type: 'table', id: 'source-table', x: 540, y: 300 }]))
      .toMatchObject({ valid: true });
  });

  it.each(['seated', 'waiting_for_party'])(
    'T7 audits the translated %s customer before committing an occupied-table move', stateName => {
      const base = stationarySeatState(stateName);
      const unsafe = {
        ...base,
        staff: [{ id: 'stationary-worker', role: 'waiter', x: 300, y: 310, task: null }],
      };
      const moves = [
        { type: 'table', id: 'stationary-table', x: 300, y: 300 },
        { type: 'chair', id: 'stationary-chair', x: 280, y: 300, rotation: 0 },
      ];
      const before = structuredClone(unsafe);

      expect(validateFixtureMoves(unsafe, moves))
        .toMatchObject({ valid: false, reason: 'actor-occupied' });
      expect(unsafe).toEqual(before);
      expect(moveFixtures(unsafe, moves)).toBe(unsafe);

      const legal = {
        ...base,
        staff: [{ id: 'stationary-worker', role: 'waiter', x: 290, y: 330, task: null }],
      };
      const moved = moveFixtures(legal, moves);
      expect(moved).not.toBe(legal);
      expect(moved.customers[0]).toMatchObject({ x: 290, y: 310, tableId: 'stationary-table' });
      expect(moved.customers[0].seatResidency).toMatchObject({
        phase: 'seated', position: { x: 290, y: 310 },
      });
    },
  );

  it('T9 retains an unrelated prior overlap while clearing the final fault only after both repairs', () => {
    const state = minimalState([
      { id: 'worker-a', role: 'waiter', x: 100, y: 100, task: null },
      { id: 'worker-b', role: 'waiter', x: 110, y: 100, task: null },
      { id: 'worker-c', role: 'janitor', x: 300, y: 300, task: null },
      { id: 'worker-d', role: 'cook', x: 310, y: 300, task: null },
    ]);
    state.paused = true;
    state.navigationFault = {
      kind: 'unsafe-navigation-state',
      issues: spatialIssues(state),
    };
    const game = renderGame(state);

    game.dispatch({ type: 'MOVE_STAFF', id: 'worker-a', x: 100, y: 140 });
    expect(game.state.paused).toBe(true);
    expect(game.state.navigationFault.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'actor-overlap', ids: ['worker-c', 'worker-d'] }),
    ]));
    expect(game.state.navigationFault.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'actor-overlap', ids: ['worker-a', 'worker-b'] }),
    ]));

    game.dispatch({ type: 'MOVE_STAFF', id: 'worker-c', x: 300, y: 340 });
    expect(game.state.paused).toBe(true);
    expect(game.state).not.toHaveProperty('navigationFault');
  });
});

describe('S3 hydration and save boundaries', () => {
  it('T10 accepts an overlapping version-10 payload for validation, then quarantines it without dropping IDs', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff: fresh.staff.map(worker => ['starter-cook', 'starter-host'].includes(worker.id)
        ? { ...worker, x: 500, y: 300 }
        : worker),
    };

    expect(() => validateSavedState(saved)).not.toThrow();
    const restored = hydrateState(saved, fresh);
    expect(restored).toMatchObject({ paused: true, navigationFault: { kind: 'unsafe-navigation-state' } });
    expect(restored.staff.map(worker => worker.id)).toEqual(saved.staff.map(worker => worker.id));
    expect(restored.navigationFault.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'actor-overlap', ids: ['starter-cook', 'starter-host'] }),
    ]));
  });

  it('T10 quarantines an unprojectable seat-resident customer after validation accepts the payload', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      customers: [{
        id: 'unplaced-customer', state: 'seated', tableId: 't1', chairId: 'ch1',
      }],
    };

    expect(() => validateSavedState(saved)).not.toThrow();
    const restored = hydrateState(saved, fresh);
    expect(restored).toMatchObject({ paused: true, navigationFault: { kind: 'unsafe-navigation-state' } });
    expect(restored.customers).toEqual([
      expect.objectContaining({ id: 'unplaced-customer', state: 'seated' }),
    ]);
    expect(restored.navigationFault.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unplaced-customer', ids: ['unplaced-customer'] }),
    ]));
  });

  it('T11 preserves a canonical processing checkout, receipt history, and ownership without a fault', () => {
    const fresh = createInitialState();
    const station = fresh.cashierStations[0];
    const waiter = fresh.staff.find(worker => worker.id === station.assignedStaffId);
    const saved = {
      ...fresh,
      customers: [{
        id: 'canonical-processing', partyId: 'canonical-party', state: 'checkout_processing',
        cashierStationId: station.id, x: 820, y: 180,
        checkoutPosition: { x: 820, y: 180 }, paymentReady: false,
      }],
      staff: fresh.staff.map(worker => worker.id === waiter.id
        ? {
          ...worker, x: 820, y: 100,
          task: { type: 'take_payment', customerId: 'canonical-processing', stationId: station.id },
        }
        : worker),
      completedCustomers: [{ customerId: 'already-paid', revenue: 12 }],
    };

    expect(() => validateSavedState(saved)).not.toThrow();
    const restored = hydrateState(saved, fresh);
    expect(restored).not.toHaveProperty('navigationFault');
    expect(restored.customers[0]).toMatchObject({
      id: 'canonical-processing', state: 'checkout_processing', x: 820, y: 180,
    });
    expect(restored.staff.find(worker => worker.id === waiter.id)).toMatchObject({
      task: { type: 'take_payment', customerId: 'canonical-processing' },
    });
    expect(restored.completedCustomers).toEqual(saved.completedCustomers);
  });

  it('T12 rolls back an unsafe legacy cashier snap, requeues the diner, and permits exactly one later payment', () => {
    const fresh = createInitialState();
    const legacyStation = { ...fresh.cashierStations[0], w: 80, h: 40 };
    const customer = {
      id: 'legacy-processing', partyId: 'legacy-party', state: 'checkout_processing',
      cashierStationId: legacyStation.id, paymentQueuedAt: 10,
      menuOutcome: 'ordered', dishPriceAtOrder: 10, drinkPriceAtOrder: null, orderSubtotal: 10,
      checkoutPosition: { x: 840, y: 180 }, checkoutQueueIndex: 0,
      checkoutLineMember: true, paymentReady: false,
      checkoutLineGeometry: {
        stationId: legacyStation.id, x: legacyStation.x, y: legacyStation.y,
        w: legacyStation.w, h: legacyStation.h,
      },
      x: 840, y: 180,
    };
    const saved = {
      ...fresh,
      version: undefined,
      cashierStations: [legacyStation],
      customers: [customer],
      staff: fresh.staff.map(worker => {
        if (worker.id === legacyStation.assignedStaffId) {
          return {
            ...worker,
            x: 840, y: 100,
            task: { type: 'take_payment', customerId: customer.id, stationId: legacyStation.id },
          };
        }
        if (worker.id === 'starter-host') return { ...worker, x: 820, y: 180 };
        return worker;
      }),
      completedCustomers: [],
    };

    const restored = hydrateState(saved, fresh);
    expect(restored.customers[0]).toMatchObject({
      id: customer.id, state: 'checkout_queued', x: 840, y: 180,
      cashierStationId: null, checkoutPosition: null,
    });

    let current = {
      ...restored,
      staff: restored.staff.map(worker => worker.id === 'starter-host'
        ? { ...worker, x: 700, y: 300 }
        : worker),
    };
    for (let tick = 0; tick < 300 && current.completedCustomers.length === 0; tick += 1) {
      current = runTick(current, { gameDt: 1, movementDt: 0.1 });
    }
    expect(current.restaurant.totalServed).toBe(1);
    expect(current.restaurant.dailyRevenue).toBeGreaterThan(0);
  });

  it('T13 suppresses autosave and movement snapshots for a faulted state while retaining the prior file', () => {
    const fresh = createInitialState();
    const faulted = {
      ...fresh,
      paused: true,
      navigationFault: {
        kind: 'unsafe-navigation-state',
        issues: [{ kind: 'actor-overlap', ids: ['starter-cook', 'starter-host'] }],
      },
    };
    const prior = JSON.stringify({ version: fresh.version, marker: 'previous-good-save' });
    localStorage.setItem('restaurant-sim-save', prior);

    saveState(faulted);
    expect(localStorage.getItem('restaurant-sim-save')).toBe(prior);
    expect(() => movementSaveSnapshot(faulted)).toThrow(/repair navigation conflicts/i);
    expect(runTick(faulted, { gameDt: 10, movementDt: 1 })).toBe(faulted);
    const unpausedFault = { ...faulted, paused: false };
    const unchangedGameTime = unpausedFault.restaurant.gameTime;
    expect(runTick(unpausedFault, { gameDt: 10, movementDt: 1 })).toBe(unpausedFault);
    expect(unpausedFault.restaurant.gameTime).toBe(unchangedGameTime);

    const game = renderGame(faulted);
    game.dispatch({ type: 'TOGGLE_PAUSE' });
    expect(game.state.paused).toBe(true);
    expect(game.state.navigationFault).toBeDefined();
  });

  it('T14 strips transient query/yield authority and round-trips a protected bed resident', () => {
    const fresh = createInitialState();
    const bed = {
      id: 'bed-1', type: 'bed', x: 600, y: 500, rotation: 0,
      slots: [{ index: 0, reservedBy: null, occupiedBy: 'sleeper' }],
    };
    const sleeperBase = fresh.staff.find(worker => worker.id === 'starter-janitor');
    const sleeper = {
      ...sleeperBase,
      id: 'sleeper', role: 'janitor', x: 610, y: 520,
      effectiveDuty: 'pto', dutyPhase: 'active',
      amenityUse: {
        amenityId: bed.id, slotIndex: 0, phase: 'occupied',
        activityStartedAt: 100, activityEndsAt: 25_300, lastRecoveryAt: 100,
      },
      ptoSession: { sleepStartedAt: 100, minimumEndAt: 25_300, startingMorale: 60 },
      movementResidency: { kind: 'staff_amenity', amenityId: bed.id, slotIndex: 0 },
    };
    const transient = {
      ...fresh.staff.find(worker => worker.id === 'starter-cook'),
      navigationGoal: { x: 300, y: 300 },
      navigationYield: { goal: { x: 300, y: 300 }, beneficiaryId: 'beneficiary' },
    };
    const state = {
      ...fresh,
      staff: [transient, sleeper, ...fresh.staff.filter(worker =>
        !['starter-cook', 'starter-janitor'].includes(worker.id))],
      staffAmenities: [bed],
      navigationPreflight: { pending: new Map([['beneficiary', { cursor: 1 }]]) },
    };

    const snapshot = movementSaveSnapshot(state);
    expect(snapshot).not.toHaveProperty('movementCoordinator');
    expect(snapshot).not.toHaveProperty('navigationPreflight');
    expect(snapshot).not.toHaveProperty('navigationFault');
    expect(snapshot.staff.find(worker => worker.id === transient.id)).not.toHaveProperty('navigationYield');
    expect(snapshot.staff.find(worker => worker.id === transient.id)).not.toHaveProperty('navigationGoal');

    const restored = hydrateState(snapshot, fresh);
    expect(restored.movementCoordinator).toEqual(createMovementCoordinator());
    expect(restored).not.toHaveProperty('navigationFault');
    expect(restored.staffAmenities[0].slots[0]).toMatchObject({ occupiedBy: 'sleeper' });
    expect(restored.staff.find(worker => worker.id === 'sleeper')).toMatchObject({
      x: 610, y: 520, amenityUse: { phase: 'occupied', amenityId: 'bed-1' },
      ptoSession: { minimumEndAt: 25_300 },
    });
  });

  it('T31 defers amenity entry atomically when an unrelated actor blocks the proposed anchor', () => {
    const amenity = {
      id: 'couch-1', type: 'couch', x: 500, y: 300, rotation: 0,
      slots: createEmptyAmenitySlots('couch'),
    };
    amenity.slots[0] = { index: 0, reservedBy: 'resting', occupiedBy: null };
    const geometry = getAmenityGeometry(amenity);
    const approach = geometry.approachPoints[0];
    const anchor = geometry.slotAnchors[0];
    const worker = {
      id: 'resting', role: 'waiter', x: approach.x, y: approach.y,
      schedule: Array(48).fill('rest'),
      effectiveDuty: 'rest', dutyPhase: 'travelling',
      amenityUse: {
        amenityId: amenity.id, slotIndex: 0, phase: 'reserved',
        activityStartedAt: null, activityEndsAt: null, lastRecoveryAt: null,
      },
      navigationGoal: { ...approach },
    };
    const blocker = { id: 'blocker', role: 'janitor', x: 495, y: 310, task: null };
    const state = {
      ...minimalState([worker, blocker]),
      staffAmenities: [amenity],
    };

    const blocked = resolveStaffWellbeingAfterMovement(
      state, { resting: { plan: 'arrived' } }, 100,
    );
    expect(blocked.staff.find(candidate => candidate.id === 'resting')).toMatchObject({
      x: approach.x, y: approach.y, amenityUse: { phase: 'reserved' },
    });
    expect(blocked.staffAmenities[0].slots[0]).toMatchObject({
      reservedBy: 'resting', occupiedBy: null,
    });

    const clear = {
      ...state,
      staff: state.staff.map(candidate => candidate.id === blocker.id
        ? { ...candidate, x: 495, y: 350 }
        : candidate),
    };
    const entered = resolveStaffWellbeingAfterMovement(
      clear, { resting: { plan: 'arrived' } }, 100,
    );
    expect(entered.staff.find(candidate => candidate.id === 'resting')).toMatchObject({
      x: anchor.x, y: anchor.y, amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity', amenityId: amenity.id, slotIndex: 0 },
    });
    expect(entered.staffAmenities[0].slots[0]).toMatchObject({
      reservedBy: null, occupiedBy: 'resting',
    });
  });
});
