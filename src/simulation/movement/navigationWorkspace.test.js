import { expect, it } from 'vitest';
import {
  buildBlockedCells,
  createNavigationWorkspace,
  navigationFixtureRectangles,
  isSafeSegment,
  isSafeWorldSegment,
  resolveNavigationBounds,
  resolveNavigationWorkspace,
} from './navigationWorkspace';
import { createInitialState } from '../../state/initialState';
import { getRestaurantWorld } from '../world';

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
