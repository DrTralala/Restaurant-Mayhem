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
});
