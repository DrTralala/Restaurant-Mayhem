import { screenToWorld } from './camera';
import { getDefaultStaffPosition } from '../simulation/world';
import { getFixtureLabel, getFixtureRect, listFixtures } from '../data/fixtures';
import { humaniseIdentifier } from '../typography';

export function findClickedEntity(state, camera, screenX, screenY) {
  const world = screenToWorld(camera, screenX, screenY);

  for (const [index, staff] of (state.staff || []).entries()) {
    const position = Number.isFinite(staff.x) && Number.isFinite(staff.y)
      ? staff
      : getDefaultStaffPosition(staff.role, index, state, staff.id);
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
