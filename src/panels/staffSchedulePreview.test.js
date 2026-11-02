import { describe, expect, it } from 'vitest';
import { getNextScheduledDutyChange, getScheduledRoleCounts } from './staffSchedulePreview';
import { RUSH_PERIODS } from '../simulation/clock';

const allWork = () => Array(48).fill('work');
const allRest = () => Array(48).fill('rest');

describe('getNextScheduledDutyChange', () => {
  it('skips the current mode run and returns the first future transition', () => {
    const schedule = allWork();
    schedule[20] = 'rest';
    schedule[21] = 'rest';

    expect(getNextScheduledDutyChange({ schedule }, 9 * 3600)).toEqual({
      nextMode: 'rest',
      startsAt: 36_000,
      slotIndex: 20,
    });
  });

  it('treats an exact boundary as the new current mode and finds a strictly future change', () => {
    const schedule = allWork();
    schedule[20] = 'rest';

    expect(getNextScheduledDutyChange({ schedule }, 36_000)).toEqual({
      nextMode: 'work',
      startsAt: 37_800,
      slotIndex: 21,
    });
  });

  it('wraps from the last slot to the first slot on the next day', () => {
    const schedule = allWork();
    schedule[47] = 'rest';

    expect(getNextScheduledDutyChange({ schedule }, 23.5 * 3600)).toEqual({
      nextMode: 'work',
      startsAt: 86_400,
      slotIndex: 0,
    });
  });

  it('finds a transition after midnight and reports its absolute start time', () => {
    const schedule = allWork();
    schedule[0] = 'rest';

    expect(getNextScheduledDutyChange({ schedule }, 23 * 3600)).toEqual({
      nextMode: 'rest',
      startsAt: 86_400,
      slotIndex: 0,
    });
  });

  it.each(['work', 'rest', 'pto'])('returns null for a uniform %s schedule', mode => {
    expect(getNextScheduledDutyChange({ schedule: Array(48).fill(mode) }, 12_345)).toBeNull();
  });

  it('uses the runtime all-work fallback for missing and invalid schedules', () => {
    const shortPto = allWork();
    shortPto[0] = 'pto';
    const invalidMode = allWork();
    invalidMode[4] = 'holiday';

    for (const worker of [
      {},
      { schedule: shortPto },
      { schedule: invalidMode },
      { schedule: allWork().slice(1) },
    ]) {
      expect(getNextScheduledDutyChange(worker, 0)).toBeNull();
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns null for nonfinite game time %s', gameTime => {
      const schedule = allWork();
      schedule[1] = 'rest';
      expect(getNextScheduledDutyChange({ schedule }, gameTime)).toBeNull();
    },
  );

  it('does not mutate copied or frozen worker schedules', () => {
    const schedule = allWork();
    schedule[20] = 'rest';
    const original = [...schedule];
    const worker = Object.freeze({ schedule: Object.freeze(schedule) });

    expect(getNextScheduledDutyChange(worker, 9 * 3600)).toEqual({
      nextMode: 'rest',
      startsAt: 36_000,
      slotIndex: 20,
    });
    expect(worker.schedule).toEqual(original);
    expect(Object.isFrozen(worker.schedule)).toBe(true);
  });
});

describe('getScheduledRoleCounts', () => {
  it('counts exact canonical peak transitions and repeats them the next day', () => {
    for (const { peakHour } of RUSH_PERIODS) {
      const peakTime = peakHour * 3600;
      const schedule = allRest();
      schedule[peakTime / 1800] = 'work';
      const staff = [{ role: 'cook', schedule }];

      expect(getScheduledRoleCounts(staff, peakTime - 1)).toEqual({
        cook: 0, waiter: 0, janitor: 0,
      });
      expect(getScheduledRoleCounts(staff, peakTime)).toEqual({
        cook: 1, waiter: 0, janitor: 0,
      });
      expect(getScheduledRoleCounts(staff, peakTime + 86_399)).toEqual({
        cook: 0, waiter: 0, janitor: 0,
      });
      expect(getScheduledRoleCounts(staff, peakTime + 86_400)).toEqual({
        cook: 1, waiter: 0, janitor: 0,
      });
    }
  });

  it('counts only scheduled Work for recognised roles, not effective duty', () => {
    const lunchPeak = RUSH_PERIODS.find(period => period.name === 'Lunch').peakHour * 3600;

    expect(getScheduledRoleCounts([
      { role: 'cook', effectiveDuty: 'rest', schedule: allWork() },
      { role: 'waiter', effectiveDuty: 'work', schedule: allRest() },
      { role: 'janitor', effectiveDuty: 'work', schedule: Array(48).fill('pto') },
    ], lunchPeak)).toEqual({ cook: 1, waiter: 0, janitor: 0 });
  });

  it('uses the runtime all-work fallback for missing and invalid schedules', () => {
    const invalidSchedule = allWork();
    invalidSchedule[0] = 'holiday';

    expect(getScheduledRoleCounts([
      { role: 'cook' },
      { role: 'waiter', schedule: invalidSchedule },
    ], RUSH_PERIODS[0].peakHour * 3600)).toEqual({ cook: 1, waiter: 1, janitor: 0 });
  });

  it('treats a missing or non-array roster as empty and ignores unknown roles', () => {
    const gameTime = RUSH_PERIODS[1].peakHour * 3600;
    const emptyCounts = { cook: 0, waiter: 0, janitor: 0 };

    expect(getScheduledRoleCounts(undefined, gameTime)).toEqual(emptyCounts);
    expect(getScheduledRoleCounts({ role: 'cook', schedule: allWork() }, gameTime))
      .toEqual(emptyCounts);
    expect(getScheduledRoleCounts([
      { role: 'manager', schedule: allWork() },
      { role: 'cook', schedule: allWork() },
    ], gameTime)).toEqual({ cook: 1, waiter: 0, janitor: 0 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns null for nonfinite game time %s', gameTime => {
      expect(getScheduledRoleCounts([], gameTime)).toBeNull();
    },
  );

  it('does not mutate frozen rosters or schedules and is deterministic', () => {
    const schedule = Object.freeze(allWork());
    const worker = Object.freeze({ role: 'cook', schedule });
    const staff = Object.freeze([worker]);
    const gameTime = RUSH_PERIODS[2].peakHour * 3600;
    const expected = { cook: 1, waiter: 0, janitor: 0 };

    expect(getScheduledRoleCounts(staff, gameTime)).toEqual(expected);
    expect(getScheduledRoleCounts(staff, gameTime)).toEqual(expected);
    expect(staff).toEqual([worker]);
    expect(Object.isFrozen(staff)).toBe(true);
    expect(Object.isFrozen(worker)).toBe(true);
    expect(Object.isFrozen(schedule)).toBe(true);
  });
});
