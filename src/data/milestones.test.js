import { describe, expect, it } from 'vitest';
import { MILESTONES, normaliseMilestoneReward, normaliseMilestones } from './milestones';

describe('milestone data', () => {
  it('defines the approved current-cash goals and totals $2,600', () => {
    expect(MILESTONES.map(({ id, description, condition, reward }) => ({
      id,
      description,
      condition,
      reward,
    }))).toEqual([
      { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 } },
      { id: 'm2', description: 'Serve 50 customers', condition: { type: 'servedTotal', threshold: 50 }, reward: { type: 'cashBonus', amount: 100 } },
      { id: 'm3', description: 'Hold $1,000 cash reserve', condition: { type: 'cashReserve', threshold: 1000 }, reward: { type: 'cashBonus', amount: 100 } },
      { id: 'm4', description: 'Hold $5,000 cash reserve', condition: { type: 'cashReserve', threshold: 5000 }, reward: { type: 'cashBonus', amount: 250 } },
      { id: 'm5', description: 'Reach 3.0 reputation', condition: { type: 'reputation', threshold: 3 }, reward: { type: 'cashBonus', amount: 100 } },
      { id: 'm6', description: 'Reach 4.0 reputation', condition: { type: 'reputation', threshold: 4 }, reward: { type: 'cashBonus', amount: 150 } },
      { id: 'm7', description: 'Reach Day 10', condition: { type: 'day', threshold: 10 }, reward: { type: 'cashBonus', amount: 150 } },
      { id: 'm8', description: 'Reach Day 30', condition: { type: 'day', threshold: 30 }, reward: { type: 'cashBonus', amount: 300 } },
      { id: 'm9', description: 'Upgrade any owned equipment to Level 5', condition: { type: 'equipmentLevel', threshold: 5 }, reward: { type: 'cashBonus', amount: 200 } },
      { id: 'm10', description: 'Upgrade any owned equipment to Level 10', condition: { type: 'equipmentLevel', threshold: 10 }, reward: { type: 'cashBonus', amount: 500 } },
      { id: 'm11', description: 'Serve 100 customers', condition: { type: 'servedTotal', threshold: 100 }, reward: { type: 'cashBonus', amount: 200 } },
      { id: 'm12', description: 'Hold $10,000 cash reserve', condition: { type: 'cashReserve', threshold: 10000 }, reward: { type: 'cashBonus', amount: 500 } },
    ]);
    expect(MILESTONES.reduce((sum, milestone) => sum + milestone.reward.amount, 0)).toBe(2600);
  });

  it('canonicalises legacy built-in fields while preserving unrelated first-record fields', () => {
    const legacy = {
      id: 'm3',
      description: 'Earn $1,000',
      condition: { type: 'revenue', threshold: 1000 },
      reward: { type: 'newDishSlot' },
      achieved: true,
      note: 'kept',
    };

    expect(normaliseMilestones([legacy])).toEqual([{
      id: 'm3',
      description: 'Hold $1,000 cash reserve',
      condition: { type: 'cashReserve', threshold: 1000 },
      reward: { type: 'cashBonus', amount: 100 },
      achieved: true,
      note: 'kept',
    }]);
    expect(legacy).toMatchObject({ description: 'Earn $1,000', condition: { type: 'revenue' } });
  });

  it('canonicalises only built-in IDs present in the saved array', () => {
    const result = normaliseMilestones([
      { id: 'm2', description: 'old second goal', condition: { type: 'servedTotal', threshold: 50 }, reward: { type: 'none' } },
      { id: 'custom-goal', description: 'A custom goal', condition: { type: 'day', threshold: 2 }, reward: { type: 'none' } },
    ]);

    expect(result.map(milestone => milestone.id)).toEqual(['m2', 'custom-goal']);
    expect(result[0]).toMatchObject({
      description: 'Serve 50 customers',
      reward: { type: 'cashBonus', amount: 100 },
    });
  });

  it('deduplicates built-ins at their first position and merges only the achieved flag', () => {
    const result = normaliseMilestones([
      { id: 'custom-before', description: 'Before', condition: { type: 'day', threshold: 1 }, reward: { type: 'newDishSlot' } },
      { id: 'm1', description: 'Legacy serve goal', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'newDishSlot' }, achieved: false, firstExtra: 'kept' },
      { id: 'custom-after', description: 'After', condition: { type: 'day', threshold: 2 }, reward: { type: 'newDishSlot' } },
      { id: 'm1', description: 'Later copy', condition: { type: 'day', threshold: 100 }, reward: { type: 'newDishSlot' }, achieved: true, laterExtra: 'ignored' },
    ]);

    expect(result.map(milestone => milestone.id)).toEqual(['custom-before', 'm1', 'custom-after']);
    expect(result[1]).toEqual({
      id: 'm1',
      description: 'Serve 10 customers',
      condition: { type: 'servedTotal', threshold: 10 },
      reward: { type: 'cashBonus', amount: 50 },
      achieved: true,
      firstExtra: 'kept',
    });
  });

  it('preserves custom duplicates and their order while retiring only custom staff-slot rewards', () => {
    const custom = { id: 'custom', description: 'Custom', condition: { type: 'day', threshold: 2 }, reward: { type: 'newDishSlot' } };
    const customDuplicate = { ...custom, description: 'Second custom copy' };
    const result = normaliseMilestones([
      custom,
      customDuplicate,
      { id: 'old-staff', description: 'Old staff reward', condition: { type: 'day', threshold: 3 }, reward: { type: 'newStaffSlot' } },
    ]);

    expect(result).toEqual([
      custom,
      customDuplicate,
      { id: 'old-staff', description: 'Old staff reward', condition: { type: 'day', threshold: 3 }, reward: { type: 'none' } },
    ]);
    expect(normaliseMilestoneReward({ type: 'newDishSlot' })).toEqual({ type: 'newDishSlot' });
    expect(normaliseMilestoneReward({ type: 'newStaffSlot' })).toEqual({ type: 'none' });
  });

  it('preserves malformed array entries and is idempotent', () => {
    const source = [
      null,
      undefined,
      'old entry',
      12,
      ['nested'],
      new Date(0),
      { id: 'custom', description: 'Kept', condition: null, reward: { type: 'newDishSlot' } },
      { id: 'm4', achieved: false },
    ];
    const once = normaliseMilestones(source);

    expect(once.slice(0, 6)).toEqual(source.slice(0, 6));
    expect(once[6]).toEqual(source[6]);
    expect(normaliseMilestones(once)).toEqual(once);
  });

  it('uses the fresh fallback for absent or non-array saves without filling array subsets', () => {
    const fallback = [{ id: 'fresh-custom', description: 'Fresh', condition: { type: 'day', threshold: 1 }, reward: { type: 'none' } }];

    expect(normaliseMilestones(undefined, fallback)).toEqual(fallback);
    expect(normaliseMilestones('not-an-array', fallback)).toEqual(fallback);
    expect(normaliseMilestones([], fallback)).toEqual([]);
    expect(normaliseMilestones(undefined)).toHaveLength(12);
  });
});
