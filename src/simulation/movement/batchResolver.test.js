import { expect, it } from 'vitest';
import {
  createMovementMetrics,
  setMovementResourceStrategy,
} from '../movementMetrics';
import {
  resolveCharacterMovementBatch,
  resolveCharacterMovementBatchWithDiagnostics,
} from './batchResolver';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

const threeWayCrossingEntries = () => [
  { character: { id: 'a', x: 80, y: 100, path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 } }, speed: 40 },
  { character: { id: 'b', x: 100, y: 80, path: [{ x: 5, y: 6 }], pathGoal: { x: 5, y: 6 } }, speed: 40 },
  { character: { id: 'c', x: 120, y: 100, path: [{ x: 4, y: 5 }], pathGoal: { x: 4, y: 5 } }, speed: 40 },
];

const serialiseMapById = map => [...map.entries()]
  .sort(([left], [right]) => String(left).localeCompare(String(right)));
const serialiseDiagnostics = ({ moved, trajectories }) => ({
  moved: serialiseMapById(moved),
  trajectories: serialiseMapById(trajectories),
});

it('uses one optimised workspace and preserves exact baseline output', () => {
  const baselineMetrics = setMovementResourceStrategy(createMovementMetrics(), 'baseline');
  const optimisedMetrics = setMovementResourceStrategy(createMovementMetrics(), 'optimised');
  const baseline = resolveCharacterMovementBatchWithDiagnostics(
    openState, threeWayCrossingEntries(), 1, baselineMetrics,
  );
  const optimised = resolveCharacterMovementBatchWithDiagnostics(
    openState, threeWayCrossingEntries(), 1, optimisedMetrics,
  );

  expect(serialiseDiagnostics(optimised)).toEqual(serialiseDiagnostics(baseline));
  expect(optimisedMetrics.blockedCellBuilds).toBe(1);
  expect(optimisedMetrics.blockedCellBuilds).toBeLessThan(baselineMetrics.blockedCellBuilds);
  expect(optimisedMetrics.spaceTimeExpandedStates)
    .toBe(baselineMetrics.spaceTimeExpandedStates);
  expect(optimisedMetrics.spaceTimeSuccessorNodesCreated)
    .toBe(baselineMetrics.spaceTimeSuccessorNodesCreated);
});

it('creates a fresh bounded workspace for every optimised batch', () => {
  const metrics = setMovementResourceStrategy(createMovementMetrics(), 'optimised');
  resolveCharacterMovementBatch(openState, threeWayCrossingEntries(), 1, metrics);
  expect(metrics.blockedCellBuilds).toBe(1);
  resolveCharacterMovementBatch(openState, threeWayCrossingEntries(), 1, metrics);
  expect(metrics.blockedCellBuilds).toBe(2);
});
