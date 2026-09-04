import { expect, it } from 'vitest';
import {
  createMovementMetrics,
  setMovementResourceStrategy,
} from '../movementMetrics';
import { findSpaceTimePlan } from './spaceTimePlanner';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

const options = {
  state: openState,
  startCell: { x: 5, y: 5 },
  goalCell: { x: 8, y: 5 },
  routeCells: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
  blockedCells: new Set(),
  horizon: 6,
  progressHorizon: 3,
  vertexReservations: new Map(),
  edgeReservations: new Set(),
};

it('returns identical plans with less resource work in optimised mode', () => {
  const baselineMetrics = setMovementResourceStrategy(createMovementMetrics(), 'baseline');
  const optimisedMetrics = setMovementResourceStrategy(createMovementMetrics(), 'optimised');
  const baseline = findSpaceTimePlan({ ...options, metrics: baselineMetrics });
  const optimised = findSpaceTimePlan({ ...options, metrics: optimisedMetrics });

  expect(optimised).toEqual(baseline);
  expect(optimisedMetrics.spaceTimeExpandedStates)
    .toBe(baselineMetrics.spaceTimeExpandedStates);
  expect(optimisedMetrics.spaceTimeSuccessorNodesCreated)
    .toBe(baselineMetrics.spaceTimeSuccessorNodesCreated);
  expect(optimisedMetrics.peakPlannerFrontier)
    .toBe(baselineMetrics.peakPlannerFrontier);
  expect(optimisedMetrics.plannerCellDescriptorsCreated)
    .toBeLessThan(baselineMetrics.plannerCellDescriptorsCreated);
  expect(optimisedMetrics.routeDistanceCalculations)
    .toBeLessThan(baselineMetrics.routeDistanceCalculations);
  expect(optimisedMetrics.routeDistanceCacheHits).toBeGreaterThan(0);
  expect(baselineMetrics.routeDistanceCacheHits).toBe(0);
});

it('scopes planner cells and route distances to one call', () => {
  const metrics = setMovementResourceStrategy(createMovementMetrics(), 'optimised');
  const cumulativeKeys = [
    'spaceTimePlanCalls',
    'spaceTimeExpandedStates',
    'spaceTimeSuccessorNodesCreated',
    'plannerCellDescriptorsCreated',
    'routeDistanceCalculations',
    'routeDistanceCacheHits',
  ];
  const snapshot = () => Object.fromEntries(cumulativeKeys.map(key => [key, metrics[key]]));
  const delta = (after, before) => Object.fromEntries(cumulativeKeys
    .map(key => [key, after[key] - before[key]]));
  const expected = [
    { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 },
    { x: 8, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 5 },
  ];

  const beforeFirst = snapshot();
  const first = findSpaceTimePlan({ ...options, metrics });
  const afterFirst = snapshot();
  const firstPeak = metrics.peakPlannerFrontier;
  expect(first).toEqual(expected);
  expect(first.every(cell => !Object.isFrozen(cell))).toBe(true);
  first[0].x = -999;

  const beforeSecond = snapshot();
  const second = findSpaceTimePlan({ ...options, metrics });
  const afterSecond = snapshot();
  expect(second).toEqual(expected);
  expect(second.every(cell => !Object.isFrozen(cell))).toBe(true);
  expect(delta(afterSecond, beforeSecond)).toEqual(delta(afterFirst, beforeFirst));
  expect(metrics.peakPlannerFrontier).toBe(firstPeak);
});

it('uses only a navigation workspace validated for the same state', () => {
  const navigationWorkspace = {
    state: openState,
    bounds: { left: 100, right: 100, top: 100, bottom: 100 },
    blockedCells: { size: 0, has: () => false },
  };
  const oneSlotOptions = {
    ...options,
    goalCell: { x: 6, y: 5 },
    routeCells: [{ x: 6, y: 5 }],
    horizon: 1,
    progressHorizon: 1,
  };

  expect(findSpaceTimePlan({ ...oneSlotOptions, navigationWorkspace }))
    .toEqual([{ x: 5, y: 5 }]);
  expect(findSpaceTimePlan({
    ...oneSlotOptions,
    navigationWorkspace: { ...navigationWorkspace, state: {} },
  })).toEqual([{ x: 6, y: 5 }]);
});
