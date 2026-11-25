import { describe, expect, it } from 'vitest';
import { getRushableDish } from './dishRush';

function customer(overrides = {}) {
  return {
    id: 'guest', dishId: 'toast', foodOutcome: 'pending',
    foodDeadlineAt: 200, foodPatienceBudget: 30,
    ...overrides,
  };
}

function dishItem(overrides = {}) {
  return {
    id: 'ticket-41', customerId: 'guest', kind: 'dish', menuItemId: 'toast',
    state: 'ordered', ...overrides,
  };
}

describe('getRushableDish', () => {
  it('returns the unique eligible ordered dish ticket, not its menu item', () => {
    const ticket = dishItem();
    const state = { customers: [customer()], serviceItems: [ticket] };

    expect(getRushableDish(state, 'ticket-41')).toBe(ticket);
  });

  it.each([
    ['an assigned ticket', { serviceItems: [dishItem({ assignedStaffId: 'cook' })] }],
    ['an item marked for a batch', { serviceItems: [dishItem({ batchId: 'batch-1' })] }],
    ['a member of an active batch', {
      serviceItems: [dishItem()],
      cookingBatches: [{ id: 'batch-1', serviceItemIds: ['ticket-41'], status: 'reserved' }],
    }],
    ['a ticket in the primary staff task slot', {
      serviceItems: [dishItem()],
      staff: [{ id: 'cook', task: { type: 'prepare_dish', serviceItemId: 'ticket-41' } }],
    }],
    ['a ticket in staff task batch members', {
      serviceItems: [dishItem()],
      staff: [{ id: 'cook', task: { type: 'prepare_dish', serviceItemIds: ['ticket-41'] } }],
    }],
  ])('returns null for %s', (_label, overrides) => {
    expect(getRushableDish({ customers: [customer()], ...overrides }, 'ticket-41')).toBeNull();
  });

  it.each([
    ['a drink', { serviceItems: [{ ...dishItem(), kind: 'drink' }] }],
    ['a stale owner', { serviceItems: [dishItem({ customerId: 'missing' })] }],
    ['a duplicate ticket ID', {
      serviceItems: [dishItem(), dishItem({ customerId: 'another' })],
    }],
    ['ambiguous legacy dish matches', {
      serviceItems: [dishItem(), dishItem({ id: 'ticket-42' })],
    }],
    ['an already claimed ticket', {
      serviceItems: [dishItem()], __staffClaimedServiceItemIds: ['ticket-41'],
    }],
  ])('returns null for %s', (_label, overrides) => {
    const state = {
      customers: [customer(), ...(overrides.serviceItems.some(item => item.customerId === 'another')
        ? [customer({ id: 'another' })] : [])],
      serviceItems: overrides.serviceItems,
      ...(overrides.__staffClaimedServiceItemIds
        ? { __staffClaimedServiceItemIds: overrides.__staffClaimedServiceItemIds }
        : {}),
    };

    expect(getRushableDish(state, 'ticket-41')).toBeNull();
  });

  it('returns null when the order is no longer pending or is no longer ordered', () => {
    const ticket = dishItem();

    expect(getRushableDish({ customers: [customer({ foodOutcome: 'cancelled' })],
      serviceItems: [ticket] }, 'ticket-41')).toBeNull();
    expect(getRushableDish({ customers: [customer()],
      serviceItems: [dishItem({ state: 'preparing' })] }, 'ticket-41')).toBeNull();
  });
});
