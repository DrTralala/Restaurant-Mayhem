import { describe, expect, it } from 'vitest';
import {
  assertDenseQueueDeterministicRuns,
  buildDenseQueueNonTimingProjection,
  buildDenseQueueScenario,
  calculateInitialPlanningOptimisation,
  runDenseQueueScenario,
  selectRepresentativeDenseQueueRun,
} from './denseQueueStress';

const deterministicSummary = result => {
  const {
    batchMilliseconds: _batchMilliseconds,
    averageBatchMilliseconds: _averageBatchMilliseconds,
    pairBuildMilliseconds: _pairBuildMilliseconds,
    localConflictMilliseconds: _localConflictMilliseconds,
    localConflictPreparationMilliseconds: _localConflictPreparationMilliseconds,
    localConflictSolverMilliseconds: _localConflictSolverMilliseconds,
    localConflictCandidateMilliseconds: _localConflictCandidateMilliseconds,
    localConflictSafetyMilliseconds: _localConflictSafetyMilliseconds,
    localConflictFallbackMilliseconds: _localConflictFallbackMilliseconds,
    localConflictResidualMilliseconds: _localConflictResidualMilliseconds,
    solverInitialPlanningMilliseconds: _solverInitialPlanningMilliseconds,
    solverNodeBuildMilliseconds: _solverNodeBuildMilliseconds,
    solverFrontierOrderingMilliseconds: _solverFrontierOrderingMilliseconds,
    solverReplanningMilliseconds: _solverReplanningMilliseconds,
    solverAgedFallbackMilliseconds: _solverAgedFallbackMilliseconds,
    solverResidualMilliseconds: _solverResidualMilliseconds,
    safePrefixMilliseconds: _safePrefixMilliseconds,
    dynamicRepathMilliseconds: _dynamicRepathMilliseconds,
    staticRepathMilliseconds: _staticRepathMilliseconds,
    residualBatchMilliseconds: _residualBatchMilliseconds,
    ...counters
  } = result.summary;
  return counters;
};

