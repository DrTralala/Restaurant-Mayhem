import { describe, expect, it } from 'vitest';
import { ACTIVITY_DURATIONS } from './activity';
import {
  DISHWASHER_BASE_WASH_WORK,
  getDishwasherStats,
} from './dishwasherProgression';

describe('dishwasher progression', () => {
  it.each([
    [1, 12, 1, 600, 100],
    [2, 18, 1.125, 600 / 1.125, 200],
    [3, 24, 1.25, 480, 400],
    [4, 30, 1.375, 600 / 1.375, 800],
    [5, 36, 1.5, 400, 1600],
    [6, 41, 1.6, 375, 3200],
    [7, 46, 1.7, 600 / 1.7, 6400],
    [8, 50, 1.8, 600 / 1.8, 12800],
    [9, 55, 1.9, 600 / 1.9, 25600],
    [10, 60, 2, 300, null],
  ])('returns level %s capacity, rate, duration and next cost',
    (level, capacity, washRate, secondsPerDish, nextUpgradeCost) => {
      expect(getDishwasherStats(level)).toEqual({
        capacity,
        washRate,
        secondsPerDish,
        nextUpgradeCost,
      });
  });

  it('uses the automatic wash duration without changing manual wash duration', () => {
    expect(ACTIVITY_DURATIONS.manualWash).toBe(300);
    expect(ACTIVITY_DURATIONS.automaticWash).toBe(600);
    expect(DISHWASHER_BASE_WASH_WORK).toBe(ACTIVITY_DURATIONS.automaticWash);
  });

  it.each([0, 11, -1, 1.5, '1', null, undefined, NaN, Infinity, -Infinity])
    ('rejects invalid level %s', level => {
      expect(getDishwasherStats(level)).toBeNull();
    });
});
