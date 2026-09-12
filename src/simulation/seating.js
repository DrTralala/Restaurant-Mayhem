import { buildBlockedCells, cellKey, cellToWorld, findPath, worldToCell } from './pathfinding';
import { getRestaurantWorld } from './world';
import { canClaimDestination } from './navigation/destinations';

const CHAIR_RADIUS = 10;
const APPROACH_DIRECTIONS = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];

export function getChairCentre(chair) {
  if (![chair?.x, chair?.y].every(Number.isFinite)) return null;
  return { x: chair.x + CHAIR_RADIUS, y: chair.y + CHAIR_RADIUS };
}

function isRestaurantInteriorCell(state, cell) {
  const world = getRestaurantWorld(state?.restaurant || {});
  const point = cellToWorld(cell);
  return point.x >= world.floorX
    && point.x <= world.doorX
    && point.y >= world.kitchenY
    && point.y <= world.kitchenY + world.floorH;
}

function sameCell(left, right) {
  return left.x === right.x && left.y === right.y;
}

function findRecord(records, id) {
  return records.find(record => record?.id === id) || null;
}

function hasDuplicateIds(ids) {
  return new Set(ids).size !== ids.length;
}

function compareApproachCells(left, right, customerCell) {
  return Math.abs(left.x - customerCell.x) + Math.abs(left.y - customerCell.y)
    - (Math.abs(right.x - customerCell.x) + Math.abs(right.y - customerCell.y))
    || left.x - right.x
    || left.y - right.y;
}

export function buildChairApproachAssignments(state, customerIds, chairIds) {
  const currentState = state || {};
  if (!Array.isArray(customerIds) || !Array.isArray(chairIds)
    || customerIds.length !== chairIds.length
    || hasDuplicateIds(customerIds) || hasDuplicateIds(chairIds)) return null;

  const customers = Array.isArray(currentState.customers) ? currentState.customers : [];
  const chairs = Array.isArray(currentState.chairs) ? currentState.chairs : [];
  const tables = Array.isArray(currentState.tables) ? currentState.tables : [];
  if (customerIds.length === 0) return [];

  const selectedPairs = [];
  let reservedTableId = null;

  for (let index = 0; index < customerIds.length; index += 1) {
    const customerId = customerIds[index];
    const chairId = chairIds[index];
    const customer = findRecord(customers, customerId);
    const chair = findRecord(chairs, chairId);
    if (!customer || !chair
      || !Number.isFinite(customer.x) || !Number.isFinite(customer.y)
      || !Number.isFinite(chair.x) || !Number.isFinite(chair.y)
      || chair.tableId == null
      || !findRecord(tables, chair.tableId)) return null;

    if (reservedTableId == null) reservedTableId = chair.tableId;
    if (chair.tableId !== reservedTableId) return null;

    selectedPairs.push({ customerId, chairId, customer, chair });
  }

  let blocked;
  try {
    blocked = buildBlockedCells(currentState);
  } catch (_error) {
    return null;
  }

  const assignments = [];
  const usedApproachCells = new Set();

  for (const { customerId, chairId, customer, chair } of selectedPairs) {
    const customerCell = worldToCell(customer);
    const chairCell = worldToCell(chair);
    const candidates = APPROACH_DIRECTIONS
      .map(direction => ({ x: chairCell.x + direction.x, y: chairCell.y + direction.y }))
      .filter(candidate => isRestaurantInteriorCell(currentState, candidate)
        && !blocked.has(cellKey(candidate))
        && !usedApproachCells.has(cellKey(candidate))
        && canClaimDestination(currentState, customer, cellToWorld(candidate)))
      .sort((left, right) => compareApproachCells(left, right, customerCell));

    const approachCell = candidates.find(candidate => sameCell(customerCell, candidate)
      || findPath(currentState, customerCell, candidate).length > 0);
    if (!approachCell) return null;

    const approachPoint = cellToWorld(approachCell);
    usedApproachCells.add(cellKey(approachCell));
    assignments.push({
      customerId,
      chairId,
      approachCell: { ...approachCell },
      approachPoint: { ...approachPoint },
    });
  }

  return assignments;
}

export function validateChairApproachAssignments(state, customerIds, chairIds, assignments, tableId) {
  if (!Array.isArray(customerIds) || !Array.isArray(chairIds) || !Array.isArray(assignments)
    || customerIds.length !== chairIds.length || assignments.length !== customerIds.length) return false;
  const chairsById = new Map((state?.chairs || []).map(chair => [chair?.id, chair]));
  const blocked = buildBlockedCells(state);
  const usedCells = new Set();
  return assignments.every((assignment, index) => {
    const chair = chairsById.get(chairIds[index]);
    const cell = assignment?.approachCell;
    const point = assignment?.approachPoint;
    if (assignment?.customerId !== customerIds[index]
      || assignment?.chairId !== chairIds[index]
      || chair?.tableId !== tableId
      || !Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)
      || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
    const key = cellKey(cell);
    const chairCell = worldToCell(chair);
    const expectedPoint = cellToWorld(cell);
    if (usedCells.has(key)
      || Math.abs(cell.x - chairCell.x) + Math.abs(cell.y - chairCell.y) !== 1
      || point.x !== expectedPoint.x || point.y !== expectedPoint.y
      || !isRestaurantInteriorCell(state, cell)
      || blocked.has(key)) return false;
    usedCells.add(key);
    return true;
  });
}
