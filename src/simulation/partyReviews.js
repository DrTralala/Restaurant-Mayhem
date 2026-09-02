import { clampReputation, getUpgradeEffect } from './balance';

function getRecordEntries(records) {
  return Array.isArray(records) ? records : [];
}

function uniquePartyMemberIds(partyMembers, partyId) {
  const seen = new Set();
  const memberIds = [];
  for (const member of Array.isArray(partyMembers) ? partyMembers : []) {
    if (getPartyKey(member) !== partyId || member?.id == null || seen.has(member.id)) continue;
    seen.add(member.id);
    memberIds.push(member.id);
  }
  return memberIds;
}

export function getPartyKey(customer) {
  return customer?.partyId ?? customer?.id;
}

export function recordPartyOrderOutcome(records, partyMembers, customer, outcome) {
  if (!['ordered', 'unaffordable'].includes(outcome)) return records;

  const entries = getRecordEntries(records);
  const partyId = getPartyKey(customer);
  const customerId = customer?.id;
  if (partyId == null || customerId == null) return records;

  const recordIndex = entries.findIndex(record => record?.partyId === partyId);
  if (recordIndex === -1) {
    const memberIds = uniquePartyMemberIds(partyMembers, partyId);
    if (!memberIds.includes(customerId)) return records;
    return [
      ...entries,
      {
        partyId,
        memberIds,
        orderedMemberIds: outcome === 'ordered' ? [customerId] : [],
        unaffordableMemberIds: outcome === 'unaffordable' ? [customerId] : [],
        paidReviews: [],
      },
    ];
  }

  const record = entries[recordIndex];
  const orderedMemberIds = (Array.isArray(record.orderedMemberIds)
    ? record.orderedMemberIds : []).filter(id => id !== customerId);
  const unaffordableMemberIds = (Array.isArray(record.unaffordableMemberIds)
    ? record.unaffordableMemberIds : []).filter(id => id !== customerId);
  const paidReviews = (Array.isArray(record.paidReviews) ? record.paidReviews : [])
    .filter(review => review?.customerId !== customerId || outcome === 'ordered');
  const updatedRecord = {
    ...record,
    orderedMemberIds: outcome === 'ordered'
      ? [...orderedMemberIds, customerId] : orderedMemberIds,
    unaffordableMemberIds: outcome === 'unaffordable'
      ? [...unaffordableMemberIds, customerId] : unaffordableMemberIds,
    paidReviews,
  };

  return entries.map((entry, index) => index === recordIndex ? updatedRecord : entry);
}

export function recordPartyPayment(records, customer, score) {
  const entries = getRecordEntries(records);
  const partyId = getPartyKey(customer);
  const customerId = customer?.id;
  if (partyId == null || customerId == null || !Number.isFinite(score)) return records;

  const recordIndex = entries.findIndex(record => record?.partyId === partyId);
  if (recordIndex === -1) return records;
  const record = entries[recordIndex];
  if (!(Array.isArray(record.orderedMemberIds) && record.orderedMemberIds.includes(customerId))) {
    return records;
  }
  const paidReviews = Array.isArray(record.paidReviews) ? record.paidReviews : [];
  if (paidReviews.some(review => review?.customerId === customerId && Number.isFinite(review?.score))) {
    return records;
  }
  const payment = {
    customerId,
    score: Math.min(100, Math.max(0, score)),
  };
  const updatedRecord = { ...record, paidReviews: [...paidReviews, payment] };
  return entries.map((entry, index) => index === recordIndex ? updatedRecord : entry);
}

export function cancelPendingPartyReviews(records, partyIds) {
  const entries = getRecordEntries(records);
  const ids = partyIds instanceof Set ? partyIds : new Set(partyIds || []);
  return entries.filter(record => !ids.has(record?.partyId));
}

function isCompletePartyReview(record) {
  const memberIds = Array.isArray(record?.memberIds) ? record.memberIds : [];
  const orderedMemberIds = Array.isArray(record?.orderedMemberIds)
    ? record.orderedMemberIds : [];
  const unaffordableMemberIds = Array.isArray(record?.unaffordableMemberIds)
    ? record.unaffordableMemberIds : [];
  const memberSet = new Set(memberIds);
  const outcomeIds = [...orderedMemberIds, ...unaffordableMemberIds];
  if (!memberIds.length || memberSet.size !== memberIds.length
    || outcomeIds.length !== memberIds.length
    || new Set(outcomeIds).size !== memberIds.length
    || outcomeIds.some(id => !memberSet.has(id))) return false;

  const paidReviews = Array.isArray(record?.paidReviews) ? record.paidReviews : [];
  return orderedMemberIds.every(memberId => paidReviews.some(review =>
    review?.customerId === memberId && Number.isFinite(review.score)));
}

