import {
  buildBlockedCells,
  buildOccupiedCharacterCells,
  cellToWorld,
  findPathWithDynamicFallback,
  isInsideWorld,
  worldToCell,
} from './pathfinding';
import { getDoorPosition, getRestaurantWorld } from './world';

const QUEUE_ADMISSION_SPACING = 16;

function occupiedCharacterCells(staff, customers, excludeId, ignoredIds = []) {
  return buildOccupiedCharacterCells([...staff, ...customers], [excludeId, ...ignoredIds]);
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

export function planQueuePartyAdmission(state, {
  party,
  door,
  guide,
  guidePath,
  tableId,
}) {
  if (!party?.members?.length || !door || !guide || !tableId) return null;
  const staff = state.staff || [];
  const customers = state.customers || [];
  const partyIds = party.members.map(member => member.id);
  const occupiedPositions = [...staff, ...customers]
    .filter(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y));
  const admittedCustomers = [];

  for (const customer of party.members) {
    const candidate = getQueueAdmissionCandidates(state, door).find(point =>
      occupiedPositions.every(actor =>
        Math.hypot(point.x - actor.x, point.y - actor.y) >= QUEUE_ADMISSION_SPACING));
    if (!candidate) return null;
    const routeToGuide = findPathWithDynamicFallback(
      state,
      worldToCell(candidate),
      worldToCell(guide),
      {
        occupiedCells: occupiedCharacterCells(
          staff,
          [...customers, ...admittedCustomers],
          guide.id,
          partyIds,
        ),
      },
    ).path;
    if (!routeToGuide.length) return null;
    const admitted = {
      ...customer,
      state: 'guided',
      guideStaffId: guide.id,
      chairId: null,
      x: candidate.x,
      y: candidate.y,
      tableId,
      path: [...routeToGuide, ...guidePath],
    };
    admittedCustomers.push(admitted);
    occupiedPositions.push(admitted);
  }

  return {
    admittedCustomers,
    gate: {
      partyId: party.partyId,
      customerIds: party.members.map(member => member.id),
      guideStaffId: guide.id,
      tableId,
    },
  };
}

export function getQueueAdmissionGateStatus(state) {
  const gate = state.queueAdmissionGate;
  if (!gate) return { occupied: false, clear: false, stale: false, gateMembers: [] };

  const gateMemberIds = new Set(gate.customerIds || []);
  const gateMembers = (state.customers || []).filter(customer => gateMemberIds.has(customer.id));
  const world = getRestaurantWorld(state.restaurant || {});
  const clear = gateMembers.length === 0
    || gateMembers.every(customer => Number.isFinite(customer.x)
      && customer.x <= world.doorX - world.gridSize);
  const guide = (state.staff || []).find(worker => worker.id === gate.guideStaffId);
  const taskIds = new Set(guide?.task?.customerIds || (guide?.task?.customerId ? [guide.task.customerId] : []));
  const matchingGuideTask = guide?.task?.type === 'guide_customer'
    && guide.task.tableId === gate.tableId
    && gateMemberIds.size > 0
    && [...gateMemberIds].every(id => taskIds.has(id));
  const ownedReservation = (state.tables || []).some(table => table.id === gate.tableId
    && table.status === 'reserved'
    && table.reservationOwnerStaffId === gate.guideStaffId);
  const stale = gateMembers.length > 0 && (!matchingGuideTask || !ownedReservation);

  return { occupied: true, clear, stale, gateMembers };
}
