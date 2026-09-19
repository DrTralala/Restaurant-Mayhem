import { DRINKS } from '../data/drinks';
import { DIRTY_STATES } from './dishwashing';
import { isCheckoutState } from './checkout';
import { chooseAffordableBasket } from './menuEconomy';
import { clearNavigationGoal } from './movement/navigationGoal';
import {
  getCarriedServiceItemIds,
  getStaffCarryCapacity,
  withCarriedServiceItemIds,
} from './staffInventory';
import { SERVICE_COUNTER_CAPACITY, getServiceSlotPosition } from './serviceCounter';
import {
  cancelCustomerFood,
  expireFoodPatience,
  getFoodPatienceFraction,
  startFoodPatience,
} from './foodPatience';

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

export {
  cancelCustomerFood,
  expireFoodPatience,
  getFoodPatienceFraction,
  startFoodPatience,
  SERVICE_COUNTER_CAPACITY,
  getServiceSlotPosition,
};

export function selectOrderKinds(roll) {
  if (roll < 0.75) return ['dish'];
  if (roll < 0.95) return ['dish', 'drink'];
  return ['drink'];
}

export function selectUnlockedDrinkId(unlockedDrinkIds, roll) {
  const unlocked = DRINKS.filter(drink => unlockedDrinkIds?.includes(drink.id));
  if (!unlocked.length) return null;
  const index = Math.min(unlocked.length - 1, Math.floor(Math.max(0, roll) * unlocked.length));
  return unlocked[index].id;
}

export function hasDuplicateOwner(serviceItems, customerId, kind) {
  return (serviceItems || []).some(item => sameId(item.customerId, customerId) && item.kind === kind);
}

