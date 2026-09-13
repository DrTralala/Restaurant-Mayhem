import { cellToWorld, findAdjacentOpenCells, findPath, isInsideWorld, worldToCell } from './pathfinding';
import { advanceCharacterMovementBatch, getCharacterMovementStatus } from './movement';
import { getMovementStatus } from './movement/status';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
import { getCustomerMovementEntries } from './customers';
import { recordSeatResidency } from './movement/seatedDeparture';
import { GRID_SIZE, getCashierCustomerPosition, getCashierWorkPosition, getDefaultStaffPosition, getDoorPosition, getDoors, getRestaurantWorld } from './world';
import { clampReputation, getTipRate, getUpgradeEffect } from './balance';
import { getAssignedCashierStation } from './cashiers';
import { getDrink, getResolvedDrink } from '../data/drinks';
import { getPlaceableDimensions } from '../data/placeables';
import {
  allOrderedItemsDelivered,
  createCustomerOrder,
  findAvailableServiceSlot,
  getServiceSlotPosition,
  normaliseServiceItemOwnership,
  hasValidDrinkReservation,
} from './serviceItems';
import { ACTIVITY_DURATIONS } from './activity';
import {
  advanceStaffTaskProgress,
  getStaffTaskRate,
  getStaffTaskSource,
} from './staffPerformance';
import { startCustomerConsumption } from './consumption';
import { getWashStationCapacity, getWashStationOccupancy, hasWashStationCapacity } from './dishwashing';
import { getCarriedServiceItemIds, getStaffCarryCapacity, withCarriedServiceItemIds } from './staffInventory';
import {
  completeCookingBatchItem,
  createCookingBatch,
  getBatchServiceItemIds,
  getCookingBatch,
  getCookingBatchCapacity,
  getCookingBatchForCook,
  getCookingBatchRemainder,
  isDishCompatibleWithStation,
  normaliseCookingBatches,
  recoverCookingBatches,
  selectCookingBatchItems,
} from './cookingBatches';
import { clearDiningOwnership } from './tableLifecycle';
import { isCheckoutState, requeueCheckoutCustomer } from './checkout';
import {
  getStaffMovementSpeed,
  markTaskAssigned,
  markWorking,
  prepareStaffActivity,
  settleTasklessActivity,
} from './staffActivity';
import { getQueueVisibleMembers } from './customerQueue';
import {
  PAID_REVIEW_SCORE,
  getPartyKey,
  recordPartyOrderOutcome,
  recordPartyPayment,
  settlePartyReview,
} from './partyReviews';
import { getOrderSnapshotSubtotal } from './menuEconomy';

export function ensureStaffRuntime(staff, state) {
  return (staff || []).map((worker, index) => {
    const position = Number.isFinite(worker.x) && Number.isFinite(worker.y)
      ? { x: worker.x, y: worker.y }
      : getDefaultStaffPosition(worker.role, index, state, worker.id);
    return withCarriedServiceItemIds(
      { ...worker, ...position, task: worker.task || null },
      getCarriedServiceItemIds(worker),
    );
  });
}

const CHARACTER_START_SPACING = 16;

function targetForTable(state, table, staff) {
  return targetForRect(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff);
}

function targetForTableOrCurrent(state, table, staff) {
  return targetForRectOrCurrent(
    state,
    { x: table.x, y: table.y, w: 40, h: 40 },
    staff,
  );
}

function getServiceTableRect(serviceTable) {
  const dimensions = getPlaceableDimensions('serviceTable', serviceTable.rotation);
  return {
    x: serviceTable.x,
    y: serviceTable.y,
    w: dimensions.width,
    h: dimensions.height,
  };
}

function isStaffDestinationAvailable(state, point, staff) {
  return (state.staff || []).every(worker => {
    if (worker.id === staff.id || (!worker.task && !worker.navigationGoal)) return true;
    const destination = worker.navigationGoal || worker;
    return !Number.isFinite(destination.x) || !Number.isFinite(destination.y)
      || Math.hypot(point.x - destination.x, point.y - destination.y) >= CHARACTER_START_SPACING;
  });
}

function targetForRect(state, rect, staff) {
  const start = worldToCell(staff);
  const candidates = findAdjacentOpenCells(state, rect, start);
  for (const target of candidates) {
    const goal = target.x === start.x && target.y === start.y
      ? { x: staff.x, y: staff.y } : cellToWorld(target);
    if (!isStaffDestinationAvailable(state, goal, staff)) continue;
    const staticRoute = findPath(state, start, target);
    if (staticRoute.length || (target.x === start.x && target.y === start.y)) {
      return {
        goal,
        distance: staticRoute.length * GRID_SIZE,
      };
    }
  }
  return null;
}

function withoutEntryDoorId(customer) {
  const { entryDoorId: _entryDoorId, ...withoutEntryDoor } = customer;
  return withoutEntryDoor;
}

function leavingFields(customer, overrides = {}) {
  return clearNavigationGoal({
    ...withoutEntryDoorId(customer),
    state: 'leaving',
    exitPhase: 'to_door',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: null,
    checkoutPosition: null,
    cashierStationId: null,
    checkoutDeparture: null,
    checkoutLineMember: false,
    checkoutLineGeometry: null,
    paymentReady: false,
    ...overrides,
  });
}

function checkoutDepartureFor(customer, station) {
  if (customer?.checkoutDeparture?.stationId != null
    && Number.isFinite(customer.checkoutDeparture.position?.x)
    && Number.isFinite(customer.checkoutDeparture.position?.y)) {
    return {
      stationId: customer.checkoutDeparture.stationId,
      position: { ...customer.checkoutDeparture.position },
    };
  }
  const position = Number.isFinite(customer?.checkoutPosition?.x)
    && Number.isFinite(customer?.checkoutPosition?.y)
    ? customer.checkoutPosition
    : station && Number.isFinite(station.x) && Number.isFinite(station.y)
      && Number.isFinite(station.w) && Number.isFinite(station.h)
      ? getCashierCustomerPosition(station, 0)
      : null;
  return station?.id != null && position
    ? { stationId: station.id, position: { x: position.x, y: position.y } }
    : null;
}

function targetForRectOrCurrent(state, rect, staff) {
  const current = worldToCell(staff);
  const candidates = findAdjacentOpenCells(state, rect, current);
  const isInsideTarget = staff.x >= rect.x && staff.x <= rect.x + rect.w
    && staff.y >= rect.y && staff.y <= rect.y + rect.h;
  if ((isInsideTarget || candidates.some(candidate => candidate.x === current.x && candidate.y === current.y))
    && isStaffDestinationAvailable(state, staff, staff)) {
    return { goal: { x: staff.x, y: staff.y }, distance: 0 };
  }
  return targetForRect(state, rect, staff);
}

function targetForPoint(state, point, staff) {
  const start = worldToCell(staff);
  const target = worldToCell(point);
  const staticRoute = findPath(state, start, target);
  if (!staticRoute.length && (target.x !== start.x || target.y !== start.y)) return null;
  return {
    goal: cellToWorld(target),
    distance: staticRoute.length * GRID_SIZE,
  };
}

function washDuration(station) {
  return station.type === 'automatic'
    ? ACTIVITY_DURATIONS.automaticWash
    : ACTIVITY_DURATIONS.manualWash;
}

function isTableReadyForCleaning(table, customers, serviceItems, chairs = []) {
  const hasBlockingCustomer = customers.some(customer => customer.tableId === table.id
    && customer.state !== 'leaving' && !isCheckoutState(customer));
  const hasDirtyItem = serviceItems.some(item => item.tableId === table.id
    && item.state === 'dirty_at_table');
  // A leaving/checkout member is not proof that the chair is physically clear.
  const chairsClear = chairs
    .filter(chair => chair?.tableId === table.id && Number.isFinite(chair.x) && Number.isFinite(chair.y))
    .every(chair => customers.every(customer => !Number.isFinite(customer?.x)
      || !Number.isFinite(customer?.y)
      || Math.hypot(customer.x - (chair.x + 10), customer.y - (chair.y + 10))
        >= CHARACTER_START_SPACING));
  return !hasBlockingCustomer && !hasDirtyItem && chairsClear;
}

function projectedWashWorkload(state, station, staff, serviceItems, allStaff) {
  const duration = washDuration(station);
  const active = serviceItems.find(item => item.state === 'washing' && item.washStationId === station.id);
  const activeRemaining = active && Number.isFinite(active.washStartedAt)
    && Number.isFinite(state.restaurant?.gameTime)
    ? Math.max(0, duration - (state.restaurant.gameTime - active.washStartedAt))
    : active ? duration : 0;
  const queuedIds = new Set(serviceItems
    .filter(item => item.state === 'queued_for_wash' && item.washStationId === station.id)
    .map(item => String(item.id)));
  const ownCarriedIds = new Set(getCarriedServiceItemIds(staff).map(id => String(id)));
  const inboundIds = new Set(serviceItems
    .filter(item => item.state === 'carried_dirty'
      && item.washStationId === station.id
      && !ownCarriedIds.has(String(item.id)))
    .map(item => String(item.id)));
  let anonymousReservations = 0;
  for (const worker of allStaff || state.staff || []) {
    if (worker.id === staff.id
      || worker.task?.type !== 'deliver_dirty_item'
      || worker.task.washStationId !== station.id) continue;
    const reservedIds = new Set([
      worker.task.serviceItemId,
      ...getCarriedServiceItemIds(worker).filter(id => serviceItems.some(item =>
        item.id === id && item.state === 'carried_dirty')),
    ].filter(id => id != null).map(id => String(id)));
    if (reservedIds.size === 0) anonymousReservations += 1;
    reservedIds.forEach(id => inboundIds.add(id));
  }
  return activeRemaining
    + (queuedIds.size + inboundIds.size + anonymousReservations) * duration;
}

function selectWashStation(state, staff, serviceItems, allStaff) {
  const occupancyState = { ...state, staff: allStaff || state.staff || [], serviceItems };
  const carriedDirtyIds = getCarriedServiceItemIds(staff).filter(id => serviceItems.some(item =>
    item.id === id && item.state === 'carried_dirty'));
  return (state.washStations || [])
    .filter(station => hasWashStationCapacity(occupancyState, station, {
      excludeServiceItemIds: carriedDirtyIds,
    }))
    .map(station => ({
      station,
      target: targetForRectOrCurrent(state, station, staff),
      workload: projectedWashWorkload(state, station, staff, serviceItems, allStaff),
    }))
    .filter(candidate => candidate.target !== null)
    .sort((left, right) => (left.station.type === 'automatic' ? 0 : 1)
      - (right.station.type === 'automatic' ? 0 : 1)
      || left.workload - right.workload
      || left.target.distance - right.target.distance
      || String(left.station.id).localeCompare(String(right.station.id)))[0] || null;
}

function hasExactDrinkReservation(staff, item, serviceTables) {
  if (!item || item.kind !== 'drink' || !['ordered', 'preparing'].includes(item.state)) return false;
  const owner = (staff || []).find(candidate => candidate.id === item.assignedStaffId);
  return owner?.id != null
    && owner?.role === 'cook'
    && owner.task?.type === 'prepare_drink'
    && owner.task.serviceItemId === item.id
    && owner.task.serviceTableId === item.serviceTableId
    && owner.task.serviceSlotIndex === item.serviceSlotIndex
    && Number.isInteger(item.serviceSlotIndex)
    && item.serviceSlotIndex >= 0
    && item.serviceSlotIndex < 4
    && (serviceTables || []).some(table => table.id === item.serviceTableId);
}

function clearDrinkReservation(serviceItems, serviceItemId) {
  return serviceItems.map(item => item.id === serviceItemId
    && item.kind === 'drink'
    && ['ordered', 'preparing'].includes(item.state)
    ? {
      ...item,
      state: 'ordered',
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
      preparationStartedAt: null,
    }
    : item);
}

