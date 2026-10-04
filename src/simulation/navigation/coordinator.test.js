import { describe, expect, it, vi } from 'vitest';
import { advanceCharacterMovementBatch, createMovementCoordinator } from './coordinator';
import { minimumTrajectoryDistance } from '../movement/trajectory';
import { captureNavigation } from './telemetry';
import * as reservations from './reservations';
import * as grids from './grid';
import coordinatorSource from './coordinator.js?raw';
import { noteNavigation } from './telemetry';
import { createNavigationWorkspace } from '../movement/navigationWorkspace';

function legacyRouteTarget(grid, start, route, speed, horizon, goal) {
  let nearest = -1;
  let nearestDistance = Infinity;
  for (let index = 0; index < route.length; index += 1) {
    const point = route[index];
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    if (distance > nearestDistance || !grid.segmentClear(start, point)) continue;
    nearest = index;
    nearestDistance = distance;
  }
  if (nearest < 0) return goal;
  const lookahead = speed * horizon * 0.75;
  let point = route[nearest];
  let length = nearestDistance;
  for (let index = nearest + 1; index < route.length; index += 1) {
    const next = route[index];
    const segment = Math.hypot(next.x - point.x, next.y - point.y);
    if (length + segment > lookahead && length > 0) break;
    length += segment;
    point = next;
  }
  return point;
}

// Exercise the private production helper, including its actual grid, without
// adding a test-only export or replacing a frozen grid's segment implementation.
const routeTargetFactory = new Function('hasStableSegmentGeometry', 'noteNavigation', 'observeSegment',
  coordinatorSource.slice(coordinatorSource.indexOf('function routeTarget'),
    coordinatorSource.indexOf('function planCheckoutAdvance'))
    .replaceAll('grid.segmentClear(start, point)', 'observeSegment(grid, start, point)')
    + '\nreturn routeTarget;');
function observedRouteTarget(...args) {
  const checked = [];
  const target = routeTargetFactory(grids.hasStableSegmentGeometry, noteNavigation, (grid, start, point) => {
    checked.push(point);
    return grid.segmentClear(start, point);
  });
  return { point: target(...args), checked };
}

const actor = (id, x, y, goal, extra = {}) => ({ id, x, y, ...(goal ? { navigationGoal: goal } : {}), ...extra });
const world = staff => ({ restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [],
  serviceTables: [], customers: [], queueSlots: [], staff, movementCoordinator: createMovementCoordinator() });
const entries = state => state.staff.map(character => ({ character, speed: character.navigationGoal ? 60 : 0 }));

