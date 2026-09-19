import { getMovementStatus } from './movement/status';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
import { recordSeatResidency } from './movement/seatedDeparture';
import { getQueueAdmissionGateStatus, planQueuePartyAdmission } from './queueAdmission';
import {
  clearDiningOwnership,
  occupyTableForParty,
  reserveTableForParty,
} from './tableLifecycle';
import {
  buildChairApproachAssignments,
  getChairCentre,
  validateChairApproachAssignments,
} from './seating';
import { createActorGrid } from './navigation/domainGrid';
import { createGrid } from './navigation/grid';
import {
  getDoors,
  getDoorsForFlow,
  isDoorCrossing,
  isDoorRoleForFlow,
} from './world';
import { getQueueVisibleMembers, normaliseCustomerQueue } from './customerQueue';

const CHAIR_SPACING = 16;
const ARRIVAL_TOLERANCE = 2;

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function sameOrderedIds(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((id, index) => id === right[index]);
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function pointToSegmentDistance(point, start, end) {
  if (!isFinitePoint(point) || !isFinitePoint(start) || !isFinitePoint(end)) return Infinity;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + fraction * dx),
    point.y - (start.y + fraction * dy),
  );
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function between(value, left, right) {
  return value >= Math.min(left, right) && value <= Math.max(left, right);
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const epsilon = 1e-9;
  const first = orientation(firstStart, firstEnd, secondStart);
  const second = orientation(firstStart, firstEnd, secondEnd);
  const third = orientation(secondStart, secondEnd, firstStart);
  const fourth = orientation(secondStart, secondEnd, firstEnd);
  const crosses = (first > epsilon && second < -epsilon || first < -epsilon && second > epsilon)
    && (third > epsilon && fourth < -epsilon || third < -epsilon && fourth > epsilon);
  if (crosses) return true;
  return Math.abs(first) <= epsilon && between(secondStart.x, firstStart.x, firstEnd.x)
    && between(secondStart.y, firstStart.y, firstEnd.y)
    || Math.abs(second) <= epsilon && between(secondEnd.x, firstStart.x, firstEnd.x)
      && between(secondEnd.y, firstStart.y, firstEnd.y)
    || Math.abs(third) <= epsilon && between(firstStart.x, secondStart.x, secondEnd.x)
      && between(firstStart.y, secondStart.y, secondEnd.y)
    || Math.abs(fourth) <= epsilon && between(firstEnd.x, secondStart.x, secondEnd.x)
      && between(firstEnd.y, secondStart.y, secondEnd.y);
}

function segmentToSegmentDistance(firstStart, firstEnd, secondStart, secondEnd) {
  if ([firstStart, firstEnd, secondStart, secondEnd].some(point => !isFinitePoint(point))) return Infinity;
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  return Math.min(
    pointToSegmentDistance(firstStart, secondStart, secondEnd),
    pointToSegmentDistance(firstEnd, secondStart, secondEnd),
    pointToSegmentDistance(secondStart, firstStart, firstEnd),
    pointToSegmentDistance(secondEnd, firstStart, firstEnd),
  );
}

function seatingTransitionsConflict(first, second) {
  return Math.hypot(first.to.x - second.to.x, first.to.y - second.to.y) < CHAIR_SPACING
    || segmentToSegmentDistance(first.from, first.to, second.from, second.to) < CHAIR_SPACING;
}

function sameActor(left, transition) {
  return left?.id != null && transition?.customerId != null
    && sameId(left.id, transition.customerId);
}

function stagedSeatTransition(state, assignment) {
  const customer = (state.customers || []).find(candidate =>
    sameId(candidate?.id, assignment?.customerId));
  const chair = (state.chairs || []).find(candidate =>
    sameId(candidate?.id, assignment?.chairId));
  const centre = getChairCentre(chair);
  if (!customer || !centre || !isFinitePoint(customer)) return null;
  return {
    customerId: customer.id,
    from: { x: customer.x, y: customer.y },
    to: centre,
  };
}

