import { describe, expect, it } from 'vitest';
import {
  PAID_REVIEW_SCORE,
  cancelPendingPartyReviews,
  normalisePartyReviewHistory,
  normalisePendingPartyReviews,
  recordPartyOrderOutcome,
  recordPartyPayment,
  settlePartyReview,
} from './partyReviews';

const party = [
  { id: 'a', partyId: 'p1' },
  { id: 'b', partyId: 'p1' },
];

describe('pending party reviews', () => {
  it('records unique ordered and unaffordable outcomes idempotently', () => {
    let records = recordPartyOrderOutcome([], party, party[0], 'ordered');
    records = recordPartyOrderOutcome(records, party, party[0], 'ordered');
    records = recordPartyOrderOutcome(records, party, party[1], 'unaffordable');
    expect(records).toEqual([{
      partyId: 'p1', memberIds: ['a', 'b'], orderedMemberIds: ['a'],
      unaffordableMemberIds: ['b'], paidReviews: [],
    }]);
  });

  it('records a fixed positive paid contribution once', () => {
    let records = recordPartyOrderOutcome([], party, party[0], 'ordered');
    records = recordPartyOrderOutcome(records, party, party[1], 'unaffordable');
    records = recordPartyPayment(records, party[0]);
    records = recordPartyPayment(records, party[0]);
    expect(records[0].paidReviews).toEqual([{ customerId: 'a', score: PAID_REVIEW_SCORE }]);
    const result = settlePartyReview({ ...baseSettlement, pendingPartyReviews: records }, 'p1');
    expect(result.review.reputationDelta).toBeCloseTo(-0.002);
  });

  it('cancels only specified party records', () => {
    const records = [{ partyId: 'p1' }, { partyId: 'p2' }];
    expect(cancelPendingPartyReviews(records, new Set(['p1']))).toEqual([{ partyId: 'p2' }]);
  });

  it('preserves stable outcome order for repeated identical outcomes', () => {
    let records = recordPartyOrderOutcome([], party, party[0], 'ordered');
    records = recordPartyOrderOutcome(records, party, party[1], 'ordered');
    records = recordPartyOrderOutcome(records, party, party[0], 'ordered');

    expect(records[0].orderedMemberIds).toEqual(['a', 'b']);
  });

  it('rejects same-party members absent from canonical membership', () => {
    const forged = { id: 'forged', partyId: 'p1' };
    const pending = [{
      partyId: 'p1', memberIds: ['a', 'b'], orderedMemberIds: ['a'],
      unaffordableMemberIds: [], paidReviews: [],
    }];
    expect(recordPartyOrderOutcome(pending, [...party, forged], forged, 'ordered'))
      .toEqual(pending);

    const malformed = [{
      partyId: 'p1', memberIds: ['a'], orderedMemberIds: ['forged'],
      unaffordableMemberIds: [], paidReviews: [],
    }];
    expect(recordPartyPayment(malformed, forged)).toEqual(malformed);
  });
});

const baseSettlement = {
  partyReviewHistory: [],
  restaurant: { reputation: 3, day: 2 },
  upgrades: [],
};

