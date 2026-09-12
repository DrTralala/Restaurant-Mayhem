import { getPartyKey } from './partyReviews';
import { isCheckoutState } from './checkout';

// 16 px is the shared character/fixture spacing used across the movement domain.
const CHAIR_SPACING = 16;

const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const chairCentre = chair => finitePoint(chair) ? { x: chair.x + 10, y: chair.y + 10 } : null;

/**
 * Reserve an empty table for one party. Pure: never mutates `table` and returns
 * `null` when the table is not empty or the assignments are not usable.
 */
export function reserveTableForParty(table, partyId, assignments) {
  if (table?.status !== 'empty' || partyId == null || !assignments?.length) return null;
  const customerIds = assignments.map(assignment => assignment.customerId);
  const chairIds = assignments.map(assignment => assignment.chairId);
  if (customerIds.some(id => id == null) || chairIds.some(id => id == null)
    || new Set(customerIds).size !== customerIds.length
    || new Set(chairIds).size !== chairIds.length) return null;
  return {
    ...table,
    status: 'reserved',
    diningPartyId: partyId,
    diningCustomerIds: customerIds,
    seatingAssignments: assignments,
  };
}

/**
 * Turn a reservation owned by `partyId` into an occupied table, dropping
 * approach-only fields and the transitional guide linkage. Wrong owners and
 * non-reservations are returned unchanged (same reference).
 */
export function occupyTableForParty(table, partyId) {
  if (table?.status !== 'reserved' || partyId == null || table.diningPartyId !== partyId) return table;
  const { seatingAssignments: _seatingAssignments,
    reservationOwnerStaffId: _reservationOwnerStaffId, ...rest } = table;
  return { ...rest, status: 'occupied' };
}

/** Remove every dining/ownership trace and set the requested status. Pure. */
export function clearDiningOwnership(table, status) {
  const { diningPartyId: _diningPartyId, diningCustomerIds: _diningCustomerIds,
    seatingAssignments: _seatingAssignments,
    reservationOwnerStaffId: _reservationOwnerStaffId, ...rest } = table;
  return { ...rest, status };
}

function memberHasPhysicallyCleared(member, partyId) {
  if (getPartyKey(member) !== partyId) return false;
  if (!isCheckoutState(member) && member.state !== 'leaving') return false;
  // Revoked or unresolved residency is not proof of clearance.
  return member.seatResidency?.phase === 'clear';
}

function chairCentresBlocked(table, state) {
  const centres = (state.chairs || [])
    .filter(chair => chair?.tableId === table.id)
    .map(chairCentre)
    .filter(centre => centre != null);
  if (centres.length === 0) return false;
  return (state.customers || []).some(customer => finitePoint(customer)
    && centres.some(centre =>
      Math.hypot(customer.x - centre.x, customer.y - centre.y) < CHAIR_SPACING));
}

/**
 * Reconcile occupied, party-owned tables after movement. A table becomes dirty
 * only when every recorded member still present has physically cleared its seat
 * and no actor (of any party) still occupies a chair centre. Pure.
 */
export function releaseVacatedTables(state) {
  const membersById = new Map((state.customers || []).map(customer => [customer.id, customer]));
  const tables = (state.tables || []).map(table => {
    if (table?.status !== 'occupied' || table.diningPartyId == null) return table;
    const memberIds = Array.isArray(table.diningCustomerIds) ? table.diningCustomerIds : [];
    if (memberIds.length === 0) return table;
    const present = memberIds.map(id => membersById.get(id)).filter(Boolean);
    const everyoneClear = present.every(member =>
      memberHasPhysicallyCleared(member, table.diningPartyId));
    if (!everyoneClear) return table;
    if (chairCentresBlocked(table, state)) return table;
    return { ...table, status: 'dirty' };
  });
  return { ...state, tables };
}
