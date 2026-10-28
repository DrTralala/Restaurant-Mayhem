import { describe, expect, it } from 'vitest';
import { getCleanupSummary } from './cleanupSummary';

const ZERO_SUMMARY = {
  dirtyTables: 0,
  dirtyAtTable: 0,
  carriedDirty: 0,
  queuedForWash: 0,
  washing: 0,
};

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('getCleanupSummary', () => {
  it('returns zero counts for an empty or incomplete state', () => {
    expect(getCleanupSummary({})).toEqual(ZERO_SUMMARY);
    expect(getCleanupSummary({ tables: undefined, serviceItems: undefined })).toEqual(ZERO_SUMMARY);
    expect(getCleanupSummary(null)).toEqual(ZERO_SUMMARY);
  });

  it('derives the dirty-table count and counts cleanup-stage service items', () => {
    expect(getCleanupSummary({
      tables: [{ status: 'dirty' }, { status: 'occupied' }],
      serviceItems: [
        { kind: 'dish', state: 'dirty_at_table' },
        { kind: 'drink', state: 'washing' },
        { kind: 'dish', state: 'to_clean' },
      ],
    })).toEqual({
      dirtyTables: 1,
      dirtyAtTable: 1,
      carriedDirty: 0,
      queuedForWash: 0,
      washing: 1,
    });
  });

  it.each([
    ['dirty_at_table', 'dirtyAtTable'],
    ['carried_dirty', 'carriedDirty'],
    ['queued_for_wash', 'queuedForWash'],
    ['washing', 'washing'],
  ])('counts a %s item', (state, key) => {
    expect(getCleanupSummary({ serviceItems: [{ kind: 'dish', state }] }))
      .toEqual({ ...ZERO_SUMMARY, [key]: 1 });
  });

  it('counts both dishes and drinks, including items without owners', () => {
    expect(getCleanupSummary({
      customers: [],
      serviceItems: [
        { kind: 'dish', state: 'dirty_at_table', customerId: null },
        { kind: 'drink', state: 'dirty_at_table', customerId: 'missing-owner' },
        { kind: 'drink', state: 'carried_dirty' },
      ],
    })).toEqual({ ...ZERO_SUMMARY, dirtyAtTable: 2, carriedDirty: 1 });
  });

  it('ignores to_clean, unknown states, and non-dish/drink items', () => {
    expect(getCleanupSummary({
      serviceItems: [
        { kind: 'dish', state: 'to_clean' },
        { kind: 'drink', state: 'delivered' },
        { kind: 'napkin', state: 'washing' },
        { kind: 'dish', state: 'unknown_state' },
        { kind: 'dish', state: '__proto__' },
      ],
    })).toEqual(ZERO_SUMMARY);
  });

  it('ignores malformed entries and non-array collections', () => {
    expect(getCleanupSummary({
      tables: [null, undefined, 'dirty', { status: 'cleaning' }],
      serviceItems: [null, undefined, 'washing', {}, { kind: 'dish' }, { state: 'washing' }],
    })).toEqual(ZERO_SUMMARY);
    expect(getCleanupSummary({ tables: {}, serviceItems: {} })).toEqual(ZERO_SUMMARY);
  });

  it('does not count reservations outside serviceItems', () => {
    expect(getCleanupSummary({
      serviceItems: [{ kind: 'dish', state: 'queued_for_wash' }],
      reservations: [{ kind: 'drink', state: 'queued_for_wash' }],
    })).toEqual({ ...ZERO_SUMMARY, queuedForWash: 1 });
  });

  it('does not mutate recursively frozen input', () => {
    const state = freeze({
      tables: [{ status: 'dirty' }, { status: 'occupied' }],
      serviceItems: [
        { kind: 'dish', state: 'dirty_at_table', customerId: null },
        { kind: 'drink', state: 'washing' },
      ],
    });
    const snapshot = JSON.stringify(state);

    expect(getCleanupSummary(state)).toEqual({
      dirtyTables: 1,
      dirtyAtTable: 1,
      carriedDirty: 0,
      queuedForWash: 0,
      washing: 1,
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