describe('route-target visibility selection', () => {
  it('checks the nearest candidate first instead of each successively closer route point', () => {
    const grid = grids.createGrid(world([]));
    const start = { x: 600, y: 300 };
    const route = Array.from({ length: 31 }, (_, index) => ({ x: 200 + index * 20, y: 300 }));
    const expected = legacyRouteTarget(grid, start, route, 40, 2, route.at(-1));
    const actual = observedRouteTarget(grid, start, route, 40, 2, route.at(-1));
    expect(actual.point).toBe(expected);
    expect(actual.point).toEqual({ x: 660, y: 300 });
    expect(actual.checked).toEqual([route[20]]);
  });

  it('matches the original target for ties, blocked nearest points, off-lattice starts and empty routes', () => {
    const open = grids.createGrid(world([]));
    const blocked = grids.createGrid({ ...world([]), tables: [{ id: 'obstacle', x: 420, y: 300 }] });
    const start = { x: 400, y: 300 };
    const goal = { x: 800, y: 400 };
    const tie = [{ x: 380, y: 300 }, { x: 420, y: 300 }, { x: 600, y: 300 }];
    expect(observedRouteTarget(open, start, tie, 1, 2, goal).point).toBe(tie[1]);
    const routes = [[], [start], tie,
      [{ x: 420, y: 300 }, { x: 400, y: 340 }, { x: 440, y: 300 }],
      [{ x: 420, y: 300 }, { x: 440, y: 300 }],
    ];
    for (const grid of [open, blocked]) for (const origin of [start, { x: 406.7934443842663, y: 300 }]) {
      for (const route of routes) for (const speed of [0, 1, 40, 55, 73]) {
        expect(observedRouteTarget(grid, origin, route, speed, 2, goal).point)
          .toBe(legacyRouteTarget(grid, origin, route, speed, 2, goal));
      }
    }
  });

  it('matches the original algorithm across seeded arbitrary route orderings', () => {
    const grid = grids.createGrid({ ...world([]), tables: [{ id: 'obstacle', x: 420, y: 300 }] });
    let seed = 20260920;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    for (let sample = 0; sample < 96; sample += 1) {
      const start = { x: 380 + random() * 40, y: 280 + random() * 40 };
      const route = Array.from({ length: sample % 24 }, () => ({
        x: 300 + Math.floor(random() * 12) * 20, y: 240 + Math.floor(random() * 12) * 20,
      }));
      const goal = { x: 600, y: 400 };
      const speed = [1, 40, 55, 73][sample % 4];
      expect(observedRouteTarget(grid, start, route, speed, 2, goal).point)
        .toBe(legacyRouteTarget(grid, start, route, speed, 2, goal));
    }
  });

  it('retains the original read/query order for accessors and untrusted domain wrappers', () => {
    const run = (legacy, wrapped) => {
      const reads = [];
      const base = grids.createGrid(world([]));
      const grid = wrapped ? Object.freeze({ ...base, segmentClear: (from, to) => {
        reads.push(`segment:${to.x}`); return base.segmentClear(from, to);
      } }) : base;
      const route = [{ x: 200, y: 300 },
        { get x() { reads.push('point-x'); return 400; }, y: 300 }, { x: 600, y: 300 }];
      const args = [grid, { x: 600, y: 300 }, route, 40, 2, route.at(-1)];
      const point = legacy ? legacyRouteTarget(...args) : observedRouteTarget(...args).point;
      return { point: { x: point.x, y: point.y }, reads };
    };
    for (const wrapped of [false, true]) expect(run(false, wrapped)).toEqual(run(true, wrapped));
    const base = grids.createGrid(world([]));
    const wrapped = Object.freeze({ ...base });
    const route = [{ x: 200, y: 300 }, { x: 400, y: 300 }, { x: 600, y: 300 }];
    expect(observedRouteTarget(wrapped, route[2], route, 40, 2, route[2]).checked).toEqual(route);
  });

  it('uses the original scan after a live door changes or becomes an accessor', () => {
    expect(grids.hasStableSegmentGeometry).toBeTypeOf('function');
    const state = { ...world([]), doors: [{ id: 'door', y: 340, role: 'entrance' }] };
    const grid = grids.createGrid(state, null, { doorFlow: { direction: 'ingress', doorId: 'door' } });
    expect(grids.hasStableSegmentGeometry(grid)).toBe(true);
    state.doors[0].y = 380;
    expect(grids.hasStableSegmentGeometry(grid)).toBe(false);
    const route = [{ x: 200, y: 300 }, { x: 400, y: 300 }, { x: 600, y: 300 }];
    expect(observedRouteTarget(grid, route[2], route, 40, 2, route[2]).checked).toEqual(route);
    Object.defineProperty(state.doors[0], 'y', { get: () => 340 });
    expect(grids.hasStableSegmentGeometry(grid)).toBe(false);
    expect(observedRouteTarget(grid, route[2], route, 40, 2, route[2]).checked).toEqual(route);
  });

  it('does not reorder queries on a mutable borrowed raster', () => {
    const state = world([]);
    const workspace = createNavigationWorkspace(state);
    const blockedCells = new Set(workspace.blockedCellKeys);
    const grid = grids.createGrid(state, Object.freeze({ ...workspace, blockedCells }));
    expect(grids.hasStableSegmentGeometry(grid)).toBe(false);
    const route = [{ x: 200, y: 300 }, { x: 400, y: 300 }, { x: 600, y: 300 }];
    expect(observedRouteTarget(grid, route[2], route, 40, 2, route[2]).checked).toEqual(route);
    blockedCells.add('20,15');
    expect(observedRouteTarget(grid, route[2], route, 40, 2, route[2]).point)
      .toBe(legacyRouteTarget(grid, route[2], route, 40, 2, route[2]));
  });

  it('does not certify a borrowed frozen workspace with live bounds accessors', () => {
    const state = world([]);
    const workspace = createNavigationWorkspace(state);
    let left = workspace.bounds.left;
    const bounds = Object.freeze({ ...workspace.bounds, get left() { return left; } });
    const grid = grids.createGrid(state, Object.freeze({ ...workspace, bounds }));
    expect(grids.hasStableSegmentGeometry(grid)).toBe(false);
    left += 20;
    expect(grids.hasStableSegmentGeometry(grid)).toBe(false);
  });

  it.each(['start', 'route-index'])('preserves %s accessor fallback reads', kind => {
    const run = legacy => {
      const reads = [];
      const start = kind === 'start'
        ? { get x() { reads.push('start-x'); return 600; }, y: 300 } : { x: 600, y: 300 };
      const route = [{ x: 200, y: 300 }, { x: 400, y: 300 }, { x: 600, y: 300 }];
      const middle = route[1];
      if (kind === 'route-index') {
        Object.defineProperty(route, '1', { get: () => { reads.push('route-index'); return middle; } });
      }
      const grid = grids.createGrid(world([]));
      const point = legacy ? legacyRouteTarget(grid, start, route, 40, 2, route[2])
        : observedRouteTarget(grid, start, route, 40, 2, route[2]).point;
      return { point, reads };
    };
    expect(run(false)).toEqual(run(true));
  });

  it('preserves malformed and non-finite fallback outcomes', () => {
    const grid = grids.createGrid(world([]));
    const start = { x: 400, y: 300 };
    const goal = { x: 600, y: 300 };
    const outcome = callback => {
      try { return { point: callback() }; } catch (error) { return { error: [error.name, error.message] }; }
    };
    for (const route of [[start, { x: NaN, y: 300 }], [start, { x: Infinity, y: 300 }],
      [start, null], [start, { x: '420', y: 300 }], [start, , goal]]) {
      expect(outcome(() => observedRouteTarget(grid, start, route, 40, 2, goal).point))
        .toEqual(outcome(() => legacyRouteTarget(grid, start, route, 40, 2, goal)));
    }
  });
});