describe('settled party reviews', () => {
  it('makes a perfect-plus-unaffordable couple slightly negative', () => {
    let pending = recordPartyOrderOutcome([], party, party[0], 'ordered');
    pending = recordPartyOrderOutcome(pending, party, party[1], 'unaffordable');
    pending = recordPartyPayment(pending, party[0]);
    const result = settlePartyReview({ ...baseSettlement, pendingPartyReviews: pending }, 'p1');
    expect(result.review).toMatchObject({
      partyId: 'p1', score: -5, memberCount: 2, paidCount: 1,
      unaffordableCount: 1, reputationDelta: -0.002,
    });
    expect(result.restaurant.reputation).toBeCloseTo(2.998);
    expect(result.pendingPartyReviews).toEqual([]);
  });

  it('settles a solo unaffordable review at minus fifty', () => {
    const solo = [{ id: 'solo', partyId: 'solo-party' }];
    const pending = recordPartyOrderOutcome([], solo, solo[0], 'unaffordable');
    const result = settlePartyReview({ ...baseSettlement, pendingPartyReviews: pending }, 'solo-party');
    expect(result.review.score).toBe(-50);
    expect(result.review.reputationDelta).toBe(-0.01);
  });

  it('multiplies positive gains but never negative penalties', () => {
    const upgrades = [{
      id: 'review-boost', level: 1,
      effects: { type: 'reputationGain', value: 0.5 },
    }];
    let positive = recordPartyOrderOutcome([], party, party[0], 'ordered');
    positive = recordPartyOrderOutcome(positive, party, party[1], 'ordered');
    positive = recordPartyPayment(positive, party[0]);
    positive = recordPartyPayment(positive, party[1]);
    const positiveResult = settlePartyReview({
      ...baseSettlement, upgrades, pendingPartyReviews: positive,
    }, 'p1');
    expect(positiveResult.review.reputationDelta).toBeCloseTo(0.06);
    expect(positiveResult.restaurant.reputation).toBeCloseTo(3.06);

    const solo = [{ id: 'solo', partyId: 'solo-party' }];
    const negative = recordPartyOrderOutcome([], solo, solo[0], 'unaffordable');
    const negativeResult = settlePartyReview({
      ...baseSettlement, upgrades, pendingPartyReviews: negative,
    }, 'solo-party');
    expect(negativeResult.review.reputationDelta).toBe(-0.01);
    expect(negativeResult.restaurant.reputation).toBeCloseTo(2.99);
  });

  it('does not settle incomplete records or duplicate a completed settlement', () => {
    const incomplete = recordPartyOrderOutcome([], party, party[0], 'ordered');
    const unchanged = settlePartyReview({
      ...baseSettlement, pendingPartyReviews: incomplete,
    }, 'p1');
    expect(unchanged.review).toBeNull();
    expect(unchanged.pendingPartyReviews).toEqual(incomplete);
    expect(unchanged.partyReviewHistory).toEqual([]);
    expect(unchanged.restaurant).toEqual(baseSettlement.restaurant);

    const absent = settlePartyReview(unchanged, 'missing-party');
    expect(absent.review).toBeNull();
    expect(absent.pendingPartyReviews).toEqual(incomplete);
  });

  it('discards a complete pending record whose globally unique party ID is already settled', () => {
    let pending = recordPartyOrderOutcome([], party, party[0], 'ordered');
    pending = recordPartyOrderOutcome(pending, party, party[1], 'ordered');
    pending = recordPartyPayment(pending, party[0]);
    pending = recordPartyPayment(pending, party[1]);
    const completed = {
      partyId: 'p1', day: 1, score: 60, memberCount: 2,
      paidCount: 2, unaffordableCount: 0, reputationDelta: 0.024,
    };

    const result = settlePartyReview({
      ...baseSettlement,
      pendingPartyReviews: pending,
      partyReviewHistory: [completed],
    }, 'p1');

    expect(result.review).toBeNull();
    expect(result.pendingPartyReviews).toEqual([]);
    expect(result.partyReviewHistory).toEqual([completed]);
    expect(result.restaurant).toEqual(baseSettlement.restaurant);
  });

  it('keeps only the latest thirty history records', () => {
    const solo = [{ id: 'solo', partyId: 'solo-party' }];
    const pending = recordPartyOrderOutcome([], solo, solo[0], 'unaffordable');
    const history = Array.from({ length: 30 }, (_, index) => ({
      partyId: `old-${index}`, day: 1, score: 50, memberCount: 1,
      paidCount: 1, unaffordableCount: 0, reputationDelta: 0.01,
    }));
    const result = settlePartyReview({
      ...baseSettlement, pendingPartyReviews: pending, partyReviewHistory: history,
    }, 'solo-party');
    expect(result.partyReviewHistory).toHaveLength(30);
    expect(result.partyReviewHistory[0].partyId).toBe('old-1');
    expect(result.partyReviewHistory.at(-1).partyId).toBe('solo-party');
  });

  it('rejects duplicate, unrelated, unaffordable, or invalid extra payments', () => {
    const paymentVariants = [
      [{ customerId: 'a', score: 100 }, { customerId: 'a', score: 80 }],
      [{ customerId: 'a', score: 100 }, { customerId: 'b', score: 50 }],
      [{ customerId: 'a', score: 100 }, { customerId: 'missing', score: 50 }],
      [{ customerId: 'a', score: 100 }, { customerId: 'a', score: Number.NaN }],
    ];

    for (const paidReviews of paymentVariants) {
      const pendingPartyReviews = [{
        partyId: 'p1', memberIds: ['a', 'b'], orderedMemberIds: ['a'],
        unaffordableMemberIds: ['b'], paidReviews,
      }];
      const result = settlePartyReview({
        ...baseSettlement, pendingPartyReviews,
      }, 'p1');

      expect(result.review).toBeNull();
      expect(result.pendingPartyReviews).toBe(pendingPartyReviews);
      expect(result.partyReviewHistory).toBe(baseSettlement.partyReviewHistory);
      expect(result.restaurant).toBe(baseSettlement.restaurant);
    }
  });
});

