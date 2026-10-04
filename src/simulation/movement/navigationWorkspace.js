import { GRID_SIZE, getDoors, getRestaurantWorld } from '../world';
import { PLACEABLES, getPlaceableDimensions } from '../../data/placeables';
import { getAmenityGeometry, getStaffAmenityDefinition } from '../../data/staffAmenities';
import { noteNavigation } from '../navigation/telemetry';

const WORKSPACE_GEOMETRY_CACHE_LIMIT = 32;
const workspaceGeometryCache = new Map();
const immutableBlockedLookups = new WeakSet();
const UNSUPPORTED_SOURCE_VALUE = Symbol('unsupported navigation source value');
const DEFAULT_ARRAY_ITERATOR = Array.prototype[Symbol.iterator];
let lastFastlaneWorkspaceSource = null;
let activeLayoutContext = null;
// internal-plain-state-v1: only simulation-owned ticks assume plain, serialisable
// layout inputs with stable geometry/configuration. Between-tick edits are recaptured;
// public/standalone checks stay strict, and internal getter/Proxy effects are unsupported.
let internalPlainLayoutScope = false;
// Only copied immutable primitive snapshots (and links between those snapshots)
// survive a scope. No source state, array, record or identity cache is retained.
let lastLayoutContent = null;
const LAYOUT_CONTEXT_ENTRY_LIMIT = 2048;
const SIMULATION_LAYOUT_ACTIVATION_REQUESTS = 6;
let simulationLayoutBusy = false;
const FIXTURE_SOURCE_FIELDS = Object.freeze(['id', 'x', 'y']);
const CHAIR_SOURCE_FIELDS = Object.freeze(['id', 'x', 'y', 'tableId', 'rotation']);
const SERVICE_TABLE_SOURCE_FIELDS = Object.freeze(['id', 'x', 'y', 'rotation']);
const WASH_STATION_SOURCE_FIELDS = Object.freeze(['id', 'x', 'y', 'w', 'h']);
const AMENITY_SOURCE_FIELDS = Object.freeze(['id', 'type', 'x', 'y', 'rotation']);
const DOOR_SOURCE_FIELDS = Object.freeze(['id', 'y', 'role']);
const PLACEABLE_SOURCE_FIELDS = Object.freeze(['width', 'height', 'rotatable']);
const AMENITY_DEFINITION_SOURCE_FIELDS = Object.freeze(['width', 'height']);

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
  noteNavigation('workspaceFixtureRectangleBuilds');
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

