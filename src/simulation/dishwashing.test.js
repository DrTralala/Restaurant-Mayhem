import { describe, expect, it } from 'vitest';
import {
  getWashStationCapacity,
  getWashStationOccupancy,
  hasWashStationCapacity,
  releaseClearedTables,
  updateAutomaticDishwashers,
} from './dishwashing';
import { processKitchen } from './kitchen';

describe('dishwashing lifecycle', () => {
  it('balances manual and automatic station capacities', () => {
    expect(getWashStationCapacity({ type: 'manual' })).toBe(8);
    expect(getWashStationCapacity({ type: 'automatic' })).toBe(12);
    expect(getWashStationCapacity({ type: 'unknown' })).toBe(0);
  });

  it('counts unique queued, washing, and inbound reserved items', () => {
    const station = { id: 'sink', type: 'manual' };
    const state = {
      serviceItems: [
        { id: 'washing', state: 'washing', washStationId: 'sink' },
        { id: 'queued', state: 'queued_for_wash', washStationId: 'sink' },
      ],
      staff: [
        { id: 'w1', task: { type: 'deliver_dirty_item', serviceItemId: 'inbound', washStationId: 'sink' } },
        { id: 'w2', task: { type: 'deliver_dirty_item', serviceItemId: 'inbound', washStationId: 'sink' } },
      ],
    };

    expect(getWashStationOccupancy(state, station)).toBe(3);
    expect(getWashStationOccupancy(state, station, { excludeServiceItemId: 'inbound' })).toBe(2);
    expect(hasWashStationCapacity(state, station)).toBe(true);
  });

  it('releases a dirty table only after its final dirty item is collected', () => {
    const tables = [{ id: 't1', status: 'dirty' }];
    const customers = [{ id: 'c1', tableId: 't1', state: 'leaving' }];
    expect(releaseClearedTables(tables, customers, [{ tableId: 't1', state: 'dirty_at_table' }])[0].status).toBe('dirty');
    expect(releaseClearedTables(tables, customers, [{ tableId: 't1', state: 'carried_dirty' }])[0].status).toBe('empty');
  });

  it('does not treat a checkout customer as occupying the dining table', () => {
    expect(releaseClearedTables(
      [{ id: 't1', status: 'dirty' }],
      [{ id: 'c1', tableId: 't1', state: 'checkout_moving' }],
      [],
    )[0].status).toBe('empty');
  });

  it('starts the oldest automatic wash and removes it at completion', () => {
    const base = {
      washStations: [{ id: 'auto', type: 'automatic', x: 0, y: 0, w: 40, h: 40 }],
      serviceItems: [
        { id: 'new', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 20 },
        { id: 'old', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 10 },
      ],
      restaurant: { gameTime: 100 },
    };
    const started = updateAutomaticDishwashers(base);
    expect(started.serviceItems.find(item => item.id === 'old')).toMatchObject({ state: 'washing', washStartedAt: 100 });
    const waiting = updateAutomaticDishwashers({ ...started, restaurant: { gameTime: 279 } });
    expect(waiting.serviceItems).toHaveLength(2);
    const done = updateAutomaticDishwashers({ ...waiting, restaurant: { gameTime: 280 } });
    expect(done.serviceItems.map(item => item.id)).toEqual(['new']);
  });

  it('starts and completes exactly one duplicate-id automatic item per cycle', () => {
    const state = { washStations: [{ id: 'auto', type: 'automatic', x: 0, y: 0, w: 40, h: 40 }], restaurant: { gameTime: 10 }, serviceItems: [
      { id: 'same', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 1 },
      { id: 'same', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 2 },
    ] };
    const started = updateAutomaticDishwashers(state);
    expect(started.serviceItems.map(item => item.state)).toEqual(['washing', 'queued_for_wash']);
    const done = updateAutomaticDishwashers({ ...started, restaurant: { gameTime: 190 } });
    expect(done.serviceItems).toHaveLength(1);
    expect(done.serviceItems[0].state).toBe('queued_for_wash');
  });

  it('does not import an unassigned item when inbound reservations fill an automatic station', () => {
    const station = { id: 'auto', type: 'automatic', x: 0, y: 0, w: 40, h: 40 };
    const state = {
      washStations: [station],
      restaurant: { gameTime: 10 },
      serviceItems: [{ id: 'unassigned', state: 'queued_for_wash', washStationId: null, washQueuedAt: 1 }],
      staff: Array.from({ length: 12 }, (_, index) => ({
        id: `w${index}`,
        task: { type: 'deliver_dirty_item', serviceItemId: `inbound-${index}`, washStationId: 'auto' },
      })),
    };

    const result = updateAutomaticDishwashers(state);

    expect(result.serviceItems[0]).toMatchObject({ state: 'queued_for_wash', washStationId: null });
  });

  it.each(['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing'])
    ('processKitchen preserves leaving-customer %s items', itemState => {
      const item = { id: `dirty-${itemState}`, kind: 'dish', customerId: 'gone', state: itemState,
        washStationId: itemState === 'washing' ? 'wash1' : null };
      const result = processKitchen({ customers: [{ id: 'gone', state: 'leaving' }], serviceItems: [item], tables: [],
        dishes: [], restaurant: { gameTime: 100 }, kitchenStations: [], serviceTables: [], staff: [], washStations: [{ id: 'wash1' }] });
      expect(result.serviceItems).toEqual([item]);
    });
});
