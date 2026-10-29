function isCanonicalParty(party) {
  return party !== null
    && typeof party === 'object'
    && !Array.isArray(party)
    && typeof party.partyId === 'string'
    && party.partyId.trim().length > 0
    && Array.isArray(party.members);
}

/**
 * Move one canonical queued party to the front without changing any party data.
 * Invalid, ambiguous, missing and already-first requests are identity no-ops.
 */
export function prioritiseQueuedParty(queue, partyId) {
  if (!Array.isArray(queue) || typeof partyId !== 'string' || partyId.trim().length === 0) {
    return queue;
  }

  const seenPartyIds = new Set();
  for (const party of queue) {
    if (!isCanonicalParty(party) || seenPartyIds.has(party.partyId)) return queue;
    seenPartyIds.add(party.partyId);
  }

  const selectedIndex = queue.findIndex(party => party.partyId === partyId);
  if (selectedIndex <= 0) return queue;

  return [
    queue[selectedIndex],
    ...queue.slice(0, selectedIndex),
    ...queue.slice(selectedIndex + 1),
  ];
}
