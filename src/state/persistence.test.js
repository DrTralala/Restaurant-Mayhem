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
  it('hydrates missing, malformed, and legacy operating hours safely', () => {
    const fresh = createInitialState();
    const missing = hydrateState({ ...fresh, restaurant: { funds: 900 } }, fresh);
    const malformed = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 10.25, closeHour: '22' },
    }, fresh);
    const legacy = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, openHour: 0, closeHour: 24 },
    }, fresh);

    expect(missing.restaurant).toMatchObject({ openHour: 10, closeHour: 22 });
    expect(malformed.restaurant).toMatchObject({ openHour: 10, closeHour: 22 });
    expect(legacy.restaurant).toMatchObject({ openHour: 0, closeHour: 0 });
  });

  it('fills fields added after an existing same-version save was created', () => {
    const fresh = {
      version: 4,
      restaurant: { funds: 500, totalServed: 0 },
      staff: [{ id: 'starter-cook' }],
      serviceTables: [{ id: 'st1' }],
      serviceItems: [],
      floorDirt: [],
      washStations: [],
    };
    const saved = {
      version: 4,
      restaurant: { funds: 999 },
      staff: [{ id: 'custom-cook' }],
    };

    expect(hydrateState(saved, fresh)).toEqual({
      version: 4,
      restaurant: { funds: 999, totalServed: 0, openHour: 10, closeHour: 22 },
      staff: [{ id: 'custom-cook', gender: 'male' }],
      serviceTables: [{ id: 'st1' }],
      serviceItems: [],
      customers: [],
      queue: [],
      queueAdmissionGate: null,
      floorDirt: [],
      washStations: [],
    });
  });

  it('restores a unique active guide as owner of an ownerless legacy table reservation', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff: [{
        id: 'guide-a', role: 'waiter',
        task: { type: 'guide_customer', customerIds: ['party-a'], tableId: 't1' },
      }],
      tables: fresh.tables.map(table => table.id === 't1'
        ? { ...table, status: 'reserved' }
        : table),
    };

    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.tables.find(table => table.id === 't1')).toMatchObject({
      status: 'reserved',
      reservationOwnerStaffId: 'guide-a',
    });
  });

  it.each([
    ['zero guides', []],
    ['multiple guides', [
      {
        id: 'guide-a', role: 'waiter',
        task: { type: 'guide_customer', customerIds: ['party-a'], tableId: 't1' },
      },
      {
        id: 'guide-b', role: 'waiter',
        task: { type: 'guide_customer', customerIds: ['party-b'], tableId: 't1' },
      },
    ]],
  ])('releases an ownerless legacy reservation with %s without assigning an arbitrary owner', (_case, staff) => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      staff,
      tables: fresh.tables.map(table => table.id === 't1'
        ? { ...table, status: 'reserved' }
        : table),
    };

    const table = hydrateState(saved, fresh).tables.find(candidate => candidate.id === 't1');

    expect(table).toEqual({ ...fresh.tables[0], status: 'empty' });
    expect(table).not.toHaveProperty('reservationOwnerStaffId');
  });

  it('removes stale reservation ownership from a legacy non-reserved table', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      tables: fresh.tables.map(table => table.id === 't1'
        ? { ...table, status: 'occupied', reservationOwnerStaffId: 'old-guide' }
        : table),
    };

    const hydrated = hydrateState(saved, fresh);

    expect(hydrated.tables.find(table => table.id === 't1')).not.toHaveProperty('reservationOwnerStaffId');
  });

  it('hydrates missing wash collections from fresh state and preserves populated saves', () => {
    const fresh = createInitialState();
    const missing = hydrateState({ ...fresh, floorDirt: undefined, washStations: undefined }, fresh);
    const saved = [{ id: 'd1' }];
    const stations = [{ id: 'wash9', type: 'automatic', x: 500, y: 300, w: 40, h: 40 }];
    const populated = hydrateState({ ...fresh, floorDirt: saved, washStations: stations }, fresh);

    expect(missing.floorDirt).toEqual([]);
    expect(missing.washStations).toEqual(fresh.washStations);
    expect(populated.floorDirt).toEqual(saved);
    expect(populated.washStations).toEqual(stations);
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
    expect(['male', 'female']).toContain(hydrated.queue[0].members[0].gender);
    expect(hydrateState(saved, fresh)).toEqual(hydrated);
  });

  it('hydrates flat legacy queues into nested party records without losing order or gender', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      queue: [
        { id: 'a1', partyId: 'a', name: 'Sofia' },
        { id: 'b1', partyId: 'b' },
        { id: 'a2', partyId: 'a' },
      ],
    };
    const hydrated = hydrateState(saved, fresh);
    expect(hydrated.queue.map(party => party.partyId)).toEqual(['a', 'b']);
    expect(hydrated.queue[0].members.map(member => member.id)).toEqual(['a1', 'a2']);
    expect(hydrated.queue[0].members[0].gender).toBe('female');
    expect(hydrateState(hydrated, fresh)).toEqual(hydrated);
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

    expect(legacy.staffSlots).toBe(7);
    expect(crowded.staffSlots).toBe(8);
    expect(expanded.staffSlots).toBe(9);
    expect(legacy.version).toBe(5);
  });
});
