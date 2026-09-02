import { describe, expect, it } from 'vitest';
import {
  QUEUE_PARTY_CAPACITY,
  getQueuePartyCount,
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

  it('projects queued customers as one straight line in party and member order', () => {
    const state = { restaurant: { expansionLevel: 1 } };
    const world = getRestaurantWorld(state.restaurant);
    const queue = normaliseCustomerQueue([
      { id: 'a1', partyId: 'a' }, { id: 'a2', partyId: 'a' },
      { id: 'b1', partyId: 'b' },
    ]);
    const projected = getQueueProjectedMembers(state, queue);
    expect(projected.map(member => ({ id: member.id, x: member.x, y: member.y }))).toEqual([
      { id: 'a1', x: 973, y: 390 },
      { id: 'a2', x: 973, y: 420 },
      { id: 'b1', x: 973, y: 450 },
    ]);
    expect(projected.every(member => member.x - CHARACTER_FOOTPRINT.left >= world.queueX
      && member.x + CHARACTER_FOOTPRINT.right <= world.queueX + world.queueW)).toBe(true);
    expect(projected.every(member => Number.isFinite(member.x) && Number.isFinite(member.y))).toBe(true);
    expect(queue.every(party => party.members.every(member =>
      !('x' in member) && !('y' in member) && !('path' in member) && !('pathGoal' in member)))).toBe(true);
  });
});
