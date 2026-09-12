import { getDoors, getRestaurantWorld } from '../world';
import {
  cellKey, cellToWorld, createNavigationWorkspace, isSafeSegment, navigationFixtureRectangles, worldToCell,
} from './navigationWorkspace';

const samePoint = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
const sameCell = (a, b) => cellKey(worldToCell(a)) === cellKey(worldToCell(b));
const departing = actor => actor?.state === 'checkout_moving'
  || actor?.state === 'leaving' && actor.exitPhase !== 'fading';

export function openNavigationPoint(workspace, point) {
  const bounds = workspace?.bounds;
  return !!bounds && Number.isFinite(point?.x) && Number.isFinite(point?.y)
    && point.x >= bounds.left && point.x <= bounds.right
    && point.y >= bounds.top && point.y <= bounds.bottom
    && !workspace.blockedCells.has(cellKey(worldToCell(point)));
}

function coversCell(rect, cell) {
  const first = worldToCell(rect);
  const last = worldToCell({ x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 });
  return cell.x >= first.x && cell.x <= last.x && cell.y >= first.y && cell.y <= last.y;
}

function onlyOwnChair(state, chair, origin) {
  const cell = worldToCell(origin);
  const blockers = navigationFixtureRectangles(state).filter(rect => coversCell(rect, cell));
  if (blockers.length !== 1 || blockers[0].kind !== 'chair' || blockers[0].id !== chair.id) return false;
  const world = getRestaurantWorld(state.restaurant || {});
  const wall = { x: world.doorX, y: world.kitchenY, w: 6, h: world.floorH };
  return !coversCell(wall, cell) || getDoors(state).some(door =>
    cell.y >= worldToCell({ x: 0, y: door.y }).y
      && cell.y <= worldToCell({ x: 0, y: door.y + 39 }).y);
}

function seatRecord(actor, chair, table) {
  return Object.freeze({
    actorId: String(actor.id), chairId: chair.id, tableId: table.id,
    origin: Object.freeze({ x: chair.x + 10, y: chair.y + 10 }),
    geometry: JSON.stringify([chair.id, chair.tableId, chair.x, chair.y, chair.rotation ?? 0,
      table.id, table.x, table.y]),
  });
}

function seatGeometry(state, actor, workspace) {
  if ((!departing(actor) && actor?.state !== 'checkout_queued')
    || actor.chairId == null || actor.tableId == null) return null;
  const chairs = (state.chairs || []).filter(c => c.id === actor.chairId);
  const tables = (state.tables || []).filter(t => t.id === actor.tableId);
  if (chairs.length !== 1 || tables.length !== 1) return null;
  const [chair] = chairs;
  const [table] = tables;
  if (chair.tableId !== table.id || ![chair.x, chair.y, table.x, table.y].every(Number.isFinite)) return null;
  const origin = { x: chair.x + 10, y: chair.y + 10 };
  const bounds = workspace?.bounds;
  if (!bounds || origin.x < bounds.left || origin.x > bounds.right
    || origin.y < bounds.top || origin.y > bounds.bottom || !onlyOwnChair(state, chair, origin)) return null;
  return seatRecord(actor, chair, table);
}

// Eight fixed lattice neighbours of the ORIGINAL occupied source cell. No visibility search.
export function seatedDeparturePorts(authority) {
  if (!authority) return [];
  const cell = worldToCell(authority.origin);
  const ports = [];
  for (const y of [-1, 0, 1]) for (const x of [-1, 0, 1]) {
    if (x || y) ports.push(cellToWorld({ x: cell.x + x, y: cell.y + y }));
  }
  return ports;
}

const physicallySeated = actor => ['seated', 'ordering', 'waiting_for_items', 'waiting_for_party', 'eating'].includes(actor?.state);
const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const frozenPoint = point => Object.freeze({ x: point.x, y: point.y });
const validGeneration = value => Number.isSafeInteger(value) && value > 0;
const visitId = actor => actor.partyId == null ? null : String(actor.partyId);

function domainResidency(actor, chair, table, generation) {
  return Object.freeze({ schema: 1, actorId: String(actor.id), partyId: visitId(actor), generation,
    chair: Object.freeze({ id: chair.id, tableId: chair.tableId, x: chair.x, y: chair.y, rotation: chair.rotation ?? 0 }),
    table: Object.freeze({ id: table.id, x: table.x, y: table.y }),
    origin: frozenPoint({ x: chair.x + 10, y: chair.y + 10 }),
    position: frozenPoint({ x: chair.x + 10, y: chair.y + 10 }), phase: 'seated', connector: null,
  });
}

// Durable lifecycle generation, deliberately unrelated to guide/coordinator admission epochs.
export function recordSeatResidency(actor, chair, table) {
  const generation = validGeneration(actor.seatingGeneration) ? actor.seatingGeneration + 1 : 1;
  if (!validGeneration(generation)) return { seatResidency: revokedResidency(actor) };
  return { seatingGeneration: generation, seatResidency: domainResidency(actor, chair, table, generation) };
}

