import { describe, expect, it } from 'vitest';
import { getPlaceable } from './placeables';
import * as staffAmenities from './staffAmenities';
import { getAmenityGeometry } from './staffAmenities';

const AMENITIES = [
  ['couch', { width: 40, height: 20, capacity: 2, price: 400, sessionSeconds: 900, moralePerHour: 6 }],
  ['breakBench', { width: 60, height: 20, capacity: 3, price: 500, sessionSeconds: 900, moralePerHour: 4 }],
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
  it.each([
    ['couch', { duty: 'rest', posture: 'seated', activity: 'resting' }],
    ['breakBench', { duty: 'rest', posture: 'seated', activity: 'resting' }],
    ['arcade', { duty: 'rest', posture: 'standing', activity: 'gaming' }],
    ['bed', { duty: 'pto', posture: 'lying', activity: 'sleeping' }],
  ])('publishes the %s duty, posture and activity policy', (type, policy) => {
    expect(getPlaceable(type)).toMatchObject(policy);
    expect(staffAmenities.getStaffAmenityDefinition(type)).toMatchObject(policy);
  });

  it('exposes shared duty eligibility and anchored-residency predicates', () => {
    expect(staffAmenities.isStaffAmenityEligibleForDuty?.('couch', 'rest')).toBe(true);
    expect(staffAmenities.isStaffAmenityEligibleForDuty?.('breakBench', 'rest')).toBe(true);
    expect(staffAmenities.isStaffAmenityEligibleForDuty?.('arcade', 'rest')).toBe(true);
    expect(staffAmenities.isStaffAmenityEligibleForDuty?.('bed', 'pto')).toBe(true);
    expect(staffAmenities.isStaffAmenityEligibleForDuty?.('couch', 'pto')).toBe(false);
    expect(staffAmenities.isStaffAmenityEligibleForDuty?.('bed', 'rest')).toBe(false);

    expect(staffAmenities.hasStaffAmenityAnchoredResidency?.('couch')).toBe(true);
    expect(staffAmenities.hasStaffAmenityAnchoredResidency?.('breakBench')).toBe(true);
    expect(staffAmenities.hasStaffAmenityAnchoredResidency?.('bed')).toBe(true);
    expect(staffAmenities.hasStaffAmenityAnchoredResidency?.('arcade')).toBe(false);
  });

  it('rejects unknown amenity types in shared policy predicates', () => {
    expect(staffAmenities.getStaffAmenityDefinition('unknown')).toBeUndefined();
    expect(staffAmenities.isStaffAmenityEligibleForDuty?.('unknown', 'rest')).toBe(false);
    expect(staffAmenities.hasStaffAmenityAnchoredResidency?.('unknown')).toBe(false);
  });

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
    expect(geometry.approachPoints[0]).not.toEqual(geometry.approachPoints[1]);
  });

  it('returns the three documented break bench anchors, approaches and perimeter exits', () => {
    const geometry = getAmenityGeometry({ type: 'breakBench', x: 100, y: 200, rotation: 0 });

    expect(geometry).toMatchObject({
      footprint: { x: 100, y: 200, w: 60, h: 20 },
      slotAnchors: [{ x: 110, y: 210 }, { x: 130, y: 210 }, { x: 150, y: 210 }],
      approachPoints: [{ x: 110, y: 230 }, { x: 130, y: 230 }, { x: 150, y: 230 }],
      exitCandidates: [
        { x: 110, y: 230 }, { x: 130, y: 230 }, { x: 150, y: 230 },
        { x: 110, y: 190 }, { x: 130, y: 190 }, { x: 150, y: 190 },
        { x: 90, y: 210 }, { x: 90, y: 230 },
        { x: 170, y: 210 }, { x: 170, y: 230 },
      ],
    });
    expect(staffAmenities.createEmptyAmenitySlots('breakBench')).toEqual([
      { index: 0, reservedBy: null, occupiedBy: null },
      { index: 1, reservedBy: null, occupiedBy: null },
      { index: 2, reservedBy: null, occupiedBy: null },
    ]);
  });

  it.each([
    [0, { w: 60, h: 20 },
      [{ x: 110, y: 210 }, { x: 130, y: 210 }, { x: 150, y: 210 }],
      [{ x: 110, y: 230 }, { x: 130, y: 230 }, { x: 150, y: 230 }]],
    [1, { w: 20, h: 60 },
      [{ x: 110, y: 210 }, { x: 110, y: 230 }, { x: 110, y: 250 }],
      [{ x: 90, y: 210 }, { x: 90, y: 230 }, { x: 90, y: 250 }]],
    [2, { w: 60, h: 20 },
      [{ x: 150, y: 210 }, { x: 130, y: 210 }, { x: 110, y: 210 }],
      [{ x: 150, y: 190 }, { x: 130, y: 190 }, { x: 110, y: 190 }]],
    [3, { w: 20, h: 60 },
      [{ x: 110, y: 250 }, { x: 110, y: 230 }, { x: 110, y: 210 }],
      [{ x: 130, y: 250 }, { x: 130, y: 230 }, { x: 130, y: 210 }]],
  ])('rotates break bench entry geometry for rotation %s', (rotation, footprint, slotAnchors, approachPoints) => {
    expect(getAmenityGeometry({ type: 'breakBench', x: 100, y: 200, rotation })).toMatchObject({
      footprint: { x: 100, y: 200, ...footprint },
      slotAnchors,
      approachPoints,
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
