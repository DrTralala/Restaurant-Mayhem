import { describe, expect, it, vi } from 'vitest';
import { getStaffFirePreview } from './staffFirePreview';

const worker = (id, salary) => ({ id, salary });

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('getStaffFirePreview', () => {
  it('computes payroll totals and savings from valid fractional salaries', () => {
    const preview = getStaffFirePreview({
      funds: 600.5,
      staff: [
        worker('fire', 150.25),
        worker('keep', 45.75),
        worker('invalid', Number.NaN),
        worker('negative', -12),
        worker('string', '30'),
        null,
      ],
    }, 'fire');

    expect(preview).toEqual({
      dailyPayrollBefore: 196,
      dailyPayrollAfter: 45.75,
      dailySavings: 150.25,
      fundsAfterPayroll: 554.75,
    });
  });

  it('keeps zero and invalid worker salaries consistent with getDailyPayroll', () => {
    expect(getStaffFirePreview({
      funds: 12,
      staff: [worker('zero', 0), worker('keep', 12.5)],
    }, 'zero')).toEqual({
      dailyPayrollBefore: 12.5,
      dailyPayrollAfter: 12.5,
      dailySavings: 0,
      fundsAfterPayroll: -0.5,
    });

    expect(getStaffFirePreview({
      funds: 12,
      staff: [worker('invalid', Number.POSITIVE_INFINITY), worker('keep', 12.5)],
    }, 'invalid')).toEqual({
      dailyPayrollBefore: 12.5,
      dailyPayrollAfter: 12.5,
      dailySavings: 0,
      fundsAfterPayroll: -0.5,
    });
  });

  it('removes every duplicate strict-id match just as FIRE_STAFF does', () => {
    const preview = getStaffFirePreview({
      funds: 100,
      staff: [worker('same', 10.25), worker('same', 20.5), worker(7, 30.75)],
    }, 'same');

    expect(preview).toEqual({
      dailyPayrollBefore: 61.5,
      dailyPayrollAfter: 30.75,
      dailySavings: 30.75,
      fundsAfterPayroll: 69.25,
    });
    expect(getStaffFirePreview({
      funds: 100,
      staff: [worker('7', 10), worker(7, 20)],
    }, '7')).toMatchObject({ dailyPayrollAfter: 20, dailySavings: 10 });
  });

  it('returns null when the strict worker id is absent', () => {
    expect(getStaffFirePreview({ funds: 500, staff: [worker(7, 100)] }, '7')).toBeNull();
    expect(getStaffFirePreview({ funds: 500, staff: [] }, 'missing')).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('returns unavailable projected funds for %s funds', (_label, funds) => {
    expect(getStaffFirePreview({ funds, staff: [worker('fire', 10.25)] }, 'fire'))
      .toEqual({
        dailyPayrollBefore: 10.25,
        dailyPayrollAfter: 0,
        dailySavings: 10.25,
        fundsAfterPayroll: null,
      });
  });

  it('preserves a negative finite projected balance', () => {
    expect(getStaffFirePreview({ funds: -20, staff: [worker('fire', 5.5)] }, 'fire'))
      .toEqual({
        dailyPayrollBefore: 5.5,
        dailyPayrollAfter: 0,
        dailySavings: 5.5,
        fundsAfterPayroll: -20,
      });
  });

  it('defaults a missing staff list and does not mutate frozen input', () => {
    expect(getStaffFirePreview({ funds: 25 }, 'solo')).toBeNull();

    const input = freeze({ funds: 200.25, staff: [worker('fire', 75.5), worker('stay', 24.25)] });
    const snapshot = JSON.stringify(input);
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called');
    });

    expect(getStaffFirePreview(input, 'fire')).toMatchObject({
      dailyPayrollBefore: 99.75,
      dailyPayrollAfter: 24.25,
      dailySavings: 75.5,
      fundsAfterPayroll: 176,
    });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
