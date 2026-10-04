import { GRID_SIZE, getDoors, getRestaurantWorld, isDoorRoleForFlow } from '../world';
import {
  cellKey,
  cellToWorld,
  isImmutableNavigationBlockedLookup,
  resolveNavigationWorkspace,
  worldToCell,
} from '../movement/navigationWorkspace';
import { noteNavigation } from './telemetry';

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const comparePoints = (a, b) => a.y - b.y || a.x - b.x;
const STATIC_NEIGHBOUR_GRID_LIMIT = 8;
const STATIC_NEIGHBOUR_POINT_LIMIT = 512;
const OFF_LATTICE_NEIGHBOUR_POINT_LIMIT = 64;
const STATIC_FLOW_BLOCKED_RASTER_LIMIT = 8;
const STATIC_REACHABILITY_GRID_LIMIT = 8;
const STATIC_REACHABILITY_NODE_LIMIT = 8192;
const staticNeighbourCache = new Map();
const staticNeighbourCacheLru = new Map();
const staticRasterKeyCache = new WeakMap();
const staticFlowBlockedRasterCache = new Map();
const staticFlowBlockedRasterLru = new Map();
const staticReachabilityCache = new Map();
const trustedGridReachability = new WeakMap();
const plannerNeighbourQueries = new WeakMap();

function getStaticNeighbourCache(rasterKey, variantKey) {
  noteNavigation('neighbourCacheSignatureAcquisitions');
  let variants = staticNeighbourCache.get(rasterKey);
  if (!variants) {
    variants = new Map();
    staticNeighbourCache.set(rasterKey, variants);
  }

  let entry = variants.get(variantKey);
  if (entry) {
    staticNeighbourCacheLru.delete(entry);
    staticNeighbourCacheLru.set(entry, true);
    return entry.points;
  }

  entry = { rasterKey, variantKey, points: new Map() };
  variants.set(variantKey, entry);
  staticNeighbourCacheLru.set(entry, true);
  if (staticNeighbourCacheLru.size > STATIC_NEIGHBOUR_GRID_LIMIT) {
    const oldest = staticNeighbourCacheLru.keys().next().value;
    staticNeighbourCacheLru.delete(oldest);
    const oldestVariants = staticNeighbourCache.get(oldest.rasterKey);
    oldestVariants?.delete(oldest.variantKey);
    if (!oldestVariants?.size) staticNeighbourCache.delete(oldest.rasterKey);
    noteNavigation('neighbourCacheEvictions');
  }
  return entry.points;
}

function getStaticFlowBlockedRaster(identity, build) {
  let variants = staticFlowBlockedRasterCache.get(identity.rasterKey);
  if (!variants) {
    variants = new Map();
    staticFlowBlockedRasterCache.set(identity.rasterKey, variants);
  }

  let entry = variants.get(identity.variantKey);
  if (entry) {
    staticFlowBlockedRasterLru.delete(entry);
    staticFlowBlockedRasterLru.set(entry, true);
    noteNavigation('flowBlockedRasterCacheHits');
    return entry.blockedCells;
  }

  entry = {
    rasterKey: identity.rasterKey,
    variantKey: identity.variantKey,
    blockedCells: build(),
  };
  variants.set(identity.variantKey, entry);
  staticFlowBlockedRasterLru.set(entry, true);
  if (staticFlowBlockedRasterLru.size > STATIC_FLOW_BLOCKED_RASTER_LIMIT) {
    const oldest = staticFlowBlockedRasterLru.keys().next().value;
    staticFlowBlockedRasterLru.delete(oldest);
    const oldestVariants = staticFlowBlockedRasterCache.get(oldest.rasterKey);
    oldestVariants?.delete(oldest.variantKey);
    if (!oldestVariants?.size) staticFlowBlockedRasterCache.delete(oldest.rasterKey);
    noteNavigation('flowBlockedRasterCacheEvictions');
  }
  return entry.blockedCells;
}

function copyPoints(points) {
  return points.map(point => ({ x: point.x, y: point.y }));
}

function freezePoints(points) {
  return Object.freeze(points.map(point => Object.freeze({ x: point.x, y: point.y })));
}

function cacheKeyValue(value) {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return [type, value];
  if (type === 'number') {
    return ['number', Number.isNaN(value) ? 'NaN' : Object.is(value, -0) ? '-0' : String(value)];
  }
  if (type === 'bigint' || type === 'symbol') return [type, String(value)];
  return null;
}

