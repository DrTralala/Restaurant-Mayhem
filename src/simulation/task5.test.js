import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { hydrateState } from '../state/persistence';
import { ACTIVITY_DURATIONS } from './activity';
import { getServiceItemProgress } from './staffPerformance';
import {
  getWashStationOccupancy,
  updateAutomaticDishwashers,
} from './dishwashing';
import { normaliseServiceItemOwnership } from './serviceItems';
import {
  getCarriedServiceItemIds,
  getStaffCarryCapacity,
} from './staffInventory';
import { resolveStaffAfterMovement, updateStaff } from './staff';

function makeState(overrides = {}) {
  const fresh = createInitialState();
  return {
    ...fresh,
    ...overrides,
    restaurant: { ...fresh.restaurant, gameTime: 0, ...(overrides.restaurant || {}) },
  };
}

function dirtyItem(id, overrides = {}) {
  return {
    id,
    kind: 'dish',
    customerId: `gone-${id}`,
    state: 'carried_dirty',
    ...overrides,
  };
}

function arrivedDirtyPickupState(skill) {
  const itemIds = ['dirty-1', 'dirty-2', 'dirty-3', 'dirty-4'];
  return makeState({
    restaurant: { gameTime: 100 },
    customers: [{ id: 'gone-diner', state: 'leaving', tableId: 't1' }],
    tables: [{ id: 't1', seats: 4, status: 'dirty', x: 200, y: 200 }],
    washStations: [],
    serviceItems: itemIds.map((id, index) => ({
      id,
      kind: 'dish',
      customerId: 'gone-diner',
      tableId: 't1',
      state: 'dirty_at_table',
      dirtyAt: index,
    })),
    staff: [{
      id: 'waiter',
      role: 'waiter',
      skill,
      morale: 80,
      x: 180,
      y: 220,
      carryingServiceItemIds: [],
      task: { type: 'collect_dirty_item', serviceItemId: 'dirty-1', tableId: 't1' },
    }],
  });
}

function carriedDirtyState({ stationItems = [], stations, workerOverrides = {}, gameTime = 0 } = {}) {
  const carriedIds = ['dirty-1', 'dirty-2', 'dirty-3'];
  return makeState({
    restaurant: { gameTime },
    washStations: stations,
    serviceItems: [
      ...stationItems,
      ...carriedIds.map(id => dirtyItem(id)),
    ],
    staff: [{
      id: 'waiter',
      role: 'waiter',
      skill: 10,
      morale: 80,
      x: 180,
      y: 220,
      carryingServiceItemIds: carriedIds,
      task: null,
      ...workerOverrides,
    }],
  });
}

