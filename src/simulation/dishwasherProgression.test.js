import { describe, expect, it } from 'vitest';
import { getDishwasherStats } from './dishwasherProgression';

describe('dishwasher progression', () => {
  it.each([
    [1, 12, 1, 300, 100],
    [2, 18, 1.125, 300 / 1.125, 200],
    [3, 24, 1.25, 240, 400],
    [4, 30, 1.375, 300 / 1.375, 800],
    [5, 36, 1.5, 200, 1600],
    [6, 41, 1.6, 187.5, 3200],
    [7, 46, 1.7, 300 / 1.7, 6400],
    [8, 50, 1.8, 300 / 1.8, 12800],
    [9, 55, 1.9, 300 / 1.9, 25600],
    [10, 60, 2, 150, null],
  ])('returns level %s capacity, rate, duration and next cost',
    (level, capacity, washRate, secondsPerDish, nextUpgradeCost) => {
      expect(getDishwasherStats(level)).toEqual({
        capacity,
        washRate,
        secondsPerDish,
        nextUpgradeCost,
      });
    });

  it.each([0, 11, -1, 1.5, '1', null, undefined, NaN, Infinity, -Infinity])
    ('rejects invalid level %s', level => {
      expect(getDishwasherStats(level)).toBeNull();
    });
});
