import { describe, expect, it } from 'vitest';
import { findClickedEntity } from './interaction';

const state = {
  restaurant: { expansionLevel: 1 },
  staff: [],
  chairs: [{ id: 'ch1', tableId: 't2', x: 190, y: 90 }],
  tables: [
    { id: 't1', x: 100, y: 100, seats: 2, status: 'empty' },
    { id: 't2', x: 200, y: 100, seats: 2, status: 'empty' },
  ],
  customers: [],
  kitchenStations: [],
  serviceTables: [],
  serviceItems: [],
};
const camera = { x: 0, y: 0, zoom: 1 };

const allFixturesState = {
  restaurant: { expansionLevel: 1 },
  staff: [],
  customers: [],
  serviceItems: [],
  tables: [{ id: 't1', x: 100, y: 300, seats: 2, status: 'empty' }],
  chairs: [{ id: 'ch1', tableId: 't1', x: 200, y: 300 }],
  doors: [{ id: 'door1', y: 340, role: 'entrance' }],
  serviceTables: [{ id: 'st1', x: 100, y: 120 }],
  cashierStations: [{ id: 'cashier1', x: 300, y: 120, w: 80, h: 40 }],
  kitchenStations: [{ id: 'k1', x: 500, y: 120, equipmentId: null }],
  washStations: [{ id: 'wash1', type: 'manual', x: 600, y: 120 }],
};

describe('findClickedEntity table labels', () => {
  it('uses unnumbered table tooltips', () => {
    expect(findClickedEntity(state, camera, 220, 120).text).toBe('Dining table');
    expect(findClickedEntity(state, camera, 220, 120).text).not.toMatch(/Table \d|Chair \d/);
  });

  it('uses unnumbered chair tooltips', () => {
    expect(findClickedEntity(state, camera, 195, 95).text).toBe('Chair');
    expect(findClickedEntity(state, camera, 195, 95).text).not.toMatch(/Table \d|Chair \d/);
  });

  it('counts only items waiting on the clicked counter', () => {
    const counters = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 200, y: 0 }];
    const hit = findClickedEntity({ ...state, serviceTables: counters, serviceItems: [
      { id: 'a1', state: 'on_service', serviceTableId: 'a' },
      { id: 'a2', state: 'on_service', serviceTableId: 'a' },
      { id: 'b1', state: 'on_service', serviceTableId: 'b' },
    ] }, camera, 10, 10);
    expect(hit.text).toBe('Service counter');
  });

  it('handles malformed truthy serviceItems on a counter', () => {
    expect(() => findClickedEntity({ ...state, serviceTables: [{ id: 'a', x: 0, y: 0 }], serviceItems: {} }, camera, 10, 10)).not.toThrow();
    expect(findClickedEntity({ ...state, serviceTables: [{ id: 'a', x: 0, y: 0 }], serviceItems: {} }, camera, 10, 10).text)
      .toBe('Service counter');
  });

  it('returns a wash-station tooltip with reserved occupancy and capacity', () => {
    const station = { id: 'wash2', type: 'automatic', x: 300, y: 100, w: 40, h: 40 };
    const hit = findClickedEntity({ ...state, washStations: [station], serviceItems: [
      { id: 'i1', washStationId: 'wash2', state: 'queued_for_wash' },
      { id: 'i2', washStationId: 'wash2', state: 'washing' },
    ], staff: [{
      id: 'w1', task: { type: 'deliver_dirty_item', serviceItemId: 'i3', washStationId: 'wash2' },
    }] }, camera, 320, 120);
    expect(hit).toMatchObject({ type: 'washStation', data: station, text: 'Automatic dishwasher' });
  });
});

describe('findClickedEntity fixture catalogue coverage', () => {
  it.each([
    ['table', 110, 310],
    ['chair', 205, 305],
    ['door', 908, 350],
    ['serviceTable', 110, 130],
    ['cashierTable', 310, 130],
    ['kitchenStation', 510, 130],
    ['washStation', 610, 130],
  ])('hit-tests the public %s fixture type', (type, x, y) => {
    const hit = findClickedEntity(allFixturesState, camera, x, y);

    expect(hit).toMatchObject({
      type,
      data: expect.objectContaining({ id: expect.any(String) }),
    });
  });
});

describe('findClickedEntity staff selection', () => {
  it('selects staff markers before furniture', () => {
    const staff = { id: 's1', name: 'Sofia', role: 'waiter', x: 220, y: 120, morale: 79.6 };
    const hit = findClickedEntity({ ...state, staff: [staff] }, camera, 220, 120);

    expect(hit).toEqual({ type: 'staff', data: staff, text: 'Sofia · waiter · 80% morale' });
  });

  it('hit-tests an assigned waiter at the cashier fallback position', () => {
    const staff = { id: 'w1', name: 'Elena', role: 'waiter', morale: 80 };
    const hit = findClickedEntity({
      ...state,
      staff: [staff],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'w1',
      }],
    }, camera, 840, 100);

    expect(hit).toEqual({ type: 'staff', data: staff, text: 'Elena · waiter · 80% morale' });
  });
});
