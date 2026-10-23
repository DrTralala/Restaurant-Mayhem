import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAmenityUsageSummary } from './amenityUsageSummary';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function slot(index, owners = {}) {
  return {
    index,
    reservedBy: owners.reservedBy ?? null,
    occupiedBy: owners.occupiedBy ?? null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAmenityUsageSummary', () => {
  it('counts mixed couch slots as occupied, reserved and unclaimed', () => {
    const summary = getAmenityUsageSummary({
      type: 'couch',
      slots: [slot(0, { occupiedBy: 'staff-1' }), slot(1, { reservedBy: 'staff-2' })],
    });

    expect(summary).toEqual({ capacity: 2, occupied: 1, reserved: 1, unclaimed: 0 });
  });

  it('reports a free bed and a free arcade as fully unclaimed', () => {
    expect(getAmenityUsageSummary({ type: 'bed', slots: [slot(0)] }))
      .toEqual({ capacity: 1, occupied: 0, reserved: 0, unclaimed: 1 });
    expect(getAmenityUsageSummary({ type: 'arcade', slots: [slot(0)] }))
      .toEqual({ capacity: 1, occupied: 0, reserved: 0, unclaimed: 1 });
  });

  it('keeps occupied, reserved and unclaimed mutually exclusive and summing to capacity', () => {
    const summary = getAmenityUsageSummary({
      type: 'couch',
      slots: [slot(0, { occupiedBy: 'staff-1' }), slot(1)],
    });

    expect(summary).toEqual({ capacity: 2, occupied: 1, reserved: 0, unclaimed: 1 });
    expect(summary.occupied + summary.reserved + summary.unclaimed).toBe(summary.capacity);
  });

  it('returns null when a slot carries both a reservation and an occupant', () => {
    expect(getAmenityUsageSummary({
      type: 'couch',
      slots: [slot(0, { reservedBy: 'staff-1', occupiedBy: 'staff-2' }), slot(1)],
    })).toBeNull();
  });

  it('returns null when the slot count does not match the canonical capacity', () => {
    expect(getAmenityUsageSummary({ type: 'couch', slots: [slot(0)] })).toBeNull();
    expect(getAmenityUsageSummary({ type: 'couch', slots: [slot(0), slot(1), slot(2)] })).toBeNull();
    expect(getAmenityUsageSummary({ type: 'arcade', slots: [slot(0), slot(1)] })).toBeNull();
  });

  it('returns null for duplicate or missing slot indexes', () => {
    expect(getAmenityUsageSummary({ type: 'couch', slots: [slot(0), slot(0)] })).toBeNull();
    expect(getAmenityUsageSummary({ type: 'couch', slots: [slot(0), slot(2)] })).toBeNull();
    expect(getAmenityUsageSummary({
      type: 'couch',
      slots: [{ reservedBy: null, occupiedBy: null }, slot(1)],
    })).toBeNull();
  });

  it('treats missing or undefined owner fields as unclaimed', () => {
    expect(getAmenityUsageSummary({
      type: 'couch',
      slots: [{ index: 0 }, { index: 1, reservedBy: undefined, occupiedBy: undefined }],
    })).toEqual({ capacity: 2, occupied: 0, reserved: 0, unclaimed: 2 });
  });

  it('returns null for unknown types, malformed slot lists and non-object slots', () => {
    expect(getAmenityUsageSummary(null)).toBeNull();
    expect(getAmenityUsageSummary(undefined)).toBeNull();
    expect(getAmenityUsageSummary({ type: 'spa', slots: [slot(0)] })).toBeNull();
    expect(getAmenityUsageSummary({ type: 'couch' })).toBeNull();
    expect(getAmenityUsageSummary({ type: 'couch', slots: 'nope' })).toBeNull();
    expect(getAmenityUsageSummary({ type: 'couch', slots: [null, slot(1)] })).toBeNull();
    expect(getAmenityUsageSummary({ type: 'couch', slots: ['slot', slot(1)] })).toBeNull();
    expect(getAmenityUsageSummary({ type: 'couch', slots: [42, slot(1)] })).toBeNull();
  });

  it('does not mutate a frozen amenity and never calls Math.random', () => {
    const frozen = freeze({
      id: 'couch-1',
      type: 'couch',
      slots: [slot(0, { occupiedBy: 'staff-1' }), slot(1, { reservedBy: 'staff-2' })],
    });
    const snapshot = JSON.stringify(frozen);
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called');
    });

    const summary = getAmenityUsageSummary(frozen);

    expect(summary).toEqual({ capacity: 2, occupied: 1, reserved: 1, unclaimed: 0 });
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
