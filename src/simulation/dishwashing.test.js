import { describe, expect, it } from 'vitest';
import {
  getWashStationCapacity,
  getWashStationOccupancy,
  hasWashStationCapacity,
  isWashStationBusy,
  updateAutomaticDishwashers,
} from './dishwashing';
import { processKitchen } from './kitchen';

describe('dishwashing lifecycle', () => {
  it('balances manual and automatic station capacities', () => {
    expect(getWashStationCapacity({ type: 'manual' })).toBe(8);
    expect(getWashStationCapacity({ type: 'automatic' })).toBe(12);
    expect(getWashStationCapacity({ type: 'automatic', level: 5 })).toBe(36);
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

  it('deduplicates target reservations from carried and pre-pickup records', () => {
    const station = { id: 'auto', type: 'automatic' };
    const state = {
      serviceItems: [
        { id: 'queued', state: 'queued_for_wash', washStationId: 'auto' },
        { id: 'dirty', state: 'dirty_at_table', reservedWashStationId: 'auto' },
        { id: 'carried', state: 'carried_dirty', washStationId: 'auto' },
      ],
      staff: [
        {
          id: 'w1', carryingServiceItemIds: ['carried'],
          task: { type: 'transfer_dirty_item', serviceItemId: 'dirty', washStationId: 'auto' },
        },
        {
          id: 'w2',
          task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'auto' },
        },
      ],
    };

    expect(getWashStationOccupancy(state, station)).toBe(3);
  });

  it('exposes active station protection separately from capacity occupancy', () => {
    const station = { id: 'auto', type: 'automatic' };
    expect(isWashStationBusy({
      serviceItems: [{ id: 'dish', state: 'washing', washStationId: 'auto' }],
    }, station)).toBe(true);
    expect(isWashStationBusy({
      serviceItems: [{ id: 'dish', state: 'queued_for_wash', washStationId: 'auto' }],
    }, station)).toBe(false);
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
    expect(started.serviceItems.find(item => item.id === 'old')).toMatchObject({ state: 'washing', washStartedAt: 10 });
    const waiting = updateAutomaticDishwashers({ ...started, restaurant: { gameTime: 309 } });
    expect(waiting.serviceItems).toHaveLength(2);
    const done = updateAutomaticDishwashers({ ...waiting, restaurant: { gameTime: 310 } });
    expect(done.serviceItems.map(item => item.id)).toEqual(['new']);
  });

  it('starts and completes exactly one duplicate-id automatic item per cycle', () => {
    const state = { washStations: [{ id: 'auto', type: 'automatic', x: 0, y: 0, w: 40, h: 40 }], restaurant: { gameTime: 10 }, serviceItems: [
      { id: 'same', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 1 },
      { id: 'same', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 2 },
    ] };
    const started = updateAutomaticDishwashers(state);
    expect(started.serviceItems.map(item => item.state)).toEqual(['washing', 'queued_for_wash']);
    const done = updateAutomaticDishwashers({ ...started, restaurant: { gameTime: 310 } });
    expect(done.serviceItems).toHaveLength(1);
    expect(done.serviceItems[0]).toMatchObject({ state: 'washing', washStartedAt: 301 });
  });

  it('processes a serial queue through a large interval with residual time', () => {
    const state = {
      washStations: [{ id: 'auto', type: 'automatic', level: 1 }],
      restaurant: { gameTime: 750 },
      serviceItems: [
        { id: 'first', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 0 },
        { id: 'second', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 100 },
        { id: 'third', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 200 },
      ],
    };

    const result = updateAutomaticDishwashers(state);

    expect(result.serviceItems).toEqual([expect.objectContaining({
      id: 'third', state: 'washing', washStationId: 'auto', washStartedAt: 600,
      accumulatedWork: 150, lastProgressAt: 750,
    })]);
  });

  it('recovers an unassigned dirty queue item into an idle automatic station', () => {
    const result = updateAutomaticDishwashers({
      washStations: [{ id: 'auto', type: 'automatic' }],
      restaurant: { gameTime: 100 },
      serviceItems: [{ id: 'unassigned', state: 'queued_for_wash', washQueuedAt: 100 }],
    });

    expect(result.serviceItems[0]).toMatchObject({
      state: 'washing', washStationId: 'auto', washStartedAt: 100,
    });
  });

  it('does not process a queued item before its arrival time', () => {
    const result = updateAutomaticDishwashers({
      washStations: [{ id: 'auto', type: 'automatic' }],
      restaurant: { gameTime: 50 },
      serviceItems: [{
        id: 'future', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 100,
      }],
    });

    expect(result.serviceItems[0].state).toBe('queued_for_wash');
    expect(result.serviceItems[0]).not.toHaveProperty('washStartedAt');
  });

  it('uses stable ids for equal queue timestamps and is idempotent at one timestamp', () => {
    const state = {
      washStations: [{ id: 'auto', type: 'automatic' }],
      restaurant: { gameTime: 100 },
      serviceItems: [
        { id: 'z', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 0 },
        { id: 'a', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 0 },
      ],
    };
    const first = updateAutomaticDishwashers(state);
    const repeated = updateAutomaticDishwashers(first);

    expect(first.serviceItems[1]).toMatchObject({ id: 'a', state: 'washing', accumulatedWork: 100 });
    expect(repeated).toEqual(first);
  });

  it('uses old and new rates only on their respective update intervals', () => {
    const station = { id: 'auto', type: 'automatic', level: 1 };
    const initial = {
      washStations: [station],
      restaurant: { gameTime: 0 },
      serviceItems: [{
        id: 'dish', state: 'washing', washStationId: 'auto', washStartedAt: 0,
        accumulatedWork: 0, lastProgressAt: 0,
      }],
    };
    const oldRate = updateAutomaticDishwashers({ ...initial, restaurant: { gameTime: 100 } });
    const upgraded = updateAutomaticDishwashers({
      ...oldRate,
      washStations: [{ ...station, level: 5 }],
      restaurant: { gameTime: 200 },
    });

    expect(oldRate.serviceItems[0]).toMatchObject({ accumulatedWork: 100, lastProgressAt: 100 });
    expect(upgraded.serviceItems[0]).toMatchObject({ accumulatedWork: 250, lastProgressAt: 200 });
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
