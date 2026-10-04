import { describe, expect, it } from 'vitest';
import { createNavigationWorkspace } from '../movement/navigationWorkspace';
import { createGrid, latticeAnchors } from './grid';
import { findRoute } from './router';
import { captureNavigation } from './telemetry';

let nextDoorId = 0;

function openState(doorId = `grid-test-door-${nextDoorId++}`) {
  return {
    restaurant: { expansionLevel: 1 },
    tables: [{ id: 'obstacle', x: 420, y: 280 }],
    chairs: [{ id: 'chair', x: 320, y: 300 }],
    kitchenStations: [],
    serviceTables: [],
    washStations: [],
    cashierStations: [],
    doors: [{ id: doorId, y: 340, role: 'entrance' }],
  };
}

function doorState(door) {
  return {
    restaurant: { expansionLevel: 1 },
    tables: [], chairs: [], kitchenStations: [], serviceTables: [], washStations: [],
    cashierStations: [], doors: [door],
  };
}

function referenceVariant(state, suffix) {
  const doors = state.doors.map((door, index) => ({
    ...door,
    id: `${door.id}-reference-${suffix}-${index}`,
  }));
  return {
    state: { ...state, doors },
    remapFlow: flow => flow && ({
      ...flow,
      doorId: flow.doorId == null
        ? flow.doorId
        : doors[state.doors.findIndex(door => String(door.id) === String(flow.doorId))]?.id,
    }),
  };
}

function latticePoints(grid) {
  const points = [];
  const { bounds } = grid;
  const firstX = Math.ceil(bounds.left / 20) * 20;
  const lastX = Math.floor(bounds.right / 20) * 20;
  const firstY = Math.ceil(bounds.top / 20) * 20;
  const lastY = Math.floor(bounds.bottom / 20) * 20;
  for (let y = firstY; y <= lastY; y += 20) {
    for (let x = firstX; x <= lastX; x += 20) points.push({ x, y });
  }
  return points;
}

