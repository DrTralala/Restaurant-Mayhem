import { createGrid } from './grid';
import {
  cellKey,
  cellToWorld,
  navigationFixtureRectangles,
  worldToCell,
} from '../movement/navigationWorkspace';
import {
  GRID_SIZE,
  getDoorPosition,
  getDoors,
  getRestaurantWorld,
  isDoorCrossing,
  isDoorRoleForFlow,
} from '../world';
import { recordSeatResidency } from '../movement/seatedDeparture';
import { getAmenityGeometry } from '../../data/staffAmenities';
import { isStaticStaffAmenityExit } from '../movement/staffAmenityExit';
import { noteNavigation } from './telemetry';

const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const same = (a, b) => finite(a) && finite(b) && a.x === b.x && a.y === b.y;
const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const point = p => ({ x: p.x, y: p.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const EXIT_DISTANCE = 120;

function freezeResidency(record) {
  return Object.freeze({ ...record, position: Object.freeze(point(record.position)),
    connector: record.connector ? Object.freeze({ ...record.connector,
      from: Object.freeze(point(record.connector.from)), to: Object.freeze(point(record.connector.to)) }) : null });
}

function fractionOnSegment(p, from, to) {
  if (!finite(p) || !finite(from) || !finite(to)) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  const squared = dx * dx + dy * dy;
  if (!squared) return same(p, from) ? 0 : null;
  const fraction = ((p.x - from.x) * dx + (p.y - from.y) * dy) / squared;
  // Geometric reconstruction tolerance, not a reduction of collision clearance.
  if (fraction < 0 || fraction > 1 || Math.hypot(p.x - from.x - fraction * dx,
    p.y - from.y - fraction * dy) > 1e-9) return null;
  return fraction;
}

function isDoorOpeningPoint(state, door, point) {
  const outside = getDoorPosition(state, door)?.outside;
  return Boolean(outside && finite(point)
    && Math.abs(point.x - outside.x) <= 1e-9
    && point.y >= door.y - 1e-9
    && point.y < door.y + 40 - 1e-9);
}

function getExitOrigin(state, actor, door) {
  const outside = door ? getDoorPosition(state, door)?.outside : null;
  const selected = actor.exitCrossingPoint;
  const savedFadeOrigin = actor.exitFadeOrigin;
  const isSavedFadeRay = origin => finite(origin) && finite(actor) && finite(actor.navigationGoal)
    && actor.x >= origin.x - 1e-9
    && actor.navigationGoal.x > origin.x
    && Math.abs(distance(origin, actor.navigationGoal) - EXIT_DISTANCE) <= 1e-9
    && fractionOnSegment(actor, origin, actor.navigationGoal) !== null;
  if (isSavedFadeRay(savedFadeOrigin)) return point(savedFadeOrigin);
  if (finite(selected)) {
    const savedFadeRay = isSavedFadeRay(selected);
    if (!outside || isDoorOpeningPoint(state, door, selected) || savedFadeRay) {
      return point(selected);
    }
  }
  if (outside && finite(actor) && finite(actor.navigationGoal)
    && actor.x >= outside.x - 1e-9
    && actor.navigationGoal.x > actor.x
    && Math.abs(distance(actor, actor.navigationGoal) - EXIT_DISTANCE) <= 1e-9) {
    // A saved/in-flight fade may predate the crossing-point field. Once the
    // actor is already outside, its current position is the safe ray origin.
    return point(actor);
  }
  return outside ? point(outside) : null;
}

function exitGrid(state, actor, base) {
  if (actor.state !== 'leaving' || actor.exitPhase !== 'fading' || !finite(actor.navigationGoal)) return null;
  const door = getDoors(state).find(item => item.id === actor.exitDoorId);
  const origin = getExitOrigin(state, actor, door);
  if (!origin) return null;
  const goal = actor.navigationGoal;
  if (goal.x <= origin.x || Math.abs(distance(origin, goal) - EXIT_DISTANCE) > 1e-8
    || fractionOnSegment(actor, origin, goal) === null) return null;
  const edgeFraction = Math.min(1, (base.bounds.right - origin.x) / (goal.x - origin.x));
  const edge = { x: origin.x + (goal.x - origin.x) * edgeFraction,
    y: origin.y + (goal.y - origin.y) * edgeFraction };
  if (edgeFraction < 0 || !base.segmentClear(origin, edge)) return null;
  const isOpen = p => fractionOnSegment(p, origin, goal) !== null;
  return Object.freeze({ ...base, signature: `${base.signature}:exit:${actor.id}:${JSON.stringify([origin, goal])}`,
    isOpen, segmentClear: (a, b) => isOpen(a) && isOpen(b)
      && fractionOnSegment(b, origin, goal) >= fractionOnSegment(a, origin, goal),
    neighbours: p => isOpen(p) && !same(p, goal) ? [point(goal)] : [],
    connectors: () => [],
  });
}

function outdoorFadeGrid(actor, base) {
  if (actor.state !== 'leaving' || actor.exitPhase !== 'fading'
    || actor.exitDoorId != null || !finite(actor) || !finite(actor.navigationGoal)
    || actor.x < base.bounds.right - 1e-9 || actor.navigationGoal.x <= actor.x
    || !Number.isFinite(distance(actor, actor.navigationGoal))
    || distance(actor, actor.navigationGoal) > EXIT_DISTANCE + 1e-9) return null;
  const start = point(actor);
  const goal = point(actor.navigationGoal);
  const isOpen = p => fractionOnSegment(p, start, goal) !== null;
  return Object.freeze({
    ...base,
    signature: `${base.signature}:outdoor-fade:${actor.id}:${JSON.stringify([start, goal])}`,
    isOpen,
    segmentClear: (from, to) => isOpen(from) && isOpen(to)
      && fractionOnSegment(to, start, goal) >= fractionOnSegment(from, start, goal),
    neighbours: p => isOpen(p) && !same(p, goal) ? [point(goal)] : [],
    connectors: () => [],
  });
}

// Revocation prevents a stale chair lease from authorising a chair escape. A
// checkout customer trapped by a different fixture still needs a one-way route
// out of that fixture, or it can block the FIFO cashier line permanently.
function revokedCheckoutEscapeGrid(state, actor, base) {
  if (actor?.state !== 'checkout_moving' || actor.seatResidency?.phase !== 'revoked'
    || !finite(actor) || base.isOpen(actor)) return null;

  const start = point(actor);
  const startCell = worldToCell(start);
  const world = getRestaurantWorld(state.restaurant || {});
  const wallCellX = worldToCell({ x: world.doorX, y: 0 }).x;
  const containingFixtures = navigationFixtureRectangles(state).filter(rectangle => {
    if (![rectangle.x, rectangle.y, rectangle.w, rectangle.h].every(Number.isFinite)
      || rectangle.w <= 0 || rectangle.h <= 0) return false;
    const first = worldToCell(rectangle);
    const last = worldToCell({
      x: rectangle.x + rectangle.w - 1,
      y: rectangle.y + rectangle.h - 1,
    });
    return startCell.x >= first.x && startCell.x <= last.x
      && startCell.y >= first.y && startCell.y <= last.y;
  });
  if (containingFixtures.length === 0 || containingFixtures.some(rectangle =>
    rectangle.kind === 'table' && sameId(rectangle.id, actor.tableId)
      || rectangle.kind === 'chair' && sameId(rectangle.id, actor.chairId))) return null;

  // A nested or raster-overlapping fixture must not enlarge the escape area.
  const smallestArea = Math.min(...containingFixtures.map(rectangle =>
    rectangle.w * rectangle.h));
  const sourceFixtures = containingFixtures.filter(rectangle =>
    rectangle.w * rectangle.h === smallestArea);
  if (sourceFixtures.length !== 1) return null;

  const sourceCells = new Set();
  let maximumRadius = 1;
  const sourceFixture = sourceFixtures[0];
  const first = worldToCell(sourceFixture);
  const last = worldToCell({
    x: sourceFixture.x + sourceFixture.w - 1,
    y: sourceFixture.y + sourceFixture.h - 1,
  });
  // The side wall is rasterised as one blocked column; a fixture overlap must
  // never authorise an escape through that column (even from inside its strip).
  if (first.x <= wallCellX && wallCellX <= last.x) return null;
  for (let y = first.y; y <= last.y; y += 1) {
    for (let x = first.x; x <= last.x; x += 1) sourceCells.add(`${x},${y}`);
  }
  maximumRadius = Math.max(maximumRadius,
    Math.abs(startCell.x - first.x) + 1,
    Math.abs(startCell.x - last.x) + 1,
    Math.abs(startCell.y - first.y) + 1,
    Math.abs(startCell.y - last.y) + 1);

  const canExitTo = target => {
    if (!base.isOpen(target)
      || start.x < world.doorX && target.x > world.doorX
      || start.x > world.doorX + 6 && target.x < world.doorX + 6) return false;

    const boundaries = [0, 1];
    for (const axis of ['x', 'y']) {
      const delta = target[axis] - start[axis];
      if (delta === 0) continue;
      for (let coordinate = (Math.floor(Math.min(start[axis], target[axis]) / GRID_SIZE) + 1)
        * GRID_SIZE; coordinate < Math.max(start[axis], target[axis]); coordinate += GRID_SIZE) {
        boundaries.push((coordinate - start[axis]) / delta);
      }
    }
    boundaries.sort((left, right) => left - right);
    for (let index = 1; index < boundaries.length; index += 1) {
      const fraction = (boundaries[index - 1] + boundaries[index]) / 2;
      const sample = {
        x: start.x + (target.x - start.x) * fraction,
        y: start.y + (target.y - start.y) * fraction,
      };
      if (!base.isOpen(sample) && !sourceCells.has(cellKey(worldToCell(sample)))) return false;
    }
    return true;
  };

  let exits = [];
  for (let radius = 1; radius <= maximumRadius; radius += 1) {
    for (let y = startCell.y - radius; y <= startCell.y + radius; y += 1) {
      for (let x = startCell.x - radius; x <= startCell.x + radius; x += 1) {
        if (Math.max(Math.abs(x - startCell.x), Math.abs(y - startCell.y)) !== radius) continue;
        const candidate = cellToWorld({ x, y });
        if (canExitTo(candidate)) exits.push(candidate);
      }
    }
    if (exits.length > 0) break;
  }
  if (exits.length === 0) return null;

  exits.sort((left, right) => distance(start, left) - distance(start, right)
    || left.y - right.y || left.x - right.x);
  const isExit = candidate => exits.some(exit => same(exit, candidate));
  return Object.freeze({
    ...base,
    signature: `${base.signature}:revoked-checkout-escape:${actor.id}:${JSON.stringify([start, exits])}`,
    isOpen: candidate => same(candidate, start) || base.isOpen(candidate),
    segmentClear: (from, to) => same(from, start) && isExit(to)
      ? true : base.segmentClear(from, to),
    neighbours: candidate => same(candidate, start)
      ? exits.map(exit => ({ ...exit })) : base.neighbours(candidate),
    connectors: candidate => same(candidate, start)
      ? exits.map(exit => ({ ...exit })) : base.connectors(candidate),
  });
}

function sameOptionalPoint(left, right) {
  return left == null && right == null || same(left, right);
}

function sameAmenityUse(left, right) {
  return left?.phase === right?.phase
    && sameId(left?.amenityId, right?.amenityId)
    && left?.slotIndex === right?.slotIndex;
}

function sameMovementResidency(left, right) {
  return left?.kind === right?.kind
    && sameId(left?.amenityId, right?.amenityId)
    && left?.slotIndex === right?.slotIndex;
}

function authenticStaffExitActor(state, actor) {
  if (actor?.role === 'customer'
    || (state.customers || []).some(customer => sameId(customer?.id, actor?.id))) return null;
  const matches = (state.staff || []).filter(worker => sameId(worker?.id, actor?.id));
  if (matches.length !== 1) return null;
  const authority = matches[0];
  if (!same(authority, actor)
    || authority.dutyPhase !== actor.dutyPhase
    || !sameAmenityUse(authority.amenityUse, actor.amenityUse)
    || !sameMovementResidency(authority.movementResidency, actor.movementResidency)
    || !sameOptionalPoint(authority.navigationGoal, actor.navigationGoal)) return null;
  return authority;
}

function staffAmenityExitGrid(state, actor, base) {
  const authority = authenticStaffExitActor(state, actor);
  if (!authority) return null;
  const use = actor?.amenityUse;
  const residency = actor?.movementResidency;
  if (actor?.dutyPhase !== 'exiting' || use?.phase !== 'occupied'
    || residency?.kind !== 'staff_amenity'
    || String(residency.amenityId) !== String(use.amenityId)
    || residency.slotIndex !== use.slotIndex) return null;

  const amenity = (state.staffAmenities || []).find(candidate =>
    String(candidate?.id) === String(use.amenityId));
  const geometry = getAmenityGeometry(amenity);
  const slot = Array.isArray(amenity?.slots)
    ? amenity.slots.find(candidate => candidate?.index === use.slotIndex) : null;
  const origin = geometry?.slotAnchors?.[use.slotIndex];
  const goal = actor.navigationGoal;
  if (!slot || !['couch', 'bed'].includes(amenity?.type)
    || !sameId(slot.occupiedBy, actor.id) || slot.reservedBy != null
    || !origin || !finite(goal)
    || !isStaticStaffAmenityExit(state, amenity, use.slotIndex, goal, { grid: base })) return null;

  const startFraction = fractionOnSegment(actor, origin, goal);
  if (startFraction === null || startFraction < 0 || startFraction > 1) return null;

  // Only the resident's own footprint is opened, and only for the already
  // selected exit segment. Other fixtures stay solid and the coordinator still
  // arbitrates this segment against every other actor reservation.
  const cleared = createGrid({
    ...state,
    staffAmenities: (state.staffAmenities || []).filter(candidate => candidate !== amenity),
  });
  if (!cleared.isOpen(origin) || !cleared.isOpen(goal)
    || !cleared.segmentClear(origin, goal)) return null;

  const fraction = point => fractionOnSegment(point, origin, goal);
  const onExitSegment = point => {
    const value = fraction(point);
    return value !== null && value >= startFraction && value <= 1 && cleared.isOpen(point);
  };
  const segmentClear = (from, to) => {
    const fromFraction = fraction(from);
    const toFraction = fraction(to);
    return fromFraction !== null && toFraction !== null
      && fromFraction >= startFraction && toFraction >= fromFraction
      && toFraction <= 1 && cleared.segmentClear(from, to);
  };
  return Object.freeze({ ...base,
    signature: `${base.signature}:staff-amenity-exit:${actor.id}:${amenity.id}:${use.slotIndex}:${JSON.stringify([origin, goal])}`,
    isOpen: onExitSegment,
    segmentClear,
    neighbours: point => onExitSegment(point) && !same(point, goal) ? [{ ...goal }] : [],
    connectors: () => [],
  });
}

function createActorGridWithFlowResolver(state, actor, base, doorFlow, resolveFlowGrid) {
  const matches = (state.customers || []).filter(customer => String(customer.id) === String(actor.id));
  if (matches.length !== 1) return staffAmenityExitGrid(state, actor, base) || base;
  if (!same(matches[0], actor)) return base;
  const exit = exitGrid(state, actor, base);
  if (exit) return exit;
  const outdoorFade = outdoorFadeGrid(actor, base);
  if (outdoorFade) return outdoorFade;
  const flow = doorFlow || (actor.state === 'entering'
    ? { direction: 'ingress', doorId: actor.entryDoorId }
    : actor.state === 'leaving'
      ? { direction: 'egress', doorId: actor.exitDoorId }
      : null);
  const flowDoor = flow?.doorId == null
    ? null
    : getDoors(state).find(door => String(door?.id) === String(flow.doorId));
  const flowWithCrossing = flow && flowDoor && ['ingress', 'egress'].includes(flow.direction)
    ? {
        ...flow,
        allowRoleMismatch: flow.allowRoleMismatch === true
          || (!isDoorRoleForFlow(flowDoor, flow.direction) && isDoorCrossing(state, actor, flowDoor)),
      }
    : flow;
  const baseMatchesFlow = flowWithCrossing && base?.doorFlow
    && base.doorFlow.direction === flowWithCrossing.direction
    && String(base.doorFlow.doorId) === String(flowWithCrossing.doorId)
    && Boolean(base.doorFlow.allowRoleMismatch) === Boolean(flowWithCrossing.allowRoleMismatch);
  const flowBase = flowWithCrossing && ['ingress', 'egress'].includes(flowWithCrossing.direction)
    ? baseMatchesFlow ? base : resolveFlowGrid(state, flowWithCrossing)
    : base;
  const departing = ['checkout_moving', 'checkout_queued', 'leaving'].includes(actor.state);
  const rejected = departing && actor.seatResidency && actor.seatResidency.phase !== 'clear'
    ? Object.freeze({ ...flowBase, residencyRevoked: true }) : flowBase;
  if (flowBase.isOpen(actor) || !departing) return rejected;
  const blockedCheckoutRecovery = revokedCheckoutEscapeGrid(state, actor, rejected);
  if (blockedCheckoutRecovery) return blockedCheckoutRecovery;
  const chairs = (state.chairs || []).filter(chair => chair.id === actor.chairId && chair.tableId === actor.tableId);
  const tables = (state.tables || []).filter(table => table.id === actor.tableId);
  if (chairs.length !== 1 || tables.length !== 1) return rejected;
  const chair = chairs[0], table = tables[0];
  const origin = { x: chair.x + 10, y: chair.y + 10 };
  const record = actor.seatResidency || (same(actor, origin) ? recordSeatResidency(actor, chair, table).seatResidency : null);
  if (!record || !['seated', 'departing'].includes(record.phase) || record.actorId !== String(actor.id)
    || !Number.isSafeInteger(record.generation) || record.generation <= 0
    || (actor.seatResidency && record.generation !== actor.seatingGeneration)
    || record.partyId !== (actor.partyId == null ? null : String(actor.partyId))
    || !same(record.position, actor) || !same(record.origin, origin) || !same(record.chair, chair)
    || record.chair.id !== chair.id || record.chair.tableId !== table.id
    || (record.chair.rotation ?? 0) !== (chair.rotation ?? 0) || !same(record.table, table)
    || record.table.id !== table.id) return rejected;
  const cleared = createGrid(
    { ...state, chairs: state.chairs.filter(item => item !== chair) },
    null,
    { doorFlow: flowWithCrossing },
  );
  if (!cleared.isOpen(origin) || !cleared.isOpen(actor)) return rejected;
  const cell = worldToCell(origin);
  let ports = [];
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
    if (!dx && !dy) continue;
    const port = cellToWorld({ x: cell.x + dx, y: cell.y + dy });
    if (flowBase.isOpen(port) && cleared.segmentClear(origin, port)) ports.push(port);
  }
  if (record.phase === 'departing' && record.connector) {
    const connector = record.connector;
    if (!same(connector.from, origin) || !ports.some(port => same(port, connector.to))
      || fractionOnSegment(actor, origin, connector.to) === null) return rejected;
    ports = ports.filter(port => same(port, connector.to));
  } else if (!same(actor, origin)) return rejected;
  // Offset chairs occupy more than the centre's raster cell. Authorise only the
  // chair's own footprint along the retained connector, never other fixtures.
  const onDeparture = p => !flowBase.isOpen(p) && cleared.isOpen(p)
    && ports.some(port => fractionOnSegment(p, actor, port) !== null);
  const segmentClear = (from, to) => {
    if (flowBase.isOpen(from)) return flowBase.segmentClear(from, to);
    return finite(from) && finite(to) && onDeparture(from)
      && ports.some(port => {
        const a = fractionOnSegment(from, actor, port), b = fractionOnSegment(to, actor, port);
        return a !== null && b !== null && b >= a && cleared.segmentClear(from, to);
      });
  };
  return Object.freeze({ ...flowBase,
    signature: `${flowBase.signature}:seat:${actor.id}:${record.generation}:${JSON.stringify(ports)}`,
    departure: { origin, ports, record, base: flowBase },
    isOpen: p => Boolean(finite(p) && (flowBase.isOpen(p) || onDeparture(p))),
    segmentClear,
    neighbours: p => flowBase.isOpen(p) ? flowBase.neighbours(p) : ports.filter(port => segmentClear(p, port)),
  });
}

export function createActorGrid(state, actor, base = createGrid(state), doorFlow = null) {
  return createActorGridWithFlowResolver(state, actor, base, doorFlow,
    createUncachedFlowGrid);
}

const ACTOR_FLOW_GRID_CACHE_LIMIT = 8;

function snapshotActorFlow(flow) {
  try {
    if (!flow || typeof flow !== 'object' || Array.isArray(flow)) return null;
    const prototype = Object.getPrototypeOf(flow);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const snapshot = [prototype];
    const coreValues = {};
    for (const key of Reflect.ownKeys(flow)) {
      const descriptor = Object.getOwnPropertyDescriptor(flow, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot.push(key, descriptor.enumerable, descriptor.value);
      if (['direction', 'doorId', 'allowRoleMismatch'].includes(key)) {
        coreValues[key] = descriptor.value;
      }
    }
    for (const key of ['direction', 'doorId', 'allowRoleMismatch']) {
      if (!Object.hasOwn(coreValues, key) && key in flow) return null;
      const value = coreValues[key];
      if (value != null && (typeof value === 'object' || typeof value === 'function')) return null;
    }
    return snapshot;
  } catch (_error) {
    return null;
  }
}

function sameActorFlowSnapshot(left, right) {
  return left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

function createUncachedFlowGrid(state, flow) {
  return createGrid(state, null, { doorFlow: flow });
}

/**
 * Build a synchronous, state-owned actor-grid factory. Only ordinary flow-base
 * grids are shared; authority checks and actor-specific domain wrappers run for
 * every call. Do not retain the factory across mutation of its captured state.
 */
export function createActorGridFactory(state, base = createGrid(state)) {
  const flowVariants = [];
  const resolveFlowGrid = (gridState, flow) => {
    if (gridState !== state) {
      noteNavigation('actorFlowGridCacheBypasses');
      return createUncachedFlowGrid(gridState, flow);
    }

    const snapshot = snapshotActorFlow(flow);
    if (!snapshot) {
      noteNavigation('actorFlowGridCacheBypasses');
      return createUncachedFlowGrid(gridState, flow);
    }

    const index = flowVariants.findIndex(entry => sameActorFlowSnapshot(entry.snapshot, snapshot));
    if (index !== -1) {
      const [entry] = flowVariants.splice(index, 1);
      flowVariants.push(entry);
      noteNavigation('actorFlowGridCacheHits');
      return entry.grid;
    }

    const grid = createGrid(gridState, null, { doorFlow: flow });
    flowVariants.push({ snapshot, grid });
    noteNavigation('actorFlowGridBuilds');
    if (flowVariants.length > ACTOR_FLOW_GRID_CACHE_LIMIT) {
      flowVariants.shift();
      noteNavigation('actorFlowGridCacheEvictions');
    }
    return grid;
  };

  return (actor, doorFlow = null) =>
    createActorGridWithFlowResolver(state, actor, base, doorFlow, resolveFlowGrid);
}

export function commitActorPosition(actor, grid, position, actions) {
  const moved = { ...actor, ...position };
  if (grid.residencyRevoked) {
    moved.seatResidency = Object.freeze({ schema: 1, actorId: String(actor.id),
      partyId: actor.partyId == null ? null : String(actor.partyId),
      generation: Number.isSafeInteger(actor.seatingGeneration) ? actor.seatingGeneration : 0, phase: 'revoked' });
    return moved;
  }
  const departure = grid.departure;
  if (!departure) {
    if (actor.seatResidency?.phase === 'clear') moved.seatResidency = freezeResidency({ ...actor.seatResidency, position });
    return moved;
  }
  moved.seatingGeneration = departure.record.generation;
  moved.seatResidency = freezeResidency(departure.record);
  if (departure.base.isOpen(position)) {
    moved.seatResidency = freezeResidency({ ...departure.record, phase: 'clear', position, connector: null });
  } else if (!same(position, actor)) {
    const firstMove = actions.find(action => !same(action.from, action.to));
    const port = departure.ports.find(candidate => firstMove
      && fractionOnSegment(firstMove.to, actor, candidate) !== null);
    if (!port) throw new Error('Missing committed seat departure connector');
    moved.seatResidency = freezeResidency({ ...departure.record, phase: 'departing', position,
      connector: { from: point(departure.origin), to: point(port),
        fraction: fractionOnSegment(position, departure.origin, port) } });
  }
  return moved;
}
