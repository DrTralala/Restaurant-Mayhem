import { describe, expect, it } from 'vitest';
import {
  PHYSICALLY_SEATED_CUSTOMER_STATES,
  isPhysicallySeatedCustomerState,
} from './customerSeating';
import { seatedStates } from './navigation/occupancy';

describe('physical seating classification', () => {
  it.each(['seated', 'ordering', 'waiting_for_items', 'waiting_for_party', 'eating'])(
    'recognises %s as physically seated', state => {
      expect(isPhysicallySeatedCustomerState(state)).toBe(true);
    },
  );

  it.each([
    'checkout_queued', 'checkout_moving', 'checkout_processing', 'paying',
    'leaving', 'queued', 'entering', 'unknown', undefined, null,
  ])('does not grant physical-seating status to %s', state => {
    expect(isPhysicallySeatedCustomerState(state)).toBe(false);
  });

  it('preserves the occupancy compatibility view and protects the canonical definition', () => {
    expect([...seatedStates]).toEqual([
      'seated', 'ordering', 'waiting_for_items', 'waiting_for_party', 'eating',
    ]);
    expect(Object.isFrozen(PHYSICALLY_SEATED_CUSTOMER_STATES)).toBe(true);
    expect(() => PHYSICALLY_SEATED_CUSTOMER_STATES.push('leaving')).toThrow();
    expect(isPhysicallySeatedCustomerState('leaving')).toBe(false);
  });
});
