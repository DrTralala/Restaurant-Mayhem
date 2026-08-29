import { describe, expect, it } from 'vitest';
import { markCustomerItemsDirty, releaseClearedTables, updateAutomaticDishwashers } from './dishwashing';
import { processKitchen } from './kitchen';

describe('dishwashing lifecycle', () => {
  it('marks only delivered items for the target customer dirty', () => {
    const result = markCustomerItemsDirty([
      { id: 'dish', customerId: 'c1', state: 'delivered' },
      { id: 'drink', customerId: 'c1', state: 'delivered' },
      { id: 'other', customerId: 'c2', state: 'delivered' },
      { id: 'old', customerId: 'c1', state: 'on_service' },
    ], 'c1', 1000);
    expect(result[0]).toMatchObject({ state: 'dirty_at_table', dirtyAt: 1000, washStationId: null, washQueuedAt: null, washStartedAt: null });
    expect(result[1]).toMatchObject({ state: 'dirty_at_table', dirtyAt: 1000, washStationId: null, washQueuedAt: null, washStartedAt: null });
    expect(result[2].state).toBe('delivered');
    expect(result[3].state).toBe('on_service');
  });

  it('releases a dirty table only after its final dirty item is collected', () => {
    const tables = [{ id: 't1', status: 'dirty' }];
    const customers = [{ id: 'c1', tableId: 't1', state: 'leaving' }];
    expect(releaseClearedTables(tables, customers, [{ tableId: 't1', state: 'dirty_at_table' }])[0].status).toBe('dirty');
    expect(releaseClearedTables(tables, customers, [{ tableId: 't1', state: 'carried_dirty' }])[0].status).toBe('empty');
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

  it('does not let a dirty item be removed by a customer departure', () => {
    expect(markCustomerItemsDirty([{ id: 'i', customerId: 'c', state: 'delivered' }], 'c', 5)[0].state)
      .toBe('dirty_at_table');
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

  it.each(['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing'])
    ('processKitchen preserves leaving-customer %s items', itemState => {
      const item = { id: `dirty-${itemState}`, kind: 'dish', customerId: 'gone', state: itemState,
        washStationId: itemState === 'washing' ? 'wash1' : null };
      const result = processKitchen({ customers: [{ id: 'gone', state: 'leaving' }], serviceItems: [item], tables: [],
        dishes: [], restaurant: { gameTime: 100 }, kitchenStations: [], serviceTables: [], staff: [], washStations: [{ id: 'wash1' }] });
      expect(result.serviceItems).toEqual([item]);
    });
});