export function getNextServiceItemId(serviceItems) {
  const greatest = (serviceItems || []).reduce((maximum, item) => {
    const match = /^service-item-(\d+)$/.exec(item.id || '');
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `service-item-${greatest + 1}`;
}

export function getOccupiedServiceSlotKeys(state) {
  const serviceTableIds = new Set((state.serviceTables || []).map(table => String(table.id)));
  const occupied = new Set();

  for (const item of state.serviceItems || []) {
    const hasServiceTable = item.serviceTableId != null
      && serviceTableIds.has(String(item.serviceTableId));
    if (!hasServiceTable) continue;
    const validSlot = Number.isInteger(item.serviceSlotIndex)
      && item.serviceSlotIndex >= 0
      && item.serviceSlotIndex < SERVICE_COUNTER_CAPACITY
    const tableKey = String(item.serviceTableId);
    const slotKey = validSlot ? `${tableKey}:${item.serviceSlotIndex}` : `${tableKey}:*`;

    if (item.state === 'on_service') {
      occupied.add(slotKey);
      continue;
    }

    // A cancelled cooked item remains a physical counter occupant until a
    // cleaner removes it. Its delivery claim is gone, but its waste origin is
    // still authoritative for slot reuse.
    if (isCancelledFoodForCustomer(
      (state.customers || []).find(customer => sameId(customer.id, item.customerId)), item,
    )
      && item.state === 'to_clean') {
      occupied.add(slotKey);
      continue;
    }

    const cook = (state.staff || []).find(worker => sameId(worker.id, item.assignedStaffId));
    const hasCookDeliveryReservation = ['dish', 'drink'].includes(item.kind)
      && item.state === 'carried'
      && cook?.role === 'cook'
      && sameId(item.assignedStaffId, cook.id)
      && getCarriedServiceItemIds(cook).some(id => sameId(id, item.id));
    if (hasCookDeliveryReservation) {
      if (!validSlot) {
        occupied.add(`${tableKey}:*`);
        continue;
      }
      occupied.add(slotKey);
      continue;
    }

    if (hasValidDrinkReservation(state, item)) {
      occupied.add(slotKey);
    }
  }

  return occupied;
}

export function findAvailableServiceSlot(state) {
  const occupied = getOccupiedServiceSlotKeys(state);
  for (const serviceTable of state.serviceTables || []) {
    for (let serviceSlotIndex = 0; serviceSlotIndex < SERVICE_COUNTER_CAPACITY; serviceSlotIndex += 1) {
      if (occupied.has(`${serviceTable.id}:*`)
        || occupied.has(`${serviceTable.id}:${serviceSlotIndex}`)) continue;
      return {
        serviceTableId: serviceTable.id,
        serviceSlotIndex,
        ...getServiceSlotPosition(serviceTable, serviceSlotIndex),
      };
    }
  }
  return null;
}

function createServiceItem(serviceItems, customer, kind, menuItemId) {
  return {
    id: getNextServiceItemId(serviceItems),
    kind,
    menuItemId,
    customerId: customer.id,
    tableId: customer.tableId ?? null,
    serviceTableId: null,
    serviceSlotIndex: null,
    state: 'ordered',
    stationId: null,
    assignedStaffId: null,
    preparationStartedAt: null,
    readyAt: null,
    dirtyAt: null,
    washStationId: null,
    washQueuedAt: null,
    washStartedAt: null,
    x: null,
    y: null,
  };
}

export function createCustomerOrder(state, customer, random = Math.random) {
  if (customer?.foodOutcome === 'cancelled' || customer?.foodOutcome === 'delivered') {
    return { customer, serviceItems: state.serviceItems || [] };
  }
  const { customer: profiledCustomer, basket } = chooseAffordableBasket(state, customer, random);
  let serviceItems = [...(state.serviceItems || [])];
  const initialLength = serviceItems.length;
  if (!basket) {
    return {
      customer: {
        ...profiledCustomer,
        state: 'waiting_for_party',
        menuOutcome: 'unaffordable',
        dishId: null,
        drinkId: null,
        dishPriceAtOrder: null,
        drinkPriceAtOrder: null,
        orderSubtotal: null,
        orderedServiceItemIds: [],
        consumedServiceItemIds: [],
        foodOrderedAt: null,
        foodPatienceBudget: null,
        foodDeadlineAt: null,
        foodOutcome: null,
        foodCancelledAt: null,
        cancelledServiceItemIds: [],
      },
      serviceItems,
    };
  }

  const selections = [
    ['dish', basket.dish?.id ?? null],
    ['drink', basket.drink?.id ?? null],
  ];
  const existingCustomerItems = serviceItems.filter(
    item => item.customerId === profiledCustomer.id,
  );
  const ownershipConflict = existingCustomerItems.some(item => {
    const selection = selections.find(([kind]) => kind === item.kind);
    return !selection || selection[1] !== item.menuItemId;
  }) || selections.some(([kind, menuItemId]) => menuItemId
    && existingCustomerItems.filter(item => item.kind === kind).length > 1);
  if (ownershipConflict) return { customer: profiledCustomer, serviceItems };

  for (const [kind, menuItemId] of selections) {
    if (!menuItemId || hasDuplicateOwner(serviceItems, customer.id, kind)) continue;
    serviceItems.push(createServiceItem(serviceItems, profiledCustomer, kind, menuItemId));
  }

  if (serviceItems.length === initialLength) return { customer: profiledCustomer, serviceItems };

  const customerItems = serviceItems.filter(item => item.customerId === profiledCustomer.id);
  const orderCustomer = {
    ...profiledCustomer,
    state: 'waiting_for_items',
    menuOutcome: 'ordered',
    dishId: basket.dish?.id ?? null,
    drinkId: basket.drink?.id ?? null,
    dishPriceAtOrder: basket.dish?.price ?? null,
    drinkPriceAtOrder: basket.drink?.price ?? null,
    orderSubtotal: basket.price,
    orderTime: state.restaurant?.gameTime ?? profiledCustomer.orderTime,
    orderedServiceItemIds: customerItems.map(item => item.id),
    consumedServiceItemIds: [],
  };
  const withFoodPatience = basket.dish
    ? startFoodPatience(orderCustomer, state.restaurant?.gameTime)
    : {
        ...orderCustomer,
        foodOrderedAt: null,
        foodPatienceBudget: null,
        foodDeadlineAt: null,
        foodOutcome: null,
        foodCancelledAt: null,
        cancelledServiceItemIds: [],
      };
  return {
    customer: withFoodPatience,
    serviceItems,
  };
}

export function allOrderedItemsDelivered(customer, serviceItems) {
  const requiredKinds = [
    customer.dishId ? 'dish' : null,
    customer.drinkId ? 'drink' : null,
  ].filter(Boolean);
  return requiredKinds.length > 0 && requiredKinds.every(kind =>
    serviceItems.some(item => sameId(item.customerId, customer.id)
      && item.kind === kind
      && item.state === 'delivered'),
  );
}

function isPhysicalServiceItem(item) {
  return ['ready', 'on_service', 'carried', 'delivered', 'to_clean', ...DIRTY_STATES].includes(item.state);
}

function carriedInventoryKind(item) {
  if (item?.state === 'carried_dirty') return 'dirty';
  if (item?.state === 'carried') return 'clean';
  return null;
}

function canCarryDirtyServiceItem(worker, item) {
  return worker?.role === 'waiter' && item?.state === 'carried_dirty';
}

function isCancelledFoodForCustomer(customer, item) {
  return item?.foodCancelled === true
    || (customer?.cancelledServiceItemIds || []).some(id => String(id) === String(item?.id));
}

function carrierForItem(state, item) {
  const carriers = (state.staff || []).filter(worker =>
    getCarriedServiceItemIds(worker).some(id => sameId(id, item.id)));
  return carriers.length === 1 ? carriers[0] : null;
}

function drinkStationFor(state, stationId) {
  return stationId == null
    ? null
    : (state.kitchenStations || []).find(station => sameId(station.id, stationId));
}

function isBareDrinkStation(state, stationId) {
  const station = drinkStationFor(state, stationId);
  return Boolean(station) && station.equipmentId == null;
}

function hasBaseDrinkReservation(state, item) {
  const customer = (state.customers || []).find(candidate => sameId(candidate.id, item.customerId));
  const worker = (state.staff || []).find(staff => sameId(staff.id, item.assignedStaffId));
  const counter = (state.serviceTables || []).some(table => sameId(table.id, item.serviceTableId));
  const legacyStationlessReservation = item.stationId == null && worker?.task?.stationId == null;
  const stationMatches = legacyStationlessReservation
    || (item.stationId != null && worker?.task?.stationId != null
      && sameId(worker.task.stationId, item.stationId));
  const stationIsValid = legacyStationlessReservation || isBareDrinkStation(state, item.stationId);
  return item.kind === 'drink'
    && ['ordered', 'preparing'].includes(item.state)
    && worker?.role === 'cook'
    && customer
    && customer.state !== 'leaving'
    && sameId(customer.drinkId, item.menuItemId)
    && worker.task?.type === 'prepare_drink'
    && sameId(worker.task.serviceItemId, item.id)
    && stationMatches
    && stationIsValid
    && sameId(worker.task.serviceTableId, item.serviceTableId)
    && worker.task.serviceSlotIndex === item.serviceSlotIndex
    && Number.isInteger(item.serviceSlotIndex)
    && item.serviceSlotIndex >= 0 && item.serviceSlotIndex < SERVICE_COUNTER_CAPACITY && counter;
}

function drinkReservationSortKey(state, item) {
  const worker = (state.staff || []).find(candidate => sameId(candidate.id, item.assignedStaffId));
  return `${String(worker?.id ?? '\uffff')}\u0000${String(item.id ?? '\uffff')}`;
}

function ownsDrinkStationExclusively(state, item) {
  if (item.stationId == null) return true;
  const contenders = (state.serviceItems || [])
    .filter(candidate => candidate.kind === 'drink'
      && sameId(candidate.stationId, item.stationId)
      && hasBaseDrinkReservation(state, candidate))
    .sort((left, right) => drinkReservationSortKey(state, left)
      .localeCompare(drinkReservationSortKey(state, right)));
  return contenders.length === 0 || sameId(contenders[0].id, item.id);
}

function normaliseCancelledFoodItem(state, item) {
  if (['ordered', 'preparing'].includes(item.state)) return null;
  const marked = { ...item, foodCancelled: true, deliveryProhibited: true };
  if (item.state === 'carried') {
    const carrier = carrierForItem(state, item);
    const retainedByWaiter = carrier?.role === 'waiter';
    return {
      ...marked,
      state: retainedByWaiter ? 'carried_dirty' : 'to_clean',
      ...(Number.isFinite(carrier?.x) && Number.isFinite(carrier?.y)
        ? { x: carrier.x, y: carrier.y } : {}),
      assignedStaffId: null,
      serviceTableId: null,
      serviceSlotIndex: null,
      stationId: null,
      washStationId: null,
      reservedWashStationId: null,
      washQueuedAt: null,
      washStartedAt: null,
    };
  }
  return ['ready', 'on_service', 'delivered'].includes(item.state)
    ? { ...marked, state: 'to_clean', assignedStaffId: null }
    : marked;
}

export function hasValidDrinkReservation(state, item) {
  return hasBaseDrinkReservation(state, item) && ownsDrinkStationExclusively(state, item);
}

export function normaliseServiceItemOwnership(state) {
  const customers = state.customers || [];
  const customerIds = new Set(customers.map(customer => String(customer.id)));
  const seen = new Set();
  const kept = [];
  for (const item of state.serviceItems || []) {
    const key = `${item.customerId}:${item.kind}`;
    if (seen.has(key)) {
      if (isPhysicalServiceItem(item)) kept.push({ ...item, state: DIRTY_STATES.has(item.state) ? item.state : 'to_clean' });
      continue;
    }
    seen.add(key);
    const owner = customers.find(customer => sameId(customer.id, item.customerId));
    if (isCancelledFoodForCustomer(owner, item)) {
      const cancelledItem = normaliseCancelledFoodItem(state, item);
      if (cancelledItem) kept.push(cancelledItem);
      continue;
    }
    if (!customerIds.has(String(item.customerId)) || owner.state === 'leaving') {
      const canKeepCancelledCarrier = item.foodCancelled === true
        && ['carried', 'carried_dirty'].includes(item.state);
      if (canKeepCancelledCarrier) {
        kept.push(item);
        continue;
      }
      if (isPhysicalServiceItem(item)) {
        kept.push(item.kind === 'drink' && item.state === 'carried'
          ? {
            ...item,
            state: 'to_clean',
            ...(item.assignedStaffId != null ? { assignedStaffId: null } : {}),
            ...(item.serviceTableId != null ? { serviceTableId: null } : {}),
            ...(item.serviceSlotIndex != null ? { serviceSlotIndex: null } : {}),
            ...(item.stationId != null ? { stationId: null } : {}),
          }
          : {
            ...item,
            state: DIRTY_STATES.has(item.state) ? item.state : 'to_clean',
            ...(item.kind === 'drink' && !DIRTY_STATES.has(item.state)
              ? { assignedStaffId: null } : {}),
          });
      }
      continue;
    }
    if (['ordered', 'preparing'].includes(item.state) && item.kind === 'drink'
      && !hasValidDrinkReservation(state, item)) {
      const hasProgress = Number.isFinite(item.accumulatedWork) && item.accumulatedWork > 0;
      const now = state.restaurant?.gameTime;
      kept.push({
        ...item,
        state: 'ordered',
        stationId: null,
        serviceTableId: null,
        serviceSlotIndex: null,
        assignedStaffId: null,
        ...(hasProgress
          ? (Number.isFinite(now)
            ? { lastProgressAt: Math.max(Number.isFinite(item.lastProgressAt) ? item.lastProgressAt : now, now) }
            : {})
          : { preparationStartedAt: null, readyAt: null, lastProgressAt: null }),
      });
    } else if (['ordered', 'preparing'].includes(item.state)) {
      kept.push(item);
    } else {
      kept.push(item);
    }
  }

  const carrierCandidates = new Map();
  for (const worker of state.staff || []) {
    for (const id of getCarriedServiceItemIds(worker)) {
       const item = kept.find(candidate => sameId(candidate.id, id));
      if (!item || !['carried', 'carried_dirty'].includes(item.state)
        || (item.state === 'carried_dirty' && !canCarryDirtyServiceItem(worker, item))) continue;
      const itemKey = String(item.id);
      const owners = carrierCandidates.get(itemKey) || [];
      carrierCandidates.set(itemKey, [...owners, worker.id]);
    }
  }
  const carrierByItem = new Map(
    [...carrierCandidates.entries()]
      .filter(([, owners]) => owners.length === 1)
      .map(([itemId, [workerId]]) => [itemId, workerId]),
  );
  const acceptedCarrierByItem = new Map();
  for (const worker of state.staff || []) {
    let inventoryKind = null;
    let acceptedCount = 0;
    for (const id of getCarriedServiceItemIds(worker)) {
      const item = kept.find(candidate => String(candidate.id) === String(id));
      if (!item || carrierByItem.get(String(item.id)) !== worker.id) continue;
      const itemKind = carriedInventoryKind(item);
      if (inventoryKind == null) inventoryKind = itemKind;
      if (itemKind !== inventoryKind || acceptedCount >= getStaffCarryCapacity(worker)) continue;
      acceptedCarrierByItem.set(String(item.id), worker.id);
      acceptedCount += 1;
    }
  }
  let staff = (state.staff || []).map(worker => withCarriedServiceItemIds(
    worker,
    getCarriedServiceItemIds(worker).filter(id =>
      acceptedCarrierByItem.get(String(id)) === worker.id),
  ));
  let serviceItems = kept.map(item => {
    const carrierId = acceptedCarrierByItem.get(String(item.id));
    if (carrierId == null && item.state === 'carried') return { ...item, state: 'to_clean' };
    if (carrierId == null && item.state === 'carried_dirty') {
       return item.tableId != null && (state.tables || []).some(table => sameId(table.id, item.tableId))
        ? { ...item, state: 'dirty_at_table' }
        : { ...item, state: 'queued_for_wash', washStationId: null };
    }
    if (carrierId != null && ['carried', 'carried_dirty'].includes(item.state)) {
      const carrier = staff.find(worker => worker.id === carrierId);
      return carrier && Number.isFinite(carrier.x) && Number.isFinite(carrier.y)
        ? { ...item, x: carrier.x, y: carrier.y }
        : item;
    }
    return item;
  });
  const stationIds = new Set((state.washStations || []).map(station => station.id));
  serviceItems = serviceItems.map(item => {
    if (item.state === 'washing' && !stationIds.has(item.washStationId)) {
      return { ...item, state: 'queued_for_wash', washStationId: null, washStartedAt: null };
    }
    if (item.state === 'queued_for_wash' && item.washStationId != null
      && !stationIds.has(item.washStationId)) {
      return { ...item, washStationId: null, washStartedAt: null };
    }
    return item;
  });

  // Manual washing has an explicit worker/station boundary once it starts.
  // Recover malformed or abandoned reservations to the queue, and retain only
  // the first valid task when a legacy save contains competing owners. A
  // waiter transfer also owns a queued manual item until it reaches its
  // automatic destination, so it must be validated before manual recovery.
  const validWashTaskByItem = new Map();
  const validTransferTaskByItem = new Map();
  const transferTaskItemIds = new Set();
  for (const worker of staff) {
    const task = worker.task;
    if (task?.type === 'wash_item') {
      const item = serviceItems.find(candidate => String(candidate.id) === String(task.serviceItemId));
      const station = (state.washStations || []).find(candidate =>
        String(candidate.id) === String(item?.washStationId));
      const valid = worker.role === 'janitor'
        && item
        && ['queued_for_wash', 'washing'].includes(item.state)
        && station?.type === 'manual'
        && String(task.washStationId) === String(item.washStationId)
        && (item.assignedStaffId == null
          || String(item.assignedStaffId) === String(worker.id));
      if (valid && !validWashTaskByItem.has(String(item.id))) {
        validWashTaskByItem.set(String(item.id), worker);
      }
      continue;
    }
    if (task?.type !== 'transfer_dirty_item') continue;
    if (task.serviceItemId != null) transferTaskItemIds.add(String(task.serviceItemId));
    const item = serviceItems.find(candidate => sameId(candidate.id, task.serviceItemId));
    const source = (state.washStations || []).find(candidate =>
      sameId(candidate.id, task.sourceWashStationId));
    const destination = (state.washStations || []).find(candidate =>
      sameId(candidate.id, task.washStationId));
    const valid = worker.role === 'waiter'
      && item?.kind === 'dish'
      && item.state === 'queued_for_wash'
      && sameId(item.assignedStaffId, worker.id)
      && sameId(task.serviceItemId, item.id)
      && source?.type === 'manual'
      && sameId(task.sourceWashStationId, source.id)
      && sameId(item.washStationId, source.id)
      && destination?.type === 'automatic'
      && !sameId(source.id, destination.id)
      && sameId(task.washStationId, destination.id)
      && sameId(item.reservedWashStationId, destination.id);
    if (valid && !validTransferTaskByItem.has(String(item.id))) {
      validTransferTaskByItem.set(String(item.id), worker);
    }
  }

  serviceItems = serviceItems.map(item => {
    const transferOwner = validTransferTaskByItem.get(String(item.id));
    const hasInvalidTransferTask = transferTaskItemIds.has(String(item.id)) && !transferOwner;
    if (!['queued_for_wash', 'washing'].includes(item.state)) {
      return hasInvalidTransferTask || (item.state !== 'carried_dirty'
        && item.reservedWashStationId != null)
        ? { ...item, assignedStaffId: null, reservedWashStationId: null }
        : item;
    }
    const station = (state.washStations || []).find(candidate =>
      String(candidate.id) === String(item.washStationId));
    if (!station) {
      return item.assignedStaffId == null && item.reservedWashStationId == null
        ? item
        : { ...item, assignedStaffId: null, reservedWashStationId: null };
    }
    if (transferOwner) return item;
    if (station.type !== 'manual') {
      return item.reservedWashStationId == null && item.assignedStaffId == null
        ? item
        : { ...item, assignedStaffId: null, reservedWashStationId: null };
    }
    const owner = validWashTaskByItem.get(String(item.id));
    if (!owner && (item.state === 'washing'
      || item.assignedStaffId != null || item.reservedWashStationId != null)) {
      return {
        ...item,
        state: 'queued_for_wash',
        washStartedAt: null,
        assignedStaffId: null,
        reservedWashStationId: null,
      };
    }
    if (!owner) return item;
    return {
      ...item,
      ...(item.assignedStaffId == null ? { assignedStaffId: owner.id } : {}),
      ...(item.reservedWashStationId != null ? { reservedWashStationId: null } : {}),
    };
  });
  staff = staff.map(worker => {
    const task = worker.task;
    if (task?.type === 'transfer_dirty_item') {
      const owner = validTransferTaskByItem.get(String(task.serviceItemId));
      return owner && sameId(owner.id, worker.id)
        ? worker
        : { ...clearNavigationGoal(worker), task: null };
    }
    if (task?.type !== 'wash_item') return worker;
    const owner = validWashTaskByItem.get(String(task.serviceItemId));
    return owner && String(owner.id) === String(worker.id)
      ? worker
      : { ...clearNavigationGoal(worker), task: null };
  });

  const finalCustomers = customers.map(customer => {
    const selectedKinds = [customer.dishId ? 'dish' : null, customer.drinkId ? 'drink' : null].filter(Boolean);
    const represented = serviceItems.filter(item => sameId(item.customerId, customer.id));
    const activeOrderState = ['waiting_for_items', 'eating'].includes(customer.state)
      || isCheckoutState(customer);
    const orderedIds = Array.isArray(customer.orderedServiceItemIds)
      ? customer.orderedServiceItemIds
      : [];
    const cancelledIds = new Set((customer.cancelledServiceItemIds || []).map(id => String(id)));
    const activeOrderedIds = orderedIds.filter(id => !cancelledIds.has(String(id)));
    const consumedIds = new Set(customer.consumedServiceItemIds || []);
    const activeItems = represented
      .filter(item => ['ordered', 'preparing', 'ready', 'on_service', 'carried', 'delivered'].includes(item.state)
        || DIRTY_STATES.has(item.state));
    const missingSelectedKinds = selectedKinds.filter(kind => {
      const menuItemId = kind === 'dish' ? customer.dishId : customer.drinkId;
      return !activeItems.some(item => item.kind === kind && item.menuItemId === menuItemId);
    });
    const malformedTrackedOrder = activeOrderedIds.length !== selectedKinds.length
      || activeOrderedIds.some((id, index) => {
        const item = activeItems.find(candidate => candidate.id === id);
        if (!item) return !consumedIds.has(id);
        const kind = selectedKinds[index];
        const menuItemId = kind === 'dish' ? customer.dishId : customer.drinkId;
        return item.kind !== kind
          || (item.menuItemId != null && item.menuItemId !== menuItemId);
      });
    const malformed = selectedKinds.length > 1
      && activeOrderState
      && (orderedIds.length > 0
        ? malformedTrackedOrder
        : missingSelectedKinds.length > 0);
    return malformed
      ? { ...customer, state: 'leaving', dishId: null, drinkId: null, orderTime: null }
      : customer;
  });
  return { ...state, customers: finalCustomers, staff, serviceItems };
}
