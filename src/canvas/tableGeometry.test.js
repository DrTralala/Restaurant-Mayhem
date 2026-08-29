import { describe, expect, it } from 'vitest';
import { getChairFacingRadians, getPlaceSettingPositions } from './tableGeometry';

describe('table geometry', () => {
  it('places dual top settings inside the nearest table edge', () => {
    const positions = getPlaceSettingPositions({ x: 200, y: 200 }, { x: 210, y: 180, rotation: 2 }, ['dish', 'drink']);
    expect(positions.dish.y).toBeGreaterThanOrEqual(200);
    expect(positions.drink.y).toBeGreaterThanOrEqual(200);
    expect(positions.dish).not.toEqual(positions.drink);
    expect(getChairFacingRadians(2)).toBe(Math.PI);
  });

  it.each([
    [{ x: 210, y: 180 }, 'y', 200], [{ x: 240, y: 210 }, 'x', 240],
    [{ x: 210, y: 240 }, 'y', 240], [{ x: 180, y: 210 }, 'x', 200],
  ])('anchors a chair on the nearest edge', (chair, axis, value) => {
    expect(getPlaceSettingPositions({ x: 200, y: 200 }, chair, ['dish']).dish[axis]).toBe(value);
  });

  it('returns only requested kinds', () => {
    expect(getPlaceSettingPositions({ x: 200, y: 200 }, { x: 210, y: 180 }, ['drink'])).toEqual({
      drink: { x: 220, y: 200 },
    });
  });

  it.each([
    ['overlapping chair', { x: 205, y: 205 }],
    ['non-finite chair', { x: Number.NaN, y: 180 }],
  ])('returns no positions for %s geometry', (_label, chair) => {
    expect(getPlaceSettingPositions({ x: 200, y: 200 }, chair, ['dish', 'drink'])).toEqual({});
  });
});
