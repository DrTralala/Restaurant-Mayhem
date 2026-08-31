import { DRINKS, getDrink } from '../data/drinks';
import { getDishValueScore } from './balance';
import { DIRTY_STATES } from './dishwashing';
import { isCheckoutState } from './checkout';

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
  return {
    x: serviceTable.x + 10 + serviceSlotIndex * 30,
    y: serviceTable.y + 10,
  };
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

function selectBestDish(dishes) {
  if (!dishes?.length) return null;
  return dishes.reduce((best, dish) =>
    getDishValueScore(dish) > getDishValueScore(best) ? dish : best,
  dishes[0]);
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
  const selectedKinds = selectOrderKinds(random());
  const selectedDish = selectedKinds.includes('dish') ? selectBestDish(state.dishes) : null;
  let selectedDrinkId = selectedKinds.includes('drink')
    ? selectUnlockedDrinkId(state.unlockedDrinkIds, random())
    : null;
  let dish = selectedDish;

  if (!dish && selectedKinds.includes('dish') && !selectedKinds.includes('drink')) {
    selectedDrinkId = selectUnlockedDrinkId(state.unlockedDrinkIds, random());
  }
  if (!selectedDrinkId && selectedKinds.includes('drink') && !selectedKinds.includes('dish')) {
    dish = selectBestDish(state.dishes);
  }

  let serviceItems = [...(state.serviceItems || [])];
  const initialLength = serviceItems.length;
  const selections = [
    ['dish', dish?.id || null],
    ['drink', selectedDrinkId],
  ];

  for (const [kind, menuItemId] of selections) {
    if (!menuItemId || hasDuplicateOwner(serviceItems, customer.id, kind)) continue;
    serviceItems.push(createServiceItem(serviceItems, customer, kind, menuItemId));
  }

  if (serviceItems.length === initialLength) return { customer, serviceItems };

  const customerItems = serviceItems.filter(item => item.customerId === customer.id);
  const dishItem = customerItems.find(item => item.kind === 'dish');
  const drinkItem = customerItems.find(item => item.kind === 'drink');
  return {
    customer: {
      ...customer,
      state: 'waiting_for_items',
      dishId: dishItem?.menuItemId ?? customer.dishId ?? null,
      drinkId: drinkItem?.menuItemId ?? customer.drinkId ?? null,
      orderTime: state.restaurant?.gameTime ?? customer.orderTime,
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
    && worker?.role === 'waiter'
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
      kept.push({ ...item, serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null });
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
    const malformed = selectedKinds.length > 1
      && activeOrderState
      && selectedKinds.some(kind => {
        const menuItemId = kind === 'dish' ? customer.dishId : customer.drinkId;
        return !represented.some(item => item.customerId === customer.id && item.kind === kind
          && item.menuItemId === menuItemId
          && ['ordered', 'preparing', 'ready', 'on_service', 'carried', 'delivered'].includes(item.state));
      });
    return malformed
      ? { ...customer, state: 'leaving', dishId: null, drinkId: null, orderTime: null }
      : customer;
  });
  return { ...state, customers: finalCustomers, staff, serviceItems };
}
