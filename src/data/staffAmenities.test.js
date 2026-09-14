import { describe, expect, it } from 'vitest';
import { getPlaceable } from './placeables';
import { getAmenityGeometry } from './staffAmenities';

const AMENITIES = [
  ['couch', { width: 40, height: 20, capacity: 2, price: 400, sessionSeconds: 900, moralePerHour: 6 }],
  ['arcade', { width: 20, height: 20, capacity: 1, price: 800, sessionSeconds: 600, moralePerHour: 8 }],
  ['bed', {
    width: 20, height: 40, capacity: 1, price: 500, minimumSleepSeconds: 25_200, fullMorale: true,
  }],
];

function isExterior(point, footprint) {
  return point.x < footprint.x
    || point.x >= footprint.x + footprint.w
    || point.y < footprint.y
    || point.y >= footprint.y + footprint.h;
}

describe('staff amenities', () => {
  it.each(AMENITIES)('exposes the %s placeable policy', (type, expected) => {
    expect(getPlaceable(type)).toMatchObject({ type, grid: 20, rotatable: true, ...expected });
  });

  it('returns the documented absolute couch geometry at rotation zero', () => {
    const geometry = getAmenityGeometry({ type: 'couch', x: 100, y: 200, rotation: 0 });

    expect(Object.keys(geometry)).toEqual([
      'footprint', 'slotAnchors', 'approachPoints', 'exitCandidates',
    ]);
    expect(geometry).toMatchObject({
      footprint: { x: 100, y: 200, w: 40, h: 20 },
      slotAnchors: [{ x: 110, y: 210 }, { x: 130, y: 210 }],
      approachPoints: [{ x: 110, y: 230 }, { x: 130, y: 230 }],
    });
  });

  it('centres bed entry along the long axis on the left at rotation zero', () => {
    expect(getAmenityGeometry({ type: 'bed', x: 200, y: 300, rotation: 0 })).toMatchObject({
      footprint: { x: 200, y: 300, w: 20, h: 40 },
      slotAnchors: [{ x: 210, y: 320 }],
      approachPoints: [{ x: 190, y: 320 }],
    });
  });

  it('puts the arcade interaction point directly in front at rotation zero', () => {
    expect(getAmenityGeometry({ type: 'arcade', x: 300, y: 300, rotation: 0 })).toMatchObject({
      footprint: { x: 300, y: 300, w: 20, h: 20 },
      slotAnchors: [{ x: 310, y: 310 }],
      approachPoints: [{ x: 310, y: 330 }],
    });
  });

  it('rotates every amenity geometry while keeping all access points exterior', () => {
    for (const [type, expected] of AMENITIES) {
      for (const rotation of [0, 1, 2, 3]) {
        const geometry = getAmenityGeometry({ type, x: 500, y: 300, rotation });

        expect(geometry.footprint.w * geometry.footprint.h).toBe(expected.width * expected.height);
        expect(geometry.slotAnchors).toHaveLength(expected.capacity);
        expect(geometry.approachPoints.every(point => isExterior(point, geometry.footprint))).toBe(true);
        expect(geometry.exitCandidates.every(point => isExterior(point, geometry.footprint))).toBe(true);
      }
    }
  });

  it('returns null for malformed or unknown amenity records', () => {
    expect(getAmenityGeometry({ type: 'unknown', x: 100, y: 100 })).toBeNull();
    expect(getAmenityGeometry({ type: 'couch', x: Number.NaN, y: 100 })).toBeNull();
  });
});
