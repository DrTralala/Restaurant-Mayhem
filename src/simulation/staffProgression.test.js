import { describe, expect, it } from 'vitest';
import { getStaffTrainingCost } from './staffProgression';

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