function recoverCarriedItemsForCustomer(serviceItems, customerId) {
  const carriedIds = serviceItems
    .filter(item => item.customerId === customerId
      && ['carried', 'carried_dirty'].includes(item.state))
    .map(item => item.id);
  const carriedSet = new Set(carriedIds);
  const recoveredItems = serviceItems.map(item => {
    if (!carriedSet.has(item.id)) return item;
    return item.state === 'carried_dirty'
      ? {
        ...item,
        state: 'queued_for_wash',
        washStationId: null,
        washStartedAt: null,
        assignedStaffId: null,
      }
      : { ...item, state: 'to_clean', assignedStaffId: null };
  });
  return { carriedIds, recoveredItems };
}

function assignTask({ state, staff, allStaff, customers, queue, tables, serviceItems, claimedCustomerIds, claimedServiceItemIds, claimedTableIds, claimedDirtIds }) {
  const cashierStation = staff.role === 'waiter'
    ? getAssignedCashierStation(state.cashierStations, staff.id)
    : null;

  if (staff.role === 'janitor') {
    const dirt = (state.floorDirt || [])
      .filter(candidate => !claimedDirtIds?.has(candidate.id))
      .map(candidate => ({
        dirt: candidate,
        target: targetForRectOrCurrent(state, { x: candidate.x - 6, y: candidate.y - 6, w: 12, h: 12 }, staff),
      }))
      .filter(candidate => candidate.target)
      .sort((a, b) => a.target.distance - b.target.distance)[0];
    if (dirt) {
      return {
        staff: setNavigationGoal(
          { ...staff, task: { type: 'clean_floor', dirtId: dirt.dirt.id } },
          dirt.target.goal,
        ),
        claimedDirtId: dirt.dirt.id,
      };
    }
    const manualStations = (state.washStations || []).filter(station => station.type === 'manual');
    const washStationIds = new Set(manualStations.map(station => station.id));
    const activeWashStations = new Set((allStaff || state.staff || [])
      .filter(worker => worker.id !== staff.id && worker.task?.type === 'wash_item')
      .map(worker => worker.task.washStationId));
    const washItems = serviceItems
      .filter(item => item.state === 'queued_for_wash'
        && (item.washStationId == null || washStationIds.has(item.washStationId))
        && (item.assignedStaffId == null || item.assignedStaffId === staff.id)
        && !claimedServiceItemIds?.has(item.id))
      .sort((a, b) => (a.washQueuedAt ?? 0) - (b.washQueuedAt ?? 0)
        || String(a.id).localeCompare(String(b.id)));
    for (const washItem of washItems) {
      const candidateStations = washItem.washStationId == null
        ? manualStations
        : manualStations.filter(station => station.id === washItem.washStationId);
      const stationChoice = candidateStations
        .filter(station => !serviceItems.some(candidate => candidate.state === 'washing'
          && candidate.washStationId === station.id)
          && !activeWashStations.has(station.id))
        .map(station => ({ station, target: targetForRectOrCurrent(state, station, staff) }))
        .filter(candidate => candidate.target !== null)
        .sort((left, right) => left.target.distance - right.target.distance
          || String(left.station.id).localeCompare(String(right.station.id)))[0];
      if (stationChoice) {
        const { station, target } = stationChoice;
        return {
          staff: setNavigationGoal(
            { ...staff, task: { type: 'wash_item', serviceItemId: washItem.id, washStationId: station.id } },
            target.goal,
          ),
          serviceItems: serviceItems.map(item => item === washItem
            ? { ...item, washStationId: station.id, assignedStaffId: staff.id }
            : item),
          claimedServiceItemId: washItem.id,
        };
      }
    }
    return null;
  }

  if (cashierStation) {
    const paying = customers
      .filter(customer => customer.state === 'checkout_moving' && customer.paymentReady
        && (!claimedCustomerIds || !claimedCustomerIds.has(customer.id)))
      .sort((a, b) => (a.paymentQueuedAt ?? 0) - (b.paymentQueuedAt ?? 0));
    const payingCustomer = paying.find(customer => customer.cashierStationId === cashierStation.id)
      || paying.find(customer => customer.cashierStationId == null);
    const target = targetForPoint(state, getCashierWorkPosition(cashierStation), staff);

    if (payingCustomer && target) {
      return {
        staff: setNavigationGoal(
          { ...staff, task: { type: 'take_payment', customerId: payingCustomer.id, stationId: cashierStation.id } },
          target.goal,
        ),
        customers: payingCustomer.cashierStationId == null
          ? customers.map(customer => customer.id === payingCustomer.id
            ? { ...customer, cashierStationId: cashierStation.id }
            : customer)
          : customers,
        claimedCustomerId: payingCustomer.id,
      };
    }

    return target?.distance > 0
      ? { staff: setNavigationGoal(staff, target.goal) }
      : { staff: clearNavigationGoal(staff) };
  }

  if (staff.role === 'waiter') {
    if (getCarriedServiceItemIds(staff).length > 0) {
      const next = nextCarriedTask(state, staff, serviceItems, customers, tables, allStaff);
      return next
        ? { staff: setNavigationGoal({ ...staff, task: next.task }, next.goal) }
        : null;
    }

    const readyServiceItem = serviceItems.find(item => {
      if (item.state !== 'on_service'
        || claimedServiceItemIds?.has(item.id)
        || anotherWorkerOwnsItem(state.staff, staff.id, item.id)) return false;
      const customer = customers.find(candidate => candidate.id === item.customerId);
      const serviceTable = (state.serviceTables || []).find(table => table.id === item.serviceTableId);
      return customer && customer.state !== 'leaving' && serviceTable;
    });
    if (readyServiceItem) {
      const serviceTable = (state.serviceTables || []).find(table => table.id === readyServiceItem.serviceTableId);
      const target = targetForRectOrCurrent(
        state,
        getServiceTableRect(serviceTable),
        staff,
      );
      if (target) {
        return {
          staff: setNavigationGoal(
            {
              ...staff,
              task: {
                type: 'pickup_service_item',
                serviceItemId: readyServiceItem.id,
                serviceTableId: readyServiceItem.serviceTableId,
              },
            },
            target.goal,
          ),
          claimedServiceItemId: readyServiceItem.id,
        };
      }
    }

    const hasWashCapacity = selectWashStation(state, staff, serviceItems, allStaff) != null;
    const dirtyItem = hasWashCapacity ? serviceItems
      .filter(item => item.state === 'dirty_at_table' && (!claimedServiceItemIds?.has(item.id)))
      .sort((a, b) => (a.dirtyAt ?? 0) - (b.dirtyAt ?? 0))[0] : null;
    if (dirtyItem) {
      const table = tables.find(candidate => candidate.id === dirtyItem.tableId);
      const target = table ? targetForRectOrCurrent(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff) : null;
      if (target !== null) {
        return {
          staff: setNavigationGoal(
            { ...staff, task: { type: 'collect_dirty_item', serviceItemId: dirtyItem.id, tableId: dirtyItem.tableId } },
            target.goal,
          ),
          claimedServiceItemId: dirtyItem.id,
        };
      }
    }

    const orderingCustomer = customers.find(c => c.state === 'seated' && !c.dishId && !c.drinkId && (!claimedCustomerIds || !claimedCustomerIds.has(c.id)));
    const hasOrderableItem = state.dishes?.length > 0
      || state.unlockedDrinkIds?.some(drinkId => getDrink(drinkId));
    if (orderingCustomer && hasOrderableItem) {
      const table = tables.find(t => t.id === orderingCustomer.tableId);
      const target = table ? targetForTable(state, table, staff) : null;
      if (target) {
        return {
          staff: setNavigationGoal(
            { ...staff, task: { type: 'take_order', customerId: orderingCustomer.id } },
            target.goal,
          ),
          claimedCustomerId: orderingCustomer.id,
        };
      }
    }

    const dirty = tables.find(t => t.status === 'dirty'
      && isTableReadyForCleaning(t, customers, serviceItems, state.chairs)
      && (!claimedTableIds || !claimedTableIds.has(t.id)));
    if (dirty) {
      const target = targetForTableOrCurrent(state, dirty, staff);
      if (target !== null) {
        return {
          staff: setNavigationGoal(
            { ...staff, task: { type: 'clean_table', tableId: dirty.id } },
            target.goal,
          ),
          claimedTableId: dirty.id,
        };
      }
    }

    const dirtyServiceItem = serviceItems.find(item => item.state === 'to_clean'
      && (!claimedServiceItemIds || !claimedServiceItemIds.has(item.id))
      && Number.isFinite(item.x) && Number.isFinite(item.y));
    if (dirtyServiceItem) {
      const target = targetForRectOrCurrent(
        state,
        { x: dirtyServiceItem.x - 10, y: dirtyServiceItem.y - 10, w: 20, h: 20 },
        staff,
      );
      if (target) {
        return {
          staff: setNavigationGoal(
            { ...staff, task: { type: 'clean_service_item', serviceItemId: dirtyServiceItem.id } },
            target.goal,
          ),
          claimedServiceItemId: dirtyServiceItem.id,
        };
      }
    }
  }

  if (staff.role === 'cook') {
    if (getCarriedServiceItemIds(staff).length > 0) {
      const next = nextCarriedCookTask(state, staff, serviceItems);
      if (next) return { staff: setNavigationGoal({ ...staff, task: next.task }, next.goal) };
      const resumed = resumeCookingBatchTask(state, staff);
      return resumed || null;
    }

    const resumed = resumeCookingBatchTask(state, staff);
    if (resumed) return resumed;

    const activeDishTasks = (state.staff || [])
      .filter(candidate => candidate.id !== staff.id && candidate.task?.type === 'prepare_dish')
      .map(candidate => candidate.task);
    const occupiedStationIds = new Set([
      ...activeDishTasks.map(task => task.stationId),
      ...(state.serviceItems || [])
        .filter(item => item.kind === 'dish' && item.state === 'preparing')
        .map(item => item.stationId),
      ...(state.cookingBatches || [])
        .filter(batch => getCookingBatchRemainder(state, batch).length > 0)
        .map(batch => batch.stationId),
    ]);

    const preparationCandidates = (state.serviceItems || [])
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => ['dish', 'drink'].includes(item.kind)
        && item.state === 'ordered'
        && (item.kind !== 'drink'
          ? item.assignedStaffId == null && item.batchId == null
          : item.assignedStaffId == null)
        && !claimedServiceItemIds?.has(item.id))
      .sort((left, right) => {
        const leftCustomer = customers.find(customer => customer.id === left.item.customerId);
        const rightCustomer = customers.find(customer => customer.id === right.item.customerId);
        const leftOrderTime = Number.isFinite(leftCustomer?.orderTime)
          ? leftCustomer.orderTime : left.index;
        const rightOrderTime = Number.isFinite(rightCustomer?.orderTime)
          ? rightCustomer.orderTime : right.index;
        return leftOrderTime - rightOrderTime
          || left.index - right.index
          || String(left.item.id).localeCompare(String(right.item.id));
      });

    for (const { item: pending } of preparationCandidates) {
      if (pending.kind === 'drink') {
        const customer = customers.find(candidate => candidate.id === pending.customerId);
        if (!customer || customer.state === 'leaving') continue;
        const slot = findAvailableServiceSlot({ ...state, staff: allStaff, serviceItems });
        const serviceTable = slot
          ? (state.serviceTables || []).find(table => table.id === slot.serviceTableId)
          : null;
        const target = serviceTable
          ? targetForRectOrCurrent(state, getServiceTableRect(serviceTable), staff)
          : null;
        if (!slot || !target) continue;
        return {
          staff: setNavigationGoal(
            {
              ...staff,
              task: {
                type: 'prepare_drink',
                serviceItemId: pending.id,
                serviceTableId: slot.serviceTableId,
                serviceSlotIndex: slot.serviceSlotIndex,
              },
            },
            target.goal,
          ),
          serviceItems: serviceItems.map(item => item.id === pending.id
            ? {
              ...item,
              serviceTableId: slot.serviceTableId,
              serviceSlotIndex: slot.serviceSlotIndex,
              state: 'ordered',
              preparationStartedAt: null,
              assignedStaffId: staff.id,
            }
            : item),
          claimedServiceItemId: pending.id,
        };
      }

      const dish = (state.dishes || []).find(candidate => candidate.id === pending.menuItemId);
      const requiredEquipmentOwned = !dish?.requiredEquipmentId
        || (state.equipment || []).some(candidate =>
          candidate.id === dish.requiredEquipmentId && candidate.owned);
      for (const station of state.kitchenStations || []) {
        if (!dish
          || !requiredEquipmentOwned
          || (dish.requiredEquipmentId && station.equipmentId !== dish.requiredEquipmentId)
          || occupiedStationIds.has(station.id)) continue;
        const target = targetForRect(state, { x: station.x, y: station.y, w: 40, h: 40 }, staff);
        if (!target) continue;
        const batchItems = selectCookingBatchItems(
          { ...state, serviceItems },
          staff,
          station,
          pending,
          claimedServiceItemIds,
        );
        if (batchItems.length === 0) continue;
        const batchState = createCookingBatch(
          { ...state, serviceItems },
          {
            cookId: staff.id,
            stationId: station.id,
            serviceItemIds: batchItems.map(item => item.id),
          },
        );
        const batch = batchState.cookingBatches.at(-1);
        const batchIds = new Set(batchItems.map(item => item.id));
        const reservedServiceItems = serviceItems.map(item => batchIds.has(item.id)
          ? {
            ...item,
            batchId: batch.id,
            stationId: station.id,
            assignedStaffId: staff.id,
          }
          : item);
        const task = {
          type: 'prepare_dish',
          batchId: batch.id,
          serviceItemId: batchItems[0].id,
          serviceItemIds: batchItems.map(item => item.id),
          stationId: station.id,
        };
        return {
          staff: setNavigationGoal({ ...staff, task }, target.goal),
          serviceItems: reservedServiceItems,
          cookingBatches: batchState.cookingBatches,
          claimedServiceItemIds: batchItems.map(item => item.id),
        };
      }
    }
  }

  return null;
}