function seatingTransitionIsClear(state, transitions, stagedCustomerIds) {
  const externalActors = [
    ...(state.staff || []),
    ...(state.customers || []).filter(customer => !containsId(stagedCustomerIds, customer.id)),
    ...getQueueVisibleMembers(state, state.queue || []),
  ].filter(isFinitePoint);

  for (const transition of transitions) {
    if (externalActors.some(actor => sameActor(actor, transition)
      || Math.hypot(actor.x - transition.to.x, actor.y - transition.to.y) < CHAIR_SPACING
      || pointToSegmentDistance(actor, transition.from, transition.to) < CHAIR_SPACING)) {
      return false;
    }
  }

  for (let left = 0; left < transitions.length; left += 1) {
    for (let right = left + 1; right < transitions.length; right += 1) {
      const first = transitions[left];
      const second = transitions[right];
      if (seatingTransitionsConflict(first, second)) {
        return false;
      }
    }
  }
  return true;
}

function getIngressDoorId(state, customer, fallbackDoorId = null) {
  const doors = getDoors(state);
  const customerDoor = doors.find(door => sameId(door?.id, customer?.entryDoorId));
  if (customerDoor && (isDoorRoleForFlow(customerDoor, 'ingress')
    || isDoorCrossing(state, customer, customerDoor))) return customerDoor.id;

  const fallbackDoor = doors.find(door => sameId(door?.id, fallbackDoorId));
  if (fallbackDoor && (isDoorRoleForFlow(fallbackDoor, 'ingress')
    || isDoorCrossing(state, customer, fallbackDoor))) return fallbackDoor.id;

  return getDoorsForFlow(state, 'ingress')[0]?.id ?? null;
}

function createReservedApproachGridFactory(state) {
  const baseGrid = createGrid(state);
  const fallbackDoorId = state.queueAdmissionGate?.doorId ?? null;
  return customer => {
    if (customer?.state !== 'entering') return baseGrid;
    return createActorGrid(state, customer, baseGrid, {
      direction: 'ingress',
      doorId: getIngressDoorId(state, customer, fallbackDoorId),
    });
  };
}

function containsId(ids, value) {
  return [...ids].some(id => sameId(id, value));
}

function withoutEntryDoorId(customer) {
  const { entryDoorId: _entryDoorId, ...withoutEntryDoor } = customer;
  return withoutEntryDoor;
}

// Forced departure without a reputation penalty: the customer keeps its own
// identity and generated lease/party data but is sent safely out of the way.
function safeLeavingFields(customer) {
  const { entryDoorId: _entryDoorId, ...fields } = clearNavigationGoal(customer);
  return {
    ...fields,
    state: 'leaving',
    exitPhase: 'to_door',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: null,
    cashierStationId: null,
    checkoutPosition: null,
    checkoutQueueIndex: null,
    checkoutDeparture: null,
    checkoutLineMember: false,
    checkoutLineGeometry: null,
    paymentReady: false,
    tableId: null,
    chairId: null,
  };
}

