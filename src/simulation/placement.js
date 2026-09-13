import { getPlaceable, getPlaceableDimensions } from '../data/placeables';
import {
  getFixture,
  getFixtureDescriptor,
  getFixtureRect,
  listFixtures,
} from '../data/fixtures';
import { findPath, worldToCell } from './pathfinding';
import { buildBlockedCells, cellKey } from './movement/navigationWorkspace';
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
  const washStations = Array.isArray(state?.washStations) ? state.washStations : [];

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
    const dimensions = getPlaceableDimensions('serviceTable', serviceTable.rotation);
    const rect = getRecordRect(serviceTable, dimensions.width, dimensions.height);
    if (rect) rects.push(rect);
  }
  for (const cashier of cashierStations) {
    const rect = getRecordRect(cashier, 80, 40);
    if (rect) rects.push(rect);
  }
  for (const station of washStations) {
    const rect = getRecordRect(station, 40, 40);
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

function hasValidCashierWorkCell(state, rect, furnitureRects) {
  const world = getRestaurantWorld(state.restaurant || {});
  const workPosition = getCashierWorkPosition(rect);
  const workCell = getGridCellRect(workPosition);
  const workTarget = worldToCell(workPosition);
  const workCellReachable = getDoors(state).some(door => {
    const position = getDoorPosition(state, door);
    if (!position) return false;
    const start = worldToCell(position.inside);
    return (start.x === workTarget.x && start.y === workTarget.y)
      || findPath(state, start, workTarget).length > 0;
  });

  return isWithinFloor(world, workCell, 'cashierTable')
    && !furnitureRects.some(existing => rectangleIntersects(workCell, existing))
    && workCellReachable;
}

export function getPlacementRect(itemType, x, y, rotation = 0) {
  const item = getPlaceable(itemType);
  if (!item || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const dimensions = getPlaceableDimensions(itemType, rotation);
  return { x, y, w: dimensions.width, h: dimensions.height };
}

export function snapPlacement(itemType, point, state = {}, rotation = 0) {
  const item = getPlaceable(itemType);
  if (!item || !isFinitePoint(point)) return null;
  const dimensions = getPlaceableDimensions(itemType, rotation);

  const world = getRestaurantWorld(state?.restaurant || {});
  const x = Math.round(point.x / item.grid) * item.grid;
  const y = Math.round(point.y / item.grid) * item.grid;

  if (itemType === 'door') {
    return {
      x: world.doorX,
      y: clamp(y, world.kitchenY, world.kitchenY + world.floorH - dimensions.height),
    };
  }

  return {
    x: clamp(x, world.floorX, world.floorX + world.floorW - dimensions.width),
    y: clamp(y, world.kitchenY, world.kitchenY + world.floorH - dimensions.height),
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
    const stateWithCandidate = {
      ...currentState,
      cashierStations: [...(currentState.cashierStations || []), rect],
    };
    if (!hasValidCashierWorkCell(stateWithCandidate, rect, existingFurniture)) {
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

function fixtureIdentityMatches(first, second) {
  return first.type === second.type && first.id === second.id;
}

function getFixturePlacementType(fixture) {
  const descriptor = getFixtureDescriptor(fixture.type);
  return typeof descriptor?.placementType === 'function'
    ? descriptor.placementType(fixture.data)
    : descriptor?.placementType;
}

function hasValidChairRelationships(state, fixtures) {
  const tables = fixtures.filter(fixture => fixture.type === 'table');
  const chairs = fixtures.filter(fixture => fixture.type === 'chair');

  return chairs.every(chair => {
    const chairRect = getFixtureRect(state, chair);
    const adjacentTables = tables.filter(table => {
      const tableRect = getFixtureRect(state, table);
      return tableRect && areAdjacent(chairRect, tableRect);
    });
    const linkedTable = adjacentTables.length === 1
      && adjacentTables[0].id === chair.data.tableId
      ? adjacentTables[0]
      : null;
    if (!linkedTable || !Number.isFinite(linkedTable.data.seats)) return false;

    return chairs.filter(candidate => candidate.data.tableId === linkedTable.id).length
      <= linkedTable.data.seats;
  });
}

function movesStrandAnActor(state, finalState, moves) {
  if (!moves.some(move => move.type === 'door')) return false;
  const before = buildBlockedCells(state);
  const after = buildBlockedCells(finalState);
  const newlyBlocked = new Set([...after].filter(key => !before.has(key)));
  if (newlyBlocked.size === 0) return false;

  const actors = [
    ...(state.staff || []),
    ...(state.customers || []),
    ...(state.queueSlots || []),
  ];
  return actors.some(actor => isFinitePoint(actor)
    && newlyBlocked.has(cellKey(worldToCell(actor))));
}

export function validateFixtureMoves(state = {}, moves = []) {
  const currentState = state || {};
  if (!Array.isArray(moves)) return invalid('malformed-moves');

  const world = getRestaurantWorld(currentState.restaurant || {});
  const seenByType = new Map();
  const finalState = { ...currentState };
  const clonedCollections = new Set();
  const normalisedMoves = [];

  for (const move of moves) {
    const descriptor = getFixtureDescriptor(move?.type);
    if (!descriptor) return invalid('unknown-fixture-type');

    const seenIds = seenByType.get(move.type) || new Set();
    if (seenIds.has(move.id)) return invalid('duplicate-move');
    seenIds.add(move.id);
    seenByType.set(move.type, seenIds);

    const fixture = getFixture(currentState, move.type, move.id);
    if (!fixture) return invalid('missing-fixture');
    if (!isFinitePoint(move)) return invalid('non-finite-coordinate');
    if (Object.prototype.hasOwnProperty.call(move, 'rotation')
      && (!Number.isInteger(move.rotation) || move.rotation < 0 || move.rotation > 3)) {
      return invalid('malformed-rotation');
    }
    if (move.type === 'door' && move.x !== world.doorX) return invalid('door-wall');

    if (!clonedCollections.has(descriptor.collection)) {
      finalState[descriptor.collection] = [...currentState[descriptor.collection]];
      clonedCollections.add(descriptor.collection);
    }

    const normalisedMove = {
      type: move.type,
      id: move.id,
      x: move.type === 'door' ? world.doorX : move.x,
      y: move.y,
    };
    if (Object.prototype.hasOwnProperty.call(move, 'rotation')) {
      normalisedMove.rotation = move.rotation;
    }
    normalisedMoves.push(normalisedMove);

    finalState[descriptor.collection] = finalState[descriptor.collection].map(record => (
      record.id === move.id
        ? {
          ...record,
          x: normalisedMove.x,
          y: normalisedMove.y,
          ...(Object.prototype.hasOwnProperty.call(normalisedMove, 'rotation')
            ? { rotation: normalisedMove.rotation }
            : {}),
        }
        : record
    ));
  }

  const finalFixtures = listFixtures(finalState);
  const movedFixtures = normalisedMoves.map(move => getFixture(
    finalState,
    move.type,
    move.id,
  ));

  for (const fixture of movedFixtures) {
    const rect = getFixtureRect(finalState, fixture);
    const placementType = getFixturePlacementType(fixture);
    if (!rect || rect.w <= 0 || rect.h <= 0) return invalid('malformed-fixture');
    if (!isWithinFloor(world, rect, placementType)) return invalid('outside-floor');
  }

  for (const fixture of movedFixtures.filter(candidate => candidate.type === 'door')) {
    const rect = getFixtureRect(finalState, fixture);
    const overlapsDoor = finalFixtures.some(candidate => candidate.type === 'door'
      && !fixtureIdentityMatches(fixture, candidate)
      && rectangleIntersects(rect, getFixtureRect(finalState, candidate)));
    if (overlapsDoor) return invalid('door-overlap');
  }

  for (const fixture of movedFixtures) {
    const rect = getFixtureRect(finalState, fixture);
    const overlapsFixture = finalFixtures.some(candidate => {
      if (fixtureIdentityMatches(fixture, candidate)) return false;
      if (fixture.type === 'door' && candidate.type === 'door') return false;
      return rectangleIntersects(rect, getFixtureRect(finalState, candidate));
    });
    if (overlapsFixture) return invalid('overlap');
  }

  if (movesStrandAnActor(currentState, finalState, normalisedMoves)) {
    return invalid('door-occupied');
  }

  const furnitureFixtures = finalFixtures.filter(fixture => fixture.type !== 'door');
  for (const cashier of finalFixtures.filter(fixture => fixture.type === 'cashierTable')) {
    const cashierRect = getFixtureRect(finalState, cashier);
    const otherFurnitureRects = furnitureFixtures
      .filter(fixture => !fixtureIdentityMatches(cashier, fixture))
      .map(fixture => getFixtureRect(finalState, fixture));
    if (!hasValidCashierWorkCell(finalState, cashierRect, otherFurnitureRects)) {
      return invalid('cashier-work-cell');
    }
  }

  if (!hasValidChairRelationships(finalState, finalFixtures)) return invalid('chair-table');

  return { valid: true, reason: null, moves: normalisedMoves };
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
