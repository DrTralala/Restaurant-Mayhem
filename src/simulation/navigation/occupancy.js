import { createGrid } from './grid';
import { createActorGrid } from './domainGrid';
import { getQueueVisibleMembers } from '../customerQueue';
import { getAmenityGeometry } from '../../data/staffAmenities';
import { CHARACTER_CLEARANCE } from './destinations';
import { createNavigationWorkspace, worldToCell } from '../movement/navigationWorkspace';
import { hydrateSeatResidency } from '../movement/seatedDeparture';

export const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
export const samePoint = (a, b) => finitePoint(a) && finitePoint(b) && a.x === b.x && a.y === b.y;
export const seatedStates = new Set(['seated', 'ordering', 'waiting_for_items', 'waiting_for_party', 'eating']);
const seatResidentStates = new Set([...seatedStates, 'checkout_queued', 'checkout_moving', 'leaving']);
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

function isRevokedCheckoutDeparture(actor) {
  return actor?.state === 'checkout_moving' && actor?.seatResidency?.phase === 'revoked';
}

function verifiedSeatOrigin(state, actor) {
  const residency = actor?.seatResidency;
  if (!finitePoint(actor) || !residency || !seatResidentStates.has(actor?.state)
    || !['seated', 'departing'].includes(residency.phase)) return null;
  const canonical = hydrateSeatResidency(state, actor, createNavigationWorkspace(state));
  if (!canonical.seatResidency || canonical.seatResidency.phase === 'revoked'
    || canonical.seatResidency.phase !== residency.phase
    || !samePoint(canonical.seatResidency.position, actor)) return null;
  const chair = (state.chairs || []).find(candidate => sameId(candidate?.id, actor.chairId));
  const table = (state.tables || []).find(candidate => sameId(candidate?.id, actor.tableId));
  if (!chair || !table || !sameId(chair.tableId, table.id) || table.status === 'empty') return null;
  const origin = { x: chair.x + 10, y: chair.y + 10 };
  const recordChair = residency.chair;
  const recordTable = residency.table;
  if (residency.schema !== 1
    || residency.actorId !== String(actor.id)
    || residency.partyId !== (actor.partyId == null ? null : String(actor.partyId))
    || !Number.isSafeInteger(residency.generation)
    || residency.generation !== actor.seatingGeneration
    || !samePoint(residency.origin, origin)
    || !samePoint(residency.position, origin)
    || recordChair?.id !== chair.id
    || recordChair?.tableId !== chair.tableId
    || recordChair?.x !== chair.x
    || recordChair?.y !== chair.y
    || (recordChair?.rotation ?? 0) !== (chair.rotation ?? 0)
    || recordTable?.id !== table.id
    || recordTable?.x !== table.x
    || recordTable?.y !== table.y) return null;
  return { origin, chair };
}

// Unit-level and pre-versioned domain fixtures can represent a seated diner at
// the chair origin without the durable residency record introduced later. Keep
// that compatible representation spatially legal while versioned hydrated
// state remains strict about explicit authority (including revoked records).
function legacySeatOrigin(state, actor) {
  if (state?.version != null || actor?.seatResidency != null
    || !finitePoint(actor) || !seatedStates.has(actor?.state)) return null;
  const chair = (state.chairs || []).find(candidate => sameId(candidate?.id, actor.chairId));
  const table = (state.tables || []).find(candidate => sameId(candidate?.id, actor.tableId));
  if (!chair || !table || !sameId(chair.tableId, table.id)) return null;
  const origin = { x: chair.x + 10, y: chair.y + 10 };
  return samePoint(actor, origin) ? { origin, chair } : null;
}

export function physicalActors(state) {
  const actors = [...(state.staff || []), ...(state.customers || [])].filter(finitePoint);
  const live = new Set(actors.map(actor => String(actor.id)));
  // This is the sole queue actor projection. Raw queueSlots records are
  // durable claims, not independently trusted physical actors; retained
  // departure leases are represented by their finite customer actor.
  for (const member of getQueueVisibleMembers(state, state.queue || [])) {
    if (finitePoint(member) && !live.has(String(member.id))) {
      actors.push(member);
      live.add(String(member.id));
    }
  }
  return actors;
}

export function positionAvailable(state, point, actorId, { goals = false, actor = null } = {}) {
  if (!finitePoint(point)) return false;
  const peers = physicalActors(state).filter(candidate => actor
    ? candidate !== actor : !sameId(candidate.id, actorId));
  const points = goals ? peers.flatMap(actor => [actor, actor.navigationGoal].filter(finitePoint)) : peers;
  return points.every(peer => Math.hypot(point.x - peer.x, point.y - peer.y) >= CHARACTER_CLEARANCE);
}

