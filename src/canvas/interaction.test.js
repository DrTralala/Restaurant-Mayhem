import { describe, expect, it } from 'vitest';
import { findClickedEntity } from './interaction';

const state = {
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

describe('findClickedEntity table labels', () => {
  it('uses unnumbered table tooltips', () => {
    expect(findClickedEntity(state, camera, 220, 120).text).toBe('Dining table · 2 seats · empty');
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
    expect(hit.text).toBe('Service Counter · 2 items waiting');
    expect(hit.text).not.toContain('3');
  });

  it('handles malformed truthy serviceItems on a counter', () => {
    expect(() => findClickedEntity({ ...state, serviceTables: [{ id: 'a', x: 0, y: 0 }], serviceItems: {} }, camera, 10, 10)).not.toThrow();
    expect(findClickedEntity({ ...state, serviceTables: [{ id: 'a', x: 0, y: 0 }], serviceItems: {} }, camera, 10, 10).text)
      .toBe('Service Counter · 0 items waiting');
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
