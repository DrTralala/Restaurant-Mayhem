import { describe, expect, it } from 'vitest';
import { getRestaurantWorld } from '../simulation/world';
import {
  buildCopyItems,
  buildMoveItems,
  expandSelectedFixtures,
  getFixturePlacementType,
  getMoveItem,
  isRotatableMoveItem,
} from './fixtureTransforms';

const baseState = {
  restaurant: { expansionLevel: 1 },
  tables: [],
  chairs: [],
  doors: [],
  serviceTables: [],
  cashierStations: [],
  kitchenStations: [],
  washStations: [],
  staffAmenities: [],
};

describe('fixture transform helpers', () => {
  it('resolves fixture placement metadata and expands selected fixtures into move items', () => {
    const state = {
      ...baseState,
      tables: [{ id: 't1', seats: 2, x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 }],
    };

    expect(getFixturePlacementType({ type: 'table', data: state.tables[0] })).toBe('table');
    expect(isRotatableMoveItem(state, { type: 'chair', id: 'ch1' })).toBe(true);
    expect(isRotatableMoveItem(state, { type: 'table', id: 't1' })).toBe(false);
    expect(expandSelectedFixtures(state, [{ type: 'table', id: 't1' }])).toEqual([
      { type: 'table', id: 't1', x: 200, y: 200 },
      { type: 'chair', id: 'ch1', x: 210, y: 180, rotation: 2 },
    ]);
  });

  it('translates linked chairs by the snapped table delta', () => {
    const state = {
      ...baseState,
      tables: [{ id: 't1', seats: 2, x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 }],
    };
    const originalItems = [
      getMoveItem(state, { type: 'table', id: 't1', data: state.tables[0] }),
      getMoveItem(state, { type: 'chair', id: 'ch1', data: state.chairs[0] }),
    ];

    expect(buildMoveItems(state, originalItems, { x: 200, y: 200 }, { x: 253, y: 269 })).toEqual([
      { type: 'table', id: 't1', x: 260, y: 260 },
      { type: 'chair', id: 'ch1', x: 270, y: 240, rotation: 2 },
    ]);
  });

  it('keeps an independent chair independently snapped', () => {
    const state = {
      ...baseState,
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 }],
    };
    const originalItem = getMoveItem(state, {
      type: 'chair',
      id: 'ch1',
      data: state.chairs[0],
    });

    expect(buildMoveItems(state, [originalItem], { x: 210, y: 180 }, { x: 253, y: 269 })).toEqual([
      { type: 'chair', id: 'ch1', x: 250, y: 270, rotation: 2 },
    ]);
  });

  it('uses the authoritative wall X when copying or moving a door', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 100, role: 'entrance' }],
    };
    const originalItem = { type: 'door', id: 'door1', x: 0, y: 100 };
    const anchor = { x: 0, y: 100 };
    const world = { x: 123, y: 261 };
    const wallX = getRestaurantWorld(state.restaurant).doorX;

    expect(buildCopyItems(state, [originalItem], anchor, world)[0]).toEqual({
      ...originalItem,
      x: wallX,
      y: 260,
    });
    expect(buildMoveItems(state, [originalItem], anchor, world)[0]).toEqual({
      ...originalItem,
      x: wallX,
      y: 260,
    });
  });

  it('preserves relative offsets when translating a copy', () => {
    const state = {
      ...baseState,
      tables: [{ id: 't1', seats: 2, x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 230, y: 180, rotation: 2 }],
    };
    const originalItems = [
      { type: 'table', id: 't1', x: 200, y: 200 },
      { type: 'chair', id: 'ch1', x: 230, y: 180, rotation: 2 },
    ];

    expect(buildCopyItems(
      state,
      originalItems,
      { x: 200, y: 200 },
      { x: 360, y: 340 },
    )).toEqual([
      { type: 'table', id: 't1', x: 360, y: 340 },
      { type: 'chair', id: 'ch1', x: 390, y: 320, rotation: 2 },
    ]);
  });
});
