import { isServiceEligible } from './cashiers';

const CHECKOUT_BUSY_STATES = new Set([
  'checkout_moving',
  'checkout_processing',
  'paying',
]);

function isValidIdentity(value) {
  return (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value));
}

function hasUniqueStationIdentities(stations) {
  const ids = new Set();
  for (const station of stations) {
    if (!isValidIdentity(station?.id) || ids.has(station.id)) return false;
    ids.add(station.id);
  }
  return true;
}

function isStationBusy(state, station) {
  const customers = Array.isArray(state.customers) ? state.customers : [];
  const staff = Array.isArray(state.staff) ? state.staff : [];
  return customers.some(customer =>
    customer?.cashierStationId === station.id
      && CHECKOUT_BUSY_STATES.has(customer.state))
    || staff.some(worker =>
      worker?.task?.type === 'take_payment'
        && worker.task.stationId === station.id);
}

function failure(reason) {
  return { ok: false, reason };
}

export function prepareCashierAssignment(state, stationId, staffId) {
  const cashierStations = state?.cashierStations;
  if (!Array.isArray(cashierStations)) return failure('invalid-state');
  if (!hasUniqueStationIdentities(cashierStations)) {
    return failure('invalid-station-identities');
  }
  if (!isValidIdentity(stationId)) return failure('invalid-station-id');

  const target = cashierStations.find(station => station.id === stationId);
  if (!target) return failure('station-not-found');
  if (staffId !== null && !isValidIdentity(staffId)) return failure('invalid-staff-id');

  if (isStationBusy(state, target)) return failure('station-busy');

  if (staffId === null) {
    if (target.assignedStaffId == null) return { ok: true, cashierStations };
    return {
      ok: true,
      cashierStations: cashierStations.map(station => {
        if (station !== target) return station;
        const { assignedStaffId: _assignedStaffId, ...unassigned } = station;
        return unassigned;
      }),
    };
  }

  const staff = Array.isArray(state.staff) ? state.staff : [];
  const matches = staff.filter(worker => worker?.id === staffId);
  if (matches.length === 0) return failure('staff-not-found');
  if (matches.length > 1) return failure('duplicate-staff-id');

  const sourceStations = cashierStations.filter(station => station.assignedStaffId === staffId);
  if (sourceStations.some(station => isStationBusy(state, station))) {
    return failure('station-busy');
  }

  const now = Number.isFinite(state.restaurant?.gameTime) ? state.restaurant.gameTime : 0;
  if (!isServiceEligible(matches[0], now)) return failure('waiter-unavailable');
  if (sourceStations.length === 1 && sourceStations[0] === target) {
    return { ok: true, cashierStations };
  }

  return {
    ok: true,
    cashierStations: cashierStations.map(station => {
      if (station === target) return { ...station, assignedStaffId: staffId };
      if (station.assignedStaffId !== staffId) return station;
      const { assignedStaffId: _assignedStaffId, ...unassigned } = station;
      return unassigned;
    }),
  };
}
