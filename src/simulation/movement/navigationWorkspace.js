import { GRID_SIZE, getDoors, getRestaurantWorld } from '../world';
import { getPlaceableDimensions } from '../../data/placeables';

export function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

export function worldToCell(point) {
  return { x: Math.floor(point.x / GRID_SIZE), y: Math.floor(point.y / GRID_SIZE) };
}

export function cellToWorld(cell) {
  return { x: cell.x * GRID_SIZE, y: cell.y * GRID_SIZE };
}

function blockRect(blocked, rect) {
  const start = worldToCell({ x: rect.x, y: rect.y });
  const end = worldToCell({ x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 });
  for (let y = start.y; y <= end.y; y += 1) {
    for (let x = start.x; x <= end.x; x += 1) blocked.add(cellKey({ x, y }));
  }
}

export function buildBlockedCells(state, metrics = null) {
  if (metrics) metrics.blockedCellBuilds += 1;
  const blocked = new Set();
  for (const table of state.tables || []) blockRect(blocked, { x: table.x, y: table.y, w: 40, h: 40 });
  for (const chair of state.chairs || []) blockRect(blocked, { x: chair.x, y: chair.y, w: 20, h: 20 });
  for (const station of state.kitchenStations || []) blockRect(blocked, { x: station.x, y: station.y, w: 40, h: 40 });
  for (const service of state.serviceTables || []) {
    const dimensions = getPlaceableDimensions('serviceTable', service.rotation);
    blockRect(blocked, { x: service.x, y: service.y, w: dimensions.width, h: dimensions.height });
  }
  for (const cashier of state.cashierStations || []) blockRect(blocked, cashier);
  for (const station of state.washStations || []) blockRect(blocked, { x: station.x, y: station.y, w: station.w || 40, h: station.h || 40 });
  const world = getRestaurantWorld(state.restaurant || {});
  blockRect(blocked, { x: world.doorX, y: world.kitchenY, w: 6, h: world.floorH });
  const wallCellX = worldToCell({ x: world.doorX, y: 0 }).x;
  for (const door of getDoors(state)) {
    const firstDoorCell = worldToCell({ x: world.doorX, y: door.y }).y;
    const lastDoorCell = worldToCell({ x: world.doorX, y: door.y + 39 }).y;
    for (let y = firstDoorCell; y <= lastDoorCell; y += 1) blocked.delete(cellKey({ x: wallCellX, y }));
  }
  return blocked;
}

export function buildOccupiedCharacterCells(characters, excludedIds = []) {
  const excluded = new Set(excludedIds);
  return new Set((characters || [])
    .filter(character => !excluded.has(character.id) && Number.isFinite(character.x) && Number.isFinite(character.y))
    .map(character => cellKey(worldToCell(character))));
}

export function isInsideWorld(state, cell) {
  const world = getRestaurantWorld(state.restaurant || {});
  const point = cellToWorld(cell);
  return point.x >= world.floorX && point.x <= world.queueX + world.queueW && point.y >= world.kitchenY && point.y <= world.diningY + world.areaH + 50;
}

function continuousWorldBounds(state) {
  const world = getRestaurantWorld(state?.restaurant || {});
  return {
    left: world.floorX,
    right: world.queueX + world.queueW,
    top: world.kitchenY,
    bottom: world.diningY + world.areaH + 50,
  };
}

function readOnlyBlockedLookup(blocked) {
  return Object.freeze({
    has: key => blocked.has(key),
    size: blocked.size,
  });
}

function hasValidNavigationBounds(bounds) {
  return bounds && ['left', 'right', 'top', 'bottom'].every(key => Number.isFinite(bounds[key]));
}

export function isNavigationWorkspaceForState(workspace, state) {
  return !!workspace
    && typeof workspace === 'object'
    && workspace.state === state
    && hasValidNavigationBounds(workspace.bounds)
    && !!workspace.blockedCells
    && Number.isFinite(workspace.blockedCells.size)
    && workspace.blockedCells.size >= 0
    && typeof workspace.blockedCells.has === 'function';
}

export function createNavigationWorkspace(state, metrics = null) {
  const world = getRestaurantWorld(state?.restaurant || {});
  const blocked = buildBlockedCells(state, metrics);
  return Object.freeze({
    state,
    bounds: Object.freeze({
      left: world.floorX,
      right: world.queueX + world.queueW,
      top: world.kitchenY,
      bottom: world.diningY + world.areaH + 50,
    }),
    blockedCells: readOnlyBlockedLookup(blocked),
  });
}

export function resolveNavigationWorkspace(state, workspace = null, metrics = null) {
  return isNavigationWorkspaceForState(workspace, state)
    ? workspace
    : createNavigationWorkspace(state, metrics);
}

export function resolveNavigationBounds(state, workspace = null) {
  return isNavigationWorkspaceForState(workspace, state)
    ? workspace.bounds
    : continuousWorldBounds(state);
}

export function isCellInsideWorkspace(workspace, cell) {
  if (!workspace?.bounds) return false;
  const point = cellToWorld(cell);
  const { left, right, top, bottom } = workspace.bounds;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function isSafeWorldAxis(start, end, minimum, maximum) {
  if (start < minimum) return end >= start && end <= maximum;
  if (start > maximum) return end <= start && end >= minimum;
  return end >= minimum && end <= maximum;
}

export function isSafeWorldSegment(state, start, end, workspace = null) {
  if (!state) return true;
  const bounds = resolveNavigationBounds(state, workspace);
  return isSafeWorldAxis(start.x, end.x, bounds.left, bounds.right)
    && isSafeWorldAxis(start.y, end.y, bounds.top, bounds.bottom);
}

export function furthestWorldSegmentEndpoint(state, start, end, workspace = null) {
  if (!state || isSafeWorldSegment(state, start, end, workspace)) return end;
  const bounds = resolveNavigationBounds(state, workspace);
  let ratio = 1;
  for (const [coordinate, minimum, maximum] of [
    ['x', bounds.left, bounds.right],
    ['y', bounds.top, bounds.bottom],
  ]) {
    const origin = start[coordinate];
    const delta = end[coordinate] - origin;
    if ((origin < minimum && delta <= 0) || (origin > maximum && delta >= 0)) return start;
    if (delta > 0 && origin + delta > maximum) {
      ratio = Math.min(ratio, (maximum - origin) / delta);
    } else if (delta < 0 && origin + delta < minimum) {
      ratio = Math.min(ratio, (minimum - origin) / delta);
    }
  }
  if (ratio <= 0) return start;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

export function isSafeSegment(state, start, end, { workspace = null, metrics = null } = {}) {
  if (!state) return true;
  const navigation = resolveNavigationWorkspace(state, workspace, metrics);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / 2));
  const startKey = cellKey(worldToCell(start));
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    const point = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    const key = cellKey(worldToCell(point));
    if (key !== startKey && navigation.blockedCells.has(key)) return false;
  }
  return true;
}
