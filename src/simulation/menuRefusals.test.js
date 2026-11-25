import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { getMenuRefusal, normaliseMenuRefusals, recordMenuRefusal } from './menuRefusals';

const DAY = 3;

const state = (overrides = {}) => ({
  restaurant: { day: DAY, gameTime: (DAY - 1) * 86400 + 10 },
  dishes: [{ id: 'starter-toast' }, { id: 'custom-menuId' }],
  ...overrides,
});

const branch = (overrides = {}) => ({ day: DAY, dishes: [], ...overrides });

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('menu refusals', () => {
  it('records only live dishes, counting each guest and keeping the latest declined price', () => {
    const first = recordMenuRefusal(freeze(state()), { dishId: 'starter-toast', price: 18 });
    const current = freeze({ ...state(), menuRefusals: first });
    const second = recordMenuRefusal(current, {
      dishId: 'starter-toast', price: 23,
    });

    expect(second).toEqual({
      day: DAY,
      dishes: [{ key: 'starter-toast', count: 2, lastPrice: 23 }],
    });
    expect(first).toEqual({ day: DAY, dishes: [{ key: 'starter-toast', count: 1, lastPrice: 18 }] });
    expect(recordMenuRefusal(state(), { dishId: 'removed-dish', price: 18 })).toEqual(branch());
  });

  it('normalises current-day records to unique live dishes with bounded counts and prices', () => {
    expect(normaliseMenuRefusals({
      day: DAY,
      dishes: [
        { key: 'starter-toast', count: 2, lastPrice: 17 },
        { key: 'custom-menuId', count: Number.MAX_SAFE_INTEGER, lastPrice: 100 },
        { key: 'removed-dish', count: 4, lastPrice: 12 },
        { key: 'starter-toast', count: 40, lastPrice: 99 },
        { key: 'custom-menuId', count: Number.MAX_SAFE_INTEGER + 1, lastPrice: 12 },
        { key: 'custom-menuId', count: 1, lastPrice: 0 },
        { key: 'custom-menuId', count: 1.5, lastPrice: 12 },
        { key: '__proto__', count: 1, lastPrice: 12 },
      ],
    }, state())).toEqual({
      day: DAY,
      dishes: [
        { key: 'starter-toast', count: 2, lastPrice: 17 },
        { key: 'custom-menuId', count: Number.MAX_SAFE_INTEGER, lastPrice: 100 },
      ],
    });
  });

  it('starts a fresh branch for stale data and follows paid sales day fallback semantics', () => {
    expect(normaliseMenuRefusals(branch({
      day: DAY - 1,
      dishes: [{ key: 'starter-toast', count: 4, lastPrice: 15 }],
    }), state())).toEqual(branch());
    expect(normaliseMenuRefusals({
      day: DAY + 1,
      dishes: [{ key: 'starter-toast', count: 1, lastPrice: 15 }],
    }, state({ restaurant: { day: 0, gameTime: DAY * 86400 } }))).toEqual({
      day: DAY + 1,
      dishes: [{ key: 'starter-toast', count: 1, lastPrice: 15 }],
    });
    expect(normaliseMenuRefusals(branch({
      dishes: [{ key: 'starter-toast', count: 1, lastPrice: 15 }],
    }), state({ restaurant: { day: DAY + 2, gameTime: 0 } })).day).toBe(DAY + 2);
  });

  it('saturates safe counts, ignores invalid events and returns null for absent or stale records', () => {
    const saturated = recordMenuRefusal(state({ menuRefusals: branch({ dishes: [
      { key: 'starter-toast', count: Number.MAX_SAFE_INTEGER, lastPrice: 14 },
    ] }) }), { dishId: 'starter-toast', price: 25 });
    expect(saturated.dishes).toEqual([
      { key: 'starter-toast', count: Number.MAX_SAFE_INTEGER, lastPrice: 25 },
    ]);
    for (const event of [
      { dishId: 'starter-toast', price: 0 },
      { dishId: 'starter-toast', price: 101 },
      { dishId: 'starter-toast', price: Number.NaN },
      { dishId: 'removed-dish', price: 12 },
    ]) expect(recordMenuRefusal(state(), event)).toEqual(branch());

    expect(getMenuRefusal({ ...state(), menuRefusals: saturated }, 'starter-toast'))
      .toEqual({ key: 'starter-toast', count: Number.MAX_SAFE_INTEGER, lastPrice: 25 });
    expect(getMenuRefusal(state(), 'starter-toast')).toBeNull();
    expect(getMenuRefusal({ ...state(), menuRefusals: saturated }, 'removed-dish')).toBeNull();
    expect(getMenuRefusal({
      ...state({ restaurant: { day: DAY + 1, gameTime: DAY * 86400 + 10 } }),
      menuRefusals: saturated,
    }, 'starter-toast')).toBeNull();
  });

  it('starts a sandbox with an empty current-day refusal branch', () => {
    const fresh = createInitialState();
    expect(fresh.menuRefusals).toEqual({ day: fresh.restaurant.day, dishes: [] });
  });
});