describe('dense queue stress scenario', () => {
  it('reproduces deterministic dense conflicts while preserving movement invariants', () => {
    const { entries } = buildDenseQueueScenario();
    const first = runDenseQueueScenario({ ticks: 300 });
    const second = runDenseQueueScenario({ ticks: 300 });

    expect(entries).toHaveLength(24);
    expect(entries.filter(entry => entry.character.kind === 'guide')).toHaveLength(4);
    expect(entries.filter(entry => entry.character.kind === 'newly-admitted-customer')).toHaveLength(16);
    expect(entries.filter(entry => entry.character.id.startsWith('opposite-crossing-'))).toHaveLength(4);
    expect(entries.every(entry => Number.isFinite(entry.character.x)
      && Number.isFinite(entry.character.y) && entry.character.path.length > 0)).toBe(true);
    expect(entries.every(entry => entry.speed >= 50 && entry.speed <= 75)).toBe(true);
    expect(first.summary.batches).toBe(300);
    expect(first.summary.pairChecks).toBeGreaterThan(0);
    expect(first.summary.conflictPairs).toBeGreaterThan(0);
    expect(first.summary.maxComponentSize).toBeGreaterThan(1);
    expect(first.summary.solverExecutablePrefixScores).toBeGreaterThan(0);
    expect(first.summary.solverExecutablePrefixNodeVisits).toBe(0);
    expect(first.displacedActors).toBeGreaterThanOrEqual(12);
    expect(first.totalDisplacement).toBeGreaterThan(1000);
    expect(first.actorsPassingDoor).toBeGreaterThan(0);
    expect(first.actorsApproachingDoor).toBeGreaterThanOrEqual(4);
    expect(first.maximumNearDoorActors).toBeGreaterThanOrEqual(12);
    expect(first.meanNearDoorActors).toBeGreaterThanOrEqual(8);
    expect(first.ticksWithAtLeastEightNearDoorActors).toBeGreaterThanOrEqual(250);
    expect(first.maximumDoorCorridorActors).toBeGreaterThanOrEqual(4);
    expect(first.ticksWithAtLeastFourDoorCorridorActors).toBeGreaterThanOrEqual(60);
    expect(first.allCoordinatesFinite).toBe(true);
    expect(first.allActorsInsideWorld).toBe(true);
    expect(first.minimumInitialSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(first.minimumEndpointSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(first.minimumSweptSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(first.minimumEndpointPair).toMatchObject({ leftId: expect.any(String), rightId: expect.any(String) });
    expect(first.minimumSweptPair).toMatchObject({ leftId: expect.any(String), rightId: expect.any(String) });
    expect(deterministicSummary(second)).toEqual(deterministicSummary(first));
    expect(second.displacedActors).toBe(first.displacedActors);
    expect(second.totalDisplacement).toBe(first.totalDisplacement);
    expect(second.actorsPassingDoor).toBe(first.actorsPassingDoor);
    expect(second.actorsApproachingDoor).toBe(first.actorsApproachingDoor);
    expect(second.actorsReachingGoals).toBe(first.actorsReachingGoals);
    expect(second.allCoordinatesFinite).toBe(first.allCoordinatesFinite);
    expect(second.allActorsInsideWorld).toBe(first.allActorsInsideWorld);
    expect(second.minimumEndpointSpacing).toBe(first.minimumEndpointSpacing);
    expect(second.minimumSweptSpacing).toBe(first.minimumSweptSpacing);
  });

  it('compares every stable profile result and selects one measured representative run', () => {
    const first = runDenseQueueScenario({ ticks: 5 });
    const second = runDenseQueueScenario({ ticks: 5 });
    first.summary.batchMilliseconds = 3;
    second.summary.batchMilliseconds = 1;

    expect(buildDenseQueueNonTimingProjection(second))
      .toEqual(buildDenseQueueNonTimingProjection(first));
    expect(() => assertDenseQueueDeterministicRuns([first, second])).not.toThrow();
    expect(selectRepresentativeDenseQueueRun([
      { summary: { batchMilliseconds: 3 } },
      { summary: { batchMilliseconds: 1 } },
      { summary: { batchMilliseconds: 2 } },
    ])).toMatchObject({ index: 2 });

    second.maximumNearDoorActors += 1;
    expect(() => assertDenseQueueDeterministicRuns([first, second]))
      .toThrow('Dense queue non-timing results changed between measured runs');
  });

  it('sustains a concurrent door population and conflict-component activity for 900 ticks', () => {
    const result = runDenseQueueScenario({ ticks: 900 });

    expect(result.summary.conflictPairs).toBeGreaterThanOrEqual(100);
    expect(result.summary.conflictBatches).toBeGreaterThanOrEqual(90);
    expect(result.ticksWithConflictComponents).toBeGreaterThanOrEqual(90);
    expect(result.maximumNearDoorActors).toBeGreaterThanOrEqual(16);
    expect(result.ticksWithAtLeastEightNearDoorActors).toBeGreaterThanOrEqual(450);
    expect(result.maximumDoorCorridorActors).toBeGreaterThanOrEqual(5);
    expect(result.ticksWithAtLeastFourDoorCorridorActors).toBeGreaterThanOrEqual(500);
    expect(result.actorsCompletingDoorRoutes).toBe(24);
    expect(result.minimumEndpointSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(result.minimumSweptSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(result.summary.localConflictAttempts).toBeGreaterThanOrEqual(result.summary.solverCalls);
    expect(result.summary.solverExecutablePrefixScores).toBeGreaterThan(0);
    expect(result.summary.solverExecutablePrefixNodeVisits).toBe(0);
    expect(result.summary.spaceTimePlanCalls).toBe(200);
    expect(result.summary.spaceTimeExpandedStates).toBe(63105);
    expect(result.summary.solverNodesBuilt).toBeGreaterThanOrEqual(result.summary.solverPbs);
    expect(result.summary.localConflictProgressAccepts).toBeGreaterThan(0);
    expect(result.summary.localConflictPreparationMilliseconds
      + result.summary.localConflictSolverMilliseconds
      + result.summary.localConflictCandidateMilliseconds
      + result.summary.localConflictSafetyMilliseconds
      + result.summary.localConflictFallbackMilliseconds
      + result.summary.localConflictResidualMilliseconds)
      .toBeCloseTo(result.summary.localConflictMilliseconds, 6);
    expect(result.summary.solverInitialPlanningMilliseconds
      + result.summary.solverNodeBuildMilliseconds
      + result.summary.solverFrontierOrderingMilliseconds
      + result.summary.solverReplanningMilliseconds
      + result.summary.solverAgedFallbackMilliseconds
      + result.summary.solverResidualMilliseconds)
      .toBeCloseTo(result.summary.localConflictSolverMilliseconds, 6);
  });

  it('keeps branch counters deterministic while excluding nested timing fields', () => {
    const first = runDenseQueueScenario({ ticks: 5 });
    const second = runDenseQueueScenario({ ticks: 5 });

    for (const key of [
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
    ]) {
      second.summary[key] += 1;
      expect(() => assertDenseQueueDeterministicRuns([first, second]), key).not.toThrow();
      second.summary[key] -= 1;
    }

    for (const key of [
      'localConflictAttempts',
      'localConflictProgressAccepts',
      'localConflictSafetyFallbacks',
      'spaceTimePlanCalls',
      'spaceTimeExpandedStates',
      'solverExecutablePrefixScores',
      'solverExecutablePrefixNodeVisits',
      'solverNodesBuilt',
      'solverBranchesGenerated',
    ]) {
      second.summary[key] += 1;
      expect(() => assertDenseQueueDeterministicRuns([first, second]), key)
        .toThrow('Dense queue non-timing results changed between measured runs');
      second.summary[key] -= 1;
    }
  });

  it('computes the same-process median gate at the inclusive threshold', () => {
    expect(calculateInitialPlanningOptimisation({
      baselineMillisecondsByRun: [102, 100, 101, 99, 98],
      optimisedMillisecondsByRun: [72, 70, 71, 69, 68],
      parentNodeVisits: 0,
    })).toMatchObject({
      baselineMedianMilliseconds: 100,
      optimisedMedianMilliseconds: 70,
      improvement: 0.30,
      requiredImprovement: 0.30,
      performanceAccepted: true,
    });

    expect(calculateInitialPlanningOptimisation({
      baselineMillisecondsByRun: [100],
      optimisedMillisecondsByRun: [69],
      parentNodeVisits: 1,
    }).performanceAccepted).toBe(false);
    expect(calculateInitialPlanningOptimisation({
      baselineMillisecondsByRun: [100],
      optimisedMillisecondsByRun: [71],
      parentNodeVisits: 0,
    }).performanceAccepted).toBe(false);
  });
});
