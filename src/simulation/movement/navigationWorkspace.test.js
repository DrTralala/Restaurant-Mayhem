import { expect, it } from 'vitest';
import {
  createNavigationWorkspace,
  isSafeSegment,
  isSafeWorldSegment,
  resolveNavigationBounds,
  resolveNavigationWorkspace,
} from './navigationWorkspace';

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
