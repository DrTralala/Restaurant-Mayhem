import { getRestaurantWorld } from './world';

export const QUEUE_PARTY_CAPACITY = 8;
const MEMBER_STEP = 30;
const FIRST_MEMBER_DOOR_OFFSET = 50;
const BOTTOM_LABEL_OFFSET = 10;
const BOTTOM_MEMBER_CLEARANCE = 40;
const QUEUE_LEASE_SPACING = 16;

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function queueMembers(queue) {
  return normaliseCustomerQueue(queue).flatMap(party => party.members);
}

function toId(value) {
  return value == null ? null : String(value);
}

function ownerPartyId(owner) {
  return owner?.partyId == null ? toId(owner?.id) : toId(owner.partyId);
}

function recordIsWithinUnrelatedActor(staff, customers, record, ownerId) {
  return [...(staff || []), ...(customers || [])].some(actor =>
    actor
      && toId(actor.id) !== ownerId
      && isFinitePoint(actor)
      && Math.hypot(record.x - actor.x, record.y - actor.y) < QUEUE_LEASE_SPACING);
}

function safeSlot(record) {
  return record.slot === undefined
    || (Number.isSafeInteger(record.slot) && record.slot >= 0);
}

// Trusted queue-member lease lookup for the canonical standing projection.
// A record is trusted only when it is structurally valid (finite exact x/y,
// safe optional slot), its memberId is a member of the supplied queue, and its
// partyId matches that member's own party. Multiple structurally valid records
// for the same member make the claim ambiguous: the member is projected as
// unplaced instead of choosing a last-write input-order winner. No runtime
// actor-proximity filter runs here: an existing physical standing member must
// never be hidden from the projection because another actor is close.
function queueLeaseLookup(state, queue) {
  const members = queueMembers(queue);
  const membersById = new Map(members.map(member => [String(member.id), member]));
  const leases = new Map();
  const ambiguous = new Set();
  const seen = new Set();
  for (const record of Array.isArray(state?.queueSlots) ? state.queueSlots : []) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const memberId = toId(record.memberId);
    if (memberId == null || !isFinitePoint(record) || !safeSlot(record)) continue;
    const member = membersById.get(memberId);
    if (!member) continue;
    if (toId(record.partyId) !== toId(member.partyId ?? member.id)) continue;
    if (seen.has(memberId)) {
      leases.delete(memberId);
      ambiguous.add(memberId);
      continue;
    }
    seen.add(memberId);
    leases.set(memberId, record);
  }
  return { leases, ambiguous };
}

// Structural acceptance shared by the import/seed boundary (`normaliseQueueSlots`)
// and the trusted runtime path (`reconcileQueueSlots`): owner/party matching,
// finite exact x/y, safe optional slot. No actor-proximity or lease-pair
// rejection happens here; those differ between the two paths.
function structuralSlotRecords(value, state) {
  if (!Array.isArray(value)) return [];
  const queue = normaliseCustomerQueue(state?.queue || []);
  const memberById = new Map(queue.flatMap(party => party.members)
    .map(member => [String(member.id), member]));
  const leavingById = new Map((state?.customers || [])
    .filter(customer => customer && customer.state === 'leaving')
    .map(customer => [String(customer.id), customer]));
  const records = [];
  for (const record of value) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const memberId = toId(record.memberId);
    const partyId = toId(record.partyId);
    if (memberId == null || partyId == null || !isFinitePoint(record) || !safeSlot(record)) {
      continue;
    }
    const standing = memberById.get(memberId);
    const leaving = leavingById.get(memberId);
    const owner = standing || leaving;
    if (!owner || partyId !== ownerPartyId(owner)) continue;
    records.push({
      memberId,
      partyId,
      x: record.x,
      y: record.y,
      ...(record.slot !== undefined ? { slot: record.slot } : {}),
      standing: Boolean(standing),
    });
  }
  return records;
}

function slotRecordOutput(record) {
  return {
    memberId: record.memberId,
    partyId: record.partyId,
    x: record.x,
    y: record.y,
    ...(record.slot !== undefined ? { slot: record.slot } : {}),
  };
}

