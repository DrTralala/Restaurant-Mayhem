import { describe, expect, it } from 'vitest';
import {
  QUEUE_PARTY_CAPACITY,
  getQueuePartyCount,
  getQueuePartyMemberPosition,
  getQueueProjectedMembers,
  findOldestCompatibleQueueParty,
  normaliseCustomerQueue,
} from './customerQueue';

describe('customer queue party records', () => {
  it('groups legacy members by first-seen party order and is idempotent', () => {
    const legacy = [
      { id: 'a1', partyId: 'a' },
      { id: 'b1', partyId: 'b' },
      { id: 'a2', partyId: 'a' },
    ];
    const once = normaliseCustomerQueue(legacy);
    expect(once.map(party => party.partyId)).toEqual(['a', 'b']);
    expect(once[0].members.map(member => member.id)).toEqual(['a1', 'a2']);
    expect(normaliseCustomerQueue(once)).toEqual(once);
  });

  it('counts party records rather than members', () => {
    const queue = normaliseCustomerQueue([
      { id: 'a1', partyId: 'a' }, { id: 'a2', partyId: 'a' },
      { id: 'b1', partyId: 'b' },
    ]);
    expect(getQueuePartyCount(queue)).toBe(2);
    expect(QUEUE_PARTY_CAPACITY).toBe(8);
  });

  it('selects the oldest compatible party without removing earlier records', () => {
    const queue = normaliseCustomerQueue([
      { id: 'large-1', partyId: 'large' }, { id: 'large-2', partyId: 'large' },
      { id: 'solo-1', partyId: 'solo' },
    ]);
    expect(findOldestCompatibleQueueParty(queue, party => party.members.length <= 1)?.partyId)
      .toBe('solo');
    expect(queue.map(party => party.partyId)).toEqual(['large', 'solo']);
  });

  it('keeps every supported party footprint disjoint and inside the queue area', () => {
    const state = { restaurant: { expansionLevel: 1 } };
    const projections = Array.from({ length: 8 }, (_, partyIndex) =>
      Array.from({ length: 4 }, (_, memberIndex) =>
        getQueuePartyMemberPosition(state, partyIndex, memberIndex, 4)));
    for (let left = 0; left < projections.length; left += 1) {
      for (let right = left + 1; right < projections.length; right += 1) {
        expect(Math.min(...projections[left].flatMap(a =>
          projections[right].map(b => Math.hypot(a.x - b.x, a.y - b.y))))).toBeGreaterThanOrEqual(30);
      }
    }
    const queue = normaliseCustomerQueue([
      { id: 'a1', partyId: 'a' }, { id: 'a2', partyId: 'a' },
    ]);
    const projected = getQueueProjectedMembers(state, queue);
    expect(projected.map(member => member.id)).toEqual(['a1', 'a2']);
    expect(projected.every(member => Number.isFinite(member.x) && Number.isFinite(member.y))).toBe(true);
    expect(queue.every(party => party.members.every(member =>
      !('x' in member) && !('y' in member) && !('path' in member) && !('pathGoal' in member)))).toBe(true);
  });
});
