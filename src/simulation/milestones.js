import { normaliseMilestones } from '../data/milestones';

export function checkMilestones(state) {
  let milestones = normaliseMilestones(state.milestones, []);
  let notifications = [...(state.notifications || [])];
  let recipeSlots = state.recipeSlots || 0;

  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (m.achieved) continue;

    let met = false;
    switch (m.condition.type) {
      case 'servedTotal':
        met = state.restaurant.totalServed >= m.condition.threshold;
        break;
      case 'revenue':
        met = state.restaurant.funds >= m.condition.threshold;
        break;
      case 'reputation':
        met = state.restaurant.reputation >= m.condition.threshold;
        break;
      case 'day':
        met = (state.restaurant.day || 0) >= m.condition.threshold;
        break;
      case 'equipmentLevel':
        met = (state.equipment || []).some(e => e.level >= m.condition.threshold && e.owned);
        break;
    }

    if (met) {
      milestones[i] = { ...m, achieved: true };
      notifications.push({
        id: `notif-${Date.now()}-${i}`,
        message: `Milestone: ${m.description}!`,
        time: Date.now(),
      });

      switch (m.reward.type) {
        case 'newDishSlot':
          recipeSlots += 1;
          break;
      }
    }
  }

  const { staffSlots: _legacyStaffSlots, ...stateWithoutStaffSlots } = state;
  return { ...stateWithoutStaffSlots, milestones, notifications, recipeSlots };
}
