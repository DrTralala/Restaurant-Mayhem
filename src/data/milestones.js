export const NO_MILESTONE_REWARD = Object.freeze({ type: 'none' });

export function normaliseMilestoneReward(reward) {
  if (reward?.type === 'newStaffSlot') return { ...NO_MILESTONE_REWARD };
  if (typeof reward?.type !== 'string') return { ...NO_MILESTONE_REWARD };
  return { ...reward };
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normaliseMilestones(milestones, fallback = MILESTONES) {
  const source = Array.isArray(milestones)
    ? milestones
    : Array.isArray(fallback) ? fallback : [];
  const output = [];
  const firstBuiltinIndex = new Map();

  for (const milestone of source) {
    if (!isRecord(milestone)) {
      output.push(milestone);
      continue;
    }

    const canonical = BUILT_IN_MILESTONES.get(milestone.id);
    if (!canonical) {
      output.push({
        ...milestone,
        reward: normaliseMilestoneReward(milestone.reward),
      });
      continue;
    }

    const firstIndex = firstBuiltinIndex.get(milestone.id);
    if (firstIndex !== undefined) {
      if (milestone.achieved === true) output[firstIndex].achieved = true;
      continue;
    }

    firstBuiltinIndex.set(milestone.id, output.length);
    output.push({
      ...milestone,
      description: canonical.description,
      condition: { ...canonical.condition },
      reward: { ...canonical.reward },
      achieved: milestone.achieved === true,
    });
  }

  return output;
}

export const MILESTONES = [
  { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: false },
  { id: 'm2', description: 'Serve 50 customers', condition: { type: 'servedTotal', threshold: 50 }, reward: { type: 'cashBonus', amount: 100 }, achieved: false },
  { id: 'm3', description: 'Hold $1,000 cash reserve', condition: { type: 'cashReserve', threshold: 1000 }, reward: { type: 'cashBonus', amount: 100 }, achieved: false },
  { id: 'm4', description: 'Hold $5,000 cash reserve', condition: { type: 'cashReserve', threshold: 5000 }, reward: { type: 'cashBonus', amount: 250 }, achieved: false },
  { id: 'm5', description: 'Reach 3.0 reputation', condition: { type: 'reputation', threshold: 3.0 }, reward: { type: 'cashBonus', amount: 100 }, achieved: false },
  { id: 'm6', description: 'Reach 4.0 reputation', condition: { type: 'reputation', threshold: 4.0 }, reward: { type: 'cashBonus', amount: 150 }, achieved: false },
  { id: 'm7', description: 'Reach Day 10', condition: { type: 'day', threshold: 10 }, reward: { type: 'cashBonus', amount: 150 }, achieved: false },
  { id: 'm8', description: 'Reach Day 30', condition: { type: 'day', threshold: 30 }, reward: { type: 'cashBonus', amount: 300 }, achieved: false },
  { id: 'm9', description: 'Upgrade any owned equipment to Level 5', condition: { type: 'equipmentLevel', threshold: 5 }, reward: { type: 'cashBonus', amount: 200 }, achieved: false },
  { id: 'm10', description: 'Upgrade any owned equipment to Level 10', condition: { type: 'equipmentLevel', threshold: 10 }, reward: { type: 'cashBonus', amount: 500 }, achieved: false },
  { id: 'm11', description: 'Serve 100 customers', condition: { type: 'servedTotal', threshold: 100 }, reward: { type: 'cashBonus', amount: 200 }, achieved: false },
  { id: 'm12', description: 'Hold $10,000 cash reserve', condition: { type: 'cashReserve', threshold: 10000 }, reward: { type: 'cashBonus', amount: 500 }, achieved: false },
];

const BUILT_IN_MILESTONES = new Map(MILESTONES.map(milestone => [milestone.id, milestone]));
