import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from './initialState';
import { hydrateState, loadState, loadStateResult } from './persistence';
import { SAVE_VERSION } from './saveVersion';
import { migrateLegacyCookbook } from './cookbookMigration';
import {
  createCookbookState, validateCookbookState,
} from '../simulation/cookbook';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

// Literal historical identities: the pre-increment catalogue never shrank when
// a new recipe was appended, so fixtures must not derive these from the runtime
// catalogue.
const LEGACY_RECIPE_IDS = ['toast', 'cheese-toast', 'roast-vegetables', 'baked-potato', 'fries', 'fried-chicken'];

const legacyEntry = (overrides = {}) => ({
  discovered: false, paidPortions: 0, perk: null,
  menuSettings: { name: 'Legacy Dish', price: 10, quality: 1 }, ...overrides,
});

function legacyCookbook(watermark = 0) {
  return {
    schemaVersion: 1,
    lastAppliedPaidVisitSequence: watermark,
    entries: {
      toast: { discovered: true, paidPortions: 15, perk: 'speed',
        menuSettings: { name: 'House Toast', price: 24, quality: 4 } },
      'cheese-toast': legacyEntry({ discovered: true, paidPortions: 3,
        menuSettings: { name: 'Cheese Toast', price: 14, quality: 1 } }),
      'roast-vegetables': legacyEntry({ menuSettings: { name: 'Roast Vegetables', price: 18, quality: 1 } }),
      'baked-potato': legacyEntry({ menuSettings: { name: 'Baked Potato', price: 22, quality: 1 } }),
      fries: legacyEntry({ menuSettings: { name: 'Crispy Fries', price: 10, quality: 1 } }),
      'fried-chicken': legacyEntry({ menuSettings: { name: 'Fried Chicken', price: 20, quality: 1 } }),
    },
  };
}

// A complete previous-version save whose cookbook branch is the historical schema-1 shape,
// including a mastered/customised toast and one committed in-flight order.
function legacySave({ eq4Owned = false } = {}) {
  const raw = createInitialState();
  raw.version = SAVE_VERSION - 1;
  delete raw.movementCoordinator;
  raw.cookbook = legacyCookbook(7);
  raw.paidVisitSequence = 7;
  raw.dishes = raw.dishes.map(dish => ({ ...dish, name: 'House Toast', price: 24, quality: 4 }));
  raw.equipment = raw.equipment.map(equipment =>
    equipment.id === 'eq4' ? { ...equipment, owned: eq4Owned } : equipment);
  raw.customers = [];
  raw.serviceItems = [];
  return raw;
}

const malformedLegacyBuilders = [
  ['missing original entry', () => { const cookbook = legacyCookbook(); delete cookbook.entries.fries; return cookbook; }],
  ['unknown entry', () => { const cookbook = legacyCookbook(); cookbook.entries.fake = legacyEntry(); return cookbook; }],
  ['extra entry', () => { const cookbook = legacyCookbook(); cookbook.entries.extra = legacyEntry(); return cookbook; }],
  ['null entries', () => ({ schemaVersion: 1, lastAppliedPaidVisitSequence: 0, entries: null })],
  ['array entries', () => ({ schemaVersion: 1, lastAppliedPaidVisitSequence: 0,
    entries: LEGACY_RECIPE_IDS.map(id => [id, legacyEntry()]) })],
  ['missing entries', () => ({ schemaVersion: 1, lastAppliedPaidVisitSequence: 0 })],
];

