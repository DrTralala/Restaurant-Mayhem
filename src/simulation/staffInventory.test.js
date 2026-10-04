import { describe, expect, it, vi } from 'vitest';
import {
  getCarriedServiceItemIds,
  getStaffCarryCapacity,
  withCarriedServiceItemIds,
} from './staffInventory';

describe('staff inventory helpers', () => {
  it.each([
    [1, 1], [4, 1], [5, 2], [9, 2], [10, 3],
  ])('returns capacity %s for skill %s', (skill, capacity) => {
    expect(getStaffCarryCapacity({ skill })).toBe(capacity);
  });

  it('returns an ordered unique canonical load', () => {
    expect(getCarriedServiceItemIds({ carryingServiceItemIds: ['a', 'b', 'a', 'c', 'b'] }))
      .toEqual(['a', 'b', 'c']);
  });

  it('normalises the legacy scalar at the inventory boundary', () => {
    expect(getCarriedServiceItemIds({ carryingServiceItemId: 'legacy-item' }))
      .toEqual(['legacy-item']);
    expect(withCarriedServiceItemIds({ carryingServiceItemId: 'legacy-item' }, ['a', 'a', 'b']))
      .toMatchObject({ carryingServiceItemIds: ['a', 'b'] });
  });

  it.each([
    [null, []],
    [0, [0]],
    [['a', null, 0, 'a', false, 0], ['a', 0, false]],
  ])('normalises inventory input %j without dropping valid IDs', (ids, expected) => {
    expect(withCarriedServiceItemIds({}, ids).carryingServiceItemIds).toEqual(expected);
  });

  it('uses the legacy scalar only when the canonical value is not an array', () => {
    expect(getCarriedServiceItemIds({
      carryingServiceItemIds: 'invalid-canonical-value',
      carryingServiceItemId: 0,
    })).toEqual([0]);
    expect(getCarriedServiceItemIds({ carryingServiceItemIds: 0 })).toEqual([]);
    expect(getCarriedServiceItemIds({ carryingServiceItemId: null })).toEqual([]);
  });

  it('preserves the normalised worker shape, property order, symbols and accessor reads', () => {
    const marker = Symbol('marker');
    let legacyReads = 0;
    let fieldReads = 0;
    const worker = {
      before: true,
      get carryingServiceItemId() {
        legacyReads += 1;
        return 'old';
      },
      get details() {
        fieldReads += 1;
        return { preserved: true };
      },
      carryingServiceItemIds: ['old'],
      after: true,
      [marker]: 'symbol-value',
    };
    const ids = ['new', 'new', 0];
    const originalIds = [...ids];
    const normalized = withCarriedServiceItemIds(worker, ids);

    expect(Reflect.ownKeys(normalized)).toEqual([
      'before', 'details', 'carryingServiceItemIds', 'after', marker,
    ]);
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
    expect(normalized).toMatchObject({
      before: true,
      details: { preserved: true },
      carryingServiceItemIds: ['new', 0],
      after: true,
    });
    expect(normalized[marker]).toBe('symbol-value');
    expect(Object.hasOwn(normalized, 'carryingServiceItemId')).toBe(false);
    expect(Object.getOwnPropertyDescriptor(normalized, 'details')).toMatchObject({
      value: { preserved: true }, enumerable: true, writable: true, configurable: true,
    });
    expect(legacyReads).toBe(1);
    expect(fieldReads).toBe(1);
    expect(ids).toEqual(originalIds);
    expect(worker.carryingServiceItemId).toBe('old');
    expect(worker.carryingServiceItemIds).toEqual(['old']);
    expect(normalized).not.toBe(worker);
    expect(normalized.carryingServiceItemIds).not.toBe(ids);
  });

  it('returns a fresh normalised object while preserving canonical key order', () => {
    const worker = { carryingServiceItemIds: ['old'], role: 'waiter' };
    const first = withCarriedServiceItemIds(worker, ['a']);
    const second = withCarriedServiceItemIds(worker, ['a']);

    expect(Reflect.ownKeys(first)).toEqual(['carryingServiceItemIds', 'role']);
    expect(first).not.toBe(worker);
    expect(second).not.toBe(first);
    expect(first.carryingServiceItemIds).not.toBe(second.carryingServiceItemIds);
    expect(worker.carryingServiceItemIds).toEqual(['old']);
  });

  it('skips Set construction for empty ID lists and canonical empty inventories', () => {
    const NativeSet = globalThis.Set;
    let constructions = 0;
    vi.stubGlobal('Set', class CountingSet extends NativeSet {
      constructor(...args) {
        constructions += 1;
        super(...args);
      }
    });
    let normalised;
    let carried;
    try {
      normalised = withCarriedServiceItemIds({ carryingServiceItemId: null }, []);
      carried = getCarriedServiceItemIds({
        carryingServiceItemIds: [], carryingServiceItemId: 'legacy-item',
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(constructions).toBe(0);
    expect(normalised.carryingServiceItemIds).toEqual([]);
    expect(carried).toEqual([]);
    expect(carried).not.toBe(normalised.carryingServiceItemIds);
  });

  it('keeps the legacy fallback result fresh when no canonical array is present', () => {
    const worker = { carryingServiceItemId: 'legacy-item' };
    const first = getCarriedServiceItemIds(worker);
    const second = getCarriedServiceItemIds(worker);

    expect(first).toEqual(['legacy-item']);
    expect(first).not.toBe(second);
  });
});
