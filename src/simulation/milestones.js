import { MILESTONES, normaliseMilestones } from '../data/milestones';

const BUILT_IN_MILESTONE_IDS = new Set(MILESTONES.map(milestone => milestone.id));

export function getMilestoneProgress(milestone, state) {
  const condition = milestone?.condition;
  const threshold = condition?.threshold;
  if (!Number.isFinite(threshold) || threshold <= 0) return 0;

  const restaurant = state?.restaurant;
  let metric;
  switch (condition.type) {
    case 'servedTotal':
      metric = restaurant?.totalServed;
      break;
    case 'cashReserve':
    case 'revenue':
      metric = restaurant?.funds;
      break;
    case 'reputation':
      metric = restaurant?.reputation;
      break;
    case 'day':
      metric = restaurant?.day;
      break;
    case 'equipmentLevel': {
      let maximumLevel;
      for (const equipment of Array.isArray(state?.equipment) ? state.equipment : []) {
        if (!equipment?.owned || !Number.isFinite(equipment.level) || equipment.level < 0) continue;
        maximumLevel = maximumLevel === undefined
          ? equipment.level
          : Math.max(maximumLevel, equipment.level);
      }
      metric = maximumLevel;
      break;
    }
    default:
      return 0;
  }

  if (!Number.isFinite(metric) || metric < 0) return 0;
  return Math.min(100, Math.max(0, (metric / threshold) * 100));
}

export function checkMilestones(state) {
  const milestones = normaliseMilestones(state?.milestones, []);
  const notifications = [...(state?.notifications || [])];
  let recipeSlots = state.recipeSlots || 0;
  let runningFunds = state.restaurant?.funds;
  let appliedSum = 0;

  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    if (m.achieved) continue;

    if (getMilestoneProgress(m, state) < 100) continue;

    const reward = m.reward;
    const isBuiltInCashReward = reward?.type === 'cashBonus'
      && BUILT_IN_MILESTONE_IDS.has(m.id);
    let paidCashBonus;
    if (isBuiltInCashReward) {
      const amount = reward.amount;
      const nextSum = appliedSum + amount;
      const nextFunds = runningFunds + amount;
      const applicable = Number.isSafeInteger(amount) && amount > 0
        && Number.isFinite(runningFunds) && Number.isSafeInteger(nextSum)
        && Number.isFinite(nextFunds) && nextFunds > runningFunds;
      if (!applicable) continue;

      appliedSum = nextSum;
      runningFunds = nextFunds;
      paidCashBonus = amount;
    }

    milestones[i] = { ...m, achieved: true };
    notifications.push({
      id: `notif-${Date.now()}-${i}`,
      message: `Milestone: ${m.description}!${paidCashBonus ? ` Cash bonus $${paidCashBonus}` : ''}`,
      time: Date.now(),
    });

    if (reward?.type === 'newDishSlot') recipeSlots += 1;
  }

  const { staffSlots: _legacyStaffSlots, ...stateWithoutStaffSlots } = state;
  const result = { ...stateWithoutStaffSlots, milestones, notifications, recipeSlots };
  if (appliedSum > 0) result.restaurant = { ...state.restaurant, funds: runningFunds };
  return result;
}
