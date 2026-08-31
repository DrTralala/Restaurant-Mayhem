import { describe, expect, it } from 'vitest';
import {
  QUEUE_PARTY_CAPACITY,
  getQueuePartyCount,
  getQueuePartyMemberPosition,
  getQueueProjectedMembers,
  findOldestCompatibleQueueParty,
  normaliseCustomerQueue,
} from './customerQueue';
import { getRestaurantWorld } from './world';

const CHARACTER_FOOTPRINT = Object.freeze({ left: 9, right: 9, top: 4, bottom: 22 });

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

  it.each([1, 2, 3, 4])('keeps size-%i party footprints disjoint and inside the queue area', partySize => {
    const state = { restaurant: { expansionLevel: 1 } };
    const world = getRestaurantWorld(state.restaurant);
    const projections = Array.from({ length: 8 }, (_, partyIndex) =>
      Array.from({ length: partySize }, (_, memberIndex) =>
        getQueuePartyMemberPosition(state, partyIndex, memberIndex, partySize)));
    for (const party of projections) {
      for (const member of party) {
        expect(member.x - CHARACTER_FOOTPRINT.left).toBeGreaterThanOrEqual(world.queueX);
        expect(member.x + CHARACTER_FOOTPRINT.right).toBeLessThanOrEqual(world.queueX + world.queueW);
        expect(member.y - CHARACTER_FOOTPRINT.top).toBeGreaterThanOrEqual(world.queueY);
        expect(member.y + CHARACTER_FOOTPRINT.bottom).toBeLessThanOrEqual(world.queueY + world.queueH);
      }
      for (let left = 0; left < party.length; left += 1) {
        for (let right = left + 1; right < party.length; right += 1) {
          expect(Math.hypot(
            party[left].x - party[right].x,
            party[left].y - party[right].y,
          )).toBeGreaterThanOrEqual(16);
        }
      }
    }
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