function offLatticeNeighbourPointKey(point) {
  if (!point || typeof point !== 'object') return null;
  try {
    const x = Object.getOwnPropertyDescriptor(point, 'x');
    const y = Object.getOwnPropertyDescriptor(point, 'y');
    if (!x || !Object.hasOwn(x, 'value') || !y || !Object.hasOwn(y, 'value')
      || !Number.isFinite(x.value) || !Number.isFinite(y.value)) return null;
    return JSON.stringify([cacheKeyValue(x.value), cacheKeyValue(y.value)]);
  } catch (_error) {
    return null;
  }
}

function stableDataPointCoordinates(point) {
  if (!point || typeof point !== 'object') return null;
  try {
    const x = Object.getOwnPropertyDescriptor(point, 'x');
    const y = Object.getOwnPropertyDescriptor(point, 'y');
    if (!x || !Object.hasOwn(x, 'value') || !y || !Object.hasOwn(y, 'value')
      || !Number.isFinite(x.value) || !Number.isFinite(y.value)) return null;
    return { x: x.value, y: y.value };
  } catch (_error) {
    return null;
  }
}

function getStaticRasterKey(navigation, world) {
  const { bounds, topologyFingerprint, blockedCells, blockedCellKeys } = navigation;
  if (typeof topologyFingerprint !== 'string' || !topologyFingerprint
    || !Object.isFrozen(navigation) || !Object.isFrozen(bounds)
    || !isImmutableNavigationBlockedLookup(blockedCells) || !Object.isFrozen(blockedCells)
    || !Array.isArray(blockedCellKeys)
    || !Object.isFrozen(blockedCellKeys) || blockedCellKeys.length !== blockedCells.size
    || !Object.values(bounds).every(Number.isFinite)
    || !Object.values(world).every(Number.isFinite)) return null;

  const doorX = world.doorX;
  const cached = staticRasterKeyCache.get(blockedCellKeys);
  if (cached && cached.blockedCells === blockedCells
    && Object.is(cached.left, bounds.left) && Object.is(cached.right, bounds.right)
    && Object.is(cached.top, bounds.top) && Object.is(cached.bottom, bounds.bottom)
    && Object.is(cached.doorX, doorX)) return cached.key;

  if (!blockedCellKeys.every(key => typeof key === 'string' && blockedCells.has(key))) {
    staticRasterKeyCache.set(blockedCellKeys, {
      blockedCells, left: bounds.left, right: bounds.right, top: bounds.top,
      bottom: bounds.bottom, doorX, key: null,
    });
    return null;
  }

  const key = JSON.stringify([
    cacheKeyValue(bounds.left), cacheKeyValue(bounds.right),
    cacheKeyValue(bounds.top), cacheKeyValue(bounds.bottom), cacheKeyValue(doorX),
    blockedCellKeys,
  ]);
  staticRasterKeyCache.set(blockedCellKeys, {
    blockedCells, left: bounds.left, right: bounds.right, top: bounds.top,
    bottom: bounds.bottom, doorX, key,
  });
  noteNavigation('neighbourRasterKeyBuilds');
  return key;
}

function createNeighbourCacheIdentity(navigation, world, doors, doorFlow) {
  if (!doors.every(door => Number.isFinite(door?.y))) return null;

  const doorKeys = doors.map(door => {
    const id = cacheKeyValue(door?.id);
    const role = cacheKeyValue(door?.role);
    return id && role ? [id, door.y, role] : null;
  });
  if (doorKeys.some(key => key === null)) return null;

  const flowKey = doorFlow == null ? ['absent'] : [
    'present',
    cacheKeyValue(doorFlow?.direction),
    cacheKeyValue(doorFlow?.doorId),
    doorFlow?.allowRoleMismatch === true,
  ];
  if (flowKey.some(value => value === null)) return null;

  const rasterKey = getStaticRasterKey(navigation, world);
  if (rasterKey === null) return null;
  return { rasterKey, variantKey: JSON.stringify([doorKeys, flowKey]) };
}

function isCacheIdentityPrimitive(value) {
  return value == null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value);
}

