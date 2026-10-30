import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFoodDeadlineSummary, getFoodServiceTriage } from './foodDeadlineSummary';

function customer(overrides = {}) {
  return {
    id: 'c1',
    foodOutcome: null,
    foodDeadlineAt: 120,
    foodPatienceBudget: 30,
    ...overrides,
  };
}

function stateWith(customers, gameTime = 100) {
  return { restaurant: { gameTime }, customers };
}

function dishItem(id, customerId, menuItemId, state = 'ordered', overrides = {}) {
  return { id, customerId, kind: 'dish', menuItemId, state, ...overrides };
}

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

describe('getFoodDeadlineSummary', () => {
  it('counts a nullish outcome with a valid timer as a legacy pending candidate', () => {
    const summary = getFoodDeadlineSummary(stateWith([
      customer({ id: 'legacy', foodOutcome: null, foodDeadlineAt: 140 }),
    ]));

    expect(summary).toEqual({
      pendingCount: 1,
      knownCount: 1,
      unknownCount: 0,
      deadlineAt: 140,
      remainingSeconds: 40,
      target: { customerId: 'legacy', dishId: null, tableId: null },
    });
  });

  it('excludes delivered, cancelled and unexpected outcomes even with valid timers', () => {
    const summary = getFoodDeadlineSummary(stateWith([
      customer({ id: 'delivered', foodOutcome: 'delivered', foodDeadlineAt: 110 }),
      customer({ id: 'cancelled', foodOutcome: 'cancelled', foodDeadlineAt: 115 }),
      customer({ id: 'unexpected', foodOutcome: 'mystery', foodDeadlineAt: 120 }),
    ]));

    expect(summary).toEqual({
      pendingCount: 0,
      knownCount: 0,
      unknownCount: 0,
      deadlineAt: null,
      remainingSeconds: null,
      target: null,
    });
  });

  it('keeps known and unknown explicit pending candidates separate and takes the minimum deadline', () => {
    const summary = getFoodDeadlineSummary(stateWith([
      customer({
        id: 'explicit-known', foodOutcome: 'pending', foodDeadlineAt: 160, foodPatienceBudget: 30,
      }),
      customer({
        id: 'legacy-known', foodOutcome: null, foodDeadlineAt: 140, foodPatienceBudget: 20,
      }),
      customer({
        id: 'missing-timer', foodOutcome: 'pending', foodDeadlineAt: null, foodPatienceBudget: null,
      }),
      customer({
        id: 'zero-budget', foodOutcome: 'pending', foodDeadlineAt: 120, foodPatienceBudget: 0,
      }),
      customer({
        id: 'nonfinite-deadline',
        foodOutcome: 'pending',
        foodDeadlineAt: Number.POSITIVE_INFINITY,
        foodPatienceBudget: 30,
      }),
      customer({
        id: 'legacy-invalid', foodOutcome: null, foodDeadlineAt: null, foodPatienceBudget: null,
      }),
    ]));

    expect(summary).toEqual({
      pendingCount: 5,
      knownCount: 2,
      unknownCount: 3,
      deadlineAt: 140,
      remainingSeconds: 40,
      target: { customerId: 'legacy-known', dishId: null, tableId: null },
    });
  });

  it('does not select a target when pending customers have only unknown timers', () => {
    const summary = getFoodDeadlineSummary(stateWith([
      customer({
        id: 'unknown', dishId: 'dish', tableId: 'table', foodOutcome: 'pending',
        foodDeadlineAt: null, foodPatienceBudget: null,
      }),
    ]));

    expect(summary).toEqual({
      pendingCount: 1,
      knownCount: 0,
      unknownCount: 1,
      deadlineAt: null,
      remainingSeconds: null,
      target: null,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'keeps the known deadline but reports no remaining seconds for invalid now (%s)',
    (now) => {
      const summary = getFoodDeadlineSummary(stateWith([
        customer({ id: 'known', foodOutcome: 'pending', foodDeadlineAt: 120 }),
      ]), now);

      expect(summary).toEqual({
        pendingCount: 1,
        knownCount: 1,
        unknownCount: 0,
        deadlineAt: 120,
        remainingSeconds: null,
        target: { customerId: 'known', dishId: null, tableId: null },
      });
    },
  );

  it('clamps an exact deadline and an overdue deadline to zero while retaining the deadline', () => {
    const customers = [
      customer({ id: 'known', foodOutcome: 'pending', foodDeadlineAt: 120 }),
    ];

    expect(getFoodDeadlineSummary(stateWith(customers, 120))).toEqual({
      pendingCount: 1,
      knownCount: 1,
      unknownCount: 0,
      deadlineAt: 120,
      remainingSeconds: 0,
      target: { customerId: 'known', dishId: null, tableId: null },
    });
    expect(getFoodDeadlineSummary(stateWith(customers, 200))).toEqual({
      pendingCount: 1,
      knownCount: 1,
      unknownCount: 0,
      deadlineAt: 120,
      remainingSeconds: 0,
      target: { customerId: 'known', dishId: null, tableId: null },
    });
  });

  it('returns an empty summary without customers and ignores a malformed customer list', () => {
    const expected = {
      pendingCount: 0,
      knownCount: 0,
      unknownCount: 0,
      deadlineAt: null,
      remainingSeconds: null,
      target: null,
    };

    expect(getFoodDeadlineSummary(stateWith([]))).toEqual(expected);
    expect(getFoodDeadlineSummary({ restaurant: { gameTime: 100 }, customers: null }))
      .toEqual(expected);
    expect(getFoodDeadlineSummary({})).toEqual(expected);
  });

  it('does not mutate a deeply frozen state and does not use randomness', () => {
    const state = freeze(stateWith([
      customer({ id: 'known', foodOutcome: 'pending', foodDeadlineAt: 160 }),
      customer({
        id: 'unknown', foodOutcome: 'pending', foodDeadlineAt: null, foodPatienceBudget: null,
      }),
    ]));
    const snapshot = JSON.stringify(state);
    const random = vi.spyOn(Math, 'random');

    const summary = getFoodDeadlineSummary(state);

    expect(summary).toEqual({
      pendingCount: 2,
      knownCount: 1,
      unknownCount: 1,
      deadlineAt: 160,
      remainingSeconds: 60,
      target: { customerId: 'known', dishId: null, tableId: null },
    });
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(state.customers.map(entry => entry.id)).toEqual(['known', 'unknown']);
    expect(random).not.toHaveBeenCalled();
  });

  it('copies recorded customer order identity for the earliest known food target', () => {
    const state = { restaurant: { gameTime: 100 }, customers: [
      {
        id: 'guest', dishId: 'dish', tableId: 'table', foodOutcome: 'pending',
        foodDeadlineAt: 120, foodPatienceBudget: 30,
      },
    ] };

    expect(getFoodDeadlineSummary(state).target).toEqual({
      customerId: 'guest', dishId: 'dish', tableId: 'table',
    });
  });

  it('keeps the first input target when known deadlines tie', () => {
    const summary = getFoodDeadlineSummary(stateWith([
      customer({ id: 'first', dishId: 'first-dish', tableId: 'first-table', foodOutcome: 'pending' }),
      customer({ id: 'second', dishId: 'second-dish', tableId: 'second-table', foodOutcome: 'pending' }),
    ]));

    expect(summary.target).toEqual({
      customerId: 'first', dishId: 'first-dish', tableId: 'first-table',
    });
  });

  it('sanitises missing and malformed identity values while retaining finite numeric IDs', () => {
    const missing = getFoodDeadlineSummary(stateWith([
      customer({ id: undefined, dishId: {}, tableId: Number.NaN, foodOutcome: 'pending' }),
    ]));
    const numeric = getFoodDeadlineSummary(stateWith([
      customer({ id: 42, dishId: 17, tableId: 5.5, foodOutcome: 'pending' }),
    ]));

    expect(missing.target).toEqual({ customerId: null, dishId: null, tableId: null });
    expect(numeric.target).toEqual({ customerId: 42, dishId: 17, tableId: 5.5 });
  });

  it('rejects blank identity strings but preserves nonblank strings and finite numeric zero', () => {
    const summary = getFoodDeadlineSummary(stateWith([
      customer({
        id: ' \t ', dishId: '  custom dish  ', tableId: 0, foodOutcome: 'pending',
      }),
    ]));

    expect(summary.target).toEqual({
      customerId: null, dishId: '  custom dish  ', tableId: 0,
    });
  });
});

describe('getFoodServiceTriage', () => {
  it('orders valid timers before unknown timers and derives the matching dish stages', () => {
    const state = {
      ...stateWith([
        customer({ id: 'later', dishId: 'later-dish', tableId: 'later-table',
          foodOutcome: 'pending', foodDeadlineAt: 150 }),
        customer({ id: 'earlier', dishId: 'earlier-dish', tableId: 'earlier-table',
          foodOutcome: 'pending', foodDeadlineAt: 110 }),
        customer({ id: 'unknown', dishId: 'unknown-dish', tableId: 'unknown-table',
          foodOutcome: 'pending', foodDeadlineAt: null, foodPatienceBudget: null }),
      ]),
      serviceItems: [
        dishItem('later-item', 'later', 'later-dish', 'carried'),
        dishItem('earlier-item', 'earlier', 'earlier-dish', 'ordered'),
      ],
    };

    const result = getFoodServiceTriage(state);

    expect(result.orders.map(order => order.customerId)).toEqual(['earlier', 'later', 'unknown']);
    expect(result.orders[0].stage).toBe('ordered');
    expect(result.orders[1].stage).toBe('carried');
    expect(result.orders[2]).toEqual({
      customerId: 'unknown', dishId: 'unknown-dish', tableId: 'unknown-table',
      deadlineAt: null, remainingSeconds: null, stage: null,
    });
    expect(result.omittedCount).toBe(0);
  });

  it('sorts overdue deadlines by their actual time and keeps equal deadlines stable', () => {
    const result = getFoodServiceTriage(stateWith([
      customer({ id: 'tie-first', foodOutcome: 'pending', foodDeadlineAt: 80 }),
      customer({ id: 'overdue', foodOutcome: 'pending', foodDeadlineAt: 70 }),
      customer({ id: 'tie-second', foodOutcome: 'pending', foodDeadlineAt: 80 }),
      customer({ id: 'unknown', foodOutcome: 'pending', foodDeadlineAt: null,
        foodPatienceBudget: null }),
    ], 100));

    expect(result.orders.map(order => order.customerId))
      .toEqual(['overdue', 'tie-first', 'tie-second', 'unknown']);
    expect(result.orders.slice(0, 3).map(order => order.remainingSeconds)).toEqual([0, 0, 0]);
  });

  it('caps the list at five and reports the number omitted', () => {
    const result = getFoodServiceTriage(stateWith(Array.from({ length: 7 }, (_, index) =>
      customer({ id: `guest-${index + 1}`, foodOutcome: 'pending',
        foodDeadlineAt: 110 + index })), 100));

    expect(result.orders.map(order => order.customerId))
      .toEqual(['guest-1', 'guest-2', 'guest-3', 'guest-4', 'guest-5']);
    expect(result.omittedCount).toBe(2);
  });

  it('retains valid legacy timers, explicit unknown timers, and no timers for invalid legacy records', () => {
    const result = getFoodServiceTriage(stateWith([
      customer({ id: 'legacy', foodOutcome: null, foodDeadlineAt: 140 }),
      customer({ id: 'unknown', foodOutcome: 'pending', foodDeadlineAt: null,
        foodPatienceBudget: null }),
      customer({ id: 'invalid-legacy', foodOutcome: null, foodDeadlineAt: null,
        foodPatienceBudget: null }),
    ]));

    expect(result.orders.map(order => order.customerId)).toEqual(['legacy', 'unknown']);
    expect(result.orders[0].deadlineAt).toBe(140);
    expect(result.orders[1].deadlineAt).toBeNull();
  });

  it('retains known deadlines but withholds remaining time when the game clock is unknown', () => {
    const result = getFoodServiceTriage(stateWith([
      customer({ id: 'known', foodOutcome: 'pending', foodDeadlineAt: 140 }),
    ], Number.NaN));

    expect(result.orders[0]).toMatchObject({
      deadlineAt: 140, remainingSeconds: null,
    });
  });

  it('excludes cancelled and delivered outcomes while preserving pending candidates', () => {
    const result = getFoodServiceTriage(stateWith([
      customer({ id: 'pending', foodOutcome: 'pending' }),
      customer({ id: 'legacy', foodOutcome: null }),
      customer({ id: 'cancelled', foodOutcome: 'cancelled' }),
      customer({ id: 'delivered', foodOutcome: 'delivered' }),
    ]));

    expect(result.orders.map(order => order.customerId)).toEqual(['pending', 'legacy']);
  });

  it('uses the pinned dish service item even when another owned dish also matches', () => {
    const state = {
      ...stateWith([customer({
        id: 'guest', dishId: 'toast', foodOutcome: 'pending',
        dishOrderSnapshot: { serviceItemId: 'pinned', menuItemId: 'toast' },
      })]),
      serviceItems: [
        dishItem('legacy-match', 'guest', 'toast', 'carried'),
        dishItem('pinned', 'guest', 'toast', 'preparing'),
      ],
    };

    expect(getFoodServiceTriage(state).orders[0].stage).toBe('preparing');
  });

  it('does not fall back to another dish when a pinned item is missing or not owned', () => {
    const customerWithPin = customer({
      id: 'guest', dishId: 'toast', foodOutcome: 'pending',
      dishOrderSnapshot: { serviceItemId: 'pinned', menuItemId: 'toast' },
    });
    const fallback = dishItem('legacy-match', 'guest', 'toast', 'carried');

    expect(getFoodServiceTriage({
      ...stateWith([customerWithPin]), serviceItems: [fallback],
    }).orders[0].stage).toBeNull();
    expect(getFoodServiceTriage({
      ...stateWith([customerWithPin]),
      serviceItems: [dishItem('pinned', 'other-guest', 'toast', 'ready'), fallback],
    }).orders[0].stage).toBeNull();
  });

  it('rejects contradictory pinned and copied snapshots instead of guessing another match', () => {
    const state = {
      ...stateWith([customer({
        id: 'guest', dishId: 'toast', foodOutcome: 'pending',
        dishOrderSnapshot: { serviceItemId: 'pinned', menuItemId: 'toast' },
      })]),
      serviceItems: [
        dishItem('pinned', 'guest', 'other-dish', 'ready', {
          dishOrderSnapshot: { serviceItemId: 'different-item', menuItemId: 'other-dish' },
        }),
        dishItem('legacy-match', 'guest', 'toast', 'carried'),
      ],
    };

    expect(getFoodServiceTriage(state).orders[0].stage).toBeNull();
  });

  it('uses only a unique matching owned legacy dish and ignores owned drinks', () => {
    const state = {
      ...stateWith([customer({ id: 'guest', dishId: 'toast', foodOutcome: 'pending' })]),
      serviceItems: [
        dishItem('unique-dish', 'guest', 'toast', 'ready'),
        dishItem('other-dish', 'guest', 'soup', 'ordered'),
        { id: 'drink', customerId: 'guest', kind: 'drink', menuItemId: 'toast', state: 'carried' },
      ],
    };

    expect(getFoodServiceTriage(state).orders[0].stage).toBe('ready');
  });

  it('withholds stages for ambiguous owner identities and duplicate dish matches', () => {
    const ambiguousOwners = getFoodServiceTriage({
      ...stateWith([
        customer({ id: 1, dishId: 'toast', foodOutcome: 'pending' }),
        customer({ id: '1', dishId: 'toast', foodOutcome: 'pending' }),
      ]),
      serviceItems: [
        dishItem('one', 1, 'toast', 'ordered'),
        dishItem('two', '1', 'toast', 'carried'),
      ],
    });
    const duplicateMatches = getFoodServiceTriage({
      ...stateWith([customer({ id: 'guest', dishId: 'toast', foodOutcome: 'pending' })]),
      serviceItems: [
        dishItem('one', 'guest', 'toast', 'ordered'),
        dishItem('two', 'guest', 'toast', 'carried'),
      ],
    });

    expect(ambiguousOwners.orders.map(order => order.stage)).toEqual([null, null]);
    expect(duplicateMatches.orders[0].stage).toBeNull();
  });

  it.each([
    ['food-cancelled', { foodCancelled: true }, {}],
    ['delivery-prohibited', { deliveryProhibited: true }, {}],
    ['cancelled by owner', {}, { cancelledServiceItemIds: ['item'] }],
    ['leaving owner', {}, { state: 'leaving' }],
    ['delivered state', { state: 'delivered' }, {}],
    ['cleanup state', { state: 'to_clean' }, {}],
    ['drink kind', { kind: 'drink' }, {}],
  ])('does not infer a %s service item stage', (_case, itemOverrides, ownerOverrides) => {
    const state = {
      ...stateWith([customer({
        id: 'guest', dishId: 'toast', foodOutcome: 'pending', ...ownerOverrides,
      })]),
      serviceItems: [dishItem('item', 'guest', 'toast', 'ordered', itemOverrides)],
    };

    expect(getFoodServiceTriage(state).orders[0].stage).toBeNull();
  });

  it('sanitises unavailable identities and leaves deeply frozen inputs unchanged', () => {
    const state = freeze({
      ...stateWith([customer({
        id: '  ', dishId: Number.NaN, tableId: {}, foodOutcome: 'pending',
      })]),
      serviceItems: Object.freeze([]),
    });
    const snapshot = JSON.stringify(state);
    const random = vi.spyOn(Math, 'random');

    expect(getFoodServiceTriage(state).orders[0]).toEqual({
      customerId: null, dishId: null, tableId: null,
      deadlineAt: 120, remainingSeconds: 20, stage: null,
    });
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(random).not.toHaveBeenCalled();
  });
});
