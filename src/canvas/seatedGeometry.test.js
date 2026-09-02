import { describe, expect, it } from 'vitest';
import { getSeatedDisplayGeometry } from './seatedGeometry';

describe('getSeatedDisplayGeometry', () => {
  it('keeps the figure upright and centres the menu beneath a customer on the right', () => {
    expect(getSeatedDisplayGeometry(
      { id: 'chair', x: 100, y: 100 },
      { id: 'table', x: 140, y: 90 },
    )).toEqual({
      figure: { x: 110, y: 105 },
      menu: { x: 98, y: 112, width: 24, height: 16 },
    });
  });

  it('centres the menu beneath a customer at a diagonal table', () => {
    const result = getSeatedDisplayGeometry(
      { x: 100, y: 100 },
      { x: 130, y: 130 },
    );
    expect(result.figure).toEqual({ x: 110, y: 105 });
    expect(result.menu.x + result.menu.width / 2).toBe(110);
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
    ['right', { x: 140, y: 90 }],
    ['left', { x: 40, y: 90 }],
  ])('centres the menu beneath the customer for a table on the %s', (_side, table) => {
    const { menu } = getSeatedDisplayGeometry({ x: 100, y: 100 }, table);
    expect({ x: menu.x + 12, y: menu.y + 8 }).toEqual({ x: 110, y: 120 });
  });

  it('leaves the top customer and menu at their normal chair position', () => {
    expect(getSeatedDisplayGeometry(
      { x: 100, y: 100 },
      { x: 90, y: 140 },
    )).toEqual({
      figure: { x: 110, y: 105 },
      menu: { x: 98, y: 112, width: 24, height: 16 },
    });
  });

  it('keeps the bottom customer and menu fitted to their chair', () => {
    expect(getSeatedDisplayGeometry(
      { x: 100, y: 100 },
      { x: 90, y: 40 },
    )).toEqual({
      figure: { x: 110, y: 105 },
      menu: { x: 98, y: 112, width: 24, height: 16 },
    });
  });

  it('returns null instead of inventing geometry for a missing assignment', () => {
    expect(getSeatedDisplayGeometry(null, { x: 100, y: 100 })).toBeNull();
  });
});
