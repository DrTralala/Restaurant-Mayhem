import { getStaffTrainingCost } from '../simulation/staffProgression';
import { getStaffCarryCapacity } from '../simulation/staffInventory';
import { getStaffPerformanceMultiplier, getStaffTaskRate } from '../simulation/staffPerformance';

/**
 * Read-only preview of the next training outcome for a staff card.
 * Mirrors the TRAIN_STAFF reducer: skill min(skill + 1, 10) and morale
 * min(morale + 10, 100). Returns null when the worker cannot be trained.
 */
export function getStaffTrainingPreview(worker) {
  const cost = getStaffTrainingCost(worker);
  if (cost == null || worker.skill >= 10) return null;

  const next = {
    ...worker,
    skill: Math.min(worker.skill + 1, 10),
    morale: Math.min((Number.isFinite(worker.morale) ? worker.morale : 0) + 10, 100),
  };
  const taskType = worker.role === 'waiter' ? 'take_order' : worker.role === 'janitor' ? 'wash_item' : null;
  const rate = person => taskType
    ? getStaffTaskRate({}, person, { type: taskType })
    : getStaffPerformanceMultiplier(person);
  const rateLabel = worker.role === 'waiter'
    ? 'Order-taking rate'
    : worker.role === 'janitor'
      ? 'Cleaning/washing rate'
      : 'Morale work multiplier';

  return {
    skill: next.skill,
    morale: next.morale,
    carryBefore: getStaffCarryCapacity(worker),
    carryAfter: getStaffCarryCapacity(next),
    rateLabel,
    rateBefore: rate(worker),
    rateAfter: rate(next),
  };
}
