export const WALK_IN_ARCHETYPES = Object.freeze([
  'regular', 'regular', 'regular', 'foodie', 'rusher', 'influencer',
]);

const archetypeCounts = WALK_IN_ARCHETYPES.reduce((counts, archetype) => {
  counts[archetype] = (counts[archetype] || 0) + 1;
  return counts;
}, {});

export const WALK_IN_ARCHETYPE_MIX = Object.freeze(Object.fromEntries(
  Object.entries(archetypeCounts)
    .map(([archetype, count]) => [archetype, count / WALK_IN_ARCHETYPES.length]),
));
