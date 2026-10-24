import { describe, expect, it } from 'vitest';
import { getMenuSalesCount, normaliseMenuSales, recordMenuSales } from './menuSales';

const DAY = 3;

const state = (overrides = {}) => ({
  restaurant: { day: DAY, gameTime: DAY * 86400 - 1 },
  dishes: [{ id: 'starter-toast' }, { id: 'custom-menuId' }, { id: 'shared' }],
  ...overrides,
});

const branch = (overrides = {}) => ({
  day: DAY, dishes: [], drinks: [], ...overrides,
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('normaliseMenuSales', () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'sales'],
    ['a missing day', { dishes: [{ key: 'starter-toast', count: 4 }], drinks: [] }],
    ['a malformed day', { day: '3', dishes: [{ key: 'starter-toast', count: 4 }], drinks: [] }],
    ['a stale day', { day: 2, dishes: [{ key: 'starter-toast', count: 4 }], drinks: [] }],
  ])('returns an empty current-day branch for %s telemetry', (_label, value) => {
    expect(normaliseMenuSales(value, state())).toEqual({ day: DAY, dishes: [], drinks: [] });
  });

  it('keeps current dishes and canonical drinks with safe distinct counts only', () => {
    const malformedPrototype = Object.create({ key: 'starter-toast', count: 99 });
    const value = {
      day: DAY,
      dishes: [
        { key: 'starter-toast', count: 2 },
        { key: 'custom-menuId', count: 0 },
        { key: 'shared', count: 4 },
        { key: 'removed-dish', count: 9 },
        { key: 'starter-toast', count: 50 },
        { key: 'starter-toast', count: -1 },
        { key: 'starter-toast', count: 1.5 },
        { key: 'starter-toast', count: Number.MAX_SAFE_INTEGER + 1 },
        { key: null, count: 1 },
        { key: '', count: 1 },
        { count: 3 },
        { key: 'starter-toast' },
        null,
        'record',
        malformedPrototype,
      ],
      drinks: [
        { key: 'water', count: 3 },
        { key: 'iced-tea', count: 1 },
        { key: 'boba', count: 9 },
        { key: 'water', count: 7 },
        { key: 'water', count: Number.NaN },
        { key: '__proto__', count: 5 },
      ],
    };

    expect(normaliseMenuSales(value, state())).toEqual({
      day: DAY,
      dishes: [
        { key: 'starter-toast', count: 2 },
        { key: 'custom-menuId', count: 0 },
        { key: 'shared', count: 4 },
      ],
      drinks: [
        { key: 'water', count: 3 },
        { key: 'iced-tea', count: 1 },
      ],
    });
  });

  it('does not mutate its inputs and returns fresh branch records', () => {
    const input = freeze({
      day: DAY,
      dishes: [{ key: 'starter-toast', count: 1 }],
      drinks: [{ key: 'water', count: 2 }],
    });
    const context = freeze(state());

    const result = normaliseMenuSales(input, context);

    expect(result).toEqual({
      day: DAY,
      dishes: [{ key: 'starter-toast', count: 1 }],
      drinks: [{ key: 'water', count: 2 }],
    });
    expect(result).not.toBe(input);
    expect(result.dishes).not.toBe(input.dishes);
    expect(result.drinks).not.toBe(input.drinks);
    expect(input.dishes[0]).toEqual({ key: 'starter-toast', count: 1 });
  });

  it('round-trips a current custom dish ID ending in Id without treating it as a field', () => {
    const input = { day: DAY, dishes: [{ key: 'custom-menuId', count: 2 }], drinks: [] };

    const normalised = normaliseMenuSales(JSON.parse(JSON.stringify(input)), state());

    expect(normalised).toEqual(input);
    expect(getMenuSalesCount({ ...state(), menuSales: normalised }, 'dish', 'custom-menuId'))
      .toBe(2);
  });
});