function authorisedOrigin(state, actor) {
  const seat = verifiedSeatOrigin(state, actor);
  if (seat && samePoint(actor, seat.origin)) {
    return createGrid({ ...state,
      chairs: (state.chairs || []).filter(chair => chair !== seat.chair) }).isOpen(actor);
  }
  const legacySeat = legacySeatOrigin(state, actor);
  if (legacySeat) {
    return createGrid({ ...state,
      chairs: (state.chairs || []).filter(chair => chair !== legacySeat.chair) }).isOpen(actor);
  }
  const use = actor.amenityUse;
  if (actor.movementResidency?.kind !== 'staff_amenity' || use?.phase !== 'occupied') return false;
  const amenity = (state.staffAmenities || []).find(item => sameId(item.id, use.amenityId));
  const slot = amenity?.slots?.find(item => item.index === use.slotIndex);
  const anchor = getAmenityGeometry(amenity)?.slotAnchors?.[use.slotIndex];
  return Boolean(amenity && sameId(slot?.occupiedBy, actor.id) && samePoint(actor, anchor)
    && sameId(actor.movementResidency.amenityId, amenity.id)
    && actor.movementResidency.slotIndex === use.slotIndex
    && createGrid({ ...state,
      staffAmenities: (state.staffAmenities || []).filter(item => item !== amenity) }).isOpen(actor));
}

export function spatialIssues(state) {
  const actors = physicalActors(state);
  const grid = createGrid(state);
  const issues = [];
  for (const worker of state.staff || []) if (!finitePoint(worker)) {
    issues.push({ kind: 'unplaced-staff', ids: [String(worker.id)] });
  }
  for (const customer of state.customers || []) if (seatResidentStates.has(customer?.state)
    && !finitePoint(customer)) {
    issues.push({ kind: 'unplaced-customer', ids: [String(customer.id)] });
  }
  for (const actor of actors) {
    if (!grid.isOpen(actor) && !authorisedOrigin(state, actor)
      && !createActorGrid(state, actor, grid).isOpen(actor)
      && !isRevokedCheckoutDeparture(actor)) {
      issues.push({ kind: 'blocked-start', ids: [String(actor.id)], x: actor.x, y: actor.y });
    }
  }
  for (let i = 0; i < actors.length; i += 1) for (let j = i + 1; j < actors.length; j += 1) {
    const ids = [String(actors[i].id), String(actors[j].id)].sort();
    if (ids[0] === ids[1]) {
      issues.push({ kind: 'duplicate-actor', ids });
      continue;
    }
    const distance = Math.hypot(actors[i].x - actors[j].x, actors[i].y - actors[j].y);
    if (distance < CHARACTER_CLEARANCE) issues.push({ kind: 'actor-overlap', ids, distance });
  }
  return issues;
}

export function newSpatialIssues(before, after) {
  const prior = spatialIssues(before);
  return spatialIssues(after).filter(issue => !prior.some(old => {
    if (old.kind !== issue.kind || JSON.stringify(old.ids) !== JSON.stringify(issue.ids)) return false;
    if (issue.kind === 'actor-overlap') return issue.distance >= old.distance;
    if (issue.kind === 'blocked-start') return old.x === issue.x && old.y === issue.y;
    if (issue.kind === 'unplaced-staff' || issue.kind === 'unplaced-customer') return true;
    return false; // Never approve duplicate physical identities.
  }));
}

export function footprintHasActor(state, rect) {
  const first = worldToCell(rect);
  const last = worldToCell({ x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 });
  return physicalActors(state).some(actor => {
    const cell = worldToCell(actor);
    return cell.x >= first.x && cell.x <= last.x && cell.y >= first.y && cell.y <= last.y;
  });
}

export function projectFixtureActors(before, after, moves) {
  const byChair = new Map(moves.filter(move => move.type === 'chair').map(move => [String(move.id), move]));
  return { ...after, customers: (after.customers || []).map(actor => {
    const move = byChair.get(String(actor.chairId));
    const old = (before.chairs || []).find(chair => sameId(chair.id, actor.chairId));
    if (!move || !old || !seatedStates.has(actor.state) || !sameId(old.tableId, actor.tableId)) return actor;
    return { ...actor, x: actor.x + move.x - old.x, y: actor.y + move.y - old.y,
      tableId: move.tableId ?? actor.tableId };
  }) };
}

export function quarantineNavigation(state) {
  const issues = spatialIssues(state);
  if (!issues.length) {
    if (!state.navigationFault) return state;
    const { navigationFault: _fault, ...clean } = state;
    return { ...clean, paused: true };
  }
  return { ...state, paused: true, navigationFault: { kind: 'unsafe-navigation-state', issues } };
}
