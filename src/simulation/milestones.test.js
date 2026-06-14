import { describe, it, expect } from 'vitest';
import { checkMilestones } from './milestones';

describe('checkMilestones', () => {
  it('marks milestone achieved when condition met', () => {
    const state = {
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'newDishSlot' }, achieved: false },
      ],
      restaurant: { totalServed: 12 },
    };
    const result = checkMilestones(state);
    expect(result.milestones[0].achieved).toBe(true);
  });

  it('does not mark already achieved milestones', () => {
    const state = {
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'newDishSlot' }, achieved: true },
      ],
      restaurant: { totalServed: 50 },
      notifications: [],
      recipeSlots: 0,
      staffSlots: 0,
    };
    const result = checkMilestones(state);
    expect(result.notifications.length).toBe(0);
  });

  it('adds notification and applies newDishSlot reward when milestone first achieved', () => {
    const state = {
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'newDishSlot' }, achieved: false },
      ],
      restaurant: { totalServed: 10 },
      recipeSlots: 0,
      staffSlots: 0,
      notifications: [],
    };
    const result = checkMilestones(state);
    expect(result.notifications.length).toBe(1);
    expect(result.recipeSlots).toBe(1);
  });

  it('applies newStaffSlot reward', () => {
    const state = {
      milestones: [
        { id: 'm2', description: 'Hire first staff', condition: { type: 'reputation', threshold: 2 }, reward: { type: 'newStaffSlot' }, achieved: false },
      ],
      restaurant: { reputation: 2.5 },
      recipeSlots: 0,
      staffSlots: 0,
      notifications: [],
    };
    const result = checkMilestones(state);
    expect(result.staffSlots).toBe(1);
  });
});
