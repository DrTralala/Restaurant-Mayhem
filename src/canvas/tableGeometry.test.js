import { describe, expect, it } from 'vitest';
import { getChairFacingRadians, getPlaceSettingPositions } from './tableGeometry';

describe('table geometry', () => {
  it.each([
    ['top', { x: 210, y: 180 }, { dish: { x: 226, y: 200 }, drink: { x: 214, y: 200 } }],
    ['right', { x: 240, y: 210 }, { dish: { x: 240, y: 226 }, drink: { x: 240, y: 214 } }],
    ['bottom', { x: 210, y: 240 }, { dish: { x: 214, y: 240 }, drink: { x: 226, y: 240 } }],
    ['left', { x: 180, y: 210 }, { dish: { x: 200, y: 214 }, drink: { x: 200, y: 226 } }],
  ])('places food left and drink right for the %s chair', (_side, chair, expected) => {
    expect(getPlaceSettingPositions({ x: 200, y: 200 }, chair, ['dish', 'drink']))
      .toEqual(expected);
  });

  it('uses the chair-facing rotation', () => {
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
