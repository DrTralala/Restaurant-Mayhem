import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../state/initialState';
import { runTick } from '../gameLoop';
import { findPath } from '../pathfinding';
import { planMovement } from './planner';
import { createGrid } from './grid';
import { prepareIdleYield } from './idleYield';
import { advanceCharacterMovementBatch, createMovementCoordinator } from './coordinator';
import { findRoute } from './router';
import { captureNavigation, navigationPhase, noteNavigation } from './telemetry';

const openState = () => ({
  restaurant: { gameTime: 400, expansionLevel: 1 },
  tables: [],
  chairs: [],
  kitchenStations: [],
  serviceTables: [],
  cashierStations: [],
  washStations: [],
  staffAmenities: [],
  doors: [{ id: 'door1', y: 340, role: 'entrance' }],
  staff: [],
  customers: [],
  queueSlots: [],
  movementCoordinator: createMovementCoordinator(),
});

function heldYieldState() {
  const coordinator = createMovementCoordinator();
  coordinator.elapsedMovementSeconds = 1;
  coordinator.requests.set('beneficiary', {
    id: 'beneficiary', goal: { x: 500, y: 300 }, priority: 2,
  });
  coordinator.records.set('beneficiary', {
    goal: { x: 500, y: 300 }, waitingSeconds: 1,
  });
  coordinator.statuses.set('beneficiary', {
    motion: 'holding', plan: 'waiting', reason: 'traffic', blockers: ['worker'],
  });
  return {
    ...openState(),
    staff: [
      { id: 'worker', role: 'waiter', x: 400, y: 340, task: null, activityPhase: 'idle_waiting' },
      { id: 'beneficiary', role: 'waiter', x: 400, y: 300,
        navigationGoal: { x: 500, y: 300 }, task: { type: 'take_order' } },
    ],
    movementCoordinator: coordinator,
  };
}

function segmentedState() {
  const initial = createInitialState();
  const schedule = Array.from({ length: 48 }, () => 'work');
  schedule[1] = 'rest';
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 0, openHour: 10, closeHour: 22 },
    tables: [],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    staffAmenities: [],
    customers: [],
    queue: [],
    queueSlots: [],
    queueDepartures: [],
    staff: [{ ...initial.staff[0], id: 'segment-worker', x: 100, y: 200,
      schedule, effectiveDuty: 'work', dutyPhase: 'available', task: null }],
  };
}

function deterministicState() {
  const initial = createInitialState();
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 0, openHour: 10, closeHour: 22 },
    tables: [],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    staffAmenities: [],
    customers: [],
    queue: [],
    queueSlots: [],
    queueDepartures: [],
    staff: [{ ...initial.staff[0], id: 'deterministic-worker', x: 100, y: 300,
      navigationGoal: { x: 300, y: 300 }, task: null }],
  };
}

function serialise(value) {
  if (value instanceof Map) {
    return [...value.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, entry]) => [key, serialise(entry)]);
  }
  if (value instanceof Set) return [...value].sort().map(serialise);
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, serialise(value[key])]));
  }
  if (typeof value === 'function') return '[function]';
  return value;
}