describe('Task 5 dirty dishes and washing', () => {
  it('keeps the approved dirty carrying thresholds', () => {
    expect(getStaffCarryCapacity({ skill: 1 })).toBe(1);
    expect(getStaffCarryCapacity({ skill: 5 })).toBe(2);
    expect(getStaffCarryCapacity({ skill: 10 })).toBe(3);
  });

  it.each([[1, 1], [5, 2], [10, 3]])
    ('picks up at most the dirty capacity at skill %s', (skill, capacity) => {
      const result = resolveStaffAfterMovement(arrivedDirtyPickupState(skill), 0);

      expect(result.staff[0].carryingServiceItemIds).toHaveLength(capacity);
      expect(result.serviceItems.filter(item => item.state === 'carried_dirty'))
        .toHaveLength(capacity);
      expect(result.staff[0].carryingServiceItemIds)
        .toEqual(result.serviceItems.filter(item => item.state === 'carried_dirty').map(item => item.id));
    });

  it('repairs mixed and over-capacity carried inventory without dropping dishes', () => {
    const result = normaliseServiceItemOwnership(makeState({
      customers: [{ id: 'clean-customer', state: 'waiting_for_items' }],
      staff: [{
        id: 'waiter', role: 'waiter', skill: 5,
        carryingServiceItemIds: ['clean', 'dirty-1', 'dirty-2'],
      }],
      serviceItems: [
        { id: 'clean', kind: 'dish', customerId: 'clean-customer', state: 'carried' },
        dirtyItem('dirty-1'),
        dirtyItem('dirty-2'),
      ],
    }));

    const carried = result.staff[0].carryingServiceItemIds;
    expect(carried).toEqual(['clean']);
    expect(result.serviceItems.find(item => item.id === 'dirty-1'))
      .toMatchObject({ state: 'queued_for_wash', washStationId: null });
    expect(result.serviceItems.find(item => item.id === 'dirty-2'))
      .toMatchObject({ state: 'queued_for_wash', washStationId: null });
    expect(new Set(carried.map(id => result.serviceItems.find(item => item.id === id)?.state)))
      .toEqual(new Set(['carried']));
  });

  it('does not mix a dirty pickup into a clean carried load', () => {
    const state = arrivedDirtyPickupState(10);
    state.staff[0].carryingServiceItemIds = ['clean'];
    state.customers.push({ id: 'clean-customer', state: 'waiting_for_items', tableId: 't-clean' });
    state.tables.push({ id: 't-clean', status: 'occupied', x: 400, y: 400 });
    state.serviceItems.push({
      id: 'clean', kind: 'dish', customerId: 'clean-customer', tableId: 't-clean', state: 'carried',
    });

    const result = resolveStaffAfterMovement(state, 0);

    expect(getCarriedServiceItemIds(result.staff[0])).toEqual(['clean']);
    expect(result.serviceItems.filter(item => item.state === 'carried_dirty')).toHaveLength(0);
    expect(result.staff[0].task).toMatchObject({
      type: 'deliver_service_item', serviceItemId: 'clean',
    });
  });

  it('prefers a reachable automatic washer over a nearer, less-loaded sink', () => {
    const result = updateStaff(carriedDirtyState({
      stations: [
        { id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 },
        { id: 'auto', type: 'automatic', x: 500, y: 200, w: 40, h: 40 },
      ],
    }), 0);

    expect(result.staff[0].task).toMatchObject({
      type: 'deliver_dirty_item', washStationId: 'auto',
    });
  });

  it('retains workload then distance ordering among automatic washers', () => {
    const result = updateStaff(carriedDirtyState({
      stationItems: [
        ...Array.from({ length: 2 }, (_, index) => ({
          id: `queued-${index}`,
          state: 'queued_for_wash',
          washStationId: 'auto-near',
          washQueuedAt: index,
        })),
      ],
      stations: [
        { id: 'auto-near', type: 'automatic', x: 200, y: 200, w: 40, h: 40 },
        { id: 'auto-far', type: 'automatic', x: 500, y: 200, w: 40, h: 40 },
      ],
    }), 0);

    expect(result.staff[0].task).toMatchObject({
      type: 'deliver_dirty_item', washStationId: 'auto-far',
    });
  });

  it('counts queued, active, and taskless incoming reservations once', () => {
    const station = { id: 'auto', type: 'automatic', x: 200, y: 200, w: 40, h: 40 };
    const state = makeState({
      washStations: [station],
      serviceItems: [
        { id: 'queued', state: 'queued_for_wash', washStationId: 'auto' },
        { id: 'washing', state: 'washing', washStationId: 'auto' },
        dirtyItem('incoming', { washStationId: 'auto' }),
      ],
      staff: [{
        id: 'waiter', role: 'waiter', carryingServiceItemIds: ['incoming'],
        task: null,
      }],
    });

    expect(getWashStationOccupancy(state, station)).toBe(3);
    expect(getWashStationOccupancy(state, station, {
      excludeServiceItemId: 'incoming',
    })).toBe(2);
  });

  it('deposits a partial load and rechecks another automatic washer on arrival', () => {
    const firstStation = { id: 'auto-1', type: 'automatic', x: 200, y: 200, w: 40, h: 40 };
    const secondStation = { id: 'auto-2', type: 'automatic', x: 400, y: 200, w: 40, h: 40 };
    const state = carriedDirtyState({
      stations: [firstStation, secondStation],
      stationItems: Array.from({ length: 11 }, (_, index) => ({
        id: `queued-${index}`,
        state: 'queued_for_wash',
        washStationId: 'auto-1',
        washQueuedAt: index,
      })),
      workerOverrides: {
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty-1', washStationId: 'auto-1' },
      },
    });

    const result = updateStaff(state, 0);

    expect(result.serviceItems.find(item => item.id === 'dirty-1')).toMatchObject({
      state: 'queued_for_wash', washStationId: 'auto-1',
    });
    expect(result.staff[0]).toMatchObject({
      task: { type: 'deliver_dirty_item', washStationId: 'auto-2' },
      carryingServiceItemIds: ['dirty-2', 'dirty-3'],
    });
  });

  it('falls back to the sink when the reserved automatic route is full at arrival', () => {
    const stations = [
      { id: 'auto-1', type: 'automatic', x: 200, y: 200, w: 40, h: 40 },
      { id: 'auto-2', type: 'automatic', x: 400, y: 200, w: 40, h: 40 },
      { id: 'sink', type: 'manual', x: 600, y: 200, w: 40, h: 40 },
    ];
    const state = carriedDirtyState({
      stations,
      stationItems: [
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `queued-1-${index}`, state: 'queued_for_wash', washStationId: 'auto-1',
        })),
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `queued-2-${index}`, state: 'queued_for_wash', washStationId: 'auto-2',
        })),
      ],
      workerOverrides: {
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty-1', washStationId: 'auto-1' },
      },
    });

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({
      type: 'deliver_dirty_item', washStationId: 'sink',
    });
    expect(result.serviceItems.find(item => item.id === 'dirty-1').state)
      .toBe('carried_dirty');
  });

  it('uses 600 game seconds for automatic washing and ignores morale', () => {
    expect(ACTIVITY_DURATIONS.manualWash).toBe(300);
    expect(ACTIVITY_DURATIONS.automaticWash).toBe(600);
    const station = { id: 'auto', type: 'automatic', x: 200, y: 200, w: 40, h: 40 };
    const item = { id: 'dirty', state: 'washing', washStationId: 'auto', washStartedAt: 0 };
    const at599 = updateAutomaticDishwashers(makeState({
      restaurant: { gameTime: 599 }, washStations: [station], serviceItems: [item],
      staff: [{ id: 'waiter', role: 'waiter', morale: 0 }],
    }));
    const at600 = updateAutomaticDishwashers({
      ...at599,
      restaurant: { gameTime: 600 },
      staff: [{ id: 'waiter', role: 'waiter', morale: 100 }],
    });

    expect(at599.serviceItems).toHaveLength(1);
    expect(at600.serviceItems).toEqual([]);
  });

  it('keeps manual washing morale-adjusted from its 300-work baseline', () => {
    const station = { id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 };
    const item = {
      id: 'dirty', state: 'washing', washStationId: 'sink', washStartedAt: 0,
      assignedStaffId: 'janitor', accumulatedWork: 0, lastProgressAt: 0,
    };
    const base = makeState({
      restaurant: { gameTime: 200 },
      washStations: [station],
      serviceItems: [item],
      staff: [{
        id: 'janitor', role: 'janitor', morale: 100, x: 180, y: 220,
        task: { type: 'wash_item', serviceItemId: 'dirty', washStationId: 'sink', washingStartedAt: 0 },
      }],
    });

    const result = resolveStaffAfterMovement(base, 0);

    expect(result.serviceItems).toEqual([]);
  });

  it('rejects manual progress from a malformed worker or station owner', () => {
    const item = {
      id: 'dirty', state: 'washing', washStationId: 'sink', washStartedAt: 0,
      assignedStaffId: 'owner', accumulatedWork: 0, lastProgressAt: 0,
    };
    const state = makeState({
      restaurant: { gameTime: 300 },
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [item],
      staff: [{
        id: 'intruder', role: 'janitor', morale: 100, x: 180, y: 220,
        task: { type: 'wash_item', serviceItemId: 'dirty', washStationId: 'sink', washingStartedAt: 0 },
      }],
    });

    const result = resolveStaffAfterMovement(state, 0);

    expect(result.serviceItems).toEqual([item]);
    expect(result.staff[0].task).toBeNull();
    expect(getServiceItemProgress(state, item)).toBeNull();
    expect(getServiceItemProgress({
      ...state,
      staff: [{
        ...state.staff[0],
        id: 'owner',
        task: { ...state.staff[0].task, washStationId: 'other-sink' },
      }],
    }, item)).toBeNull();
  });

  it('requeues malformed manual ownership during save recovery', () => {
    const fresh = createInitialState();
    const saved = {
      ...fresh,
      washStations: [{ id: 'sink', type: 'manual', x: 300, y: 120, w: 40, h: 40 }],
      staff: [{
        ...fresh.staff.find(worker => worker.role === 'janitor'),
        id: 'intruder',
        task: { type: 'wash_item', serviceItemId: 'dirty', washStationId: 'sink' },
      }],
      serviceItems: [{
        id: 'dirty', kind: 'dish', customerId: 'gone', state: 'washing',
        washStationId: 'sink', washStartedAt: 20, assignedStaffId: 'missing-owner',
      }],
      customers: [{ id: 'gone', state: 'leaving' }],
    };

    const recovered = hydrateState(saved, fresh);

    expect(recovered.staff[0].task).toBeNull();
    expect(recovered.serviceItems[0]).toMatchObject({
      state: 'queued_for_wash', washStationId: 'sink', washStartedAt: null,
      assignedStaffId: null,
    });
  });

  it('rejects a legacy scalar dirty carrier when its janitor role is invalid', () => {
    const fresh = createInitialState();
    const legacyWorker = {
      ...fresh.staff.find(worker => worker.role === 'janitor'),
      id: 'legacy-janitor',
      skill: 10,
      carryingServiceItemId: 'dirty',
    };
    delete legacyWorker.carryingServiceItemIds;
    const saved = {
      ...fresh,
      staff: [legacyWorker],
      customers: [{ id: 'gone', state: 'leaving' }],
      serviceItems: [dirtyItem('dirty')],
    };

    expect(() => hydrateState(saved, fresh)).toThrow(/worker cannot carry dirty item dirty/);
  });
});
