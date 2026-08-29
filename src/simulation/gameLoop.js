import { advanceClock } from './clock';
import { spawnCustomers, updateCustomers } from './customers';
import { updateStaff } from './staff';
import { updateDirt } from './dirt';
import { processKitchen } from './kitchen';
import { updateAutomaticDishwashers } from './dishwashing';
import { calculateRevenue } from './revenue';
import { checkMilestones } from './milestones';

export function runTick(state, dt) {
  if (state.paused) return state;

  const effectiveDt = dt * state.speed * 60;

  let s = advanceClock(state, effectiveDt);
  s = spawnCustomers(s, effectiveDt);
  s = updateCustomers(s, effectiveDt);
  s = updateDirt(s, effectiveDt);
  s = updateStaff(s, effectiveDt);
  s = processKitchen(s);
  s = updateAutomaticDishwashers(s);
  s = calculateRevenue(s);
  s = checkMilestones(s);

  return s;
}
