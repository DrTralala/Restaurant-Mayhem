import { getStaffTrainingCost } from '../simulation/staffProgression';
import { getStaffCarryCapacity } from '../simulation/staffInventory';
import { getStaffPerformanceMultiplier, getStaffTaskRate } from '../simulation/staffPerformance';

function getCapacityMilestone(worker) {
  const threshold = worker.skill < 5 ? 5 : 10;
  let skill = worker.skill;
  let purchases = 0;
  let totalCost = 0;
  // Follow real purchases rather than rounding fractional saved skills.
  while (skill < threshold) {
    const cost = getStaffTrainingCost({ ...worker, skill });
    if (!Number.isFinite(cost) || cost < 0) return null;
    totalCost += cost;
    purchases += 1;
    skill = Math.min(skill + 1, 10);
  }
  return {
    threshold,
    purchases,
    totalCost,
    carryBefore: getStaffCarryCapacity(worker),
    carryAfter: getStaffCarryCapacity({ ...worker, skill }),
  };
}

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
  const unlocks = worker.skill < 10 && next.skill >= 10
    ? worker.role === 'waiter' ? ['Can take orders for an eligible party together at one table.']
      : worker.role === 'janitor' ? ['10% chance to instantly finish a newly started table-cleaning, floor-cleaning or manual-washing action.'] : []
    : [];

  return {
    skill: next.skill,
    morale: next.morale,
    carryBefore: getStaffCarryCapacity(worker),
    carryAfter: getStaffCarryCapacity(next),
    rateLabel,
    rateBefore: rate(worker),
    rateAfter: rate(next),
    unlocks,
    capacityMilestone: getCapacityMilestone(worker),
  };
}