function canDeliverServiceItem(staff, item, customer, table) {
  return Boolean(customer
    && customer.state !== 'leaving'
    && item?.state === 'carried'
    && workerOwnsItem(staff, item.id)
    && item.customerId === customer.id
    && staff.task.serviceItemId === item.id
    && staff.task.customerId === item.customerId
    && item.tableId === customer.tableId
    && table?.id === item.tableId);
}

function hasObsoleteCustomerTask(staff, customers, tables, serviceItems, washStations = []) {
  const customer = customers.find(candidate => candidate.id === staff.task?.customerId);
  if (staff.task?.type === 'take_order') return !customer || customer.state !== 'seated';
  if (staff.task?.type === 'deliver_service_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    return !canDeliverServiceItem(staff, item, customer, table);
  }
  if (staff.task?.type === 'deliver_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const station = washStations.find(candidate => candidate.id === staff.task.washStationId);
    return !item
      || item.state !== 'carried_dirty'
      || !workerOwnsItem(staff, item.id)
      || !station;
  }
  if (staff.task?.type === 'wash_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const station = washStations.find(candidate => candidate.id === staff.task.washStationId);
    return !item
      || staff.role !== 'janitor'
      || !['queued_for_wash', 'washing'].includes(item.state)
      || item.washStationId !== station?.id
      || station?.type !== 'manual'
      || (item.assignedStaffId != null && item.assignedStaffId !== staff.id);
  }
  return false;
}

function batchTask(batch, type = 'prepare_dish', serviceItemIds = getBatchServiceItemIds(batch)) {
  const ids = serviceItemIds.filter(id => id != null);
  return {
    type,
    batchId: batch.id,
    serviceItemId: ids[0] ?? null,
    serviceItemIds: ids,
    stationId: batch.stationId,
  };
}

function resumeCookingBatchTask(state, staff) {
  const batch = getCookingBatchForCook(state, staff.id);
  if (!batch || getCookingBatchRemainder(state, batch).length === 0) return null;

  const station = (state.kitchenStations || []).find(candidate =>
    candidate.id === batch.stationId);
  const task = batchTask(batch);
  const target = station
    ? targetForRectOrCurrent(state, { x: station.x, y: station.y, w: 40, h: 40 }, staff)
    : null;
  return {
    staff: target
      ? setNavigationGoal({ ...staff, task }, target.goal)
      : clearNavigationGoal({ ...staff, task }),
    claimedServiceItemIds: getBatchServiceItemIds(batch),
  };
}

function getBatchItems(state, batch) {
  const ids = new Set(getBatchServiceItemIds(batch));
  return (state.serviceItems || []).filter(item => ids.has(item.id));
}

function allBatchItemsReady(state, batch) {
  const items = getBatchItems(state, batch);
  return items.length > 0 && items.every(item => ['ready', 'carried'].includes(item.state));
}

function reserveReadyBatchItems(state, staff, batch) {
  const remainder = getCookingBatchRemainder(state, batch);
  const ready = remainder
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.state === 'ready'
      && item.assignedStaffId === staff.id
      && item.stationId === batch.stationId)
    .sort((left, right) => (left.item.readyAt ?? 0) - (right.item.readyAt ?? 0)
      || left.index - right.index
      || String(left.item.id).localeCompare(String(right.item.id)))
    .map(({ item }) => item);
  const capacity = getCookingBatchCapacity(staff);
  let carriedIds = getCarriedServiceItemIds(staff).filter(id =>
    remainder.some(item => item.id === id));
  let serviceItems = state.serviceItems || [];
  let firstTarget = null;

  for (const item of ready) {
    if (carriedIds.length >= capacity) break;
    const slot = findAvailableServiceSlot({
      ...state,
      staff: (state.staff || []).map(worker => worker.id === staff.id
        ? withCarriedServiceItemIds(worker, carriedIds)
        : worker),
      serviceItems,
    });
    const serviceTable = slot
      ? (state.serviceTables || []).find(table => table.id === slot.serviceTableId)
      : null;
    const target = serviceTable
      ? targetForRectOrCurrent(state, getServiceTableRect(serviceTable), staff)
      : null;
    if (!slot || !serviceTable || !target) break;
    if (firstTarget == null) {
      firstTarget = { slot, target };
    }
    carriedIds = [...carriedIds, item.id];
    serviceItems = serviceItems.map(candidate => candidate.id === item.id
      ? {
        ...candidate,
        ...slot,
        state: 'carried',
        assignedStaffId: staff.id,
        x: staff.x,
        y: staff.y,
      }
      : candidate);
  }

  if (carriedIds.length === 0 || firstTarget == null) {
    const station = (state.kitchenStations || []).find(candidate => candidate.id === batch.stationId);
    const target = station ? targetForRectOrCurrent(state, station, staff) : null;
    return {
      staff: target
        ? setNavigationGoal({ ...staff, task: batchTask(batch) }, target.goal)
        : clearNavigationGoal({ ...staff, task: batchTask(batch) }),
      serviceItems,
      cookingBatches: (state.cookingBatches || []).map(candidate =>
        candidate.id === batch.id ? { ...candidate, status: 'ready' } : candidate),
    };
  }

  const firstCarriedItem = serviceItems.find(item => item.id === carriedIds[0]);
  const nextTask = {
    ...batchTask(batch, 'place_dish_on_service', carriedIds),
    serviceTableId: firstCarriedItem?.serviceTableId ?? null,
    serviceSlotIndex: firstCarriedItem?.serviceSlotIndex ?? null,
  };
  return {
    staff: setNavigationGoal(
      withCarriedServiceItemIds({ ...staff, task: nextTask }, carriedIds),
      firstTarget.target.goal,
    ),
    serviceItems,
    cookingBatches: (state.cookingBatches || []).map(candidate =>
      candidate.id === batch.id ? { ...candidate, status: 'delivering' } : candidate),
  };
}

function resolveCookingBatchTask({ state, staff, customers, queue, tables, serviceItems }) {
  const batch = getCookingBatch(state, staff.task.batchId);
  const completedStaff = clearNavigationGoal({ ...staff, task: null });
  if (!batch || staff.role !== 'cook' || batch.cookId !== staff.id) {
    const recovered = batch
      ? recoverCookingBatches(state, { batchIds: [batch.id] })
      : state;
    return {
      staff: recovered.staff?.find(worker => worker.id === staff.id) || completedStaff,
      customers, queue, tables,
      serviceItems: recovered.serviceItems || serviceItems,
      cookingBatches: recovered.cookingBatches || [],
    };
  }

  const items = getBatchItems(state, batch);
  if (items.length === 0) {
    const recovered = recoverCookingBatches(state, { batchIds: [batch.id] });
    return {
      staff: recovered.staff.find(worker => worker.id === staff.id) || completedStaff,
      customers, queue, tables,
      serviceItems: recovered.serviceItems,
      cookingBatches: recovered.cookingBatches,
    };
  }

  const station = (state.kitchenStations || []).find(candidate => candidate.id === batch.stationId);
  if (!station) {
    const recovered = recoverCookingBatches(state, { batchIds: [batch.id] });
    return {
      staff: recovered.staff.find(worker => worker.id === staff.id) || completedStaff,
      customers, queue, tables,
      serviceItems: recovered.serviceItems,
      cookingBatches: recovered.cookingBatches,
    };
  }

  if (!Number.isFinite(batch.startedAt) || items.some(item => item.state === 'ordered')) {
    const preparationStartedAt = state.restaurant.gameTime;
    const nextBatch = {
      ...batch,
      status: 'preparing',
      startedAt: Number.isFinite(batch.startedAt) ? batch.startedAt : preparationStartedAt,
    };
    const nextItems = serviceItems.map(item =>
      getBatchServiceItemIds(batch).some(id => id === item.id) && item.state === 'ordered'
        ? {
          ...item,
          state: 'preparing',
          stationId: station.id,
          assignedStaffId: staff.id,
          preparationStartedAt,
          accumulatedWork: 0,
          lastProgressAt: preparationStartedAt,
          x: station.x + 20,
          y: station.y + 20,
        }
        : item);
    return {
      staff: clearNavigationGoal({
        ...staff,
        task: {
          ...batchTask(nextBatch),
          preparationStartedAt,
        },
      }),
      customers, queue, tables,
      serviceItems: nextItems,
      cookingBatches: (state.cookingBatches || []).map(candidate =>
        candidate.id === batch.id ? nextBatch : candidate),
    };
  }

  if (!allBatchItemsReady(state, batch)) {
    return {
      staff: clearNavigationGoal({
        ...staff,
        task: { ...batchTask(batch), preparationStartedAt: batch.startedAt },
      }),
      customers, queue, tables, serviceItems,
      cookingBatches: state.cookingBatches,
    };
  }

  const delivery = reserveReadyBatchItems(state, staff, batch);
  return {
    staff: delivery.staff,
    customers, queue, tables,
    serviceItems: delivery.serviceItems,
    cookingBatches: delivery.cookingBatches,
  };
}

