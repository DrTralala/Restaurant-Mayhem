import { describe, expect, it } from 'vitest';
import { createNavigationWorkspace } from '../movement/navigationWorkspace';
import { createGrid } from './grid';
import * as router from './router';
import { planMovement } from './planner';
import { captureNavigation } from './telemetry';

let nextDoorId = 0;

function stateWithDoors(doors = [{ id: `reachability-door-${nextDoorId++}`, y: 340, role: 'entrance' }]) {
  return {
    restaurant: { expansionLevel: 1 },
    tables: [{ id: 'reachability-table', x: 120, y: 140 }],
    chairs: [100, 120, 140, 160, 180, 200, 220].map((y, index) => ({
      id: `partition-${index}`, x: 160, y,
    })),
    kitchenStations: [],
    serviceTables: [],
    washStations: [],
    cashierStations: [],
    doors,
  };
}

function gridWithin(state, bounds, doorFlow = undefined) {
  const workspace = createNavigationWorkspace(state);
  const boundedWorkspace = Object.freeze({
    ...workspace,
    bounds: Object.freeze({ ...bounds }),
  });
  return createGrid(state, boundedWorkspace,
    doorFlow === undefined ? {} : { doorFlow });
}

function assertHasRouteHelper() {
  expect(router.hasRoute).toBeTypeOf('function');
}

function compareWithReference(grid, start, goal) {
  assertHasRouteHelper();
  expect(router.hasRoute(grid, start, goal))
    .toBe(router.findRoute(grid, start, goal).status === 'found');
}

