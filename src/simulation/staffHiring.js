import { allocateStaffPositions } from './navigation/staffAllocation';
import { withCarriedServiceItemIds } from './staffInventory';
import { STAFF_SALARIES } from './staffProgression';
import { createStaffDutyDefaults } from './staffSchedules';

function canAfford(state, cost) {
  const funds = state?.restaurant?.funds;
  return Number.isFinite(cost) && cost >= 0
    && Number.isFinite(funds) && funds >= cost;
}

export function prepareStaffHire(state, candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || !Object.prototype.hasOwnProperty.call(STAFF_SALARIES, candidate.role)) {
    return { ok: false, reason: 'invalid-candidate' };
  }

  const cost = STAFF_SALARIES[candidate.role];
  if (!canAfford(state, cost)) return { ok: false, reason: 'unavailable-funds' };

  const staff = {
    ...candidate,
    ...createStaffDutyDefaults(),
    task: null,
    activityPhase: null,
    idleUntil: null,
  };
  if (staff.id == null) return { ok: false, reason: 'invalid-candidate' };

  const occupiedIds = [
    ...(state.staff || []),
    ...(state.customers || []),
    ...(state.queue || []).flatMap(party => party.members || [party]),
    ...(state.queueDepartures || []),
  ];
  if (occupiedIds.some(actor => String(actor.id) === String(staff.id))) {
    return { ok: false, reason: 'duplicate-identity' };
  }

  const unplacedHire = { ...staff, x: null, y: null };
  const allocatedStaff = allocateStaffPositions(state, [
    ...(state.staff || []),
    { ...withCarriedServiceItemIds(unplacedHire, []), salary: cost },
  ]);
  if (!allocatedStaff) return { ok: false, reason: 'no-safe-space' };

  return { ok: true, staff: allocatedStaff, cost };
}
