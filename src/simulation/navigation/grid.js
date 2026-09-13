import { GRID_SIZE, getDoors, getRestaurantWorld, isDoorRoleForFlow } from '../world';
import { cellKey, cellToWorld, resolveNavigationWorkspace, worldToCell } from '../movement/navigationWorkspace';

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const comparePoints = (a, b) => a.y - b.y || a.x - b.x;

export function isLatticePoint(point) {
  return finitePoint(point) && point.x % GRID_SIZE === 0 && point.y % GRID_SIZE === 0;
}

export function latticeAnchors(point) {
  if (!finitePoint(point)) return [];
  const xs = [...new Set([Math.floor(point.x / GRID_SIZE), Math.ceil(point.x / GRID_SIZE)])];
  const ys = [...new Set([Math.floor(point.y / GRID_SIZE), Math.ceil(point.y / GRID_SIZE)])];
  return ys.flatMap(y => xs.map(x => cellToWorld({ x, y }))).sort(comparePoints);
}

function flowBlockedCells(state, navigation, doorFlow) {
  if (!doorFlow || !['ingress', 'egress'].includes(doorFlow.direction)) {
    return navigation.blockedCells;
  }

  const blocked = new Set(navigation.blockedCellKeys);
  const world = getRestaurantWorld(state.restaurant || {});
  const wallCellX = worldToCell({ x: world.doorX, y: 0 }).x;
  const allowedDoorId = doorFlow.doorId == null ? null : String(doorFlow.doorId);
  const allowedDoor = getDoors(state).find(door => String(door?.id) === allowedDoorId);
  const doorCanBeUsed = allowedDoor
    && (isDoorRoleForFlow(allowedDoor, doorFlow.direction) || doorFlow.allowRoleMismatch === true);

  for (const door of getDoors(state)) {
    if (doorCanBeUsed && String(door?.id) === allowedDoorId) continue;
    const firstDoorCell = worldToCell({ x: world.doorX, y: door.y }).y;
    const lastDoorCell = worldToCell({ x: world.doorX, y: door.y + 39 }).y;
    for (let y = firstDoorCell; y <= lastDoorCell; y += 1) {
      blocked.add(cellKey({ x: wallCellX, y }));
    }
  }
  return blocked;
}

export function createGrid(state, workspace = null, options = {}) {
  const navigation = resolveNavigationWorkspace(state, workspace);
  const { bounds } = navigation;
  const world = getRestaurantWorld(state.restaurant || {});
  const blockedCells = flowBlockedCells(state, navigation, options.doorFlow);
  const doorGeometrySignature = JSON.stringify(getDoors(state)
    .map(door => [door?.id, door?.y, door?.role]));
  const signature = options.doorFlow
    && ['ingress', 'egress'].includes(options.doorFlow.direction)
    ? `${navigation.topologyFingerprint}:doors:${doorGeometrySignature}:flow:${options.doorFlow.direction}:${String(options.doorFlow.doorId ?? '')}:${getDoors(state).find(door => String(door?.id) === String(options.doorFlow.doorId ?? ''))?.role || ''}:${options.doorFlow.allowRoleMismatch === true ? 'crossing' : ''}`
    : `${navigation.topologyFingerprint}:doors:${doorGeometrySignature}`;
  const isOpen = point => Boolean(finitePoint(point)
    && point.x >= bounds.left && point.x <= bounds.right
    && point.y >= bounds.top && point.y <= bounds.bottom
    && !blockedCells.has(cellKey(worldToCell(point))));

  const allowedDoor = options.doorFlow?.doorId == null
    ? null
    : getDoors(state).find(door => String(door?.id) === String(options.doorFlow.doorId));
  const continuousDoorOpeningClear = (from, to) => {
    if (!allowedDoor || !Number.isFinite(allowedDoor.y)) return true;
    const wallLeft = world.doorX;
    const wallRight = world.doorX + 6;
    const minimumX = Math.min(from.x, to.x);
    const maximumX = Math.max(from.x, to.x);
    if (maximumX < wallLeft - 1e-9 || minimumX > wallRight + 1e-9) return true;
    const samples = [];
    const addAtX = x => {
      if (x < minimumX - 1e-9 || x > maximumX + 1e-9) return;
      if (to.x === from.x) {
        if (Math.abs(x - from.x) <= 1e-9) samples.push(from.y, to.y);
        return;
      }
      const fraction = (x - from.x) / (to.x - from.x);
      samples.push(from.y + (to.y - from.y) * fraction);
    };
    addAtX(wallLeft);
    addAtX(wallRight);
    if (to.x === from.x && from.x >= wallLeft - 1e-9 && from.x <= wallRight + 1e-9) {
      samples.push(from.y, to.y);
    }
    return samples.every(y => y >= allowedDoor.y - 1e-9
      && y < allowedDoor.y + 40 - 1e-9);
  };

  const segmentClear = (from, to) => {
    if (!isOpen(from) || !isOpen(to)) return false;
    if (!continuousDoorOpeningClear(from, to)) return false;
    // Partition at every cell boundary, rather than sampling at a fixed spatial
    // interval that could miss a very short incursion near a blocked corner.
    const boundaries = [0, 1];
    for (const axis of ['x', 'y']) {
      const delta = to[axis] - from[axis];
      if (delta === 0) continue;
      const minimum = Math.min(from[axis], to[axis]);
      const maximum = Math.max(from[axis], to[axis]);
      for (let coordinate = (Math.floor(minimum / GRID_SIZE) + 1) * GRID_SIZE;
        coordinate < maximum; coordinate += GRID_SIZE) {
        boundaries.push((coordinate - from[axis]) / delta);
      }
    }
    boundaries.sort((a, b) => a - b);
    for (let index = 1; index < boundaries.length; index += 1) {
      const t = (boundaries[index - 1] + boundaries[index]) / 2;
      if (!isOpen({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })) return false;
    }
    return true;
  };

  const validCandidates = (point, candidates) => [...new Map(candidates.map(candidate => [`${candidate.x},${candidate.y}`, candidate])).values()]
    .filter(candidate => (candidate.x !== point.x || candidate.y !== point.y) && segmentClear(point, candidate)).sort(comparePoints);
  const connectors = point => !isOpen(point) || isLatticePoint(point) ? [] : validCandidates(point,
    latticeAnchors(point).flatMap(anchor => [[0, -1], [-1, 0], [1, 0], [0, 1]]
      .map(([dx, dy]) => ({ x: anchor.x + dx * GRID_SIZE, y: anchor.y + dy * GRID_SIZE }))));
  const neighbours = point => {
    if (!isOpen(point)) return [];
    const candidates = isLatticePoint(point)
      ? [[0, -1], [-1, 0], [1, 0], [0, 1]].map(([dx, dy]) => ({
        x: point.x + dx * GRID_SIZE, y: point.y + dy * GRID_SIZE,
      }))
      : latticeAnchors(point);
    return validCandidates(point, candidates);
  };

  return Object.freeze({
    signature,
    bounds,
    doorFlow: options.doorFlow ? Object.freeze({ ...options.doorFlow }) : null,
    isOpen,
    segmentClear,
    neighbours,
    connectors,
  });
}