function reconcileGate(state) {
  const gate = state.queueAdmissionGate;
  if (!gate) return state;
  const status = getQueueAdmissionGateStatus(state);
  const gateMemberIds = new Set(Array.isArray(gate.customerIds) ? gate.customerIds : []);
  const gateMembers = status.gateMembers;
  if (status.stale) {
    return {
      ...state,
      tables: (state.tables || []).map(table => table.id === gate.tableId
        && table.status === 'reserved' && table.diningPartyId === gate.partyId
        ? clearDiningOwnership(table, 'empty')
        : table),
      customers: (state.customers || []).map(customer => {
        if (!gateMemberIds.has(customer.id)) return customer;
        return customer.state === 'leaving'
          ? withoutEntryDoorId(customer)
          : safeLeavingFields(customer);
      }),
      queueAdmissionGate: null,
    };
  }
  if (!status.clear) {
    const gateDoor = getDoors(state).find(door => sameId(door?.id, gate.doorId));
    const gateDoorIsIngress = isDoorRoleForFlow(gateDoor, 'ingress');
    const crossingOldDoor = gateDoor && (state.customers || [])
      .filter(customer => gateMemberIds.has(customer.id))
      .some(customer => customer.state === 'entering'
        && isDoorCrossing(state, customer, gateDoor));
    const memberDoorIds = gateMembers.map(customer => customer.entryDoorId)
      .filter(doorId => doorId != null);
    const commonMemberDoor = memberDoorIds.length === gateMembers.length
      && memberDoorIds.every(doorId => sameId(doorId, memberDoorIds[0]))
      && getDoors(state).some(door => sameId(door.id, memberDoorIds[0])
        && isDoorRoleForFlow(door, 'ingress'))
      ? memberDoorIds[0]
      : null;
    const doorId = crossingOldDoor
      ? gate.doorId
      : commonMemberDoor || (gateDoorIsIngress && memberDoorIds.length === 0
        ? gate.doorId
        : null);
    if (doorId === gate.doorId) return state;
    return { ...state, queueAdmissionGate: { ...gate, doorId } };
  }
  return {
    ...state,
    customers: (state.customers || []).map(customer => gateMemberIds.has(customer.id)
      ? withoutEntryDoorId(customer)
      : customer),
    queueAdmissionGate: null,
  };
}

// A reservation whose entire party has vanished (abandoned, removed on load, or
// dropped by a fixture edit) can never be completed; release only that party's
// own reservation so a replacement party can be seated.
function releaseOrphanReservations(state) {
  const presentIds = new Set((state.customers || []).map(customer => customer.id));
  return {
    ...state,
    tables: (state.tables || []).map(table => {
      if (table?.status !== 'reserved' || table.diningPartyId == null) return table;
      const memberIds = Array.isArray(table.diningCustomerIds) ? table.diningCustomerIds : [];
      if (memberIds.length === 0) return clearDiningOwnership(table, 'empty');
      return memberIds.some(id => presentIds.has(id)) ? table : clearDiningOwnership(table, 'empty');
    }),
  };
}

function applyAssignmentsToEnteringCustomers(customers, tables) {
  return (customers || []).map(customer => {
    if (customer?.state !== 'entering' || customer.tableId == null) return customer;
    const table = tables.find(candidate => candidate.id === customer.tableId
      && candidate.status === 'reserved'
      && candidate.diningPartyId === customer.partyId);
    const assignment = table?.seatingAssignments
      ?.find(candidate => candidate.customerId === customer.id);
    return assignment ? setNavigationGoal(customer, assignment.approachPoint) : customer;
  });
}

function releaseInvalidReservedParties(state, tables, partyIds) {
  if (partyIds.size === 0) return { ...state, tables };
  const gate = state.queueAdmissionGate;
  return {
    ...state,
    tables,
    customers: (state.customers || []).map(customer =>
      containsId(partyIds, customer.partyId) ? safeLeavingFields(customer) : customer),
    queueAdmissionGate: gate && containsId(partyIds, gate.partyId) ? null : gate,
  };
}

