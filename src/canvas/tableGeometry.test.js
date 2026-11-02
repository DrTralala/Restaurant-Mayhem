import { describe, expect, it } from 'vitest';
import { getChairFacingRadians, getPlaceSettingPositions } from './tableGeometry';

describe('table geometry', () => {
  it.each([
    ['top', { x: 210, y: 180 }, { dish: { x: 226, y: 208 }, drink: { x: 214, y: 208 } }],
    ['right', { x: 240, y: 210 }, { dish: { x: 232, y: 226 }, drink: { x: 232, y: 214 } }],
    ['bottom', { x: 210, y: 240 }, { dish: { x: 214, y: 232 }, drink: { x: 226, y: 232 } }],
    ['left', { x: 180, y: 210 }, { dish: { x: 208, y: 214 }, drink: { x: 208, y: 226 } }],
  ])('places food left and drink right for the %s chair', (_side, chair, expected) => {
    expect(getPlaceSettingPositions({ x: 200, y: 200 }, chair, ['dish', 'drink']))
      .toEqual(expected);
  });

  it.each([
    ['north', { x: 210, y: 180 }],
    ['east', { x: 240, y: 210 }],
    ['south', { x: 210, y: 240 }],
    ['west', { x: 180, y: 210 }],
  ])('places paired items symmetrically for a %s chair', (_side, chair) => {
    const table = { x: 200, y: 200 };
    const positions = getPlaceSettingPositions(table, chair, ['dish', 'drink']);
    const midpoint = {
      x: (positions.dish.x + positions.drink.x) / 2,
      y: (positions.dish.y + positions.drink.y) / 2,
    };
    const chairCentre = { x: chair.x + 10, y: chair.y + 10 };
    const tableCentre = { x: table.x + 20, y: table.y + 20 };
    const length = Math.hypot(tableCentre.x - chairCentre.x, tableCentre.y - chairCentre.y);
    const facing = {
      x: (tableCentre.x - chairCentre.x) / length,
      y: (tableCentre.y - chairCentre.y) / length,
    };
    const localLeft = { x: facing.y, y: -facing.x };
    const dishSide = (positions.dish.x - midpoint.x) * localLeft.x
      + (positions.dish.y - midpoint.y) * localLeft.y;
    const drinkSide = (positions.drink.x - midpoint.x) * localLeft.x
      + (positions.drink.y - midpoint.y) * localLeft.y;
    expect(Math.hypot(positions.dish.x - midpoint.x, positions.dish.y - midpoint.y))
      .toBeCloseTo(Math.hypot(positions.drink.x - midpoint.x, positions.drink.y - midpoint.y));
    expect(dishSide).toBeGreaterThan(0);
    expect(drinkSide).toBeLessThan(0);
  });

  it('uses the chair-facing rotation', () => {
    expect(getChairFacingRadians(2)).toBe(Math.PI);
  });

  it.each([
    [{ x: 210, y: 180 }, 'y', 208], [{ x: 240, y: 210 }, 'x', 232],
    [{ x: 210, y: 240 }, 'y', 232], [{ x: 180, y: 210 }, 'x', 208],
  ])('insets a chair place setting from the nearest edge', (chair, axis, value) => {
    expect(getPlaceSettingPositions({ x: 200, y: 200 }, chair, ['dish']).dish[axis]).toBe(value);
  });

  it('returns only requested kinds', () => {
    expect(getPlaceSettingPositions({ x: 200, y: 200 }, { x: 210, y: 180 }, ['drink'])).toEqual({
      drink: { x: 220, y: 208 },
    });
  });

  it.each([
    ['overlapping chair', { x: 205, y: 205 }],
    ['non-finite chair', { x: Number.NaN, y: 180 }],
  ])('returns no positions for %s geometry', (_label, chair) => {
    expect(getPlaceSettingPositions({ x: 200, y: 200 }, chair, ['dish', 'drink'])).toEqual({});
  });

  it.each([
    [0, { x: 300, y: 300 }, { x: 300, y: 320 }, { dish: { x: 305, y: 312 }, drink: { x: 315, y: 312 } }],
    [1, { x: 320, y: 300 }, { x: 300, y: 300 }, { dish: { x: 328, y: 305 }, drink: { x: 328, y: 315 } }],
    [2, { x: 360, y: 320 }, { x: 360, y: 300 }, { dish: { x: 375, y: 328 }, drink: { x: 365, y: 328 } }],
    [3, { x: 300, y: 360 }, { x: 320, y: 360 }, { dish: { x: 312, y: 375 }, drink: { x: 312, y: 365 } }],
  ])('keeps paired counter place settings inside their 20px block at rotation %s', (_rotation, tablePoint, chairPoint, expected) => {
    const table = { ...tablePoint, highTopCounterId: 'counter' };
    const chair = { ...chairPoint, highTopCounterId: 'counter' };
    const positions = getPlaceSettingPositions(table, chair, ['dish', 'drink']);

    expect(positions).toEqual(expected);
    for (const point of Object.values(positions)) {
      expect(point.x - 5).toBeGreaterThanOrEqual(table.x);
      expect(point.x + 5).toBeLessThanOrEqual(table.x + 20);
      expect(point.y - 5).toBeGreaterThanOrEqual(table.y);
      expect(point.y + 5).toBeLessThanOrEqual(table.y + 20);
    }
  });
});
