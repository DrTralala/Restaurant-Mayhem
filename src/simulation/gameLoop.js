import { advanceClock } from './clock';
import { spawnCustomers, updateCustomers } from './customers';
import { updateStaff } from './staff';
import { processKitchen } from './kitchen';
import { calculateRevenue } from './revenue';
import { checkMilestones } from './milestones';

export function runTick(state, dt) {
  if (state.paused) return state;

  const effectiveDt = dt * state.speed;

  let s = advanceClock(state, effectiveDt);
  s = spawnCustomers(s, effectiveDt);
  s = updateCustomers(s, effectiveDt);
  s = updateStaff(s, effectiveDt);
  s = processKitchen(s);
  s = calculateRevenue(s);
  s = checkMilestones(s);

  return s;
}