// Bounded per-tick retry for a reserved party whose current approach assignment
// became invalid (for example a moved table). The reservation and the entering
// customers' exact positions are preserved when a legal replacement is available;
// otherwise the reservation is released and the affected party leaves safely.
function refreshBlockedReservedApproaches(state) {
  let changed = false;
  const releasedPartyIds = new Set();
  const navigationGrid = createReservedApproachGridFactory(state);
  const hasIngress = getDoorsForFlow(state, 'ingress').length > 0;
  const tables = (state.tables || []).map(table => {
    if (table?.status !== 'reserved' || table.diningPartyId == null) return table;
    const assignments = table.seatingAssignments;
    const memberIds = Array.isArray(table.diningCustomerIds) ? table.diningCustomerIds : null;
    if (!Array.isArray(assignments) || assignments.length === 0 || memberIds == null) return table;
    const chairIds = assignments.map(assignment => assignment.chairId);
    const geometryValid = validateChairApproachAssignments(
      state, memberIds, chairIds, assignments, table.id,
    );
    if (geometryValid && (!hasIngress || validateChairApproachAssignments(
      state, memberIds, chairIds, assignments, table.id, { navigationGrid },
    ))) {
      return table;
    }
    const recomputed = buildChairApproachAssignments(state, memberIds, chairIds, { navigationGrid });
    if (recomputed
      && validateChairApproachAssignments(
        state, memberIds, chairIds, recomputed, table.id, { navigationGrid },
      )
      && JSON.stringify(recomputed) !== JSON.stringify(assignments)) {
      changed = true;
      return { ...table, seatingAssignments: recomputed };
    }
    if (!geometryValid) {
      changed = true;
      releasedPartyIds.add(table.diningPartyId);
      return clearDiningOwnership(table, 'empty');
    }
    // The stored chair geometry is still sound, so retain the reservation for a
    // temporary route blockage or an intentional no-entrance wait rather than
    // releasing a valid table claim.
    return table;
  });
  if (!changed) return state;
  const released = releaseInvalidReservedParties({ ...state, tables }, tables, releasedPartyIds);
  return {
    ...released,
    customers: applyAssignmentsToEnteringCustomers(released.customers, tables),
  };
}

function availableChairsForTable(state, table) {
  const chairs = (state.chairs || []).filter(chair => chair?.tableId === table.id);
  const claimedChairIds = new Set((state.customers || [])
    .filter(customer => customer.state !== 'leaving' && customer.chairId)
    .map(customer => customer.chairId));
  return chairs.filter(chair => {
    if (claimedChairIds.has(chair.id)) return false;
    const centre = getChairCentre(chair);
    if (!centre) return false;
    // Leaving is a lifecycle state, not proof that the chair is physically clear.
    return (state.customers || []).every(customer => customer.state !== 'leaving'
      || !isFinitePoint(customer)
      || Math.hypot(customer.x - centre.x, customer.y - centre.y) >= CHAIR_SPACING);
  });
}

function planForParty(state, party) {
  const partySize = party.members.length;
  for (const table of state.tables || []) {
    if (table?.status !== 'empty') continue;
    // Wiping and dish collection can finish in either order; admission needs both.
    if ((state.serviceItems || []).some(item => item.tableId === table.id
      && item.state === 'dirty_at_table')) continue;
    const chairCount = (state.chairs || []).filter(chair => chair.tableId === table.id).length;
    if ((table.seats || chairCount) < partySize) continue;
    const chairs = availableChairsForTable(state, table);
    if (chairs.length < partySize) continue;
    const chairIds = chairs.slice(0, partySize).map(chair => chair.id);
    for (const door of getDoorsForFlow(state, 'ingress')) {
      const plan = planQueuePartyAdmission(state, { party, door, tableId: table.id, chairIds });
      if (plan) return { table, plan };
    }
  }
  return null;
}

/**
 * Simulation-owned admission: reconcile the doorway gate, then admit the oldest
 * compatible queued party with zero waiters. Pure.
 */
export function prepareSelfSeating(state) {
  let next = reconcileGate(state);
  next = releaseOrphanReservations(next);
  next = refreshBlockedReservedApproaches(next);
  if (next.queueAdmissionGate) return next;
  for (const party of normaliseCustomerQueue(next.queue || [])) {
    const found = planForParty(next, party);
    if (!found) continue;
    const { table, plan } = found;
    const reserved = reserveTableForParty(table, party.partyId, plan.assignments);
    if (!reserved) continue;
    return {
      ...next,
      customers: [...(next.customers || []), ...plan.admittedCustomers],
      queue: (next.queue || []).filter(record => record.partyId !== party.partyId),
      queueSlots: (next.queueSlots || []).filter(record =>
        String(record?.partyId) !== String(party.partyId)),
      tables: (next.tables || []).map(candidate =>
        candidate.id === table.id ? reserved : candidate),
      queueAdmissionGate: plan.gate,
    };
  }
  return next;
}

/**
 * After the shared movement batch: atomically occupy each reserved party table
 * whose exact members have all reached their own approaches. Pure.
 */