function cacheIdentityProperty(target, key, { allowObject = false } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) return null;
  const prototype = Object.getPrototypeOf(target);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const inherited = prototype ? Object.getOwnPropertyDescriptor(prototype, key) : undefined;
  if (inherited && !Object.hasOwn(inherited, 'value')) return null;
  const value = descriptor ? descriptor.value : inherited?.value;
  if (!isCacheIdentityPrimitive(value)
    && !(allowObject && value !== null && typeof value === 'object')) return null;
  return { value };
}

function snapshotNeighbourCacheInputs(doors, options) {
  try {
    if (!Array.isArray(doors) || Object.getPrototypeOf(doors) !== Array.prototype
      || Object.getPrototypeOf(options) !== Object.prototype) return null;

    const doorRecords = [];
    for (let index = 0; index < doors.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(doors, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      const door = descriptor.value;
      if (!door || typeof door !== 'object') return null;
      const fields = Object.fromEntries(['id', 'y', 'role'].map(key => [
        key, cacheIdentityProperty(door, key),
      ]));
      if (Object.values(fields).some(field => field === null)
        || !Number.isFinite(fields.y.value)) return null;
      doorRecords.push(Object.freeze({
        id: fields.id.value,
        y: fields.y.value,
        role: fields.role.value,
      }));
    }

    const flow = cacheIdentityProperty(options, 'doorFlow', { allowObject: true });
    if (flow === null) return null;
    let doorFlow = null;
    if (flow.value != null) {
      if (typeof flow.value !== 'object' || Array.isArray(flow.value)) return null;
      const flowFields = Object.fromEntries(['direction', 'doorId', 'allowRoleMismatch'].map(key => [
        key, cacheIdentityProperty(flow.value, key),
      ]));
      if (Object.values(flowFields).some(field => field === null)) return null;
      doorFlow = Object.freeze({
        direction: flowFields.direction.value,
        doorId: flowFields.doorId.value,
        allowRoleMismatch: flowFields.allowRoleMismatch.value,
      });
    }

    return Object.freeze({ doors: Object.freeze(doorRecords), doorFlow });
  } catch (_error) {
    return null;
  }
}

function isAllowedDoorYUnchanged(door, creationY) {
  if (!door) return true;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(door, 'y');
    return Boolean(descriptor && Object.hasOwn(descriptor, 'value')
      && Object.is(descriptor.value, creationY));
  } catch (_error) {
    return false;
  }
}

function latticeDimensions(bounds) {
  if (!bounds || !['left', 'right', 'top', 'bottom'].every(key => Number.isFinite(bounds[key]))) return null;
  const firstX = Math.ceil(bounds.left / GRID_SIZE) * GRID_SIZE;
  const lastX = Math.floor(bounds.right / GRID_SIZE) * GRID_SIZE;
  const firstY = Math.ceil(bounds.top / GRID_SIZE) * GRID_SIZE;
  const lastY = Math.floor(bounds.bottom / GRID_SIZE) * GRID_SIZE;
  if (![firstX, lastX, firstY, lastY].every(Number.isSafeInteger)
    || firstX > lastX || firstY > lastY) return null;
  const width = Math.floor((lastX - firstX) / GRID_SIZE) + 1;
  const height = Math.floor((lastY - firstY) / GRID_SIZE) + 1;
  const nodeCount = width * height;
  if (!Number.isSafeInteger(nodeCount) || nodeCount > STATIC_REACHABILITY_NODE_LIMIT) return null;
  return { firstX, lastX, firstY, lastY, width, height, nodeCount };
}

function safePointCoordinates(point) {
  return finitePoint(point)
    && Number.isSafeInteger(Math.floor(point.x))
    && Number.isSafeInteger(Math.floor(point.y));
}

function isWithinLatticeBounds(point, dimensions) {
  return isLatticePoint(point) && Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)
    && point.x >= dimensions.firstX && point.x <= dimensions.lastX
    && point.y >= dimensions.firstY && point.y <= dimensions.lastY;
}

function latticePointKey(point) {
  return `${point.x},${point.y}`;
}

