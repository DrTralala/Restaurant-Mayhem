import { describe, expect, it, vi } from 'vitest';
import { getRushSchedulePreview } from './rushSchedulePreview';
import { RUSH_PERIODS } from '../simulation/clock';

const byName = preview => Object.fromEntries(preview.map(period => [period.name, period]));
const coverage = preview => preview.map(period => period.openHours);
const fullWindow = [2, 3, 3];

describe('getRushSchedulePreview', () => {
  it('returns every period with its open-hour coverage for a 24/7 restaurant', () => {
    const preview = getRushSchedulePreview({ openHour: 0, closeHour: 0 });

    expect(preview).toEqual([
      { name: 'Breakfast', startHour: 6, peakHour: 7, endHour: 8, peakMultiplier: 2, openHours: 2 },
      { name: 'Lunch', startHour: 11, peakHour: 12.5, endHour: 14, peakMultiplier: 2.5, openHours: 3 },
      { name: 'Dinner', startHour: 17, peakHour: 18.5, endHour: 20, peakMultiplier: 3, openHours: 3 },
    ]);
  });

  it('counts open half-hour intervals using their midpoints', () => {
    const preview = byName(getRushSchedulePreview({ openHour: 6, closeHour: 6.5 }));

    expect(preview.Breakfast.openHours).toBe(0.5);
    expect(preview.Lunch.openHours).toBe(0);
    expect(preview.Dinner.openHours).toBe(0);
  });

  it('excludes a period peak that sits exactly at closing time', () => {
    const preview = getRushSchedulePreview({ openHour: 10, closeHour: 12.5 });

    expect(coverage(preview)).toEqual([0, 1.5, 0]);
  });

  it('wraps overnight windows across breakfast and dinner', () => {
    const preview = getRushSchedulePreview({ openHour: 19, closeHour: 7 });

    expect(coverage(preview)).toEqual([1, 0, 1]);
  });

  it('treats equal opening and closing hours as all-day open', () => {
    for (const restaurant of [
      { openHour: 0, closeHour: 0 },
      { openHour: 10, closeHour: 10 },
      { openHour: 24, closeHour: 24 },
    ]) {
      expect(coverage(getRushSchedulePreview(restaurant))).toEqual(fullWindow);
    }
  });

  it('falls back to canonical 24/7 hours when operating hours are missing or invalid', () => {
    for (const restaurant of [
      undefined,
      {},
      { openHour: 10.25, closeHour: Number.NaN },
    ]) {
      expect(coverage(getRushSchedulePreview(restaurant))).toEqual(fullWindow);
    }
  });

  it('does not gate coverage on walkInsPaused', () => {
    const open = { openHour: 6, closeHour: 6.5 };

    expect(getRushSchedulePreview({ ...open, walkInsPaused: true }))
      .toEqual(getRushSchedulePreview(open));
  });

  it('does not mutate its input or the shared frozen period definitions', () => {
    const restaurant = Object.freeze({ openHour: 11, closeHour: 14 });
    const preview = getRushSchedulePreview(restaurant);

    expect(restaurant).toEqual({ openHour: 11, closeHour: 14 });
    expect(RUSH_PERIODS.some(period => 'openHours' in period)).toBe(false);
    expect(preview.every(period => !RUSH_PERIODS.includes(period))).toBe(true);
    expect(preview[0]).not.toBe(RUSH_PERIODS[0]);
  });

  it('is deterministic and consumes no RNG', () => {
    const random = vi.spyOn(Math, 'random');
    try {
      const first = getRushSchedulePreview({ openHour: 17, closeHour: 20 });
      const second = getRushSchedulePreview({ openHour: 17, closeHour: 20 });

      expect(first).toEqual(second);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});
