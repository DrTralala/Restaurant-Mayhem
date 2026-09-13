import { getCharacterMovementStatus } from './movement';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
import { getCashierCustomerPosition } from './world';

const CHECKOUT_CLEARANCE = 16;
const CHECKOUT_GEOMETRY_EPSILON = 1e-9;

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function samePoint(left, right) {
  return finitePoint(left) && finitePoint(right)
    && left.x === right.x && left.y === right.y;
}

function checkoutLineGeometry(station) {
  return station && [station.x, station.y, station.w, station.h].every(Number.isFinite)
    ? {
        stationId: String(station.id),
        x: station.x,
        y: station.y,
        w: station.w,
        h: station.h,
      }
    : null;
}

function sameCheckoutLineGeometry(left, right) {
  return left?.stationId === right?.stationId
    && left?.x === right?.x
    && left?.y === right?.y
    && left?.w === right?.w
    && left?.h === right?.h;
}

function pointToSegmentDistance(point, start, end) {
  if (!finitePoint(point) || !finitePoint(start) || !finitePoint(end)) return Infinity;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + dx * fraction),
    point.y - (start.y + dy * fraction),
  );
}

function validCheckoutDeparture(customer, station) {
  const departure = customer?.checkoutDeparture;
  if (!departure || departure.stationId == null || !finitePoint(departure.position)) return false;
  if (String(departure.stationId) !== String(station?.id)) return false;
  const paymentPosition = station ? getCashierCustomerPosition(station, 0) : null;
  return samePoint(departure.position, paymentPosition);
}

function checkoutDepartureIsHolding(departureCustomer, nextCustomer, station) {
  if (!validCheckoutDeparture(departureCustomer, station) || !finitePoint(nextCustomer)) return false;
  const paymentPosition = getCashierCustomerPosition(station, 0);
  return pointToSegmentDistance(departureCustomer, nextCustomer, paymentPosition)
    < CHECKOUT_CLEARANCE - CHECKOUT_GEOMETRY_EPSILON;
}

export const CHECKOUT_PHASES = Object.freeze([
  'checkout_queued',
  'checkout_moving',
  'checkout_processing',
]);

export function isCheckoutState(value) {
  const state = typeof value === 'string' ? value : value?.state;
  return state === 'paying' || CHECKOUT_PHASES.includes(state);
}

export function requeueCheckoutCustomer(customer) {
  return {
    ...clearNavigationGoal(customer),
    state: 'checkout_queued',
    cashierStationId: null,
    checkoutPosition: null,
    checkoutQueueIndex: null,
    checkoutDeparture: null,
    checkoutLineMember: false,
    checkoutLineGeometry: null,
    paymentReady: false,
  };
}

export function enterCheckout(customer, gameTime) {
  if (isCheckoutState(customer)) {
    return customer.state === 'paying'
      ? {
          ...requeueCheckoutCustomer(customer),
          paymentQueuedAt: customer.paymentQueuedAt ?? gameTime,
        }
      : customer;
  }
  return {
    ...requeueCheckoutCustomer(customer),
    paymentQueuedAt: customer.paymentQueuedAt ?? gameTime,
  };
}

function hasMatchingPaymentTask(state, customer, station) {
  return (state.staff || []).some(worker => worker.id === station.assignedStaffId
    && worker.role === 'waiter'
    && worker.task?.type === 'take_payment'
    && worker.task.customerId === customer.id
    && worker.task.stationId === station.id);
}