describe('party review hydration', () => {
  it('deduplicates pending IDs and keeps payments only for ordered members', () => {
    expect(normalisePendingPartyReviews([{
      partyId: 'p1',
      memberIds: ['a', 'a', 'b', null],
      orderedMemberIds: ['a', 'a', 'missing'],
      unaffordableMemberIds: ['a', 'b', 'b'],
      paidReviews: [
        { customerId: 'a', score: 120 },
        { customerId: 'a', score: 80 },
        { customerId: 'b', score: 50 },
        { customerId: 'missing', score: 70 },
      ],
    }, { partyId: 'empty', memberIds: [] }])).toEqual([{
      partyId: 'p1', memberIds: ['a', 'b'], orderedMemberIds: ['a'],
      unaffordableMemberIds: ['b'],
      paidReviews: [{ customerId: 'a', score: 100 }],
    }]);
  });

  it('rejects malformed history and keeps the latest thirty valid records', () => {
    const valid = Array.from({ length: 32 }, (_, index) => ({
      partyId: `p${index}`, day: index + 1, score: index - 5,
      memberCount: 2, paidCount: 1, unaffordableCount: 1,
      reputationDelta: (index - 5) / 5000,
    }));
    const result = normalisePartyReviewHistory([
      { partyId: '', day: 1, score: 20, memberCount: 1, paidCount: 1, unaffordableCount: 0, reputationDelta: 0.01 },
      { partyId: 'broken', day: 1, score: Number.NaN, memberCount: 1, paidCount: 1, unaffordableCount: 0, reputationDelta: 0.01 },
      ...valid,
    ]);
    expect(result).toHaveLength(30);
    expect(result[0].partyId).toBe('p2');
    expect(result.at(-1).partyId).toBe('p31');
  });

  it('rejects pending records with wrong-typed outcome or payment containers', () => {
    const valid = {
      partyId: 'valid', memberIds: ['a', 'b'], orderedMemberIds: ['a'],
      unaffordableMemberIds: ['b'], paidReviews: [],
    };
    expect(normalisePendingPartyReviews([
      { ...valid, partyId: 'bad-ordered', orderedMemberIds: 'a' },
      { ...valid, partyId: 'bad-unaffordable', unaffordableMemberIds: 'b' },
      { ...valid, partyId: 'bad-payments', paidReviews: {} },
      valid,
    ])).toEqual([valid]);
  });

  it('keeps the first pending record for each party ID', () => {
    const first = {
      partyId: 'p1', memberIds: ['a'], orderedMemberIds: ['a'],
      unaffordableMemberIds: [], paidReviews: [],
    };
    const duplicate = {
      partyId: 'p1', memberIds: ['b'], orderedMemberIds: [],
      unaffordableMemberIds: ['b'], paidReviews: [],
    };
    const other = {
      partyId: 'p2', memberIds: ['c'], orderedMemberIds: [],
      unaffordableMemberIds: ['c'], paidReviews: [],
    };

    expect(normalisePendingPartyReviews([first, duplicate, other])).toEqual([first, other]);
  });

  it('normalises history before appending and retaining the latest thirty records', () => {
    const solo = [{ id: 'solo', partyId: 'solo-party' }];
    const pendingPartyReviews = recordPartyOrderOutcome([], solo, solo[0], 'unaffordable');
    const history = [
      ...Array.from({ length: 30 }, (_, index) => ({
        partyId: `old-${index}`, day: 1, score: 50, memberCount: 1,
        paidCount: 1, unaffordableCount: 0, reputationDelta: 0.01,
      })),
      {
        partyId: 'bad', day: 1, score: Number.NaN, memberCount: 1,
        paidCount: 1, unaffordableCount: 0, reputationDelta: 0.01,
      },
    ];
    const result = settlePartyReview({
      ...baseSettlement, pendingPartyReviews, partyReviewHistory: history,
    }, 'solo-party');

    expect(result.partyReviewHistory).toHaveLength(30);
    expect(result.partyReviewHistory[0].partyId).toBe('old-1');
    expect(result.partyReviewHistory.at(-1).partyId).toBe('solo-party');
    expect(result.partyReviewHistory.some(review => review.partyId === 'bad')).toBe(false);
  });
});
