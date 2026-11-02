import { describe, expect, it } from 'vitest';
import { getPartyReviewDayTrend } from './partyReviewTrend';

function review(partyId, day, score, memberCount = 1, unaffordableCount = 0) {
  return {
    partyId,
    day,
    score,
    memberCount,
    paidCount: memberCount - unaffordableCount,
    unaffordableCount,
    reputationDelta: 0,
  };
}

describe('getPartyReviewDayTrend', () => {
  it('returns an empty array for missing, non-array, and empty history', () => {
    expect(getPartyReviewDayTrend()).toEqual([]);
    expect(getPartyReviewDayTrend(null)).toEqual([]);
    expect(getPartyReviewDayTrend('not history')).toEqual([]);
    expect(getPartyReviewDayTrend([])).toEqual([]);
  });

  it('ignores malformed records using the canonical history normaliser', () => {
    expect(getPartyReviewDayTrend([
      null,
      [],
      review('', 1, 50),
      review('bad-score', 1, Number.NaN),
      review('bad-day', Number.POSITIVE_INFINITY, 50),
      { ...review('bad-counts', 1, 50), paidCount: 0 },
    ])).toEqual([]);
  });

  it('averages parties equally and counts parties with any unaffordable members', () => {
    expect(getPartyReviewDayTrend([
      review('solo', 3, 80, 1),
      review('larger', 3, 20, 4, 3),
    ])).toEqual([{
      day: 3,
      reviewCount: 2,
      averageScore: 50,
      unaffordablePartyCount: 1,
      unaffordableShare: 0.5,
    }]);
  });

  it('retains a valid negative-zero score in the daily sample', () => {
    const [row] = getPartyReviewDayTrend([review('zero', 1, -0)]);

    expect(row.reviewCount).toBe(1);
    expect(Object.is(row.averageScore, 0)).toBe(true);
  });

  it('sorts represented, nonconsecutive days newest first without filling gaps', () => {
    const trend = getPartyReviewDayTrend([
      review('day-two', 2, 40),
      review('day-eight', 8, 80),
      review('day-one', 1, 20),
    ]);

    expect(trend.map(row => row.day)).toEqual([8, 2, 1]);
  });

  it('keeps only the seven greatest represented day values', () => {
    const days = [3, 25, 9, 5, 20, 8, 15, 12, 21, 24];
    const trend = getPartyReviewDayTrend(days.map(day => review(`day-${day}`, day, day)));

    expect(trend.map(row => row.day)).toEqual([25, 24, 21, 20, 15, 12, 9]);
  });

  it('normalises to the latest thirty records, including a truncated day', () => {
    const firstDay = [10, 20, 30, 40].map((score, index) => review(`old-${index}`, 1, score));
    const secondDay = Array.from({ length: 28 }, (_, index) => review(`new-${index}`, 2, 70));
    const trend = getPartyReviewDayTrend([...firstDay, ...secondDay]);

    expect(trend).toEqual([
      {
        day: 2,
        reviewCount: 28,
        averageScore: 70,
        unaffordablePartyCount: 0,
        unaffordableShare: 0,
      },
      {
        day: 1,
        reviewCount: 2,
        averageScore: 35,
        unaffordablePartyCount: 0,
        unaffordableShare: 0,
      },
    ]);
  });

  it('does not mutate frozen history and returns deterministic rows', () => {
    const history = Object.freeze([
      Object.freeze(review('later', 4, 60, 2, 1)),
      Object.freeze(review('earlier', 2, 40)),
    ]);
    const expected = [
      {
        day: 4,
        reviewCount: 1,
        averageScore: 60,
        unaffordablePartyCount: 1,
        unaffordableShare: 1,
      },
      {
        day: 2,
        reviewCount: 1,
        averageScore: 40,
        unaffordablePartyCount: 0,
        unaffordableShare: 0,
      },
    ];

    expect(getPartyReviewDayTrend(history)).toEqual(expected);
    expect(getPartyReviewDayTrend(history)).toEqual(expected);
    expect(history).toEqual([
      review('later', 4, 60, 2, 1),
      review('earlier', 2, 40),
    ]);
  });
});
