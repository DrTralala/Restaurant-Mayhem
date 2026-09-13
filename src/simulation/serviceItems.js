import { DRINKS } from '../data/drinks';
import { DIRTY_STATES } from './dishwashing';
import { isCheckoutState } from './checkout';
import { chooseAffordableBasket } from './menuEconomy';

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
      && cook.carryingServiceItemId === item.id
      && (!cook.task
        || (cook.task.type === 'place_dish_on_service'
          && cook.task.serviceItemId === item.id
          && cook.task.serviceTableId === item.serviceTableId
          && cook.task.serviceSlotIndex === item.serviceSlotIndex));
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
    seen.add(key);
  }

  const carrierByItem = new Map();
  let staff = (state.staff || []).map(worker => {
    const item = kept.find(candidate => candidate.id === worker.carryingServiceItemId);
    if (!item || !['carried', 'carried_dirty'].includes(item.state)
      || (item.state === 'carried_dirty' && worker.role !== 'waiter')) return { ...worker, carryingServiceItemId: null };
    const owners = carrierByItem.get(item.id) || [];
    carrierByItem.set(item.id, [...owners, worker.id]);
    return worker;
  });
  const uniqueCarriers = new Map([...carrierByItem].filter(([, owners]) => owners.length === 1));
  staff = staff.map(worker => uniqueCarriers.get(worker.carryingServiceItemId)
    ? worker
    : { ...worker, carryingServiceItemId: null });
  let serviceItems = kept.map(item => item.state === 'carried'
    && uniqueCarriers.get(item.id) == null
    ? { ...item, state: 'to_clean' }
    : item);
  const stationIds = new Set((state.washStations || []).map(station => station.id));
  serviceItems = serviceItems.map(item => {
    if (item.state === 'carried_dirty' && uniqueCarriers.get(item.id) == null) {
      return item.tableId != null && (state.tables || []).some(table => table.id === item.tableId)
        ? { ...item, state: 'dirty_at_table' }
        : { ...item, state: 'queued_for_wash', washStationId: null };
    }
    if (item.state === 'washing' && !stationIds.has(item.washStationId)) {
      return { ...item, state: 'queued_for_wash', washStationId: null, washStartedAt: null };
    }
    if (item.state === 'queued_for_wash' && item.washStationId != null
      && !stationIds.has(item.washStationId)) {
      return { ...item, washStationId: null, washStartedAt: null };
    }
    return item;
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
        return item.kind !== kind || item.menuItemId !== menuItemId;
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
