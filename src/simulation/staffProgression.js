export const STAFF_SALARIES = Object.freeze({
  cook: 200,
  waiter: 150,
  janitor: 120,
});

export const STAFF_BONUS_COST = 50;
export const STAFF_BONUS_MORALE_GAIN = 20;

export function getStaffBonusPreview(worker) {
  if (!worker || !Number.isFinite(worker.morale) || worker.morale >= 100) return null;
  return {
    cost: STAFF_BONUS_COST,
    morale: Math.min(worker.morale + STAFF_BONUS_MORALE_GAIN, 100),
  };
}

const TRAINING_RULES = Object.freeze({
  cook: Object.freeze({ base: 200, growth: 1.75 }),
  waiter: Object.freeze({ base: 100, growth: 1.5 }),
  janitor: Object.freeze({ base: 100, growth: 1.5 }),
});

export function getStaffTrainingCost(worker) {
  const rule = TRAINING_RULES[worker?.role];
  const skill = worker?.skill;
  if (!rule || !Number.isFinite(skill) || skill < 1) return null;

  return Math.ceil(rule.base * rule.growth ** (skill - 1) / 10) * 10;
}
