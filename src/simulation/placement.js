import { getPlaceable, getPlaceableDimensions } from '../data/placeables';
import {
  createEmptyAmenitySlots,
  getAmenityGeometry,
  isAmenityInUse,
} from '../data/staffAmenities';
import {
  getFixture,
  getFixtureDescriptor,
  getFixtureRect,
  listFixtures,
} from '../data/fixtures';
import { findPath, isInsideWorld, worldToCell } from './pathfinding';
import {
  buildBlockedCells,
  cellKey,
  createNavigationWorkspace,
} from './movement/navigationWorkspace';
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

function getExistingFurnitureRects(state, excludedFixture = null) {
  return listFixtures(state)
    .filter(fixture => fixture.type !== 'door'
      && !fixtureIdentityMatches(fixture, excludedFixture))
    .map(fixture => getFixtureRect(state, fixture))
    .filter(rect => rect && rect.w > 0 && rect.h > 0);
}

function getAmenityAccessCellRects(geometry) {
  if (!geometry) return [];
  const points = [...geometry.approachPoints, ...geometry.exitCandidates];
  const seen = new Set();
  return points.map(point => {
    const cell = worldToCell(point);
    const key = cellKey(cell);
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      x: cell.x * GRID_SIZE,
      y: cell.y * GRID_SIZE,
      w: GRID_SIZE,
      h: GRID_SIZE,
    };
  }).filter(Boolean);
}

function getAmenityAccessRects(state, excludedFixture = null) {
  return listFixtures(state)
    .filter(fixture => fixture.type === 'staffAmenity'
      && !fixtureIdentityMatches(fixture, excludedFixture))
    .flatMap(fixture => getAmenityAccessCellRects(getAmenityGeometry(fixture.data)));
}

function isPointInsideFloor(world, point) {
  return point.x >= world.floorX
    && point.x < world.floorX + world.floorW
    && point.y >= world.kitchenY
    && point.y < world.kitchenY + world.floorH;
}

function isFloorCell(world, cell) {
  const point = { x: cell.x * GRID_SIZE, y: cell.y * GRID_SIZE };
  return isPointInsideFloor(world, point);
}

function pathAvoidsFootprint(path, start, footprint) {
  return [start, ...path].every(cell => !rectangleIntersects(
    getGridCellRect({ x: cell.x * GRID_SIZE, y: cell.y * GRID_SIZE }),
    footprint,
  ));
}

function blockFootprint(blocked, footprint) {
  const start = worldToCell(footprint);
  const end = worldToCell({
    x: footprint.x + footprint.w - 1,
    y: footprint.y + footprint.h - 1,
  });
  for (let y = start.y; y <= end.y; y += 1) {
    for (let x = start.x; x <= end.x; x += 1) blocked.add(cellKey({ x, y }));
  }
}

function createAmenityNavigationWorkspace(state, footprint) {
  const base = createNavigationWorkspace(state);
  const blocked = new Set(base.blockedCellKeys);
  for (const fixture of listFixtures(state).filter(candidate => candidate.type === 'staffAmenity')) {
    const geometry = getAmenityGeometry(fixture.data);
    if (geometry) blockFootprint(blocked, geometry.footprint);
  }
  blockFootprint(blocked, footprint);
  const blockedCellKeys = Object.freeze([...blocked].sort());
  return Object.freeze({
    ...base,
    blockedCells: Object.freeze({
      has: key => blocked.has(key),
      size: blocked.size,
    }),
    blockedCellKeys,
    topologyFingerprint: `${base.topologyFingerprint}:amenity:${blockedCellKeys.join('|')}`,
  });
}

function amenityAccessIsReachable(state, targetCell, footprint, workspace) {
  if (!isInsideWorld(state, targetCell)) return false;
  return getDoors(state).some(door => {
    const position = getDoorPosition(state, door);
    if (!position) return false;
    const start = worldToCell(position.inside);
    if (start.x === targetCell.x && start.y === targetCell.y) {
      return pathAvoidsFootprint([], start, footprint);
    }
    const path = findPath(state, start, targetCell, { workspace });
    return path.length > 0 && pathAvoidsFootprint(path, start, footprint);
  });
}

