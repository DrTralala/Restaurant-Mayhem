import { GRID_SIZE, getDoors, getRestaurantWorld } from '../world';
import { getPlaceableDimensions } from '../../data/placeables';
import { getAmenityGeometry } from '../../data/staffAmenities';
import { noteNavigation } from '../navigation/telemetry';

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

export function getTopInteriorWall(world) {
  return {
    x: world.floorX, y: world.kitchenY,
    w: world.doorX - world.floorX, h: world.diningY - world.kitchenY,
  };
}

export function isTopInteriorWallCell(world, cell) {
  const wall = getTopInteriorWall(world);
  const start = worldToCell(wall);
  const end = worldToCell({
    x: wall.x + wall.w - 1,
    y: wall.y + wall.h - 1,
  });
  return cell.x >= start.x && cell.x <= end.x
    && cell.y >= start.y && cell.y <= end.y;
}

export function navigationFixtureRectangles(state) {
  const rectangles = [];
  const add = (kind, fixture, w, h) => rectangles.push({
    kind, id: fixture.id, x: fixture.x, y: fixture.y, w, h,
  });
  for (const table of state.tables || []) add('table', table, 40, 40);
  for (const chair of state.chairs || []) add('chair', chair, 20, 20);
  for (const station of state.kitchenStations || []) add('kitchen', station, 40, 40);
  for (const service of state.serviceTables || []) {
    const dimensions = getPlaceableDimensions('serviceTable', service.rotation);
    add('service', service, dimensions.width, dimensions.height);
  }
  for (const cashier of state.cashierStations || []) {
    const dimensions = getPlaceableDimensions('cashierTable');
    add('cashier', cashier, dimensions.width, dimensions.height);
  }
  for (const station of state.washStations || []) add('wash', station, station.w || 40, station.h || 40);
  for (const amenity of state.staffAmenities || []) {
    const geometry = getAmenityGeometry(amenity);
    if (geometry) rectangles.push({
      kind: 'staffAmenity', id: amenity.id, ...geometry.footprint,
    });
  }
  return rectangles;
}

export function buildBlockedCells(state, metrics = null) {
  const blocked = new Set();
  for (const rect of navigationFixtureRectangles(state)) blockRect(blocked, rect);
  const world = getRestaurantWorld(state.restaurant || {});
  blockRect(blocked, getTopInteriorWall(world));
  blockRect(blocked, { x: world.doorX, y: world.kitchenY, w: 6, h: world.floorH });
  const wallCellX = worldToCell({ x: world.doorX, y: 0 }).x;
  for (const door of getDoors(state)) {
    const firstDoorCell = worldToCell({ x: world.doorX, y: door.y }).y;
    const lastDoorCell = worldToCell({ x: world.doorX, y: door.y + 39 }).y;
    for (let y = firstDoorCell; y <= lastDoorCell; y += 1) {
      if (!isTopInteriorWallCell(world, { x: wallCellX, y })) {
        blocked.delete(cellKey({ x: wallCellX, y }));
      }
    }
  }
  return blocked;
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
  noteNavigation('workspaceBuilds');
  const world = getRestaurantWorld(state?.restaurant || {});
  const blocked = buildBlockedCells(state, metrics);
  const bounds = Object.freeze({
    left: world.floorX,
    right: world.queueX + world.queueW,
    top: world.kitchenY,
    bottom: world.diningY + world.areaH + 50,
  });
  const blockedCellKeys = Object.freeze([...blocked].sort());
  return Object.freeze({
    state,
    bounds,
    blockedCells: readOnlyBlockedLookup(blocked),
    blockedCellKeys,
    topologyFingerprint: JSON.stringify([
      bounds.left,
      bounds.right,
      bounds.top,
      bounds.bottom,
      blockedCellKeys,
      navigationFixtureRectangles(state).map(rect => JSON.stringify(rect)).sort(),
      (state.chairs || []).map(chair => JSON.stringify([
        chair.id, chair.tableId, chair.rotation ?? 0,
      ])).sort(),
    ]),
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

export function isSafeSegment(state, start, end, { workspace = null, metrics = null } = {}) {
  if (!state) return true;
  const navigation = resolveNavigationWorkspace(state, workspace, metrics);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / 2));
  const startCell = worldToCell(start);
  const startKey = cellKey(startCell);
  const world = getRestaurantWorld(state.restaurant || {});
  const sourceIsTopInteriorWall = isTopInteriorWallCell(world, startCell);
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    const point = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    const key = cellKey(worldToCell(point));
    if ((key !== startKey || sourceIsTopInteriorWall) && navigation.blockedCells.has(key)) return false;
  }
  return true;
}