export function prepareCheckoutCustomers(state, customers = state.customers || []) {
  const stations = (state.cashierStations || []).filter(station => station?.id != null);
  const stationById = new Map(stations.map(station => [station.id, station]));
  const staffedStations = stations.filter(station =>
    (state.staff || []).some(worker =>
      worker.id === station.assignedStaffId && worker.role === 'waiter'));
  const staffedStationIds = new Set(staffedStations.map(station => station.id));
  const requeuedIds = new Set();
  const requeue = customer => {
    requeuedIds.add(customer.id);
    return requeueCheckoutCustomer(customer);
  };

  let prepared = customers.map(customer => {
    if (customer.state === 'paying') {
      return enterCheckout(customer, state.restaurant.gameTime);
    }
    if (!isCheckoutState(customer)) return customer;
    if (customer.state === 'checkout_processing') {
      const station = stationById.get(customer.cashierStationId);
      return station && staffedStationIds.has(station.id)
        && hasMatchingPaymentTask(state, customer, station)
        ? customer
        : requeue(customer);
    }
    if (customer.state === 'checkout_queued') {
      return requeueCheckoutCustomer(customer);
    }
    // A physical cashier station remains a valid queue destination even while
    // unstaffed: the diner can still vacate the seat. Payment itself stays
    // gated on a matching waiter task.
    return customer.state === 'checkout_moving' && !stationById.has(customer.cashierStationId)
      ? requeue(customer)
      : customer;
  });

  // A departure reservation is only meaningful against the exact payment
  // position which created it. A missing or moved station therefore releases
  // the claim on the next preparation pass instead of leaving a stale lock.
  prepared = prepared.map(customer => {
    if (customer.state !== 'leaving' || customer.checkoutDeparture == null) return customer;
    const station = stations.find(candidate =>
      String(candidate.id) === String(customer.checkoutDeparture.stationId));
    return validCheckoutDeparture(customer, station)
      ? customer
      : { ...customer, checkoutDeparture: null };
  });

  const processingCounts = new Map(stations.map(station => [station.id, 0]));
  const queueLengths = new Map(stations.map(station => [station.id, 0]));
  for (const customer of prepared) {
    if (!queueLengths.has(customer.cashierStationId)) continue;
    if (customer.state === 'checkout_processing') {
      processingCounts.set(customer.cashierStationId,
        processingCounts.get(customer.cashierStationId) + 1);
      queueLengths.set(customer.cashierStationId,
        queueLengths.get(customer.cashierStationId) + 1);
    } else if (customer.state === 'checkout_moving') {
      queueLengths.set(customer.cashierStationId,
        queueLengths.get(customer.cashierStationId) + 1);
    }
  }

  const initialClearanceCounts = new Map(stations.map(station => [station.id, 0]));
  for (const station of stations) {
    const moving = prepared
      .filter(customer => customer.state === 'checkout_moving'
        && customer.cashierStationId === station.id)
      .sort((left, right) => (left.paymentQueuedAt ?? 0) - (right.paymentQueuedAt ?? 0)
        || String(left.id).localeCompare(String(right.id)));
    const next = moving[0];
    if (!next) continue;
    const holds = prepared.filter(customer => customer.state === 'leaving'
      && checkoutDepartureIsHolding(customer, next, station)).length;
    initialClearanceCounts.set(station.id, holds);
    queueLengths.set(station.id, queueLengths.get(station.id) + holds);
  }

  prepared = prepared.map(customer => {
    if (customer.state !== 'checkout_queued' || requeuedIds.has(customer.id)
      || stations.length === 0) return customer;
    const candidates = staffedStations.length > 0 ? staffedStations : stations;
    const station = candidates.reduce((shortest, candidate) =>
      queueLengths.get(candidate.id) < queueLengths.get(shortest.id) ? candidate : shortest,
    candidates[0]);
    queueLengths.set(station.id, queueLengths.get(station.id) + 1);
    return {
      ...customer,
      state: 'checkout_moving',
      cashierStationId: station.id,
      paymentReady: false,
    };
  });

  const clearanceCounts = new Map(stations.map(station => [station.id, 0]));
  for (const station of stations) {
    const moving = prepared
      .filter(customer => customer.state === 'checkout_moving'
        && customer.cashierStationId === station.id)
      .sort((left, right) => (left.paymentQueuedAt ?? 0) - (right.paymentQueuedAt ?? 0)
        || String(left.id).localeCompare(String(right.id)));
    const next = moving[0];
    if (!next) continue;
    clearanceCounts.set(station.id, prepared.filter(customer => customer.state === 'leaving'
      && checkoutDepartureIsHolding(customer, next, station)).length);
  }

  const positions = new Map();
  const queueIndexes = new Map();
  for (const station of stations) {
    const movingIndexOffset = processingCounts.get(station.id) + clearanceCounts.get(station.id);
    prepared
      .filter(customer => customer.state === 'checkout_moving'
        && customer.cashierStationId === station.id)
      .sort((left, right) => (left.paymentQueuedAt ?? 0) - (right.paymentQueuedAt ?? 0)
        || String(left.id).localeCompare(String(right.id)))
      .forEach((customer, index) => {
        const queueIndex = movingIndexOffset + index;
        positions.set(customer.id, getCashierCustomerPosition(station, queueIndex));
        queueIndexes.set(customer.id, queueIndex);
      });
  }

  const withGoals = prepared.map(customer => {
    if (customer.state !== 'checkout_moving') return customer;
    const checkoutPosition = positions.get(customer.id);
    if (!checkoutPosition) return requeueCheckoutCustomer(customer);
    const station = stationById.get(customer.cashierStationId);
    const geometry = checkoutLineGeometry(station);
    const geometryUnchanged = !customer.checkoutLineGeometry
      || sameCheckoutLineGeometry(customer.checkoutLineGeometry, geometry);
    const arrivedAtSlot = finitePoint(customer)
      && Math.hypot(customer.x - checkoutPosition.x, customer.y - checkoutPosition.y) <= 2;
    const current = Number.isFinite(customer.x) && Number.isFinite(customer.y)
      ? customer
      : {
          ...customer,
          x: checkoutPosition.x - 80,
          y: checkoutPosition.y + 80,
        };
    const withGoal = setNavigationGoal(current, checkoutPosition);
    return {
      ...withGoal,
      checkoutPosition,
      checkoutQueueIndex: queueIndexes.get(customer.id),
      checkoutLineMember: geometryUnchanged && (customer.checkoutLineMember === true || arrivedAtSlot),
      checkoutLineGeometry: geometry,
      paymentReady: false,
    };
  });

  const statusState = { ...state, customers: withGoals };
  return withGoals.map(customer => {
    if (customer.state !== 'checkout_moving') return customer;
    const status = getCharacterMovementStatus(statusState, customer.id);
    return {
      ...customer,
      paymentReady: queueIndexes.get(customer.id) === 0 && status.plan === 'arrived',
    };
  });
}
