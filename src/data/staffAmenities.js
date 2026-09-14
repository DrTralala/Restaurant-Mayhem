import { getPlaceable, getPlaceableDimensions } from './placeables';

export const STAFF_AMENITY_TYPES = Object.freeze({
  couch: getPlaceable('couch'),
  arcade: getPlaceable('arcade'),
  bed: getPlaceable('bed'),
});

export const AMENITY_TYPES = STAFF_AMENITY_TYPES;

const LOCAL_GEOMETRY = Object.freeze({
  couch: Object.freeze({
    slotAnchors: Object.freeze([{ x: 10, y: 10 }, { x: 30, y: 10 }]),
    approachPoints: Object.freeze([{ x: 10, y: 30 }, { x: 30, y: 30 }]),
    exitCandidates: Object.freeze([
      { x: 10, y: -10 }, { x: 30, y: -10 },
      { x: -10, y: 10 }, { x: -10, y: 30 },
      { x: 50, y: 10 }, { x: 50, y: 30 },
      { x: 10, y: 30 }, { x: 30, y: 30 },
    ]),
  }),
  arcade: Object.freeze({
    slotAnchors: Object.freeze([{ x: 10, y: 10 }]),
    approachPoints: Object.freeze([{ x: 10, y: 30 }]),
    exitCandidates: Object.freeze([
      { x: 10, y: -10 }, { x: -10, y: 10 },
      { x: 30, y: 10 }, { x: 10, y: 30 },
    ]),
  }),
  bed: Object.freeze({
    slotAnchors: Object.freeze([{ x: 10, y: 20 }]),
    approachPoints: Object.freeze([{ x: -10, y: 20 }]),
    exitCandidates: Object.freeze([
      { x: -10, y: 20 }, { x: 30, y: 20 },
      { x: 10, y: -10 }, { x: 10, y: 50 },
    ]),
  }),
});

function normaliseRotation(rotation) {
  return Number.isInteger(rotation) ? ((rotation % 4) + 4) % 4 : 0;
}

function rotateLocalPoint(point, width, height, rotation) {
  if (rotation === 1) return { x: height - point.y, y: point.x };
  if (rotation === 2) return { x: width - point.x, y: height - point.y };
  if (rotation === 3) return { x: point.y, y: width - point.x };
  return { x: point.x, y: point.y };
}

function toAbsolutePoint(point, amenity, width, height, rotation) {
  const rotated = rotateLocalPoint(point, width, height, rotation);
  return { x: amenity.x + rotated.x, y: amenity.y + rotated.y };
}

function uniquePoints(points) {
  const seen = new Set();
  return points.filter(point => {
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getStaffAmenityDefinition(type) {
  return Object.prototype.hasOwnProperty.call(STAFF_AMENITY_TYPES, type)
    ? STAFF_AMENITY_TYPES[type]
    : undefined;
}

export function isStaffAmenityType(type) {
  return Boolean(getStaffAmenityDefinition(type));
}

/**
 * Return absolute geometry for one staff amenity record.
 *
 * Coordinates use the same top-left origin and clockwise quarter-turn
 * convention as the existing placeable footprints. The returned footprint
 * uses the project's `{ x, y, w, h }` rectangle shape; every point is an
 * absolute world coordinate.
 */
export function getAmenityGeometry(amenity) {
  const definition = getStaffAmenityDefinition(amenity?.type);
  if (!definition || !Number.isFinite(amenity?.x) || !Number.isFinite(amenity?.y)) return null;

  const rotation = normaliseRotation(amenity.rotation);
  const dimensions = getPlaceableDimensions(amenity.type, rotation);
  const local = LOCAL_GEOMETRY[amenity.type];
  if (!dimensions || !local) return null;

  return {
    footprint: {
      x: amenity.x,
      y: amenity.y,
      w: dimensions.width,
      h: dimensions.height,
    },
    slotAnchors: local.slotAnchors.map(point =>
      toAbsolutePoint(point, amenity, definition.width, definition.height, rotation)),
    approachPoints: local.approachPoints.map(point =>
      toAbsolutePoint(point, amenity, definition.width, definition.height, rotation)),
    exitCandidates: uniquePoints(local.exitCandidates.map(point =>
      toAbsolutePoint(point, amenity, definition.width, definition.height, rotation))),
  };
}

export function getAmenityCapacity(type) {
  return getStaffAmenityDefinition(type)?.capacity ?? 0;
}

export function createEmptyAmenitySlots(type) {
  return Array.from({ length: getAmenityCapacity(type) }, (_, index) => ({
    index,
    reservedBy: null,
    occupiedBy: null,
  }));
}

export function isAmenityInUse(amenity) {
  return Array.isArray(amenity?.slots)
    && amenity.slots.some(slot => slot?.reservedBy != null || slot?.occupiedBy != null);
}