// Runtime already-unsafe detector over retained exact origins. Two retained
// origins closer than 16 px, or a retained standing lease origin within 16 px
// of an unrelated finite staff/customer actor, mean the physical state is
// already unsafe. In that state the reconciler must preserve every trusted
// origin exactly and block all compensating grants/materialisations.
export function hasRuntimeLeaseConflict(state, queueSlots) {
  const origins = (queueSlots || []).filter(isFinitePoint);
  for (let left = 0; left < origins.length; left += 1) {
    for (let right = left + 1; right < origins.length; right += 1) {
      if (Math.hypot(origins[left].x - origins[right].x, origins[left].y - origins[right].y)
        < QUEUE_LEASE_SPACING) return true;
    }
  }
  const queue = normaliseCustomerQueue(state?.queue || []);
  const memberIds = new Set(queue.flatMap(party => party.members)
    .map(member => String(member.id)));
  for (const record of origins) {
    if (!memberIds.has(String(record.memberId))) continue;
    if (recordIsWithinUnrelatedActor(state.staff, state.customers, record, String(record.memberId))) {
      return true;
    }
  }
  return false;
}

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

// Logical-order member copies. A member with a valid queueSlots lease copies
// that lease's exact granted x/y (the durable physical authority). An unplaced
// member shares the display overflow point and is never physical: overflow
// copies must not be used for movement, occupancy, admission, staging or
// exit-clearance decisions.
export function getQueueProjectedMembers(state, queue) {
  const geometry = getQueueGeometry(state);
  const { leases, ambiguous } = queueLeaseLookup(state, queue);
  const overflowPoint = {
    x: geometry.x,
    y: geometry.world.queueY + geometry.world.queueH - 22,
  };
  return queueMembers(queue).map(member => {
    const id = String(member.id);
    const lease = leases.has(id) && !ambiguous.has(id) ? leases.get(id) : null;
    return lease
      ? { ...member, x: lease.x, y: lease.y }
      : { ...member, x: overflowPoint.x, y: overflowPoint.y };
  });
}

// The physically present queue members: only queue members that own a valid
// queueSlots lease, in logical queue order, at each lease's exact stored
// position. This is the canonical physical projection used by the renderer,
// movement blockers, conversion, admission occupancy and exit clearance.
// It never slices by the current capacity B and never consults `slot` for
// coordinates. Hidden logical members, duplicated/ambiguous claims and foreign
// party records are not returned here.
export function getQueueVisibleMembers(state, queue) {
  const { leases, ambiguous } = queueLeaseLookup(state, queue);
  return queueMembers(queue)
    .filter(member => {
      const id = String(member.id);
      return leases.has(id) && !ambiguous.has(id);
    })
    .map(member => {
      const lease = leases.get(String(member.id));
      return { ...member, x: lease.x, y: lease.y };
    });
}

// The current candidate queue-band slot points in ascending current index
// order, used only for new grants and staged materialisation. The index is
// allocation metadata only and is never a coordinate source for an existing
// lease.
export function getQueueBandSlots(state) {
  const geometry = getQueueGeometry(state);
  return Array.from({ length: geometry.visibleCapacity }, (_, index) => ({
    slot: index,
    x: geometry.x,
    y: geometry.firstY + index * MEMBER_STEP,
  }));
}

// Candidates from the current band that are at least 16 px from every exact
// lease origin (standing or retained departure), finite staff actor, finite
// customer actor, and earlier grant already present in `queueSlots`. The
// `queueSlots` argument is the authority; when absent the state field is used.
export function getQueueFreeBandSlots(state, queueSlots) {
  const origins = Array.isArray(queueSlots) ? queueSlots : state?.queueSlots || [];
  const occupied = [
    ...(origins || []).filter(isFinitePoint),
    ...(state?.staff || []),
    ...(state?.customers || []),
  ].filter(isFinitePoint);
  return getQueueBandSlots(state).filter(slot =>
    occupied.every(actor => Math.hypot(slot.x - actor.x, slot.y - actor.y) >= QUEUE_LEASE_SPACING));
}

// Durable validation for the ordered pending-departure backlog. Records keep
// their full queue-member identity and data plus a departure reason; only
// clearly malformed records (no identity) are dropped, never silently losing
// people. Order is preserved.
export function normaliseQueueDepartures(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || record.id == null || record.partyId == null
      || !['abandoned', 'closed'].includes(record.departureReason)) return [];
    const id = String(record.id);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ ...record, id, partyId: String(record.partyId) }];
  });
}

export function getQueueDisplayLayout(state, queue) {
  const geometry = getQueueGeometry(state);
  const visibleMembers = getQueueVisibleMembers(state, queue);
  return {
    visibleMembers,
    hiddenCount: Math.max(0, queueMembers(queue).length - visibleMembers.length),
    overflowLabelPosition: {
      x: geometry.x,
      y: geometry.world.queueY + geometry.world.queueH - BOTTOM_LABEL_OFFSET,
    },
  };
}

