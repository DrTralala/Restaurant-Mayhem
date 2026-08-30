import { describe, expect, it } from 'vitest';
import { createMovementMetrics, summariseMovementMetrics } from './movementMetrics';

const metricKeys = [
  'batches',
  'batchMilliseconds',
  'pairChecks',
  'conflictPairs',
  'components',
  'maxComponentSize',
  'solverCalls',
  'solverPbs',
  'solverAgedFallback',
  'solverNull',
  'solverNodePops',
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
    metrics.solverCalls = 4;

    const summary = summariseMovementMetrics(metrics);
    metrics.solverCalls = 8;

    expect(summary).not.toBe(metrics);
    expect(summary.averageBatchMilliseconds).toBe(4.5);
    expect(summary.solverCalls).toBe(4);
  });
});
