import { getQueueVisibleMembers } from '../simulation/customerQueue';
import { createGrid } from '../simulation/navigation/grid';
import { clearNavigationGoal } from '../simulation/movement/navigationGoal';
import { createMovementCoordinator } from '../simulation/navigation/coordinator';
import { CHARACTER_CLEARANCE } from '../simulation/navigation/destinations';
import { findPath, worldToCell } from '../simulation/pathfinding';
import { getDefaultStaffPosition, getRestaurantWorld } from '../simulation/world';
import { isCheckoutState, requeueCheckoutCustomer } from '../simulation/checkout';

const SEATED_CUSTOMER_STATES = new Set([
  'seated',
  'ordering',
  'waiting_for_items',
  'waiting_for_party',
  'eating',
]);

const REPAIR_OFFSETS = Object.freeze([
  { x: 40, y: 0 }, { x: -40, y: 0 }, { x: 0, y: 40 }, { x: 0, y: -40 },
  { x: 40, y: 20 }, { x: 40, y: -20 }, { x: -40, y: 20 }, { x: -40, y: -20 },
  { x: 20, y: 40 }, { x: -20, y: 40 }, { x: 20, y: -40 }, { x: -20, y: -40 },
  { x: 60, y: 0 }, { x: -60, y: 0 }, { x: 0, y: 60 }, { x: 0, y: -60 },
]);

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function invalid(reason) {
  return { valid: false, reason };
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function samePoint(left, right) {
  return finitePoint(left) && finitePoint(right) && left.x === right.x && left.y === right.y;
}

function staffPosition(state, worker, index) {
  if (finitePoint(worker)) return { x: worker.x, y: worker.y };
  return getDefaultStaffPosition(worker.role, index, state, worker.id);
}

function seatedCustomerPosition(state, customer) {
  if (!SEATED_CUSTOMER_STATES.has(customer?.state)) return null;
  const chair = (state.chairs || []).find(candidate => candidate.id === customer.chairId
    && candidate.tableId === customer.tableId);
  return finitePoint(chair) ? { x: chair.x + 10, y: chair.y + 10 } : null;
}

function currentActorPositions(state, movingStaff) {
  const positions = [];
  for (const [index, worker] of (state.staff || []).entries()) {
    if (worker === movingStaff) continue;
    const position = staffPosition(state, worker, index);
    if (finitePoint(position)) positions.push(position);
  }
  for (const customer of state.customers || []) {
    const position = finitePoint(customer)
      ? { x: customer.x, y: customer.y }
      : seatedCustomerPosition(state, customer);
    if (position) positions.push(position);
  }
  for (const member of getQueueVisibleMembers(state, state.queue || [])) {
    if (finitePoint(member)) positions.push({ x: member.x, y: member.y });
  }
  return positions;
}

function isOnRestaurantFloor(state, point) {
  const world = getRestaurantWorld(state.restaurant || {});
  return point.x >= world.floorX
    && point.x <= world.floorX + world.floorW
    && point.y >= world.kitchenY
    && point.y <= world.kitchenY + world.floorH;
}

function isVerifiedSeatOriginCustomer(state, customer) {
  const residency = customer?.seatResidency;
  if (!residency || !['seated', 'departing'].includes(residency.phase)
    || (!SEATED_CUSTOMER_STATES.has(customer.state)
      && !isCheckoutState(customer) && customer.state !== 'leaving')) return false;
  const chair = (state.chairs || []).find(candidate => sameId(candidate?.id, customer.chairId));
  const table = (state.tables || []).find(candidate => sameId(candidate?.id, customer.tableId));
  if (!chair || !table || chair.tableId !== table.id || table.status === 'empty') return false;
  const origin = { x: chair.x + 10, y: chair.y + 10 };
  const recordChair = residency.chair;
  const recordTable = residency.table;
  return residency.schema === 1
    && residency.actorId === String(customer.id)
    && residency.partyId === (customer.partyId == null ? null : String(customer.partyId))
    && Number.isSafeInteger(residency.generation)
    && residency.generation === customer.seatingGeneration
    && samePoint(customer, origin)
    && samePoint(residency.origin, origin)
    && samePoint(residency.position, origin)
    && recordChair?.id === chair.id
    && recordChair?.tableId === chair.tableId
    && recordChair?.x === chair.x
    && recordChair?.y === chair.y
    && (recordChair?.rotation ?? 0) === (chair.rotation ?? 0)
    && recordTable?.id === table.id
    && recordTable?.x === table.x
    && recordTable?.y === table.y;
}

function clearOfCurrentClaims(state, worker, point) {
  const peers = [
    ...(state.staff || []),
    ...(state.customers || []),
    ...getQueueVisibleMembers(state, state.queue || []),
    ...(state.queueSlots || []),
  ].filter(candidate => finitePoint(candidate)
    && !sameId(candidate.id ?? candidate.memberId, worker.id));
  const claims = state.movementCoordinator?.claims;
  const claimedPoints = claims instanceof Map
    ? [...claims.entries()]
      .filter(([id, claim]) => !sameId(id, worker.id) && finitePoint(claim))
      .map(([, claim]) => claim)
    : Object.entries(claims || {})
      .filter(([id, claim]) => !sameId(id, worker.id) && finitePoint(claim))
      .map(([, claim]) => claim);
  return [...peers, ...claimedPoints].every(peer =>
    Math.hypot(point.x - peer.x, point.y - peer.y) >= CHARACTER_CLEARANCE);
}

function staticallyReachable(state, worker, point) {
  const start = worldToCell(worker);
  const goal = worldToCell(point);
  if (start.x === goal.x && start.y === goal.y) return true;
  return findPath(state, start, goal).length > 0;
}

function findStaffRepairPoint(state, worker) {
  for (const offset of REPAIR_OFFSETS) {
    const point = { x: worker.x + offset.x, y: worker.y + offset.y };
    if (!validateStaffMove(state, worker.id, point).valid
      || !clearOfCurrentClaims(state, worker, point)
      || !staticallyReachable(state, worker, point)) continue;
    return point;
  }
  return null;
}

// Repair only the imported/runtime state that is known to be unsafe because a
// staff actor overlaps a customer's verified chair origin. Do not move a
// customer or fixture, and leave unrelated valid saves byte-for-byte stable.
export function repairInvalidStaffOverlaps(state) {
  let next = state;
  for (const worker of next.staff || []) {
    const overlapping = (next.customers || []).some(customer =>
      isVerifiedSeatOriginCustomer(next, customer)
      && Math.hypot(worker.x - customer.x, worker.y - customer.y) < CHARACTER_CLEARANCE);
    if (!overlapping) continue;
    const point = findStaffRepairPoint(next, worker);
    if (point) next = moveStaff(next, worker.id, point);
  }
  return next;
}

export function validateStaffMove(state = {}, id, point) {
  const currentState = state || {};
  const workers = Array.isArray(currentState.staff) ? currentState.staff : [];
  const movingStaff = workers.find(worker => sameId(worker?.id, id));
  if (!movingStaff) return invalid('missing-staff');
  if (!finitePoint(point)) return invalid('non-finite-coordinate');
  if (!isOnRestaurantFloor(currentState, point)) return invalid('outside-floor');

  // The navigation grid is the shared source of truth for walls and fixture
  // obstacles. It also keeps placement aligned with the continuous movement
  // geometry rather than inventing a second footprint model for staff.
  if (!createGrid(currentState).isOpen(point)) return invalid('overlap');

  if (currentActorPositions(currentState, movingStaff).some(actor =>
    Math.hypot(point.x - actor.x, point.y - actor.y) < CHARACTER_CLEARANCE)) {
    return invalid('occupied');
  }

  return { valid: true, reason: null };
}

function removeMapEntries(map, id) {
  if (!(map instanceof Map)) return map;
  const next = new Map(map);
  next.delete(id);
  next.delete(String(id));
  return next;
}

function invalidateMovementRuntime(state, id) {
  const coordinator = state.movementCoordinator;
  if (!coordinator || typeof coordinator !== 'object') {
    return { ...state, movementCoordinator: createMovementCoordinator() };
  }

  const nextDiagnostics = coordinator.diagnostics && typeof coordinator.diagnostics === 'object'
    ? {
      ...coordinator.diagnostics,
      waiting: removeMapEntries(coordinator.diagnostics.waiting, id),
      actorExpansions: removeMapEntries(coordinator.diagnostics.actorExpansions, id),
      recoveries: removeMapEntries(coordinator.diagnostics.recoveries, id),
    }
    : coordinator.diagnostics;

  return {
    ...state,
    movementCoordinator: {
      ...coordinator,
      requests: removeMapEntries(coordinator.requests, id),
      statuses: removeMapEntries(coordinator.statuses, id),
      claims: removeMapEntries(coordinator.claims, id),
      records: removeMapEntries(coordinator.records, id),
      plans: removeMapEntries(coordinator.plans, id),
      diagnostics: nextDiagnostics,
    },
  };
}

function resetPreparation(item, workerId, kind) {
  if (!item || item.assignedStaffId !== workerId || item.kind !== kind
    || !['ordered', 'preparing', 'ready'].includes(item.state)) return item;
  return {
    ...item,
    state: 'ordered',
    stationId: null,
    serviceTableId: null,
    serviceSlotIndex: null,
    assignedStaffId: null,
    preparationStartedAt: null,
    readyAt: null,
  };
}

function resetWashing(item, workerId) {
  if (!item || item.assignedStaffId != null && item.assignedStaffId !== workerId
    || !['queued_for_wash', 'washing'].includes(item.state)) return item;
  return { ...item, state: 'queued_for_wash', washStartedAt: null };
}

function resetStaffWork(state, worker) {
  const task = worker.task;
  let customers = state.customers || [];
  let serviceItems = state.serviceItems || [];

  if (task?.type === 'take_payment') {
    customers = customers.map(customer => customer.id === task.customerId
      && isCheckoutState(customer)
      ? requeueCheckoutCustomer(customer)
      : customer);
  }

  if (task?.type === 'prepare_dish') {
    serviceItems = serviceItems.map(item => item.id === task.serviceItemId
      ? resetPreparation(item, worker.id, 'dish')
      : item);
  }

  if (task?.type === 'prepare_drink') {
    serviceItems = serviceItems.map(item => item.id === task.serviceItemId
      ? resetPreparation(item, worker.id, 'drink')
      : item);
  }

  if (task?.type === 'wash_item') {
    serviceItems = serviceItems.map(item => item.id === task.serviceItemId
      ? resetWashing(item, worker.id)
      : item);
  }

  return { customers, serviceItems };
}

function clearStaffRuntime(worker) {
  const cleared = clearNavigationGoal(worker);
  return {
    ...cleared,
    task: null,
    activityPhase: null,
    idleUntil: null,
  };
}

export function moveStaff(state, id, point) {
  const validation = validateStaffMove(state, id, point);
  if (!validation.valid) return state;

  const worker = state.staff.find(candidate => sameId(candidate?.id, id));
  const work = resetStaffWork(state, worker);
  let next = invalidateMovementRuntime({
    ...state,
    customers: work.customers,
    serviceItems: work.serviceItems,
    staff: state.staff.map(candidate => candidate === worker
      ? { ...clearStaffRuntime(candidate), x: point.x, y: point.y }
      : candidate),
  }, worker.id);

  const carriedId = worker.carryingServiceItemId;
  if (carriedId != null && Array.isArray(next.serviceItems)) {
    next = {
      ...next,
      serviceItems: next.serviceItems.map(item => item.id === carriedId
        && ['carried', 'carried_dirty'].includes(item.state)
        ? { ...item, x: point.x, y: point.y }
        : item),
    };
  }

  return next;
}