export function settlePartyReview({
  pendingPartyReviews,
  partyReviewHistory,
  restaurant,
  upgrades,
}, partyId) {
  const pendingRecord = Array.isArray(pendingPartyReviews)
    ? pendingPartyReviews.find(record => record?.partyId === partyId)
    : null;
  if (!pendingRecord || !isCompletePartyReview(pendingRecord)) {
    return {
      review: null,
      pendingPartyReviews,
      partyReviewHistory,
      restaurant,
    };
  }

  const orderedMemberIds = pendingRecord.orderedMemberIds;
  const unaffordableMemberIds = pendingRecord.unaffordableMemberIds;
  const paidReviews = pendingRecord.paidReviews;
  const paidTotal = orderedMemberIds.reduce((total, memberId) => {
    const payment = paidReviews.find(review =>
      review?.customerId === memberId && Number.isFinite(review?.score));
    const score = Math.min(100, Math.max(0, payment.score));
    return total + score;
  }, 0);
  const memberCount = pendingRecord.memberIds.length;
  const unaffordableCount = unaffordableMemberIds.length;
  const unaffordableScore = memberCount === 1 ? -50 : -110;
  const contributionTotal = paidTotal + unaffordableCount * unaffordableScore;
  const score = contributionTotal / memberCount;
  const rawDelta = contributionTotal / 5000;
  const reputationGainEffect = getUpgradeEffect({ upgrades }, 'reputationGain');
  const reputationDelta = rawDelta > 0 ? rawDelta * (1 + reputationGainEffect) : rawDelta;
  const review = {
    partyId,
    day: restaurant.day,
    score,
    memberCount,
    paidCount: orderedMemberIds.length,
    unaffordableCount,
    reputationDelta,
  };

  return {
    review,
    pendingPartyReviews: pendingPartyReviews.filter(record => record?.partyId !== partyId),
    partyReviewHistory: [...(Array.isArray(partyReviewHistory) ? partyReviewHistory : []), review]
      .slice(-30),
    restaurant: {
      ...restaurant,
      reputation: clampReputation(restaurant.reputation + reputationDelta),
    },
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function uniqueNonEmptyStrings(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(candidate => {
    if (!isNonEmptyString(candidate) || seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

export function normalisePendingPartyReviews(value) {
  if (!Array.isArray(value)) return [];

  return value.flatMap(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || !isNonEmptyString(record.partyId)) return [];

    const memberIds = uniqueNonEmptyStrings(record.memberIds);
    if (!memberIds.length) return [];
    const memberSet = new Set(memberIds);
    const orderedMemberIds = uniqueNonEmptyStrings(record.orderedMemberIds)
      .filter(memberId => memberSet.has(memberId));
    const orderedSet = new Set(orderedMemberIds);
    const unaffordableMemberIds = uniqueNonEmptyStrings(record.unaffordableMemberIds)
      .filter(memberId => memberSet.has(memberId) && !orderedSet.has(memberId));
    const paidReviews = [];
    const paidMemberIds = new Set();
    for (const payment of Array.isArray(record.paidReviews) ? record.paidReviews : []) {
      if (!payment || typeof payment !== 'object' || Array.isArray(payment)
        || !orderedSet.has(payment.customerId) || paidMemberIds.has(payment.customerId)
        || !Number.isFinite(payment.score)) continue;
      paidMemberIds.add(payment.customerId);
      paidReviews.push({
        customerId: payment.customerId,
        score: Math.min(100, Math.max(0, payment.score)),
      });
    }
    return [{
      partyId: record.partyId,
      memberIds,
      orderedMemberIds,
      unaffordableMemberIds,
      paidReviews,
    }];
  });
}

export function normalisePartyReviewHistory(value) {
  if (!Array.isArray(value)) return [];

  return value.filter(record => record && typeof record === 'object' && !Array.isArray(record)
    && isNonEmptyString(record.partyId)
    && Number.isFinite(record.day)
    && Number.isFinite(record.score)
    && Number.isFinite(record.reputationDelta)
    && Number.isInteger(record.memberCount) && record.memberCount > 0
    && Number.isInteger(record.paidCount) && record.paidCount >= 0
    && Number.isInteger(record.unaffordableCount) && record.unaffordableCount >= 0
    && record.paidCount + record.unaffordableCount === record.memberCount)
    .map(record => ({
      partyId: record.partyId,
      day: record.day,
      score: record.score,
      memberCount: record.memberCount,
      paidCount: record.paidCount,
      unaffordableCount: record.unaffordableCount,
      reputationDelta: record.reputationDelta,
    }))
    .slice(-30);
}
