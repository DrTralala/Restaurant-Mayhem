import { describe, expect, it } from 'vitest';
import { getNextScheduledDutyChange } from './staffSchedulePreview';

const allWork = () => Array(48).fill('work');

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
