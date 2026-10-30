import { describe, expect, it } from 'vitest';
import { WALK_IN_ARCHETYPES, WALK_IN_ARCHETYPE_MIX } from './customerArchetypes';

const EXPECTED_WALK_IN_ARCHETYPES = [
  'regular', 'regular', 'regular', 'foodie', 'rusher', 'influencer',
];

describe('walk-in archetypes', () => {
  it('preserves the six ordered archetype slots as an immutable source', () => {
    expect(WALK_IN_ARCHETYPES).toEqual(EXPECTED_WALK_IN_ARCHETYPES);
    expect(WALK_IN_ARCHETYPES).toHaveLength(6);
    expect(Object.isFrozen(WALK_IN_ARCHETYPES)).toBe(true);
  });

  it('derives the immutable distribution from archetype counts and array length', () => {
    const counts = WALK_IN_ARCHETYPES.reduce((totals, archetype) => {
      totals.set(archetype, (totals.get(archetype) || 0) + 1);
      return totals;
    }, new Map());
    const expectedMix = Object.fromEntries([...counts]
      .map(([archetype, count]) => [archetype, count / WALK_IN_ARCHETYPES.length]));

    expect(WALK_IN_ARCHETYPE_MIX).toEqual(expectedMix);
    expect(WALK_IN_ARCHETYPE_MIX).toEqual({
      regular: 3 / 6,
      foodie: 1 / 6,
      rusher: 1 / 6,
      influencer: 1 / 6,
    });
    expect(Object.isFrozen(WALK_IN_ARCHETYPE_MIX)).toBe(true);
  });
});
