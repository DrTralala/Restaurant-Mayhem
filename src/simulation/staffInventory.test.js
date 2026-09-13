import { describe, expect, it } from 'vitest';
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
});
