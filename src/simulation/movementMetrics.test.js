import { describe, expect, it } from 'vitest';
import {
  createMovementMetrics,
  getExecutablePrefixProfile,
  getMovementResourceStrategy,
  setExecutablePrefixProfile,
  setMovementResourceStrategy,
  summariseMovementMetrics,
} from './movementMetrics';

const metricKeys = [
  'batches',
  'batchMilliseconds',
  'pairBuildMilliseconds',
  'localConflictMilliseconds',
  'localConflictPreparationMilliseconds',
  'localConflictSolverMilliseconds',
  'localConflictCandidateMilliseconds',
  'localConflictSafetyMilliseconds',
  'localConflictFallbackMilliseconds',
  'localConflictResidualMilliseconds',
  'solverInitialPlanningMilliseconds',
  'solverNodeBuildMilliseconds',
  'solverFrontierOrderingMilliseconds',
  'solverReplanningMilliseconds',
  'solverAgedFallbackMilliseconds',
  'solverResidualMilliseconds',
  'safePrefixMilliseconds',
  'dynamicRepathMilliseconds',
  'staticRepathMilliseconds',
  'residualBatchMilliseconds',
  'pairChecks',
  'conflictPairs',
  'conflictBatches',
  'components',
  'maxComponentSize',
  'solverCalls',
  'solverPbs',
  'solverAgedFallback',
  'solverNull',
  'solverNodePops',
  'localConflictAttempts',
  'localConflictProgressAccepts',
  'localConflictSafetyFallbacks',
  'blockedCellBuilds',
  'spaceTimePlanCalls',
  'spaceTimeExpandedStates',
  'spaceTimeSuccessorNodesCreated',
  'plannerCellDescriptorsCreated',
  'routeDistanceCalculations',
  'routeDistanceCacheHits',
  'peakPlannerFrontier',
  'solverExecutablePrefixScores',
  'solverExecutablePrefixNodeVisits',
  'solverNodesBuilt',
  'solverBranchesGenerated',
  'safePrefixProbes',
  'dynamicRepaths',
  'staticRepaths',
];

describe('movement metrics', () => {
  it('creates independent zeroed collectors', () => {
    const first = createMovementMetrics();
    const second = createMovementMetrics();

    first.pairChecks = 3;

    expect(Object.keys(first)).toEqual(metricKeys);
    expect(second).toEqual(Object.fromEntries(metricKeys.map(key => [key, 0])));
  });

  it('summarises counters in stable order with a finite average for zero batches', () => {
    const summary = summariseMovementMetrics(createMovementMetrics());

    expect(Object.keys(summary)).toEqual([
      'batches',
      'batchMilliseconds',
      'averageBatchMilliseconds',
      ...metricKeys.slice(2),
    ]);
    expect(summary.averageBatchMilliseconds).toBe(0);
    expect(Number.isFinite(summary.averageBatchMilliseconds)).toBe(true);
  });

  it('copies counters and derives average batch duration without sharing the collector', () => {
    const metrics = createMovementMetrics();
    metrics.batches = 2;
    metrics.batchMilliseconds = 9;
    metrics.pairBuildMilliseconds = 3;
    metrics.localConflictPreparationMilliseconds = 2;
    metrics.solverCalls = 4;
    metrics.spaceTimeExpandedStates = 12;
    metrics.solverExecutablePrefixScores = 7;
    metrics.solverExecutablePrefixNodeVisits = 21;

    const summary = summariseMovementMetrics(metrics);
    metrics.solverCalls = 8;

    expect(summary).not.toBe(metrics);
    expect(summary.averageBatchMilliseconds).toBe(4.5);
    expect(summary.pairBuildMilliseconds).toBe(3);
    expect(summary.localConflictPreparationMilliseconds).toBe(2);
    expect(summary.solverCalls).toBe(4);
    expect(summary.spaceTimeExpandedStates).toBe(12);
    expect(summary).toMatchObject({
      solverExecutablePrefixScores: 7,
      solverExecutablePrefixNodeVisits: 21,
    });
  });

  it('keeps executable-prefix profile options in private non-enumerable storage', () => {
    const metrics = createMovementMetrics();
    const keys = Object.keys(metrics);
    const summary = summariseMovementMetrics(metrics);

    expect(setExecutablePrefixProfile(metrics, { mode: 'legacy', countWork: false })).toBe(metrics);

    expect(Object.keys(metrics)).toEqual(keys);
    expect(Object.getOwnPropertySymbols(metrics)).toEqual([]);
    expect(summariseMovementMetrics(metrics)).toEqual(summary);
    expect(getExecutablePrefixProfile(metrics)).toEqual({ mode: 'legacy', countWork: false });
    expect(getExecutablePrefixProfile(createMovementMetrics())).toBeNull();
  });

  it('defaults to optimised resources and stores explicit strategy privately', () => {
    const metrics = createMovementMetrics();
    const keys = Object.keys(metrics);
    expect(getMovementResourceStrategy()).toBe('optimised');
    expect(getMovementResourceStrategy(metrics)).toBe('optimised');
    expect(setMovementResourceStrategy(metrics, 'baseline')).toBe(metrics);
    expect(getMovementResourceStrategy(metrics)).toBe('baseline');
    expect(Object.keys(metrics)).toEqual(keys);
    expect(Object.getOwnPropertySymbols(metrics)).toEqual([]);
    expect(() => setMovementResourceStrategy(metrics, 'other'))
      .toThrow('Unknown movement resource strategy: other');
  });
});