export function resolveSelfSeating(state, statuses = new Map()) {
  const customers = state.customers || [];
  const customersById = new Map(customers.map(customer => [customer?.id, customer]));
  const chairsById = new Map((state.chairs || []).map(chair => [chair?.id, chair]));
  const stagedParties = [];

  const tables = (state.tables || []).map(table => {
    if (table?.status !== 'reserved' || table.diningPartyId == null) return table;
    const assignments = table.seatingAssignments;
    const memberIds = Array.isArray(table.diningCustomerIds) ? table.diningCustomerIds : null;
    if (!Array.isArray(assignments) || assignments.length === 0 || memberIds == null) return table;
    if (!sameOrderedIds(memberIds, assignments.map(assignment => assignment.customerId))) return table;
    const chairIds = assignments.map(assignment => assignment.chairId);
    if (!validateChairApproachAssignments(
      { ...state, customers }, memberIds, chairIds, assignments, table.id,
    )) return table;

    const ready = assignments.every(assignment => {
      const customer = customersById.get(assignment.customerId);
      const chair = chairsById.get(assignment.chairId);
      if (!customer || !chair || chair.tableId !== table.id) return false;
      if (customer.state !== 'entering'
        || customer.tableId !== table.id
        || customer.chairId !== assignment.chairId) return false;
      if (!isFinitePoint(customer) || !isFinitePoint(assignment.approachPoint)) return false;
      if (Math.hypot(
        customer.x - assignment.approachPoint.x,
        customer.y - assignment.approachPoint.y,
      ) > ARRIVAL_TOLERANCE) return false;
      return getMovementStatus(state, statuses, customer.id).plan === 'arrived';
    });
    if (!ready) return table;

    const transitions = assignments.map(assignment => stagedSeatTransition(state, assignment));
    if (transitions.some(transition => transition == null)) return table;
    stagedParties.push({ table, assignments, transitions });
    return table;
  });

  if (stagedParties.length === 0) return state;

  const stagedCustomerIds = stagedParties.flatMap(party =>
    party.assignments.map(assignment => assignment.customerId));
  const unsafeTableIds = new Set(stagedParties
    .filter(party => !seatingTransitionIsClear(state, party.transitions, stagedCustomerIds))
    .map(party => party.table.id));
  for (let left = 0; left < stagedParties.length; left += 1) {
    for (let right = left + 1; right < stagedParties.length; right += 1) {
      const conflicts = stagedParties[left].transitions.some(first =>
        stagedParties[right].transitions.some(second => seatingTransitionsConflict(first, second)));
      if (conflicts) {
        unsafeTableIds.add(stagedParties[left].table.id);
        unsafeTableIds.add(stagedParties[right].table.id);
      }
    }
  }
  const safeParties = stagedParties.filter(party => !unsafeTableIds.has(party.table.id));
  if (safeParties.length === 0) return state;

  const seatByCustomerId = new Map();
  const safeTableIds = new Set(safeParties.map(party => party.table.id));
  for (const party of safeParties) {
    for (const assignment of party.assignments) {
      seatByCustomerId.set(assignment.customerId, {
        chair: chairsById.get(assignment.chairId),
        table: party.table,
      });
    }
  }

  return {
    ...state,
    tables: tables.map(table => safeTableIds.has(table.id)
      ? occupyTableForParty(table, table.diningPartyId) : table),
    customers: customers.map(customer => {
      const seat = seatByCustomerId.get(customer.id);
      if (!seat) return customer;
      const centre = getChairCentre(seat.chair);
      return clearNavigationGoal({
        ...customer,
        state: 'seated',
        tableId: seat.table.id,
        chairId: seat.chair.id,
        ...recordSeatResidency(customer, seat.chair, seat.table),
        seatTime: state.restaurant.gameTime,
        x: centre.x,
        y: centre.y,
      });
    }),
  };
}

/**
 * Reconcile reserved party ownership against the current fixture geometry at the
 * load/fixture-move boundary. Recompute approaches for moved fixtures without
 * teleporting entering customers; release an invalid reservation whose own table,
 * chairs, or approach geometry can no longer be recovered and send its members
 * away without a penalty. Pure.
 */
