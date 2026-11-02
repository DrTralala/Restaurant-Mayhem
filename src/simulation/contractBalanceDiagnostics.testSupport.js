const timestampFields = [
  'arrivalAt', 'admittedAt', 'seatedAt', 'orderedAt', 'foodOrderedAt', 'foodDeadlineAt',
  'foodCancelledAt', 'preparationStartedAt', 'readyAt', 'deliveredAt', 'paidAt',
];

const unavailableStages = ['seatedAt', 'deliveredAt'];

function finiteTime(value) {
  return Number.isFinite(value) ? value : null;
}

function stageRowFor(stageFacts, guestId) {
  if (stageFacts instanceof Map) return stageFacts.get(guestId) || {};
  return stageFacts?.[guestId] || {};
}

function rowsFor(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  return [];
}

function firstFinite(...values) {
  return values.find(Number.isFinite) ?? null;
}

function itemTimestamp(items, guestId, field) {
  const times = items.filter(item => item?.customerId === guestId)
    .map(item => item?.[field]).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}

function paidVisitTimestamp(paidVisits, guestId) {
  const visit = paidVisits.find(row => (row?.guestId ?? row?.id ?? row?.customerId) === guestId);
  return firstFinite(visit?.paidAt, visit?.at);
}

function orderFactByGuest(orderFacts) {
  return new Map(rowsFor(orderFacts).filter(row => row && row.guestId != null)
    .map(row => [row.guestId, row]));
}

export function summariseContractDiagnostics({ active = null, result = null, orderFacts = [],
  stageFacts = new Map(), paidVisits = [], parties = [], serviceItems = [] } = {}) {
  const ledgerRows = active?.guests || result?.guestResults || [];
  const outcomes = ledgerRows.map(row => ({
    guestId: row.guestId,
    partyId: row.partyId,
    status: row.status,
    reason: row.reason,
    paidVisitSequence: row.paidVisitSequence,
    resolvedAt: row.resolvedAt,
  }));
  const reasonCounts = {};
  for (const row of outcomes) {
    if (typeof row.reason !== 'string' || row.reason.length === 0) continue;
    reasonCounts[row.reason] = (reasonCounts[row.reason] || 0) + 1;
  }

  const categoryGuests = {
    missedArrival: new Set(),
    queueSeatingLoss: new Set(),
    identityConflict: new Set(),
    drinkOnlyChoice: new Set(),
    unaffordableFood: new Set(),
    cancelledFood: new Set(),
    unpaidDeparture: new Set(),
    unresolvedAtDeadline: new Set(),
  };
  const factsByGuest = orderFactByGuest(orderFacts);
  for (const row of outcomes) {
    const guestId = row.guestId;
    const fact = factsByGuest.get(guestId);
    const add = (category, condition) => {
      if (condition && guestId != null) categoryGuests[category].add(guestId);
    };
    add('missedArrival', row.status === 'missed');
    add('queueSeatingLoss', ['missed_queue_full', 'abandoned'].includes(row.reason));
    add('identityConflict', row.reason === 'missed_identity_conflict');
    add('drinkOnlyChoice', row.reason === 'drink_only' || fact?.drinkOnly === true
      || (fact?.menuOutcome === 'ordered' && fact.dishId == null && fact.drinkId != null));
    add('unaffordableFood', fact?.affordableFood === false);
    add('cancelledFood', row.reason === 'food_cancelled');
    add('unpaidDeparture', row.reason === 'left_unpaid');
    add('unresolvedAtDeadline', row.status === 'unfinished' && row.reason === 'deadline');
  }

  const partyRows = rowsFor(parties);
  const itemRows = rowsFor(serviceItems);
  const paidRows = rowsFor(paidVisits);
  const stagesByGuest = outcomes.map(row => {
    const retained = stageRowFor(stageFacts, row.guestId);
    const party = partyRows.find(candidate => candidate?.partyId === row.partyId);
    const qualifyingLedgerPayment = row.status === 'fulfilled_paid' && row.paidVisitSequence != null
      ? row.resolvedAt : null;
    const timestamps = {
      arrivalAt: firstFinite(retained.arrivalAt, party?.arrivalAt),
      admittedAt: firstFinite(retained.admittedAt, party?.admittedAt),
      seatedAt: null,
      orderedAt: finiteTime(retained.orderedAt),
      foodOrderedAt: finiteTime(retained.foodOrderedAt),
      foodDeadlineAt: finiteTime(retained.foodDeadlineAt),
      foodCancelledAt: finiteTime(retained.foodCancelledAt),
      preparationStartedAt: firstFinite(retained.preparationStartedAt,
        itemTimestamp(itemRows, row.guestId, 'preparationStartedAt')),
      readyAt: firstFinite(retained.readyAt, itemTimestamp(itemRows, row.guestId, 'readyAt')),
      deliveredAt: null,
      paidAt: firstFinite(retained.paidAt, paidVisitTimestamp(paidRows, row.guestId), qualifyingLedgerPayment),
    };
    return { guestId: row.guestId, ...Object.fromEntries(timestampFields.map(field => [field, timestamps[field]])) };
  });

  return {
    rulesVersion: active?.rulesVersion ?? result?.rulesVersion ?? null,
    outcomes,
    reasonCounts,
    categoryCounts: Object.fromEntries(Object.entries(categoryGuests).map(([category, guests]) => [category, guests.size])),
    stagesByGuest,
    unavailableStages: [...unavailableStages],
  };
}
