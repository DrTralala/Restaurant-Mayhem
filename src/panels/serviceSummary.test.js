import { afterEach, describe, expect, it, vi } from 'vitest';
import { getServiceSummary } from './serviceSummary';

const ZERO_PENDING = { ordered: 0, preparing: 0, ready: 0, on_service: 0, carried: 0 };

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function owner(overrides = {}) {
  return {
    id: 'customer-1',
    state: 'waiting',
    foodOutcome: null,
    cancelledServiceItemIds: [],
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    id: 'item-1',
    customerId: 'customer-1',
    kind: 'dish',
    state: 'ordered',
    ...overrides,
  };
}

function summaryOf({ customers = [], serviceItems = [], queue = [] } = {}) {
  return getServiceSummary({ queue, customers, serviceItems });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getServiceSummary', () => {
  it('returns zero counts for an empty state', () => {
    expect(getServiceSummary({})).toEqual({
      queueParties: 0, queueGuests: 0,
      pending: { ...ZERO_PENDING },
    });
  });

  it('treats absent queue, customer and service arrays as empty', () => {
    expect(getServiceSummary({ queue: undefined, customers: undefined, serviceItems: undefined }))
      .toEqual({ queueParties: 0, queueGuests: 0, pending: { ...ZERO_PENDING } });
  });

  it('counts queue parties and guests and filters pending items by owner outcome', () => {
    const state = {
      queue: [{ partyId: 'p', members: [{ id: 'a', partySize: 99 }, { id: 'b' }] }],
      queueSlots: [], queueDepartures: [{ id: 'departed' }],
      customers: [{ id: 7, state: 'waiting', foodOutcome: 'cancelled' }],
      serviceItems: [
        { id: 'food', customerId: '7', kind: 'dish', state: 'ready' },
        { id: 'drink', customerId: '7', kind: 'drink', state: 'on_service' },
      ],
    };
    expect(getServiceSummary(state)).toEqual({
      queueParties: 1, queueGuests: 2,
      pending: { ordered: 0, preparing: 0, ready: 0, on_service: 1, carried: 0 },
    });
  });

  it.each(['ordered', 'preparing', 'ready', 'on_service', 'carried'])(
    'counts a single %s item owned by an active customer',
    (state) => {
      const result = summaryOf({ customers: [owner()], serviceItems: [item({ state })] });
      expect(result).toEqual({
        queueParties: 0, queueGuests: 0,
        pending: { ...ZERO_PENDING, [state]: 1 },
      });
    },
  );

  it.each(['delivered', 'to_clean', 'dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing', 'unknown_state'])(
    'ignores a %s item',
    (state) => {
      expect(summaryOf({ customers: [owner()], serviceItems: [item({ state })] }))
        .toEqual({ queueParties: 0, queueGuests: 0, pending: { ...ZERO_PENDING } });
    },
  );

  it.each(['dish', 'drink'])('counts a pending %s item', (kind) => {
    expect(summaryOf({ customers: [owner()], serviceItems: [item({ kind })] }).pending.ordered).toBe(1);
  });

  it('ignores pending items whose kind is neither dish nor drink', () => {
    expect(summaryOf({ customers: [owner()], serviceItems: [item({ kind: 'napkin' })] }).pending)
      .toEqual({ ...ZERO_PENDING });
    expect(summaryOf({ customers: [owner()], serviceItems: [item({ kind: undefined })] }).pending)
      .toEqual({ ...ZERO_PENDING });
  });

  it('ignores items with a missing owner', () => {
    expect(summaryOf({ customers: [owner()], serviceItems: [item({ customerId: 'ghost' })] }).pending)
      .toEqual({ ...ZERO_PENDING });
    expect(summaryOf({ customers: [owner()], serviceItems: [item({ customerId: null })] }).pending)
      .toEqual({ ...ZERO_PENDING });
  });

  it('ignores items owned by a leaving customer but counts other owner states', () => {
    expect(summaryOf({ customers: [owner({ state: 'leaving' })], serviceItems: [item()] }).pending)
      .toEqual({ ...ZERO_PENDING });
    expect(summaryOf({ customers: [owner({ state: 'eating' })], serviceItems: [item({ state: 'ready' })] }).pending.ready)
      .toBe(1);
  });

  it.each([
    ['foodCancelled dish', { kind: 'dish', foodCancelled: true }],
    ['foodCancelled drink', { kind: 'drink', foodCancelled: true }],
    ['deliveryProhibited dish', { kind: 'dish', deliveryProhibited: true }],
    ['deliveryProhibited drink', { kind: 'drink', deliveryProhibited: true }],
  ])('ignores a %s item', (_name, overrides) => {
    expect(summaryOf({ customers: [owner()], serviceItems: [item(overrides)] }).pending)
      .toEqual({ ...ZERO_PENDING });
  });

  it.each([
    ['string item id matched by string cancelled id', 'item-9', ['item-9']],
    ['string item id matched by numeric cancelled id', '9', [9]],
    ['numeric item id matched by string cancelled id', 9, ['9']],
  ])('ignores an item with a %s', (_name, id, cancelledServiceItemIds) => {
    expect(summaryOf({
      customers: [owner({ cancelledServiceItemIds })],
      serviceItems: [item({ id })],
    }).pending).toEqual({ ...ZERO_PENDING });
  });

  it('keeps an item when cancelledServiceItemIds does not match it', () => {
    expect(summaryOf({
      customers: [owner({ cancelledServiceItemIds: ['other'] })],
      serviceItems: [item({ id: 'item-9' })],
    }).pending.ordered).toBe(1);
  });

  it('counts both active items of one owner', () => {
    const result = summaryOf({
      customers: [owner()],
      serviceItems: [
        item({ id: 'dish', kind: 'dish', state: 'preparing' }),
        item({ id: 'drink', kind: 'drink', state: 'ready' }),
      ],
    });
    expect(result.pending).toEqual({ ...ZERO_PENDING, preparing: 1, ready: 1 });
  });

  it('groups a legacy flat queue the same as a grouped queue', () => {
    const grouped = summaryOf({ queue: [{ partyId: 'p1', members: [{ id: 'a' }, { id: 'b' }] }] });
    const flat = summaryOf({ queue: [{ partyId: 'p1', id: 'a' }, { partyId: 'p1', id: 'b' }] });
    expect(flat).toEqual(grouped);
    expect(flat.queueParties).toBe(1);
    expect(flat.queueGuests).toBe(2);
  });

  it('does not count parties without members', () => {
    const result = summaryOf({
      queue: [
        { partyId: 'empty', members: [] },
        { partyId: 'p1', members: [{ id: 'a' }] },
      ],
    });
    expect(result.queueParties).toBe(1);
    expect(result.queueGuests).toBe(1);
  });

  it('does not mutate a recursively frozen input', () => {
    const state = freeze({
      queue: [{ partyId: 'p1', members: [{ id: 'a' }] }],
      customers: [owner({ cancelledServiceItemIds: ['item-2'] })],
      serviceItems: [
        item({ state: 'ready' }),
        item({ id: 'item-2', state: 'carried' }),
      ],
    });
    const snapshot = JSON.stringify(state);
    expect(getServiceSummary(state)).toEqual({
      queueParties: 1, queueGuests: 1,
      pending: { ...ZERO_PENDING, ready: 1 },
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('never calls Math.random', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called');
    });
    const result = summaryOf({ customers: [owner()], serviceItems: [item()] });
    expect(result.pending.ordered).toBe(1);
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