describe('navigation telemetry', () => {
  it('conserves route, local and yield expansions and keeps coordinator totals diagnostic', () => {
    const state = heldYieldState();
    const result = captureNavigation(() => {
      const grid = createGrid(state);
      findRoute(grid, { x: 400, y: 300 }, { x: 460, y: 300 });
      planMovement({ grid, start: { x: 400, y: 300 }, goal: { x: 460, y: 300 },
        speed: 40, horizon: 2, reservations: [], maxExpansions: 128 });
      const yielded = prepareIdleYield(state, state.staff[0]);
      expect(yielded.navigationYield).toBeDefined();
    });

    const counters = result.report.counters;
    expect(counters.routeExpansions).toBeGreaterThan(0);
    expect(counters.localExpansions).toBeGreaterThan(0);
    expect(counters.yieldExpansions).toBeGreaterThan(0);
    expect(counters.totalExpansions).toBe(
      counters.routeExpansions + counters.localExpansions + counters.yieldExpansions,
    );
    expect(counters.coordinatorExpansionSubtotal || 0).toBe(0);
  });

  it('records movement-batch safety diagnostics without double-counting the subtotal', () => {
    const state = openState();
    const worker = { id: 'moving-worker', role: 'waiter', x: 100, y: 300,
      navigationGoal: { x: 300, y: 300 }, task: null };
    state.staff = [worker];
    const result = captureNavigation(() => advanceCharacterMovementBatch(state, [
      { character: worker, speed: 40 },
    ], 1));

    expect(result.report.counters.movementBatches).toBe(1);
    expect(result.report.counters.coordinatorExpansionSubtotal)
      .toBe(result.value.diagnostics.expansionsThisTick);
    expect(result.report.counters.totalExpansions).toBe(
      (result.report.counters.routeExpansions || 0)
      + (result.report.counters.localExpansions || 0)
      + (result.report.counters.yieldExpansions || 0),
    );
    expect(result.report.counters.totalExpansions).not.toBe(
      result.report.counters.routeExpansions + result.report.counters.localExpansions
      + result.report.counters.yieldExpansions + result.report.counters.coordinatorExpansionSubtotal,
    );

    const unsafe = openState();
    const first = { id: 'first', role: 'waiter', x: 100, y: 300, task: null };
    const second = { id: 'second', role: 'waiter', x: 110, y: 300, task: null };
    unsafe.staff = [first, second];
    const unsafeResult = captureNavigation(() => advanceCharacterMovementBatch(unsafe, [
      { character: first, speed: 0 }, { character: second, speed: 0 },
    ], 0));
    expect(unsafeResult.report.counters.invariantFailures).toBe(1);
    expect(unsafeResult.report.counters.overBudgetBatches || 0).toBe(0);

    const recovery = openState();
    const recoveryFirst = { id: 'recovery-first', role: 'waiter', x: 940, y: 300,
      navigationGoal: { x: 500, y: 220 }, task: null };
    const recoverySecond = { id: 'recovery-second', role: 'waiter', x: 940, y: 320,
      navigationGoal: { x: 500, y: 540 }, task: null };
    const recoveryCoordinator = createMovementCoordinator();
    recoveryCoordinator.statuses = new Map([
      ['recovery-first', { blockers: ['recovery-second'] }],
      ['recovery-second', { blockers: ['recovery-first'] }],
    ]);
    recoveryCoordinator.records = new Map([
      ['recovery-first', { goal: recoveryFirst.navigationGoal, waitingTicks: 400 }],
      ['recovery-second', { goal: recoverySecond.navigationGoal, waitingTicks: 300 }],
    ]);
    recovery.staff = [recoveryFirst, recoverySecond];
    recovery.movementCoordinator = recoveryCoordinator;
    const mixed = captureNavigation(() => advanceCharacterMovementBatch(recovery, [
      { character: recoveryFirst, speed: 60 }, { character: recoverySecond, speed: 60 },
    ], 1 / 30));
    expect(mixed.value.diagnostics.recoveries.size).toBeGreaterThan(0);
    expect(mixed.value.diagnostics.expansionsThisTick).toBeGreaterThan(0);
    expect(mixed.report.counters.coordinatorExpansionSubtotal)
      .toBe(mixed.value.diagnostics.expansionsThisTick);
    expect(mixed.report.counters.totalExpansions).toBe(
      (mixed.report.counters.routeExpansions || 0)
      + (mixed.report.counters.localExpansions || 0)
      + (mixed.report.counters.yieldExpansions || 0),
    );
  });

  it('records every domain phase and every movement segment in a full tick', () => {
    const result = captureNavigation(() => runTick(segmentedState(), { gameDt: 3600, movementDt: 0 }));
    const labels = [
      'clock', 'food-patience', 'spawn', 'customers-prepare', 'dirt', 'consumption',
      'seating-prepare', 'wellbeing-prepare', 'staff-prepare', 'movement',
      'customers-resolve', 'seating-resolve', 'wellbeing-resolve', 'staff-resolve',
      'kitchen', 'dishwashers', 'revenue', 'milestones',
    ];

    expect(Object.keys(result.report.phases)).toEqual(expect.arrayContaining(labels));
    expect(result.report.counters.movementBatches).toBe(2);
    expect(result.report.counters.totalExpansions).toBe(
      (result.report.counters.routeExpansions || 0)
      + (result.report.counters.localExpansions || 0)
      + (result.report.counters.yieldExpansions || 0),
    );
  });

  it('records static path cache hits without doing router work after a warm call', () => {
    const doors = [{ id: 'door1', y: 340, role: 'entrance' }];
    const state = { ...openState(), doors };
    const start = { x: 5, y: 5 };
    const goal = { x: 10, y: 5 };
    const cold = captureNavigation(() => findPath(state, start, goal));
    const warm = captureNavigation(() => findPath(state, start, goal));
    const changed = captureNavigation(() => findPath({
      ...state, tables: [{ id: 'topology-change', x: 400, y: 400 }],
    }, start, goal));

    expect(cold.report.counters).toMatchObject({ pathRequests: 1, pathCacheMisses: 1 });
    expect(cold.report.counters.routeStarts).toBe(1);
    expect(warm.report.counters).toMatchObject({ pathRequests: 1, pathCacheHits: 1 });
    expect(warm.report.counters.pathCacheMisses || 0).toBe(0);
    expect(warm.report.counters.routeStarts || 0).toBe(0);
    expect(warm.report.counters.routeExpansions || 0).toBe(0);
    expect(changed.report.counters).toMatchObject({ pathRequests: 1, pathCacheMisses: 1 });
    expect(changed.report.counters.routeStarts).toBe(1);
    expect(changed.report.counters.routeExpansions).toBeGreaterThan(0);
  });

  it('keeps capture optional and deterministic, including cleanup after nesting and throws', () => {
    const uncaptured = runTick(deterministicState(), { gameDt: 0, movementDt: 1 });
    const captured = captureNavigation(() => runTick(deterministicState(), {
      gameDt: 0, movementDt: 1,
    }));
    expect(serialise(captured.value)).toEqual(serialise(uncaptured));

    const phased = captureNavigation(() => navigationPhase('outer', () => {
      noteNavigation('routeExpansions', 2);
      navigationPhase('inner', () => noteNavigation('localExpansions', 3));
      noteNavigation('yieldExpansions', 4);
    }));
    expect(phased.report.counters.totalExpansions).toBe(9);
    expect(phased.report.phases.outer.counters).toEqual({ routeExpansions: 2, yieldExpansions: 4 });
    expect(phased.report.phases.inner.counters).toEqual({ localExpansions: 3 });

    const phaseThrow = captureNavigation(() => {
      expect(() => navigationPhase('throws', () => {
        noteNavigation('routeStarts');
        throw new Error('phase failed');
      })).toThrow('phase failed');
      noteNavigation('localSearches');
    });
    expect(phaseThrow.report.phases.throws.counters).toEqual({ routeStarts: 1 });
    expect(phaseThrow.report.phases.tick.counters).toEqual({ localSearches: 1 });

    expect(() => captureNavigation(() => captureNavigation(() => null)))
      .toThrow('Navigation captures cannot be nested');
    expect(() => captureNavigation(() => {
      throw new Error('capture failed');
    })).toThrow('capture failed');
    expect(() => captureNavigation(() => noteNavigation('routeExpansions', -1)))
      .toThrow('Invalid navigation metric routeExpansions');

    const afterCleanup = captureNavigation(() => noteNavigation('routeStarts'));
    expect(afterCleanup.report.counters).toEqual({ routeStarts: 1, totalExpansions: 0 });
  });
});
