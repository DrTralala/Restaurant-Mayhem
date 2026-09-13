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
  return (serviceItems || []).some(item => item.customerId === customerId && item.kind === kind);
}

export function getNextServiceItemId(serviceItems) {
  const greatest = (serviceItems || []).reduce((maximum, item) => {
    const match = /^service-item-(\d+)$/.exec(item.id || '');
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `service-item-${greatest + 1}`;
}

export function getServiceSlotPosition(serviceTable, serviceSlotIndex) {
  const rotation = Number.isInteger(serviceTable?.rotation)
    ? ((serviceTable.rotation % 4) + 4) % 4
    : 0;
  if (rotation === 1) {
    return { x: serviceTable.x + 10, y: serviceTable.y + 10 + serviceSlotIndex * 30 };
  }
  if (rotation === 2) {
    return { x: serviceTable.x + 110 - serviceSlotIndex * 30, y: serviceTable.y + 10 };
  }
  if (rotation === 3) {
    return { x: serviceTable.x + 10, y: serviceTable.y + 110 - serviceSlotIndex * 30 };
  }
  return { x: serviceTable.x + 10 + serviceSlotIndex * 30, y: serviceTable.y + 10 };
}

export function getOccupiedServiceSlotKeys(state) {
  const serviceTableIds = new Set((state.serviceTables || []).map(table => table.id));
  const occupied = new Set();

  for (const item of state.serviceItems || []) {
    const validSlot = Number.isInteger(item.serviceSlotIndex)
      && item.serviceSlotIndex >= 0
      && item.serviceSlotIndex < 4
      && serviceTableIds.has(item.serviceTableId);
    if (!validSlot) continue;

    if (item.state === 'on_service') {
      occupied.add(`${item.serviceTableId}:${item.serviceSlotIndex}`);
      continue;
    }

    const cook = (state.staff || []).find(worker => worker.id === item.assignedStaffId);
    const hasCookDeliveryReservation = item.kind === 'dish'
      && item.state === 'carried'
      && cook?.role === 'cook'
      && item.assignedStaffId === cook.id
      && getCarriedServiceItemIds(cook).includes(item.id);
    if (hasCookDeliveryReservation) {
      occupied.add(`${item.serviceTableId}:${item.serviceSlotIndex}`);
      continue;
    }

    if (hasValidDrinkReservation(state, item)) {
      occupied.add(`${item.serviceTableId}:${item.serviceSlotIndex}`);
    }
  }

  return occupied;
}

export function findAvailableServiceSlot(state) {
  const occupied = getOccupiedServiceSlotKeys(state);
  for (const serviceTable of state.serviceTables || []) {
    for (let serviceSlotIndex = 0; serviceSlotIndex < 4; serviceSlotIndex += 1) {
      if (occupied.has(`${serviceTable.id}:${serviceSlotIndex}`)) continue;
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
  return {
    customer: {
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
    },
    serviceItems,
  };
}

export function allOrderedItemsDelivered(customer, serviceItems) {
  const requiredKinds = [
    customer.dishId ? 'dish' : null,
    customer.drinkId ? 'drink' : null,
  ].filter(Boolean);
  return requiredKinds.length > 0 && requiredKinds.every(kind =>
    serviceItems.some(item => item.customerId === customer.id
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

export function hasValidDrinkReservation(state, item) {
  const customer = (state.customers || []).find(candidate => candidate.id === item.customerId);
  const worker = (state.staff || []).find(staff => staff.id === item.assignedStaffId);
  const counter = (state.serviceTables || []).some(table => table.id === item.serviceTableId);
  return item.kind === 'drink'
    && ['ordered', 'preparing'].includes(item.state)
    && worker?.role === 'cook'
    && customer
    && customer.state !== 'leaving'
    && customer.drinkId === item.menuItemId
    && worker.task?.type === 'prepare_drink'
    && worker.task.serviceItemId === item.id
    && worker.task.serviceTableId === item.serviceTableId
    && worker.task.serviceSlotIndex === item.serviceSlotIndex
    && Number.isInteger(item.serviceSlotIndex)
    && item.serviceSlotIndex >= 0 && item.serviceSlotIndex < 4 && counter;
}

export function normaliseServiceItemOwnership(state) {
  const customers = state.customers || [];
  const customerIds = new Set(customers.map(customer => customer.id));
  const seen = new Set();
  const kept = [];
  for (const item of state.serviceItems || []) {
    const key = `${item.customerId}:${item.kind}`;
    if (seen.has(key)) {
       if (isPhysicalServiceItem(item)) kept.push({ ...item, state: DIRTY_STATES.has(item.state) ? item.state : 'to_clean' });
       continue;
    }
    seen.add(key);
    const owner = customers.find(customer => customer.id === item.customerId);
    if (!customerIds.has(item.customerId) || owner.state === 'leaving') {
       if (isPhysicalServiceItem(item)) kept.push({ ...item, state: DIRTY_STATES.has(item.state) ? item.state : 'to_clean' });
      continue;
    }
    if (['ordered', 'preparing'].includes(item.state) && item.kind === 'drink'
      && !hasValidDrinkReservation(state, item)) {
      kept.push({
        ...item,
        state: 'ordered',
        serviceTableId: null,
        serviceSlotIndex: null,
        assignedStaffId: null,
        preparationStartedAt: null,
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
      const item = kept.find(candidate => candidate.id === id);
      if (!item || !['carried', 'carried_dirty'].includes(item.state)
        || (item.state === 'carried_dirty' && worker.role !== 'waiter')) continue;
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
      return item.tableId != null && (state.tables || []).some(table => table.id === item.tableId)
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
  // the first valid task when a legacy save contains competing owners.
  const validWashTaskByItem = new Map();
  for (const worker of staff) {
    const task = worker.task;
    if (task?.type !== 'wash_item') continue;
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
  }

  serviceItems = serviceItems.map(item => {
    if (!['queued_for_wash', 'washing'].includes(item.state)) return item;
    const station = (state.washStations || []).find(candidate =>
      String(candidate.id) === String(item.washStationId));
    if (!station) {
      return item.assignedStaffId == null ? item : { ...item, assignedStaffId: null };
    }
    if (station.type !== 'manual') return item;
    const owner = validWashTaskByItem.get(String(item.id));
    if (!owner && (item.state === 'washing' || item.assignedStaffId != null)) {
      return {
        ...item,
        state: 'queued_for_wash',
        washStartedAt: null,
        assignedStaffId: null,
      };
    }
    return owner && item.assignedStaffId == null
      ? { ...item, assignedStaffId: owner.id }
      : item;
  });
  staff = staff.map(worker => {
    const task = worker.task;
    if (task?.type !== 'wash_item') return worker;
    const owner = validWashTaskByItem.get(String(task.serviceItemId));
    return owner && String(owner.id) === String(worker.id)
      ? worker
      : { ...clearNavigationGoal(worker), task: null };
  });

  const finalCustomers = customers.map(customer => {
    const selectedKinds = [customer.dishId ? 'dish' : null, customer.drinkId ? 'drink' : null].filter(Boolean);
    const represented = serviceItems.filter(item => item.customerId === customer.id);
    const activeOrderState = ['waiting_for_items', 'eating'].includes(customer.state)
      || isCheckoutState(customer);
    const orderedIds = Array.isArray(customer.orderedServiceItemIds)
      ? customer.orderedServiceItemIds
      : [];
    const consumedIds = new Set(customer.consumedServiceItemIds || []);
    const activeItems = represented
      .filter(item => ['ordered', 'preparing', 'ready', 'on_service', 'carried', 'delivered'].includes(item.state)
        || DIRTY_STATES.has(item.state));
    const missingSelectedKinds = selectedKinds.filter(kind => {
      const menuItemId = kind === 'dish' ? customer.dishId : customer.drinkId;
      return !activeItems.some(item => item.kind === kind && item.menuItemId === menuItemId);
    });
    const malformedTrackedOrder = orderedIds.length !== selectedKinds.length
      || orderedIds.some((id, index) => {
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
