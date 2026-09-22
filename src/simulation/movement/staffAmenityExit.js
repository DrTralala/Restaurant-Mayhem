import { getAmenityGeometry } from '../../data/staffAmenities';
import { createGrid } from '../navigation/grid';
import {
  createNavigationWorkspace,
  isSafeSegment,
} from './navigationWorkspace';

const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const samePoint = (left, right) => finitePoint(left) && finitePoint(right)
  && left.x === right.x && left.y === right.y;

/**
 * Prove the static part of a staff amenity exit from its own slot anchor.
 * Actor reservations are deliberately left to the movement coordinator.
 */
export function isStaticStaffAmenityExit(
  state,
  amenity,
  slotIndex,
  goal,
  { workspace = null, grid = null } = {},
) {
  if (!state || !amenity
    || !Number.isInteger(slotIndex) || slotIndex < 0 || !finitePoint(goal)) return false;
  const geometry = getAmenityGeometry(amenity);
  const origin = geometry?.slotAnchors?.[slotIndex];
  if (!origin || !geometry.exitCandidates.some(candidate => samePoint(candidate, goal))) return false;

  const navigation = workspace || createNavigationWorkspace(state);
  const staticGrid = grid || createGrid(state, navigation);
  return staticGrid.isOpen(goal)
    && isSafeSegment(state, origin, goal, { workspace: navigation });
}
