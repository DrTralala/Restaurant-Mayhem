import { describe, expect, it } from 'vitest';
import { selectFurnitureInRect } from './selection';

describe('selectFurnitureInRect', () => {
  it('selects every table and chair intersecting a drag rectangle', () => {
    const state = {
      tables: [
        { id: 't1', x: 20, y: 20 },
        { id: 't2', x: 200, y: 200 },
      ],
      chairs: [
        { id: 'ch1', x: 70, y: 30 },
        { id: 'ch2', x: 250, y: 250 },
      ],
    };

    expect(selectFurnitureInRect(state, { x1: 10, y1: 10, x2: 100, y2: 100 })).toEqual([
      { type: 'table', id: 't1' },
      { type: 'chair', id: 'ch1' },
    ]);
  });

  it('normalises rectangles dragged up and to the left', () => {
    const state = { tables: [{ id: 't1', x: 20, y: 20 }], chairs: [] };

    expect(selectFurnitureInRect(state, { x1: 100, y1: 100, x2: 10, y2: 10 }))
      .toEqual([{ type: 'table', id: 't1' }]);
  });

  it('selects wash stations using the public washStation entity type', () => {
    expect(selectFurnitureInRect({ tables: [], chairs: [], washStations: [{ id: 'wash2', x: 40, y: 40 }] },
      { x1: 0, y1: 0, x2: 100, y2: 100 })).toEqual([{ type: 'washStation', id: 'wash2' }]);
  });

  it('selects every public fixture in catalogue order and excludes actors and items', () => {
    const state = {
      restaurant: { expansionLevel: 1 },
      tables: [{ id: 't1', x: 100, y: 300 }],
      chairs: [{ id: 'ch1', x: 200, y: 300 }],
      doors: [{ id: 'door1', y: 340 }],
      serviceTables: [{ id: 'st1', x: 100, y: 120 }],
      cashierStations: [{ id: 'cashier1', x: 300, y: 120, w: 80, h: 40 }],
      kitchenStations: [{ id: 'k1', x: 500, y: 120 }],
      washStations: [{ id: 'wash1', type: 'manual', x: 600, y: 120 }],
      staff: [{ id: 'staff1', x: 150, y: 500 }],
      customers: [{ id: 'customer1', x: 250, y: 500 }],
      serviceItems: [{ id: 'item1', x: 350, y: 500 }],
    };

    expect(selectFurnitureInRect(state, { x1: 0, y1: 0, x2: 1000, y2: 700 })).toEqual([
      { type: 'table', id: 't1' },
      { type: 'chair', id: 'ch1' },
      { type: 'door', id: 'door1' },
      { type: 'serviceTable', id: 'st1' },
      { type: 'cashierTable', id: 'cashier1' },
      { type: 'kitchenStation', id: 'k1' },
      { type: 'washStation', id: 'wash1' },
    ]);
  });
});
