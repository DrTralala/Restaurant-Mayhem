import { beforeEach, describe, expect, it } from 'vitest';
import { createCounterTestState } from './highTopCounter.testSupport';
import { createInitialState } from './initialState';
import { hydrateState, loadState, saveState } from './persistence';
import { validateSavedNavigationGeometry } from './movementPersistence';
import { validateSavedState } from './saveValidation';

beforeEach(() => localStorage.clear());

describe('high top counter persistence', () => {
  it.each([0, 1, 2, 3])('round-trips all owned places without changing dirty state at rotation %s', rotation => {
    const state = createCounterTestState(rotation);
    state.tables[2].status = 'dirty';
    saveState(state);
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    const hydrated = hydrateState(loaded, createInitialState());
    expect(hydrated.highTopCounters).toEqual(state.highTopCounters);
    expect(hydrated.tables).toEqual(state.tables);
    expect(hydrated.chairs).toEqual(state.chairs);
  });

  it('hydrates legacy saves without the optional parent collection', () => {
    const state = createInitialState();
    delete state.highTopCounters;
    expect(hydrateState(state, createInitialState()).highTopCounters).toEqual([]);
  });

  const corruptions = [
    ['null collection', state => { state.highTopCounters = null; }],
    ['non-array collection', state => { state.highTopCounters = {}; }],
    ['missing parent', state => { state.highTopCounters = []; }],
    ['duplicate parent', state => { state.highTopCounters.push({ ...state.highTopCounters[0] }); }],
    ['non-finite position', state => { state.highTopCounters[0].x = Infinity; }],
    ['huge position', state => { state.highTopCounters[0].x = 1e100; }],
    ['invalid rotation', state => { state.highTopCounters[0].rotation = 4; }],
    ['missing place', state => { state.tables.pop(); }],
    ['missing chair', state => { state.chairs.pop(); }],
    ['orphan place', state => { state.tables[0].highTopCounterId = 'missing'; }],
    ['untagged place', state => { delete state.tables[0].highTopCounterId; }],
    ['duplicate index', state => { state.tables[1].counterSeatIndex = 0; }],
    ['changed place id', state => { state.tables[0].id = 'replacement'; }],
    ['moved place', state => { state.tables[0].x += 20; }],
    ['changed capacity', state => { state.tables[0].seats = 4; }],
    ['rotated chair', state => { state.chairs[0].rotation = 1; }],
    ['wrong chair link', state => { state.chairs[0].tableId = state.tables[1].id; }],
    ['extra chair', state => { state.chairs.push({ id: 'extra', tableId: state.tables[0].id, x: 280, y: 300 }); }],
  ];
  it.each(corruptions)('rejects %s before rasterisation and at domain validation', (_, corrupt) => {
    const state = createCounterTestState();
    corrupt(state);
    expect(() => validateSavedNavigationGeometry(state)).toThrow();
    expect(() => validateSavedState(state)).toThrow();
  });
});