function resolveTask({
  state, staff, customers, queue, tables, serviceItems,
  pendingPartyReviews, partyReviewHistory, restaurant, statuses,
}) {
  const completedStaff = clearNavigationGoal({ ...staff, task: null });

  if (staff.task.type === 'prepare_dish' && staff.task.batchId != null) {
    return resolveCookingBatchTask({ state, staff, customers, queue, tables, serviceItems });
  }

  if (staff.task.type === 'take_order') {
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    if (!customer || customer.state !== 'seated') return { staff: completedStaff, customers, queue, tables, serviceItems };
    if (staff.task.startedAt == null) {
      return {
        staff: clearNavigationGoal({
          ...staff,
          task: {
            ...staff.task,
            startedAt: state.restaurant.gameTime,
            accumulatedWork: 0,
            lastProgressAt: state.restaurant.gameTime,
          },
        }),
        queue, tables, serviceItems, customers,
      };
    }
    const orderProgress = advanceStaffTaskProgress(
      staff.task,
      state.restaurant.gameTime,
      getStaffTaskRate(state, staff),
      staff.task.startedAt,
    );
    const progressedStaff = { ...staff, task: orderProgress.task };
    if (orderProgress.accumulatedWork < ACTIVITY_DURATIONS.takeOrder) {
      return { staff: clearNavigationGoal(progressedStaff), queue, tables, serviceItems, customers };
    }
    const ordered = createCustomerOrder(
      { ...state, serviceItems },
      customer,
    );
    const partyMembers = customers.filter(candidate =>
      getPartyKey(candidate) === getPartyKey(customer));
    const nextPending = recordPartyOrderOutcome(
      pendingPartyReviews,
      partyMembers,
      ordered.customer,
      ordered.customer.menuOutcome,
    );
    const settlement = settlePartyReview({
      pendingPartyReviews: nextPending,
      partyReviewHistory,
      restaurant,
      upgrades: state.upgrades,
    }, getPartyKey(customer));
    let updatedCustomers = customers.map(candidate => candidate.id === customer.id
      ? ordered.customer
      : candidate);
    if (settlement.review) {
      updatedCustomers = updatedCustomers.map(candidate =>
        getPartyKey(candidate) === getPartyKey(customer)
          && candidate.state === 'waiting_for_party'
          ? leavingFields({ ...candidate, departureReason: 'menu_unaffordable' })
          : candidate);
    }
    return {
      staff: completedStaff,
      queue,
      tables,
      serviceItems: ordered.serviceItems,
      customers: updatedCustomers,
      pendingPartyReviews: settlement.pendingPartyReviews,
      partyReviewHistory: settlement.partyReviewHistory,
      restaurant: settlement.restaurant,
    };
  }

  if (staff.task.type === 'take_payment') {
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    const station = (state.cashierStations || []).find(candidate => candidate.id === staff.task.stationId);
    if (!customer) return { staff: completedStaff, customers, queue, tables, serviceItems };
    const validPhase = ['checkout_moving', 'checkout_processing'].includes(customer.state);
    const alreadyCompleted = (state.completedCustomers || [])
      .some(payment => payment?.customerId === customer.id);
    if (alreadyCompleted && validPhase) {
      const updatedCustomers = customers.map(candidate => candidate.id === customer.id
        ? leavingFields({ ...candidate, departureReason: 'served' }, {
            checkoutDeparture: checkoutDepartureFor(candidate, station),
          })
        : candidate);
      const recovered = recoverCarriedItemsForCustomer(serviceItems, customer.id);
      return {
        staff: completedStaff,
        queue,
        customers: updatedCustomers,
        serviceItems: recovered.recoveredItems.filter(item => item.customerId !== customer.id
          || !['ordered', 'preparing'].includes(item.state)),
        clearCarriedServiceItemIds: recovered.carriedIds,
        tables,
        completedCustomers: state.completedCustomers,
      };
    }
    const validStation = station?.assignedStaffId === staff.id && customer.cashierStationId === station.id;
    if (!validPhase || !validStation) {
      return {
        staff: completedStaff,
        customers: customers.map(candidate => candidate.id === customer.id && validPhase
          ? requeueCheckoutCustomer(candidate)
          : candidate),
        queue, tables, serviceItems,
      };
    }
    const cashierArrived = station
      && Math.hypot(staff.x - getCashierWorkPosition(station).x, staff.y - getCashierWorkPosition(station).y) <= 2;
    const customerPosition = station ? getCashierCustomerPosition(station, 0) : null;
    const customerArrived = customerPosition && Math.hypot(customer.x - customerPosition.x, customer.y - customerPosition.y) <= 2;
    const readyToStart = customer.state === 'checkout_moving' && customer.paymentReady;
    if (!cashierArrived || !customerArrived || (staff.task.startedAt == null && !readyToStart)) {
      return {
        staff: completedStaff,
        customers: customers.map(candidate => candidate.id === customer.id
          ? requeueCheckoutCustomer(candidate)
          : candidate),
        queue, tables, serviceItems,
      };
    }
    if (staff.task.startedAt == null) {
      return {
        staff: clearNavigationGoal({
          ...staff,
          task: {
            ...staff.task,
            startedAt: state.restaurant.gameTime,
            accumulatedWork: 0,
            lastProgressAt: state.restaurant.gameTime,
          },
        }),
        customers: customers.map(candidate => candidate.id === customer.id
          ? {
              ...candidate,
              state: 'checkout_processing',
              checkoutLineMember: false,
              checkoutLineGeometry: null,
              paymentReady: false,
            }
          : candidate),
        queue, tables, serviceItems,
      };
    }
    const paymentProgress = advanceStaffTaskProgress(
      staff.task,
      state.restaurant.gameTime,
      getStaffTaskRate(state, staff),
      staff.task.startedAt,
    );
    const progressedStaff = { ...staff, task: paymentProgress.task };
    if (paymentProgress.accumulatedWork < ACTIVITY_DURATIONS.takePayment) {
      return { staff: clearNavigationGoal(progressedStaff), customers, queue, tables, serviceItems };
    }
    const legacyDishPrice = (state.dishes || []).find(candidate => candidate.id === customer.dishId)?.price || 0;
    const legacyDrinkPrice = getResolvedDrink(state, customer.drinkId)?.price || 0;
    const snapshotSubtotal = getOrderSnapshotSubtotal(customer);
    const price = snapshotSubtotal ?? legacyDishPrice + legacyDrinkPrice;
    const tip = Math.round(price * getTipRate() * 100) / 100;
    const reviewScore = PAID_REVIEW_SCORE;
    const payment = {
      customerId: customer.id,
      day: state.restaurant.day || Math.floor(state.restaurant.gameTime / 86400) + 1,
      dishId: customer.dishId,
      drinkId: customer.drinkId,
      revenue: price + tip,
      tip,
      totalPaid: price + tip,
      reviewScore,
    };
    const partyId = getPartyKey(customer);
    const hasPendingTracker = Array.isArray(pendingPartyReviews)
      && pendingPartyReviews.some(record => record?.partyId === partyId);
    const hasExplicitMenuOutcome = ['ordered', 'unaffordable'].includes(customer.menuOutcome);
    let nextPendingPartyReviews = pendingPartyReviews;
    let nextPartyReviewHistory = partyReviewHistory;
    let nextRestaurant = restaurant;
    let settledReview = null;
    if (customer.menuOutcome === 'ordered' && hasPendingTracker) {
      const paymentRecorded = recordPartyPayment(pendingPartyReviews, customer);
      const settlement = settlePartyReview({
        pendingPartyReviews: paymentRecorded,
        partyReviewHistory,
        restaurant,
        upgrades: state.upgrades,
      }, partyId);
      nextPendingPartyReviews = settlement.pendingPartyReviews;
      nextPartyReviewHistory = settlement.partyReviewHistory;
      nextRestaurant = settlement.restaurant;
      settledReview = settlement.review;
    } else if (!hasPendingTracker && !hasExplicitMenuOutcome) {
      const reputationGainEffect = getUpgradeEffect(state, 'reputationGain');
      const reputationGain = (PAID_REVIEW_SCORE / 5000) * (1 + reputationGainEffect);
      nextRestaurant = {
        ...restaurant,
        reputation: clampReputation(restaurant.reputation + reputationGain),
      };
    }
    let updatedCustomers = customers.map(candidate => candidate.id === customer.id
      ? leavingFields({ ...candidate, departureReason: 'served' }, {
          checkoutDeparture: checkoutDepartureFor(candidate, station),
        })
      : candidate);
    if (settledReview) {
      updatedCustomers = updatedCustomers.map(candidate =>
        getPartyKey(candidate) === partyId && candidate.state === 'waiting_for_party'
          ? leavingFields({ ...candidate, departureReason: 'menu_unaffordable' })
          : candidate);
    }
    const recovered = recoverCarriedItemsForCustomer(serviceItems, customer.id);
    return {
      staff: completedStaff, queue,
      customers: updatedCustomers,
      serviceItems: recovered.recoveredItems.filter(item => item.customerId !== customer.id
        || !['ordered', 'preparing'].includes(item.state)),
      clearCarriedServiceItemIds: recovered.carriedIds,
      tables,
      completedCustomers: [...(state.completedCustomers || []), payment],
      restaurant: {
        ...nextRestaurant,
        totalServed: (nextRestaurant.totalServed || 0) + 1,
      },
      pendingPartyReviews: nextPendingPartyReviews,
      partyReviewHistory: nextPartyReviewHistory,
    };
  }

  if (staff.task.type === 'clean_table') {
    const table = tables.find(candidate => candidate.id === staff.task.tableId);
    if (!table || table.status !== 'dirty') {
      return { staff: completedStaff, queue, customers, serviceItems, tables };
    }
    if (!isTableReadyForCleaning(table, customers, serviceItems, state.chairs)) {
      return { staff: completedStaff, queue, customers, serviceItems, tables };
    }
    if (staff.task.cleaningStartedAt == null) {
      return {
        staff: clearNavigationGoal({
          ...staff,
          task: {
            ...staff.task,
            cleaningStartedAt: state.restaurant.gameTime,
            accumulatedWork: 0,
            lastProgressAt: state.restaurant.gameTime,
          },
        }),
        tables, customers, queue, serviceItems,
      };
    }
    const tableCleaningProgress = advanceStaffTaskProgress(
      staff.task,
      state.restaurant.gameTime,
      getStaffTaskRate(state, staff),
      staff.task.cleaningStartedAt,
    );
    const progressedStaff = { ...staff, task: tableCleaningProgress.task };
    if (tableCleaningProgress.accumulatedWork < ACTIVITY_DURATIONS.wipeFloor) {
      return { staff: clearNavigationGoal(progressedStaff), queue, customers, serviceItems, tables };
    }
    return {
      staff: completedStaff, queue, customers, serviceItems,
      tables: tables.map(t => t.id === staff.task.tableId
        ? clearDiningOwnership(t, 'empty') : t),
    };
  }

  if (staff.task.type === 'clean_floor') {
    const dirt = (state.floorDirt || []).find(candidate => candidate.id === staff.task.dirtId);
    if (!dirt) return { staff: completedStaff, queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [] };
    if (staff.task.cleaningStartedAt == null) {
      return {
        staff: clearNavigationGoal({
          ...staff,
          task: {
            ...staff.task,
            cleaningStartedAt: state.restaurant.gameTime,
            accumulatedWork: 0,
            lastProgressAt: state.restaurant.gameTime,
          },
        }),
        queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [],
      };
    }
    const floorCleaningProgress = advanceStaffTaskProgress(
      staff.task,
      state.restaurant.gameTime,
      getStaffTaskRate(state, staff),
      staff.task.cleaningStartedAt,
    );
    const progressedStaff = { ...staff, task: floorCleaningProgress.task };
    if (floorCleaningProgress.accumulatedWork < ACTIVITY_DURATIONS.wipeFloor) {
      return { staff: clearNavigationGoal(progressedStaff), queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [] };
    }
    return {
      staff: completedStaff, queue, customers, tables, serviceItems,
      floorDirt: (state.floorDirt || []).filter(candidate => candidate.id !== dirt.id),
    };
  }

  if (staff.task.type === 'pickup_service_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const serviceTable = item
      ? (state.serviceTables || []).find(candidate => candidate.id === item.serviceTableId)
      : null;
    const customer = item
      ? customers.find(candidate => candidate.id === item.customerId)
      : null;
    const anotherWorkerOwnsAnchor = item && anotherWorkerOwnsItem(state.staff, staff.id, item.id);
    const carriesAnotherItem = getCarriedServiceItemIds(staff).length > 0;
    const canPickUp = item
      && item.state === 'on_service'
      && staff.task.serviceTableId === item.serviceTableId
      && customer
      && customer.state !== 'leaving'
      && serviceTable
      && !anotherWorkerOwnsAnchor
      && !carriesAnotherItem;
    if (!canPickUp) {
      return {
        staff: withCarriedServiceItemIds(completedStaff, getCarriedServiceItemIds(staff)),
        queue, tables, customers, serviceItems,
      };
    }
    const capacity = getStaffCarryCapacity(staff);
    const candidates = serviceItems
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.state === 'on_service'
        && candidate.serviceTableId === serviceTable.id
        && ['dish', 'drink'].includes(candidate.kind)
        && customers.some(owner => owner.id === candidate.customerId && owner.state !== 'leaving')
        && !anotherWorkerOwnsItem(state.staff, staff.id, candidate.id))
      .sort((left, right) => left.index - right.index);
    const pickedIds = [];
    for (const { candidate } of candidates) {
      if (pickedIds.length >= capacity) break;
      pickedIds.push(candidate.id);
    }
    if (!pickedIds.includes(item.id)) {
      return {
        staff: withCarriedServiceItemIds(completedStaff, []),
        queue, tables, customers, serviceItems,
      };
    }
    const picked = new Set(pickedIds);
    const nextServiceItems = serviceItems.map(candidate => picked.has(candidate.id)
      ? { ...candidate, state: 'carried', x: staff.x, y: staff.y }
      : candidate);
    const nextStaff = withCarriedServiceItemIds(completedStaff, pickedIds);
    return {
      staff: continueCarriedTask(
        { ...state, staff: state.staff || [] },
        nextStaff,
        nextServiceItems,
        customers,
        tables,
        state.staff,
      ),
      queue, tables, customers,
      serviceItems: nextServiceItems,
    };
  }

  if (staff.task.type === 'place_dish_on_service') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const customer = customers.find(candidate => candidate.id === item?.customerId);
    const serviceTable = (state.serviceTables || []).find(candidate =>
      candidate.id === staff.task.serviceTableId);
    const ownsItem = item?.state === 'carried'
      && item.kind === 'dish'
      && staff.role === 'cook'
      && workerOwnsItem(staff, item.id)
      && item.assignedStaffId === staff.id
      && item.serviceTableId === staff.task.serviceTableId
      && item.serviceSlotIndex === staff.task.serviceSlotIndex
      && (staff.task.batchId == null || item.batchId === staff.task.batchId);
    const validDelivery = ownsItem && customer?.state !== 'leaving' && serviceTable;
    if (!validDelivery) {
      const carriedIds = getCarriedServiceItemIds(staff);
      const nextCarriedIds = ownsItem
        ? carriedIds.filter(id => id !== item.id)
        : carriedIds;
      const nextServiceItems = serviceItems.map(candidate => ownsItem && candidate.id === item.id
        ? { ...candidate, state: 'to_clean', assignedStaffId: null }
        : candidate);
      const nextStaff = withCarriedServiceItemIds(completedStaff, nextCarriedIds);
      if (staff.task.batchId != null && ownsItem) {
        const batchState = completeCookingBatchItem({
          ...state, serviceItems: nextServiceItems,
        }, staff.task.batchId, staff.task.serviceItemId);
        const batch = getCookingBatch(batchState, staff.task.batchId);
        const continuation = batch
          ? { ...nextStaff, task: batchTask(batch) }
          : nextStaff;
        const routed = continueCarriedCookTask(
          {
            ...batchState,
            staff: (batchState.staff || []).map(worker => worker.id === staff.id
              ? continuation : worker),
          },
          continuation,
          batchState.serviceItems,
        );
        return {
          staff: routed,
          queue, tables, customers,
          serviceItems: batchState.serviceItems,
          cookingBatches: batchState.cookingBatches,
        };
      }
      return {
        staff: continueCarriedCookTask(
          state,
          withCarriedServiceItemIds(completedStaff, nextCarriedIds),
          nextServiceItems,
        ),
        queue, tables, customers,
        serviceItems: nextServiceItems,
      };
    }

    const target = targetForRectOrCurrent(state, getServiceTableRect(serviceTable), staff);
    if (target === null) {
      return { staff: clearNavigationGoal(staff), queue, tables, customers, serviceItems };
    }
    if (target.distance > 0) {
      return { staff: setNavigationGoal(staff, target.goal), queue, tables, customers, serviceItems };
    }

    const position = getServiceSlotPosition(serviceTable, item.serviceSlotIndex);
    const nextCarriedIds = getCarriedServiceItemIds(staff).filter(id => id !== item.id);
    const nextServiceItems = serviceItems.map(candidate => candidate.id === item.id
      ? { ...candidate, state: 'on_service', assignedStaffId: null, ...position }
      : candidate);
    const nextStaff = withCarriedServiceItemIds(completedStaff, nextCarriedIds);
    if (staff.task.batchId != null) {
      const batchState = completeCookingBatchItem({
        ...state, serviceItems: nextServiceItems,
      }, staff.task.batchId, item.id);
      const batch = getCookingBatch(batchState, staff.task.batchId);
      const continuation = batch
        ? { ...nextStaff, task: batchTask(batch) }
        : nextStaff;
      const routed = continueCarriedCookTask(
        {
          ...batchState,
          staff: (batchState.staff || []).map(worker => worker.id === staff.id
            ? continuation : worker),
        },
        continuation,
        batchState.serviceItems,
      );
      return {
        staff: routed,
        queue, tables, customers,
        serviceItems: batchState.serviceItems,
        cookingBatches: batchState.cookingBatches,
      };
    }
    return {
      staff: continueCarriedCookTask(state, nextStaff, nextServiceItems),
      queue, tables, customers,
      serviceItems: nextServiceItems,
    };
  }

  if (staff.task.type === 'collect_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    const carriedIds = getCarriedServiceItemIds(staff);
    if (!item || item.state !== 'dirty_at_table' || !table || carriedIds.length > 0) {
      return { staff: withCarriedServiceItemIds(completedStaff, carriedIds), queue, tables, customers, serviceItems };
    }
    const target = targetForRectOrCurrent(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff);
    if (target === null) {
      return { staff: withCarriedServiceItemIds(completedStaff, carriedIds), queue, tables, customers, serviceItems };
    }
    if (target.distance > 0) {
      return { staff: setNavigationGoal(staff, target.goal), queue, tables, customers, serviceItems };
    }
    const capacity = getStaffCarryCapacity(staff);
    const candidates = serviceItems
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.state === 'dirty_at_table'
        && candidate.tableId === table.id
        && !anotherWorkerOwnsItem(state.staff, staff.id, candidate.id))
      .sort((left, right) => (left.candidate.dirtyAt ?? 0) - (right.candidate.dirtyAt ?? 0)
        || left.index - right.index
        || String(left.candidate.id).localeCompare(String(right.candidate.id)));
    const pickedIds = candidates.slice(0, capacity).map(({ candidate }) => candidate.id);
    if (!pickedIds.includes(item.id)) {
      return { staff: withCarriedServiceItemIds(completedStaff, []), queue, tables, customers, serviceItems };
    }
    const picked = new Set(pickedIds);
    const carriedItems = serviceItems.map(candidate => picked.has(candidate.id)
      ? { ...candidate, state: 'carried_dirty', x: staff.x, y: staff.y }
      : candidate);
    const nextStaff = withCarriedServiceItemIds(completedStaff, pickedIds);
    const routedStaff = continueCarriedTask(
      { ...state, staff: state.staff || [] },
      nextStaff,
      carriedItems,
      customers,
      tables,
      state.staff,
    );
    return {
      staff: routedStaff,
      queue, customers,
      tables,
      serviceItems: carriedItems,
    };
  }

  if (staff.task.type === 'deliver_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const station = (state.washStations || []).find(candidate => candidate.id === staff.task.washStationId);
    const carriedIds = getCarriedServiceItemIds(staff);
    const taskItemId = staff.task.serviceItemId;
    const ownsTaskItem = item?.state === 'carried_dirty' && workerOwnsItem(staff, taskItemId);
    const anotherWorkerOwnsTaskItem = anotherWorkerOwnsItem(state.staff, staff.id, taskItemId);
    if (!item || !ownsTaskItem) {
      const nextIds = anotherWorkerOwnsTaskItem
        ? carriedIds
        : carriedIds.filter(id => id !== taskItemId);
      const nextStaff = withCarriedServiceItemIds(completedStaff, nextIds);
      const nextAllStaff = (state.staff || []).map(worker => worker.id === staff.id
        ? nextStaff
        : worker);
      return {
        staff: continueCarriedTask(
          { ...state, staff: nextAllStaff },
          nextStaff,
          serviceItems,
          customers,
          tables,
          nextAllStaff,
        ),
        queue, tables, customers, serviceItems,
      };
    }
    if (!station) {
      return {
        staff: continueCarriedTask(state, withCarriedServiceItemIds(completedStaff, carriedIds), serviceItems, customers, tables, state.staff),
        queue, tables, customers, serviceItems,
      };
    }
    const target = targetForRectOrCurrent(state, station, staff);
    if (target === null) {
      return {
        staff: continueCarriedTask(state, withCarriedServiceItemIds(completedStaff, carriedIds), serviceItems, customers, tables, state.staff),
        queue, tables, customers, serviceItems,
      };
    }
    if (target.distance > 0) {
      return { staff: setNavigationGoal(staff, target.goal), queue, tables, customers, serviceItems };
    }

    const carriedDirtyIds = carriedIds.filter(id => serviceItems.some(candidate =>
      candidate.id === id && candidate.state === 'carried_dirty'));
    const occupied = getWashStationOccupancy(state, station, {
      excludeServiceItemIds: carriedDirtyIds,
    });
    const available = Math.max(0, getWashStationCapacity(station) - occupied);
    if (available === 0) {
      return {
        staff: continueCarriedTask(state, withCarriedServiceItemIds(completedStaff, carriedIds), serviceItems, customers, tables, state.staff),
        queue, tables, customers, serviceItems,
      };
    }

    const depositedIds = carriedDirtyIds.slice(0, available);
    const deposited = new Set(depositedIds);
    const nextServiceItems = serviceItems.map(candidate => deposited.has(candidate.id)
      ? {
        ...candidate,
        state: 'queued_for_wash',
        washStationId: station.id,
        washQueuedAt: state.restaurant.gameTime,
      }
      : candidate);
    const nextStaff = withCarriedServiceItemIds(
      completedStaff,
      carriedIds.filter(id => !deposited.has(id)),
    );
    return {
      staff: continueCarriedTask(
        { ...state, staff: state.staff || [] },
        nextStaff,
        nextServiceItems,
        customers,
        tables,
        state.staff,
      ),
      queue, tables, customers,
      serviceItems: nextServiceItems,
    };
  }

  if (staff.task.type === 'wash_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const station = (state.washStations || []).find(candidate => candidate.id === staff.task.washStationId && candidate.type === 'manual');
    const ownsManualWash = staff.role === 'janitor'
      && (item?.assignedStaffId == null || item.assignedStaffId === staff.id)
      && item?.washStationId === station?.id
      && staff.task.washStationId === item?.washStationId;
    if (!item || !['queued_for_wash', 'washing'].includes(item.state) || !ownsManualWash) {
      return { staff: completedStaff, queue, tables, customers, serviceItems };
    }
    if (staff.task.washingStartedAt == null) {
      const itemIndex = serviceItems.indexOf(item);
      const washingStartedAt = Number.isFinite(item.washStartedAt)
        ? item.washStartedAt : state.restaurant.gameTime;
      const startedNewWash = !Number.isFinite(item.washStartedAt);
      return {
        staff: clearNavigationGoal({
          ...staff,
          task: {
            ...staff.task,
            washingStartedAt,
            ...(startedNewWash ? {
              accumulatedWork: 0,
              lastProgressAt: washingStartedAt,
            } : {}),
          },
        }),
        queue, tables, customers,
        serviceItems: serviceItems.map((candidate, index) => index === itemIndex
          ? {
            ...candidate,
            state: 'washing',
            washStartedAt: washingStartedAt,
            ...(startedNewWash ? {
              accumulatedWork: 0,
              lastProgressAt: washingStartedAt,
            } : {}),
            assignedStaffId: staff.id,
          }
          : candidate),
      };
    }
    const washingProgressSource = getStaffTaskSource(state, staff);
    const washingProgress = advanceStaffTaskProgress(
      washingProgressSource,
      state.restaurant.gameTime,
      getStaffTaskRate(state, staff),
      item.washStartedAt ?? staff.task.washingStartedAt,
    );
    const progressedStaff = {
      ...staff,
      task: {
        ...staff.task,
        accumulatedWork: washingProgress.accumulatedWork,
        lastProgressAt: washingProgress.lastProgressAt,
      },
    };
    if (washingProgress.accumulatedWork < ACTIVITY_DURATIONS.manualWash) {
      return {
        staff: clearNavigationGoal(progressedStaff),
        queue, tables, customers,
        serviceItems: serviceItems.map(candidate => candidate.id === item.id
          ? {
            ...candidate,
            accumulatedWork: washingProgress.accumulatedWork,
            lastProgressAt: washingProgress.lastProgressAt,
            assignedStaffId: staff.id,
          }
          : candidate),
      };
    }
    const itemIndex = serviceItems.indexOf(item);
    return { staff: completedStaff, queue, tables, customers, serviceItems: serviceItems.filter((_candidate, index) => index !== itemIndex) };
  }

  if (staff.task.type === 'deliver_service_item') {
    const itemIndex = serviceItems.findIndex(candidate => candidate.id === staff.task.serviceItemId);
    const item = serviceItems[itemIndex];
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    if (!canDeliverServiceItem(staff, item, customer, table)) {
      const carriedIds = getCarriedServiceItemIds(staff);
      const ownsTaskItem = workerOwnsItem(staff, staff.task.serviceItemId);
      const anotherWorkerOwnsTaskItem = anotherWorkerOwnsItem(
        state.staff,
        staff.id,
        staff.task.serviceItemId,
      );
      const nextCarriedIds = ownsTaskItem
        ? carriedIds.filter(id => id !== staff.task.serviceItemId)
        : carriedIds;
      const nextStaff = withCarriedServiceItemIds(completedStaff, nextCarriedIds);
      const nextServiceItems = serviceItems.map(candidate => ownsTaskItem
        && !anotherWorkerOwnsTaskItem
        && candidate.id === staff.task.serviceItemId
        && candidate.state === 'carried'
        ? { ...candidate, state: 'to_clean', assignedStaffId: null }
        : candidate);
      return {
        staff: continueCarriedTask(
          { ...state, staff: state.staff || [] },
          nextStaff,
          nextServiceItems,
          customers,
          tables,
          state.staff,
        ),
        customers, queue, tables,
        serviceItems: nextServiceItems,
      };
    }
    const dish = item.kind === 'dish'
      ? (state.dishes || []).find(candidate => candidate.id === item.menuItemId)
      : null;
    const equipment = dish?.requiredEquipmentId
      ? state.equipment?.find(candidate => candidate.id === dish.requiredEquipmentId)
      : null;
    const happinessBonus = Math.round(
      ((dish?.quality ?? 1) - 1) * 2
      + getUpgradeEffect(state, 'qualityBonus') * 100
      + (equipment?.qualityBonus || 0) * 100
    );
    const deliveredPosition = item.kind === 'drink'
      ? { x: table.x + 24, y: table.y + 8 }
      : { x: table.x + 8, y: table.y + 8 };
    const deliveredServiceItems = serviceItems.map((candidate, index) => index === itemIndex
      ? { ...candidate, state: 'delivered', ...deliveredPosition }
      : candidate);
    const happiness = item.kind === 'dish'
      ? Math.min(100, (customer.happiness ?? 80) + happinessBonus)
      : customer.happiness;
    const deliveredCustomer = item.kind === 'dish'
      ? { ...customer, happiness }
      : customer;
    const started = allOrderedItemsDelivered(deliveredCustomer, deliveredServiceItems)
      ? startCustomerConsumption(deliveredCustomer, deliveredServiceItems, state.restaurant.gameTime)
      : null;
    const nextCarriedIds = getCarriedServiceItemIds(staff).filter(id => id !== item.id);
    const nextStaff = withCarriedServiceItemIds(completedStaff, nextCarriedIds);
    const nextServiceItems = started?.serviceItems ?? deliveredServiceItems;
    return {
      staff: continueCarriedTask(
        { ...state, staff: state.staff || [] },
        nextStaff,
        nextServiceItems,
        customers.map(candidate => candidate.id === customer.id
          ? started?.customer ?? deliveredCustomer
          : candidate),
        tables,
        state.staff,
      ),
      queue, tables, serviceItems: started?.serviceItems ?? deliveredServiceItems,
      customers: customers.map(candidate => candidate.id === customer.id
        ? started?.customer ?? deliveredCustomer
        : candidate),
    };
  }

  if (staff.task.type === 'clean_service_item') {
    return {
      staff: completedStaff, queue, tables, customers,
      serviceItems: serviceItems.filter(item => item.id !== staff.task.serviceItemId),
    };
  }

  if (staff.task.type === 'prepare_drink') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const serviceTable = (state.serviceTables || []).find(candidate =>
      candidate.id === staff.task.serviceTableId);
    const validReservation = staff.role === 'cook'
      && staff.id != null
      && item
      && item.kind === 'drink'
      && ['ordered', 'preparing'].includes(item.state)
      && item.assignedStaffId === staff.id
      && staff.task.serviceItemId === item.id
      && staff.task.serviceTableId === item.serviceTableId
      && staff.task.serviceSlotIndex === item.serviceSlotIndex
      && Number.isInteger(item.serviceSlotIndex)
      && item.serviceSlotIndex >= 0
      && item.serviceSlotIndex < 4
      && serviceTable;

    if (!validReservation) {
      return {
        staff: completedStaff,
        customers, queue, tables,
        serviceItems: item?.assignedStaffId === staff.id
          ? clearDrinkReservation(serviceItems, staff.task.serviceItemId)
          : serviceItems,
      };
    }

    if (item.state === 'ordered') {
      const preparationStartedAt = state.restaurant.gameTime;
      return {
        staff: clearNavigationGoal({
          ...staff,
          task: {
            ...staff.task,
            preparationStartedAt,
            accumulatedWork: 0,
            lastProgressAt: preparationStartedAt,
          },
        }),
        customers, queue, tables,
        serviceItems: serviceItems.map(candidate => candidate.id === item.id
          ? {
            ...candidate,
            state: 'preparing',
            preparationStartedAt,
            accumulatedWork: 0,
            lastProgressAt: preparationStartedAt,
          }
          : candidate),
      };
    }

    const drinkProgressSource = getStaffTaskSource(state, staff);
    const drinkProgress = advanceStaffTaskProgress(
      drinkProgressSource,
      state.restaurant.gameTime,
      getStaffTaskRate(state, staff),
      item.preparationStartedAt,
    );
    const progressedStaff = {
      ...staff,
      task: {
        ...staff.task,
        preparationStartedAt: item.preparationStartedAt,
        accumulatedWork: drinkProgress.accumulatedWork,
        lastProgressAt: drinkProgress.lastProgressAt,
      },
    };
    if (drinkProgress.accumulatedWork < ACTIVITY_DURATIONS.prepareDrink) {
      return {
        staff: clearNavigationGoal(progressedStaff),
        customers, queue, tables,
        serviceItems: serviceItems.map(candidate => candidate.id === item.id
          ? {
            ...candidate,
            accumulatedWork: drinkProgress.accumulatedWork,
            lastProgressAt: drinkProgress.lastProgressAt,
          }
          : candidate),
      };
    }

    const position = getServiceSlotPosition(serviceTable, item.serviceSlotIndex);
    return {
      staff: completedStaff,
      customers, queue, tables,
      serviceItems: serviceItems.map(candidate => candidate.id === item.id
        ? {
          ...candidate,
          state: 'on_service',
          x: position.x,
          y: position.y,
          assignedStaffId: null,
        }
        : candidate),
    };
  }

  if (staff.task.type === 'prepare_dish') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const dish = item
      ? (state.dishes || []).find(candidate => candidate.id === item.menuItemId)
      : null;
    const station = (state.kitchenStations || []).find(candidate =>
      candidate.id === staff.task.stationId);
    const requiredEquipmentOwned = !dish?.requiredEquipmentId
      || (state.equipment || []).some(candidate =>
        candidate.id === dish.requiredEquipmentId && candidate.owned);
    const anotherWorkerOwnsPreparedDish = (state.staff || []).some(candidate =>
      candidate.id !== staff.id
      && candidate.task?.type === 'prepare_dish'
      && candidate.task.serviceItemId === staff.task.serviceItemId);
    const anotherWorkerOwnsStation = (state.staff || []).some(candidate =>
      candidate.id !== staff.id
      && candidate.task?.type === 'prepare_dish'
      && candidate.task.stationId === staff.task.stationId);
    const validReadyDish = item?.state === 'ready'
      && item.kind === 'dish'
      && staff.role === 'cook'
      && item.assignedStaffId === staff.id
      && item.stationId === staff.task.stationId
      && dish
      && station
      && requiredEquipmentOwned
      && (!dish.requiredEquipmentId || station.equipmentId === dish.requiredEquipmentId)
      && !anotherWorkerOwnsPreparedDish
      && !anotherWorkerOwnsStation;
    if (validReadyDish) {
      const firstSlot = findAvailableServiceSlot(state);
      const firstServiceTable = firstSlot
        ? (state.serviceTables || []).find(candidate => candidate.id === firstSlot.serviceTableId)
        : null;
      const target = firstServiceTable
        ? targetForRectOrCurrent(state, getServiceTableRect(firstServiceTable), staff)
        : null;
      if (!firstSlot || !firstServiceTable || target === null) {
        return { staff: clearNavigationGoal(staff), queue, tables, customers, serviceItems };
      }

      const capacity = getStaffCarryCapacity(staff);
      const readyCandidates = serviceItems
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => {
          const candidateDish = (state.dishes || []).find(dishCandidate =>
            dishCandidate.id === candidate.menuItemId);
          const candidateCustomer = customers.find(customer =>
            customer.id === candidate.customerId);
          return candidate.id !== item.id
            && candidate.kind === 'dish'
            && candidate.state === 'ready'
            && candidate.assignedStaffId === staff.id
            && candidate.stationId === staff.task.stationId
            && candidateDish
            && candidateCustomer
            && candidateCustomer.state !== 'leaving'
            && !anotherWorkerOwnsItem(state.staff, staff.id, candidate.id);
        })
        .sort((left, right) => (left.candidate.readyAt ?? 0) - (right.candidate.readyAt ?? 0)
          || left.index - right.index
          || String(left.candidate.id).localeCompare(String(right.candidate.id)));

      let carriedIds = [item.id];
      let nextServiceItems = serviceItems.map(candidate => candidate.id === item.id
        ? {
          ...candidate,
          ...firstSlot,
          state: 'carried',
          assignedStaffId: staff.id,
          x: staff.x,
          y: staff.y,
        }
        : candidate);
      for (const { candidate } of readyCandidates) {
        if (carriedIds.length >= capacity) break;
        const slot = findAvailableServiceSlot({
          ...state,
          staff: (state.staff || []).map(worker => worker.id === staff.id
            ? withCarriedServiceItemIds(worker, carriedIds)
            : worker),
          serviceItems: nextServiceItems,
        });
        if (!slot) break;
        carriedIds = [...carriedIds, candidate.id];
        nextServiceItems = nextServiceItems.map(serviceItem => serviceItem.id === candidate.id
          ? {
            ...serviceItem,
            ...slot,
            state: 'carried',
            assignedStaffId: staff.id,
            x: staff.x,
            y: staff.y,
          }
          : serviceItem);
      }
      return {
        staff: setNavigationGoal(
          {
            ...withCarriedServiceItemIds(staff, carriedIds),
            task: {
              type: 'place_dish_on_service',
              serviceItemId: item.id,
              serviceTableId: firstSlot.serviceTableId,
              serviceSlotIndex: firstSlot.serviceSlotIndex,
            },
          },
          target.goal,
        ),
        queue, tables, customers,
        serviceItems: nextServiceItems,
      };
    }
    const validAssignment = item?.kind === 'dish'
      && staff.role === 'cook'
      && ['ordered', 'preparing'].includes(item.state)
      && (item.state === 'ordered'
        ? item.assignedStaffId == null || item.assignedStaffId === staff.id
        : item.assignedStaffId === staff.id && item.stationId === staff.task.stationId)
      && dish
      && station
      && requiredEquipmentOwned
      && (!dish.requiredEquipmentId || station.equipmentId === dish.requiredEquipmentId)
      && !anotherWorkerOwnsPreparedDish
      && !anotherWorkerOwnsStation;

    if (!validAssignment) {
      return { staff: completedStaff, queue, tables, customers, serviceItems };
    }
    return {
      staff: clearNavigationGoal(staff), queue, tables, customers,
      serviceItems: serviceItems.map(candidate => item.state === 'ordered' && candidate.id === item.id
        ? {
          ...candidate,
          state: 'preparing',
          stationId: staff.task.stationId,
          assignedStaffId: staff.id,
          preparationStartedAt: state.restaurant.gameTime,
          accumulatedWork: 0,
          lastProgressAt: state.restaurant.gameTime,
          x: station.x + 20,
          y: station.y + 20,
        }
        : candidate),
    };
  }

  return { staff: completedStaff, customers, queue, tables, serviceItems };
}

