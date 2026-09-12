import { getCharacterMovementStatus } from './movement';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
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
  return {
    ...clearNavigationGoal(customer),
    state: 'checkout_queued',
    cashierStationId: null,
    checkoutPosition: null,
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

  const processingCounts = new Map(staffedStations.map(station => [station.id, 0]));
  const queueLengths = new Map(staffedStations.map(station => [station.id, 0]));
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
    const movingIndexOffset = processingCounts.get(station.id);
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
