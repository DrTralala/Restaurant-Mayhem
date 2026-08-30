import { describe, expect, it } from 'vitest';
import { buildDenseQueueScenario, runDenseQueueScenario } from './denseQueueStress';

const deterministicSummary = result => {
  const {
    batchMilliseconds: _batchMilliseconds,
    averageBatchMilliseconds: _averageBatchMilliseconds,
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
    expect(first.summary.batches).toBe(300);
    expect(first.summary.pairChecks).toBeGreaterThan(0);
    expect(first.summary.maxComponentSize).toBeGreaterThan(1);
    expect(first.progressedActors).toBeGreaterThan(0);
    expect(first.allCoordinatesFinite).toBe(true);
    expect(first.allActorsInsideWorld).toBe(true);
    expect(first.minimumEndpointSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(first.minimumSweptSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(deterministicSummary(second)).toEqual(deterministicSummary(first));
    expect(second.progressedActors).toBe(first.progressedActors);
    expect(second.allCoordinatesFinite).toBe(first.allCoordinatesFinite);
    expect(second.allActorsInsideWorld).toBe(first.allActorsInsideWorld);
    expect(second.minimumEndpointSpacing).toBe(first.minimumEndpointSpacing);
    expect(second.minimumSweptSpacing).toBe(first.minimumSweptSpacing);
  });
});