function revokedResidency(actor) {
  return Object.freeze({ schema: 1, actorId: String(actor.id), partyId: visitId(actor),
    generation: validGeneration(actor.seatingGeneration) ? actor.seatingGeneration : 0, phase: 'revoked' });
}

function connectorPoint(connector) {
  return {
    x: connector.from.x + (connector.to.x - connector.from.x) * connector.fraction,
    y: connector.from.y + (connector.to.y - connector.from.y) * connector.fraction,
  };
}

function freezeResidency(record) {
  return Object.freeze({ schema: 1, actorId: record.actorId, partyId: record.partyId,
    generation: record.generation, phase: record.phase,
    chair: Object.freeze({ id: record.chair.id, tableId: record.chair.tableId,
      x: record.chair.x, y: record.chair.y, rotation: record.chair.rotation }),
    table: Object.freeze({ id: record.table.id, x: record.table.x, y: record.table.y }),
    origin: frozenPoint(record.origin), position: frozenPoint(record.position),
    connector: record.connector ? Object.freeze({ from: frozenPoint(record.connector.from),
      to: frozenPoint(record.connector.to), fraction: record.connector.fraction }) : null,
  });
}

function validResidency(state, actor, workspace) {
  const record = actor.seatResidency;
  if (!record || record.schema !== 1 || record.actorId !== String(actor.id)
    || record.partyId !== visitId(actor) || !validGeneration(record.generation)
    || record.generation !== actor.seatingGeneration || !samePoint(record.position, actor)
    || !finitePoint(record.origin) || !finitePoint(record.chair) || !finitePoint(record.table)
    || actor.chairId !== record.chair.id || actor.tableId !== record.table.id
    || record.chair.tableId !== record.table.id
    || !samePoint(record.origin, { x: record.chair.x + 10, y: record.chair.y + 10 })) return false;
  if (record.phase === 'clear') return record.connector === null
    && !sameCell(actor, record.origin) && openNavigationPoint(workspace, actor);
  if (!physicallySeated(actor) && !departing(actor) && actor.state !== 'checkout_queued') return false;
  const current = seatGeometry(state, { ...actor, state: 'checkout_moving' }, workspace);
  if (!current || current.geometry !== seatRecord(actor, record.chair, record.table).geometry) return false;
  if (record.phase === 'seated') return !record.connector && samePoint(actor, current.origin);
  if (record.phase !== 'departing' || physicallySeated(actor) || openNavigationPoint(workspace, actor)) return false;
  if (!record.connector) return samePoint(actor, current.origin);
  const connector = record.connector;
  const cleared = { ...state, chairs: state.chairs.filter(chair => chair.id !== record.chair.id) };
  const clearedWorkspace = createNavigationWorkspace(cleared);
  return finitePoint(connector.from) && finitePoint(connector.to)
    && Number.isFinite(connector.fraction) && connector.fraction >= 0 && connector.fraction < 1
    && samePoint(connector.from, current.origin) && samePoint(connectorPoint(connector), actor)
    && openNavigationPoint(clearedWorkspace, actor)
    && seatedDeparturePorts(current).some(port => samePoint(port, connector.to))
    && openNavigationPoint(workspace, connector.to)
    && isSafeSegment(cleared, connector.from, connector.to, { workspace: clearedWorkspace });
}

// No coordinator input is consulted at hydration: a saved runtime proof can never seed the new epoch.
export function hydrateSeatResidency(state, actor, workspace) {
  const { seatingTransition: _seatingTransition, ...clean } = actor;
  if (actor.seatResidency?.phase === 'revoked') return { ...clean, seatResidency: revokedResidency(actor) };
  if (validResidency(state, actor, workspace)) return { ...clean, seatResidency: freezeResidency(actor.seatResidency) };
  const eligible = physicallySeated(actor) || departing(actor) || actor.state === 'checkout_queued';
  return actor.seatResidency || eligible && actor.chairId != null && actor.tableId != null && finitePoint(actor)
    ? { ...clean, seatResidency: revokedResidency(actor) } : clean;
}

// Fixture edits are a domain boundary too; edit/restore cannot erase a revocation between ticks.
export function reconcileFixtureResidencies(before, after, workspace) {
  return { ...after, customers: (after.customers || []).map(actor => {
    const prior = (before.customers || []).find(candidate => candidate.id === actor.id);
    if (physicallySeated(actor) && prior?.seatResidency?.phase === 'seated'
      && validResidency(before, prior, workspace) && !validResidency(after, actor, workspace)) {
      const chair = (after.chairs || []).find(chair => chair.id === actor.chairId);
      const table = (after.tables || []).find(table => table.id === actor.tableId);
      if (chair && table && samePoint(actor, { x: chair.x + 10, y: chair.y + 10 })) {
        return { ...actor, ...recordSeatResidency(actor, chair, table) };
      }
    }
    return actor.seatResidency && !validResidency(after, actor, workspace)
      ? { ...actor, seatResidency: revokedResidency(actor) } : actor;
  }) };
}
