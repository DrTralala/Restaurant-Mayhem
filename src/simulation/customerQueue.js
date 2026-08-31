import { getRestaurantWorld } from './world';

export const QUEUE_PARTY_CAPACITY = 8;
const SLOT_STEP = 70;
const MEMBER_OFFSETS = Object.freeze({
  1: [{ x: 0, y: 0 }],
  2: [{ x: -14, y: 0 }, { x: 14, y: 0 }],
  3: [{ x: -14, y: -15 }, { x: 14, y: -15 }, { x: 0, y: 15 }],
  4: [
    { x: -14, y: -15 }, { x: 14, y: -15 },
    { x: -14, y: 15 }, { x: 14, y: 15 },
  ],
});

export function normaliseCustomerQueue(queue = []) {
  const parties = [];
  const byId = new Map();
  const append = (partyId, members) => {
    const id = String(partyId);
    let record = byId.get(id);
    if (!record) {
      record = { partyId: id, members: [] };
      byId.set(id, record);
      parties.push(record);
    }
    for (const member of members) {
      record.members.push({ ...member, partyId: id });
    }
  };
  queue.forEach((entry, index) => {
    if (Array.isArray(entry?.members)) {
      append(entry.partyId ?? entry.members[0]?.partyId ?? `legacy-party-${index}`, entry.members);
    } else if (entry) {
      append(entry.partyId ?? entry.id ?? `legacy-party-${index}`, [entry]);
    }
  });
  return parties;
}

export function getQueuePartyCount(queue) {
  return normaliseCustomerQueue(queue).length;
}

export function findOldestCompatibleQueueParty(queue, canSeatParty) {
  return normaliseCustomerQueue(queue).find(party => canSeatParty(party)) || null;
}

function getQueueSlotAnchors(state) {
  const world = getRestaurantWorld(state.restaurant || {});
  const doorReference = { x: world.queueX + 25, y: world.doorY + 20 };
  return Array.from({ length: QUEUE_PARTY_CAPACITY }, (_, index) => ({
    x: world.queueX + 25,
    y: world.queueY + 30 + index * SLOT_STEP,
  })).sort((left, right) =>
    Math.hypot(left.x - doorReference.x, left.y - doorReference.y)
      - Math.hypot(right.x - doorReference.x, right.y - doorReference.y)
    || left.y - right.y);
}

export function getQueuePartyMemberPosition(state, partyIndex, memberIndex, partySize) {
  const anchor = getQueueSlotAnchors(state)[partyIndex];
  const offsets = MEMBER_OFFSETS[partySize];
  if (!anchor || !offsets || !offsets[memberIndex]) return { x: NaN, y: NaN };
  return {
    x: anchor.x + offsets[memberIndex].x,
    y: anchor.y + offsets[memberIndex].y,
  };
}

export function getQueueProjectedMembers(state, queue) {
  return normaliseCustomerQueue(queue)
    .slice(0, QUEUE_PARTY_CAPACITY)
    .flatMap((party, partyIndex) => party.members.map((member, memberIndex) => ({
      ...member,
      ...getQueuePartyMemberPosition(
        state,
        partyIndex,
        memberIndex,
        party.members.length,
      ),
    })));
}
