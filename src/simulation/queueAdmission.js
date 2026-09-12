import {
  buildBlockedCells,
  cellToWorld,
  isInsideWorld,
} from './pathfinding';
import { getDoorPosition, getRestaurantWorld } from './world';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
import { getQueueVisibleMembers } from './customerQueue';
import {
  buildChairApproachAssignments,
  validateChairApproachAssignments,
} from './seating';

const QUEUE_ADMISSION_SPACING = 16;

function sameOrderedIds(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((id, index) => id === right[index]);
}

function getQueueAdmissionCandidates(state, door) {
  const world = getRestaurantWorld(state.restaurant || {});
  const outside = getDoorPosition(state, door).outside;
  const first = {
    x: Math.ceil((world.queueX + 60) / world.gridSize),
    y: Math.ceil(world.kitchenY / world.gridSize),
  };
  const last = {
    x: Math.floor((world.queueX + world.queueW) / world.gridSize),
    y: Math.floor((world.diningY + world.areaH + 50) / world.gridSize),
  };
  const blocked = buildBlockedCells(state);
  const candidates = [];
  for (let y = first.y; y <= last.y; y += 1) {
    for (let x = first.x; x <= last.x; x += 1) {
      const cell = { x, y };
      const point = cellToWorld(cell);
      const insideQueue = point.x >= world.queueX
        && point.x <= world.queueX + world.queueW
        && point.y >= world.kitchenY
        && point.y <= world.diningY + world.areaH + 50;
      if (insideQueue && isInsideWorld(state, cell) && !blocked.has(`${x},${y}`)) {
        candidates.push(point);
      }
    }
  }
  return candidates.sort((left, right) =>
    Math.hypot(left.x - outside.x, left.y - outside.y)
      - Math.hypot(right.x - outside.x, right.y - outside.y)
    || left.y - right.y
    || left.x - right.x);
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

/**
 * Plan a whole-party admission without any guide. Stage every member at a safe
 * queue-band origin first, then compute chair approaches against that staged
 * candidate state and require each staged candidate to rout to its own approach.
 * All-or-nothing: returns `null` rather than a partial party.
 *
 * `chairIds` is indexed in party-member order.
 */
export function planQueuePartyAdmission(state, { party, door, tableId, chairIds }) {
  if (!party?.members?.length || !door || !tableId
    || !Array.isArray(chairIds) || chairIds.length !== party.members.length) return null;
  const { inside, outside } = getDoorPosition(state, door);
  // Reserve the crossing, not the departing customer's entire journey to it.
  // A distant exit request must not starve incoming parties while tables are free.
  const activeEgress = (state.customers || []).some(customer =>
    customer.state === 'leaving'
      && customer.exitPhase !== 'fading'
      && customer.exitDoorId === door.id
      && Math.hypot(customer.x - Math.max(inside.x, Math.min(outside.x, customer.x)),
        customer.y - outside.y) < QUEUE_ADMISSION_SPACING);
  if (activeEgress) return null;

  const occupiedPositions = [
    ...(state.staff || []),
    ...(state.customers || []),
    ...getQueueVisibleMembers(state, state.queue),
  ].filter(isFinitePoint);
  const staged = [];

  for (const customer of party.members) {
    const candidate = getQueueAdmissionCandidates(state, door).find(point =>
      occupiedPositions.every(actor =>
        Math.hypot(point.x - actor.x, point.y - actor.y) >= QUEUE_ADMISSION_SPACING));
    if (!candidate) return null;
    const fields = clearNavigationGoal(customer);
    const admitted = {
      ...fields,
      state: 'entering',
      entryDoorId: door.id,
      chairId: null,
      x: candidate.x,
      y: candidate.y,
      tableId,
    };
    staged.push(admitted);
    occupiedPositions.push(admitted);
  }

  const customerIds = staged.map(customer => customer.id);
  const candidateState = {
    ...state,
    customers: [...(state.customers || []), ...staged],
  };
  const assignments = buildChairApproachAssignments(candidateState, customerIds, chairIds);
  if (!assignments
    || !validateChairApproachAssignments(
      candidateState, customerIds, chairIds, assignments, tableId,
    )) return null;

  const assignmentByCustomer = new Map(assignments
    .map(assignment => [assignment.customerId, assignment]));
  const admittedCustomers = staged.map(customer => {
    const assignment = assignmentByCustomer.get(customer.id);
    const withChair = { ...customer, chairId: assignment.chairId };
    return setNavigationGoal(withChair, assignment.approachPoint);
  });

  return {
    admittedCustomers,
    assignments,
    gate: {
      partyId: party.partyId,
      customerIds,
      tableId,
      doorId: door.id,
    },
  };
}

/**
 * Gate status keeps its public return shape. Ownership is validated from the
 * canonical party/table/member fields only: no staff task identity and no guide
 * linkage is consulted.
 */
export function getQueueAdmissionGateStatus(state) {
  const gate = state.queueAdmissionGate;
  if (!gate) return { occupied: false, clear: false, stale: false, gateMembers: [] };

  const gateMemberIds = new Set(Array.isArray(gate.customerIds) ? gate.customerIds : []);
  const gateMembers = (state.customers || []).filter(customer => gateMemberIds.has(customer.id));
  const world = getRestaurantWorld(state.restaurant || {});
  const clear = gateMembers.length === 0
    || gateMembers.every(customer => Number.isFinite(customer.x)
      && customer.x <= world.doorX - world.gridSize);
  const table = (state.tables || []).find(candidate => candidate.id === gate.tableId);
  const tableMemberIds = Array.isArray(table?.diningCustomerIds) ? table.diningCustomerIds : null;
  const ownedReservation = table?.status === 'reserved'
    && table.diningPartyId === gate.partyId
    && tableMemberIds != null
    && tableMemberIds.length === gate.customerIds?.length
    && sameOrderedIds(tableMemberIds, gate.customerIds);
  const matchingMemberOwnership = gateMemberIds.size === gate.customerIds?.length
    && gateMembers.length === gate.customerIds.length
    && gateMembers.every(customer => customer.partyId === gate.partyId
      && customer.tableId === gate.tableId);
  const stale = gateMembers.length > 0
    && (!ownedReservation || !matchingMemberOwnership);

  return { occupied: true, clear, stale, gateMembers };
}
