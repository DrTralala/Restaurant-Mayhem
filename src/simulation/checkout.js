import { clearMovementRecoveryMetadata, planCharacterPath } from './movement';
import { worldToCell } from './pathfinding';
import { getCashierCustomerPosition } from './world';

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
  return clearMovementRecoveryMetadata({
    ...customer,
    state: 'checkout_queued',
    cashierStationId: null,
    checkoutPosition: null,
    paymentReady: false,
    path: [],
    stalledFor: 0,
  });
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
  const staffedStations = (state.cashierStations || []).filter(station =>
    (state.staff || []).some(worker =>
      worker.id === station.assignedStaffId && worker.role === 'waiter'));
  const stationById = new Map(staffedStations.map(station => [station.id, station]));
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
      return station && hasMatchingPaymentTask(state, customer, station)
        ? customer
        : requeue(customer);
    }
    if (customer.state === 'checkout_queued') {
      return requeueCheckoutCustomer(customer);
    }
    return customer.state === 'checkout_moving' && !stationById.has(customer.cashierStationId)
      ? requeue(customer)
      : customer;
  });

  const queueLengths = new Map(staffedStations.map(station => [station.id, 0]));
  for (const customer of prepared) {
    if (customer.state !== 'checkout_moving'
      || !queueLengths.has(customer.cashierStationId)) continue;
    queueLengths.set(customer.cashierStationId,
      queueLengths.get(customer.cashierStationId) + 1);
  }

  prepared = prepared.map(customer => {
    if (customer.state !== 'checkout_queued' || requeuedIds.has(customer.id)
      || staffedStations.length === 0) return customer;
    const station = staffedStations.reduce((shortest, candidate) =>
      queueLengths.get(candidate.id) < queueLengths.get(shortest.id) ? candidate : shortest,
    staffedStations[0]);
    queueLengths.set(station.id, queueLengths.get(station.id) + 1);
    return {
      ...customer,
      state: 'checkout_moving',
      cashierStationId: station.id,
      paymentReady: false,
    };
  });

  const positions = new Map();
  const queueIndexes = new Map();
  for (const station of staffedStations) {
    prepared
      .filter(customer => customer.state === 'checkout_moving'
        && customer.cashierStationId === station.id)
      .sort((left, right) => (left.paymentQueuedAt ?? 0) - (right.paymentQueuedAt ?? 0)
        || String(left.id).localeCompare(String(right.id)))
      .forEach((customer, index) => {
        positions.set(customer.id, getCashierCustomerPosition(station, index));
        queueIndexes.set(customer.id, index);
      });
  }

  return prepared.map(customer => {
    if (customer.state !== 'checkout_moving') return customer;
    const checkoutPosition = positions.get(customer.id);
    if (!checkoutPosition) return requeueCheckoutCustomer(customer);
    const current = Number.isFinite(customer.x) && Number.isFinite(customer.y)
      ? customer
      : { ...customer, x: checkoutPosition.x - 80, y: checkoutPosition.y + 80 };
    const goal = worldToCell(checkoutPosition);
    const arrived = Math.hypot(
      current.x - checkoutPosition.x,
      current.y - checkoutPosition.y,
    ) <= 2;
    if (arrived) {
      return {
        ...current,
        checkoutPosition,
        paymentReady: queueIndexes.get(customer.id) === 0,
        path: [],
        pathGoal: undefined,
        stalledFor: 0,
      };
    }
    const needsPlan = !current.path?.length || !current.pathGoal
      || current.pathGoal.x !== goal.x || current.pathGoal.y !== goal.y;
    if (!needsPlan) return { ...current, checkoutPosition, paymentReady: false };
    return {
      ...planCharacterPath(
        { ...state, customers: prepared },
        current,
        { world: checkoutPosition },
        [
          ...(state.staff || []),
          ...prepared.filter(candidate =>
            candidate.id !== current.id && candidate.exitPhase !== 'fading'),
        ],
      ),
      checkoutPosition,
      paymentReady: false,
    };
  });
}