function validateAmenityAccess(
  state,
  amenity,
  geometry,
  furnitureRects = [],
  protectedAccessRects = [],
) {
  if (!geometry) return invalid('malformed-amenity');
  const world = getRestaurantWorld(state?.restaurant || {});
  const accessPoints = [...geometry.approachPoints, ...geometry.exitCandidates];
  const accessRects = getAmenityAccessCellRects(geometry);
  const navigationWorkspace = createAmenityNavigationWorkspace(state, geometry.footprint);

  if (accessPoints.some(point => !isPointInsideFloor(world, point)
    || !isPointOutsideFootprint(point, geometry.footprint))) {
    return invalid('amenity-access');
  }

  const blocked = buildBlockedCells(state);
  for (const accessRect of accessRects) {
    const targetCell = worldToCell({ x: accessRect.x, y: accessRect.y });
    if (!isFloorCell(world, targetCell)
      || blocked.has(cellKey(targetCell))
      || furnitureRects.some(rect => rectangleIntersects(accessRect, rect))
      || protectedAccessRects.some(rect => rectangleIntersects(accessRect, rect))) {
      return invalid('amenity-access');
    }
    if (!amenityAccessIsReachable(
      state,
      targetCell,
      geometry.footprint,
      navigationWorkspace,
    )) {
      return invalid('amenity-access');
    }
  }

  return { valid: true, reason: null };
}

function isPointOutsideFootprint(point, footprint) {
  return point.x < footprint.x
    || point.x >= footprint.x + footprint.w
    || point.y < footprint.y
    || point.y >= footprint.y + footprint.h;
}