function tick(state, descriptors = entries(state)) {
  const result = advanceCharacterMovementBatch(state, descriptors, 1 / 30);
  expect(result.diagnostics.expansionsThisTick).toBeLessThanOrEqual(2048);
  const staff = state.staff.map(worker => result.moved.get(worker.id) || worker);
  for (let index = 0; index < staff.length; index += 1) {
    for (let other = index + 1; other < staff.length; other += 1) {
      expect(Math.hypot(staff[index].x - staff[other].x, staff[index].y - staff[other].y)).toBeGreaterThanOrEqual(16 - 1e-9);
      expect(minimumTrajectoryDistance(result.trajectories.get(staff[index].id),
        result.trajectories.get(staff[other].id))).toBeGreaterThanOrEqual(16 - 1e-9);
    }
  }
  return { ...state, staff, movementCoordinator: result.coordinator };
}

describe('bounded traffic coordinator', () => {
  it('preserves batch movement and plans against the original route-target scan', () => {
    const run = () => {
      let state = world([
        actor('a', 400, 300, { x: 600, y: 300 }),
        actor('b', 600, 340, { x: 400, y: 340 }),
        actor('obstacle', 440, 300),
      ]);
      const frames = [];
      for (let tick = 0; tick < 60; tick += 1) {
        const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);
        frames.push({ moved: result.moved, statuses: result.statuses, plans: result.coordinator.plans,
          claims: result.coordinator.claims, trajectories: result.trajectories, diagnostics: result.diagnostics });
        state = { ...state, staff: state.staff.map(worker => result.moved.get(worker.id) || worker),
          movementCoordinator: result.coordinator };
      }
      return frames;
    };
    const predicate = vi.spyOn(grids, 'hasStableSegmentGeometry').mockReturnValue(false);
    let reference;
    try { reference = run(); } finally { predicate.mockRestore(); }
    expect(run()).toEqual(reference);
  });

  it.each([
    ['an orphan lease', {
      queue: [],
      queueSlots: [{ memberId: 'orphan', partyId: 'ghost', x: 460, y: 300, slot: 0 }],
    }, []],
    ['an ambiguous lease', {
      queue: [{ partyId: 'party', members: [{ id: 'queued', partyId: 'party', state: 'queued' }] }],
      queueSlots: [
        { memberId: 'queued', partyId: 'party', x: 460, y: 300, slot: 0 },
        { memberId: 'queued', partyId: 'party', x: 500, y: 300, slot: 1 },
      ],
    }, []],
    ['a foreign-party lease', {
      queue: [{ partyId: 'party', members: [{ id: 'queued', partyId: 'party', state: 'queued' }] }],
      queueSlots: [{ memberId: 'queued', partyId: 'other-party', x: 460, y: 300, slot: 0 }],
    }, []],
    ['a display-overflow member', {
      queue: [{ partyId: 'party', members: [{ id: 'overflow', partyId: 'party', state: 'queued' }] }],
      queueSlots: [],
    }, []],
    ['a legitimate leased member', {
      queue: [{ partyId: 'party', members: [{ id: 'queued', partyId: 'party', state: 'queued' }] }],
      queueSlots: [{ memberId: 'queued', partyId: 'party', x: 460, y: 300, slot: 0 }],
    }, ['queued']],
    ['an actual departing customer', {
      queue: [],
      queueSlots: [{ memberId: 'departing', partyId: 'party', x: 460, y: 300, slot: 0 }],
      customers: [{ id: 'departing', partyId: 'party', state: 'leaving', x: 460, y: 300 }],
    }, ['departing']],
  ])('uses only physical queue authority for %s', (_label, overrides, expectedIds) => {
    const result = advanceCharacterMovementBatch({ ...world([]), ...overrides }, [], 0);
    expect([...result.coordinator.requests.keys()].sort()).toEqual(expectedIds);
  });

  it('diagnoses unsafe starting overlap without teleporting it or stopping independent actors', () => {
    const state = world([actor('a', 400, 300), actor('b', 410, 300), actor('independent', 600, 300, { x: 660, y: 300 })]);
    const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);
    expect(result.diagnostics.invariantFailure).toBe('unsafeInitialState');
    expect(result.diagnostics.unsafeActors).toEqual(['a', 'b']);
    expect(result.moved.get('a')).toMatchObject({ x: 400, y: 300 });
    expect(result.moved.get('b')).toMatchObject({ x: 410, y: 300 });
    expect(result.moved.get('independent').x).toBeGreaterThan(600);
  });
  it('moves a character to its exact goal through the public batch interface', () => {
    let state = world([actor('worker', 400, 300, { x: 460, y: 300 })]);
    for (let index = 0; index < 45; index += 1) state = tick(state);
    expect(state.staff[0]).toMatchObject({ x: 460, y: 300 });
    expect(state.movementCoordinator.statuses.get('worker').plan).toBe('arrived');
  });

  it('shares an exact ingress flow base across actors within one movement batch', () => {
    const customers = [
      actor('ingress-a', 700, 300, { x: 640, y: 300 }, { state: 'entering', entryDoorId: 'entrance' }),
      actor('ingress-b', 700, 340, { x: 640, y: 340 }, { state: 'entering', entryDoorId: 'entrance' }),
    ];
    const state = {
      ...world([]),
      customers,
      doors: [{ id: 'entrance', y: 340, role: 'entrance' }],
    };
    const descriptors = customers.map(character => ({
      character,
      speed: 60,
      doorFlow: { direction: 'ingress', doorId: 'entrance', batchTag: 'same' },
    }));
    const captured = captureNavigation(() =>
      advanceCharacterMovementBatch(state, descriptors, 1 / 30));

    expect(captured.report.counters.actorFlowGridBuilds).toBe(1);
    expect(captured.report.counters.actorFlowGridCacheHits).toBeGreaterThan(0);
  });

  it('shares reservation preparation within a batch but creates a fresh context for the next batch', () => {
    const staff = [
      actor('worker-a', 400, 300, { x: 460, y: 300 }),
      actor('worker-b', 400, 340, { x: 460, y: 340 }),
      actor('worker-c', 400, 380, { x: 460, y: 380 }),
    ];
    const state = world(staff);
    const originalFactory = reservations.createReservationSafetyChecker;
    const factory = vi.spyOn(reservations, 'createReservationSafetyChecker');
    const contexts = [];
    factory.mockImplementation((entries, blockers, context) => {
      contexts.push(context);
      return originalFactory(entries, blockers, context);
    });

    try {
      const firstBatch = advanceCharacterMovementBatch(state, entries(state), 1 / 30);
      expect(firstBatch.diagnostics.expansionsThisTick).toBeLessThanOrEqual(2048);
      expect(contexts.length).toBeGreaterThan(1);
      const firstContext = contexts[0];
      expect(firstContext).toBeDefined();
      expect(contexts.every(context => context === firstContext)).toBe(true);

      contexts.length = 0;
      const secondBatch = advanceCharacterMovementBatch(state, entries(state), 1 / 30);
      expect(secondBatch.diagnostics.expansionsThisTick).toBeLessThanOrEqual(2048);
      expect(contexts.length).toBeGreaterThan(1);
      expect(contexts.every(context => context === contexts[0])).toBe(true);
      expect(contexts[0]).not.toBe(firstContext);
    } finally {
      factory.mockRestore();
    }
  });

  it('does not freeze an independent actor when two destinations conflict', () => {
    let state = world([actor('a', 400, 300, { x: 460, y: 300 }),
      actor('b', 400, 340, { x: 460, y: 300 }), actor('independent', 600, 400, { x: 660, y: 400 })]);
    for (let index = 0; index < 60; index += 1) state = tick(state);
    expect(state.staff.find(worker => worker.id === 'independent')).toMatchObject({ x: 660, y: 400 });
    expect(state.movementCoordinator.claims.size).toBe(2);
  });

  it('preserves stationary occupancy when an actor has no movement descriptor', () => {
    let state = world([actor('mover', 400, 300, { x: 460, y: 300 }), actor('stationary', 420, 300)]);
    for (let index = 0; index < 90; index += 1) state = tick(state, entries(state).filter(entry => entry.character.id === 'mover'));
    expect(state.staff[0]).toMatchObject({ x: 460, y: 300 });
    expect(state.staff[1]).toMatchObject({ x: 420, y: 300 });
  });

  it('keeps the previous coordinator and actors unchanged', () => {
    const state = world([actor('worker', 400, 300, { x: 460, y: 300 })]);
    const snapshot = structuredClone(state);
    tick(state);
    expect(state).toEqual(snapshot);
  });

  it('tracks held time in movement seconds and preserves it across split batches', () => {
    const initial = world([actor('worker', 400, 300, { x: 460, y: 300 })]);
    const heldEntry = [{ character: initial.staff[0], speed: 0 }];
    const oneBatch = advanceCharacterMovementBatch(initial, heldEntry, 0.1);
    let splitState = { ...initial, movementCoordinator: createMovementCoordinator() };
    splitState = {
      ...splitState,
      movementCoordinator: advanceCharacterMovementBatch(splitState, heldEntry, 0.05).coordinator,
    };
    splitState = {
      ...splitState,
      movementCoordinator: advanceCharacterMovementBatch(splitState, heldEntry, 0.05).coordinator,
    };

    expect(oneBatch.coordinator.records.get('worker').waitingSeconds).toBeCloseTo(0.1);
    expect(splitState.movementCoordinator.records.get('worker').waitingSeconds).toBeCloseTo(0.1);
    expect(advanceCharacterMovementBatch(initial, heldEntry, 0).coordinator.records
      .get('worker').waitingSeconds).toBe(0);
  });

  it('resets held time after actual displacement, including a detour', () => {
    const state = world([actor('worker', 400, 300, { x: 500, y: 300 })]);
    state.movementCoordinator.records.set('worker', {
      goal: { x: 500, y: 300 }, waitingSeconds: 2, waitingTicks: 60,
    });
    const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);

    expect(result.moved.get('worker').x).toBeGreaterThan(400);
    expect(result.coordinator.records.get('worker').waitingSeconds).toBe(0);
  });

  it('is invariant to input actor ordering', () => {
    const staff = [actor('a', 400, 300, { x: 460, y: 300 }), actor('b', 400, 360, { x: 460, y: 360 })];
    let forward = world(staff);
    let reverse = world([...staff].reverse());
    for (let index = 0; index < 40; index += 1) { forward = tick(forward); reverse = tick(reverse); }
    expect([...forward.staff].sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...reverse.staff].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('reports unreachable static geometry without treating it as arrival', () => {
    const state = world([actor('worker', 400, 300, { x: 460, y: 300 })]);
    state.chairs = [{ id: 'blocked', x: 460, y: 300 }];
    const next = tick(state);
    expect(next.staff[0]).toMatchObject({ x: 400, y: 300 });
    expect(next.movementCoordinator.statuses.get('worker').plan).toBe('unreachable');
  });

  it('does not allow ignoredIds to bypass ordinary character collision checks', () => {
    const state = world([actor('mover', 400, 300, { x: 460, y: 300 }), actor('blocker', 416, 300)]);
    const next = tick(state, entries(state).map(entry => ({ ...entry, ignoredIds: ['blocker', 'mover'] })));
    expect(Math.hypot(next.staff[0].x - 416, next.staff[0].y - 300)).toBeGreaterThanOrEqual(16);
  });

  it.each([
    ['ingress', 2],
    ['egress', 0],
  ])('assigns the domain priority for %s door traffic', (direction, expectedPriority) => {
    const state = world([actor('actor', 400, 300, { x: 460, y: 300 })]);
    const [character] = state.staff;
    const result = advanceCharacterMovementBatch(state, [{
      character,
      speed: 60,
      doorFlow: { doorId: 'door1', direction },
    }], 1 / 30);

    expect(result.coordinator.requests.get('actor').priority).toBe(expectedPriority);
  });

  it('resolves opposing corridor traffic through a passing bay without teleporting', () => {
    let state = world([actor('a', 400, 300, { x: 580, y: 300 }), actor('b', 580, 300, { x: 400, y: 300 })]);
    state.chairs = [];
    for (let x = 60; x <= 1020; x += 20) {
      for (const y of [260, 280, 320]) {
        if (x === 420 && y === 280) continue;
        state.chairs.push({ id: `${x}:${y}`, x, y });
      }
    }
    state.chairs.push({ id: 'left-end', x: 380, y: 300 }, { id: 'right-end', x: 600, y: 300 });
    let sawBay = false;
    for (let index = 0; index < 450; index += 1) {
      const previous = state.staff;
      state = tick(state);
      state.staff.forEach((worker, i) => {
        expect(Math.hypot(worker.x - previous[i].x, worker.y - previous[i].y)).toBeLessThanOrEqual(2 + 1e-9);
        if (worker.y < 300) sawBay = true;
      });
      if (state.staff.every(worker => worker.x === worker.navigationGoal.x && worker.y === worker.navigationGoal.y)) break;
    }
    expect(sawBay, JSON.stringify({ staff: state.staff, statuses: [...state.movementCoordinator.statuses],
      waiting: [...state.movementCoordinator.records].map(([id, record]) => [id, record.waitingTicks]),
      recoveries: [...state.movementCoordinator.diagnostics.recoveries] })).toBe(true);
    expect(state.staff[0]).toMatchObject({ x: 580, y: 300 });
    expect(state.staff[1]).toMatchObject({ x: 400, y: 300 });
  });

  it('uses immediate mutual obstruction evidence to yield before the measured oscillation', () => {
    let state = world([actor('a', 400, 300, { x: 580, y: 300 }), actor('b', 580, 300, { x: 400, y: 300 })]);
    state.chairs = [];
    for (let x = 60; x <= 1020; x += 20) {
      for (const y of [260, 280, 320]) {
        if (x === 420 && y === 280) continue;
        state.chairs.push({ id: `${x}:${y}`, x, y });
      }
    }
    state.chairs.push({ id: 'left-end', x: 380, y: 300 }, { id: 'right-end', x: 600, y: 300 });

    let firstBayTick = null;
    let firstRecoveryTick = null;
    let arrivalTick = null;
    let sawRecovery = false;
    let recoveryEpisodes = 0;
    let recovering = false;
    const recoveryActors = new Set();
    let minimumSeparation = Infinity;
    for (let tickNumber = 1; tickNumber <= 450; tickNumber += 1) {
      const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);
      expect(result.diagnostics.expansionsThisTick).toBeLessThanOrEqual(2048);
      const staff = state.staff.map(worker => result.moved.get(worker.id) || worker);
      minimumSeparation = Math.min(minimumSeparation,
        Math.hypot(staff[0].x - staff[1].x, staff[0].y - staff[1].y),
        minimumTrajectoryDistance(result.trajectories.get('a'), result.trajectories.get('b')));
      if (firstBayTick === null && staff.some(worker => worker.y < 300)) firstBayTick = tickNumber;
      if (firstRecoveryTick === null && result.diagnostics.recoveries.size > 0) {
        firstRecoveryTick = tickNumber;
      }
      sawRecovery ||= result.diagnostics.recoveries.size > 0;
      for (const id of result.diagnostics.recoveries.keys()) recoveryActors.add(id);
      const nextRecovering = result.diagnostics.recoveries.size > 0;
      if (nextRecovering && !recovering) recoveryEpisodes += 1;
      recovering = nextRecovering;
      state = { ...state, staff, movementCoordinator: result.coordinator };
      if (state.staff.every(worker => worker.x === worker.navigationGoal.x
        && worker.y === worker.navigationGoal.y)) {
        arrivalTick = tickNumber;
        break;
      }
    }

    expect(firstBayTick).toBeLessThanOrEqual(30);
    expect(firstRecoveryTick).toBeLessThan(74);
    expect(recoveryEpisodes).toBe(1);
    expect([...recoveryActors]).toEqual(['a']);
    // The only clear bay is 20px off the lane. Keeping it reserved until the
    // peer clears the 16px swept-clearance margin makes 180 ticks the geometry
    // bound for this fixture; the earlier bay decision is the regression target.
    expect(arrivalTick).toBeLessThanOrEqual(180);
    expect(sawRecovery).toBe(true);
    expect(minimumSeparation).toBeGreaterThanOrEqual(16 - 1e-9);
  });

  it('does not yield when converging actors can stop with clearance before passing', () => {
    const coordinator = createMovementCoordinator();
    coordinator.statuses = new Map([
      ['a', { blockers: ['b'], motion: 'holding', plan: 'waiting', reason: 'traffic' }],
      ['b', { blockers: ['a'], motion: 'holding', plan: 'waiting', reason: 'traffic' }],
    ]);
    coordinator.conflicts.set('a\u0000b', {
      ids: ['a', 'b'],
      goals: new Map([['a', { x: 480, y: 300 }], ['b', { x: 500, y: 300 }]]),
    });
    const state = {
      ...world([actor('a', 400, 300, { x: 480, y: 300 }), actor('b', 580, 300, { x: 500, y: 300 })]),
      movementCoordinator: coordinator,
    };

    const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);

    expect(result.diagnostics.recoveries.size).toBe(0);
  });

  it('does not create conflict evidence for productive open movement', () => {
    let state = world([actor('worker', 400, 300, { x: 500, y: 300 })]);
    for (let tickNumber = 0; tickNumber < 60; tickNumber += 1) {
      const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);
      expect(result.diagnostics.recoveries.size).toBe(0);
      expect(result.coordinator.conflicts.size).toBe(0);
      state = {
        ...state,
        staff: state.staff.map(worker => result.moved.get(worker.id) || worker),
        movementCoordinator: result.coordinator,
      };
    }
    expect(state.staff[0]).toMatchObject({ x: 500, y: 300 });
  });

  it('does not grant an early yield to productive same-direction traffic', () => {
    let state = world([actor('leader', 400, 300, { x: 580, y: 300 }), actor('follower', 420, 300, { x: 600, y: 300 })]);
    let recoveries = 0;
    for (let tickNumber = 0; tickNumber < 120; tickNumber += 1) {
      const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);
      recoveries += result.diagnostics.recoveries.size;
      state = {
        ...state,
        staff: state.staff.map(worker => result.moved.get(worker.id) || worker),
        movementCoordinator: result.coordinator,
      };
    }
    expect(recoveries).toBe(0);
    expect(state.staff).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'leader', x: 580, y: 300 }),
      expect.objectContaining({ id: 'follower', x: 600, y: 300 }),
    ]));
  });

  it('clears conflict evidence when goals now produce productive same-direction movement', () => {
    const coordinator = createMovementCoordinator();
    coordinator.conflicts.set('a\u0000b', {
      ids: ['a', 'b'],
      goals: new Map([['a', { x: 500, y: 300 }], ['b', { x: 524, y: 300 }]]),
    });
    let state = {
      ...world([actor('a', 400, 300, { x: 500, y: 300 }), actor('b', 424, 300, { x: 524, y: 300 })]),
      movementCoordinator: coordinator,
    };

    const result = advanceCharacterMovementBatch(state, entries(state), 0);

    expect(result.coordinator.conflicts.size).toBe(0);
    expect(result.diagnostics.recoveries.size).toBe(0);
  });

  it('clears converging conflict evidence after traffic disappears', () => {
    const coordinator = createMovementCoordinator();
    coordinator.conflicts.set('a\u0000b', {
      ids: ['a', 'b'],
      goals: new Map([['a', { x: 500, y: 300 }], ['b', { x: 400, y: 300 }]]),
    });
    const state = {
      ...world([actor('a', 400, 300, { x: 500, y: 300 }), actor('b', 424, 300, { x: 400, y: 300 })]),
      movementCoordinator: coordinator,
    };

    const result = advanceCharacterMovementBatch(state, entries(state), 0);

    expect(result.coordinator.conflicts.size).toBe(0);
    expect(result.diagnostics.recoveries.size).toBe(0);
  });

  it('clears conflict evidence when a goal changes or the pair separates', () => {
    const makeCoordinator = () => {
      const coordinator = createMovementCoordinator();
      coordinator.conflicts.set('a\u0000b', {
        ids: ['a', 'b'],
        goals: new Map([['a', { x: 500, y: 300 }], ['b', { x: 400, y: 300 }]]),
      });
      return coordinator;
    };
    const changedGoal = {
      ...world([actor('a', 400, 300, { x: 520, y: 300 }), actor('b', 424, 300, { x: 400, y: 300 })]),
      movementCoordinator: makeCoordinator(),
    };
    const separated = {
      ...world([actor('a', 400, 300, { x: 500, y: 300 }), actor('b', 460, 300, { x: 400, y: 300 })]),
      movementCoordinator: makeCoordinator(),
    };

    const changedResult = advanceCharacterMovementBatch(changedGoal, entries(changedGoal), 0);
    const separatedResult = advanceCharacterMovementBatch(separated, entries(separated), 0);
    expect(changedResult.coordinator.conflicts.size).toBe(0);
    expect(changedResult.diagnostics.recoveries.size).toBe(0);
    expect(separatedResult.coordinator.conflicts.size).toBe(0);
    expect(separatedResult.diagnostics.recoveries.size).toBe(0);
  });

  it('clears conflict evidence when an actor reaches its goal', () => {
    const coordinator = createMovementCoordinator();
    coordinator.conflicts.set('a\u0000b', {
      ids: ['a', 'b'],
      goals: new Map([['a', { x: 402, y: 300 }], ['b', { x: 400, y: 300 }]]),
    });
    const state = {
      ...world([actor('a', 400, 300, { x: 402, y: 300 }), actor('b', 424, 300, { x: 400, y: 300 })]),
      movementCoordinator: coordinator,
    };

    const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);

    expect(result.coordinator.conflicts.size).toBe(0);
    expect(result.diagnostics.recoveries.size).toBe(0);
  });

  it('follows a long static detour even when it initially increases distance to the goal', () => {
    let state = world([actor('worker', 400, 300, { x: 500, y: 300 })]);
    state.tables = Array.from({ length: 11 }, (_, index) => ({ id: `wall-${index}`, x: 440, y: 100 + index * 40 }));
    for (let index = 0; index < 450; index += 1) {
      state = tick(state);
      if (state.movementCoordinator.statuses.get('worker').plan === 'arrived') break;
    }
    expect(state.staff[0]).toMatchObject({ x: 500, y: 300 });
  });

  it('continues a budget-limited static search instead of restarting it forever', () => {
    let state = world([actor('worker', 80, 100, { x: 880, y: 600 })]);
    for (let index = 0; index < 30; index += 1) state = tick(state);
    expect(Math.hypot(state.staff[0].x - 80, state.staff[0].y - 100)).toBeGreaterThan(0);
  });

  it('does not mistake an invalid requested destination for arrival', () => {
    const next = tick(world([actor('worker', 400, 300, { x: NaN, y: 300 })]));
    expect(next.staff[0]).toMatchObject({ x: 400, y: 300 });
    expect(next.movementCoordinator.statuses.get('worker')).toMatchObject({ plan: 'unreachable', reason: 'invalid-goal' });
  });

  it('replans safely when a leading actor cancels its departure and the follower changes speed', () => {
    let state = world([actor('leader', 440, 300, { x: 600, y: 300 }), actor('follower', 400, 300, { x: 560, y: 300 })]);
    for (let index = 0; index < 10; index += 1) state = tick(state);
    state = { ...state, staff: state.staff.map(worker => worker.id === 'leader'
      ? { ...worker, navigationGoal: null } : worker) };
    const stopped = { ...state.staff[0] };
    for (let index = 0; index < 150; index += 1) {
      state = tick(state, entries(state).map(entry => ({ ...entry, speed: entry.character.id === 'follower' ? 120 : 0 })));
    }
    expect(state.staff[0]).toEqual(stopped);
    expect(state.staff[1]).toMatchObject({ x: 560, y: 300 });
  });

  it('invalidates a route when a new fixture blocks its next segment', () => {
    let state = tick(world([actor('worker', 400, 300, { x: 480, y: 300 })]));
    state = { ...state, chairs: [{ id: 'new-chair', x: 420, y: 300 }] };
    for (let index = 0; index < 100; index += 1) {
      state = tick(state);
      const worker = state.staff[0];
      expect(worker.x >= 420 && worker.x < 440 && worker.y >= 300 && worker.y < 320).toBe(false);
    }
    expect(state.staff[0]).toMatchObject({ x: 480, y: 300 });
  });

  it('rotates bounded planning work so all 24 independent movers finish', () => {
    let state = world(Array.from({ length: 24 }, (_, index) => actor(`worker-${index}`, 300, 100 + index * 20,
      { x: 540, y: 100 + index * 20 })));
    for (let index = 0; index < 900; index += 1) {
      state = tick(state);
      if (state.staff.every(worker => worker.x === 540)) break;
    }
    expect(state.staff.every(worker => worker.x === 540)).toBe(true);
  }, 20000);

  it('holds an aligned checkout advance at the line when its forward segment is blocked', () => {
    const next = actor('next', 840, 200, { x: 840, y: 180 }, { state: 'checkout_moving' });
    const obstruction = actor('obstruction', 840, 180, null, { state: 'waiting' });
    let state = {
      ...world([]),
      cashierStations: [{ id: 'register', x: 800, y: 120, w: 80, h: 40 }],
      customers: [next, obstruction],
    };
    const checkoutEntries = current => [
      {
        character: current.customers.find(customer => customer.id === 'next'),
        speed: 62,
        checkoutAdvance: { stationId: 'register', queueRank: 0 },
      },
      { character: current.customers.find(customer => customer.id === 'obstruction'), speed: 0 },
    ];

    for (let tick = 0; tick < 20; tick += 1) {
      const result = advanceCharacterMovementBatch(state, checkoutEntries(state), 1 / 30);
      expect(result.moved.get('next').x).toBe(840);
      expect(result.coordinator.diagnostics.recoveries.has('next')).toBe(false);
      expect(result.coordinator.conflicts.size).toBe(0);
      state = {
        ...state,
        customers: state.customers.map(customer => result.moved.get(customer.id)),
        movementCoordinator: result.coordinator,
      };
    }

    state = {
      ...state,
      customers: state.customers.filter(customer => customer.id !== 'obstruction'),
    };
    for (let tick = 0; tick < 20; tick += 1) {
      const result = advanceCharacterMovementBatch(state, [{
        character: state.customers[0],
        speed: 62,
        checkoutAdvance: { stationId: 'register', queueRank: 0 },
      }], 1 / 30);
      state = {
        ...state,
        customers: [result.moved.get('next')],
        movementCoordinator: result.coordinator,
      };
    }
    expect(state.customers[0]).toMatchObject({ x: 840, y: 180 });
  });

  it('does not let a rear aligned checkout customer overtake a stalled front customer', () => {
    const front = actor('front', 840, 200, { x: 840, y: 180 }, { state: 'checkout_moving' });
    const rear = actor('rear', 840, 220, { x: 840, y: 200 }, { state: 'checkout_moving' });
    const obstruction = actor('obstruction', 840, 180, null, { state: 'waiting' });
    let state = {
      ...world([]),
      cashierStations: [{ id: 'register', x: 800, y: 120, w: 80, h: 40 }],
      customers: [front, rear, obstruction],
    };

    for (let tick = 0; tick < 40; tick += 1) {
      const result = advanceCharacterMovementBatch(state, [
        { character: state.customers.find(customer => customer.id === 'front'), speed: 62,
          checkoutAdvance: { stationId: 'register', queueRank: 0 } },
        { character: state.customers.find(customer => customer.id === 'rear'), speed: 62,
          checkoutAdvance: { stationId: 'register', queueRank: 1 } },
        { character: state.customers.find(customer => customer.id === 'obstruction'), speed: 0 },
      ], 1 / 30);
      expect(result.moved.get('rear').x).toBe(840);
      expect(result.moved.get('rear').y).toBeGreaterThanOrEqual(200);
      state = {
        ...state,
        customers: state.customers.map(customer => result.moved.get(customer.id)),
        movementCoordinator: result.coordinator,
      };
    }
  });

  it('does not apply retained lateral recovery to an arrived checkout hold', () => {
    const held = actor('held', 840, 200, { x: 840, y: 200 }, { state: 'checkout_moving' });
    const peer = actor('peer', 840, 220, { x: 840, y: 180 }, { state: 'waiting' });
    const previous = createMovementCoordinator();
    previous.records.set('held', {
      goal: { x: 840, y: 200 },
      recovery: {
        goal: { x: 820, y: 200 }, origin: { x: 840, y: 200 },
        peers: [{ id: 'peer', start: { x: 840, y: 220 }, goal: { x: 840, y: 180 } }],
      },
    });
    let state = {
      ...world([]),
      customers: [held, peer],
      movementCoordinator: previous,
    };

    const result = advanceCharacterMovementBatch(state, [
      { character: held, speed: 62, checkoutAdvance: { stationId: 'register', queueRank: 0 } },
      { character: peer, speed: 0 },
    ], 1 / 30);

    expect(result.coordinator.diagnostics.recoveries.has('held')).toBe(false);
    expect(result.moved.get('held')).toMatchObject({ x: 840, y: 200 });
  });
});
