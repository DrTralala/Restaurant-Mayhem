import { describe, expect, it } from 'vitest';
import { getSeatedDisplayGeometry } from './seatedGeometry';

describe('getSeatedDisplayGeometry', () => {
  it('keeps the figure upright and places the menu towards a table on the right', () => {
    expect(getSeatedDisplayGeometry(
      { id: 'chair', x: 100, y: 100 },
      { id: 'table', x: 140, y: 90 },
    )).toEqual({
      figure: { x: 110, y: 105 },
      menu: { x: 108, y: 112, width: 24, height: 16 },
    });
  });

  it('normalises a diagonal chair-to-table direction', () => {
    const result = getSeatedDisplayGeometry(
      { x: 100, y: 100 },
      { x: 130, y: 130 },
    );
    expect(result.figure).toEqual({ x: 110, y: 105 });
    expect(result.menu.x + result.menu.width / 2).toBeCloseTo(110 + 10 / Math.sqrt(2));
    expect(result.menu.y + result.menu.height / 2).toBe(120);
  });

  it('keeps the menu below the face when the table is above the customer', () => {
    const { figure, menu } = getSeatedDisplayGeometry(
      { x: 100, y: 100 },
      { x: 90, y: 40 },
    );

    expect(menu.y).toBeGreaterThan(figure.y + 4);
  });

  it.each([
    ['right', { x: 140, y: 90 }, { x: 120, y: 120 }],
    ['left', { x: 40, y: 90 }, { x: 100, y: 120 }],
    ['below', { x: 90, y: 140 }, { x: 110, y: 120 }],
    ['above', { x: 90, y: 40 }, { x: 110, y: 120 }],
  ])('places the menu towards a table on the %s', (_side, table, expectedCentre) => {
    const { menu } = getSeatedDisplayGeometry({ x: 100, y: 100 }, table);
    expect({ x: menu.x + 12, y: menu.y + 8 }).toEqual(expectedCentre);
  });

  it('returns null instead of inventing geometry for a missing assignment', () => {
    expect(getSeatedDisplayGeometry(null, { x: 100, y: 100 })).toBeNull();
  });
});
