import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from './initialState';
import { hydrateState, loadState } from './persistence';
import { loadLatestRepositoryState } from './repositorySaves';
import { migrateLegacyCookbook } from './cookbookMigration';
import {
  createDishOrderSnapshot, getCookbookEntryStatus, getResolvedDish, validateCookbookState,
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

// A complete v10 save whose cookbook branch is the historical schema-1 shape,
// including a mastered/customised toast and one committed in-flight order.
function legacySave({ eq4Owned = false } = {}) {
  const raw = createInitialState();
  delete raw.movementCoordinator;
  raw.cookbook = legacyCookbook(7);
  raw.paidVisitSequence = 7;
  raw.dishes = raw.dishes.map(dish => ({ ...dish, name: 'House Toast', price: 24, quality: 4 }));
  raw.equipment = raw.equipment.map(equipment =>
    equipment.id === 'eq4' ? { ...equipment, owned: eq4Owned } : equipment);
  const snapshot = createDishOrderSnapshot(getResolvedDish(raw, 'starter-toast'), {
    serviceItemId: 'dish-1', orderedAt: 35990,
  });
  raw.customers = [{ id: 'legacy-guest', state: 'waiting_for_items', dishId: 'starter-toast', drinkId: null,
    menuOutcome: 'ordered', foodOutcome: 'pending', foodOrderedAt: 35990,
    foodPatienceBudget: 300, foodDeadlineAt: 36290,
    dishPriceAtOrder: snapshot.price, drinkPriceAtOrder: null, orderSubtotal: snapshot.price,
    orderedServiceItemIds: ['dish-1'], consumedServiceItemIds: [], cancelledServiceItemIds: [],
    dishOrderSnapshot: snapshot }];
  raw.serviceItems = [{ id: 'dish-1', customerId: 'legacy-guest', menuItemId: 'starter-toast', kind: 'dish',
    state: 'ordered', dishOrderSnapshot: { ...snapshot } }];
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
  it('copies a recognised v1 cookbook to schema 2 and initialises only Gazpacho', () => {
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
    expect(migrated.cookbook.entries.gazpacho).toEqual({ discovered: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Gazpacho', price: 16, quality: 1 } });
    expect(raw.cookbook.schemaVersion).toBe(1);
    expect(raw.cookbook.entries).not.toHaveProperty('gazpacho');
    expect(migrated.other).toBe(raw.other);
    expect(() => validateCookbookState({ ...migrated, paidVisitSequence: 7 })).not.toThrow();
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

describe('legacy v1 saves through persistence', () => {
  it('loads and hydrates a recognised v1 save, preserving old progress, settings, watermark and snapshots', () => {
    const raw = legacySave({ eq4Owned: true });
    const originalToast = raw.cookbook.entries.toast;
    const originalSnapshot = raw.customers[0].dishOrderSnapshot;
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));

    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded.cookbook.schemaVersion).toBe(2);
    expect(loaded.cookbook.entries.toast).toEqual(originalToast);
    expect(loaded.cookbook.lastAppliedPaidVisitSequence).toBe(7);
    expect(loaded.cookbook.entries.gazpacho).toEqual({ discovered: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Gazpacho', price: 16, quality: 1 } });
    expect(loaded.customers[0].dishOrderSnapshot).toEqual(originalSnapshot);
    // The source save is never mutated by migration.
    expect(raw.cookbook.schemaVersion).toBe(1);
    expect(raw.cookbook.entries).not.toHaveProperty('gazpacho');

    const hydrated = hydrateState(loaded, createInitialState());
    expect(hydrated.cookbook.schemaVersion).toBe(2);
    expect(hydrated.cookbook.entries.toast).toEqual(originalToast);
    expect(hydrated.cookbook.lastAppliedPaidVisitSequence).toBe(7);
    expect(getCookbookEntryStatus(hydrated, 'gazpacho')).toMatchObject({
      discovered: true, equipmentOwned: true, stationAvailable: false, canAdd: true,
    });
    expect(hydrated.customers[0].dishOrderSnapshot).toEqual(originalSnapshot);
    expect(hydrated.dishes[0]).toMatchObject({ name: 'House Toast', price: 24, quality: 4 });
    // Repeated hydration is idempotent for the migrated branch.
    expect(hydrateState(hydrated, createInitialState()).cookbook).toEqual(hydrated.cookbook);
  });

  it('does not discover Gazpacho for a v1 save without the Blender', () => {
    const raw = legacySave({ eq4Owned: false });
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    const hydrated = hydrateState(loadState(), createInitialState());
    expect(getCookbookEntryStatus(hydrated, 'gazpacho')).toMatchObject({
      discovered: false, equipmentOwned: false, canAdd: false, paidPortions: 0,
    });
  });

  it.each(malformedLegacyBuilders)('fails closed for a malformed v1 save through both entry points: %s',
    (_name, build) => {
      const raw = legacySave();
      raw.cookbook = build();
      localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(loadState()).toBeNull();
      expect(() => hydrateState(raw, createInitialState())).toThrow(/Invalid cookbook/);
    });

  it('keeps the absent-cookbook legacy adoption path intact', () => {
    const raw = legacySave();
    delete raw.cookbook;
    raw.dishes = raw.dishes.map(({ cookbookId, ...dish }) => dish);
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded).not.toHaveProperty('cookbook');
    const hydrated = hydrateState(loaded, createInitialState());
    expect(hydrated.cookbook.schemaVersion).toBe(2);
    expect(hydrated.dishes[0].cookbookId).toBe('toast');
    expect(hydrated.cookbook.entries.gazpacho).toEqual({ discovered: false, paidPortions: 0, perk: null,
      menuSettings: { name: 'Gazpacho', price: 16, quality: 1 } });
  });

  it('fails closed for malformed old progress after copying it to schema 2', () => {
    const raw = legacySave();
    raw.cookbook.entries.toast.paidPortions = 16;
    localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadState()).toBeNull();
    expect(() => hydrateState(raw, createInitialState())).toThrow();
    expect(raw.cookbook.schemaVersion).toBe(1);
    expect(raw.cookbook.entries.toast.paidPortions).toBe(16);
  });

  it('rejects unsupported cookbook versions without touching the root save version', () => {
    for (const version of [0, 3, 10]) {
      const raw = legacySave();
      raw.cookbook.schemaVersion = version;
      localStorage.setItem('restaurant-sim-save', JSON.stringify(raw));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(loadState()).toBeNull();
      expect(() => hydrateState(raw, createInitialState())).toThrow();
    }
    expect(createInitialState().version).toBe(10);
  });

  it('imports v1 JSON through the repository transport and hydrates it without an earlier rejection', async () => {
    const imported = JSON.parse(JSON.stringify(legacySave({ eq4Owned: true })));
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ filename: 'legacy.json', state: imported }) });
    const { state: transported } = await loadLatestRepositoryState(fetchImpl);
    const hydrated = hydrateState(transported, createInitialState());
    expect(hydrated.cookbook.schemaVersion).toBe(2);
    expect(getCookbookEntryStatus(hydrated, 'gazpacho')).toMatchObject({
      discovered: true, equipmentOwned: true, canAdd: true,
    });
    expect(hydrated.cookbook.entries.toast).toEqual(imported.cookbook.entries.toast);
  });
});
