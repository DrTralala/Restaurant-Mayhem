import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStaffDutyDefaults,
  getNormalisedStaffSchedule,
  getOwnedStaffSchedule,
  getScheduledDuty,
  validateStaffSchedule,
  withStaffScheduleContext,
} from './staffSchedules';

afterEach(() => vi.restoreAllMocks());
const allWork = () => Array.from({ length: 48 }, () => 'work');

describe('staff schedule policy', () => {
  it('requires exactly 48 work, rest, or pto half-hour slots', () => {
    expect(validateStaffSchedule(allWork())).toEqual({ valid: true, reason: null });
    expect(validateStaffSchedule([...allWork(), 'work'])).toMatchObject({
      valid: false,
      reason: 'invalid-length',
    });
    expect(validateStaffSchedule(allWork().slice(0, 47))).toMatchObject({
      valid: false,
      reason: 'invalid-length',
    });

    const invalidValue = allWork();
    invalidValue[12] = 'holiday';
    expect(validateStaffSchedule(invalidValue)).toMatchObject({
      valid: false,
      reason: 'invalid-mode',
    });
  });

  it('merges a midnight pto run when enforcing the seven-hour minimum', () => {
    const validMidnightRun = allWork();
    for (const index of [44, 45, 46, 47, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      validMidnightRun[index] = 'pto';
    }
    expect(validateStaffSchedule(validMidnightRun)).toEqual({ valid: true, reason: null });

    validMidnightRun[9] = 'work';
    expect(validateStaffSchedule(validMidnightRun)).toMatchObject({
      valid: false,
      reason: 'pto-run-too-short',
    });
  });

  it('accepts all-work and all-pto schedules while rejecting separated short pto runs', () => {
    expect(validateStaffSchedule(Array.from({ length: 48 }, () => 'pto')))
      .toEqual({ valid: true, reason: null });

    const separated = allWork();
    for (let index = 0; index < 14; index += 1) separated[index] = 'pto';
    for (let index = 20; index < 33; index += 1) separated[index] = 'pto';
    expect(validateStaffSchedule(separated)).toMatchObject({
      valid: false,
      reason: 'pto-run-too-short',
    });
  });

  it('aligns schedule slots to repeating absolute game seconds at midnight', () => {
    const schedule = allWork();
    schedule[0] = 'rest';
    schedule[1] = 'pto';
    schedule[47] = 'rest';

    expect(getScheduledDuty(schedule, 0)).toBe('rest');
    expect(getScheduledDuty(schedule, 1_799)).toBe('rest');
    expect(getScheduledDuty(schedule, 1_800)).toBe('pto');
    expect(getScheduledDuty(schedule, 86_399)).toBe('rest');
    expect(getScheduledDuty(schedule, 86_400)).toBe('rest');
    expect(getScheduledDuty(schedule, -1)).toBe('rest');
  });

  it('creates independent complete all-work duty defaults', () => {
    const first = createStaffDutyDefaults();
    const second = createStaffDutyDefaults();

    expect(first).toEqual({
      schedule: allWork(),
      effectiveDuty: 'work',
      dutyPhase: 'available',
      dutyTransitionRequestedAt: null,
      amenityUse: null,
      ptoSession: null,
      wellRestedUntil: 0,
      amenityWaitingSince: null,
      lastRestActivityType: null,
    });
    expect(first.schedule).not.toBe(second.schedule);

    first.schedule[0] = 'rest';
    expect(second.schedule[0]).toBe('work');
  });
});

describe('normalised staff schedules', () => {
  it('falls back to fresh all-work schedules for missing, malformed and short-pto inputs', () => {
    const shortPto = allWork();
    shortPto[0] = 'pto';
    const invalidMode = allWork();
    invalidMode[7] = 'holiday';
    const workers = [{}, { schedule: undefined }, { schedule: null }, { schedule: [] },
      { schedule: allWork().slice(1) }, { schedule: [...allWork(), 'rest'] },
      { schedule: shortPto }, { schedule: invalidMode }];

    for (const worker of workers) {
      const first = getNormalisedStaffSchedule(worker);
      const second = getNormalisedStaffSchedule(worker);
      expect(first).toEqual(allWork());
      expect(second).not.toBe(first);
    }
  });

  it('accepts a nested schedule wrapper as a copied standalone schedule', () => {
    const slots = allWork();
    slots[0] = 'rest';
    const result = getNormalisedStaffSchedule({ schedule: { schedule: slots } });

    expect(result).toEqual(slots);
    expect(result).not.toBe(slots);
    expect(Object.isFrozen(result)).toBe(false);
    slots[0] = 'work';
    expect(result[0]).toBe('rest');
  });

  it('returns the owned immutable snapshot inside a schedule context and a copy outside', () => {
    const slots = allWork();
    slots[1] = 'rest';
    let snapshot;
    withStaffScheduleContext(() => {
      snapshot = getNormalisedStaffSchedule({ schedule: slots });
      expect(snapshot).toBe(getOwnedStaffSchedule(slots).slots);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(getScheduledDuty(snapshot, 1800)).toBe('rest');
    });

    const copy = getNormalisedStaffSchedule({ schedule: slots });
    expect(copy).toEqual(slots);
    expect(copy).not.toBe(snapshot);
    expect(Object.isFrozen(copy)).toBe(false);
  });

  it('uses a fresh all-work schedule for an invalid owned schedule', () => {
    const shortPto = allWork();
    shortPto[0] = 'pto';
    withStaffScheduleContext(() => {
      const result = getNormalisedStaffSchedule({ schedule: shortPto });
      expect(result).toEqual(allWork());
      expect(Object.isFrozen(result)).toBe(false);
    });
  });

  it('does not mutate frozen workers or schedules and never calls RNG', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('RNG'); });
    const slots = Object.freeze(allWork());
    const worker = Object.freeze({ id: 'worker', schedule: slots });

    expect(getNormalisedStaffSchedule(worker)).toEqual(allWork());
    expect(slots).toEqual(allWork());
    expect(random).not.toHaveBeenCalled();
  });
});
