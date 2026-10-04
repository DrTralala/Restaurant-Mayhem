import { expect, it } from 'vitest';
import {
  buildBlockedCells,
  createNavigationWorkspace,
  isImmutableNavigationBlockedLookup,
  navigationFixtureRectangles,
  isSafeSegment,
  isSafeWorldSegment,
  resolveNavigationBounds,
  resolveNavigationWorkspace,
  withNavigationLayoutContext,
  withSimulationNavigationLayoutContext,
} from './navigationWorkspace';
import { createInitialState } from '../../state/initialState';
import { getRestaurantWorld } from '../world';
import { captureNavigation } from '../navigation/telemetry';

function openState() {
  return {
    restaurant: { expansionLevel: 1 },
    tables: [],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
  };
}

const state = {
  restaurant: { expansionLevel: 1 },
  tables: [{ id: 'table', x: 200, y: 200 }],
  chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

it('builds one immutable read-only workspace for repeated navigation', () => {
  const workspace = createNavigationWorkspace(state);

  expect(Object.isFrozen(workspace)).toBe(true);
  expect(Object.isFrozen(workspace.bounds)).toBe(true);
  expect(Object.isFrozen(workspace.blockedCells)).toBe(true);
  expect(workspace.blockedCells.has('10,10')).toBe(true);
  expect(workspace.blockedCells.add).toBeUndefined();
  expect(resolveNavigationWorkspace(state, workspace)).toBe(workspace);
});

it('recognises only internally constructed immutable blocked-cell lookups', () => {
  const workspace = createNavigationWorkspace(state);
  const mutable = new Set(workspace.blockedCellKeys);
  const frozenWrapper = Object.freeze({ has: key => mutable.has(key), size: mutable.size });

  expect(isImmutableNavigationBlockedLookup(workspace.blockedCells)).toBe(true);
  expect(isImmutableNavigationBlockedLookup(frozenWrapper)).toBe(false);
  expect(resolveNavigationWorkspace(state, Object.freeze({
    ...workspace, blockedCells: frozenWrapper,
  }))).toBeDefined();
});

it('reuses immutable static geometry without sharing state-owned workspaces', () => {
  const firstState = {
    ...openState(),
    tables: [{ id: 'cache-table-a', x: 202, y: 202 }],
    chairs: [{ id: 'cache-chair-a', x: 260, y: 200, tableId: 'cache-table-a', rotation: 0 }],
    doors: [{ id: 'cache-door-a', y: 340, role: 'entrance' }],
  };
  const secondState = {
    ...firstState,
    restaurant: { ...firstState.restaurant },
    tables: firstState.tables.map(table => ({ ...table })),
    chairs: firstState.chairs.map(chair => ({ ...chair })),
    doors: firstState.doors.map(door => ({ ...door })),
  };
  const { value: [first, second], report } = captureNavigation(() => [
    createNavigationWorkspace(firstState),
    createNavigationWorkspace(secondState),
  ]);

  expect(report.counters.workspaceGeometryCacheHits).toBeGreaterThan(0);
  expect(first).not.toBe(second);
  expect(first.state).toBe(firstState);
  expect(second.state).toBe(secondState);
  expect(second.bounds).toBe(first.bounds);
  expect(second.blockedCells).toBe(first.blockedCells);
  expect(second.blockedCellKeys).toBe(first.blockedCellKeys);
  expect(second.topologyFingerprint).toBe(first.topologyFingerprint);

  firstState.tables[0].x += 1;
  const moved = createNavigationWorkspace(firstState);
  expect(moved.blockedCellKeys).not.toBe(first.blockedCellKeys);
  expect(moved.topologyFingerprint).not.toBe(first.topologyFingerprint);
});

it('reuses the most recent valid geometry without rebuilding JSON signatures', () => {
  const firstState = {
    ...openState(),
    tables: [{ id: 'fastlane-work-elimination', x: 402, y: 222 }],
  };
  const secondState = {
    ...firstState,
    tables: firstState.tables.map(table => ({ ...table })),
  };
  const { value: [first, second], report } = captureNavigation(() => [
    createNavigationWorkspace(firstState),
    createNavigationWorkspace(secondState),
  ]);

  expect(report.counters.workspaceSignatureBuilds).toBe(1);
  expect(report.counters.workspaceFastlaneHits).toBe(1);
  expect(report.counters.workspaceGeometryCacheHits).toBe(1);
  expect(report.counters.workspaceFixtureRectangleBuilds).toBe(1);
  expect(second.state).toBe(secondState);
  expect(second.blockedCells).toBe(first.blockedCells);
});

it('falls back to canonical signatures for reordered geometry inputs', () => {
  const firstState = {
    ...openState(),
    tables: [
      { id: 'ordered-table-a', x: 402, y: 222 },
      { id: 'ordered-table-b', x: 502, y: 222 },
    ],
  };
  const reorderedState = {
    ...firstState,
    tables: [...firstState.tables].reverse().map(table => ({ ...table })),
  };
  const { value: [first, reordered], report } = captureNavigation(() => [
    createNavigationWorkspace(firstState),
    createNavigationWorkspace(reorderedState),
  ]);

  expect(report.counters.workspaceSignatureBuilds).toBe(2);
  expect(report.counters.workspaceFastlaneHits || 0).toBe(0);
  expect(report.counters.workspaceGeometryCacheHits).toBe(1);
  expect(reordered.blockedCells).toBe(first.blockedCells);
  expect(reordered.topologyFingerprint).toBe(first.topologyFingerprint);
});

it('does not alias non-finite and null fixture coordinates in the geometry cache', () => {
  const state = {
    ...openState(),
    tables: [{ id: 'non-finite-coordinate', x: Number.NaN, y: 200 }],
  };
  const nonFiniteWorkspace = createNavigationWorkspace(state);
  expect(nonFiniteWorkspace.blockedCells.has('0,10')).toBe(false);

  state.tables[0].x = null;
  const nullWorkspace = createNavigationWorkspace(state);

  expect(buildBlockedCells(state).has('0,10')).toBe(true);
  expect(nullWorkspace.blockedCells.has('0,10')).toBe(true);
});

it.each([
  ['fixture id', state => { state.tables[0].id = 'cache-table-renamed'; }],
  ['chair table association', state => { state.chairs[0].tableId = 'another-table'; }],
  ['chair rotation', state => { state.chairs[0].rotation = 1; }],
  ['service-table rotation', state => { state.serviceTables[0].rotation = 1; }],
  ['wash-station width', state => { state.washStations[0].w = 80; }],
  ['staff-amenity kind', state => { state.staffAmenities[0].type = 'bed'; }],
  ['staff-amenity rotation', state => { state.staffAmenities[0].rotation = 1; }],
  ['door position', state => { state.doors[0].y += 20; }],
  ['world bounds', state => { state.restaurant.expansionLevel += 1; }],
])('invalidates static workspace geometry after an in-place %s change', (_label, edit) => {
  const state = {
    ...openState(),
    tables: [{ id: 'cache-table-b', x: 302, y: 302 }],
    chairs: [{ id: 'cache-chair-b', x: 360, y: 300, tableId: 'cache-table-b', rotation: 0 }],
    serviceTables: [{ id: 'cache-service-b', x: 402, y: 402, rotation: 0 }],
    washStations: [{ id: 'cache-wash-b', x: 502, y: 502, w: 40, h: 40 }],
    staffAmenities: [{ id: 'cache-amenity-b', type: 'couch', x: 602, y: 302, rotation: 0 }],
    doors: [{ id: 'cache-door-b', y: 340, role: 'entrance' }],
  };
  const original = createNavigationWorkspace(state);

  edit(state);
  const changed = createNavigationWorkspace(state);

  expect(changed.blockedCellKeys).not.toBe(original.blockedCellKeys);
  expect(changed.topologyFingerprint).not.toBe(original.topologyFingerprint);
});

it('uses canonical fallback when amenity sources change but retain the same footprint', () => {
  const state = {
    ...openState(),
    staffAmenities: [{ id: 'same-footprint-amenity', type: 'couch', x: 402, y: 302, rotation: 1 }],
  };
  const original = createNavigationWorkspace(state);

  state.staffAmenities[0].type = 'bed';
  state.staffAmenities[0].rotation = 0;
  const { value: changed, report } = captureNavigation(() => createNavigationWorkspace(state));

  expect(report.counters.workspaceSignatureBuilds).toBe(1);
  expect(report.counters.workspaceFastlaneHits || 0).toBe(0);
  expect(report.counters.workspaceGeometryCacheHits).toBe(1);
  expect(changed.blockedCells).toBe(original.blockedCells);
  expect(changed.topologyFingerprint).toBe(original.topologyFingerprint);
});

it('uses canonical fallback when a service rotation changes without changing its dimensions', () => {
  const state = {
    ...openState(),
    serviceTables: [{ id: 'same-dimension-service', x: 402, y: 302, rotation: 0 }],
  };
  const original = createNavigationWorkspace(state);

  state.serviceTables[0].rotation = 2;
  const { value: changed, report } = captureNavigation(() => createNavigationWorkspace(state));

  expect(report.counters.workspaceSignatureBuilds).toBe(1);
  expect(report.counters.workspaceFastlaneHits || 0).toBe(0);
  expect(report.counters.workspaceGeometryCacheHits).toBe(1);
  expect(changed.blockedCells).toBe(original.blockedCells);
  expect(changed.topologyFingerprint).toBe(original.topologyFingerprint);
});

it('uses canonical fallback for door metadata and duplicate fixture inputs', () => {
  const state = {
    ...openState(),
    tables: [{ id: 'duplicate-source-table', x: 402, y: 302 }],
    doors: [{ id: 'source-door', y: 340, role: 'entrance' }],
  };
  const original = createNavigationWorkspace(state);

  state.doors[0].role = 'exit';
  const { value: metadataChange, report: metadataReport } = captureNavigation(
    () => createNavigationWorkspace(state),
  );
  expect(metadataReport.counters.workspaceSignatureBuilds).toBe(1);
  expect(metadataReport.counters.workspaceFastlaneHits || 0).toBe(0);
  expect(metadataChange.topologyFingerprint).toBe(original.topologyFingerprint);
  expect(metadataChange.blockedCells).not.toBe(original.blockedCells);

  state.tables.push({ ...state.tables[0] });
  const { value: duplicate, report: duplicateReport } = captureNavigation(
    () => createNavigationWorkspace(state),
  );
  expect(duplicateReport.counters.workspaceSignatureBuilds).toBe(1);
  expect(duplicateReport.counters.workspaceFastlaneHits || 0).toBe(0);
  expect(duplicate.topologyFingerprint).not.toBe(metadataChange.topologyFingerprint);
});

it('falls back to source getters without reading them during the fastlane check', () => {
  let reads = 0;
  const table = { id: 'getter-source-table', y: 202 };
  Object.defineProperty(table, 'x', {
    enumerable: true,
    get() {
      reads += 1;
      return 402;
    },
  });
  const state = { ...openState(), tables: [table] };

  const { report } = captureNavigation(() => {
    createNavigationWorkspace(state);
    createNavigationWorkspace(state);
  });

  expect(reads).toBe(2);
  expect(report.counters.workspaceSignatureBuilds).toBe(2);
  expect(report.counters.workspaceFastlaneHits || 0).toBe(0);
  expect(report.counters.workspaceFixtureRectangleBuilds).toBe(2);
});

it.each(['cold', 'warm'])('keeps rejected public Proxy reads off the %s standalone source fastlane', cache => {
  const plain = {
    ...openState(),
    tables: [{ id: `rejected-public-proxy-${cache}`, x: 200, y: 200 }],
  };
  const reads = [];
  const proxied = { ...plain, tables: [new Proxy(plain.tables[0], {
    get(record, key) {
      if (key === 'x') { reads.push(220); return 220; }
      return record[key];
    },
  })] };
  const tableX = workspace => JSON.parse(JSON.parse(workspace.topologyFingerprint)[5][0]).x;
  if (cache === 'warm') expect(tableX(createNavigationWorkspace(plain))).toBe(200);

  const rejected = withNavigationLayoutContext(proxied, () => createNavigationWorkspace(proxied));
  expect(rejected.state).toBe(proxied);
  expect(tableX(rejected)).toBe(220);
  expect(reads).toEqual([220, 220]);
  expect(rejected.blockedCells.has('10,10')).toBe(false);
  expect(rejected.blockedCells.has('12,11')).toBe(true);

  const subsequent = createNavigationWorkspace(plain);
  expect(subsequent.state).toBe(plain);
  expect(tableX(subsequent)).toBe(200);
  expect(subsequent.blockedCells.has('10,10')).toBe(true);
  expect(subsequent.blockedCells.has('12,11')).toBe(false);
});

it('evicts older static geometry when the bounded workspace cache fills', () => {
  const seed = {
    ...openState(),
    tables: [{ id: 'workspace-cache-bound-seed', x: 202, y: 222 }],
  };
  const first = createNavigationWorkspace(seed);
  const { value: afterEviction, report } = captureNavigation(() => {
    for (let index = 0; index < 32; index += 1) {
      createNavigationWorkspace({
        ...seed,
        tables: [{ id: `workspace-cache-bound-${index}`, x: 400 + index * 20, y: 222 }],
      });
    }
    return createNavigationWorkspace({ ...seed, tables: seed.tables.map(table => ({ ...table })) });
  });

  expect(report.counters.workspaceGeometryBuilds).toBeGreaterThan(0);
  expect(afterEviction.blockedCellKeys).not.toBe(first.blockedCellKeys);
});

it('blocks only the top interior strip, not the queue at the same height', () => {
  const state = { ...createInitialState(), tables: [], chairs: [],
    kitchenStations: [], serviceTables: [], cashierStations: [], washStations: [] };
  const world = getRestaurantWorld(state.restaurant);
  const blocked = buildBlockedCells(state);
  for (let y = 60; y < world.diningY; y += 20) {
    expect(blocked.has(`${Math.floor(100 / 20)},${Math.floor(y / 20)}`)).toBe(true);
    expect(blocked.has(`${Math.ceil((world.queueX + 60) / 20)},${Math.floor(y / 20)}`)).toBe(false);
  }
  expect(blocked.has('5,5')).toBe(false); // (100,100) is floor, not wall.
});

it('invalidates navigation topology when the structural wall is present', () => {
  const workspace = createNavigationWorkspace({ ...openState(), doors: [{ id: 'door1', y: 340, role: 'entrance' }] });

  expect(workspace.blockedCellKeys).toContain('5,4');
  expect(workspace.topologyFingerprint).toContain('5,4');
});

it('does not let a top-band side door carve a structural wall cell', () => {
  const workspace = createNavigationWorkspace({ ...openState(), doors: [{ id: 'top-door', y: 80, role: 'entrance' }] });

  expect(workspace.blockedCells.has('45,4')).toBe(true);
});

it('does not let a source-cell exemption cross the top interior wall', () => {
  const state = { ...openState(), doors: [{ id: 'door1', y: 340, role: 'entrance' }] };

  expect(isSafeSegment(state, { x: 100, y: 80 }, { x: 100, y: 100 })).toBe(false);
});

it('gives equivalent geometry the same topology fingerprint', () => {
  const left = createNavigationWorkspace(openState());
  const right = createNavigationWorkspace({ ...openState(), tables: [] });
  expect(left.topologyFingerprint).toBe(right.topologyFingerprint);
  expect(left.blockedCellKeys).toEqual([...left.blockedCellKeys].sort());
});

it('rejects a workspace from another state and safely rebuilds malformed input', () => {
  const first = createNavigationWorkspace(state);
  const otherState = { ...state };
  expect(resolveNavigationWorkspace(otherState, first)).not.toBe(first);
  expect(resolveNavigationWorkspace(state, { blockedCells: new Set() }))
    .toMatchObject({ state });
});

it('clips world movement and reuses the blocked lookup for static segments', () => {
  const workspace = createNavigationWorkspace(state);

  expect(workspace.bounds).toEqual({ left: 50, right: 1033, top: 50, bottom: 670 });
  expect(resolveNavigationBounds(state, workspace)).toBe(workspace.bounds);
  expect(resolveNavigationBounds(state, {}))
    .toEqual({ left: 50, right: 1033, top: 50, bottom: 670 });
  expect(isSafeWorldSegment(state, { x: 40, y: 100 }, { x: 60, y: 100 }, workspace))
    .toBe(true);
  expect(isSafeWorldSegment(state, { x: 40, y: 100 }, { x: 30, y: 100 }, workspace))
    .toBe(false);
  expect(isSafeSegment(
    state, { x: 160, y: 200 }, { x: 240, y: 200 }, { workspace },
  )).toBe(false);
  expect(isSafeSegment(
    state, { x: 100, y: 300 }, { x: 300, y: 300 }, { workspace },
  )).toBe(true);
});

it('no longer exports the removed world-segment clamp helper', async () => {
  const namespace = await import('./navigationWorkspace');
  expect('furthestWorldSegmentEndpoint' in namespace).toBe(false);
});

it('includes rotated staff-amenity footprints in the live collision workspace', () => {
  const state = {
    ...openState(),
    staffAmenities: [{
      id: 'couch-rotated', type: 'couch', x: 400, y: 300, rotation: 1,
      slots: [{ index: 0, reservedBy: null, occupiedBy: null },
        { index: 1, reservedBy: null, occupiedBy: null }],
    }],
  };

  expect(navigationFixtureRectangles(state)).toContainEqual({
    kind: 'staffAmenity', id: 'couch-rotated', x: 400, y: 300, w: 20, h: 40,
  });
  const workspace = createNavigationWorkspace(state);
  expect(workspace.blockedCells.has('20,15')).toBe(true);
  expect(workspace.blockedCells.has('20,16')).toBe(true);
  expect(workspace.blockedCells.has('19,15')).toBe(false);
});

it('keeps staff-amenity collision authoritative for real movement segments', () => {
  const state = {
    ...openState(),
    staffAmenities: [{
      id: 'arcade', type: 'arcade', x: 400, y: 300, rotation: 0,
      slots: [{ index: 0, reservedBy: null, occupiedBy: null }],
    }],
  };
  const workspace = createNavigationWorkspace(state);

  expect(isSafeSegment(state, { x: 380, y: 310 }, { x: 440, y: 310 }, { workspace }))
    .toBe(false);
  expect(isSafeSegment(state, { x: 380, y: 350 }, { x: 440, y: 350 }, { workspace }))
    .toBe(true);
});

it.each([
  ['fixture coordinate', state => { state.tables[0].x += 20; }],
  ['fixture id', state => { state.tables[0].id = 'plain-between-ticks-renamed'; }],
  ['chair table association', state => { state.chairs[0].tableId = 'another-table'; }],
  ['chair rotation', state => { state.chairs[0].rotation = 1; }],
  ['service-table rotation', state => { state.serviceTables[0].rotation = 1; }],
  ['wash-station width', state => { state.washStations[0].w = 80; }],
  ['staff-amenity kind', state => { state.staffAmenities[0].type = 'bed'; }],
  ['staff-amenity rotation', state => { state.staffAmenities[0].rotation = 1; }],
  ['door position', state => { state.doors[0].y += 20; }],
  ['door role', state => { state.doors[0].role = 'exit'; }],
  ['world bounds', state => { state.restaurant.expansionLevel += 1; }],
])('recaptures primitive %s edits between plain simulation ticks without relying on source identity', (_label, edit) => {
  const state = {
    ...openState(),
    tables: [{ id: 'plain-between-ticks-table', x: 202, y: 222 }],
    chairs: [{ id: 'plain-between-ticks-chair', tableId: 'plain-between-ticks-table', x: 260, y: 222, rotation: 0 }],
    serviceTables: [{ id: 'plain-between-ticks-service', x: 402, y: 402, rotation: 0 }],
    washStations: [{ id: 'plain-between-ticks-wash', x: 502, y: 502, w: 40, h: 40 }],
    staffAmenities: [{ id: 'plain-between-ticks-amenity', type: 'couch', x: 602, y: 302, rotation: 0 }],
    doors: [{ id: 'plain-between-ticks-door', y: 340, role: 'entrance' }],
  };
  const owned = count => withSimulationNavigationLayoutContext(state, () => {
    let workspace;
    for (let index = 0; index < count; index += 1) workspace = createNavigationWorkspace(state);
    return workspace;
  });
  withSimulationNavigationLayoutContext(state, () => undefined);
  const before = owned(1);
  edit(state);
  const activated = owned(7);
  expect(activated.blockedCells).not.toBe(before.blockedCells);
  expect(activated.blockedCellKeys).toEqual([...buildBlockedCells(state)].sort());
  expect(activated.topologyFingerprint).toBe(createNavigationWorkspace(state).topologyFingerprint);
  expect(activated.state).toBe(state);
  edit(state);
  // The successful seven-request tick predicts eager ownership for this scope.
  const predicted = owned(1);
  expect(predicted.blockedCellKeys).toEqual([...buildBlockedCells(state)].sort());
  expect(predicted.topologyFingerprint).toBe(createNavigationWorkspace(state).topologyFingerprint);
  expect(predicted.state).toBe(state);
});

it('keeps non-finite/null geometry on canonical fallback between plain simulation ticks', () => {
  const state = { ...openState(), tables: [{ id: 'plain-malformed-between-ticks', x: NaN, y: 200 }] };
  const query = () => withSimulationNavigationLayoutContext(state, () => {
    let workspace;
    for (let index = 0; index < 7; index += 1) workspace = createNavigationWorkspace(state);
    return workspace;
  });
  withSimulationNavigationLayoutContext(state, () => undefined);
  expect(query().blockedCells.has('0,10')).toBe(false);
  state.tables[0].x = null;
  const captured = captureNavigation(query);
  expect(captured.value.blockedCells.has('0,10')).toBe(true);
  expect(captured.report.counters.workspaceSignatureBuilds).toBe(7);
  expect(captured.report.counters.workspaceLayoutContextHits || 0).toBe(0);
});

it.each([
  ['standalone', 'getter', 2], ['public', 'getter', 2],
  ['standalone', 'Proxy', 1], ['public', 'Proxy', 3],
])('retains strict %s effects for a stateful %s outside the internal plain-input contract', (mode, kind, expectedReads) => {
  const reads = [];
  const backing = { id: `plain-strict-${mode}-${kind}`, x: 202, y: 222, status: 'empty' };
  const readX = () => {
    const value = 222 + reads.length * 20;
    reads.push(value);
    backing.status = reads.length === 1 ? 'empty' : 'occupied';
    return value;
  };
  const table = kind === 'getter' ? { ...backing, get x() { return readX(); } }
    : new Proxy(backing, { get(record, key) { return key === 'x' ? readX() : Reflect.get(record, key); } });
  const state = { ...openState(), tables: [table] };
  const query = () => [createNavigationWorkspace(state), createNavigationWorkspace(state)];
  // Only public ownership sees the accessor/Proxy, even when nested in a plain tick.
  const workspaces = mode === 'public'
    ? withSimulationNavigationLayoutContext(openState(), () => withNavigationLayoutContext(state, query))
    : query();
  // Public rejection reads once during ownership validation and then once per
  // canonical build; a descriptor-only hit must not suppress the second build.
  expect(reads).toEqual(expectedReads === 1 ? [222]
    : expectedReads === 2 ? [222, 242] : [222, 242, 262]);
  expect(backing.status).toBe(expectedReads === 1 ? 'empty' : 'occupied');
  expect(workspaces[1].state).toBe(state);
  const rectangle = JSON.parse(JSON.parse(workspaces[1].topologyFingerprint)[5][0]);
  expect(rectangle.x).toBe(reads.at(-1));
});
