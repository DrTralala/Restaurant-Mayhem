import { describe, it, expect, beforeEach } from 'vitest';
import { saveState, loadState, hydrateState } from './persistence';
import { createInitialState } from './initialState';

beforeEach(() => {
  localStorage.clear();
});

describe('saveState', () => {
  it('saves state to localStorage under correct key', () => {
    const state = { restaurant: { funds: 999 } };
    saveState(state);
    const stored = localStorage.getItem('restaurant-sim-save');
    expect(JSON.parse(stored)).toEqual(state);
  });
});

describe('loadState', () => {
  it('returns null when no save exists', () => {
    expect(loadState()).toBeNull();
  });

  it('returns parsed state when save exists', () => {
    const state = { restaurant: { funds: 500 } };
    localStorage.setItem('restaurant-sim-save', JSON.stringify(state));
    expect(loadState()).toEqual(state);
  });
});

describe('hydrateState', () => {
  it('fills fields added after an existing same-version save was created', () => {
    const fresh = {
      version: 4,
      restaurant: { funds: 500, totalServed: 0 },
      staff: [{ id: 'starter-cook' }],
      serviceTables: [{ id: 'st1' }],
      serviceItems: [],
    };
    const saved = {
      version: 4,
      restaurant: { funds: 999 },
      staff: [{ id: 'custom-cook' }],
    };

    expect(hydrateState(saved, fresh)).toEqual({
      version: 4,
      restaurant: { funds: 999, totalServed: 0 },
      staff: [{ id: 'custom-cook', gender: 'male' }],
      serviceTables: [{ id: 'st1' }],
      serviceItems: [],
      customers: [],
      queue: [],
    });
  });

  it('adds stable genders to characters from older saves', () => {
    const fresh = {
      version: 4,
      restaurant: { funds: 500 },
      staff: [], customers: [], queue: [],
    };
    const saved = {
      version: 4,
      restaurant: { funds: 900 },
      staff: [{ id: 's1', name: 'Sofia' }],
      customers: [{ id: 'c1' }],
      queue: [{ id: 'c2' }],
    };

    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.staff[0].gender).toBe('female');
    expect(['male', 'female']).toContain(hydrated.customers[0].gender);
    expect(['male', 'female']).toContain(hydrated.queue[0].gender);
    expect(hydrateState(saved, fresh)).toEqual(hydrated);
  });

  it('normalises equipment multipliers from saved levels', () => {
    const fresh = {
      version: 4,
      restaurant: { funds: 500 },
      staff: [], customers: [], queue: [],
      equipment: [
        { id: 'eq1', level: 1, speedMultiplier: 1, qualityBonus: 0, owned: true },
        { id: 'eq2', level: 1, speedMultiplier: 1, qualityBonus: 0, owned: false },
      ],
    };
    const saved = {
      version: 4,
      restaurant: { funds: 900 },
      equipment: [
        { id: 'eq1', level: 4, speedMultiplier: 0.85, qualityBonus: null, owned: true },
        { id: 'eq2', level: 'bad', owned: false },
      ],
    };

    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.version).toBe(4);
    expect(hydrated.equipment[0].level).toBe(4);
    expect(hydrated.equipment[0].speedMultiplier).toBeCloseTo(1.3);
    expect(hydrated.equipment[0].qualityBonus).toBeCloseTo(0.15);
    expect(hydrated.equipment[1]).toMatchObject({
      level: 1,
      speedMultiplier: 1,
      qualityBonus: 0,
    });
  });

  it('normalises version-4 dish prices while preserving valid dish data', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      version: 4,
      dishes: [
        { id: 'valid', name: 'Valid', price: 37, marker: 'preserved' },
        { id: 'rounded', name: 'Rounded', price: 37.6 },
        { id: 'low', name: 'Low', price: -20 },
        { id: 'high', name: 'High', price: 101 },
        { ...fresh.dishes[0], price: Number.POSITIVE_INFINITY },
        { id: 'nan', name: 'NaN', price: Number.NaN },
        { id: 'null', name: 'Null', price: null },
        { id: 'string', name: 'String', price: '12' },
      ],
    };

    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.version).toBe(4);
    expect(hydrated.dishes.map(dish => dish.price)).toEqual([37, 38, 1, 100, 12, 1, 1, 1]);
    expect(hydrated.dishes[0]).toMatchObject({ name: 'Valid', marker: 'preserved' });
  });

  it('hydrates staff capacity to the fresh default, current headcount, or larger saved capacity', () => {
    const fresh = createInitialState();
    const legacy = hydrateState({ ...fresh, staffSlots: 3 }, fresh);
    const crowdedStaff = [...fresh.staff, ...Array.from({ length: 3 }, (_, index) => ({
      id: `extra-${index}`,
      name: `Extra ${index}`,
    }))];
    const crowded = hydrateState({ ...fresh, staff: crowdedStaff, staffSlots: 3 }, fresh);
    const expanded = hydrateState({ ...fresh, staffSlots: 9 }, fresh);

    expect(legacy.staffSlots).toBe(6);
    expect(crowded.staffSlots).toBe(7);
    expect(expanded.staffSlots).toBe(9);
    expect(legacy.version).toBe(4);
  });
});
