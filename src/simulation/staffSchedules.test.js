import { describe, expect, it } from 'vitest';
import {
  createStaffDutyDefaults,
  getScheduledDuty,
  validateStaffSchedule,
} from './staffSchedules';

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
