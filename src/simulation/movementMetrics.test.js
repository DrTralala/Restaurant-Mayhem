import { describe, expect, it } from 'vitest';
import {
  createMovementMetrics,
  summariseMovementMetrics,
} from './movementMetrics';

const metricKeys = [
  'batches',
  'plannerExpansions',
  'episodes',
  'schedulesInstalled',
  'schedulesReused',
  'fastPassAttempts',
  'fastPassSuccesses',
  'exactPassSuccesses',
  'groupsCreated',
  'groupsMerged',
  'preparedMemberReuses',
  'lowLevelNodesExpanded',
  'highLevelNodesExpanded',
  'safeIntervalSuccessors',
  'continuousConflicts',
  'reverseCacheBuilds',
  'reverseCacheHits',
  'pendingTicks',
  'peakPlannerFrontier',
  'peakRetainedNodes',
  'peakGroupSize',
  'invalidationsGoal',
  'invalidationsSpeed',
  'invalidationsExemptions',
  'invalidationsParticipants',
  'invalidationsPosition',
  'invalidationsStationary',
  'invalidationsTopology',
  'invalidationsExecution',
  'unreachable',
  'unschedulable',
  'invariantFailures',
  'installedSubtractions',
  'staticGridBuilds',
  'staticGridReuses',
  'installedValidationBuilds',
  'installedValidationReuses',
  'batchMilliseconds',
  'plannerMilliseconds',
  'executorMilliseconds',
];

describe('movement metrics', () => {
  it('creates independent zeroed cooperative collectors in stable order', () => {
    const first = createMovementMetrics();
    const second = createMovementMetrics();
    first.groupsCreated = 3;

    expect(Object.keys(first)).toEqual(metricKeys);
    expect(second).toEqual(Object.fromEntries(metricKeys.map(key => [key, 0])));
  });

  it('summarises counters with a finite average and without sharing the collector', () => {
    const metrics = createMovementMetrics();
    metrics.batches = 2;
    metrics.batchMilliseconds = 9;
    metrics.lowLevelNodesExpanded = 12;

    const summary = summariseMovementMetrics(metrics);
    metrics.lowLevelNodesExpanded = 20;

    expect(Object.keys(summary)).toEqual([
      'batches',
      'batchMilliseconds',
      'averageBatchMilliseconds',
      ...metricKeys.slice(1, -3),
      'plannerMilliseconds',
      'executorMilliseconds',
    ]);
    expect(summary.averageBatchMilliseconds).toBe(4.5);
    expect(summary.lowLevelNodesExpanded).toBe(12);
    expect(summariseMovementMetrics(createMovementMetrics()).averageBatchMilliseconds).toBe(0);
  });

  it('keeps removed legacy strategy helpers and counters absent from the module and collector', async () => {
    const namespace = await import('./movementMetrics');
    for (const name of [
      'setExecutablePrefixProfile',
      'getExecutablePrefixProfile',
      'setMovementResourceStrategy',
      'getMovementResourceStrategy',
    ]) {
      expect(name in namespace).toBe(false);
    }

    const metrics = createMovementMetrics();
    for (const key of [
      'pairBuildMilliseconds', 'localConflictMilliseconds',
      'localConflictPreparationMilliseconds', 'localConflictSolverMilliseconds',
      'localConflictCandidateMilliseconds', 'localConflictSafetyMilliseconds',
      'localConflictFallbackMilliseconds', 'localConflictResidualMilliseconds',
      'solverInitialPlanningMilliseconds', 'solverNodeBuildMilliseconds',
      'solverFrontierOrderingMilliseconds', 'solverReplanningMilliseconds',
      'solverAgedFallbackMilliseconds', 'solverResidualMilliseconds',
      'safePrefixMilliseconds', 'dynamicRepathMilliseconds',
      'staticRepathMilliseconds', 'residualBatchMilliseconds',
      'pairChecks', 'conflictPairs', 'conflictBatches', 'components',
      'maxComponentSize', 'solverCalls', 'solverPbs', 'solverAgedFallback',
      'solverNull', 'solverNodePops', 'localConflictAttempts',
      'localConflictProgressAccepts', 'localConflictSafetyFallbacks',
      'blockedCellBuilds', 'spaceTimePlanCalls', 'spaceTimeExpandedStates',
      'spaceTimeSuccessorNodesCreated', 'plannerCellDescriptorsCreated',
      'routeDistanceCalculations', 'routeDistanceCacheHits',
      'solverExecutablePrefixScores', 'solverExecutablePrefixNodeVisits',
      'solverNodesBuilt', 'solverBranchesGenerated', 'safePrefixProbes',
      'dynamicRepaths', 'staticRepaths',
    ]) {
      expect(key in metrics).toBe(false);
    }
  });
});
