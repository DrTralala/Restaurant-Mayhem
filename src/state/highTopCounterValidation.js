import { createHighTopCounterRecords, getHighTopCounterGeometry } from '../data/highTopCounters';
import { getRestaurantWorld } from '../simulation/world';

/** Validate ownership before navigation can interpret private dining geometry. */
export function validateHighTopCounters(state) {
  const invalid = () => { throw new Error('Invalid saved high top counter ownership or geometry'); };
  if (Object.hasOwn(state, 'highTopCounters') && !Array.isArray(state.highTopCounters)) invalid();
  const counters = state.highTopCounters || [];
  const parents = new Map();
  const world = getRestaurantWorld(state.restaurant || {});
  for (const counter of counters) {
    const geometry = getHighTopCounterGeometry(counter);
    if (!geometry || typeof counter.id !== 'string' || !counter.id || parents.has(counter.id)
      || !Number.isInteger(counter.rotation) || counter.x % 20 || counter.y % 20) invalid();
    const rect = geometry.footprint;
    if (rect.x < world.floorX || rect.y < world.kitchenY
      || rect.x + rect.w > world.floorX + world.floorW
      || rect.y + rect.h > world.kitchenY + world.floorH) invalid();
    parents.set(counter.id, createHighTopCounterRecords(counter));
  }
  for (const collection of ['tables', 'chairs']) {
    const records = Array.isArray(state[collection]) ? state[collection] : [];
    for (const record of records) {
      if (record?.highTopCounterId == null && record?.counterSeatIndex == null) continue;
      const expected = parents.get(record.highTopCounterId)?.[collection]?.[record.counterSeatIndex];
      if (!expected || !Number.isInteger(record.counterSeatIndex)) invalid();
      for (const [key, value] of Object.entries(expected)) {
        if (key !== 'status' && record[key] !== value) invalid();
      }
    }
    for (const expected of parents.values()) {
      for (const child of expected[collection]) {
        if (records.filter(record => record?.id === child.id).length !== 1) invalid();
        const actual = records.find(record => record?.id === child.id);
        if (actual.highTopCounterId !== child.highTopCounterId) invalid();
      }
    }
  }
  const placeIds = new Set([...parents.values()].flatMap(records => records.tables.map(table => table.id)));
  for (const chair of Array.isArray(state.chairs) ? state.chairs : []) {
    if (placeIds.has(chair?.tableId) && !parents.has(chair.highTopCounterId)) invalid();
  }
}
