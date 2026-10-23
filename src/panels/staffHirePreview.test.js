import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStaffHirePreview } from './staffHirePreview';

const worker = overrides => ({
  id: 'w1',
  name: 'Worker',
  role: 'waiter',
  skill: 3,
  morale: 80,
  salary: 150.25,
  ...overrides,
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getStaffHirePreview', () => {
  it('projects the exact cash for a waiter hire from the fractional fixture', () => {
    const preview = getStaffHirePreview({ funds: 622.5, staff: [worker()] }, 'waiter');

    expect(preview).toEqual({
      cost: 150,
      canHire: true,
      fundsAfterHire: 472.5,
      dailyPayrollAfterHire: 300.25,
      fundsAfterPayroll: 172.25,
    });
  });

  it('uses the canonical salary for every known role', () => {
    expect(getStaffHirePreview({ funds: 1000, staff: [] }, 'cook').cost).toBe(200);
    expect(getStaffHirePreview({ funds: 1000, staff: [] }, 'waiter').cost).toBe(150);
    expect(getStaffHirePreview({ funds: 1000, staff: [] }, 'janitor').cost).toBe(120);
  });

  it('treats funds exactly equal to the cost as hireable and keeps the negative balance unclamped', () => {
    const preview = getStaffHirePreview({ funds: 150, staff: [worker()] }, 'waiter');

    expect(preview.canHire).toBe(true);
    expect(preview.fundsAfterHire).toBe(0);
    expect(preview.dailyPayrollAfterHire).toBe(300.25);
    expect(preview.fundsAfterPayroll).toBe(-300.25);
  });

  it('keeps a finite shortfall previewable without enabling the hire', () => {
    const preview = getStaffHirePreview({ funds: 119, staff: [] }, 'cook');

    expect(preview.canHire).toBe(false);
    expect(preview.fundsAfterHire).toBe(-81);
    expect(preview.dailyPayrollAfterHire).toBe(200);
    expect(preview.fundsAfterPayroll).toBe(-281);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('returns null cash and canHire false for %s funds', (_label, funds) => {
    const preview = getStaffHirePreview({ funds, staff: [worker()] }, 'waiter');

    expect(preview.cost).toBe(150);
    expect(preview.canHire).toBe(false);
    expect(preview.fundsAfterHire).toBeNull();
    expect(preview.dailyPayrollAfterHire).toBe(300.25);
    expect(preview.fundsAfterPayroll).toBeNull();
  });

  it('returns null for unknown, inherited or malformed roles', () => {
    expect(getStaffHirePreview({ funds: 500 }, 'manager')).toBeNull();
    expect(getStaffHirePreview({ funds: 500 }, 'toString')).toBeNull();
    expect(getStaffHirePreview({ funds: 500 }, 'COOK')).toBeNull();
    expect(getStaffHirePreview({ funds: 500 }, undefined)).toBeNull();
    expect(getStaffHirePreview({ funds: 500 }, null)).toBeNull();
    expect(getStaffHirePreview()).toBeNull();
  });

  it('adds existing payroll from all finite non-negative salaries only', () => {
    const preview = getStaffHirePreview({
      funds: 1000,
      staff: [
        worker(),
        { salary: 50 },
        { salary: Number.NaN },
        { salary: -5 },
        { salary: '120' },
        null,
        {},
      ],
    }, 'janitor');

    expect(preview.dailyPayrollAfterHire).toBe(320.25);
    expect(preview.fundsAfterHire).toBe(880);
    expect(preview.fundsAfterPayroll).toBe(559.75);
  });

  it('defaults a missing staff list to empty payroll', () => {
    expect(getStaffHirePreview({ funds: 500 }, 'janitor').dailyPayrollAfterHire).toBe(120);
    expect(getStaffHirePreview({ funds: 500, staff: [] }, 'janitor').dailyPayrollAfterHire).toBe(120);
  });

  it('does not mutate a frozen input and never calls Math.random', () => {
    const frozen = freeze({ funds: 622.5, staff: [worker()] });
    const snapshot = JSON.stringify(frozen);
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called');
    });

    const preview = getStaffHirePreview(frozen, 'waiter');

    expect(preview).toMatchObject({ canHire: true, fundsAfterPayroll: 172.25 });
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