describe('migrateLegacyCookbook', () => {
  it('copies a recognised v1 cookbook to schema 2 and overlays current canonical defaults', () => {
    const raw = { cookbook: legacyCookbook(7), other: { keep: true } };
    const migrated = migrateLegacyCookbook(raw);
    expect(migrated).not.toBe(raw);
    expect(migrated.cookbook).not.toBe(raw.cookbook);
    expect(migrated.cookbook.entries).not.toBe(raw.cookbook.entries);
    expect(migrated.cookbook.schemaVersion).toBe(2);
    expect(migrated.cookbook.lastAppliedPaidVisitSequence).toBe(7);
    // Existing entry values are reused, not repaired or re-created.
    for (const id of LEGACY_RECIPE_IDS) {
      expect(migrated.cookbook.entries[id]).toBe(raw.cookbook.entries[id]);
    }
    expect(Object.keys(migrated.cookbook.entries)).toEqual(Object.keys(createCookbookState().entries));
    expect(migrated.cookbook.entries.gazpacho).toEqual({ discovered: false, owned: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Gazpacho', price: 16, quality: 1 } });
    expect(migrated.cookbook.entries['fish-bisque']).toEqual({ discovered: false, owned: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Fish Bisque', price: 20, quality: 1 } });
    expect(migrated.cookbook.entries['baked-eggs']).toEqual({ discovered: false, owned: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Baked Eggs', price: 15, quality: 1 } });
    expect(raw.cookbook.schemaVersion).toBe(1);
    expect(raw.cookbook.entries).not.toHaveProperty('gazpacho');
    expect(migrated.other).toBe(raw.other);
  });

  it('is idempotent and leaves absent, current or unsupported cookbooks untouched', () => {
    const migrated = migrateLegacyCookbook({ cookbook: legacyCookbook(0) });
    expect(migrateLegacyCookbook(migrated)).toBe(migrated);
    const missing = { dishes: [] };
    expect(migrateLegacyCookbook(missing)).toBe(missing);
    for (const saved of [
      { cookbook: null }, { cookbook: undefined }, { cookbook: [] },
      { cookbook: { schemaVersion: 2, entries: {} } },
      { cookbook: { schemaVersion: 3, entries: legacyCookbook().entries } },
      { cookbook: { schemaVersion: '1', entries: legacyCookbook().entries } },
    ]) {
      expect(migrateLegacyCookbook(saved)).toBe(saved);
    }
  });

  it.each(malformedLegacyBuilders)('throws an Invalid cookbook error for a malformed v1 cookbook: %s',
    (_name, build) => {
      expect(() => migrateLegacyCookbook({ cookbook: build() })).toThrow(/Invalid cookbook/);
    });

  it('does not repair malformed old field values; strict current validation rejects them afterwards', () => {
    const cookbook = legacyCookbook(7);
    cookbook.entries.toast.paidPortions = -1;
    const migrated = migrateLegacyCookbook({ ...legacySave(), cookbook });
    expect(migrated.cookbook.entries.toast.paidPortions).toBe(-1);
    expect(() => validateCookbookState({ ...migrated, paidVisitSequence: 7 })).toThrow();
  });

  it('does not fill a missing Gazpacho entry in a schema-2 cookbook', () => {
    const cookbook = legacyCookbook(0);
    cookbook.schemaVersion = 2;
    const saved = { cookbook };
    expect(migrateLegacyCookbook(saved)).toBe(saved);
    expect(() => validateCookbookState({ paidVisitSequence: 0, ...saved })).toThrow();
  });
});

describe('legacy cookbook rejection at the v11 persistence boundary', () => {
  it('rejects a previous-version save without modifying or deleting it', () => {
    const raw = legacySave({ eq4Owned: true });
    const serialized = JSON.stringify(raw);
    localStorage.setItem('restaurant-sim-save', serialized);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadStateResult()).toEqual({ state: null, reason: 'incompatible' });
    expect(loadState()).toBeNull();
    expect(() => hydrateState(raw, createInitialState())).toThrow(/incompatible/i);
    expect(localStorage.getItem('restaurant-sim-save')).toBe(serialized);
  });

  it('rejects schema-1 cookbooks in current-version saves instead of migrating them', () => {
    const raw = legacySave({ eq4Owned: true });
    raw.version = SAVE_VERSION;
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadStateResult()).toEqual({ state: null, reason: 'invalid' });
    expect(() => hydrateState(raw, createInitialState())).toThrow(/Invalid cookbook/);
  });

  it('rejects missing cookbooks in current-version saves instead of adopting starter defaults', () => {
    const raw = legacySave();
    raw.version = SAVE_VERSION;
    delete raw.cookbook;
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadStateResult()).toEqual({ state: null, reason: 'invalid' });
    expect(() => hydrateState(raw, createInitialState())).toThrow(/Invalid cookbook/);
  });
});