function validateAmenityLayout(state, candidateFixtures, allFixtures) {
  const allAccessRects = getAmenityAccessRects(state);
  for (const fixture of candidateFixtures) {
    const rect = getFixtureRect(state, fixture);
    if (!rect) return invalid('malformed-amenity');
    if (fixture.type !== 'staffAmenity') {
      if (allAccessRects.some(accessRect => rectangleIntersects(rect, accessRect))) {
        return invalid('amenity-access');
      }
      continue;
    }

    const geometry = getAmenityGeometry(fixture.data);
    const accessResult = validateAmenityAccess(
      state,
      fixture.data,
      geometry,
      allFixtures
        .filter(candidate => candidate.type !== 'door'
          && !fixtureIdentityMatches(candidate, fixture))
        .map(candidate => getFixtureRect(state, candidate))
        .filter(Boolean),
      getAmenityAccessRects(state, fixture),
    );
    if (!accessResult.valid) return accessResult;
  }
  return { valid: true, reason: null };
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
  if (item.rotatable && Object.prototype.hasOwnProperty.call(requestedPlacement, 'rotation')
    && (!Number.isInteger(requestedPlacement.rotation)
      || requestedPlacement.rotation < 0 || requestedPlacement.rotation > 3)) {
    return invalid('malformed-rotation');
  }

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

  const existingAmenityAccess = getAmenityAccessRects(currentState);
  if (existingAmenityAccess.some(accessRect => rectangleIntersects(rect, accessRect))) {
    return invalid('amenity-access');
  }

  if (item.staffAmenity) {
    const amenity = {
      type: requestedPlacement.itemType,
      x: requestedPlacement.x,
      y: requestedPlacement.y,
      rotation: requestedPlacement.rotation,
    };
    const geometry = getAmenityGeometry(amenity);
    const accessResult = validateAmenityAccess(
      currentState,
      amenity,
      geometry,
      existingFurniture,
      existingAmenityAccess,
    );
    if (!accessResult.valid) return accessResult;
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
  return Boolean(first && second && first.type === second.type && first.id === second.id);
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
    if (move.type === 'staffAmenity' && isAmenityInUse(fixture.data)) {
      return invalid('amenity-in-use');
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

  const movedAmenityLayout = validateAmenityLayout(finalState, movedFixtures, finalFixtures);
  if (!movedAmenityLayout.valid) return movedAmenityLayout;

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

function fixtureCopyKey(type, id) {
  return `${type}:${String(id)}`;
}

function expandFixtureCopies(state, requestedCopies) {
  if (!Array.isArray(requestedCopies)) return invalid('malformed-copies');
  const expanded = requestedCopies.map(copy => ({ ...copy }));

  for (const tableCopy of requestedCopies.filter(copy => copy?.type === 'table')) {
    const table = getFixture(state, 'table', tableCopy.id)?.data;
    if (!table) continue;
    const deltaX = tableCopy.x - table.x;
    const deltaY = tableCopy.y - table.y;

    for (const chair of (state.chairs || []).filter(candidate => candidate.tableId === table.id)) {
      const explicit = expanded.find(copy => copy?.type === 'chair' && copy.id === chair.id);
      const expected = { x: chair.x + deltaX, y: chair.y + deltaY };
      if (explicit) {
        if (explicit.x !== expected.x || explicit.y !== expected.y) {
          return invalid('inconsistent-table-chair');
        }
        continue;
      }
      expanded.push({
        type: 'chair',
        id: chair.id,
        x: expected.x,
        y: expected.y,
      });
    }
  }

  return { valid: true, copies: expanded };
}

function uniqueTemporaryId(collection, index, usedIds) {
  let candidate = `__copy_${collection}_${index}`;
  let suffix = 1;
  while (usedIds.has(String(candidate))) {
    candidate = `__copy_${collection}_${index}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(String(candidate));
  return candidate;
}

function getCopyCandidateData(source, copy, id, tableIds) {
  if (source.type === 'table') {
    return {
      id,
      seats: Number.isFinite(source.data.seats) ? source.data.seats : 4,
      status: 'empty',
      x: copy.x,
      y: copy.y,
    };
  }

  if (source.type === 'chair') {
    const copiedTableId = tableIds.get(fixtureCopyKey('table', source.data.tableId));
    return {
      id,
      tableId: copiedTableId ?? source.data.tableId,
      x: copy.x,
      y: copy.y,
      rotation: Number.isInteger(source.data.rotation)
        && source.data.rotation >= 0
        && source.data.rotation <= 3
        ? source.data.rotation
        : 0,
    };
  }

  const data = { ...source.data, id };
  if (source.type === 'door') {
    delete data.x;
    data.y = copy.y;
  } else {
    data.x = copy.x;
    data.y = copy.y;
  }
  if (Object.prototype.hasOwnProperty.call(copy, 'rotation')
    && !['chair', 'serviceTable'].includes(source.type)) {
    data.rotation = copy.rotation;
  }
  if (source.type === 'staffAmenity') {
    data.slots = createEmptyAmenitySlots(source.data.type);
    delete data.amenityUse;
    delete data.ptoSession;
  }
  return data;
}

function hasValidCopiedChairRelationships(finalFixtures, copiedChairs) {
  const tables = finalFixtures.filter(fixture => fixture.type === 'table');
  const chairs = finalFixtures.filter(fixture => fixture.type === 'chair');

  return copiedChairs.every(chair => {
    const chairRect = getFixtureRect(null, chair);
    if (!chairRect) return false;
    const adjacentTables = tables.filter(table => {
      const tableRect = getFixtureRect(null, table);
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

function getFinalFurnitureRects(finalFixtures, excludeFixture = null) {
  return finalFixtures
    .filter(fixture => fixture.type !== 'door'
      && !fixtureIdentityMatches(fixture, excludeFixture))
    .map(fixture => getFixtureCopyRect(null, fixture))
    .filter(Boolean);
}

function getFixtureCopyRect(state, fixture) {
  const rect = getFixtureRect(state, fixture);
  if (!rect || fixture?.type !== 'cashierTable') return rect;

  return {
    ...rect,
    w: Number.isFinite(fixture.data.w) ? fixture.data.w : rect.w,
    h: Number.isFinite(fixture.data.h) ? fixture.data.h : rect.h,
  };
}

export function validateFixtureCopies(state = {}, requestedCopies = []) {
  const currentState = state || {};
  if (!Array.isArray(requestedCopies)) return invalid('malformed-copies');
  const requestedSources = new Set();
  for (const copy of requestedCopies) {
    const sourceKey = fixtureCopyKey(copy?.type, copy?.id);
    if (requestedSources.has(sourceKey)) return invalid('duplicate-copy');
    requestedSources.add(sourceKey);
  }
  const expandedResult = expandFixtureCopies(currentState, requestedCopies);
  if (!expandedResult.valid) return expandedResult;
  const copies = expandedResult.copies;
  if (copies.length === 0) return invalid('malformed-copies');

  const world = getRestaurantWorld(currentState.restaurant || {});
  const seenSources = new Set();
  const sourceFixtures = [];
  for (const copy of copies) {
    const descriptor = getFixtureDescriptor(copy?.type);
    if (!descriptor) return invalid('unknown-fixture-type');
    const sourceKey = fixtureCopyKey(copy.type, copy.id);
    if (seenSources.has(sourceKey)) return invalid('duplicate-copy');
    seenSources.add(sourceKey);

    const source = getFixture(currentState, copy.type, copy.id);
    if (!source) return invalid('missing-fixture');
    if (!isFinitePoint(copy)) return invalid('non-finite-coordinate');
    if (copy.type === 'door' && copy.x !== world.doorX) return invalid('door-wall');
    if (Object.prototype.hasOwnProperty.call(copy, 'rotation')
      && (!Number.isInteger(copy.rotation) || copy.rotation < 0 || copy.rotation > 3)) {
      return invalid('malformed-rotation');
    }
    sourceFixtures.push(source);
  }

  const tableIds = new Map();
  const usedIdsByCollection = new Map();
  copies.forEach((copy, index) => {
    if (copy.type !== 'table') return;
    const descriptor = getFixtureDescriptor(copy.type);
    const usedIds = usedIdsByCollection.get(descriptor.collection) || new Set(
      (currentState[descriptor.collection] || []).map(item => String(item.id)),
    );
    usedIdsByCollection.set(descriptor.collection, usedIds);
    tableIds.set(fixtureCopyKey('table', copy.id), uniqueTemporaryId(descriptor.collection, index, usedIds));
  });

  const candidateFixtures = copies.map((copy, index) => {
    const source = sourceFixtures[index];
    const descriptor = getFixtureDescriptor(copy.type);
    const usedIds = usedIdsByCollection.get(descriptor.collection) || new Set(
      (currentState[descriptor.collection] || []).map(item => String(item.id)),
    );
    usedIdsByCollection.set(descriptor.collection, usedIds);
    const id = copy.type === 'table'
      ? tableIds.get(fixtureCopyKey('table', copy.id))
      : uniqueTemporaryId(descriptor.collection, index, usedIds);
    return {
      type: copy.type,
      id,
      data: getCopyCandidateData(source, copy, id, tableIds),
    };
  });

  const finalState = { ...currentState };
  const copiedByCollection = new Map();
  for (const fixture of candidateFixtures) {
    const descriptor = getFixtureDescriptor(fixture.type);
    const collection = copiedByCollection.get(descriptor.collection) || [];
    collection.push(fixture.data);
    copiedByCollection.set(descriptor.collection, collection);
  }
  for (const [collection, records] of copiedByCollection) {
    finalState[collection] = [...(currentState[collection] || []), ...records];
  }

  const finalFixtures = listFixtures(finalState);
  const copiedFixtureSet = new Set(candidateFixtures.map(fixture => fixture.id));
  const candidateRects = new Map();
  for (const fixture of candidateFixtures) {
    const rect = getFixtureCopyRect(finalState, fixture);
    const placementType = getFixturePlacementType(fixture);
    if (!rect || rect.w <= 0 || rect.h <= 0) return invalid('malformed-copy');
    if (!isWithinFloor(world, rect, placementType)) return invalid('outside-floor');
    candidateRects.set(fixture.id, rect);
  }

  for (const fixture of candidateFixtures.filter(candidate => candidate.type === 'door')) {
    const rect = candidateRects.get(fixture.id);
    const overlapsDoor = finalFixtures.some(candidate => candidate.type === 'door'
      && candidate.id !== fixture.id
      && (() => {
        const candidateRect = getFixtureCopyRect(finalState, candidate);
        return candidateRect && rectangleIntersects(rect, candidateRect);
      })());
    if (overlapsDoor) return invalid('door-overlap');
  }

  for (const fixture of candidateFixtures) {
    const rect = candidateRects.get(fixture.id);
    const overlapsFixture = finalFixtures.some(candidate => {
      if (candidate.id === fixture.id && copiedFixtureSet.has(candidate.id)) return false;
      const candidateRect = getFixtureCopyRect(finalState, candidate);
      if (!candidateRect) return false;
      if (fixture.type === 'door' && candidate.type === 'door') return false;
      return rectangleIntersects(rect, candidateRect);
    });
    if (overlapsFixture) return invalid('overlap');
  }

  const copiedAmenityLayout = validateAmenityLayout(finalState, candidateFixtures, finalFixtures);
  if (!copiedAmenityLayout.valid) return copiedAmenityLayout;

  if (movesStrandAnActor(currentState, finalState, copies)) {
    return invalid('door-occupied');
  }

  for (const cashier of finalFixtures.filter(fixture => fixture.type === 'cashierTable')) {
    const cashierRect = getFixtureCopyRect(finalState, cashier);
    if (!cashierRect) return invalid('malformed-copy');
    if (!hasValidCashierWorkCell(
      finalState,
      cashierRect,
      getFinalFurnitureRects(finalFixtures, cashier),
    )) return invalid('cashier-work-cell');
  }

  const copiedChairs = candidateFixtures.filter(fixture => fixture.type === 'chair');
  if (!hasValidCopiedChairRelationships(finalFixtures, copiedChairs)) {
    return invalid('chair-table');
  }

  const normalisedCopies = copies.map(copy => ({
    type: copy.type,
    id: copy.id,
    x: copy.type === 'door' ? world.doorX : copy.x,
    y: copy.y,
    ...(Object.prototype.hasOwnProperty.call(copy, 'rotation')
      ? { rotation: copy.rotation }
      : {}),
  }));
  return { valid: true, reason: null, copies: normalisedCopies };
}