export function prepareStaffForMovement(state, gameDt) {
  gameDt = Math.max(0, Number(gameDt) || 0);
  state = normaliseServiceItemOwnership(state);
  state = normaliseCookingBatches(state);
  let queueAdmissionGate = state.queueAdmissionGate ?? null;
  let customers = [...(state.customers || [])];
  let queue = [...(state.queue || [])];
  let tables = state.tables || [];
  let serviceItems = [...(state.serviceItems || [])];
  let completedCustomers = [...(state.completedCustomers || [])];
  let pendingPartyReviews = [...(state.pendingPartyReviews || [])];
  let partyReviewHistory = [...(state.partyReviewHistory || [])];
  let floorDirt = [...(state.floorDirt || [])];
  let restaurant = state.restaurant;
  let cookingBatches = state.cookingBatches;

  const claimedCustomerIds = new Set();
  const claimedServiceItemIds = new Set();
  const claimedTableIds = new Set();
  const claimedDirtIds = new Set();

  let staff = ensureStaffRuntime(state.staff, state).map(s =>
    withCarriedServiceItemIds({
      ...s,
      morale: Math.max(0, s.morale - 0.01 * gameDt / 60),
    }, getCarriedServiceItemIds(s)));
  const activityState = { ...state, staff, customers, tables, serviceItems, cookingBatches };
  // Each optional destination sees claims accepted earlier in this tick. Use
  // stable IDs rather than array order, without changing the returned staff order.
  const activityOrder = staff.map((_, index) => index).sort((left, right) => {
    const a = String(staff[left].id);
    const b = String(staff[right].id);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const index of activityOrder) {
    staff[index] = prepareStaffActivity(activityState, staff[index]);
  }
  const cookDrinkTaskServiceItemIds = staff
    .filter(worker => worker.role === 'cook' && worker.task?.type === 'prepare_drink')
    .map(worker => worker.task.serviceItemId)
    .filter(Boolean);

  // Drop stale drink reservations before selecting new work. A reservation is
  // valid only when its worker, item, counter, and slot all agree exactly.
  serviceItems = serviceItems.map(item => {
    if (!['ordered', 'preparing'].includes(item.state)
      || item.kind !== 'drink'
      || hasValidDrinkReservation({ ...state, staff }, item)) return item;
    return {
      ...item,
      state: 'ordered',
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
      preparationStartedAt: null,
    };
  });

  // Seed claimed sets from existing active staff tasks to prevent cross-tick duplicate claims.
  for (const s of staff) {
    if (s.task) {
      if (s.task.customerId) claimedCustomerIds.add(s.task.customerId);
      if (Array.isArray(s.task.customerIds)) {
        s.task.customerIds.forEach(id => claimedCustomerIds.add(id));
      }
      if (s.task.serviceItemId
        && (s.task.type !== 'prepare_drink'
          || cookDrinkTaskServiceItemIds.includes(s.task.serviceItemId))) {
        claimedServiceItemIds.add(s.task.serviceItemId);
      }
      if (Array.isArray(s.task.serviceItemIds)) {
        s.task.serviceItemIds.forEach(id => claimedServiceItemIds.add(id));
      }
      if (s.task.type === 'clean_table' && s.task.tableId) claimedTableIds.add(s.task.tableId);
      if (s.task.type === 'clean_floor' && s.task.dirtId) claimedDirtIds.add(s.task.dirtId);
    }
  }
  for (const batch of cookingBatches || []) {
    getBatchServiceItemIds(batch).forEach(id => claimedServiceItemIds.add(id));
  }
  staff = staff.map(worker => worker.task?.type === 'prepare_drink'
    && !serviceItems.some(item => item.id === worker.task.serviceItemId
      && item.assignedStaffId === worker.id
      && hasValidDrinkReservation({ ...state, staff }, item))
    ? clearNavigationGoal({ ...worker, task: null }) : worker);

  // A hold-at-goal planner cannot solve two staff tasks ending at the same
  // service point. Repair old assignments as well as avoiding new duplicates.
  for (let i = 0; i < staff.length; i += 1) {
    const worker = staff[i];
    if (!['take_order', 'deliver_service_item'].includes(worker.task?.type)
      || !worker.navigationGoal
      || hasObsoleteCustomerTask(worker, customers, tables, serviceItems, state.washStations || [])) continue;
    const currentState = { ...state, staff, customers, tables, serviceItems };
    if (isStaffDestinationAvailable(currentState, worker.navigationGoal, worker)) continue;
    const tableId = worker.task.type === 'take_order'
      ? customers.find(customer => customer.id === worker.task.customerId)?.tableId
      : serviceItems.find(item => item.id === worker.task.serviceItemId)?.tableId;
    const table = tables.find(candidate => candidate.id === tableId);
    const target = table && targetForTable(currentState, table, worker);
    if (target) staff[i] = setNavigationGoal(worker, target.goal);
  }

  return {
    ...state, staff, customers, queue, tables, serviceItems, completedCustomers,
    pendingPartyReviews, partyReviewHistory, floorDirt, restaurant,
    queueAdmissionGate,
    ...(cookingBatches ? { cookingBatches } : {}),
    __staffClaimedServiceItemIds: cookDrinkTaskServiceItemIds,
  };
}

export function getStaffMovementEntries(state) {
  const entries = [];
  const goalFor = character => Number.isFinite(character.navigationGoal?.x)
    && Number.isFinite(character.navigationGoal?.y)
    ? { x: character.navigationGoal.x, y: character.navigationGoal.y }
    : null;
  for (const staff of state.staff || []) {
    if (!Number.isFinite(staff.x) || !Number.isFinite(staff.y)) continue;
    const target = goalFor(staff);
    entries.push({
      character: staff,
      speed: target ? getStaffMovementSpeed(staff) : 0,
      ignoredIds: [],
      doorFlow: { doorId: null, direction: 'none' },
      queueRank: null,
      terminalPolicy: 'hold',
      ...(target ? { target } : {}),
    });
  }
  return entries;
}

function workerOwnsItem(worker, itemId) {
  return getCarriedServiceItemIds(worker).includes(itemId);
}

function anotherWorkerOwnsItem(allStaff, staffId, itemId) {
  if (itemId == null) return false;
  return (allStaff || []).some(candidate => candidate.id !== staffId
    && (workerOwnsItem(candidate, itemId)
      || candidate.task?.serviceItemId === itemId));
}

function nextCarriedTask(state, staff, serviceItems, customers, tables, allStaff) {
  for (const itemId of getCarriedServiceItemIds(staff)) {
    const item = serviceItems.find(candidate => candidate.id === itemId);
    if (!item || !['carried', 'carried_dirty'].includes(item.state)) continue;
    if (anotherWorkerOwnsItem(allStaff, staff.id, item.id)) continue;
    if (item.state === 'carried_dirty') {
      const stationChoice = selectWashStation(state, staff, serviceItems, allStaff);
      if (stationChoice) {
        return {
          task: {
            type: 'deliver_dirty_item',
            serviceItemId: item.id,
            washStationId: stationChoice.station.id,
          },
          goal: stationChoice.target.goal,
        };
      }
      continue;
    }
    const customer = customers.find(candidate => candidate.id === item.customerId);
    const table = tables.find(candidate => candidate.id === item.tableId);
    if (!customer || customer.state === 'leaving' || customer.tableId !== item.tableId || !table) continue;
    const target = targetForTable(state, table, staff);
    if (target) {
      return {
        task: {
          type: 'deliver_service_item',
          serviceItemId: item.id,
          customerId: item.customerId,
        },
        goal: target.goal,
      };
    }
  }
  return null;
}

function continueCarriedTask(state, staff, serviceItems, customers, tables, allStaff) {
  const next = nextCarriedTask(state, staff, serviceItems, customers, tables, allStaff);
  if (!next) return clearNavigationGoal({ ...staff, task: null });
  return setNavigationGoal({ ...staff, task: next.task }, next.goal);
}

function nextCarriedCookTask(state, staff, serviceItems) {
  for (const itemId of getCarriedServiceItemIds(staff)) {
    const item = serviceItems.find(candidate => candidate.id === itemId);
    const serviceTable = item
      ? (state.serviceTables || []).find(table => table.id === item.serviceTableId)
      : null;
    if (!item || item.kind !== 'dish' || item.state !== 'carried'
      || item.assignedStaffId !== staff.id
      || !Number.isInteger(item.serviceSlotIndex) || !serviceTable) continue;
    const target = targetForRectOrCurrent(state, getServiceTableRect(serviceTable), staff);
    if (target) {
      return {
        task: {
          type: 'place_dish_on_service',
          serviceItemId: item.id,
          serviceTableId: item.serviceTableId,
          serviceSlotIndex: item.serviceSlotIndex,
          ...(item.batchId != null ? {
            batchId: item.batchId,
            serviceItemIds: getBatchServiceItemIds(getCookingBatch(state, item.batchId)),
            stationId: getCookingBatch(state, item.batchId)?.stationId,
          } : {}),
        },
        goal: target.goal,
      };
    }
  }
  return null;
}

function reconcileCarriedInventory(staff, serviceItems, customers, tables, serviceTables) {
  const nextIds = [];
  const recoveredIds = new Set();
  let nextServiceItems = serviceItems;
  let inventoryKind = null;
  const capacity = getStaffCarryCapacity(staff);
  for (const itemId of getCarriedServiceItemIds(staff)) {
    const item = serviceItems.find(candidate => candidate.id === itemId);
    if (!item || !['carried', 'carried_dirty'].includes(item.state)) continue;
    const customer = customers.find(candidate => candidate.id === item.customerId);
    const table = tables.find(candidate => candidate.id === item.tableId);
    const cookServiceTable = serviceTables.find(candidate => candidate.id === item.serviceTableId);
    const validCookDestination = staff.role === 'cook'
      && item.kind === 'dish'
      && item.assignedStaffId === staff.id
      && customer?.state !== 'leaving'
      && cookServiceTable
      && Number.isInteger(item.serviceSlotIndex)
      && item.serviceSlotIndex >= 0
      && item.serviceSlotIndex < 4;
    const invalidCleanDestination = item.state === 'carried'
      && !validCookDestination
      && (!customer || customer.state === 'leaving'
        || customer.tableId !== item.tableId || !table);
    if (invalidCleanDestination) {
      recoveredIds.add(item.id);
      continue;
    }
    if (item.state === 'carried_dirty' && staff.role !== 'waiter') {
      recoveredIds.add(item.id);
      continue;
    }
    const itemKind = item.state === 'carried_dirty' ? 'dirty' : 'clean';
    if (inventoryKind == null) inventoryKind = itemKind;
    if (itemKind !== inventoryKind || nextIds.length >= capacity) {
      recoveredIds.add(item.id);
      continue;
    }
    nextIds.push(item.id);
  }
  if (recoveredIds.size > 0) {
    nextServiceItems = serviceItems.map(item => {
      if (!recoveredIds.has(item.id)) return item;
      if (item.state === 'carried_dirty') {
        return item.tableId != null && tables.some(table => table.id === item.tableId)
          ? { ...item, state: 'dirty_at_table', assignedStaffId: null }
          : {
            ...item,
            state: 'queued_for_wash',
            washStationId: null,
            washStartedAt: null,
            assignedStaffId: null,
          };
      }
      return { ...item, state: 'to_clean', assignedStaffId: null };
    });
  }
  return {
    staff: withCarriedServiceItemIds(staff, nextIds),
    serviceItems: nextServiceItems,
  };
}

function continueCarriedCookTask(state, staff, serviceItems) {
  const next = nextCarriedCookTask(state, staff, serviceItems);
  if (next) return setNavigationGoal({ ...staff, task: next.task }, next.goal);

  const batch = staff.task?.batchId != null
    ? getCookingBatch(state, staff.task.batchId)
    : null;
  const remainder = batch ? getCookingBatchRemainder({ ...state, serviceItems }, batch) : [];
  if (batch && remainder.length > 0) {
    const station = (state.kitchenStations || []).find(candidate =>
      candidate.id === batch.stationId);
    const target = station
      ? targetForRectOrCurrent(state, { x: station.x, y: station.y, w: 40, h: 40 }, staff)
      : null;
    if (target) return setNavigationGoal({ ...staff, task: batchTask(batch) }, target.goal);
  }
  if (batch) {
    return clearNavigationGoal({ ...staff, task: batchTask(batch) });
  }
  return clearNavigationGoal({ ...staff, task: null });
}

function getStaffBatchEntries(state) {
  const entriesById = new Map();
  const add = entry => {
    if (entry?.character?.id == null) return;
    const id = String(entry.character.id);
    const existing = entriesById.get(id);
    if (!existing
      || (Number(entry.speed) > 0 && !(Number(existing.speed) > 0))) {
      entriesById.set(id, entry);
    }
  };

  for (const entry of getStaffMovementEntries(state)) add(entry);
  for (const entry of getCustomerMovementEntries(state, 0)) add(entry);
  for (const character of getQueueVisibleMembers(state, state.queue)) {
    if (character?.id == null || !Number.isFinite(character.x) || !Number.isFinite(character.y)) continue;
    add({
      character: clearNavigationGoal(character),
      speed: 0,
      ignoredIds: [],
      doorFlow: { doorId: null, direction: 'none' },
      queueRank: null,
      terminalPolicy: 'hold',
      provenance: 'queue',
    });
  }
  return [...entriesById.values()];
}

export function resolveStaffAfterMovement(state, gameDt, statuses = new Map()) {
  state = normaliseCookingBatches(state);
  let {
    staff, customers, queue, serviceItems, completedCustomers,
    pendingPartyReviews, partyReviewHistory, floorDirt, restaurant, cookingBatches,
  } = state;
  let queueAdmissionGate = state.queueAdmissionGate ?? null;
  let queueSlots = Array.isArray(state.queueSlots) ? state.queueSlots : [];
  let tables = state.tables || [];
  const claimedCustomerIds = new Set();
  const claimedServiceItemIds = new Set();
  const claimedTableIds = new Set();
  const claimedDirtIds = new Set();
  (state.__staffClaimedServiceItemIds || []).forEach(id => claimedServiceItemIds.add(id));
  for (const worker of staff) {
    if (!worker.task) continue;
    if (worker.task.customerId) claimedCustomerIds.add(worker.task.customerId);
    if (worker.task.customerIds) worker.task.customerIds.forEach(id => claimedCustomerIds.add(id));
    if (worker.task.serviceItemId) claimedServiceItemIds.add(worker.task.serviceItemId);
    if (Array.isArray(worker.task.serviceItemIds)) {
      worker.task.serviceItemIds.forEach(id => claimedServiceItemIds.add(id));
    }
    if (worker.task.type === 'clean_table' && worker.task.tableId) claimedTableIds.add(worker.task.tableId);
    if (worker.task.type === 'clean_floor' && worker.task.dirtId) claimedDirtIds.add(worker.task.dirtId);
  }

  for (let i = 0; i < staff.length; i += 1) {
    const reconciledInventory = reconcileCarriedInventory(
      staff[i], serviceItems, customers, tables, state.serviceTables || [],
    );
    staff[i] = reconciledInventory.staff;
    serviceItems = reconciledInventory.serviceItems;
    const s = staff[i];
    const status = getMovementStatus(state, statuses, s.id);

    // Cancellation cannot depend on reaching a destination which may itself be
    // blocked forever. Valid work still requires certified arrival below.
    if (s.task && status.plan !== 'arrived'
       && !hasObsoleteCustomerTask(s, customers, tables, serviceItems, state.washStations || [])) {
      staff[i] = markTaskAssigned(s);
      continue;
    }

    if (s.task) {
      const resolved = resolveTask({
        state: {
          ...state, restaurant, staff, customers, queue, tables, serviceItems,
          completedCustomers, pendingPartyReviews, partyReviewHistory, floorDirt,
          queueAdmissionGate, cookingBatches,
        },
        staff: s, customers, queue, tables, serviceItems,
        pendingPartyReviews, partyReviewHistory, restaurant, statuses,
      });
      if (resolved.customers) customers = resolved.customers;
      if (resolved.queue) queue = resolved.queue;
      if (resolved.tables) tables = resolved.tables;
      if (resolved.serviceItems) serviceItems = resolved.serviceItems;
      if (resolved.cookingBatches) cookingBatches = resolved.cookingBatches;
      if (resolved.completedCustomers) completedCustomers = resolved.completedCustomers;
      if (resolved.pendingPartyReviews) pendingPartyReviews = resolved.pendingPartyReviews;
      if (resolved.partyReviewHistory) partyReviewHistory = resolved.partyReviewHistory;
      if (resolved.restaurant) restaurant = resolved.restaurant;
      if (resolved.floorDirt) floorDirt = resolved.floorDirt;
      if (Object.hasOwn(resolved, 'queueAdmissionGate')) {
        queueAdmissionGate = resolved.queueAdmissionGate;
      }
      const resolvedStaffState = {
        ...state,
        staff: staff.map((worker, index) => index === i ? resolved.staff : worker),
      };
      const resolvedStatus = getCharacterMovementStatus(resolvedStaffState, resolved.staff.id);
      staff[i] = resolved.staff.task
        ? resolvedStatus.plan === 'arrived'
          ? markWorking(clearNavigationGoal(resolved.staff))
          : markTaskAssigned(resolved.staff)
        : settleTasklessActivity(
          {
            ...state, restaurant, staff, customers, tables, serviceItems,
            pendingPartyReviews, partyReviewHistory,
          },
          resolved.staff,
        );
      if (resolved.clearCarriedServiceItemIds) {
        const clearedIds = new Set(resolved.clearCarriedServiceItemIds);
        staff = staff.map(worker => withCarriedServiceItemIds(
          worker,
          getCarriedServiceItemIds(worker).filter(id => !clearedIds.has(id)),
        ));
      }
      continue;
    }

    const result = assignTask({
      state: {
        ...state, restaurant, staff, customers, queue, tables, serviceItems,
        completedCustomers, pendingPartyReviews, partyReviewHistory, floorDirt,
        queueAdmissionGate, cookingBatches,
      },
      staff: s, allStaff: staff, customers, queue, tables, serviceItems,
      claimedCustomerIds, claimedServiceItemIds, claimedTableIds, claimedDirtIds,
    });
    if (result) {
      staff[i] = result.staff.task
        ? markTaskAssigned(result.staff)
        : settleTasklessActivity(
          {
            ...state, restaurant, staff, customers, tables, serviceItems,
            pendingPartyReviews, partyReviewHistory,
          },
          result.staff,
        );
      if (result.customers) customers = result.customers;
      if (result.queue) queue = result.queue;
      if (result.queueSlots) queueSlots = result.queueSlots;
      if (result.tables) tables = result.tables;
      if (result.serviceItems) serviceItems = result.serviceItems;
      if (result.cookingBatches) cookingBatches = result.cookingBatches;
      if (Object.hasOwn(result, 'queueAdmissionGate')) {
        queueAdmissionGate = result.queueAdmissionGate;
      }
      if (result.claimedCustomerId) claimedCustomerIds.add(result.claimedCustomerId);
      if (result.claimedCustomerIds) result.claimedCustomerIds.forEach(id => claimedCustomerIds.add(id));
      if (result.claimedServiceItemId) claimedServiceItemIds.add(result.claimedServiceItemId);
      if (result.claimedServiceItemIds) {
        result.claimedServiceItemIds.forEach(id => claimedServiceItemIds.add(id));
      }
      if (result.claimedTableId) claimedTableIds.add(result.claimedTableId);
      if (result.claimedDirtId) claimedDirtIds.add(result.claimedDirtId);
    }
  }

  serviceItems = serviceItems.map(item => {
    const carrier = staff.find(candidate => workerOwnsItem(candidate, item.id));
    return carrier && ['carried', 'carried_dirty'].includes(item.state)
      ? { ...item, x: carrier.x, y: carrier.y }
      : item;
  });

  const { __staffClaimedServiceItemIds, ...cleanState } = state;
  const result = {
    ...cleanState,
    restaurant,
    staff,
    customers,
    queue,
    tables,
    serviceItems,
    completedCustomers,
    pendingPartyReviews,
    partyReviewHistory,
    floorDirt,
    queueAdmissionGate,
    queueSlots,
    ...(cookingBatches ? { cookingBatches } : {}),
  };
  return result;
}

export function updateStaff(state, timing) {
  const gameDt = Math.max(0, Number.isFinite(timing) ? timing : Number(timing?.gameDt) || 0);
  const movementDt = Math.max(0, Number.isFinite(timing) ? timing : Number(timing?.movementDt) || 0);
  const prepared = prepareStaffForMovement(state, gameDt);
  const movementEntries = getStaffBatchEntries(prepared);
  const batch = advanceCharacterMovementBatch(prepared, movementEntries, movementDt);
  const movedFor = id => batch.moved.get(id) || batch.moved.get(String(id));
  const committed = {
    ...prepared,
    staff: prepared.staff.map(character => movedFor(character.id) || character),
    customers: prepared.customers.map(character => movedFor(character.id) || character),
    movementCoordinator: batch.coordinator,
  };
  return resolveStaffAfterMovement(committed, gameDt, batch.statuses);
}
