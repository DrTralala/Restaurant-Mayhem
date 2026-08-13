import { describe, it, expect, beforeEach } from 'vitest';
import { saveState, loadState, hydrateState } from './persistence';

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
      version: 2,
      restaurant: { funds: 500, totalServed: 0 },
      staff: [{ id: 'starter-cook' }],
      serviceTables: [{ id: 'st1' }],
      foodItems: [],
    };
    const saved = {
      version: 2,
      restaurant: { funds: 999 },
      staff: [{ id: 'custom-cook' }],
    };

    expect(hydrateState(saved, fresh)).toEqual({
      version: 2,
      restaurant: { funds: 999, totalServed: 0 },
      staff: [{ id: 'custom-cook', gender: 'male' }],
      serviceTables: [{ id: 'st1' }],
      foodItems: [],
      customers: [],
      queue: [],
    });
  });

  it('adds stable genders to characters from older saves', () => {
    const fresh = {
      version: 2,
      restaurant: { funds: 500 },
      staff: [], customers: [], queue: [],
    };
    const saved = {
      version: 2,
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
});
