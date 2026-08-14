import { describe, expect, it } from 'vitest';
import { getPlaceable } from '../data/placeables';
import {
  getPlacementRect,
  snapPlacement,
  validatePlacement,
} from './placement';

const state = {
  restaurant: { expansionLevel: 1 },
  tables: [{ id: 't1', x: 200, y: 200, status: 'empty', seats: 2 }],
  chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 }],
  kitchenStations: [{ id: 'k1', x: 100, y: 120, equipmentId: 'eq1' }],
  serviceTables: [{ id: 'st1', x: 140, y: 120 }],
  cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
  doors: [{ id: 'door1', y: 340 }],
};

it('exposes canonical prices and footprints', () => {
  expect(getPlaceable('table')).toMatchObject({ price: 300, width: 40, height: 40 });
  expect(getPlaceable('chair')).toMatchObject({ price: 50, width: 20, height: 20, rotatable: true });
  expect(getPlaceable('door')).toMatchObject({ price: 400, width: 6, height: 40 });
  expect(getPlaceable('serviceTable')).toMatchObject({ price: 300, width: 120, height: 40 });
  expect(getPlaceable('cashierTable')).toMatchObject({ price: 300, width: 80, height: 40 });
});

it('snaps chairs to the ten-pixel grid and doors to the right wall', () => {
  expect(snapPlacement('chair', { x: 137, y: 83 }, state)).toMatchObject({ x: 140, y: 80 });
  const door = snapPlacement('door', { x: 1, y: 361 }, state);
  expect(door.x).toBeGreaterThan(800);
  expect(door.y % 20).toBe(0);
});

it('rejects collisions and accepts a free cashier-table footprint', () => {
  expect(validatePlacement(state, { itemType: 'table', x: 200, y: 200, rotation: 0 }).valid).toBe(false);
  expect(validatePlacement(state, { itemType: 'cashierTable', x: 600, y: 300, rotation: 0 }).valid).toBe(true);
});

it('rejects a cashier table whose work cell is beyond the top edge', () => {
  expect(validatePlacement(state, {
    itemType: 'cashierTable', x: 600, y: 50, rotation: 0,
  })).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
});

it('rejects a cashier table whose work cell is blocked by adjacent furniture', () => {
  const blocked = {
    ...state,
    chairs: [
      ...state.chairs,
      { id: 'work-blocker', tableId: 't1', x: 640, y: 280, rotation: 0 },
    ],
  };

  expect(validatePlacement(blocked, {
    itemType: 'cashierTable', x: 600, y: 300, rotation: 0,
  })).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
});

it('rejects a cashier table whose open work cell is unreachable', () => {
  const enclosed = {
    ...state,
    chairs: [
      ...state.chairs,
      { id: 'work-top', tableId: 't1', x: 640, y: 260, rotation: 0 },
      { id: 'work-left', tableId: 't1', x: 620, y: 280, rotation: 0 },
      { id: 'work-right', tableId: 't1', x: 660, y: 280, rotation: 0 },
    ],
  };

  expect(validatePlacement(enclosed, {
    itemType: 'cashierTable', x: 600, y: 300, rotation: 0,
  })).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
});

it('requires a purchasable chair to be adjacent to a table with an open seat', () => {
  expect(validatePlacement(state, { itemType: 'chair', x: 210, y: 240, rotation: 0 })).toMatchObject({ valid: true, tableId: 't1' });
  expect(validatePlacement(state, { itemType: 'chair', x: 600, y: 300, rotation: 0 }).valid).toBe(false);
});
