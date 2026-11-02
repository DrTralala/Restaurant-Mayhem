import { normalisePartyReviewHistory } from '../simulation/partyReviews';

export function getPartyReviewDayTrend(history) {
  const days = new Map();

  for (const review of normalisePartyReviewHistory(history)) {
    let daySummary = days.get(review.day);
    if (!daySummary) {
      daySummary = {
        day: review.day,
        reviewCount: 0,
        scoreTotal: 0,
        unaffordablePartyCount: 0,
      };
      days.set(review.day, daySummary);
    }

    daySummary.reviewCount += 1;
    daySummary.scoreTotal += review.score;
    if (review.unaffordableCount > 0) daySummary.unaffordablePartyCount += 1;
  }

  return Array.from(days.values(), ({
    day, reviewCount, scoreTotal, unaffordablePartyCount,
  }) => ({
    day,
    reviewCount,
    averageScore: scoreTotal / reviewCount,
    unaffordablePartyCount,
    unaffordableShare: unaffordablePartyCount / reviewCount,
  }))
    .sort((left, right) => right.day - left.day)
    .slice(0, 7);
}