describe('recordMenuSales', () => {
  it('increments positive dish and drink lines in the normalised current branch', () => {
    const current = freeze(branch({
      dishes: [{ key: 'starter-toast', count: 1 }],
      drinks: [{ key: 'water', count: 2 }],
    }));
    const context = freeze({ ...state(), menuSales: current });

    const result = recordMenuSales(context, {
      dishId: 'starter-toast', dishAmount: 12,
      drinkId: 'water', drinkAmount: 5,
    });

    expect(result).toEqual({
      day: DAY,
      dishes: [{ key: 'starter-toast', count: 2 }],
      drinks: [{ key: 'water', count: 3 }],
    });
    expect(current).toEqual({
      day: DAY,
      dishes: [{ key: 'starter-toast', count: 1 }],
      drinks: [{ key: 'water', count: 2 }],
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined])(
    'does not count non-positive or malformed amount %s',
    amount => {
      const result = recordMenuSales(state(), {
        dishId: 'starter-toast', dishAmount: amount,
        drinkId: 'water', drinkAmount: amount,
      });

      expect(result).toEqual({ day: DAY, dishes: [], drinks: [] });
    },
  );

  it('ignores removed, unknown and prototype-like IDs without reading inherited data', () => {
    const result = recordMenuSales(state(), {
      dishId: 'removed-dish', dishAmount: 12,
      drinkId: 'boba', drinkAmount: 5,
    });
    expect(result).toEqual({ day: DAY, dishes: [], drinks: [] });

    expect(recordMenuSales(state(), {
      dishId: 'constructor', dishAmount: 12,
      drinkId: '__proto__', drinkAmount: 5,
    })).toEqual({ day: DAY, dishes: [], drinks: [] });
  });

  it('tracks the same textual ID independently as a dish and a canonical drink', () => {
    const context = {
      ...state({ dishes: [{ id: 'water' }] }),
      menuSales: branch(),
    };

    const result = recordMenuSales(context, {
      dishId: 'water', dishAmount: 4,
      drinkId: 'water', drinkAmount: 2,
    });

    expect(result).toEqual({
      day: DAY,
      dishes: [{ key: 'water', count: 1 }],
      drinks: [{ key: 'water', count: 1 }],
    });
  });

  it('saturates an existing safe count at the maximum instead of overflowing', () => {
    const context = {
      ...state(),
      menuSales: branch({
        dishes: [{ key: 'starter-toast', count: Number.MAX_SAFE_INTEGER }],
      }),
    };

    expect(recordMenuSales(context, {
      dishId: 'starter-toast', dishAmount: 12,
    }).dishes).toEqual([{ key: 'starter-toast', count: Number.MAX_SAFE_INTEGER }]);
  });

  it('starts from a fresh current-day branch when saved telemetry is stale', () => {
    const context = {
      ...state({ restaurant: { day: 4, gameTime: 4 * 86400 } }),
      menuSales: branch({
        day: 3,
        dishes: [{ key: 'starter-toast', count: 9 }],
        drinks: [{ key: 'water', count: 4 }],
      }),
    };

    expect(recordMenuSales(context, {
      dishId: 'starter-toast', dishAmount: 12,
    })).toEqual({
      day: 4,
      dishes: [{ key: 'starter-toast', count: 1 }],
      drinks: [],
    });
  });
});

describe('getMenuSalesCount', () => {
  const counted = (overrides = {}) => ({
    ...state(overrides),
    menuSales: branch({
      dishes: [{ key: 'starter-toast', count: 3 }],
      drinks: [{ key: 'water', count: 2 }],
    }),
  });

  it('returns current-day counts and zero for every other case', () => {
    const context = counted();
    expect(getMenuSalesCount(context, 'dish', 'starter-toast')).toBe(3);
    expect(getMenuSalesCount(context, 'drink', 'water')).toBe(2);
    expect(getMenuSalesCount(context, 'side', 'starter-toast')).toBe(0);
    expect(getMenuSalesCount(context, 'dish', 'water')).toBe(0);
    expect(getMenuSalesCount(context, 'drink', 'starter-toast')).toBe(0);
    expect(getMenuSalesCount(context, 'dish', 'constructor')).toBe(0);
    expect(getMenuSalesCount(context, 'drink', '__proto__')).toBe(0);
    expect(getMenuSalesCount(context, 'dish', null)).toBe(0);

    expect(getMenuSalesCount({
      ...context,
      restaurant: { ...context.restaurant, day: 4 },
    }, 'dish', 'starter-toast')).toBe(0);
    expect(getMenuSalesCount({ ...state() }, 'dish', 'starter-toast')).toBe(0);
    expect(getMenuSalesCount({
      ...context,
      menuSales: { day: DAY, dishes: 'bad', drinks: [] },
    }, 'dish', 'starter-toast')).toBe(0);
  });
});
