import { getRestaurantWorld } from './world';

export const QUEUE_PARTY_CAPACITY = 8;
const MEMBER_STEP = 30;
const FIRST_MEMBER_DOOR_OFFSET = 50;
const BOTTOM_LABEL_OFFSET = 10;
const BOTTOM_MEMBER_CLEARANCE = 40;

export function normaliseCustomerQueue(queue = []) {
  const parties = [];
  const byId = new Map();
  const entries = Array.isArray(queue) ? queue : [];
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
  entries.forEach((entry, index) => {
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

function getQueueGeometry(state) {
  const world = getRestaurantWorld(state.restaurant || {});
  const firstY = world.doorY + FIRST_MEMBER_DOOR_OFFSET;
  const lastVisibleY = world.queueY + world.queueH - BOTTOM_MEMBER_CLEARANCE;
  return {
    world,
    x: world.queueX + world.queueW / 2,
    firstY,
    lastVisibleY,
    visibleCapacity: Math.max(0, Math.floor((lastVisibleY - firstY) / MEMBER_STEP) + 1),
  };
}

export function getQueueProjectedMembers(state, queue) {
  const geometry = getQueueGeometry(state);
  return normaliseCustomerQueue(queue)
    .flatMap(party => party.members)
    .map((member, index) => ({
      ...member,
      x: geometry.x,
      y: index < geometry.visibleCapacity
        ? geometry.firstY + index * MEMBER_STEP
        : geometry.world.queueY + geometry.world.queueH - 22,
    }));
}

export function getQueueDisplayLayout(state, queue) {
  const geometry = getQueueGeometry(state);
  const projected = getQueueProjectedMembers(state, queue);
  return {
    visibleMembers: projected.slice(0, geometry.visibleCapacity),
    hiddenCount: Math.max(0, projected.length - geometry.visibleCapacity),
    overflowLabelPosition: {
      x: geometry.x,
      y: geometry.world.queueY + geometry.world.queueH - BOTTOM_LABEL_OFFSET,
    },
  };
}
