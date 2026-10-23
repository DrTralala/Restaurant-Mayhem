import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkMilestones, getMilestoneMetric, getMilestoneProgress } from './milestones';

function buildState(overrides = {}) {
  return {
    milestones: [],
    restaurant: { totalServed: 0, funds: 0, reputation: 0, day: 1 },
    equipment: [],
    recipeSlots: 0,
    notifications: [],
    ...overrides,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function legacyGetMilestoneProgress(milestone, state) {
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

afterEach(() => vi.restoreAllMocks());

describe('getMilestoneMetric', () => {
  it('extracts the raw metric for every supported condition type', () => {
    const state = buildState({
      restaurant: { totalServed: 7, funds: 500, reputation: 2.5, day: 4 },
      equipment: [{ owned: true, level: 4 }, { owned: true, level: 9 }],
    });
    const cases = [
      ['servedTotal', 7],
      ['cashReserve', 500],
      ['revenue', 500],
      ['reputation', 2.5],
      ['day', 4],
      ['equipmentLevel', 9],
    ];

    for (const [type, expected] of cases) {
      expect(getMilestoneMetric({ condition: { type, threshold: 10 } }, state)).toBe(expected);
    }
  });

  it('uses the maximum valid owned equipment level', () => {
    const state = buildState({
      equipment: [
        { owned: false, level: 99 },
        { owned: true, level: 3 },
        { owned: true, level: 7 },
        { owned: true, level: NaN },
        { owned: true, level: Infinity },
        { owned: true, level: -2 },
        { owned: true, level: 5 },
        null,
      ],
    });

    expect(getMilestoneMetric({ condition: { type: 'equipmentLevel', threshold: 10 } }, state)).toBe(7);
  });

  it('returns undefined for equipment with no owned valid level', () => {
    expect(getMilestoneMetric(
      { condition: { type: 'equipmentLevel', threshold: 10 } },
      buildState({ equipment: [{ owned: false, level: 5 }, { owned: true, level: -1 }] }),
    )).toBeUndefined();
    expect(getMilestoneMetric(
      { condition: { type: 'equipmentLevel', threshold: 10 } },
      buildState({ equipment: null }),
    )).toBeUndefined();
  });

  it.each([
    ['zero served total', 'servedTotal', { totalServed: 0 }, 0],
    ['negative served total', 'servedTotal', { totalServed: -5 }, -5],
    ['negative cash reserve', 'cashReserve', { funds: -500 }, -500],
    ['zero funds', 'cashReserve', { funds: 0 }, 0],
    ['NaN reputation', 'reputation', { reputation: NaN }, NaN],
    ['infinite day', 'day', { day: Infinity }, Infinity],
  ])('returns the raw %s measurement', (_name, type, restaurant, expected) => {
    const state = buildState({ restaurant: { totalServed: 0, funds: 0, reputation: 0, day: 1, ...restaurant } });
    const metric = getMilestoneMetric({ condition: { type, threshold: 10 } }, state);

    if (Number.isNaN(expected)) expect(metric).toBeNaN();
    else expect(metric).toBe(expected);
  });

  it('returns undefined for unsupported, missing, or absent measurements', () => {
    const state = buildState();
    const missingMeasurement = buildState();
    delete missingMeasurement.restaurant.totalServed;
    expect(getMilestoneMetric(undefined, state)).toBeUndefined();
    expect(getMilestoneMetric({}, state)).toBeUndefined();
    expect(getMilestoneMetric({ condition: null }, state)).toBeUndefined();
    expect(getMilestoneMetric({ condition: { type: 'unknown', threshold: 1 } }, state)).toBeUndefined();
    expect(getMilestoneMetric({ condition: { type: 'servedTotal', threshold: 1 } }, undefined)).toBeUndefined();
    expect(getMilestoneMetric({ condition: { type: 'servedTotal', threshold: 1 } }, missingMeasurement))
      .toBeUndefined();
  });

  it('does not mutate frozen input or use randomness', () => {
    const state = deepFreeze(buildState({
      restaurant: { totalServed: 5, funds: 500, reputation: 2.5, day: 4 },
      equipment: [{ owned: true, level: 4 }],
    }));
    const milestone = deepFreeze({ condition: { type: 'servedTotal', threshold: 10 } });
    const before = JSON.stringify(state);
    const random = vi.spyOn(Math, 'random');

    expect(getMilestoneMetric(milestone, state)).toBe(5);
    expect(getMilestoneProgress(milestone, state)).toBe(50);
    expect(JSON.stringify(state)).toBe(before);
    expect(random).not.toHaveBeenCalled();
  });
});

describe('getMilestoneProgress differential parity', () => {
  it('matches the pre-extraction arithmetic across metric and threshold states', () => {
    const factories = {
      servedTotal: value => buildState({ restaurant: { totalServed: value, funds: 0, reputation: 0, day: 1 } }),
      cashReserve: value => buildState({ restaurant: { totalServed: 0, funds: value, reputation: 0, day: 1 } }),
      revenue: value => buildState({ restaurant: { totalServed: 0, funds: value, reputation: 0, day: 1 } }),
      reputation: value => buildState({ restaurant: { totalServed: 0, funds: 0, reputation: value, day: 1 } }),
      day: value => buildState({ restaurant: { totalServed: 0, funds: 0, reputation: 0, day: value } }),
      equipmentLevel: value => buildState({ equipment: [{ owned: true, level: value }] }),
    };
    const thresholds = [undefined, NaN, Infinity, -1, 0, 1, 3.5, 10, 100];
    const metrics = [undefined, NaN, Infinity, -Infinity, -5, 0, 0.5, 1, 9.9, 10, 11, 1000];

    for (const [type, factory] of Object.entries(factories)) {
      for (const threshold of thresholds) {
        for (const value of metrics) {
          const state = factory(value);
          const milestone = { condition: { type, threshold } };
          expect(getMilestoneProgress(milestone, state)).toBe(legacyGetMilestoneProgress(milestone, state));
        }
      }
    }
  });
});

describe('checkMilestones', () => {
  it('marks milestone achieved when condition met', () => {
    const state = {
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'newDishSlot' }, achieved: false },
      ],
      restaurant: { totalServed: 12, funds: 0 },
    };
    const result = checkMilestones(state);
    expect(result.milestones[0].achieved).toBe(true);
    expect(result.restaurant.funds).toBe(50);
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
        { id: 'custom-dish-slot', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'newDishSlot' }, achieved: false },
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

  it('ignores a retired newStaffSlot reward', () => {
    const state = {
      milestones: [
        { id: 'legacy-staff-slot', description: 'Hire first staff', condition: { type: 'reputation', threshold: 2 }, reward: { type: 'newStaffSlot' }, achieved: false },
      ],
      restaurant: { reputation: 2.5 },
      recipeSlots: 0,
      staffSlots: 0,
      notifications: [],
    };
    const result = checkMilestones(state);
    expect(result.milestones[0]).toMatchObject({ id: 'legacy-staff-slot', achieved: true, reward: { type: 'none' } });
    expect(result).not.toHaveProperty('staffSlots');
  });

  it('pays cash milestones from the original snapshot and can meet the cash goal next tick', () => {
    const state = buildState({
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: false },
        { id: 'm3', description: 'Hold $1,000 cash reserve', condition: { type: 'cashReserve', threshold: 1000 }, reward: { type: 'cashBonus', amount: 100 }, achieved: false },
      ],
      restaurant: { totalServed: 10, funds: 950, reputation: 0, day: 1 },
      recipeSlots: 4,
    });

    const firstTick = checkMilestones(state);
    expect(firstTick.restaurant.funds).toBe(1000);
    expect(firstTick.milestones.map(milestone => milestone.achieved)).toEqual([true, false]);
    expect(firstTick.recipeSlots).toBe(4);
    expect(firstTick.notifications).toHaveLength(1);
    expect(firstTick.notifications[0].message).toContain('Cash bonus $50');

    const secondTick = checkMilestones(firstTick);
    expect(secondTick.restaurant.funds).toBe(1100);
    expect(secondTick.milestones.map(milestone => milestone.achieved)).toEqual([true, true]);
    expect(secondTick.notifications).toHaveLength(2);

    const thirdTick = checkMilestones(secondTick);
    expect(thirdTick.restaurant.funds).toBe(1100);
    expect(thirdTick.notifications).toHaveLength(2);
  });

  it('pays a duplicated built-in cash milestone only once', () => {
    const result = checkMilestones(buildState({
      milestones: [
        { id: 'm1', description: 'first copy', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: false },
        { id: 'm1', description: 'later copy', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: false },
      ],
      restaurant: { totalServed: 10, funds: 0, reputation: 0, day: 1 },
    }));

    expect(result.milestones.filter(milestone => milestone.id === 'm1')).toHaveLength(1);
    expect(result.restaurant.funds).toBe(50);
    expect(result.notifications).toHaveLength(1);
  });

  it('does not pay an already achieved built-in cash milestone retroactively', () => {
    const state = buildState({
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: true },
      ],
      restaurant: { totalServed: 10, funds: 25, reputation: 0, day: 1 },
    });

    const result = checkMilestones(state);
    expect(result.restaurant.funds).toBe(25);
    expect(result.notifications).toHaveLength(0);
  });

  it('adds a cash bonus to negative funds without clearing the debt', () => {
    const result = checkMilestones(buildState({
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: false },
      ],
      restaurant: { totalServed: 10, funds: -200, reputation: 0, day: 1 },
    }));

    expect(result.restaurant.funds).toBe(-150);
    expect(result.milestones[0].achieved).toBe(true);
  });

  it('does not let a failed built-in cash award block an eligible custom no-cash milestone', () => {
    const result = checkMilestones(buildState({
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: false },
        { id: 'custom-dish-slot', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'newDishSlot' }, achieved: false },
      ],
      restaurant: { totalServed: 10, funds: NaN, reputation: 0, day: 1 },
    }));

    expect(result.milestones.map(milestone => milestone.achieved)).toEqual([false, true]);
    expect(result.recipeSlots).toBe(1);
    expect(result.notifications).toHaveLength(1);
    expect(result.restaurant.funds).toBeNaN();
  });

  it('does not execute cash rewards for custom milestone IDs', () => {
    const result = checkMilestones(buildState({
      milestones: [
        { id: 'custom-cash', description: 'Custom goal', condition: { type: 'servedTotal', threshold: 1 }, reward: { type: 'cashBonus', amount: 999 }, achieved: false },
      ],
      restaurant: { totalServed: 1, funds: 10, reputation: 0, day: 1 },
    }));

    expect(result.milestones[0].achieved).toBe(true);
    expect(result.restaurant.funds).toBe(10);
    expect(result.notifications[0].message).not.toContain('Cash bonus');
  });

  it.each([NaN, Infinity])('leaves an unpayable cash milestone eligible to retry when funds are %s', funds => {
    const state = buildState({
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: false },
      ],
      restaurant: { totalServed: 10, funds, reputation: 0, day: 1 },
    });

    const failedAttempt = checkMilestones(state);
    expect(failedAttempt.milestones[0].achieved).toBe(false);
    expect(failedAttempt.notifications).toHaveLength(0);
    expect(failedAttempt.restaurant.funds).toBe(funds);

    const retry = checkMilestones({
      ...failedAttempt,
      restaurant: { ...failedAttempt.restaurant, funds: 0 },
    });
    expect(retry.milestones[0].achieved).toBe(true);
    expect(retry.restaurant.funds).toBe(50);
    expect(retry.notifications).toHaveLength(1);
  });

  it('does not mark a cash milestone achieved when adding the bonus cannot increase huge funds', () => {
    const funds = Number.MAX_VALUE;
    const result = checkMilestones(buildState({
      milestones: [
        { id: 'm1', description: 'Serve 10 customers', condition: { type: 'servedTotal', threshold: 10 }, reward: { type: 'cashBonus', amount: 50 }, achieved: false },
      ],
      restaurant: { totalServed: 10, funds, reputation: 0, day: 1 },
    }));

    expect(result.milestones[0].achieved).toBe(false);
    expect(result.notifications).toHaveLength(0);
    expect(result.restaurant.funds).toBe(funds);
  });

  it('does not complete milestones for unusable thresholds, metrics, or condition types', () => {
    const invalidMilestones = [
      { id: 'zero-threshold', description: 'Zero', condition: { type: 'servedTotal', threshold: 0 } },
      { id: 'negative-threshold', description: 'Negative', condition: { type: 'servedTotal', threshold: -1 } },
      { id: 'infinite-threshold', description: 'Infinite', condition: { type: 'servedTotal', threshold: Infinity } },
      { id: 'negative-metric', description: 'Negative', condition: { type: 'servedTotal', threshold: 1 } },
      { id: 'unknown-condition', description: 'Unknown', condition: { type: 'unknown', threshold: 1 } },
    ].map(milestone => ({ ...milestone, reward: { type: 'newDishSlot' }, achieved: false }));

    const result = checkMilestones(buildState({
      milestones: invalidMilestones,
      restaurant: { totalServed: -1, funds: 0, reputation: 0, day: 1 },
    }));
    expect(result.milestones.every(milestone => !milestone.achieved)).toBe(true);
    expect(result.notifications).toHaveLength(0);
    expect(result.recipeSlots).toBe(0);
  });

  it('reports finite clamped progress for supported conditions and maximum owned equipment level', () => {
    expect(getMilestoneProgress(
      { condition: { type: 'servedTotal', threshold: 10 } },
      buildState({ restaurant: { totalServed: 5, funds: 0, reputation: 0, day: 1 } }),
    )).toBe(50);
    expect(getMilestoneProgress(
      { condition: { type: 'cashReserve', threshold: 1000 } },
      buildState({ restaurant: { totalServed: 0, funds: 1500, reputation: 0, day: 1 } }),
    )).toBe(100);
    expect(getMilestoneProgress(
      { condition: { type: 'revenue', threshold: 1000 } },
      buildState({ restaurant: { totalServed: 0, funds: 500, reputation: 0, day: 1 } }),
    )).toBe(50);
    expect(getMilestoneProgress(
      { condition: { type: 'equipmentLevel', threshold: 10 } },
      buildState({ equipment: [{ owned: true, level: 4 }, { owned: true, level: 10 }, { owned: false, level: 20 }] }),
    )).toBe(100);
  });

  it('returns zero progress for non-finite, negative, unknown, or missing measurements', () => {
    const condition = { condition: { type: 'servedTotal', threshold: 10 } };
    for (const totalServed of [NaN, Infinity, -1, undefined]) {
      expect(getMilestoneProgress(condition, buildState({
        restaurant: { totalServed, funds: 0, reputation: 0, day: 1 },
      }))).toBe(0);
    }
    expect(getMilestoneProgress(
      { condition: { type: 'servedTotal', threshold: NaN } },
      buildState({ restaurant: { totalServed: 10, funds: 0, reputation: 0, day: 1 } }),
    )).toBe(0);
    expect(getMilestoneProgress(
      { condition: { type: 'unrecognised', threshold: 1 } },
      buildState(),
    )).toBe(0);
  });

  it('safely ignores malformed milestone records', () => {
    const result = checkMilestones(buildState({
      milestones: [null, 'bad', { id: 'missing-condition', description: 'Missing', reward: { type: 'newDishSlot' } }],
      restaurant: { totalServed: 100, funds: 10000, reputation: 5, day: 30 },
    }));

    expect(result.milestones).toHaveLength(3);
    expect(result.notifications).toHaveLength(0);
    expect(result.recipeSlots).toBe(0);
  });
});