function buildLatticeComponentIndex(grid, dimensions) {
  const componentByPoint = new Map();
  let component = 0;
  for (let y = dimensions.firstY; y <= dimensions.lastY; y += GRID_SIZE) {
    for (let x = dimensions.firstX; x <= dimensions.lastX; x += GRID_SIZE) {
      const start = { x, y };
      const startKey = latticePointKey(start);
      if (componentByPoint.has(startKey) || !grid.isOpen(start)) continue;

      component += 1;
      componentByPoint.set(startKey, component);
      const frontier = [start];
      while (frontier.length) {
        const current = frontier.pop();
        for (const [dx, dy] of [[0, -GRID_SIZE], [-GRID_SIZE, 0], [GRID_SIZE, 0], [0, GRID_SIZE]]) {
          const neighbour = { x: current.x + dx, y: current.y + dy };
          if (!isWithinLatticeBounds(neighbour, dimensions)) continue;
          const key = latticePointKey(neighbour);
          if (componentByPoint.has(key) || !grid.segmentClear(current, neighbour)) continue;
          componentByPoint.set(key, component);
          frontier.push(neighbour);
        }
      }
    }
  }
  return { componentByPoint, nodeCount: dimensions.nodeCount };
}

function getLatticeComponentIndex(identity, grid, dimensions) {
  const key = JSON.stringify([identity.rasterKey, identity.variantKey]);
  let entry = staticReachabilityCache.get(key);
  if (entry) {
    staticReachabilityCache.delete(key);
    staticReachabilityCache.set(key, entry);
    noteNavigation('latticeReachabilityIndexHits');
    return entry;
  }

  entry = buildLatticeComponentIndex(grid, dimensions);
  staticReachabilityCache.set(key, entry);
  noteNavigation('latticeReachabilityIndexBuilds');
  noteNavigation('latticeReachabilityIndexNodes', entry.nodeCount);
  if (staticReachabilityCache.size > STATIC_REACHABILITY_GRID_LIMIT) {
    staticReachabilityCache.delete(staticReachabilityCache.keys().next().value);
    noteNavigation('latticeReachabilityIndexEvictions');
  }
  return entry;
}

/**
 * Internal query-order eligibility. Domain wrappers do not inherit this brand;
 * borrowed workspaces and changed or accessor-backed live doors fall back.
 */
export function hasStableSegmentGeometry(grid) {
  const trusted = trustedGridReachability.get(grid);
  if (!trusted?.ownsSegmentGeometry || !Object.isFrozen(grid)) return false;
  try { return Boolean(trusted.getIdentity()); } catch (_error) { return false; }
}

/**
 * Return an exact lattice-graph reachability result for a trusted createGrid,
 * or null when the router must retain its general search semantics.
 */
export function queryLatticeReachability(grid, start, goal) {
  noteNavigation('latticeReachabilityQueries');
  const trusted = trustedGridReachability.get(grid);
  if (!trusted || !Object.isFrozen(grid) || !isLatticePoint(goal)) return null;
  const dimensions = latticeDimensions(grid.bounds);
  if (!dimensions || !isWithinLatticeBounds(goal, dimensions)) return null;
  const identity = trusted.getIdentity();
  if (!identity) return null;
  if (!grid.isOpen(start) || !grid.isOpen(goal)) return false;
  if (!safePointCoordinates(start)) return null;
  noteNavigation('latticeReachabilityFastPaths');
  if (start.x === goal.x && start.y === goal.y) return true;

  let portals;
  if (isLatticePoint(start)) {
    if (!isWithinLatticeBounds(start, dimensions)) return null;
    portals = [start];
  } else {
    portals = grid.neighbours(start);
    if (portals.length === 0) portals = grid.connectors?.(start) || [];
    if (portals.some(point => !isWithinLatticeBounds(point, dimensions))) return null;
    if (portals.length === 0) return false;
  }

  const index = getLatticeComponentIndex(identity, grid, dimensions);
  const goalComponent = index.componentByPoint.get(latticePointKey(goal));
  if (goalComponent === undefined) return false;
  return portals.some(portal => index.componentByPoint.get(latticePointKey(portal)) === goalComponent);
}

export function getPlannerNeighbours(grid, point) {
  const query = plannerNeighbourQueries.get(grid);
  return query ? query(point) : grid.neighbours(point);
}

export function isLatticePoint(point) {
  return finitePoint(point) && point.x % GRID_SIZE === 0 && point.y % GRID_SIZE === 0;
}

function fallbackLatticeAnchors(point) {
  const xs = [...new Set([Math.floor(point.x / GRID_SIZE), Math.ceil(point.x / GRID_SIZE)])];
  const ys = [...new Set([Math.floor(point.y / GRID_SIZE), Math.ceil(point.y / GRID_SIZE)])];
  return ys.flatMap(y => xs.map(x => cellToWorld({ x, y }))).sort(comparePoints);
}

