import { describe, expect, it } from 'vitest';
import {
  getStaffBonusPreview,
  getStaffTrainingCost,
  STAFF_BONUS_COST,
  STAFF_BONUS_MORALE_GAIN,
} from './staffProgression';

describe('getStaffBonusPreview', () => {
  it('previews the shared bonus costs and gain constants', () => {
    expect(STAFF_BONUS_COST).toBe(50);
    expect(STAFF_BONUS_MORALE_GAIN).toBe(20);
  });

  it('previews a standard bonus without mutating the worker', () => {
    const worker = Object.freeze({ morale: 80 });

    expect(getStaffBonusPreview(worker)).toEqual({ cost: 50, morale: 100 });
    expect(worker).toEqual({ morale: 80 });
  });

  it.each([
    [79.6, 99.6],
    [95, 100],
    [-5, 15],
    [0, 20],
  ])('previews morale %s as %s', (morale, expected) => {
    expect(getStaffBonusPreview({ morale })).toEqual({ cost: 50, morale: expected });
  });

  it.each([100, 101, Number.NaN, Number.POSITIVE_INFINITY, undefined, '80'])(
    'rejects ineligible morale %s',
    morale => {
      expect(getStaffBonusPreview({ morale })).toBeNull();
    },
  );

  it('rejects an absent worker', () => {
    expect(getStaffBonusPreview(null)).toBeNull();
    expect(getStaffBonusPreview(undefined)).toBeNull();
  });
});

describe('getStaffTrainingCost', () => {
  it.each([
    ['cook', 1, 200],
    ['cook', 2, 350],
    ['cook', 3, 620],
    ['cook', 4, 1080],
    ['cook', 5, 1880],
    ['cook', 6, 3290],
    ['cook', 7, 5750],
    ['cook', 8, 10060],
    ['cook', 9, 17600],
    ['waiter', 1, 100],
    ['waiter', 2, 150],
    ['waiter', 3, 230],
    ['waiter', 4, 340],
    ['waiter', 5, 510],
    ['waiter', 6, 760],
    ['waiter', 7, 1140],
    ['waiter', 8, 1710],
    ['waiter', 9, 2570],
    ['janitor', 1, 100],
    ['janitor', 2, 150],
    ['janitor', 3, 230],
    ['janitor', 4, 340],
    ['janitor', 5, 510],
    ['janitor', 6, 760],
    ['janitor', 7, 1140],
    ['janitor', 8, 1710],
    ['janitor', 9, 2570],
  ])('prices %s training from skill %s at $%s', (role, skill, expected) => {
    expect(getStaffTrainingCost({ role, skill })).toBe(expected);
  });
});
