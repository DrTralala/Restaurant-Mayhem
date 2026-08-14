import { getPlaceable } from '../data/placeables';
import { findPath, worldToCell } from './pathfinding';
import { GRID_SIZE, getCashierWorkPosition, getDoorPosition, getDoors, getRestaurantWorld } from './world';

function invalid(reason) {
  return { valid: false, reason };
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function rectangleIntersects(first, second) {
  // Width and height describe occupied pixels, so the last occupied pixel is
  // one less than the exclusive right/bottom edge. This permits footprints to
  // touch without treating the shared boundary as an overlap.
  return first.x <= second.x + second.w - 1
    && first.x + first.w - 1 >= second.x
    && first.y <= second.y + second.h - 1
    && first.y + first.h - 1 >= second.y;
}

function getRecordRect(record, width, height) {
  if (!isFinitePoint(record)) return null;
  const w = Number.isFinite(record.w) ? record.w : width;
  const h = Number.isFinite(record.h) ? record.h : height;
  if (w <= 0 || h <= 0) return null;
  return { x: record.x, y: record.y, w, h };
}

function getGridCellRect(point) {
  return {
    x: Math.floor(point.x / GRID_SIZE) * GRID_SIZE,
    y: Math.floor(point.y / GRID_SIZE) * GRID_SIZE,
    w: GRID_SIZE,
    h: GRID_SIZE,
  };
}

function getExistingFurnitureRects(state) {
  const rects = [];
  const tables = Array.isArray(state?.tables) ? state.tables : [];
  const chairs = Array.isArray(state?.chairs) ? state.chairs : [];
  const kitchenStations = Array.isArray(state?.kitchenStations) ? state.kitchenStations : [];
  const serviceTables = Array.isArray(state?.serviceTables) ? state.serviceTables : [];
  const cashierStations = Array.isArray(state?.cashierStations) ? state.cashierStations : [];

  for (const table of tables) {
    const rect = getRecordRect(table, 40, 40);
    if (rect) rects.push(rect);
  }
  for (const chair of chairs) {
    const rect = getRecordRect(chair, 20, 20);
    if (rect) rects.push(rect);
  }
  for (const station of kitchenStations) {
    const rect = getRecordRect(station, 40, 40);
    if (rect) rects.push(rect);
  }
  for (const serviceTable of serviceTables) {
    const rect = getRecordRect(serviceTable, 120, 40);
    if (rect) rects.push(rect);
  }
  for (const cashier of cashierStations) {
    const rect = getRecordRect(cashier, 80, 40);
    if (rect) rects.push(rect);
  }

  return rects;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isWithinFloor(world, rect, itemType) {
  const right = itemType === 'door' ? world.queueX : world.floorX + world.floorW;
  return rect.x >= world.floorX
    && rect.x + rect.w <= right
    && rect.y >= world.kitchenY
    && rect.y + rect.h <= world.kitchenY + world.floorH;
}

function areAdjacent(first, second) {
  const horizontalOverlap = first.x < second.x + second.w
    && first.x + first.w > second.x;
  const verticalOverlap = first.y < second.y + second.h
    && first.y + first.h > second.y;
  const touchesLeftOrRight = first.x + first.w === second.x
    || second.x + second.w === first.x;
  const touchesTopOrBottom = first.y + first.h === second.y
    || second.y + second.h === first.y;

  return (touchesLeftOrRight && verticalOverlap)
    || (touchesTopOrBottom && horizontalOverlap);
}

export function getPlacementRect(itemType, x, y, rotation = 0) {
  const item = getPlaceable(itemType);
  if (!item || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  // Chair rotation changes its facing only; all current rotatable placeables
  // retain their catalogue footprint.
  void rotation;
  return { x, y, w: item.width, h: item.height };
}

export function snapPlacement(itemType, point, state = {}) {
  const item = getPlaceable(itemType);
  if (!item || !isFinitePoint(point)) return null;

  const world = getRestaurantWorld(state?.restaurant || {});
  const x = Math.round(point.x / item.grid) * item.grid;
  const y = Math.round(point.y / item.grid) * item.grid;

  if (itemType === 'door') {
    return {
      x: world.doorX,
      y: clamp(y, world.kitchenY, world.kitchenY + world.floorH - item.height),
    };
  }

  return {
    x: clamp(x, world.floorX, world.floorX + world.floorW - item.width),
    y: clamp(y, world.kitchenY, world.kitchenY + world.floorH - item.height),
  };
}

export function validatePlacement(state = {}, placement = {}) {
  const currentState = state || {};
  const requestedPlacement = placement || {};
  const item = getPlaceable(requestedPlacement.itemType);
  if (!item) return invalid('unknown-item-type');
  if (!isFinitePoint(requestedPlacement)) return invalid('non-finite-coordinate');

  const rect = getPlacementRect(
    requestedPlacement.itemType,
    requestedPlacement.x,
    requestedPlacement.y,
    requestedPlacement.rotation,
  );
  const world = getRestaurantWorld(currentState.restaurant || {});
  if (requestedPlacement.itemType === 'door' && requestedPlacement.x !== world.doorX) {
    return invalid('door-wall');
  }
  if (!isWithinFloor(world, rect, requestedPlacement.itemType)) return invalid('outside-floor');

  const existingFurniture = getExistingFurnitureRects(currentState);
  if (existingFurniture.some(existing => rectangleIntersects(rect, existing))) {
    return invalid('overlap');
  }

  if (requestedPlacement.itemType === 'cashierTable') {
    const workPosition = getCashierWorkPosition(rect);
    const workCell = getGridCellRect(workPosition);
    const workTarget = worldToCell(workPosition);
    const stateWithCandidate = {
      ...currentState,
      cashierStations: [...(currentState.cashierStations || []), rect],
    };
    const workCellReachable = getDoors(currentState).some(door => {
      const start = worldToCell(getDoorPosition(currentState, door).inside);
      return (start.x === workTarget.x && start.y === workTarget.y)
        || findPath(stateWithCandidate, start, workTarget).length > 0;
    });
    if (!isWithinFloor(world, workCell, requestedPlacement.itemType)
      || existingFurniture.some(existing => rectangleIntersects(workCell, existing))
      || !workCellReachable) {
      return invalid('cashier-work-cell');
    }
  }

  if (requestedPlacement.itemType === 'door') {
    const doors = getDoors(currentState);
    if (doors.some(door => Number.isFinite(door?.y)
      && Math.abs(requestedPlacement.y - door.y) < item.height)) {
      return invalid('door-overlap');
    }
  }

  if (requestedPlacement.itemType === 'chair') {
    const tables = Array.isArray(currentState.tables) ? currentState.tables : [];
    const chairs = Array.isArray(currentState.chairs) ? currentState.chairs : [];
    const adjacentTables = tables.filter(table => {
      const tableRect = getRecordRect(table, 40, 40);
      if (!tableRect || !areAdjacent(rect, tableRect)) return false;
      const chairCount = chairs.filter(chair => chair.tableId === table.id).length;
      return Number.isFinite(table.seats) && chairCount < table.seats;
    });

    if (adjacentTables.length !== 1) return invalid('chair-table');
    return { valid: true, reason: null, tableId: adjacentTables[0].id };
  }

  return { valid: true, reason: null };
}

export function getNextNumericId(items, prefix) {
  const idPrefix = String(prefix ?? '');
  let highest = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.id == null) continue;
    const id = String(item.id);
    if (!id.startsWith(idPrefix)) continue;
    const suffix = id.slice(idPrefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    highest = Math.max(highest, Number(suffix));
  }
  return `${idPrefix}${highest + 1}`;
}
