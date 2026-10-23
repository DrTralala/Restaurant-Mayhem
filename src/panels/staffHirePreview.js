import { getDailyPayroll } from '../simulation/clock';
import { STAFF_SALARIES } from '../simulation/staffProgression';

/**
 * Read-only cash projection for hiring one staff member in a known role.
 * Mirrors the immediate hire charge and the next midnight payroll without
 * mutating state. Returns null for unknown roles; cash fields are null when
 * funds are not finite so the UI can show Unavailable. Negatives are kept.
 */
export function getStaffHirePreview({ funds, staff = [] } = {}, role) {
  if (!Object.prototype.hasOwnProperty.call(STAFF_SALARIES, role)) return null;

  const cost = STAFF_SALARIES[role];
  const payroll = getDailyPayroll(staff);
  const validFunds = Number.isFinite(funds);
  const fundsAfterHire = validFunds ? funds - cost : Number.NaN;
  const dailyPayrollAfterHire = payroll + cost;
  const fundsAfterPayroll = validFunds ? fundsAfterHire - dailyPayrollAfterHire : Number.NaN;
  const cashOrNull = value => (Number.isFinite(value) ? value : null);

  return {
    cost,
    canHire: validFunds && funds >= cost,
    fundsAfterHire: cashOrNull(fundsAfterHire),
    dailyPayrollAfterHire: cashOrNull(dailyPayrollAfterHire),
    fundsAfterPayroll: cashOrNull(fundsAfterPayroll),
  };
}
