import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPERATING_HOURS, RUSH_PERIODS,
  advanceClock, getClockHandAngles, getDailyPayroll, getRushHourMultiplier,
  formatOperatingHour, isRestaurantOpen, normaliseOperatingHour, secondsToGameTime,
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

  it('resets menu sales on the first crossed midnight without changing monetary history', () => {
    const state = {
      restaurant: { funds: 1000, dailyRevenue: 200, gameTime: 86399, day: 1 },
      staff: [{ salary: 100 }],
      dailyHistory: [],
      notifications: [],
      menuSales: {
        day: 1,
        dishes: [{ key: 'starter-toast', count: 4 }],
        drinks: [{ key: 'water', count: 2 }],
      },
    };

    const result = advanceClock(state, 1);

    expect(result.restaurant).toMatchObject({ funds: 900, dailyRevenue: 0, day: 2 });
    expect(result.dailyHistory).toEqual([
      { day: 1, revenue: 200, payroll: 100, profit: 100 },
    ]);
    expect(result.menuSales).toEqual({ day: 2, dishes: [], drinks: [] });
  });

  it('resets menu sales to the final day across multiple midnight crossings', () => {
    const state = {
      restaurant: { funds: 1000, dailyRevenue: 75, gameTime: 86399, day: 4 },
      staff: [{ salary: 100 }],
      dailyHistory: [],
      notifications: [],
      menuSales: {
        day: 4,
        dishes: [{ key: 'starter-toast', count: 7 }],
        drinks: [],
      },
    };

    const result = advanceClock(state, 86401);

    expect(result.restaurant).toMatchObject({ funds: 800, dailyRevenue: 0, day: 6 });
    expect(result.dailyHistory).toEqual([
      { day: 4, revenue: 75, payroll: 100, profit: -25 },
      { day: 5, revenue: 0, payroll: 100, profit: -100 },
    ]);
    expect(result.menuSales).toEqual({ day: 6, dishes: [], drinks: [] });
  });

  it('preserves current menu sales when no midnight is crossed', () => {
    const menuSales = {
      day: 1,
      dishes: [{ key: 'starter-toast', count: 4 }],
      drinks: [{ key: 'water', count: 2 }],
    };
    const state = {
      restaurant: { funds: 1000, dailyRevenue: 75, gameTime: 100, day: 1 },
      staff: [{ salary: 100 }],
      dailyHistory: [],
      notifications: [],
      menuSales,
    };

    const result = advanceClock(state, 50);

    expect(result.restaurant).toMatchObject({ funds: 1000, dailyRevenue: 75, day: 1 });
    expect(result.dailyHistory).toEqual([]);
    expect(result.menuSales).toEqual(menuSales);
    expect(result.menuSales).toBe(menuSales);
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

describe('getDailyPayroll', () => {
  it('sums only finite non-negative salaries from frozen staff and ignores invalid entries', () => {
    const staff = Object.freeze([
      Object.freeze({ id: 'cook', salary: 120 }),
      Object.freeze({ id: 'waiter', salary: 150.25 }),
      Object.freeze({ id: 'intern', salary: 0 }),
      Object.freeze({ id: 'missing-salary' }),
      Object.freeze({ id: 'negative', salary: -1 }),
      Object.freeze({ id: 'nan', salary: Number.NaN }),
      Object.freeze({ id: 'infinite', salary: Number.POSITIVE_INFINITY }),
      null,
    ]);

    expect(getDailyPayroll(staff)).toBe(270.25);
  });

  it('returns zero for empty or defaulted staff lists', () => {
    expect(getDailyPayroll([])).toBe(0);
    expect(getDailyPayroll()).toBe(0);
  });
});

describe('isRestaurantOpen', () => {
  it.each([
    [10 * 3600, 10, 22, true],
    [22 * 3600, 10, 22, false],
    [23 * 3600, 18, 2, true],
    [1.5 * 3600, 18, 2, true],
    [2 * 3600, 18, 2, false],
    [5 * 3600, 0, 0, true],
  ])('evaluates %s with %s-%s as %s', (gameTime, openHour, closeHour, expected) => {
    expect(isRestaurantOpen({ restaurant: { gameTime, openHour, closeHour } })).toBe(expected);
  });

  it('uses the 24/7 default when stored hours are malformed or missing', () => {
    expect(DEFAULT_OPERATING_HOURS).toEqual({ openHour: 0, closeHour: 0 });
    expect(isRestaurantOpen({ restaurant: { gameTime: 9 * 3600 } })).toBe(true);
    expect(isRestaurantOpen({ restaurant: {
      gameTime: 23 * 3600, openHour: 10.25, closeHour: Number.NaN,
    } })).toBe(true);
  });
});

describe('operating-hour helpers', () => {
  it.each([
    [10, 10], [10.5, 10.5], [24, 0], [-1, 10], [10.25, 10],
  ])('normalises %s to %s', (input, expected) => {
    expect(normaliseOperatingHour(input, 10)).toBe(expected);
  });

  it('formats normalised half-hour values for display', () => {
    expect(formatOperatingHour(0)).toBe('12:00 AM');
    expect(formatOperatingHour(18.5)).toBe('6:30 PM');
    expect(formatOperatingHour(24)).toBe('12:00 AM');
  });
});

describe('rush hour and analogue clock helpers', () => {
  it.each([
    [6 * 3600, 1], [7 * 3600, 2], [8 * 3600, 1],
    [11 * 3600, 1], [12.5 * 3600, 2.5], [14 * 3600, 1],
    [17 * 3600, 1], [18.5 * 3600, 3], [20 * 3600, 1],
  ])('returns the approved rush multiplier at %s seconds', (time, expected) => {
    expect(getRushHourMultiplier(time)).toBeCloseTo(expected);
  });

  it('interpolates each side of lunch rush', () => {
    expect(getRushHourMultiplier(11.75 * 3600)).toBeCloseTo(1.75);
    expect(getRushHourMultiplier(13.75 * 3600)).toBeCloseTo(1.25);
  });

  it('wraps rush-hour boundaries across whole days', () => {
    expect(getRushHourMultiplier(24 * 3600 + 7 * 3600)).toBeCloseTo(2);
    expect(getRushHourMultiplier(-16 * 3600)).toBeCloseTo(1);
  });

  it('derives analogue hand angles including partial hours', () => {
    expect(getClockHandAngles(3 * 3600 + 30 * 60)).toEqual({
      hourDegrees: 105,
      minuteDegrees: 180,
    });
  });

  it('pins the extracted period values at every endpoint, peak and slope', () => {
    expect(getRushHourMultiplier(5.5 * 3600)).toBeCloseTo(1);
    expect(getRushHourMultiplier(6 * 3600)).toBeCloseTo(1);
    expect(getRushHourMultiplier(6.5 * 3600)).toBeCloseTo(1.5);
    expect(getRushHourMultiplier(7 * 3600)).toBeCloseTo(2);
    expect(getRushHourMultiplier(7.5 * 3600)).toBeCloseTo(1.5);
    expect(getRushHourMultiplier(8 * 3600)).toBeCloseTo(1);
    expect(getRushHourMultiplier(8.5 * 3600)).toBeCloseTo(1);
    expect(getRushHourMultiplier(11 * 3600)).toBeCloseTo(1);
    expect(getRushHourMultiplier(11.75 * 3600)).toBeCloseTo(1.75);
    expect(getRushHourMultiplier(12.5 * 3600)).toBeCloseTo(2.5);
    expect(getRushHourMultiplier(13.75 * 3600)).toBeCloseTo(1.25);
    expect(getRushHourMultiplier(14 * 3600)).toBeCloseTo(1);
    expect(getRushHourMultiplier(17 * 3600)).toBeCloseTo(1);
    expect(getRushHourMultiplier(17.75 * 3600)).toBeCloseTo(2);
    expect(getRushHourMultiplier(18.5 * 3600)).toBeCloseTo(3);
    expect(getRushHourMultiplier(19.25 * 3600)).toBeCloseTo(2);
    expect(getRushHourMultiplier(20 * 3600)).toBeCloseTo(1);
    expect(getRushHourMultiplier(20.5 * 3600)).toBeCloseTo(1);
  });

  it('wraps the extracted periods across days and negative times', () => {
    expect(getRushHourMultiplier(24 * 3600 + 12.5 * 3600)).toBeCloseTo(2.5);
    expect(getRushHourMultiplier(24 * 3600 + 18.5 * 3600)).toBeCloseTo(3);
    expect(getRushHourMultiplier(-86400 + 7 * 3600)).toBeCloseTo(2);
    expect(getRushHourMultiplier(-11 * 3600)).toBeCloseTo(2);
    expect(getRushHourMultiplier(-5.5 * 3600)).toBeCloseTo(3);
    expect(getRushHourMultiplier(-18 * 3600)).toBeCloseTo(1);
  });

  it('matches the original hard-coded ramps on a dense sweep', () => {
    const referenceRamp = (secondsOfDay, start, peak, end, peakMultiplier) => {
      if (secondsOfDay < start || secondsOfDay > end) return 1;
      if (secondsOfDay <= peak) {
        return 1 + (peakMultiplier - 1) * ((secondsOfDay - start) / (peak - start));
      }
      return peakMultiplier - (peakMultiplier - 1) * ((secondsOfDay - peak) / (end - peak));
    };
    const reference = totalSeconds => {
      const time = ((totalSeconds % 86400) + 86400) % 86400;
      return Math.max(
        1,
        referenceRamp(time, 6 * 3600, 7 * 3600, 8 * 3600, 2),
        referenceRamp(time, 11 * 3600, 12.5 * 3600, 14 * 3600, 2.5),
        referenceRamp(time, 17 * 3600, 18.5 * 3600, 20 * 3600, 3),
      );
    };

    for (let seconds = -86400; seconds <= 2 * 86400; seconds += 360) {
      expect(getRushHourMultiplier(seconds)).toBe(reference(seconds));
      expect(getRushHourMultiplier(seconds + 137)).toBe(reference(seconds + 137));
    }
  });
});

describe('RUSH_PERIODS', () => {
  it('freezes the approved period definitions in order', () => {
    expect(Object.isFrozen(RUSH_PERIODS)).toBe(true);
    expect(RUSH_PERIODS).toHaveLength(3);
    expect(RUSH_PERIODS.every(period => Object.isFrozen(period))).toBe(true);
    expect(RUSH_PERIODS).toEqual([
      { name: 'Breakfast', startHour: 6, peakHour: 7, endHour: 8, peakMultiplier: 2 },
      { name: 'Lunch', startHour: 11, peakHour: 12.5, endHour: 14, peakMultiplier: 2.5 },
      { name: 'Dinner', startHour: 17, peakHour: 18.5, endHour: 20, peakMultiplier: 3 },
    ]);
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