export function reconcileSelfSeatingState(state) {
  const chairsById = new Map((state.chairs || []).map(chair => [chair?.id, chair]));
  const presentCustomerIds = new Set((state.customers || []).map(customer => customer?.id));
  const tableIds = new Set((state.tables || []).map(table => table?.id));
  const releasedPartyIds = new Set();
  const leavingCustomerIds = new Set();
  const navigationGrid = createReservedApproachGridFactory(state);
  const hasIngress = getDoorsForFlow(state, 'ingress').length > 0;

  let tables = (state.tables || []).map(table => {
    if (table?.status !== 'reserved' || table.diningPartyId == null) return table;
    const assignments = table.seatingAssignments;
    const memberIds = Array.isArray(table.diningCustomerIds) ? table.diningCustomerIds : null;
    if (!Array.isArray(assignments) || assignments.length === 0 || memberIds == null) {
      releasedPartyIds.add(table.diningPartyId);
      return clearDiningOwnership(table, 'empty');
    }
    // A reservation whose entire party vanished can never complete; release only
    // this party's own reservation (never a replacement party's).
    if (!memberIds.every(id => presentCustomerIds.has(id))) {
      releasedPartyIds.add(table.diningPartyId);
      memberIds.forEach(id => leavingCustomerIds.add(id));
      return clearDiningOwnership(table, 'empty');
    }
    const chairIds = assignments.map(assignment => assignment.chairId);
    const chairsValid = chairIds.every(chairId => {
      const chair = chairsById.get(chairId);
      return Boolean(chair) && chair.tableId === table.id;
    });
    if (!chairsValid) {
      releasedPartyIds.add(table.diningPartyId);
      memberIds.forEach(id => leavingCustomerIds.add(id));
      return clearDiningOwnership(table, 'empty');
    }
    const geometryValid = validateChairApproachAssignments(
      state, memberIds, chairIds, assignments, table.id,
    );
    if (geometryValid && (!hasIngress || validateChairApproachAssignments(
      state, memberIds, chairIds, assignments, table.id, { navigationGrid },
    ))) return table;

    const recomputed = buildChairApproachAssignments(
      state, memberIds, chairIds, { navigationGrid },
    );
    if (recomputed
      && validateChairApproachAssignments(
        state, memberIds, chairIds, recomputed, table.id, { navigationGrid },
      )) {
      return { ...table, seatingAssignments: recomputed };
    }
    if (!geometryValid) {
      releasedPartyIds.add(table.diningPartyId);
      memberIds.forEach(id => leavingCustomerIds.add(id));
      return clearDiningOwnership(table, 'empty');
    }
    // Retain a valid reservation while a temporary route is blocked.
    return table;
  });

  let customers = (state.customers || []).map(customer => {
    if (customer.state === 'entering') {
      if (customer.tableId != null && !tableIds.has(customer.tableId)) {
        return safeLeavingFields(customer);
      }
      const table = tables.find(candidate => candidate.id === customer.tableId
        && candidate.status === 'reserved'
        && candidate.diningPartyId === customer.partyId);
      const assignment = table?.seatingAssignments
        ?.find(candidate => candidate.customerId === customer.id);
      if (assignment) return setNavigationGoal(customer, assignment.approachPoint);
      if (releasedPartyIds.has(customer.partyId)) return safeLeavingFields(customer);
      return customer;
    }
    if (leavingCustomerIds.has(customer.id)) return safeLeavingFields(customer);
    return customer;
  });

  const reconciled = { ...state };
  if (Array.isArray(state.tables)) reconciled.tables = tables;
  if (Array.isArray(state.customers)) reconciled.customers = customers;
  reconciled.queueAdmissionGate = containsId(releasedPartyIds, state.queueAdmissionGate?.partyId)
    ? null
    : state.queueAdmissionGate;
  return reconciled.queueAdmissionGate ? reconcileGate(reconciled) : reconciled;
}
