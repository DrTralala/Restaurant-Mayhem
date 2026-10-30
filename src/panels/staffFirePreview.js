import { getDailyPayroll } from '../simulation/clock';

/**
 * Read-only payroll projection for removing a worker using FIRE_STAFF's strict
 * id matching. Returns null when that id is absent; non-finite cash is null.
 */
export function getStaffFirePreview({ funds, staff = [] } = {}, workerId) {
  const roster = Array.isArray(staff) ? staff : [];
  if (!roster.some(member => member != null && member.id === workerId)) return null;

  const remainingStaff = roster.filter(member => member == null || member.id !== workerId);
  const dailyPayrollBefore = getDailyPayroll(roster);
  const dailyPayrollAfter = getDailyPayroll(remainingStaff);
  const projectedFunds = Number.isFinite(funds) ? funds - dailyPayrollAfter : Number.NaN;

  return {
    dailyPayrollBefore,
    dailyPayrollAfter,
    dailySavings: dailyPayrollBefore - dailyPayrollAfter,
    fundsAfterPayroll: Number.isFinite(projectedFunds) ? projectedFunds : null,
  };
}