export function latticeAnchors(point) {
  if (!finitePoint(point)) return [];
  const firstX = Math.floor(point.x / GRID_SIZE);
  const lastX = Math.ceil(point.x / GRID_SIZE);
  const firstY = Math.floor(point.y / GRID_SIZE);
  const lastY = Math.ceil(point.y / GRID_SIZE);
  if (![firstX, lastX, firstY, lastY].every(Number.isSafeInteger)) {
    noteNavigation('latticeAnchorFallbacks');
    return fallbackLatticeAnchors(point);
  }

  noteNavigation('latticeAnchorFastPaths');
  const anchors = [];
  const xCount = firstX === lastX ? 1 : 2;
  const yCount = firstY === lastY ? 1 : 2;
  for (let row = 0; row < yCount; row += 1) {
    const y = row === 0 ? firstY : lastY;
    for (let column = 0; column < xCount; column += 1) {
      const x = column === 0 ? firstX : lastX;
      anchors.push(cellToWorld({ x: x === 0 ? 0 : x, y: y === 0 ? 0 : y }));
    }
  }
  return anchors;
}

function buildFlowBlockedRaster(navigation, world, doorFlow, doors) {
  const blocked = new Set(navigation.blockedCellKeys);
  noteNavigation('flowBlockedRasterBuilds');
  noteNavigation('flowBlockedCellKeysCopied', blocked.size);
  const wallCellX = worldToCell({ x: world.doorX, y: 0 }).x;
  const allowedDoorId = doorFlow.doorId == null ? null : String(doorFlow.doorId);
  const allowedDoor = doors.find(door => String(door?.id) === allowedDoorId);
  const doorCanBeUsed = allowedDoor
    && (isDoorRoleForFlow(allowedDoor, doorFlow.direction) || doorFlow.allowRoleMismatch === true);

  for (const door of doors) {
    if (doorCanBeUsed && String(door?.id) === allowedDoorId) continue;
    const firstDoorCell = worldToCell({ x: world.doorX, y: door.y }).y;
    const lastDoorCell = worldToCell({ x: world.doorX, y: door.y + 39 }).y;
    for (let y = firstDoorCell; y <= lastDoorCell; y += 1) {
      blocked.add(cellKey({ x: wallCellX, y }));
    }
  }
  return blocked;
}

function flowBlockedCells(state, navigation, doorFlow, doors, cache = null) {
  if (!doorFlow || !['ingress', 'egress'].includes(doorFlow.direction)) {
    return navigation.blockedCells;
  }

  if (cache?.identity && cache.inputs) {
    return getStaticFlowBlockedRaster(cache.identity, () => buildFlowBlockedRaster(
      navigation, cache.world, cache.inputs.doorFlow, cache.inputs.doors,
    ));
  }

  return buildFlowBlockedRaster(
    navigation, getRestaurantWorld(state.restaurant || {}), doorFlow, doors,
  );
}