// Import/seed boundary validation of saved queueSlots records. This never
// invents coordinates and never repairs a malformed claim by moving an actor.
// Every structurally valid claim is classified into conflict components
// (duplicate memberId or records within 16 px) BEFORE the unrelated-actor
// filter runs, so a record whose sibling was rejected can never survive as an
// input-order winner, and neighbours of a discarded overlapping record are
// rejected too. Records that duplicate a memberId, stand within 16 px of
// another accepted record, or place a standing lease within 16 px of an
// unrelated finite staff/customer actor are rejected fail-closed. A duplicate
// optional slot with safe exact coordinates is allowed because slot is not
// authority. This seed normaliser is NOT the runtime reconcile path: re-running
// its actor filter on a trusted runtime projection would hide or relocate an
// existing physical member.
export function normaliseQueueSlots(value, state) {
  const records = structuralSlotRecords(value, state);
  const rejected = new Set();
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const sameMember = records[left].memberId === records[right].memberId;
      const tooClose = Math.hypot(
        records[left].x - records[right].x,
        records[left].y - records[right].y,
      ) < QUEUE_LEASE_SPACING;
      if (sameMember || tooClose) {
        rejected.add(left);
        rejected.add(right);
      }
    }
  }
  return records
    .filter((record, index) => !rejected.has(index)
      && !(record.standing
        && recordIsWithinUnrelatedActor(state.staff, state.customers, record, record.memberId)))
    .map(slotRecordOutput);
}

// Per-tick ownership reconciliation for TRUSTED runtime state. This is
// deliberately separate from the import/seed normaliser: a standing lease that
// already physically exists is never discarded merely because an unrelated
// actor is close to it, and is never relocated to a "recovered" grant. The
// reconciler retains valid standing leases while the member remains in
// state.queue, retains valid departure leases while the matching leaving actor
// is still within 16 px of the exact origin, and releases only cleared or
// orphaned records (dropping malformed duplicate-member claims, which never
// supply a coordinate). If the retained runtime origins are already unsafe
// (two origins within 16 px, or a standing origin within 16 px of an unrelated
// actor), the exact leases are preserved and all new grants are blocked
// fail-closed. Otherwise unleased queue members are granted in logical FIFO
// order at any free current candidate (any-free rule; no geometric FIFO or
// compaction). Existing records keep their exact fields and order; new grants
// are appended in FIFO grant order.
export function reconcileQueueSlots(state, queueSlots) {
  const seed = Array.isArray(queueSlots) ? queueSlots : state?.queueSlots || [];
  const structural = structuralSlotRecords(seed, state);
  const seenMemberIds = new Set();
  const duplicateMemberIds = new Set();
  for (const record of structural) {
    if (seenMemberIds.has(record.memberId)) duplicateMemberIds.add(record.memberId);
    seenMemberIds.add(record.memberId);
  }
  const valid = structural.filter(record => !duplicateMemberIds.has(record.memberId));
  const queue = normaliseCustomerQueue(state?.queue || []);
  const members = queue.flatMap(party => party.members);
  const memberById = new Map(members.map(member => [String(member.id), member]));
  const customers = Array.isArray(state?.customers) ? state.customers : [];

  const retained = [];
  for (const record of valid) {
    if (memberById.has(record.memberId)) {
      retained.push(slotRecordOutput(record));
      continue;
    }
    const leaver = customers.find(customer => customer
      && customer.state === 'leaving'
      && toId(customer.id) === record.memberId
      && isFinitePoint(customer));
    if (leaver && Math.hypot(leaver.x - record.x, leaver.y - record.y) < QUEUE_LEASE_SPACING) {
      retained.push(slotRecordOutput(record));
    }
  }

  if (hasRuntimeLeaseConflict(state, retained)) return retained;

  const leasedIds = new Set(retained.map(record => String(record.memberId)));
  const working = [...retained];
  for (const member of members) {
    if (leasedIds.has(String(member.id))) continue;
    const freeSlots = getQueueFreeBandSlots(state, working);
    if (freeSlots.length === 0) break;
    const slot = freeSlots[0];
    working.push({
      memberId: member.id,
      partyId: ownerPartyId(member),
      x: slot.x,
      y: slot.y,
      slot: slot.slot,
    });
    leasedIds.add(String(member.id));
  }
  return working;
}
