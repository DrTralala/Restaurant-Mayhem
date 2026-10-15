import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStaffTrainingPreview } from './staffTrainingPreview';

const worker = overrides => ({
  id: 'w1',
  name: 'Worker',
  role: 'cook',
  skill: 3,
  morale: 80,
  salary: 200,
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

describe('getStaffTrainingPreview', () => {
  it('previews the next skill, morale, carry capacity and morale multiplier for a cook', () => {
    const preview = getStaffTrainingPreview(worker({ role: 'cook', skill: 3, morale: 80 }));

    expect(preview).not.toBeNull();
    expect(preview.skill).toBe(4);
    expect(preview.morale).toBe(90);
    expect(preview.carryBefore).toBe(1);
    expect(preview.carryAfter).toBe(1);
    expect(preview.rateLabel).toBe('Morale work multiplier');
    expect(preview.rateBefore).toBeCloseTo(1.3, 10);
    expect(preview.rateAfter).toBeCloseTo(1.4, 10);
  });

  it('steps carry capacity 1 → 2 at skill 5 and 2 → 3 at skill 10 for every role', () => {
    ['cook', 'waiter', 'janitor'].forEach(role => {
      const toFive = getStaffTrainingPreview(worker({ role, skill: 4, morale: 80 }));
      expect(toFive.carryBefore).toBe(1);
      expect(toFive.carryAfter).toBe(2);

      const toTen = getStaffTrainingPreview(worker({ role, skill: 9, morale: 80 }));
      expect(toTen.skill).toBe(10);
      expect(toTen.carryBefore).toBe(2);
      expect(toTen.carryAfter).toBe(3);
    });
  });

  it('previews the waiter order-taking rate including morale and skill', () => {
    const preview = getStaffTrainingPreview(worker({ role: 'waiter', skill: 4, morale: 80 }));

    expect(preview.rateLabel).toBe('Order-taking rate');
    expect(preview.rateBefore).toBeCloseTo(1.3, 10);
    expect(preview.rateAfter).toBeCloseTo(2.8, 10);
  });

  it('previews the janitor cleaning/washing rate including morale and skill', () => {
    const toFive = getStaffTrainingPreview(worker({ role: 'janitor', skill: 4, morale: 80 }));
    expect(toFive.rateLabel).toBe('Cleaning/washing rate');
    expect(toFive.rateBefore).toBeCloseTo(1.3, 10);
    expect(toFive.rateAfter).toBeCloseTo(2.1, 10);

    const toTen = getStaffTrainingPreview(worker({ role: 'janitor', skill: 9, morale: 80 }));
    expect(toTen.rateBefore).toBeCloseTo(1.95, 10);
    expect(toTen.rateAfter).toBeCloseTo(2.8, 10);
  });

  it('caps the previewed morale at 100', () => {
    expect(getStaffTrainingPreview(worker({ skill: 3, morale: 95 })).morale).toBe(100);
    expect(getStaffTrainingPreview(worker({ skill: 3, morale: 100 })).morale).toBe(100);
  });

  it('keeps the exact fractional next morale; rounding belongs to the display layer', () => {
    expect(getStaffTrainingPreview(worker({ skill: 3, morale: 79.6 })).morale).toBe(89.6);
  });

  it('returns null for maxed skill, unknown roles and invalid skills', () => {
    expect(getStaffTrainingPreview(worker({ skill: 10 }))).toBeNull();
    expect(getStaffTrainingPreview(worker({ skill: 12 }))).toBeNull();
    expect(getStaffTrainingPreview(worker({ role: 'manager' }))).toBeNull();
    expect(getStaffTrainingPreview(worker({ skill: NaN }))).toBeNull();
    expect(getStaffTrainingPreview(worker({ skill: Infinity }))).toBeNull();
    expect(getStaffTrainingPreview(worker({ skill: 0 }))).toBeNull();
    expect(getStaffTrainingPreview(worker({ skill: undefined }))).toBeNull();
    expect(getStaffTrainingPreview(null)).toBeNull();
  });

  it('follows the reducer min(skill + 1, 10) for fractional finite skills', () => {
    const fractional = getStaffTrainingPreview(worker({ skill: 4.5, morale: 80 }));
    expect(fractional.skill).toBe(5.5);
    expect(fractional.carryBefore).toBe(1);
    expect(fractional.carryAfter).toBe(2);

    const nearMax = getStaffTrainingPreview(worker({ skill: 9.5, morale: 80 }));
    expect(nearMax.skill).toBe(10);
    expect(nearMax.carryBefore).toBe(2);
    expect(nearMax.carryAfter).toBe(3);
  });

  it('does not mutate a frozen input worker and never calls Math.random', () => {
    const frozen = freeze(worker({ role: 'waiter', skill: 4, morale: 80 }));
    const snapshot = JSON.stringify(frozen);
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called');
    });

    const preview = getStaffTrainingPreview(frozen);

    expect(preview).toMatchObject({ skill: 5, morale: 90, carryBefore: 1, carryAfter: 2 });
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
