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
import { getDoors } from './world';
import { normaliseCustomerQueue } from './customerQueue';

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
    paymentReady: false,
    tableId: null,
    chairId: null,
  };
}

function reconcileGate(state) {
  const gate = state.queueAdmissionGate;
  if (!gate) return state;
  const status = getQueueAdmissionGateStatus(state);
  if (status.stale) {
    const gateMemberIds = new Set(Array.isArray(gate.customerIds) ? gate.customerIds : []);
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
  if (!status.clear) return state;
  const gateMemberIds = new Set(Array.isArray(gate.customerIds) ? gate.customerIds : []);
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

// Bounded per-tick retry for a reserved party whose current approach assignment
// became statically invalid (for example a temporary fixture block). The
// reservation and the entering customers' exact positions are preserved until a
// legal plan exists; then a fresh approach assignment is applied without
// teleporting anyone.
function refreshBlockedReservedApproaches(state) {
  let changed = false;
  const tables = (state.tables || []).map(table => {
    if (table?.status !== 'reserved' || table.diningPartyId == null) return table;
    const assignments = table.seatingAssignments;
    const memberIds = Array.isArray(table.diningCustomerIds) ? table.diningCustomerIds : null;
    if (!Array.isArray(assignments) || assignments.length === 0 || memberIds == null) return table;
    const chairIds = assignments.map(assignment => assignment.chairId);
    if (validateChairApproachAssignments(state, memberIds, chairIds, assignments, table.id)) {
      return table;
    }
    const recomputed = buildChairApproachAssignments(state, memberIds, chairIds);
    if (!recomputed
      || !validateChairApproachAssignments(state, memberIds, chairIds, recomputed, table.id)
      || JSON.stringify(recomputed) === JSON.stringify(assignments)) {
      return table;
    }
    changed = true;
    return { ...table, seatingAssignments: recomputed };
  });
  if (!changed) return state;
  return {
    ...state,
    tables,
    customers: applyAssignmentsToEnteringCustomers(state.customers, tables),
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
    const chairCount = (state.chairs || []).filter(chair => chair.tableId === table.id).length;
    if ((table.seats || chairCount) < partySize) continue;
    const chairs = availableChairsForTable(state, table);
    if (chairs.length < partySize) continue;
    const chairIds = chairs.slice(0, partySize).map(chair => chair.id);
    for (const door of getDoors(state)) {
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
  const seatByCustomerId = new Map();

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

    for (const assignment of assignments) {
      seatByCustomerId.set(assignment.customerId, {
        chair: chairsById.get(assignment.chairId),
        table,
      });
    }
    return occupyTableForParty(table, table.diningPartyId);
  });

  if (seatByCustomerId.size === 0) return state;

  return {
    ...state,
    tables,
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
 * teleporting entering customers; release only a reservation whose own table or
 * chairs were removed and send its members away without a penalty. Pure.
 */
export function reconcileSelfSeatingState(state) {
  const chairsById = new Map((state.chairs || []).map(chair => [chair?.id, chair]));
  const presentCustomerIds = new Set((state.customers || []).map(customer => customer?.id));
  const tableIds = new Set((state.tables || []).map(table => table?.id));
  const releasedPartyIds = new Set();
  const leavingCustomerIds = new Set();

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
    if (!memberIds.some(id => presentCustomerIds.has(id))) {
      releasedPartyIds.add(table.diningPartyId);
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
    const recomputed = buildChairApproachAssignments(state, memberIds, chairIds);
    if (recomputed
      && validateChairApproachAssignments(state, memberIds, chairIds, recomputed, table.id)) {
      return { ...table, seatingAssignments: recomputed };
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
  return reconciled.queueAdmissionGate ? reconcileGate(reconciled) : reconciled;
}
