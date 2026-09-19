import { ACTIVITY_DURATIONS } from './activity';
import { getStaffTrainingCost } from './staffProgression';

export const DISHWASHER_BASE_WASH_WORK = ACTIVITY_DURATIONS.automaticWash;
export const DISHWASHER_MAX_LEVEL = 10;

const DISHWASHER_CAPACITIES = Object.freeze([
  12, 18, 24, 30, 36, 41, 46, 50, 55, 60,
]);
const DISHWASHER_WASH_RATES = Object.freeze([
  1, 1.125, 1.25, 1.375, 1.5, 1.6, 1.7, 1.8, 1.9, 2,
]);

const DISHWASHER_UPGRADE_BASE_COST = getStaffTrainingCost({
  role: 'janitor',
  skill: 1,
});

/**
 * Return the immutable policy values for an automatic dishwasher level.
 * Missing levels are intentionally not handled here: callers that hydrate a
 * runtime station should supply level 1 before asking for its stats.
 */
export function getDishwasherStats(level) {
  if (!Number.isInteger(level) || level < 1 || level > DISHWASHER_MAX_LEVEL) {
    return null;
  }

  const index = level - 1;
  const washRate = DISHWASHER_WASH_RATES[index];
  return {
    capacity: DISHWASHER_CAPACITIES[index],
    washRate,
    secondsPerDish: DISHWASHER_BASE_WASH_WORK / washRate,
    nextUpgradeCost: level === DISHWASHER_MAX_LEVEL
      ? null
      : DISHWASHER_UPGRADE_BASE_COST * 2 ** index,
  };
}

export { DISHWASHER_CAPACITIES, DISHWASHER_WASH_RATES };
