import { expect, it } from 'vitest';
import { createMovementMetrics } from '../movementMetrics';
import {
  createNavigationWorkspace,
  furthestWorldSegmentEndpoint,
  isSafeSegment,
  isSafeWorldSegment,
  resolveNavigationBounds,
  resolveNavigationWorkspace,
} from './navigationWorkspace';

const state = {
  restaurant: { expansionLevel: 1 },
  tables: [{ id: 'table', x: 200, y: 200 }],
  chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

it('builds one immutable read-only workspace for repeated navigation', () => {
  const metrics = createMovementMetrics();
  const workspace = createNavigationWorkspace(state, metrics);

  expect(Object.isFrozen(workspace)).toBe(true);
  expect(Object.isFrozen(workspace.bounds)).toBe(true);
  expect(Object.isFrozen(workspace.blockedCells)).toBe(true);
  expect(workspace.blockedCells.has('10,10')).toBe(true);
  expect(workspace.blockedCells.add).toBeUndefined();
  expect(metrics.blockedCellBuilds).toBe(1);
  expect(resolveNavigationWorkspace(state, workspace, metrics)).toBe(workspace);
  expect(metrics.blockedCellBuilds).toBe(1);
});

it('rejects a workspace from another state and safely rebuilds malformed input', () => {
  const metrics = createMovementMetrics();
  const first = createNavigationWorkspace(state, metrics);
  const otherState = { ...state };
  expect(resolveNavigationWorkspace(otherState, first, metrics)).not.toBe(first);
  expect(resolveNavigationWorkspace(state, { blockedCells: new Set() }, metrics))
    .toMatchObject({ state });
  expect(metrics.blockedCellBuilds).toBe(3);
});

it('clips world movement and reuses the blocked lookup for static segments', () => {
  const metrics = createMovementMetrics();
  const workspace = createNavigationWorkspace(state, metrics);

  expect(workspace.bounds).toEqual({ left: 50, right: 1033, top: 50, bottom: 670 });
  expect(resolveNavigationBounds(state, workspace)).toBe(workspace.bounds);
  expect(resolveNavigationBounds(state, {}))
    .toEqual({ left: 50, right: 1033, top: 50, bottom: 670 });
  expect(isSafeWorldSegment(state, { x: 40, y: 100 }, { x: 60, y: 100 }, workspace))
    .toBe(true);
  expect(isSafeWorldSegment(state, { x: 40, y: 100 }, { x: 30, y: 100 }, workspace))
    .toBe(false);
  expect(furthestWorldSegmentEndpoint(
    state, { x: 100, y: 100 }, { x: 1100, y: 100 }, workspace,
  )).toEqual({ x: 1033, y: 100 });
  expect(isSafeSegment(
    state, { x: 160, y: 200 }, { x: 240, y: 200 }, { workspace, metrics },
  )).toBe(false);
  expect(isSafeSegment(
    state, { x: 100, y: 300 }, { x: 300, y: 300 }, { workspace, metrics },
  )).toBe(true);
  expect(metrics.blockedCellBuilds).toBe(1);
});
