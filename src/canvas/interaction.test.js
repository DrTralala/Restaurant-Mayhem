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
  foodItems: [],
};
const camera = { x: 0, y: 0, zoom: 1 };

describe('findClickedEntity table labels', () => {
  it('uses the sequential table number in table tooltips', () => {
    expect(findClickedEntity(state, camera, 220, 120).text).toBe('Table 2 · 2 seats · empty');
  });

  it('uses the sequential table number in chair tooltips', () => {
    expect(findClickedEntity(state, camera, 195, 95).text).toBe('Chair · Table 2');
  });
});

describe('findClickedEntity staff selection', () => {
  it('selects staff markers before furniture', () => {
    const staff = { id: 's1', name: 'Sofia', role: 'waiter', x: 220, y: 120, morale: 79.6 };
    const hit = findClickedEntity({ ...state, staff: [staff] }, camera, 220, 120);

    expect(hit).toEqual({ type: 'staff', data: staff, text: 'Sofia · waiter · 80% morale' });
  });
});
