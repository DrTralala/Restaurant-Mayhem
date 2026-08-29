import { advanceClock } from './clock';
import { spawnCustomers, updateCustomers } from './customers';
import { updateStaff } from './staff';
import { updateDirt } from './dirt';
import { processKitchen } from './kitchen';
import { updateAutomaticDishwashers } from './dishwashing';
import { calculateRevenue } from './revenue';
import { checkMilestones } from './milestones';

export function runTick(state, timing) {
  if (state.paused) return state;

  const legacyDt = Number.isFinite(timing) ? timing * state.speed * 60 : null;
  const gameDt = Math.max(0, legacyDt ?? (Number(timing?.gameDt) || 0));
  const movementDt = Math.max(0, legacyDt ?? (Number(timing?.movementDt) || 0));

  let s = advanceClock(state, gameDt);
  s = spawnCustomers(s, gameDt);
  s = updateCustomers(s, { gameDt, movementDt });
  s = updateDirt(s, gameDt);
  s = updateStaff(s, { gameDt, movementDt });
  s = processKitchen(s);
  s = updateAutomaticDishwashers(s);
  s = calculateRevenue(s);
  s = checkMilestones(s);

  return s;
}
