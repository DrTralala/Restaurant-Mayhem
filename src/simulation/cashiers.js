export function getAssignedCashierStation(stations, staffId) {
  return (Array.isArray(stations) ? stations : []).find(
    station => station?.assignedStaffId === staffId,
  ) || null;
}

export function getAvailableWaiterId(staff, stations) {
  const assignedStaffIds = new Set(
    (Array.isArray(stations) ? stations : [])
      .map(station => station?.assignedStaffId)
      .filter(staffId => staffId != null),
  );

  return (Array.isArray(staff) ? staff : []).find(candidate =>
    candidate?.role === 'waiter'
      && candidate.id != null
      && !assignedStaffIds.has(candidate.id)
      && candidate.task == null
      && candidate.carryingFoodId == null
  )?.id ?? null;
}

export function assignWaiterToStation(stations, staff, stationId) {
  const currentStations = Array.isArray(stations) ? stations : [];
  const target = currentStations.find(station => station?.id === stationId);
  if (!target) return currentStations.slice();

  const waiters = new Set(
    (Array.isArray(staff) ? staff : [])
      .filter(candidate => candidate?.role === 'waiter' && candidate.id != null)
      .map(candidate => candidate.id),
  );
  const waiterId = waiters.has(target.assignedStaffId)
    ? target.assignedStaffId
    : getAvailableWaiterId(staff, currentStations);
  if (waiterId == null) return currentStations.slice();

  return currentStations.map(station => {
    if (station?.id === stationId) return { ...station, assignedStaffId: waiterId };
    if (station?.assignedStaffId !== waiterId) return station;
    const { assignedStaffId, ...unassigned } = station;
    return unassigned;
  });
}
