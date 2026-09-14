import { screenToWorld } from './camera';
import { getDefaultStaffPosition } from '../simulation/world';
import { getFixtureLabel, getFixtureRect, listFixtures } from '../data/fixtures';
import { getAmenityGeometry } from '../data/staffAmenities';
import { humaniseIdentifier } from '../typography';

function getStaffDisplayPosition(state, staff, index) {
  const fallback = Number.isFinite(staff?.x) && Number.isFinite(staff?.y)
    ? { x: staff.x, y: staff.y }
    : getDefaultStaffPosition(staff.role, index, state, staff.id);
  const residency = staff?.movementResidency;
  const amenity = residency?.kind === 'staff_amenity'
    ? (state.staffAmenities || []).find(candidate =>
      String(candidate?.id) === String(residency.amenityId))
    : null;
  if (amenity && staff.amenityUse?.phase === 'occupied'
    && ['couch', 'bed'].includes(amenity.type)) {
    const geometry = getAmenityGeometry(amenity);
    const anchor = geometry?.slotAnchors?.[residency.slotIndex] || geometry?.slotAnchors?.[0];
    if (anchor) return anchor;
  }
  return { x: fallback.x, y: fallback.y - 4 };
}

export function findClickedEntity(state, camera, screenX, screenY) {
  const world = screenToWorld(camera, screenX, screenY);

  for (const [index, staff] of (state.staff || []).entries()) {
    const position = getStaffDisplayPosition(state, staff, index);
    if (Math.hypot(world.x - position.x, world.y - position.y) <= 12) {
      return {
        type: 'staff',
        data: staff,
        text: `${staff.name} · ${humaniseIdentifier(staff.role)} · ${Math.round(staff.morale)}% morale`,
      };
    }
  }

  for (const fixture of listFixtures(state)) {
    const rect = getFixtureRect(state, fixture);
    if (rect && world.x >= rect.x && world.x <= rect.x + rect.w
      && world.y >= rect.y && world.y <= rect.y + rect.h) {
      return {
        type: fixture.type,
        data: fixture.data,
        text: getFixtureLabel(state, fixture),
      };
    }
  }

  return null;
}
