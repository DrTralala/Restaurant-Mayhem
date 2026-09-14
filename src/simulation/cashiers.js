import { getScheduledDuty, validateStaffSchedule } from './staffSchedules';

export function getAssignedCashierStation(stations, staffId) {
  return (Array.isArray(stations) ? stations : []).find(
    station => station?.assignedStaffId === staffId,
  ) || null;
}

import { getCarriedServiceItemIds } from './staffInventory';

function isServiceEligible(worker, now = 0) {
  if (worker?.role !== 'waiter'
    || worker.task != null
    || getCarriedServiceItemIds(worker).length > 0
    || worker.effectiveDuty === 'rest'
    || worker.effectiveDuty === 'pto'
    || worker.serviceEligible === false
    || worker.movementResidency?.kind === 'staff_amenity') return false;
  const schedule = Array.isArray(worker.schedule)
    ? worker.schedule : worker.schedule?.schedule;
  return !validateStaffSchedule(schedule).valid || getScheduledDuty(schedule, now) === 'work';
}

function isActivePaymentOwnerEligible(worker, now = 0) {
  if (worker?.role !== 'waiter'
    || worker.task?.type !== 'take_payment'
    || worker.effectiveDuty === 'rest'
    || worker.effectiveDuty === 'pto'
    || worker.serviceEligible === false
    || worker.movementResidency?.kind === 'staff_amenity') return false;
  const schedule = Array.isArray(worker.schedule)
    ? worker.schedule : worker.schedule?.schedule;
  return !validateStaffSchedule(schedule).valid || getScheduledDuty(schedule, now) === 'work';
}

export function getAvailableWaiterId(staff, stations, now = 0) {
  const assignedStaffIds = new Set(
    (Array.isArray(stations) ? stations : [])
      .map(station => station?.assignedStaffId)
      .filter(staffId => staffId != null),
  );

  return (Array.isArray(staff) ? staff : []).find(candidate =>
    isServiceEligible(candidate, now)
      && candidate.id != null
      && !assignedStaffIds.has(candidate.id)
  )?.id ?? null;
}

export function assignWaiterToStation(stations, staff, stationId, now = 0) {
  const currentStations = Array.isArray(stations) ? stations : [];
  const target = currentStations.find(station => station?.id === stationId);
  if (!target) return currentStations.slice();

  const waiters = new Set(
    (Array.isArray(staff) ? staff : [])
      .filter(candidate => isServiceEligible(candidate, now) && candidate.id != null)
      .map(candidate => candidate.id),
  );
  const waiterId = waiters.has(target.assignedStaffId)
    ? target.assignedStaffId
    : getAvailableWaiterId(staff, currentStations, now);
  if (waiterId == null) return currentStations.slice();

  return currentStations.map(station => {
    if (station?.id === stationId) return { ...station, assignedStaffId: waiterId };
    if (station?.assignedStaffId !== waiterId) return station;
    const { assignedStaffId, ...unassigned } = station;
    return unassigned;
  });
}

/** Remove cashier advertisements held by waiters who cannot currently work. */
export function clearUnavailableCashierAssignments(stations, staff, now = 0) {
  const eligible = new Set((Array.isArray(staff) ? staff : [])
    .filter(worker => isServiceEligible(worker, now) || isActivePaymentOwnerEligible(worker, now))
    .map(worker => worker.id));
  return (Array.isArray(stations) ? stations : []).map(station => {
    if (station?.assignedStaffId == null || eligible.has(station.assignedStaffId)) return station;
    const { assignedStaffId: _assignedStaffId, ...unassigned } = station;
    return unassigned;
  });
}

export { isServiceEligible };
