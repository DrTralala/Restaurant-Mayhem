import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFoodDeadlineSummary } from './foodDeadlineSummary';

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