export function createGrid(state, workspace = null, options = {}) {
  const navigation = resolveNavigationWorkspace(state, workspace);
  const ownsSegmentGeometry = workspace == null;
  const { bounds } = navigation;
  const world = getRestaurantWorld(state.restaurant || {});
  const doors = getDoors(state);
  const neighbourCacheInputs = snapshotNeighbourCacheInputs(doors, options);
  let neighbourCacheIdentity;
  let neighbourCacheIdentityReported = false;
  const getNeighbourCacheIdentity = () => {
    if (neighbourCacheIdentity === undefined) {
      neighbourCacheIdentity = neighbourCacheInputs
        ? createNeighbourCacheIdentity(
          navigation, world, neighbourCacheInputs.doors, neighbourCacheInputs.doorFlow,
        )
        : null;
    }
    if (!neighbourCacheIdentityReported) {
      noteNavigation('neighbourCacheKeyBuilds');
      neighbourCacheIdentityReported = true;
    }
    return neighbourCacheIdentity;
  };
  const flowSnapshot = neighbourCacheInputs?.doorFlow;
  let flowCacheIdentity = null;
  if (flowSnapshot && ['ingress', 'egress'].includes(flowSnapshot.direction)) {
    noteNavigation('flowBlockedRasterKeyBuilds');
    neighbourCacheIdentity = createNeighbourCacheIdentity(
      navigation, world, neighbourCacheInputs.doors, neighbourCacheInputs.doorFlow,
    );
    flowCacheIdentity = neighbourCacheIdentity;
  }
  const blockedCells = flowBlockedCells(state, navigation, options.doorFlow, doors,
    flowCacheIdentity ? { identity: flowCacheIdentity, inputs: neighbourCacheInputs, world } : null);
  const doorGeometrySignature = JSON.stringify(doors
    .map(door => [door?.id, door?.y, door?.role]));
  const signature = options.doorFlow
    && ['ingress', 'egress'].includes(options.doorFlow.direction)
    ? `${navigation.topologyFingerprint}:doors:${doorGeometrySignature}:flow:${options.doorFlow.direction}:${String(options.doorFlow.doorId ?? '')}:${doors.find(door => String(door?.id) === String(options.doorFlow.doorId ?? ''))?.role || ''}:${options.doorFlow.allowRoleMismatch === true ? 'crossing' : ''}`
    : `${navigation.topologyFingerprint}:doors:${doorGeometrySignature}`;
  const isOpen = point => Boolean(finitePoint(point)
    && point.x >= bounds.left && point.x <= bounds.right
    && point.y >= bounds.top && point.y <= bounds.bottom
    && !blockedCells.has(cellKey(worldToCell(point))));

  const allowedDoor = options.doorFlow?.doorId == null
    ? null
    : doors.find(door => String(door?.id) === String(options.doorFlow.doorId));
  let allowedDoorYAtCreation;
  let allowedDoorYCacheable = allowedDoor == null;
  if (allowedDoor) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(allowedDoor, 'y');
      if (descriptor && Object.hasOwn(descriptor, 'value')) {
        allowedDoorYAtCreation = descriptor.value;
        allowedDoorYCacheable = Object.is(Object.getPrototypeOf(allowedDoor), Object.prototype)
          || Object.getPrototypeOf(allowedDoor) === null;
      }
    } catch (_error) {
      allowedDoorYCacheable = false;
    }
  }
  const canUseGeneralSegmentShortcuts = ownsSegmentGeometry && Boolean(neighbourCacheInputs)
    && allowedDoorYCacheable && Object.isFrozen(navigation) && Object.isFrozen(bounds)
    && isImmutableNavigationBlockedLookup(navigation.blockedCells)
    && Object.values(world).every(Number.isFinite);
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
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    if (isLatticePoint(from) && isLatticePoint(to)
      && ((Math.abs(deltaX) === GRID_SIZE && deltaY === 0)
        || (Math.abs(deltaY) === GRID_SIZE && deltaX === 0))) {
      noteNavigation('segmentBoundaryPartitionsAvoided');
      return true;
    }
    if (canUseGeneralSegmentShortcuts) {
      const fromPoint = stableDataPointCoordinates(from);
      const toPoint = stableDataPointCoordinates(to);
      if (fromPoint && toPoint) {
        const fromCell = worldToCell(fromPoint);
        const toCell = worldToCell(toPoint);
        if ([fromCell.x, fromCell.y, toCell.x, toCell.y].every(Number.isSafeInteger)) {
          if (fromCell.x === toCell.x && fromCell.y === toCell.y) {
            noteNavigation('segmentSameCellShortcuts');
            noteNavigation('segmentBoundaryPartitionsAvoided');
            return true;
          }
          const adjacentHorizontal = fromCell.y === toCell.y
            && Math.abs(fromCell.x - toCell.x) === 1;
          const adjacentVertical = fromCell.x === toCell.x
            && Math.abs(fromCell.y - toCell.y) === 1;
          if (adjacentHorizontal || adjacentVertical) {
            // The two endpoint cells form one convex rectangular strip, so
            // their open endpoints prove the whole segment stays in open cells.
            const axisAligned = adjacentHorizontal
              ? fromPoint.y === toPoint.y
              : fromPoint.x === toPoint.x;
            noteNavigation(axisAligned
              ? 'segmentAdjacentAxisShortcuts'
              : 'segmentAdjacentCellShortcuts');
            noteNavigation('segmentBoundaryPartitionsAvoided');
            return true;
          }
        }
      }
    }
    // Partition at every cell boundary, rather than sampling at a fixed spatial
    // interval that could miss a very short incursion near a blocked corner.
    noteNavigation('segmentBoundaryPartitionsBuilt');
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
  let staticNeighbourEntries = null;
  let offLatticeNeighbourEntries = null;
  const canUseSharedNeighbourCache = () => {
    if (!neighbourCacheInputs || !allowedDoorYCacheable
      || !isAllowedDoorYUnchanged(allowedDoor, allowedDoorYAtCreation)) return false;
    return Boolean(getNeighbourCacheIdentity());
  };
  const getNeighbourPoints = point => {
    if (!isOpen(point)) {
      const empty = [];
      return { plannerPoints: empty, publicPoints: empty, publicCopies: false };
    }
    if (isLatticePoint(point)) {
      const useSharedCache = canUseSharedNeighbourCache();
      let cache;
      if (useSharedCache) {
        if (!staticNeighbourEntries) {
          staticNeighbourEntries = getStaticNeighbourCache(
            neighbourCacheIdentity.rasterKey, neighbourCacheIdentity.variantKey,
          );
        }
        cache = staticNeighbourEntries;
        const key = `${point.x},${point.y}`;
        const cached = cache.get(key);
        if (cached) {
          cache.delete(key);
          cache.set(key, cached);
          noteNavigation('neighbourCacheHits');
          return { plannerPoints: cached, publicPoints: cached, publicCopies: true };
        }
      }

      const candidates = [[0, -1], [-1, 0], [1, 0], [0, 1]].map(([dx, dy]) => ({
        x: point.x + dx * GRID_SIZE, y: point.y + dy * GRID_SIZE,
      }));
      noteNavigation('neighbourCandidatePointsBuilt', candidates.length);
      const valid = validCandidates(point, candidates);
      if (!useSharedCache) return { plannerPoints: valid, publicPoints: valid, publicCopies: false };

      const key = `${point.x},${point.y}`;
      const stored = freezePoints(valid);
      cache.set(key, stored);
      if (cache.size > STATIC_NEIGHBOUR_POINT_LIMIT) {
        cache.delete(cache.keys().next().value);
        noteNavigation('neighbourCacheEvictions');
      }
      noteNavigation('neighbourCandidateBuilds');
      return { plannerPoints: stored, publicPoints: valid, publicCopies: true };
    }

    const pointKey = offLatticeNeighbourPointKey(point);
    const useOffLatticeCache = pointKey !== null
      && ownsSegmentGeometry && canUseSharedNeighbourCache();
    if (useOffLatticeCache) {
      if (!offLatticeNeighbourEntries) offLatticeNeighbourEntries = new Map();
      const cached = offLatticeNeighbourEntries.get(pointKey);
      if (cached) {
        offLatticeNeighbourEntries.delete(pointKey);
        offLatticeNeighbourEntries.set(pointKey, cached);
        noteNavigation('offLatticeNeighbourCacheHits');
        return { plannerPoints: cached, publicPoints: cached, publicCopies: true };
      }
    }

    const valid = validCandidates(point, latticeAnchors(point));
    if (!useOffLatticeCache) return { plannerPoints: valid, publicPoints: valid, publicCopies: false };

    const stored = freezePoints(valid);
    offLatticeNeighbourEntries.set(pointKey, stored);
    if (offLatticeNeighbourEntries.size > OFF_LATTICE_NEIGHBOUR_POINT_LIMIT) {
      offLatticeNeighbourEntries.delete(offLatticeNeighbourEntries.keys().next().value);
      noteNavigation('offLatticeNeighbourCacheEvictions');
    }
    return { plannerPoints: stored, publicPoints: valid, publicCopies: true };
  };

  const neighbours = point => {
    const result = getNeighbourPoints(point);
    if (!result.publicCopies) return result.publicPoints;
    noteNavigation('neighbourPublicPointCopies', result.publicPoints.length);
    return copyPoints(result.publicPoints);
  };

  const grid = Object.freeze({
    signature,
    bounds,
    doorFlow: options.doorFlow ? Object.freeze({ ...options.doorFlow }) : null,
    isOpen,
    segmentClear,
    neighbours,
    connectors,
  });
  plannerNeighbourQueries.set(grid, point => getNeighbourPoints(point).plannerPoints);
  if (neighbourCacheInputs) {
    trustedGridReachability.set(grid, {
      // Caller-supplied workspaces can have live bounds/getters even when
      // frozen. Only the internally resolved geometry has owned data bounds.
      ownsSegmentGeometry,
      getIdentity: () => canUseSharedNeighbourCache() ? getNeighbourCacheIdentity() : null,
    });
  }
  return grid;
}
