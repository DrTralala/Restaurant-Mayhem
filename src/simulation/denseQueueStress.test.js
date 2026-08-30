import { describe, expect, it } from 'vitest';
import { buildDenseQueueScenario, runDenseQueueScenario } from './denseQueueStress';

const deterministicSummary = result => {
  const {
    batchMilliseconds: _batchMilliseconds,
    averageBatchMilliseconds: _averageBatchMilliseconds,
    pairBuildMilliseconds: _pairBuildMilliseconds,
    localConflictMilliseconds: _localConflictMilliseconds,
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
    expect(first.summary.conflictPairs).toBeGreaterThan(20);
    expect(first.summary.maxComponentSize).toBeGreaterThanOrEqual(3);
    expect(first.displacedActors).toBeGreaterThanOrEqual(12);
    expect(first.totalDisplacement).toBeGreaterThan(1000);
    expect(first.actorsPassingDoor).toBeGreaterThan(0);
    expect(first.actorsApproachingDoor).toBeGreaterThanOrEqual(4);
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
});
