import { describe, it, expect } from 'vitest';
import {
  advanceClock, getClockHandAngles, getRushHourMultiplier,
  isRestaurantOpen, secondsToGameTime,
} from './clock';

describe('advanceClock', () => {
  it('advances gameTime by dt', () => {
    const state = { restaurant: { gameTime: 100, day: 1, openHour: 10, closeHour: 22 }, dailyHistory: [] };
    const result = advanceClock(state, 5);
    expect(result.restaurant.gameTime).toBe(105);
    expect(result.restaurant.day).toBe(1);
  });

  it('increments day when gameTime passes midnight', () => {
    const state = { restaurant: { gameTime: 86399, day: 1, openHour: 10, closeHour: 22 }, dailyHistory: [] };
    const result = advanceClock(state, 1);
    expect(result.restaurant.day).toBe(2);
  });

  it('does not run payroll when time moves backwards', () => {
    const state = {
      restaurant: { funds: 1000, dailyRevenue: 200, gameTime: 86400, day: 2 },
      staff: [{ salary: 100 }],
      dailyHistory: [],
      notifications: [],
    };

    const result = advanceClock(state, -1);

    expect(result.restaurant).toMatchObject({ funds: 1000, dailyRevenue: 200, day: 2 });
    expect(result.dailyHistory).toEqual([]);
    expect(result.notifications).toEqual([]);
  });

  it('closes the day with revenue, payroll, profit, and a notification', () => {
    const state = {
      restaurant: {
        funds: 1000,
        dailyRevenue: 200,
        gameTime: 86399,
        day: 1,
        openHour: 10,
        closeHour: 22,
      },
      staff: [
        { id: 'cook', salary: 200 },
        { id: 'waiter', salary: 150 },
        { id: 'host', salary: 150 },
        { id: 'cashier', salary: 150 },
      ],
      dailyHistory: [],
      notifications: [],
    };

    const result = advanceClock(state, 1);

    expect(result.restaurant).toMatchObject({
      funds: 350,
      dailyRevenue: 0,
      day: 2,
    });
    expect(result.dailyHistory).toEqual([
      { day: 1, revenue: 200, payroll: 650, profit: -450 },
    ]);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].message).toContain('Day 1');
  });

  it('deducts valid payroll once for each crossed midnight', () => {
    const state = {
      restaurant: { funds: 1000, dailyRevenue: 75, gameTime: 86399, day: 4 },
      staff: [
        { salary: 100 },
        { salary: -20 },
        { salary: Number.POSITIVE_INFINITY },
      ],
      dailyHistory: [],
      notifications: [],
    };

    const result = advanceClock(state, 86401);

    expect(result.restaurant.funds).toBe(800);
    expect(result.restaurant.day).toBe(6);
    expect(result.dailyHistory).toEqual([
      { day: 4, revenue: 75, payroll: 100, profit: -25 },
      { day: 5, revenue: 0, payroll: 100, profit: -100 },
    ]);
    expect(result.notifications).toHaveLength(2);
  });
});

describe('isRestaurantOpen', () => {
  it('returns true during open hours', () => {
    const state = { restaurant: { gameTime: 15 * 3600, openHour: 10, closeHour: 22 } };
    expect(isRestaurantOpen(state)).toBe(true);
  });

  it('is always open', () => {
    const state = { restaurant: { gameTime: 5 * 3600, openHour: 10, closeHour: 22 } };
    expect(isRestaurantOpen({ restaurant: { gameTime: 3 * 3600 } })).toBe(true);
  });
});

describe('rush hour and analogue clock helpers', () => {
  it.each([
    [6.5 * 3600, 1], [8 * 3600, 2], [10 * 3600, 1],
    [12.5 * 3600, 2.5], [19 * 3600, 3], [22 * 3600, 1],
  ])('returns the approved rush multiplier at %s seconds', (time, expected) => {
    expect(getRushHourMultiplier(time)).toBeCloseTo(expected);
  });

  it('interpolates each side of lunch rush', () => {
    expect(getRushHourMultiplier(11.75 * 3600)).toBeCloseTo(1.75);
    expect(getRushHourMultiplier(13.75 * 3600)).toBeCloseTo(1.75);
  });

  it('derives analogue hand angles including partial hours', () => {
    expect(getClockHandAngles(3 * 3600 + 30 * 60)).toEqual({
      hourDegrees: 105,
      minuteDegrees: 180,
    });
  });
});

describe('secondsToGameTime', () => {
  it('converts seconds to HH:MM format', () => {
    expect(secondsToGameTime(0)).toBe('12:00 AM');
    expect(secondsToGameTime(10 * 3600)).toBe('10:00 AM');
    expect(secondsToGameTime(14 * 3600 + 30 * 60)).toBe('2:30 PM');
    expect(secondsToGameTime(22 * 3600)).toBe('10:00 PM');
  });
});
