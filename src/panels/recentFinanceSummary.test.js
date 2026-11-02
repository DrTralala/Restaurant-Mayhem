import { describe, expect, it } from 'vitest';
import { getRecentFinanceSummary } from './recentFinanceSummary';

const EMPTY_SUMMARY = {
  recordCount: 0,
  revenue: { count: 0, total: null },
  payroll: { count: 0, total: null },
  profit: { count: 0, total: null, average: null, positiveCount: 0 },
};

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('getRecentFinanceSummary', () => {
  it('returns empty totals for empty or non-array history', () => {
    for (const history of [undefined, null, {}, 'history', 42, true]) {
      expect(getRecentFinanceSummary(history)).toEqual(EMPTY_SUMMARY);
    }
    expect(getRecentFinanceSummary([])).toEqual(EMPTY_SUMMARY);
  });

  it('counts finite values independently and preserves zero, signs and fractions', () => {
    expect(getRecentFinanceSummary([
      { revenue: 0, payroll: -0, profit: 0 },
      { revenue: -4.5, payroll: 1.25, profit: -3 },
      { revenue: 2.25, payroll: 0.75, profit: 9 },
    ])).toEqual({
      recordCount: 3,
      revenue: { count: 3, total: -2.25 },
      payroll: { count: 3, total: 2 },
      profit: { count: 3, total: 6, average: 2, positiveCount: 1 },
    });
  });

  it('excludes missing, non-finite and non-number fields without inferring stored profit', () => {
    expect(getRecentFinanceSummary([
      null,
      undefined,
      'record',
      { revenue: '7', payroll: Number.NaN, profit: Number.POSITIVE_INFINITY },
      { revenue: Number.POSITIVE_INFINITY, payroll: '8' },
      { revenue: 4.5, payroll: -2.5, profit: null },
    ])).toEqual({
      recordCount: 6,
      revenue: { count: 1, total: 4.5 },
      payroll: { count: 1, total: -2.5 },
      profit: { count: 0, total: null, average: null, positiveCount: 0 },
    });
  });

  it('selects the last seven entries before filtering values and does not backfill', () => {
    const history = [
      { day: 1, revenue: 1000, payroll: 100, profit: 900 },
      { day: 2 },
      { day: 3 },
      { day: 4 },
      { day: 5 },
      { day: 6 },
      { day: 7 },
      { day: 8, revenue: 0 },
    ];

    expect(getRecentFinanceSummary(history)).toEqual({
      recordCount: 7,
      revenue: { count: 1, total: 0 },
      payroll: { count: 0, total: null },
      profit: { count: 0, total: null, average: null, positiveCount: 0 },
    });
  });

  it('counts array records rather than deduplicating or filling gaps in day labels', () => {
    expect(getRecentFinanceSummary([
      { day: 2, revenue: 1, payroll: 0, profit: 1 },
      { day: 2, revenue: 2, payroll: 1, profit: 1 },
      { day: 99, revenue: 3, payroll: 1, profit: 2 },
    ])).toEqual({
      recordCount: 3,
      revenue: { count: 3, total: 6 },
      payroll: { count: 3, total: 2 },
      profit: { count: 3, total: 4, average: 4 / 3, positiveCount: 3 },
    });
  });

  it('leaves frozen input unchanged and returns deterministic summaries', () => {
    const history = freeze([
      { day: 1, revenue: 10.5, payroll: 3, profit: 7.5 },
      { day: 2, revenue: -2, payroll: 5, profit: -7 },
    ]);
    const snapshot = JSON.stringify(history);

    const summary = getRecentFinanceSummary(history);

    expect(summary).toEqual({
      recordCount: 2,
      revenue: { count: 2, total: 8.5 },
      payroll: { count: 2, total: 8 },
      profit: { count: 2, total: 0.5, average: 0.25, positiveCount: 1 },
    });
    expect(getRecentFinanceSummary(history)).toEqual(summary);
    expect(JSON.stringify(history)).toBe(snapshot);
  });

  it('retains contributor counts when finite values overflow their total', () => {
    expect(getRecentFinanceSummary([
      { revenue: Number.MAX_VALUE },
      { revenue: Number.MAX_VALUE },
    ])).toEqual({
      recordCount: 2,
      revenue: { count: 2, total: Number.POSITIVE_INFINITY },
      payroll: { count: 0, total: null },
      profit: { count: 0, total: null, average: null, positiveCount: 0 },
    });
  });
});
