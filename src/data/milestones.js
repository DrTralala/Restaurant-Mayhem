export const NO_MILESTONE_REWARD = Object.freeze({ type: 'none' });

export function normaliseMilestoneReward(reward) {
  if (reward?.type === 'newStaffSlot') return { ...NO_MILESTONE_REWARD };
  if (typeof reward?.type !== 'string') return { ...NO_MILESTONE_REWARD };
  return { ...reward };
}

export function normaliseMilestones(milestones, fallback = MILESTONES) {
  const source = Array.isArray(milestones)
    ? milestones
    : Array.isArray(fallback) ? fallback : [];
  return source.map(milestone => ({
    ...milestone,
    reward: normaliseMilestoneReward(milestone?.reward),
  }));
}

export const MILESTONES = [
  { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'newDishSlot' }, achieved: false },
  { id: 'm2', description: 'Serve 50 customers', condition: { type: 'servedTotal', threshold: 50 }, reward: { type: 'none' }, achieved: false },
  { id: 'm3', description: 'Earn $1,000', condition: { type: 'revenue', threshold: 1000 }, reward: { type: 'newDishSlot' }, achieved: false },
  { id: 'm4', description: 'Earn $5,000', condition: { type: 'revenue', threshold: 5000 }, reward: { type: 'newCuisine' }, achieved: false },
  { id: 'm5', description: 'Reach 3.0 reputation', condition: { type: 'reputation', threshold: 3.0 }, reward: { type: 'newEquipment' }, achieved: false },
  { id: 'm6', description: 'Reach 4.0 reputation', condition: { type: 'reputation', threshold: 4.0 }, reward: { type: 'none' }, achieved: false },
  { id: 'm7', description: 'Reach Day 10', condition: { type: 'day', threshold: 10 }, reward: { type: 'expandZone' }, achieved: false },
  { id: 'm8', description: 'Reach Day 30', condition: { type: 'day', threshold: 30 }, reward: { type: 'newCuisine' }, achieved: false },
  { id: 'm9', description: 'Upgrade any equipment to Level 5', condition: { type: 'equipmentLevel', threshold: 5 }, reward: { type: 'newDishSlot' }, achieved: false },
  { id: 'm10', description: 'Upgrade any equipment to Level 10', condition: { type: 'equipmentLevel', threshold: 10 }, reward: { type: 'unlockVIP' }, achieved: false },
  { id: 'm11', description: 'Serve 100 customers', condition: { type: 'servedTotal', threshold: 100 }, reward: { type: 'expandZone' }, achieved: false },
  { id: 'm12', description: 'Earn $10,000', condition: { type: 'revenue', threshold: 10000 }, reward: { type: 'none' }, achieved: false },
];