function referenceLatticeAnchors(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
  const xs = [...new Set([Math.floor(point.x / 20), Math.ceil(point.x / 20)])];
  const ys = [...new Set([Math.floor(point.y / 20), Math.ceil(point.y / 20)])];
  return ys.flatMap(y => xs.map(x => ({ x: x * 20, y: y * 20 })))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function partitionedSegmentClear(grid, from, to) {
  if (!grid.isOpen(from) || !grid.isOpen(to)) return false;
  const boundaries = [0, 1];
  for (const axis of ['x', 'y']) {
    const delta = to[axis] - from[axis];
    if (delta === 0) continue;
    const minimum = Math.min(from[axis], to[axis]);
    const maximum = Math.max(from[axis], to[axis]);
    for (let coordinate = (Math.floor(minimum / 20) + 1) * 20;
      coordinate < maximum; coordinate += 20) {
      boundaries.push((coordinate - from[axis]) / delta);
    }
  }
  boundaries.sort((left, right) => left - right);
  for (let index = 1; index < boundaries.length; index += 1) {
    const fraction = (boundaries[index - 1] + boundaries[index]) / 2;
    if (!grid.isOpen({
      x: from.x + (to.x - from.x) * fraction,
      y: from.y + (to.y - from.y) * fraction,
    })) return false;
  }
  return true;
}

describe('static navigation grid neighbours', () => {
  it('matches fresh-signature reference grids across lattice, off-lattice, obstacle, and door points', () => {
    const state = openState();
    const flow = { direction: 'ingress', doorId: state.doors[0].id };
    const reference = referenceVariant(state, 'exhaustive');
    const grid = createGrid(state, null, { doorFlow: flow });
    const uncachedReference = createGrid(reference.state, null, {
      doorFlow: reference.remapFlow(flow),
    });
    const points = [
      ...latticePoints(grid),
      { x: 419.9, y: 319.9 },
      { x: 420.1, y: 279.9 },
      { x: 899.25, y: 339.5 },
      { x: 900.5, y: 359.5 },
      { x: 902.1, y: 379.999 },
      { x: 907.5, y: 380 },
      { x: 51, y: 51 },
      { x: 1029.5, y: 719.5 },
    ];

    for (const point of points) {
      // Each reference point is queried once under a distinct signature, so
      // its first result is produced without a neighbour-cache hit.
      const expected = uncachedReference.neighbours(point);
      expect(grid.neighbours(point)).toEqual(expected);
      expect(grid.neighbours(point)).toEqual(expected);
      expect(grid.connectors(point)).toEqual(uncachedReference.connectors(point));
    }
  });

  it('keeps adjacent lattice segment clearance equal to the partitioned reference at corners and doors', () => {
    const grid = createGrid(openState());
    const offsets = [[0, -20], [-20, 0], [20, 0], [0, 20]];
    for (const point of latticePoints(grid)) {
      for (const [dx, dy] of offsets) {
        const next = { x: point.x + dx, y: point.y + dy };
        expect(grid.segmentClear(point, next)).toBe(partitionedSegmentClear(grid, point, next));
      }
    }

    const misalignedDoorState = openState();
    misalignedDoorState.doors[0].y = 331;
    const directional = createGrid(misalignedDoorState, null, {
      doorFlow: { direction: 'ingress', doorId: misalignedDoorState.doors[0].id },
    });
    const crossing = [{ x: 900, y: 320 }, { x: 920, y: 320 }];
    expect(crossing.every(point => directional.isOpen(point))).toBe(true);
    expect(directional.segmentClear(...crossing)).toBe(false);
  });

  it('matches partitioned clearance for same-cell and adjacent-axis shortcut classes', () => {
    const state = doorState({ id: 'segment-shortcut-door', y: 340, role: 'entrance' });
    const grid = createGrid(state);
    const pairs = [
      [{ x: 100.25, y: 200.25 }, { x: 119.75, y: 219.75 }],
      [{ x: 100.5, y: 300.25 }, { x: 100.5, y: 319.75 }],
      [{ x: 119.99999999999999, y: 300.5 }, { x: 120.00000000000001, y: 300.5 }],
      [{ x: 100.5, y: 200.5 }, { x: 120.5, y: 200.5 }],
      [{ x: 119.75, y: 319.75 }, { x: 120.25, y: 320.25 }],
    ];
    const captured = captureNavigation(() => {
      for (const [from, to] of pairs) {
        expect(grid.segmentClear(from, to)).toBe(partitionedSegmentClear(grid, from, to));
      }

      const blockedCorner = createGrid({
        ...state, tables: [{ id: 'corner-blocker', x: 120, y: 300 }],
      });
      const corner = [{ x: 119.75, y: 299.75 }, { x: 120.25, y: 300.25 }];
      expect(blockedCorner.segmentClear(...corner))
        .toBe(partitionedSegmentClear(blockedCorner, ...corner));

      const canonical = createNavigationWorkspace(state);
      const negativeWorkspace = Object.freeze({
        ...canonical,
        bounds: Object.freeze({ ...canonical.bounds, left: -40, top: -40 }),
      });
      const negativeGrid = createGrid(state, negativeWorkspace);
      const negativePairs = [
        [{ x: -0, y: 200.25 }, { x: 10, y: 219.75 }],
        [{ x: -10, y: 200.25 }, { x: 10, y: 200.25 }],
      ];
      for (const [from, to] of negativePairs) {
        expect(negativeGrid.segmentClear(from, to))
          .toBe(partitionedSegmentClear(negativeGrid, from, to));
      }

      const extremeWorkspace = Object.freeze({
        ...canonical,
        bounds: Object.freeze({
          ...canonical.bounds, left: -Number.MAX_VALUE, top: -Number.MAX_VALUE,
        }),
      });
      const extremeGrid = createGrid(state, extremeWorkspace);
      const extreme = { x: -1e100, y: -1e100 };
      expect(extremeGrid.segmentClear(extreme, extreme))
        .toBe(partitionedSegmentClear(extremeGrid, extreme, extreme));

      const misalignedState = doorState({ id: 'misaligned', y: 331, role: 'entrance' });
      const directional = createGrid(misalignedState, null, {
        doorFlow: { direction: 'ingress', doorId: 'misaligned' },
      });
      const permitted = [{ x: 900.1, y: 340.5 }, { x: 919.9, y: 340.5 }];
      const denied = [{ x: 900.1, y: 320.5 }, { x: 919.9, y: 320.5 }];
      expect(permitted.every(point => directional.isOpen(point))).toBe(true);
      expect(directional.segmentClear(...permitted)).toBe(true);
      expect(denied.every(point => directional.isOpen(point))).toBe(true);
      expect(directional.segmentClear(...denied)).toBe(false);
    });

    expect(captured.report.counters.segmentSameCellShortcuts).toBeGreaterThan(0);
    expect(captured.report.counters.segmentAdjacentAxisShortcuts).toBeGreaterThan(0);
    expect(captured.report.counters.segmentBoundaryPartitionsBuilt).toBeGreaterThan(0);
  });

  it('short-circuits segments confined to two adjacent cells sharing an edge', () => {
    const grid = createGrid(doorState({ id: 'adjacent-cell-door', y: 340, role: 'entrance' }));
    const pairs = [
      [{ x: 100.25, y: 200.25 }, { x: 120.25, y: 219.75 }],
      [{ x: 120.25, y: 219.75 }, { x: 100.25, y: 200.25 }],
      [{ x: 200.25, y: 100.25 }, { x: 219.75, y: 120.25 }],
      [{ x: 319.75, y: 120.25 }, { x: 300.25, y: 100.25 }],
      [
        { x: 119.99999999999999, y: 200.00000000000003 },
        { x: 120.00000000000001, y: 219.99999999999997 },
      ],
    ];
    const captured = captureNavigation(() => {
      for (const [from, to] of pairs) {
        expect(grid.segmentClear(from, to)).toBe(partitionedSegmentClear(grid, from, to));
      }
    });

    expect(captured.report.counters.segmentAdjacentCellShortcuts).toBe(pairs.length);
    expect(captured.report.counters.segmentBoundaryPartitionsBuilt || 0).toBe(0);

    const blockedSideState = doorState({ id: 'diagonal-side-cell-door', y: 340, role: 'entrance' });
    blockedSideState.chairs = [{ id: 'diagonal-side-blocker', x: 100, y: 280 }];
    const blockedSideCell = createGrid(blockedSideState);
    const diagonal = [{ x: 119.75, y: 310.25 }, { x: 120.1, y: 290.25 }];
    expect(diagonal.every(point => blockedSideCell.isOpen(point))).toBe(true);
    expect(blockedSideCell.segmentClear(...diagonal)).toBe(false);
    expect(blockedSideCell.segmentClear(...diagonal))
      .toBe(partitionedSegmentClear(blockedSideCell, ...diagonal));
  });

  it('retains mutable-workspace and accessor-point partition fallbacks', () => {
    const state = doorState({ id: 'mutable-segment-door', y: 340, role: 'entrance' });
    const canonical = createNavigationWorkspace(state);
    let destinationCellChecks = 0;
    const customWorkspace = Object.freeze({
      ...canonical,
      blockedCells: Object.freeze({
        size: 0,
        has: key => key === '6,10' && ++destinationCellChecks >= 2,
      }),
    });
    const customGrid = createGrid(state, customWorkspace);
    const from = { x: 100.25, y: 200.25 };
    const to = { x: 120.25, y: 219.75 };
    const customCapture = captureNavigation(() => {
      expect(customGrid.segmentClear(from, to)).toBe(false);
    });
    expect(customCapture.report.counters.segmentAdjacentCellShortcuts || 0).toBe(0);
    expect(customCapture.report.counters.segmentBoundaryPartitionsBuilt).toBe(1);

    const trustedGrid = createGrid(state);
    const accessorFrom = Object.defineProperties({}, {
      x: { get: () => 100.25 }, y: { get: () => 200.25 },
    });
    const accessorTo = Object.defineProperties({}, {
      x: { get: () => 120.25 }, y: { get: () => 219.75 },
    });
    const accessorCapture = captureNavigation(() => {
      expect(trustedGrid.segmentClear(accessorFrom, accessorTo))
        .toBe(partitionedSegmentClear(trustedGrid, accessorFrom, accessorTo));
    });
    expect(accessorCapture.report.counters.segmentAdjacentCellShortcuts || 0).toBe(0);
    expect(accessorCapture.report.counters.segmentBoundaryPartitionsBuilt).toBe(1);
  });

  it('checks the live allowed-door opening before adjacent-cell shortcuts', () => {
    const state = doorState({ id: 'adjacent-cell-live-door', y: 331, role: 'entrance' });
    const directional = createGrid(state, null, {
      doorFlow: { direction: 'ingress', doorId: 'adjacent-cell-live-door' },
    });
    const permitted = [{ x: 899.9, y: 340.5 }, { x: 919.9, y: 359.5 }];
    const denied = [{ x: 899.9, y: 320.5 }, { x: 919.9, y: 339.5 }];

    expect(permitted.every(point => directional.isOpen(point))).toBe(true);
    expect(directional.segmentClear(...permitted)).toBe(true);
    expect(denied.every(point => directional.isOpen(point))).toBe(true);
    expect(directional.segmentClear(...denied)).toBe(false);
  });

  it('returns defensive arrays and points while recording avoided lattice candidate builds', () => {
    const state = openState();
    const grid = createGrid(state);
    const source = { x: 400, y: 300 };
    const captured = captureNavigation(() => {
      const first = grid.neighbours(source);
      const expected = first.map(point => ({ ...point }));
      const firstPoint = first[0];
      first[0].x = -1000;
      first.push({ x: -2000, y: -2000 });
      source.x = 401;

      const second = grid.neighbours({ x: 400, y: 300 });
      expect(second).toEqual(expected);
      expect(second).not.toBe(first);
      expect(second[0]).not.toBe(firstPoint);
      second[0].y = -3000;

      const third = grid.neighbours({ x: 400, y: 300 });
      expect(third).toEqual(expected);
      expect(grid.neighbours({ x: 400.5, y: 300.5 })).toEqual(
        grid.neighbours({ x: 400.5, y: 300.5 }),
      );
    });

    expect(captured.report.counters.neighbourCandidateBuilds).toBe(1);
    expect(captured.report.counters.neighbourCacheHits).toBe(2);
    expect(captured.report.counters.segmentBoundaryPartitionsAvoided).toBeGreaterThan(0);
  });

  it('builds cardinal candidate points on cache misses and bypasses, not cache hits', () => {
    const state = doorState({ id: 'candidate-allocation-door', y: 340, role: 'entrance' });
    const workspace = createNavigationWorkspace(state);
    const mutable = new Set(workspace.blockedCellKeys);
    const untrustedWorkspace = Object.freeze({
      ...workspace,
      blockedCells: Object.freeze({ has: key => mutable.has(key), size: mutable.size }),
    });
    const cachedGrid = createGrid(state, workspace);
    const bypassGrid = createGrid(state, untrustedWorkspace);
    const source = { x: 400, y: 300 };
    const captured = captureNavigation(() => {
      for (let index = 0; index < 8; index += 1) cachedGrid.neighbours(source);
      for (let index = 0; index < 3; index += 1) bypassGrid.neighbours(source);
    });

    expect(captured.report.counters.neighbourCandidatePointsBuilt).toBe(16);
    expect(captured.report.counters.neighbourCandidateBuilds).toBe(1);
    expect(captured.report.counters.neighbourCacheHits).toBe(7);
  });

  it('acquires the shared signature cache once per grid across repeated lattice requests', () => {
    const grid = createGrid(openState());
    const points = latticePoints(grid).filter(point => grid.isOpen(point)).slice(0, 32);
    const captured = captureNavigation(() => {
      for (const point of points) grid.neighbours(point);
      for (let index = 0; index < 32; index += 1) {
        grid.neighbours({ x: 400, y: 300 });
      }
    });

    expect(captured.report.counters.neighbourCacheSignatureAcquisitions).toBe(1);
    expect(captured.report.counters.neighbourCacheHits).toBeGreaterThan(0);
  });

  it('builds neighbour keys lazily and reuses a validated raster snapshot', () => {
    const state = doorState({ id: 'lazy-raster-door', y: 340, role: 'entrance' });
    const workspace = createNavigationWorkspace(state);
    const captured = captureNavigation(() => {
      createGrid(state, workspace);
      const first = createGrid(state, workspace);
      const second = createGrid(state, workspace);
      first.neighbours({ x: 400, y: 300 });
      first.neighbours({ x: 400, y: 300 });
      second.neighbours({ x: 400, y: 300 });
    });

    expect(captured.report.counters.neighbourCacheKeyBuilds).toBe(2);
    expect(captured.report.counters.neighbourRasterKeyBuilds).toBe(1);
  });

  it('matches reference lattice-anchor order at cell edges and falls back for unsafe magnitudes', () => {
    const coordinates = [
      -40.00000000000001, -40, -39.99999999999999,
      -20.000000000000004, -20, -19.999999999999996,
      -Number.EPSILON, -0, 0, Number.EPSILON,
      19.999999999999996, 20, 20.000000000000004,
      40.00000000000001,
      Number.MIN_VALUE, -Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER * 20, -Number.MAX_SAFE_INTEGER * 20,
      Number.MAX_VALUE, -Number.MAX_VALUE,
    ];
    const points = coordinates.flatMap(x => coordinates.map(y => ({ x, y })));
    points.push(null, { x: Number.NaN, y: 20 }, { x: 20, y: Number.POSITIVE_INFINITY });

    const captured = captureNavigation(() => {
      for (const point of points) {
        const actual = latticeAnchors(point);
        const expected = referenceLatticeAnchors(point);
        const samePoint = (left, right) => Object.is(left.x, right.x) && Object.is(left.y, right.y);
        if (actual.length !== expected.length || actual.some((anchor, index) => !samePoint(anchor, expected[index]))) {
          const display = value => Object.is(value, -0) ? '-0' : String(value);
          throw new Error(`Lattice anchors differ at ${display(point?.x)},${display(point?.y)}`);
        }
      }
    });
    expect(captured.report.counters.latticeAnchorFastPaths).toBeGreaterThan(0);
    expect(captured.report.counters.latticeAnchorFallbacks).toBeGreaterThan(0);
  });

  it('reuses trusted flow rasters across calls while keying flow objects by their captured values', () => {
    const state = doorState({ id: 'entry', y: 340, role: 'entrance' });
    state.doors = [
      { id: 'entry', y: 340, role: 'entrance' },
      { id: 'second-entry', y: 440, role: 'entrance' },
    ];
    const workspace = createNavigationWorkspace(state);
    const flow = { direction: 'ingress', doorId: 'entry' };
    const options = { doorFlow: flow };
    const captured = captureNavigation(() => {
      const first = createGrid(state, workspace, options);
      expect(first.isOpen({ x: 900, y: 360 })).toBe(true);
      expect(first.isOpen({ x: 900, y: 460 })).toBe(false);

      flow.doorId = 'second-entry';
      const second = createGrid(state, workspace, options);
      expect(second.isOpen({ x: 900, y: 360 })).toBe(false);
      expect(second.isOpen({ x: 900, y: 460 })).toBe(true);

      flow.doorId = 'entry';
      const restored = createGrid(state, workspace, options);
      expect(restored.isOpen({ x: 900, y: 360 })).toBe(true);
      expect(restored.isOpen({ x: 900, y: 460 })).toBe(false);
    });

    expect(captured.report.counters.flowBlockedRasterBuilds).toBe(2);
    expect(captured.report.counters.flowBlockedRasterCacheHits).toBe(1);
    expect(captured.report.counters.flowBlockedCellKeysCopied)
      .toBe(workspace.blockedCellKeys.length * 2);
  });

  it('keys flow rasters by changed door records while keeping a selected door Y live on old grids', () => {
    const state = doorState({ id: 'entry', y: 340, role: 'entrance' });
    const originalWorkspace = createNavigationWorkspace(state);
    const flow = { direction: 'ingress', doorId: 'entry' };
    const captured = captureNavigation(() => {
      const original = createGrid(state, originalWorkspace, { doorFlow: flow });
      const crossing = [{ x: 900, y: 340 }, { x: 920, y: 340 }];
      expect(crossing.every(point => original.isOpen(point))).toBe(true);
      expect(original.segmentClear(...crossing)).toBe(true);
      expect(original.isOpen({ x: 900, y: 380 })).toBe(false);

      state.doors[0].y = 341;
      expect(original.segmentClear(...crossing)).toBe(false);
      const movedWorkspace = createNavigationWorkspace(state);
      const moved = createGrid(state, movedWorkspace, { doorFlow: flow });
      expect(moved.isOpen({ x: 900, y: 380 })).toBe(true);
      expect(original.isOpen({ x: 900, y: 380 })).toBe(false);
      return movedWorkspace;
    });

    expect(captured.report.counters.flowBlockedRasterBuilds).toBe(2);
    expect(captured.report.counters.flowBlockedRasterCacheHits || 0).toBe(0);
    expect(captured.report.counters.flowBlockedCellKeysCopied).toBe(
      originalWorkspace.blockedCellKeys.length + captured.value.blockedCellKeys.length,
    );
  });

  it('bypasses flow-raster reuse for mutable workspaces, invalid flows, and getter-backed options', () => {
    const state = doorState({ id: 'entry', y: 340, role: 'entrance' });
    state.doors = [
      { id: 'entry', y: 340, role: 'entrance' },
      { id: 'second-entry', y: 440, role: 'entrance' },
    ];
    const workspace = createNavigationWorkspace(state);
    const mutable = new Set(workspace.blockedCellKeys);
    const untrusted = Object.freeze({
      ...workspace,
      blockedCells: Object.freeze({ has: key => mutable.has(key), size: mutable.size }),
    });
    const getterFlow = { direction: 'ingress', doorId: 'entry' };
    const getterOptions = {};
    Object.defineProperty(getterOptions, 'doorFlow', { get: () => getterFlow });
    const captured = captureNavigation(() => {
      createGrid(state, untrusted, { doorFlow: getterFlow });
      createGrid(state, untrusted, { doorFlow: getterFlow });
      createGrid(state, workspace, { doorFlow: { direction: 'sideways', doorId: 'entry' } });
      createGrid(state, workspace, getterOptions);
      createGrid(state, workspace, getterOptions);
      createGrid(state, workspace, { doorFlow: null });
    });

    expect(captured.report.counters.flowBlockedRasterBuilds).toBe(4);
    expect(captured.report.counters.flowBlockedRasterCacheHits || 0).toBe(0);
    expect(captured.report.counters.flowBlockedCellKeysCopied)
      .toBe(workspace.blockedCellKeys.length * 4);
  });

  it('bounds flow-raster reuse and rebuilds a variant after eviction', () => {
    const state = doorState({ id: 'entry', y: 340, role: 'entrance' });
    const workspace = createNavigationWorkspace(state);
    const captured = captureNavigation(() => {
      for (let index = 0; index < 9; index += 1) {
        createGrid(state, workspace, {
          doorFlow: { direction: 'ingress', doorId: `missing-entry-${index}` },
        });
      }
      createGrid(state, workspace, {
        doorFlow: { direction: 'ingress', doorId: 'missing-entry-0' },
      });
    });

    expect(captured.report.counters.flowBlockedRasterBuilds).toBe(10);
    expect(captured.report.counters.flowBlockedRasterCacheHits || 0).toBe(0);
    expect(captured.report.counters.flowBlockedRasterCacheEvictions).toBeGreaterThan(0);
    expect(captured.report.counters.flowBlockedCellKeysCopied)
      .toBe(workspace.blockedCellKeys.length * 10);
  });

  it('memoises exact off-lattice points per grid and returns defensive cached copies', () => {
    const state = doorState({ id: 'off-lattice-door', y: 340, role: 'entrance' });
    const source = { x: 401.25, y: 301.5 };
    const expected = createGrid(state).neighbours(source).map(point => ({ ...point }));
    const grid = createGrid(state);
    const captured = captureNavigation(() => {
      const first = grid.neighbours(source);
      first[0].x = -100;
      first.push({ x: -200, y: -200 });
      expect(grid.neighbours({ x: 401.25, y: 301.5 })).toEqual(expected);

      source.x = 421.25;
      expect(grid.neighbours(source)).not.toEqual(expected);
      source.x = 401.25;
      expect(grid.neighbours(source)).toEqual(expected);

      const otherGrid = createGrid(state);
      expect(otherGrid.neighbours({ x: 401.25, y: 301.5 })).toEqual(expected);
    });

    expect(captured.report.counters.offLatticeNeighbourCacheHits).toBe(2);
    expect(captured.report.counters.latticeAnchorFastPaths).toBe(3);
  });

  it('keeps off-lattice results separate across grid bounds and call order', () => {
    const state = doorState({ id: 'off-lattice-bounds-door', y: 340, role: 'entrance' });
    state.restaurant.expansionLevel = 2;
    const workspace = createNavigationWorkspace(state);
    const boundedWorkspace = right => Object.freeze({
      ...workspace,
      bounds: Object.freeze({ ...workspace.bounds, right }),
    });
    const wide = createGrid(state, workspace);
    const narrow999 = createGrid(state, boundedWorkspace(999.5));
    const narrow979 = createGrid(state, boundedWorkspace(979.5));
    const pointNear999 = { x: 999.25, y: 300.5 };
    const pointNear979 = { x: 979.25, y: 300.5 };

    wide.neighbours(pointNear999);
    narrow999.neighbours(pointNear999);
    expect(wide.neighbours(pointNear999)).toContainEqual({ x: 1000, y: 300 });
    expect(narrow999.neighbours(pointNear999)).not.toContainEqual({ x: 1000, y: 300 });

    narrow979.neighbours(pointNear979);
    wide.neighbours(pointNear979);
    expect(narrow979.neighbours(pointNear979)).not.toContainEqual({ x: 980, y: 300 });
    expect(wide.neighbours(pointNear979)).toContainEqual({ x: 980, y: 300 });
  });

  it('bypasses off-lattice hits after selected door Y changes and for accessor points', () => {
    const state = doorState({ id: 'live-off-lattice-door', y: 340, role: 'entrance' });
    const grid = createGrid(state, null, {
      doorFlow: { direction: 'ingress', doorId: 'live-off-lattice-door' },
    });
    const point = { x: 903.5, y: 340 };
    const captured = captureNavigation(() => {
      expect(grid.neighbours(point)).toContainEqual({ x: 920, y: 340 });
      state.doors[0].y = 341;
      expect(grid.neighbours(point)).not.toContainEqual({ x: 920, y: 340 });
    });
    expect(captured.report.counters.offLatticeNeighbourCacheHits || 0).toBe(0);

    const plainState = doorState({ id: 'accessor-off-lattice-door', y: 340, role: 'entrance' });
    const trusted = createGrid(plainState);
    const canonical = createNavigationWorkspace(plainState);
    const mutable = new Set(canonical.blockedCellKeys);
    const fallback = createGrid(plainState, Object.freeze({
      ...canonical,
      blockedCells: Object.freeze({ has: key => mutable.has(key), size: mutable.size }),
    }));
    const reads = { x: 0, y: 0 };
    const accessorPoint = Object.defineProperties({}, {
      x: { get: () => { reads.x += 1; return 401.25; } },
      y: { get: () => { reads.y += 1; return 301.5; } },
    });
    const accessorCapture = captureNavigation(() => {
      const first = trusted.neighbours(accessorPoint);
      const trustedReads = { ...reads };
      reads.x = 0;
      reads.y = 0;
      expect(fallback.neighbours(accessorPoint)).toEqual(first);
      expect(reads).toEqual(trustedReads);
      reads.x = 0;
      reads.y = 0;
      expect(trusted.neighbours(accessorPoint)).toEqual(first);
      expect(reads).toEqual(trustedReads);
    });
    expect(accessorCapture.report.counters.offLatticeNeighbourCacheHits || 0).toBe(0);
    expect(accessorCapture.report.counters.latticeAnchorFastPaths).toBe(3);
  });

  it('bounds each grid off-lattice memo and evicts its oldest point', () => {
    const grid = createGrid(doorState({ id: 'bounded-off-lattice-door', y: 340, role: 'entrance' }));
    const points = Array.from({ length: 65 }, (_, index) => ({
      x: 100 + index * 0.25,
      y: 500.25,
    }));
    const captured = captureNavigation(() => {
      for (const point of points) grid.neighbours(point);
      grid.neighbours(points[0]);
    });

    expect(captured.report.counters.latticeAnchorFastPaths).toBe(66);
    expect(captured.report.counters.offLatticeNeighbourCacheHits || 0).toBe(0);
    expect(captured.report.counters.offLatticeNeighbourCacheEvictions).toBeGreaterThan(0);
  });

  it('keeps cached neighbours isolated across topology and door-flow permission changes', () => {
    const state = openState();
    const original = createGrid(state);
    state.chairs.push({ id: 'new-obstacle', x: 380, y: 300 });
    const changed = createGrid(state);
    const point = { x: 400, y: 300 };
    expect(original.signature).not.toBe(changed.signature);
    expect(original.isOpen(point)).toBe(true);
    expect(changed.isOpen(point)).toBe(true);
    expect(original.neighbours(point)).toContainEqual({ x: 380, y: 300 });
    expect(changed.neighbours(point)).not.toContainEqual({ x: 380, y: 300 });

    const ingress = createGrid(state, null, {
      doorFlow: { direction: 'ingress', doorId: state.doors[0].id },
    });
    const denied = createGrid(state, null, {
      doorFlow: { direction: 'egress', doorId: state.doors[0].id },
    });
    const doorway = { x: 900, y: 360 };
    expect(ingress.signature).not.toBe(denied.signature);
    expect(ingress.neighbours(doorway)).toContainEqual({ x: 920, y: 360 });
    expect(denied.neighbours(doorway)).not.toContainEqual({ x: 920, y: 360 });

    const permissive = createGrid(state, null, {
      doorFlow: {
        direction: 'egress', doorId: state.doors[0].id, allowRoleMismatch: true,
      },
    });
    expect(permissive.signature).not.toBe(denied.signature);
    expect(permissive.neighbours(doorway)).toContainEqual({ x: 920, y: 360 });
  });

  it('separates null and empty door IDs regardless of which flow grid populates the cache first', () => {
    for (const [index, first] of ['blocked', 'permitted'].entries()) {
      const state = doorState({ id: '', y: index === 0 ? 340 : 440, role: 'entrance' });
      const y = state.doors[0].y + 20;
      const source = { x: 880, y };
      const blocked = createGrid(state, null, {
        doorFlow: { direction: 'ingress', doorId: null },
      });
      const permitted = createGrid(state, null, {
        doorFlow: { direction: 'ingress', doorId: '' },
      });
      expect(blocked.signature).toBe(permitted.signature);

      const grids = { blocked, permitted };
      grids[first].neighbours(source);
      grids[first === 'blocked' ? 'permitted' : 'blocked'].neighbours(source);

      expect(blocked.neighbours(source)).not.toContainEqual({ x: 900, y });
      expect(permitted.neighbours(source)).toContainEqual({ x: 900, y });
    }
  });

  it.each([
    ['unrecognised direction', { direction: 'sideways', doorId: '' }, 331],
    ['omitted direction', { doorId: '' }, 351],
  ])('separates %s from no flow and prevents an unsafe planner edge in both call orders', (_label, doorFlow, baseDoorY) => {
    for (const [index, first] of ['plain', 'restricted'].entries()) {
      const doorY = baseDoorY + index * 20;
      const state = doorState({ id: '', y: doorY, role: 'entrance' });
      const start = { x: 900, y: Math.floor((doorY - 1) / 20) * 20 };
      const goal = { x: 920, y: start.y };
      const plain = createGrid(state);
      const restricted = createGrid(state, null, { doorFlow });
      expect(plain.signature).toBe(restricted.signature);
      expect(plain.isOpen(start)).toBe(true);
      expect(restricted.isOpen(start)).toBe(true);
      expect(plain.segmentClear(start, goal)).toBe(true);
      expect(restricted.segmentClear(start, goal)).toBe(false);

      const grids = { plain, restricted };
      grids[first].neighbours(start);
      grids[first === 'plain' ? 'restricted' : 'plain'].neighbours(start);
      expect(plain.neighbours(start)).toContainEqual(goal);
      expect(restricted.neighbours(start)).not.toContainEqual(goal);

      const route = findRoute(restricted, start, goal);
      expect(route.status).toBe('found');
      expect(route.points).not.toEqual([goal]);
      let previous = start;
      for (const point of route.points) {
        expect(restricted.segmentClear(previous, point)).toBe(true);
        previous = point;
      }
    }
  });

  it.each([
    ['a frozen Set', mutable => Object.freeze(mutable)],
    ['an arbitrary frozen has-wrapper', mutable => Object.freeze({
      has: key => mutable.has(key), size: mutable.size,
    })],
  ])('bypasses neighbour memoisation for %s even when its frozen snapshot survives', (_label, wrap) => {
    const state = doorState({ id: 'mutable-workspace-door', y: 340, role: 'entrance' });
    const canonical = createNavigationWorkspace(state);
    const mutableBlocked = new Set(canonical.blockedCellKeys);
    mutableBlocked.add('21,15');
    const blockedCellKeys = Object.freeze([...mutableBlocked].sort());
    const blockedCells = wrap(mutableBlocked);
    const workspace = Object.freeze({
      ...canonical,
      blockedCells,
      blockedCellKeys,
      topologyFingerprint: 'frozen-but-mutable-lookup',
    });
    const existingGrid = createGrid(state, workspace);
    const source = { x: 400, y: 300 };
    const east = { x: 420, y: 300 };
    const north = { x: 400, y: 280 };
    const initialSize = mutableBlocked.size;

    expect(existingGrid.neighbours(source)).not.toContainEqual(east);
    mutableBlocked.delete('21,15');
    mutableBlocked.add('20,14');
    expect(mutableBlocked.size).toBe(initialSize);

    const newGrid = createGrid(state, workspace);
    for (const grid of [existingGrid, newGrid]) {
      expect(grid.neighbours(source)).toContainEqual(east);
      expect(grid.neighbours(source)).not.toContainEqual(north);
    }
  });

  it('does not memoise malformed topology fingerprints or geometry that JSON can alias', () => {
    const state = doorState({ id: 'workspace-door', y: 340, role: 'entrance' });
    const openWorkspace = createNavigationWorkspace(state);
    const blockedState = { ...state, tables: [{ id: 'workspace-blocker', x: 420, y: 280 }] };
    const blockedWorkspace = createNavigationWorkspace(blockedState);
    const malformedNaN = Object.freeze({ ...openWorkspace, state, topologyFingerprint: Number.NaN });
    const malformedNull = Object.freeze({ ...blockedWorkspace, state, topologyFingerprint: null });
    const malformedGrid = createGrid(state, malformedNaN);
    const nullFingerprintGrid = createGrid(state, malformedNull);
    const source = { x: 400, y: 300 };
    const malformedCapture = captureNavigation(() => {
      for (const [first, second] of [[malformedGrid, nullFingerprintGrid], [nullFingerprintGrid, malformedGrid]]) {
        first.neighbours(source);
        second.neighbours(source);
        expect(malformedGrid.neighbours(source)).toContainEqual({ x: 420, y: 300 });
        expect(nullFingerprintGrid.neighbours(source)).not.toContainEqual({ x: 420, y: 300 });
      }
    });
    expect(malformedCapture.report.counters.neighbourCacheSignatureAcquisitions || 0).toBe(0);
    expect(malformedCapture.report.counters.neighbourCacheKeyBuilds).toBe(2);
    expect(malformedCapture.report.counters.neighbourRasterKeyBuilds || 0).toBe(0);

    const malformed = Object.freeze({ ...openWorkspace, state, topologyFingerprint: null });
    const stringAlias = Object.freeze({ ...blockedWorkspace, state, topologyFingerprint: 'null' });
    const invalidFingerprintGrid = createGrid(state, malformed);
    const stringGrid = createGrid(state, stringAlias);
    expect(invalidFingerprintGrid.signature).toBe(stringGrid.signature);

    const captured = captureNavigation(() => {
      for (const [first, second] of [[invalidFingerprintGrid, stringGrid], [stringGrid, invalidFingerprintGrid]]) {
        first.neighbours(source);
        second.neighbours(source);
        expect(invalidFingerprintGrid.neighbours(source)).toContainEqual({ x: 420, y: 300 });
        expect(stringGrid.neighbours(source)).not.toContainEqual({ x: 420, y: 300 });
      }
    });
    expect(captured.report.counters.neighbourCacheSignatureAcquisitions).toBe(1);
    expect(captured.report.counters.neighbourRasterKeyBuilds).toBe(1);
  });

  it('keys cached neighbours by exact workspace bounds and current door-wall position', () => {
    const state = doorState({ id: '', y: 340, role: 'entrance' });
    state.restaurant.expansionLevel = 2;
    const workspace = createNavigationWorkspace(state);
    const boundedWorkspace = right => Object.freeze({
      ...workspace,
      bounds: Object.freeze({ ...workspace.bounds, right }),
    });
    const wide = createGrid(state, workspace);
    const narrow1000 = createGrid(state, boundedWorkspace(1000));
    const narrow980 = createGrid(state, boundedWorkspace(980));
    expect(wide.signature).toBe(narrow1000.signature);
    expect(wide.signature).toBe(narrow980.signature);
    expect(wide.isOpen({ x: 1000, y: 300 })).toBe(true);
    expect(wide.isOpen({ x: 1020, y: 300 })).toBe(true);
    expect(wide.segmentClear({ x: 1000, y: 300 }, { x: 1020, y: 300 })).toBe(true);
    for (const [first, second, point, east, firstAllows] of [
      [wide, narrow1000, { x: 1000, y: 300 }, { x: 1020, y: 300 }, true],
      [narrow980, wide, { x: 980, y: 300 }, { x: 1000, y: 300 }, false],
    ]) {
      first.neighbours(point);
      expect(first.neighbours(point).some(candidate => candidate.x === east.x && candidate.y === east.y))
        .toBe(firstAllows);
      second.neighbours(point);
      expect(second.neighbours(point).some(candidate => candidate.x === east.x && candidate.y === east.y))
        .toBe(!firstAllows);
    }

    const flow = { direction: 'sideways', doorId: '' };
    const doorwayPoint = { x: 900, y: 320 };
    const farDoor = createGrid(state, workspace, { doorFlow: flow });
    state.restaurant.expansionLevel = 1;
    const nearDoor = createGrid(state, workspace, { doorFlow: flow });
    state.restaurant.expansionLevel = 2;
    expect(nearDoor.signature).toBe(farDoor.signature);
    expect(nearDoor.segmentClear(doorwayPoint, { x: 920, y: 320 })).toBe(false);
    expect(farDoor.segmentClear(doorwayPoint, { x: 920, y: 320 })).toBe(true);
    nearDoor.neighbours(doorwayPoint);
    farDoor.neighbours(doorwayPoint);
    expect(nearDoor.neighbours(doorwayPoint)).not.toContainEqual({ x: 920, y: 320 });
    expect(farDoor.neighbours(doorwayPoint)).toContainEqual({ x: 920, y: 320 });
  });

  it('bounds retained lattice entries per signature and across grid signatures', () => {
    const state = openState();
    const grid = createGrid(state);
    const points = latticePoints(grid).filter(point => grid.isOpen(point)).slice(0, 513);
    expect(points).toHaveLength(513);

    const pointCacheCapture = captureNavigation(() => {
      for (const point of points) grid.neighbours(point);
      grid.neighbours(points[0]);
    });
    expect(pointCacheCapture.report.counters.neighbourCandidateBuilds).toBe(514);
    expect(pointCacheCapture.report.counters.neighbourCacheEvictions).toBeGreaterThan(0);

    const grids = Array.from({ length: 20 }, (_, index) => {
      const variant = openState(`grid-retention-${nextDoorId++}-${index}`);
      return { state: variant, grid: createGrid(variant) };
    });
    const signatureCapture = captureNavigation(() => {
      for (const variant of grids) variant.grid.neighbours({ x: 400, y: 300 });
      // A live grid retains its bounded point map after the global signature
      // entry is evicted; a newly created grid reacquires a fresh map.
      grids[0].grid.neighbours({ x: 400, y: 300 });
      createGrid(grids[0].state).neighbours({ x: 400, y: 300 });
    });
    expect(signatureCapture.report.counters.neighbourCandidateBuilds).toBe(21);
    expect(signatureCapture.report.counters.neighbourCacheHits).toBe(1);
    expect(signatureCapture.report.counters.neighbourCacheSignatureAcquisitions).toBe(21);
    expect(signatureCapture.report.counters.neighbourCacheEvictions).toBeGreaterThan(0);
  });
});
