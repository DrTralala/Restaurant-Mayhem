import { describe, it, expect } from 'vitest';
import { advanceClock, isRestaurantOpen, secondsToGameTime } from './clock';

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
});

describe('isRestaurantOpen', () => {
  it('returns true during open hours', () => {
    const state = { restaurant: { gameTime: 15 * 3600, openHour: 10, closeHour: 22 } };
    expect(isRestaurantOpen(state)).toBe(true);
  });

  it('returns false during closed hours', () => {
    const state = { restaurant: { gameTime: 5 * 3600, openHour: 10, closeHour: 22 } };
    expect(isRestaurantOpen(state)).toBe(false);
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