describe('trusted-grid lattice reachability', () => {
  it('matches route search for hundreds of lattice and off-lattice endpoints across disconnected geometry', () => {
    const state = stateWithDoors();
    const grid = gridWithin(state, { left: 100, right: 260, top: 100, bottom: 220 });
    const lattice = [];
    for (let y = 100; y <= 220; y += 20) {
      for (let x = 100; x <= 260; x += 20) lattice.push({ x, y });
    }
    const offLatticeStarts = [
      { x: 100.25, y: 100.75 },
      { x: 119.5, y: 139.75 },
      { x: 139.25, y: 219.5 },
      { x: 159.5, y: 120.5 },
      { x: 160.5, y: 120.5 },
      { x: 239.75, y: 199.25 },
      { x: 259.5, y: 219.5 },
    ];

    const captured = captureNavigation(() => {
      for (let index = 0; index < 240; index += 1) {
        const start = index % 2 === 0
          ? lattice[(index * 7 + 3) % lattice.length]
          : offLatticeStarts[index % offLatticeStarts.length];
        const goal = lattice[(index * 19 + 11) % lattice.length];
        compareWithReference(grid, start, goal);
      }
    });

    expect(captured.report.counters.latticeReachabilityIndexBuilds).toBe(1);
    expect(captured.report.counters.latticeReachabilityIndexHits).toBeGreaterThan(0);
    expect(captured.report.counters.latticeReachabilityIndexNodes).toBe(63);

    expect(router.hasRoute(grid, { x: 120, y: 120 }, { x: 220, y: 120 })).toBe(false);
    expect(router.hasRoute(grid, { x: 120, y: 120 }, { x: 140, y: 120 })).toBe(true);
  });

  it('checks openness before same-point success and falls back for non-lattice goals', () => {
    assertHasRouteHelper();
    const state = stateWithDoors();
    const grid = gridWithin(state, { left: 100, right: 260, top: 100, bottom: 220 });
    const captured = captureNavigation(() => ({
      sameOpen: router.hasRoute(grid, { x: 120, y: 120 }, { x: 120, y: 120 }),
      sameBlocked: router.hasRoute(grid, { x: 160, y: 120 }, { x: 160, y: 120 }),
      nonLatticeGoal: router.hasRoute(grid, { x: 120, y: 120 }, { x: 121.5, y: 120 }),
    }));

    expect(captured.value).toEqual({ sameOpen: true, sameBlocked: false, nonLatticeGoal: true });
    expect(captured.report.counters.routeStarts).toBe(1);
    expect(captured.report.counters.latticeReachabilityFallbacks).toBe(1);
  });

  it('keeps null/empty door IDs and unsupported/absent flow variants separate despite signature aliases', () => {
    assertHasRouteHelper();
    const door = { id: '', y: 340, role: 'entrance' };
    const state = stateWithDoors([door]);
    const bounds = { left: 880, right: 920, top: 300, bottom: 420 };
    const blocked = gridWithin(state, bounds, { direction: 'ingress', doorId: null });
    const permitted = gridWithin(state, bounds, { direction: 'ingress', doorId: '' });
    const start = { x: 880, y: 360 };
    const goal = { x: 920, y: 360 };

    expect(blocked.signature).toBe(permitted.signature);
    expect(router.hasRoute(blocked, start, goal)).toBe(false);
    expect(router.hasRoute(permitted, start, goal)).toBe(true);

    const misaligned = stateWithDoors([{ id: '', y: 331, role: 'entrance' }]);
    const narrowBounds = { left: 880, right: 920, top: 320, bottom: 320 };
    const plain = gridWithin(misaligned, narrowBounds);
    const unsupported = gridWithin(misaligned, narrowBounds,
      { direction: 'sideways', doorId: '' });

    expect(plain.signature).toBe(unsupported.signature);
    expect(router.hasRoute(plain, { x: 880, y: 320 }, { x: 920, y: 320 })).toBe(true);
    expect(router.hasRoute(unsupported, { x: 880, y: 320 }, { x: 920, y: 320 })).toBe(false);
  });

  it('separates denied and explicitly permitted role-mismatch crossings', () => {
    assertHasRouteHelper();
    const state = stateWithDoors([{ id: 'exit-only', y: 340, role: 'exit' }]);
    const bounds = { left: 880, right: 920, top: 300, bottom: 420 };
    const denied = gridWithin(state, bounds, { direction: 'ingress', doorId: 'exit-only' });
    const permitted = gridWithin(state, bounds, {
      direction: 'ingress', doorId: 'exit-only', allowRoleMismatch: true,
    });
    const start = { x: 880, y: 360 };
    const goal = { x: 920, y: 360 };

    expect(router.hasRoute(denied, start, goal)).toBe(false);
    expect(router.hasRoute(permitted, start, goal)).toBe(true);
  });

  it('uses creation-time flow identity but falls back when the live allowed door moves', () => {
    assertHasRouteHelper();
    const door = { id: 'mutable-door', y: 340, role: 'entrance' };
    const state = stateWithDoors([door]);
    const flow = { direction: 'ingress', doorId: 'mutable-door' };
    const flowGrid = gridWithin(state, { left: 880, right: 920, top: 300, bottom: 420 }, flow);
    flow.doorId = 'changed-after-grid-creation';
    const flowCapture = captureNavigation(() =>
      router.hasRoute(flowGrid, { x: 880, y: 360 }, { x: 920, y: 360 }));

    expect(flowCapture.value).toBe(true);
    expect(flowCapture.report.counters.latticeReachabilityFastPaths).toBe(1);
    expect(flowCapture.report.counters.routeStarts || 0).toBe(0);

    const secondDoor = { id: 'mutable-door-2', y: 340, role: 'entrance' };
    const secondState = stateWithDoors([secondDoor]);
    const secondGrid = gridWithin(secondState,
      { left: 880, right: 920, top: 300, bottom: 420 },
      { direction: 'ingress', doorId: 'mutable-door-2' });
    secondDoor.y = 440;
    const doorCapture = captureNavigation(() =>
      router.hasRoute(secondGrid, { x: 880, y: 360 }, { x: 920, y: 360 }));

    expect(doorCapture.value).toBe(
      router.findRoute(secondGrid, { x: 880, y: 360 }, { x: 920, y: 360 }).status === 'found',
    );
    expect(doorCapture.report.counters.latticeReachabilityFallbacks).toBe(1);
    expect(doorCapture.report.counters.routeStarts).toBe(1);

    const mutableFlow = { direction: 'ingress', doorId: 'mutable-door-3' };
    const thirdState = stateWithDoors([
      { id: 'mutable-door-3', y: 340, role: 'entrance' },
    ]);
    const thirdGrid = gridWithin(thirdState,
      { left: 880, right: 920, top: 300, bottom: 420 }, mutableFlow);
    const deniedGrid = gridWithin(thirdState,
      { left: 880, right: 920, top: 300, bottom: 420 },
      { direction: 'ingress', doorId: null });
    expect(router.hasRoute(deniedGrid, { x: 880, y: 360 }, { x: 920, y: 360 })).toBe(false);
    mutableFlow.doorId = null;
    thirdGrid.neighbours({ x: 880, y: 360 });
    mutableFlow.doorId = 'mutable-door-3';
    const restoredCapture = captureNavigation(() =>
      router.hasRoute(thirdGrid, { x: 880, y: 360 }, { x: 920, y: 360 }));

    expect(restoredCapture.value).toBe(true);
    expect(restoredCapture.report.counters.latticeReachabilityFastPaths).toBe(1);
    expect(restoredCapture.report.counters.routeStarts || 0).toBe(0);
  });

  it('does not publish pre-query mutated-flow neighbours into a denied-door grid', () => {
    assertHasRouteHelper();
    const doorId = `mutable-neighbour-door-${nextDoorId++}`;
    const state = stateWithDoors([{ id: doorId, y: 340, role: 'entrance' }]);
    const bounds = { left: 880, right: 920, top: 300, bottom: 420 };
    const flow = { direction: 'ingress', doorId };
    const permitted = gridWithin(state, bounds, flow);
    const start = { x: 880, y: 360 };
    const blockedPoint = { x: 900, y: 360 };
    const goal = { x: 920, y: 360 };

    flow.doorId = null;
    const mutatedQuery = captureNavigation(() => permitted.neighbours(start));
    expect(mutatedQuery.value).toContainEqual(blockedPoint);
    expect(mutatedQuery.report.counters.neighbourCacheKeyBuilds).toBe(1);
    flow.doorId = doorId;

    const denied = gridWithin(state, bounds, { direction: 'ingress', doorId: null });
    const deniedNeighbours = denied.neighbours(start);
    expect(denied.isOpen(blockedPoint)).toBe(false);
    expect(deniedNeighbours).not.toContainEqual(blockedPoint);

    const plan = planMovement({ grid: denied, start, goal, speed: 62, horizon: 2,
      reservations: [], maxExpansions: 128 });
    expect(plan.actions.every(action => denied.segmentClear(action.from, action.to))).toBe(true);
  });

  it('bypasses an already-warm neighbour entry after its captured door record mutates', () => {
    assertHasRouteHelper();
    const door = { id: `warm-mutation-door-${nextDoorId++}`, y: 340, role: 'entrance' };
    const state = stateWithDoors([door]);
    const grid = gridWithin(state, { left: 880, right: 920, top: 300, bottom: 420 },
      { direction: 'ingress', doorId: door.id });
    const start = { x: 900, y: 360 };
    const blockedPoint = { x: 920, y: 360 };

    expect(grid.neighbours(start)).toContainEqual(blockedPoint);
    door.y = 440;
    const captured = captureNavigation(() => grid.neighbours(start));

    expect(grid.segmentClear(start, blockedPoint)).toBe(false);
    expect(captured.value).not.toContainEqual(blockedPoint);
    expect(captured.report.counters.neighbourCacheHits || 0).toBe(0);
  });

  it('does not reuse components for mutable external workspaces or copied grid wrappers', () => {
    assertHasRouteHelper();
    const state = { ...stateWithDoors(), tables: [], chairs: [] };
    const canonical = createNavigationWorkspace(state);
    const mutableBlocked = new Set(canonical.blockedCellKeys);
    const blockedCellKeys = Object.freeze([...mutableBlocked].sort());
    const blockedCells = Object.freeze({
      has: key => mutableBlocked.has(key),
      get size() { return mutableBlocked.size; },
    });
    const mutableWorkspace = Object.freeze({
      ...canonical,
      bounds: Object.freeze({ left: 120, right: 220, top: 120, bottom: 120 }),
      blockedCellKeys,
      blockedCells,
    });
    const grid = createGrid(state, mutableWorkspace);
    const start = { x: 120, y: 120 };
    const goal = { x: 220, y: 120 };

    const mutableCapture = captureNavigation(() => {
      const beforeMutation = router.hasRoute(grid, start, goal);
      mutableBlocked.add('8,6');
      return [beforeMutation, router.hasRoute(grid, start, goal)];
    });
    expect(mutableCapture.value).toEqual([true, false]);
    expect(mutableCapture.report.counters.latticeReachabilityFallbacks).toBe(2);
    expect(mutableCapture.report.counters.routeStarts).toBe(2);

    const copiedGrid = Object.freeze({ ...grid });
    const copiedCapture = captureNavigation(() => router.hasRoute(copiedGrid, start, goal));
    expect(copiedCapture.report.counters.latticeReachabilityFallbacks).toBe(1);
    expect(copiedCapture.report.counters.routeStarts).toBe(1);
  });

  it('bounds each component index to 8192 lattice nodes and evicts old variants', () => {
    assertHasRouteHelper();
    const state = stateWithDoors();
    const workspace = createNavigationWorkspace(state);
    const oversized = createGrid(state, Object.freeze({
      ...workspace,
      bounds: Object.freeze({ left: 0, right: 1800, top: 0, bottom: 1800 }),
    }));
    const oversizedCapture = captureNavigation(() =>
      router.hasRoute(oversized, { x: 100, y: 120 }, { x: 200, y: 120 }));

    expect(oversizedCapture.value).toBe(true);
    expect(oversizedCapture.report.counters.latticeReachabilityFallbacks).toBe(1);
    expect(oversizedCapture.report.counters.latticeReachabilityIndexBuilds || 0).toBe(0);

    const bounds = { left: 100, right: 260, top: 100, bottom: 220 };
    const variants = Array.from({ length: 10 }, (_, index) =>
      gridWithin(state, bounds, { direction: `variant-${index}`, doorId: null }));
    const evictionCapture = captureNavigation(() => {
      for (const variant of variants) {
        expect(router.hasRoute(variant, { x: 120, y: 120 }, { x: 140, y: 120 })).toBe(true);
      }
    });

    expect(evictionCapture.report.counters.latticeReachabilityIndexBuilds).toBe(10);
    expect(evictionCapture.report.counters.latticeReachabilityIndexEvictions).toBeGreaterThan(0);
    expect(evictionCapture.report.counters.latticeReachabilityIndexNodes).toBeLessThanOrEqual(10 * 8192);
  });
});