function buildBlockedCellsFromGeometry(rectangles, world, doors) {
  const blocked = new Set();
  for (const rect of rectangles) blockRect(blocked, rect);
  blockRect(blocked, getTopInteriorWall(world));
  blockRect(blocked, { x: world.doorX, y: world.kitchenY, w: 6, h: world.floorH });
  const wallCellX = worldToCell({ x: world.doorX, y: 0 }).x;
  for (const door of doors) {
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

export function buildBlockedCells(state, metrics = null) {
  return buildBlockedCellsFromGeometry(
    navigationFixtureRectangles(state),
    getRestaurantWorld(state.restaurant || {}),
    getDoors(state),
  );
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
  const lookup = Object.freeze({
    has: key => blocked.has(key),
    size: blocked.size,
  });
  immutableBlockedLookups.add(lookup);
  return lookup;
}

export function isImmutableNavigationBlockedLookup(lookup) {
  return immutableBlockedLookups.has(lookup);
}

function workspaceGeometryKey(state, rectangles, world, doors) {
  noteNavigation('workspaceSignatureBuilds');
  const rectangleSignatures = rectangles.map(rect => JSON.stringify(rect)).sort();
  const chairSignatures = (state.chairs || []).map(chair => JSON.stringify([
    chair.id, chair.tableId, chair.rotation ?? 0,
  ])).sort();
  const doorSignatures = doors.map(door => JSON.stringify([
    door?.id, door?.y, door?.role,
  ])).sort();

  return {
    key: JSON.stringify([rectangleSignatures, chairSignatures, world, doorSignatures]),
    rectangleSignatures,
    chairSignatures,
  };
}

function hasCacheableWorkspaceGeometry(rectangles, world, doors) {
  return Object.values(world).every(value => Number.isFinite(value))
    && rectangles.every(rect => ['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])))
    && doors.every(door => Number.isFinite(door?.y));
}

function isFastlanePrimitive(value) {
  return value === null || value === undefined
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function isFastlaneRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (internalPlainLayoutScope) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fastlaneDataValue(record, key) {
  if (internalPlainLayoutScope) return record[key];
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor) return Object.hasOwn(descriptor, 'value')
    ? descriptor.value : UNSUPPORTED_SOURCE_VALUE;
  return Object.getOwnPropertyDescriptor(Object.prototype, key)
    ? UNSUPPORTED_SOURCE_VALUE : undefined;
}

function fastlaneArrayValue(array, index) {
  if (internalPlainLayoutScope) return array[index];
  const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value : UNSUPPORTED_SOURCE_VALUE;
}

function isFastlaneArray(value) {
  if (internalPlainLayoutScope) return Array.isArray(value);
  const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  return Array.isArray(value)
    && Object.getPrototypeOf(value) === Array.prototype
    && !Object.getOwnPropertyDescriptor(value, Symbol.iterator)
    && iterator && Object.hasOwn(iterator, 'value') && iterator.value === DEFAULT_ARRAY_ITERATOR;
}

function hasCanonicalFingerprintPrototypes() {
  return !Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
    && !Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
}

function visitSourceRecord(record, fields, visit, collectionName, consistentReads = false, includeSchema = true) {
  if (!isFastlaneRecord(record) || (includeSchema && (!visit('record') || !visit(collectionName)
    || !visit(fields.length)))) return false;
  for (const field of fields) {
    const value = fastlaneDataValue(record, field);
    if (value === UNSUPPORTED_SOURCE_VALUE || !isFastlanePrimitive(value)) return false;
    if (consistentReads && !internalPlainLayoutScope && !Object.is(record[field], value)) return false;
    if ((field === 'x' || field === 'y') && !Number.isFinite(value)) return false;
    if ((collectionName === 'washStations' && (field === 'w' || field === 'h'))
      && !Number.isFinite(value || 40)) return false;
    if ((includeSchema && !visit(field)) || !visit(value)) return false;
  }
  return true;
}

function visitWorkspaceCollection(state, name, fields, visit, visitRecord = null) {
  const collection = fastlaneDataValue(state, name);
  if (collection === UNSUPPORTED_SOURCE_VALUE || !visit('collection') || !visit(name)) return false;
  if (!collection) return isFastlanePrimitive(collection)
    && visit('empty') && visit(collection);
  if (!isFastlaneArray(collection) || !visit('array') || !visit(collection.length)) return false;
  for (let index = 0; index < collection.length; index += 1) {
    const record = fastlaneArrayValue(collection, index);
    if (record === UNSUPPORTED_SOURCE_VALUE
      || !visitSourceRecord(record, fields, visit, name)
      || (visitRecord && !visitRecord(record, visit))) return false;
  }
  return true;
}

function visitPlaceableConfiguration(type, visit) {
  const descriptor = internalPlainLayoutScope ? null : Object.getOwnPropertyDescriptor(PLACEABLES, type);
  const placeable = internalPlainLayoutScope ? PLACEABLES[type] : descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value : UNSUPPORTED_SOURCE_VALUE;
  if (!isFastlaneRecord(placeable) || !visit('placeable') || !visit(type)) return false;
  for (const field of PLACEABLE_SOURCE_FIELDS) {
    const value = fastlaneDataValue(placeable, field);
    if (value === UNSUPPORTED_SOURCE_VALUE || !isFastlanePrimitive(value)) return false;
    if (field === 'rotatable' ? typeof value !== 'boolean' : !Number.isFinite(value)) return false;
    if (!visit(field) || !visit(value)) return false;
  }
  return true;
}

function isFastlaneWorldLevel(value) {
  let level = value;
  if (value === undefined || value === null || value === false || value === 0 || value === '') {
    level = 1;
  } else if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  const areaW = 760 + (level - 1) * 180;
  const areaH = 520 + (level - 1) * 120;
  const floorW = areaW + 100;
  const floorH = areaH + 100;
  const doorX = 50 + floorW - 3;
  const queueX = doorX + 6;
  return Number.isFinite(areaW) && Number.isFinite(areaH)
    && Number.isFinite(floorW) && Number.isFinite(floorH)
    && Number.isFinite(doorX) && Number.isFinite(queueX)
    && Number.isFinite(areaH / 2 + 80);
}

function visitAmenitySource(amenity, visit) {
  const type = fastlaneDataValue(amenity, 'type');
  if (typeof type !== 'string') return false;
  const definition = getStaffAmenityDefinition(type);
  if (!isFastlaneRecord(definition) || !visit('amenity-definition')) return false;
  for (const field of AMENITY_DEFINITION_SOURCE_FIELDS) {
    const value = fastlaneDataValue(definition, field);
    if (value === UNSUPPORTED_SOURCE_VALUE || !Number.isFinite(value)
      || !visit(field) || !visit(value)) return false;
  }
  return visitPlaceableConfiguration(type, visit);
}

function visitWorkspaceSourceInputs(state, visit) {
  if (!isFastlaneRecord(state) || !hasCanonicalFingerprintPrototypes()) return false;

  const restaurant = fastlaneDataValue(state, 'restaurant');
  if (restaurant === UNSUPPORTED_SOURCE_VALUE || !visit('restaurant')) return false;
  let expansionLevel;
  if (isFastlaneRecord(restaurant)) {
    expansionLevel = fastlaneDataValue(restaurant, 'expansionLevel');
    if (expansionLevel === UNSUPPORTED_SOURCE_VALUE
      || !visit('object') || !visit('expansionLevel') || !isFastlanePrimitive(expansionLevel)
      || !visit(expansionLevel)) return false;
  } else if (isFastlanePrimitive(restaurant) && !restaurant) {
    expansionLevel = undefined;
    if (!visit('primitive') || !visit(restaurant) || !visit('expansionLevel')
      || !visit(expansionLevel)) return false;
  } else {
    return false;
  }
  if (!isFastlaneWorldLevel(expansionLevel)) return false;

  if (!visitWorkspaceCollection(state, 'tables', FIXTURE_SOURCE_FIELDS, visit)
    || !visitWorkspaceCollection(state, 'chairs', CHAIR_SOURCE_FIELDS, visit)
    || !visitWorkspaceCollection(state, 'kitchenStations', FIXTURE_SOURCE_FIELDS, visit)
    || !visitWorkspaceCollection(state, 'serviceTables', SERVICE_TABLE_SOURCE_FIELDS, visit)
    || !visitWorkspaceCollection(state, 'cashierStations', FIXTURE_SOURCE_FIELDS, visit)
    || !visitWorkspaceCollection(state, 'washStations', WASH_STATION_SOURCE_FIELDS, visit)) return false;

  const serviceTables = fastlaneDataValue(state, 'serviceTables');
  if (serviceTables === UNSUPPORTED_SOURCE_VALUE) return false;
  if (Array.isArray(serviceTables) && serviceTables.length > 0
    && !visitPlaceableConfiguration('serviceTable', visit)) return false;
  const cashierStations = fastlaneDataValue(state, 'cashierStations');
  if (cashierStations === UNSUPPORTED_SOURCE_VALUE) return false;
  if (Array.isArray(cashierStations) && cashierStations.length > 0
    && !visitPlaceableConfiguration('cashierTable', visit)) return false;

  if (!visitWorkspaceCollection(
    state,
    'staffAmenities',
    AMENITY_SOURCE_FIELDS,
    visit,
    visitAmenitySource,
  )) return false;

  const sourceDoors = fastlaneDataValue(state, 'doors');
  if (sourceDoors === UNSUPPORTED_SOURCE_VALUE || !visit('doors')) return false;
  if (Array.isArray(sourceDoors)) {
    if (!isFastlaneArray(sourceDoors) || !visit('array') || !visit(sourceDoors.length)) return false;
    for (let index = 0; index < sourceDoors.length; index += 1) {
      const door = fastlaneArrayValue(sourceDoors, index);
      if (door === UNSUPPORTED_SOURCE_VALUE
        || !visitSourceRecord(door, DOOR_SOURCE_FIELDS, visit, 'doors')) return false;
    }
  } else {
    if (!isFastlanePrimitive(sourceDoors) || !isFastlaneWorldLevel(expansionLevel)
      || !visit('fallback') || !visit(sourceDoors)
      || !visit('door1') || !visit((520 + ((expansionLevel || 1) - 1) * 120) / 2 + 80)
      || !visit(undefined)) return false;
  }
  return true;
}

function captureFastlaneWorkspaceSource(state) {
  const values = [];
  try {
    return visitWorkspaceSourceInputs(state, value => {
      if (!isFastlanePrimitive(value)) return false;
      values.push(value);
      return true;
    }) ? Object.freeze(values) : null;
  } catch (_error) {
    return null;
  }
}

function matchesFastlaneWorkspaceSource(values, state) {
  let index = 0;
  try {
    return visitWorkspaceSourceInputs(state, value => isFastlanePrimitive(value)
      && index < values.length && Object.is(values[index++], value))
      && index === values.length;
  } catch (_error) {
    return false;
  }
}

/**
 * The synchronous simulation owns layout fields/configuration for this scope:
 * they must not be mutated in place until it returns. Derived layouts replace
 * records/collections; actor state and fixture status may change freely. Nothing
 * from this identity cache survives the scope. Standalone callers still use the
 * ordinary source checks, including edits to existing objects between calls.
 */
export function withNavigationLayoutContext(state, run) {
  return runNavigationLayoutContext(state, run, false);
}

/**
 * Simulation-only cache policy: 2-3-query ticks use the fully validated
 * standalone resolver. Six requests activate ownership caching. A successful
 * busy top-level tick predicts eager activation next time; only this boolean
 * hint survives, never source identities. Explicit ownership remains eager.
 */
export function withSimulationNavigationLayoutContext(state, run) {
  return runNavigationLayoutContext(state, run, true);
}

function runNavigationLayoutContext(state, run, simulation) {
  if (Object.prototype.toString.call(run) === '[object AsyncFunction]') {
    throw new Error('Navigation layout contexts must be synchronous');
  }
  const previous = activeLayoutContext;
  const context = { enabled: true, entries: 0, states: null, inputs: null,
    tokens: null, tokenSnapshots: null, geometries: null, simulation, requests: 0, activated: false,
    activationAt: simulation && !simulationLayoutBusy ? SIMULATION_LAYOUT_ACTIVATION_REQUESTS : 1 };
  activeLayoutContext = context;
  internalPlainLayoutScope = simulation;
  let completed = false;
  try {
    const result = run(state);
    if (result && typeof result.then === 'function') throw new Error('Navigation layout contexts must be synchronous');
    completed = true;
    return result;
  } finally {
    activeLayoutContext = previous;
    internalPlainLayoutScope = !!previous?.simulation && previous.enabled;
    if (simulation && previous === null && completed) {
      simulationLayoutBusy = context.requests === SIMULATION_LAYOUT_ACTIVATION_REQUESTS;
    }
  }
}

function layoutContextEntry(context) {
  if (!context.enabled) return false;
  context.entries += 1;
  if (context.entries <= LAYOUT_CONTEXT_ENTRY_LIMIT) return true;
  context.enabled = false;
  internalPlainLayoutScope = false;
  context.geometries?.clear();
  return false;
}

function layoutToken(context, values) {
  context.tokens ||= new Map();
  context.tokenSnapshots ||= new WeakSet();
  const kind = values[0];
  let candidates = context.tokens.get(kind);
  if (!candidates) context.tokens.set(kind, candidates = []);
  const same = candidate => candidate.values.length === values.length
    && values.every((value, index) => Object.is(value, candidate.values[index]));
  const local = candidates.find(same);
  if (local) return local;
  const previous = lastLayoutContent?.tokens !== context.tokens
    ? lastLayoutContent?.tokens.get(kind)?.find(same) : null;
  const token = previous || Object.freeze({ values: Object.freeze([...values]) });
  candidates.push(token);
  context.tokenSnapshots.add(token);
  return token;
}

function rememberLayoutContent(context, source, cacheKey) {
  if (lastLayoutContent?.source !== source || lastLayoutContent.tokens !== context.tokens) {
    lastLayoutContent = { source, cacheKey, tokens: context.tokens };
  }
}

function cacheLayoutGeometry(context, source, cacheKey, geometry) {
  if (context.geometries.size >= WORKSPACE_GEOMETRY_CACHE_LIMIT && !context.geometries.has(source)) {
    context.enabled = false;
    internalPlainLayoutScope = false;
    return;
  }
  context.geometries.set(source, { cacheKey, geometry });
  rememberLayoutContent(context, source, cacheKey);
}

function memoLayoutInput(context, owner, kind, capture) {
  let entry = context.inputs.get(owner);
  if (entry) {
    if (entry.kind === kind) return entry.token;
    const cached = entry.spill?.get(kind);
    if (cached !== undefined) return cached;
  }
  if (!layoutContextEntry(context)) return null;
  if (!entry) context.inputs.set(owner, entry = { kind: null, token: null, spill: null });
  const values = [kind];
  const valid = capture(value => {
    if (!isFastlanePrimitive(value) && !context.tokenSnapshots?.has(value)) return false;
    values.push(value);
    return true;
  });
  const token = valid && context.enabled ? layoutToken(context, values) : null;
  // Publish only after capture: a consistent input proxy may synchronously
  // request another layout, completing this owner under another kind first.
  if (entry.kind === null || entry.kind === kind) {
    entry.kind = kind;
    entry.token = token;
  } else {
    if (!entry.spill) {
      entry.spill = new Map();
      noteNavigation('workspaceLayoutInputSpills');
    }
    entry.spill.set(kind, token);
  }
  return token;
}

function layoutCollectionToken(context, collection, name, fields) {
  if (!collection) return isFastlanePrimitive(collection)
    ? layoutToken(context, [name, 'empty', collection]) : null;
  if (!Array.isArray(collection)) return null;
  return memoLayoutInput(context, collection, `collection:${name}`, visit => {
    if (!isFastlaneArray(collection) || (!internalPlainLayoutScope && collection[Symbol.iterator] !== DEFAULT_ARRAY_ITERATOR)
      || !visit(collection.length)) return false;
    for (let index = 0; index < collection.length; index += 1) {
      const record = fastlaneArrayValue(collection, index);
      if (!isFastlaneRecord(record) || (!internalPlainLayoutScope && collection[index] !== record)) return false;
      const token = memoLayoutInput(context, record, `record:${name}`, recordVisit => {
        noteNavigation('workspaceLayoutRecordChecks');
        // The token kind fixes the schema. Internal plain ownership skips
        // defensive inspection only; every source field value stays in order.
        if (!visitSourceRecord(record, fields, recordVisit, name, true, false)) return false;
        if (name !== 'staffAmenities') return true;
        const configuration = memoLayoutInput(context, PLACEABLES, `amenity:${record.type}`,
          configVisit => visitAmenitySource(record, configVisit));
        return configuration !== null && recordVisit(configuration);
      });
      if (token === null || !visit(token)) return false;
    }
    return true;
  });
}

function layoutContextKey(context, state) {
  if (!context.enabled || !isFastlaneRecord(state)) return null;
  context.states ||= new WeakMap();
  context.inputs ||= new WeakMap();
  context.geometries ||= new Map();
  if (context.states.has(state)) return context.states.get(state);
  if (!layoutContextEntry(context)) return null;
  let key = null;
  try {
    if (!hasCanonicalFingerprintPrototypes()) return null;
    const restaurant = fastlaneDataValue(state, 'restaurant');
    if (restaurant === UNSUPPORTED_SOURCE_VALUE || (!internalPlainLayoutScope && restaurant !== state.restaurant)) return null;
    let worldToken;
    if (isFastlaneRecord(restaurant)) {
      worldToken = memoLayoutInput(context, restaurant, 'world', visit => {
        const level = fastlaneDataValue(restaurant, 'expansionLevel');
        return level !== UNSUPPORTED_SOURCE_VALUE && (internalPlainLayoutScope || Object.is(level, restaurant.expansionLevel))
          && isFastlaneWorldLevel(level) && visit(level);
      });
    } else if (isFastlanePrimitive(restaurant) && !restaurant) {
      worldToken = layoutToken(context, ['world', 'empty', restaurant]);
    } else return null;
    if (worldToken === null) return null;
    const values = ['layout', worldToken];
    for (const [name, fields] of [
      ['tables', FIXTURE_SOURCE_FIELDS], ['chairs', CHAIR_SOURCE_FIELDS],
      ['kitchenStations', FIXTURE_SOURCE_FIELDS], ['serviceTables', SERVICE_TABLE_SOURCE_FIELDS],
      ['cashierStations', FIXTURE_SOURCE_FIELDS], ['washStations', WASH_STATION_SOURCE_FIELDS],
      ['staffAmenities', AMENITY_SOURCE_FIELDS], ['doors', DOOR_SOURCE_FIELDS],
    ]) {
      const collection = fastlaneDataValue(state, name);
      if (collection === UNSUPPORTED_SOURCE_VALUE || (!internalPlainLayoutScope && !Object.is(collection, state[name]))) return null;
      const token = name === 'doors' && !Array.isArray(collection)
        ? isFastlanePrimitive(collection) ? layoutToken(context, ['fallback-doors', collection]) : null
        : layoutCollectionToken(context, collection, name, fields);
      if (token === null) return null;
      values.push(token);
      if ((name === 'serviceTables' || name === 'cashierStations') && collection?.length) {
        const type = name === 'serviceTables' ? 'serviceTable' : 'cashierTable';
        const configuration = memoLayoutInput(context, PLACEABLES, `placeable:${type}`,
          visit => visitPlaceableConfiguration(type, visit));
        if (configuration === null) return null;
        values.push(configuration);
      }
    }
    if (context.enabled) key = layoutToken(context, values);
    return key;
  } catch (_error) {
    return null;
  } finally {
    context.states.set(state, key);
  }
}

function createWorkspaceGeometry(rectangles, world, doors, bounds, signatures) {
  const blocked = buildBlockedCellsFromGeometry(rectangles, world, doors);
  const blockedCellKeys = Object.freeze([...blocked].sort());
  return Object.freeze({
    bounds,
    blockedCells: readOnlyBlockedLookup(blocked),
    blockedCellKeys,
    topologyFingerprint: JSON.stringify([
      bounds.left,
      bounds.right,
      bounds.top,
      bounds.bottom,
      blockedCellKeys,
      signatures.rectangleSignatures,
      signatures.chairSignatures,
    ]),
  });
}

function promoteCachedWorkspaceGeometry(key) {
  const geometry = workspaceGeometryCache.get(key);
  if (!geometry) return null;
  workspaceGeometryCache.delete(key);
  workspaceGeometryCache.set(key, geometry);
  noteNavigation('workspaceGeometryCacheHits');
  return geometry;
}

function cacheWorkspaceGeometry(key, geometry) {
  workspaceGeometryCache.set(key, geometry);
  if (workspaceGeometryCache.size > WORKSPACE_GEOMETRY_CACHE_LIMIT) {
    workspaceGeometryCache.delete(workspaceGeometryCache.keys().next().value);
  }
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
  const context = activeLayoutContext;
  if (context?.simulation) {
    if (context.requests < SIMULATION_LAYOUT_ACTIVATION_REQUESTS) context.requests += 1;
    if (!context.activated && context.requests >= context.activationAt) {
      context.activated = true;
      noteNavigation('workspaceLayoutActivations');
    }
    if (!context.activated) noteNavigation('workspaceLayoutDeferredChecks');
  }
  const key = context && (!context.simulation || context.activated) ? layoutContextKey(context, state) : null;
  const cached = key !== null ? context.geometries.get(key) : null;
  if (cached) {
    noteNavigation('workspaceLayoutContextHits');
    rememberLayoutContent(context, key, cached.cacheKey);
    return Object.freeze({ state, ...cached.geometry });
  }
  if (key !== null && key === lastLayoutContent?.source) {
    const cacheKey = lastLayoutContent.cacheKey;
    const geometry = promoteCachedWorkspaceGeometry(cacheKey);
    if (geometry) {
      cacheLayoutGeometry(context, key, cacheKey, geometry);
      noteNavigation('workspaceLayoutContentHits');
      return Object.freeze({ state, ...geometry });
    }
  }
  return buildNavigationWorkspace(state, key !== null, key !== null
    ? (cacheKey, geometry) => cacheLayoutGeometry(context, key, cacheKey, geometry) : null);
}

function buildNavigationWorkspace(state, sourceValidated = false, remember = null) {
  // Public ownership already rejected this source if it reached fallback.
  // Keep defensive capture, but never trust its descriptor-only cache mapping.
  const sourceFastlaneAllowed = !activeLayoutContext || activeLayoutContext.simulation;
  if (sourceFastlaneAllowed && !sourceValidated && lastFastlaneWorkspaceSource
    && matchesFastlaneWorkspaceSource(lastFastlaneWorkspaceSource.inputs, state)) {
    const geometry = promoteCachedWorkspaceGeometry(lastFastlaneWorkspaceSource.key);
    if (geometry) {
      noteNavigation('workspaceFastlaneHits');
      return Object.freeze({ state, ...geometry });
    }
    lastFastlaneWorkspaceSource = null;
  }

  const fastlaneSource = sourceValidated ? null : captureFastlaneWorkspaceSource(state);
  const world = getRestaurantWorld(state?.restaurant || {});
  const rectangles = navigationFixtureRectangles(state);
  const doors = getDoors(state);
  const cacheable = hasCacheableWorkspaceGeometry(rectangles, world, doors);
  const signatures = workspaceGeometryKey(state, rectangles, world, doors);
  let geometry = cacheable ? promoteCachedWorkspaceGeometry(signatures.key) : null;
  if (!geometry) {
    const bounds = Object.freeze({
      left: world.floorX,
      right: world.queueX + world.queueW,
      top: world.kitchenY,
      bottom: world.diningY + world.areaH + 50,
    });
    geometry = createWorkspaceGeometry(rectangles, world, doors, bounds, signatures);
    if (cacheable) cacheWorkspaceGeometry(signatures.key, geometry);
    noteNavigation('workspaceGeometryBuilds');
  }
  if (cacheable && remember) remember(signatures.key, geometry);
  if (sourceFastlaneAllowed && cacheable && fastlaneSource) {
    lastFastlaneWorkspaceSource = { inputs: fastlaneSource, key: signatures.key };
  }
  return Object.freeze({
    state,
    ...geometry,
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
