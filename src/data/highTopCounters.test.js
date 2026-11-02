import { describe, it, expect } from 'vitest';
import { getHighTopCounterGeometry, createHighTopCounterRecords, repositionHighTopCounterRecords, isHighTopCounterInUse } from './highTopCounters';
import { getDiningTableRect, getDiningTableCentre } from './diningGeometry';
import { getPlaceable, getPlaceableDimensions } from './placeables';
import { listFixtures, getFixtureRect } from './fixtures';
import { navigationFixtureRectangles, createNavigationWorkspace } from '../simulation/movement/navigationWorkspace';

const parent = { id: 'htc1', x: 300, y: 300, rotation: 0 };
describe('high top counter ownership and geometry', () => {
  it('exposes one purchasable fixture with four independent included places', () => {
    const records = createHighTopCounterRecords(parent);
    expect(records.tables.map(t => [t.x, t.y, t.seats, t.status]))
      .toEqual([300, 320, 340, 360].map(x => [x, 300, 1, 'empty']));
    expect(records.chairs.map(c => [c.x, c.y, c.rotation]))
      .toEqual([300, 320, 340, 360].map(x => [x, 320, 0]));
    expect(listFixtures({ highTopCounters: [parent], ...records }))
      .toEqual([{ type: 'highTopCounter', id: 'htc1', data: parent }]);
    expect(getPlaceable('highTopCounter')).toMatchObject({ label: 'High top counter', price: 300, grid: 20, rotatable: true });
  });

  it.each([
    [0, [80, 40], [300, 300, 80, 20], [300, 320], [360, 320]],
    [1, [40, 80], [320, 300, 20, 80], [300, 300], [300, 360]],
    [2, [80, 40], [300, 320, 80, 20], [360, 300], [300, 300]],
    [3, [40, 80], [300, 300, 20, 80], [320, 360], [320, 300]],
  ])('rotates the entire footprint and leaves each chair its sole blocker: %i', (rotation, size, top, first, last) => {
    const counter = { ...parent, rotation };
    const geometry = getHighTopCounterGeometry(counter);
    expect(geometry.footprint).toEqual({ x: 300, y: 300, w: size[0], h: size[1] });
    expect(geometry.countertop).toEqual({ x: top[0], y: top[1], w: top[2], h: top[3] });
    expect(getPlaceableDimensions('highTopCounter', rotation)).toEqual({ width: size[0], height: size[1] });
    expect(getFixtureRect({}, { type: 'highTopCounter', data: counter })).toEqual(geometry.footprint);
    const state = { highTopCounters: [counter], ...createHighTopCounterRecords(counter) };
    expect([state.chairs[0].x, state.chairs[0].y]).toEqual(first);
    expect([state.chairs[3].x, state.chairs[3].y]).toEqual(last);
    const rects = navigationFixtureRectangles(state);
    expect(rects).toHaveLength(8);
    for (const chair of state.chairs) {
      expect(rects.filter(r => chair.x >= r.x && chair.x < r.x + r.w && chair.y >= r.y && chair.y < r.y + r.h))
        .toEqual([{ kind: 'chair', id: chair.id, x: chair.x, y: chair.y, w: 20, h: 20 }]);
    }
  });

  it('preserves runtime and stable identities when repositioning, without recreating missing children', () => {
    const records = createHighTopCounterRecords(parent);
    records.tables[0] = { ...records.tables[0], status: 'dirty', diningPartyId: 'party' };
    const state = { ...records, highTopCounters: [{ ...parent, x: 400, rotation: 1 }] };
    const after = repositionHighTopCounterRecords(state);
    expect(after.tables[0]).toMatchObject({ id: 'htc1-seat-0', x: 420, y: 300, status: 'dirty', diningPartyId: 'party' });
    expect(after.chairs[3]).toMatchObject({ id: 'htc1-chair-3', tableId: 'htc1-seat-3', x: 400, y: 360, rotation: 1 });
    expect(state.tables[0].x).toBe(300);
    expect(repositionHighTopCounterRecords({ ...state, tables: [] }).tables).toEqual([]);
  });

  it.each([{ x: NaN }, { y: Infinity }, { rotation: 4 }, { rotation: -1 }, { rotation: 0.5 }])('rejects malformed geometry %j', patch => {
    expect(getHighTopCounterGeometry({ ...parent, ...patch })).toBeNull();
  });

  it('uses canonical surface sizes rather than imported dimensions', () => {
    expect(getDiningTableRect({ x: 100, y: 200, w: 5 })).toEqual({ x: 100, y: 200, w: 40, h: 40 });
    expect(getDiningTableCentre({ x: 100, y: 200, highTopCounterId: 'htc1' })).toEqual({ x: 110, y: 210 });
    expect(getDiningTableRect({ x: NaN, y: 200 })).toBeNull();
  });

  it('invalidates cached navigation when a surface changes ownership', () => {
    const state = { restaurant: {}, tables: [{ id: 'cache-counter', x: 300, y: 300 }] };
    const before = createNavigationWorkspace(state);
    state.tables[0].highTopCounterId = 'htc1';
    const after = createNavigationWorkspace(state);
    expect(after).not.toBe(before);
  });

  it('treats missing, dirty, occupied, customer-linked and task-linked places as in use', () => {
    const state = { ...createHighTopCounterRecords(parent), highTopCounters: [parent] };
    expect(isHighTopCounterInUse(state, parent.id)).toBe(false);
    expect(isHighTopCounterInUse({ ...state, tables: [] }, parent.id)).toBe(true);
    for (const status of ['reserved', 'occupied', 'dirty']) {
      expect(isHighTopCounterInUse({ ...state, tables: state.tables.map((t, i) => i ? t : { ...t, status }) }, parent.id)).toBe(true);
    }
    expect(isHighTopCounterInUse({ ...state, customers: [{ tableId: 'htc1-seat-0' }] }, parent.id)).toBe(true);
    expect(isHighTopCounterInUse({ ...state, staff: [{ task: { tableId: 'htc1-seat-0' } }] }, parent.id)).toBe(true);
    expect(isHighTopCounterInUse({ ...state, serviceItems: [{ tableId: 'htc1-seat-0', state: 'dirty_at_table' }] }, parent.id)).toBe(true);
  });
});
