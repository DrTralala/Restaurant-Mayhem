import { cellToWorld, findAdjacentOpenCells, findPath, isInsideWorld, worldToCell } from './pathfinding';
import { advanceCharacterMovementBatch, getCharacterMovementStatus } from './movement';
import { getMovementStatus } from './movement/status';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
import { getCustomerMovementEntries } from './customers';
import { recordSeatResidency } from './movement/seatedDeparture';
import { GRID_SIZE, getCashierCustomerPosition, getCashierWorkPosition, getDefaultStaffPosition, getDoorPosition, getDoors, getRestaurantWorld } from './world';
import { clampReputation, getTipRate, getUpgradeEffect } from './balance';
import { clearUnavailableCashierAssignments, getAssignedCashierStation } from './cashiers';
import { getDrink, getResolvedDrink } from '../data/drinks';
import { getPlaceableDimensions } from '../data/placeables';
import {
  createCustomerOrder,
  findAvailableServiceSlot,
  getServiceSlotPosition,
  normaliseServiceItemOwnership,
  hasValidDrinkReservation,
  SERVICE_COUNTER_CAPACITY,
} from './serviceItems';
import { ACTIVITY_DURATIONS } from './activity';
import {
  advanceStaffTaskProgress,
  getStaffTaskLegacyRate,
  getStaffTaskRate,
  getStaffTaskSource,
} from './staffPerformance';
import {
  clearCleaningAction,
  getCleaningAction,
  resolveCleaningStart,
  updateCleaningActionProgress,
} from './cleaningActions';
import { selectSinkTransfer } from './sinkTransfers';
import { releaseStaffWork } from './staffTaskLifecycle';
import { getScheduledDuty, validateStaffSchedule } from './staffSchedules';
import { startCustomerConsumption } from './consumption';
import { getWashStationCapacity, getWashStationOccupancy, hasWashStationCapacity } from './dishwashing';
import { getCarriedServiceItemIds, getStaffCarryCapacity, withCarriedServiceItemIds } from './staffInventory';
import { isStaffTaskRoleAllowed } from './taskRoles';
import { canDeliverFoodItem, markFoodDelivered } from './foodPatience';
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
import { getDishwasherStats } from './dishwasherProgression';
import { findPreparationTarget, isAtPreparationPosition } from './preparationPosition';
import { allocateStaffPositions } from './navigation/staffAllocation';
import { positionAvailable, quarantineNavigation } from './navigation/occupancy';

export function ensureStaffRuntime(staff, state) {
  const positioned = allocateStaffPositions(state, staff || []);
  if (!positioned) throw new Error('No safe floor position is available for unplaced staff');
  return positioned.map(worker => withCarriedServiceItemIds(
    { ...worker, task: worker.task || null }, getCarriedServiceItemIds(worker),
  ));
}

const CHARACTER_START_SPACING = 16;

function targetForTable(state, table, staff, excludedGoal = null) {
  return targetForRect(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff, excludedGoal);
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
  if (!positionAvailable(state, point, staff.id)) return false;
  return (state.staff || []).every(worker => {
    if (worker.id === staff.id || (!worker.task && !worker.navigationGoal)) return true;
    const destination = worker.navigationGoal || worker;
    return !Number.isFinite(destination.x) || !Number.isFinite(destination.y)
      || Math.hypot(point.x - destination.x, point.y - destination.y) >= CHARACTER_START_SPACING;
  });
}

function targetForRect(state, rect, staff, excludedGoal = null) {
  const start = worldToCell(staff);
  const candidates = findAdjacentOpenCells(state, rect, start);
  for (const target of candidates) {
    const goal = target.x === start.x && target.y === start.y
      ? { x: staff.x, y: staff.y } : cellToWorld(target);
    if (excludedGoal && goal.x === excludedGoal.x && goal.y === excludedGoal.y) continue;
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
  if (station?.type !== 'automatic') return ACTIVITY_DURATIONS.manualWash;
  return getDishwasherStats(station.level ?? 1)?.secondsPerDish
    ?? ACTIVITY_DURATIONS.automaticWash;
}

function isTableReadyForCleaning(table, customers, chairs = []) {
  const hasBlockingCustomer = customers.some(customer => customer.tableId === table.id
    && customer.state !== 'leaving' && !isCheckoutState(customer));
  // A leaving/checkout member is not proof that the chair is physically clear.
  const chairsClear = chairs
    .filter(chair => chair?.tableId === table.id && Number.isFinite(chair.x) && Number.isFinite(chair.y))
    .every(chair => customers.every(customer => !Number.isFinite(customer?.x)
      || !Number.isFinite(customer?.y)
      || Math.hypot(customer.x - (chair.x + 10), customer.y - (chair.y + 10))
        >= CHARACTER_START_SPACING));
  return !hasBlockingCustomer && chairsClear;
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
    && item.serviceSlotIndex < SERVICE_COUNTER_CAPACITY
    && (serviceTables || []).some(table => table.id === item.serviceTableId);
}

function requestedDuty(worker, now) {
  const schedule = Array.isArray(worker?.schedule)
    ? worker.schedule : worker?.schedule?.schedule;
  if (!validateStaffSchedule(schedule).valid) return 'work';
  return getScheduledDuty(schedule, now) || 'work';
}

function isStaffWorkEligible(worker, now) {
  return worker?.effectiveDuty !== 'rest'
    && worker?.effectiveDuty !== 'pto'
    && requestedDuty(worker, now) === 'work'
    && worker?.movementResidency?.kind !== 'staff_amenity';
}

function cleaningOwner(state, type, targetId) {
  return (state.staff || []).find(worker => worker.role === 'janitor'
    && ((type === 'clean_table' && worker.task?.tableId === targetId)
      || (type === 'clean_floor' && worker.task?.dirtId === targetId)
      || (type === 'wash_item' && worker.task?.serviceItemId === targetId)));
}

function normaliseCleaningActionOwners(state) {
  const update = (collection, type, idFor) => (collection || []).map(target => {
    const action = target.cleaningAction;
    if (!action || action.staffId == null) return target;
    const owner = cleaningOwner(state, type, idFor(target));
    return owner && String(owner.id) === String(action.staffId)
      ? target
      : { ...target, cleaningAction: { ...action, staffId: null } };
  });
  return {
    ...state,
    tables: update(state.tables, 'clean_table', table => table.id),
    floorDirt: update(state.floorDirt, 'clean_floor', dirt => dirt.id),
    serviceItems: update(state.serviceItems, 'wash_item', item => item.id),
  };
}

function cleanupAge(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function janitorCleanupCandidates({ state, staff, allStaff, serviceItems, claimedServiceItemIds, claimedTableIds, claimedDirtIds }) {
  const now = Number.isFinite(state.restaurant?.gameTime) ? state.restaurant.gameTime : 0;
  const candidates = [];
  const add = (candidate, id, age) => {
    if (!candidate?.target || id == null) return;
    candidates.push({ ...candidate, id, age });
  };

  for (const dirt of state.floorDirt || []) {
    if (claimedDirtIds?.has(dirt.id)) continue;
    const target = targetForRectOrCurrent(state, {
      x: dirt.x - 6, y: dirt.y - 6, w: 12, h: 12,
    }, staff);
    add({
      type: 'clean_floor',
      dirt,
      target,
    }, dirt.id, cleanupAge(
      dirt.eligibleAt ?? dirt.createdAt ?? dirt.dirtyAt,
      now + (target?.distance ?? 0),
    ));
  }

  const manualStations = (state.washStations || []).filter(station => station.type === 'manual');
  const manualStationIds = new Set(manualStations.map(station => station.id));
  const activeWashStations = new Set((allStaff || state.staff || [])
    .filter(worker => worker.id !== staff.id && worker.task?.type === 'wash_item')
    .map(worker => worker.task.washStationId));
  for (const item of serviceItems || []) {
    if (item.state !== 'queued_for_wash'
      || (item.washStationId != null && !manualStationIds.has(item.washStationId))
      || (item.assignedStaffId != null && item.assignedStaffId !== staff.id)
      || claimedServiceItemIds?.has(item.id)
      || Number.isFinite(item.washStartedAt)
      || Number.isFinite(item.cleaningAction?.startedAt)) continue;
    const stations = item.washStationId == null
      ? manualStations : manualStations.filter(station => station.id === item.washStationId);
    for (const station of stations) {
      if (activeWashStations.has(station.id)
        || (state.serviceItems || []).some(candidate => candidate.state === 'washing'
          && candidate.washStationId === station.id)) continue;
      const target = targetForRectOrCurrent(state, station, staff);
      if (!target) continue;
      add({ type: 'wash_item', item, station, target }, item.id,
        cleanupAge(item.washQueuedAt ?? item.eligibleAt ?? item.createdAt, now));
      break;
    }
  }

  for (const table of state.tables || []) {
    if (table.status !== 'dirty'
      || claimedTableIds?.has(table.id)
      || !isTableReadyForCleaning(table, state.customers || [], state.chairs)) continue;
    const target = targetForTableOrCurrent(state, table, staff);
    add({
      type: 'clean_table',
      table,
      target,
    }, table.id, cleanupAge(
      table.cleaningAction?.eligibleAt
        ?? table.eligibleAt ?? table.dirtyAt ?? table.createdAt,
      now + (target?.distance ?? 0),
    ) - 300);
  }

  return candidates.sort((left, right) => left.age - right.age
    || String(left.id).localeCompare(String(right.id)));
}

function waiterDirtyDishCandidates({ state, staff, serviceItems, claimedServiceItemIds }) {
  const candidates = [];
  const timestamp = value => Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  for (const item of serviceItems || []) {
    if (!['dirty_at_table', 'to_clean'].includes(item.state)
      || claimedServiceItemIds?.has(item.id)
      || anotherWorkerOwnsItem(state.staff, staff.id, item.id)
      || (item.assignedStaffId != null && item.assignedStaffId !== staff.id)) continue;

    let table = null;
    let target;
    if (item.state === 'dirty_at_table') {
      table = (state.tables || []).find(candidate => candidate.id === item.tableId);
      if (!table) continue;
      target = targetForTableOrCurrent(state, table, staff);
    } else {
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
      target = targetForRectOrCurrent(state, {
        x: item.x - 10, y: item.y - 10, w: 20, h: 20,
      }, staff);
    }
    if (!target) continue;
    candidates.push({ type: 'collect_dirty_item', item, table, target });
  }

  return candidates.sort((left, right) => timestamp(left.item.dirtyAt)
    - timestamp(right.item.dirtyAt)
    || timestamp(left.item.eligibleAt) - timestamp(right.item.eligibleAt)
    || timestamp(left.item.wasteOrigin?.createdAt)
      - timestamp(right.item.wasteOrigin?.createdAt)
    || timestamp(left.item.createdAt) - timestamp(right.item.createdAt)
    || String(left.item.id).localeCompare(String(right.item.id)));
}

function clearDrinkReservation(serviceItems, serviceItemId, now = null) {
  return serviceItems.map(item => item.id === serviceItemId
    && item.kind === 'drink'
    && ['ordered', 'preparing'].includes(item.state)
    ? {
      ...item,
      state: 'ordered',
      stationId: null,
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
       ...(Number.isFinite(item.accumulatedWork) && item.accumulatedWork > 0
         ? (Number.isFinite(now)
           ? { lastProgressAt: Math.max(Number.isFinite(item.lastProgressAt) ? item.lastProgressAt : now, now) }
           : {})
         : { preparationStartedAt: null, readyAt: null, lastProgressAt: null }),
    }
    : item);
}

function releaseLegacyDrinkReservation(serviceItems, serviceItemId, now) {
  return serviceItems.map(item => item.id === serviceItemId
    && item.kind === 'drink'
    && ['ordered', 'preparing'].includes(item.state)
    ? {
      ...item,
      state: 'ordered',
      stationId: null,
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
      ...(Number.isFinite(item.accumulatedWork) && item.accumulatedWork > 0
        ? { lastProgressAt: Number.isFinite(now) ? now : item.lastProgressAt }
        : { preparationStartedAt: null, readyAt: null, lastProgressAt: Number.isFinite(now) ? now : item.lastProgressAt }),
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
  if (!isStaffWorkEligible(staff, state.restaurant?.gameTime)) return null;
  const cashierStation = staff.role === 'waiter'
    ? getAssignedCashierStation(state.cashierStations, staff.id)
    : null;

  if (staff.role === 'janitor') {
    if (getCarriedServiceItemIds(staff).length > 0) {
      const next = nextCarriedTask(state, staff, serviceItems, customers, tables, allStaff);
      return next
        ? { staff: setNavigationGoal({ ...staff, task: next.task }, next.goal) }
        : null;
    }
    const candidate = janitorCleanupCandidates({
      state: { ...state, staff: allStaff || state.staff },
      staff,
      allStaff,
      serviceItems,
      claimedServiceItemIds,
      claimedTableIds,
      claimedDirtIds,
    })[0];
    if (!candidate) return null;
    if (candidate.type === 'wash_item') {
      return {
        staff: setNavigationGoal(
          { ...staff, task: {
            type: 'wash_item', serviceItemId: candidate.item.id, washStationId: candidate.station.id,
          } },
          candidate.target.goal,
        ),
        serviceItems: serviceItems.map(item => item.id === candidate.item.id
          ? { ...item, washStationId: candidate.station.id, assignedStaffId: staff.id }
          : item),
        claimedServiceItemId: candidate.item.id,
      };
    }
    if (candidate.type === 'clean_floor') {
      return {
        staff: setNavigationGoal(
          { ...staff, task: { type: 'clean_floor', dirtId: candidate.dirt.id } },
          candidate.target.goal,
        ),
        claimedDirtId: candidate.dirt.id,
      };
    }
    if (candidate.type === 'clean_table') {
      return {
        staff: setNavigationGoal(
          { ...staff, task: { type: 'clean_table', tableId: candidate.table.id } },
          candidate.target.goal,
        ),
        claimedTableId: candidate.table.id,
      };
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

    const dirtyDishCandidate = waiterDirtyDishCandidates({
      state, staff, serviceItems, claimedServiceItemIds,
    })[0];
    if (dirtyDishCandidate) {
      const task = {
        type: 'collect_dirty_item',
        serviceItemId: dirtyDishCandidate.item.id,
        ...(dirtyDishCandidate.table ? { tableId: dirtyDishCandidate.table.id } : {}),
      };
      return {
        staff: setNavigationGoal({ ...staff, task }, dirtyDishCandidate.target.goal),
        claimedServiceItemId: dirtyDishCandidate.item.id,
      };
    }

    const transfer = Number(staff.skill) >= 5
      ? selectSinkTransfer(state, staff.id, state.restaurant?.gameTime)
      : null;
    if (transfer && !claimedServiceItemIds?.has(transfer.serviceItemId)) {
      const source = (state.washStations || []).find(station =>
        sameId(station.id, transfer.sourceWashStationId));
      const item = serviceItems.find(candidate =>
        sameId(candidate.id, transfer.serviceItemId));
      const target = source ? targetForRectOrCurrent(state, source, staff) : null;
      if (source && item && target) {
        return {
          staff: setNavigationGoal({
            ...staff,
            task: {
              type: 'transfer_dirty_item',
              serviceItemId: transfer.serviceItemId,
              washStationId: transfer.washStationId,
              sourceWashStationId: transfer.sourceWashStationId,
            },
          }, target.goal),
          serviceItems: serviceItems.map(candidate => sameId(candidate.id, item.id)
            ? {
              ...candidate,
              assignedStaffId: staff.id,
              reservedWashStationId: transfer.washStationId,
            }
            : candidate),
          claimedServiceItemId: transfer.serviceItemId,
        };
      }
    }

    const orderingCustomer = customers.find(c => isOrderableCustomer(c)
      && (!claimedCustomerIds || !claimedCustomerIds.has(c.id)));
    const hasOrderableItem = state.dishes?.length > 0
      || state.unlockedDrinkIds?.some(drinkId => getDrink(drinkId));
    if (orderingCustomer && hasOrderableItem) {
      const table = tables.find(t => t.id === orderingCustomer.tableId);
      const target = table ? targetForTable(state, table, staff) : null;
      if (target) {
        const groupOrder = Number(staff.skill) >= 10;
        const customerIds = groupOrder
          ? customers
            .filter(customer => isOrderableCustomer(customer, {
              tableId: orderingCustomer.tableId,
              partyId: getPartyKey(orderingCustomer),
            })
              && (!claimedCustomerIds || !claimedCustomerIds.has(customer.id)))
            .map(customer => customer.id)
          : [orderingCustomer.id];
        const task = {
          type: 'take_order',
          customerId: orderingCustomer.id,
          ...(groupOrder ? {
            tableId: orderingCustomer.tableId,
            partyId: getPartyKey(orderingCustomer),
          } : {}),
          ...(groupOrder ? { customerIds } : {}),
        };
        return {
          staff: setNavigationGoal(
            { ...staff, task },
            target.goal,
          ),
          ...(groupOrder
            ? { claimedCustomerIds: customerIds }
            : { claimedCustomerId: orderingCustomer.id }),
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

    const activePreparationTasks = (state.staff || [])
      .filter(candidate => candidate.id !== staff.id
        && ['prepare_dish', 'prepare_drink'].includes(candidate.task?.type))
      .map(candidate => candidate.task);
    const occupiedStationIds = new Set([
      ...(state.__preparationStationClaims || []),
      ...activePreparationTasks.map(task => task.stationId),
      ...(state.serviceItems || [])
        .filter(item => ['dish', 'drink'].includes(item.kind) && item.state === 'preparing')
        .map(item => item.stationId),
      ...(state.cookingBatches || [])
        .filter(batch => getCookingBatchRemainder(state, batch).length > 0)
        .map(batch => batch.stationId),
    ].filter(id => id != null).map(id => String(id)));

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
        if (!slot) continue;
        for (const station of state.kitchenStations || []) {
          if (station.equipmentId != null
            || occupiedStationIds.has(String(station.id))) continue;
          const target = findPreparationTarget(
            { ...state, staff: allStaff || state.staff },
            station,
            staff,
          );
          if (!target) continue;
          return {
            staff: setNavigationGoal(
              {
                ...staff,
                task: {
                  type: 'prepare_drink',
                  serviceItemId: pending.id,
                  stationId: station.id,
                  serviceTableId: slot.serviceTableId,
                  serviceSlotIndex: slot.serviceSlotIndex,
                },
              },
              target.goal,
            ),
            serviceItems: serviceItems.map(item => item.id === pending.id
              ? {
                  ...item,
                  stationId: station.id,
                  serviceTableId: slot.serviceTableId,
                  serviceSlotIndex: slot.serviceSlotIndex,
                  state: 'ordered',
                  assignedStaffId: staff.id,
                }
              : item),
            claimedServiceItemId: pending.id,
          };
        }
        continue;
      }

      const dish = (state.dishes || []).find(candidate => candidate.id === pending.menuItemId);
      const requiredEquipmentOwned = !dish?.requiredEquipmentId
        || (state.equipment || []).some(candidate =>
          candidate.id === dish.requiredEquipmentId && candidate.owned);
      for (const station of state.kitchenStations || []) {
        if (!dish
          || !requiredEquipmentOwned
          || (dish.requiredEquipmentId && station.equipmentId !== dish.requiredEquipmentId)
          || occupiedStationIds.has(String(station.id))) continue;
        const target = findPreparationTarget(state, station, staff);
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

function canDeliverServiceItem(staff, item, customer, table, now = null) {
  return Boolean(customer
    && customer.state !== 'leaving'
    && canDeliverFoodItem(customer, item, now)
    && item?.state === 'carried'
    && workerOwnsItem(staff, item.id)
    && item.customerId === customer.id
    && staff.task.serviceItemId === item.id
    && staff.task.customerId === item.customerId
    && item.tableId === customer.tableId
    && table?.id === item.tableId);
}

function hasObsoleteCustomerTask(staff, customers, tables, serviceItems, washStations = [], now = null) {
  const customer = customers.find(candidate => candidate.id === staff.task?.customerId);
  if (staff.task?.type === 'take_order') {
    const customerIds = Array.isArray(staff.task.customerIds)
      ? staff.task.customerIds : [staff.task.customerId];
    return !customerIds.some(customerId => {
      const member = customers.find(candidate => candidate.id === customerId);
      return isOrderableCustomer(member, staff.task);
    });
  }
  if (staff.task?.type === 'deliver_service_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    return !canDeliverServiceItem(staff, item, customer, table, now);
  }
  if (staff.task?.type === 'deliver_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const station = washStations.find(candidate => candidate.id === staff.task.washStationId);
    return !item
      || staff.role !== 'waiter'
      || item.state !== 'carried_dirty'
      || !workerOwnsItem(staff, item.id)
      || !station;
  }
  if (staff.task?.type === 'collect_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    const carriedIds = getCarriedServiceItemIds(staff);
    const validTableItem = item?.state === 'dirty_at_table'
      && sameId(table?.id, item.tableId)
      && (staff.task.tableId == null || sameId(staff.task.tableId, item.tableId));
    const validPhysicalItem = item?.state === 'to_clean'
      && Number.isFinite(item.x) && Number.isFinite(item.y);
    return staff.role !== 'waiter'
      || carriedIds.length > 0
      || !item
      || (item.assignedStaffId != null && !sameId(item.assignedStaffId, staff.id))
      || (!validTableItem && !validPhysicalItem);
  }
  if (staff.task?.type === 'transfer_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const source = washStations.find(candidate => candidate.id === staff.task.sourceWashStationId);
    const destination = washStations.find(candidate => candidate.id === staff.task.washStationId);
    return !item
      || staff.role !== 'waiter'
      || item.state !== 'queued_for_wash'
      || item.assignedStaffId !== staff.id
      || item.washStationId !== source?.id
      || item.reservedWashStationId !== destination?.id
      || !source || !destination;
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
   const target = station ? findPreparationTarget(state, station, staff) : null;
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
    const target = station ? findPreparationTarget(state, station, staff) : null;
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
          preparationStartedAt: Number.isFinite(item.accumulatedWork)
            && item.accumulatedWork > 0 && Number.isFinite(item.preparationStartedAt)
            ? item.preparationStartedAt : preparationStartedAt,
          accumulatedWork: Number.isFinite(item.accumulatedWork)
            ? Math.max(0, item.accumulatedWork) : 0,
          lastProgressAt: Number.isFinite(item.lastProgressAt)
            ? item.lastProgressAt : preparationStartedAt,
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

function orderTaskCustomerIds(task) {
  const ids = Array.isArray(task?.customerIds) ? task.customerIds : [task?.customerId];
  const seen = new Set();
  return ids.filter(id => {
    if (id == null || seen.has(String(id))) return false;
    seen.add(String(id));
    return true;
  });
}

function isOrderableCustomer(customer, task = {}) {
  return customer?.state === 'seated'
    && (task.tableId == null || customer.tableId === task.tableId)
    && (task.partyId == null || getPartyKey(customer) === task.partyId)
    && !customer.dishId && !customer.drinkId
    && customer.foodOutcome !== 'cancelled'
    && customer.foodOutcome !== 'delivered';
}

function resolveTakeOrderTask({ state, staff, customers, queue, tables, serviceItems,
  pendingPartyReviews, partyReviewHistory, restaurant }) {
  const completedStaff = clearNavigationGoal({ ...staff, task: null });
  const memberIds = orderTaskCustomerIds(staff.task);
  const snapshotMembers = memberIds
    .map(id => customers.find(customer => customer.id === id))
    .filter(Boolean);
  const eligibleMembers = snapshotMembers.filter(customer =>
    isOrderableCustomer(customer, staff.task));
  if (eligibleMembers.length === 0) {
    return { staff: completedStaff, customers, queue, tables, serviceItems };
  }

  let updatedCustomers = [...customers];
  let nextServiceItems = serviceItems;
  let nextPendingPartyReviews = pendingPartyReviews;
  let nextPartyReviewHistory = partyReviewHistory;
  let nextRestaurant = restaurant;
  for (const snapshotMember of eligibleMembers) {
    const current = updatedCustomers.find(candidate => candidate.id === snapshotMember.id);
    if (!isOrderableCustomer(current, staff.task)) continue;
    const ordered = createCustomerOrder(
      { ...state, serviceItems: nextServiceItems },
      current,
    );
    nextServiceItems = ordered.serviceItems;
    updatedCustomers = updatedCustomers.map(candidate => candidate.id === current.id
      ? ordered.customer : candidate);
    nextPendingPartyReviews = recordPartyOrderOutcome(
      nextPendingPartyReviews,
      Array.isArray(staff.task.customerIds)
        ? eligibleMembers
        : customers.filter(candidate => getPartyKey(candidate) === getPartyKey(current)),
      ordered.customer,
      ordered.customer.menuOutcome,
    );
    const settlement = settlePartyReview({
      pendingPartyReviews: nextPendingPartyReviews,
      partyReviewHistory: nextPartyReviewHistory,
      restaurant: nextRestaurant,
      upgrades: state.upgrades,
    }, getPartyKey(ordered.customer));
    nextPendingPartyReviews = settlement.pendingPartyReviews;
    nextPartyReviewHistory = settlement.partyReviewHistory;
    nextRestaurant = settlement.restaurant;
    if (settlement.review) {
      updatedCustomers = updatedCustomers.map(candidate =>
        getPartyKey(candidate) === getPartyKey(ordered.customer)
          && candidate.state === 'waiting_for_party'
          ? leavingFields({ ...candidate, departureReason: 'menu_unaffordable' })
          : candidate);
    }
  }
  return {
    staff: completedStaff,
    queue,
    tables,
    serviceItems: nextServiceItems,
    customers: updatedCustomers,
    pendingPartyReviews: nextPendingPartyReviews,
    partyReviewHistory: nextPartyReviewHistory,
    restaurant: nextRestaurant,
  };
}

function cleaningTaskTargetId(task) {
  if (task?.type === 'clean_table') return task.tableId;
  if (task?.type === 'clean_floor') return task.dirtId;
  if (task?.type === 'wash_item') return task.serviceItemId;
  return null;
}

function beginCleaningTask(state, staff) {
  const task = staff.task;
  const targetId = cleaningTaskTargetId(task);
  const started = resolveCleaningStart(
    state,
    staff.id,
    targetId,
    state.restaurant.gameTime,
  );
  const action = getCleaningAction(started, task, targetId);
  if (!action || (action.staffId != null && action.staffId !== staff.id)) return null;
  return {
    state: started,
    action,
    staff: clearNavigationGoal({
      ...staff,
      task: {
        ...task,
        ...(task.type === 'wash_item'
          ? { washingStartedAt: action.startedAt }
          : { cleaningStartedAt: action.cleaningStartedAt ?? action.startedAt }),
        accumulatedWork: action.accumulatedWork,
        lastProgressAt: action.lastProgressAt,
      },
    }),
  };
}

function cleaningProgress(state, staff) {
  const task = staff.task;
  const action = getCleaningAction(state, task, cleaningTaskTargetId(task));
  const source = action || getStaffTaskSource(state, staff) || task;
  const startedAt = task.type === 'wash_item'
    ? action?.startedAt ?? source?.washStartedAt ?? task.washingStartedAt
    : action?.startedAt ?? source?.cleaningStartedAt ?? source?.startedAt
      ?? task.cleaningStartedAt;
  return {
    action,
    progress: advanceStaffTaskProgress(
      source,
      state.restaurant.gameTime,
      getStaffTaskRate(state, staff),
      startedAt,
      getStaffTaskLegacyRate(state, staff),
    ),
  };
}

function completedCleaningResult(state, staff, task, { customers, queue, tables, serviceItems,
  serviceItemIndex = null }) {
  let nextState = clearCleaningAction(state, task, cleaningTaskTargetId(task));
  if (task.type === 'clean_table') {
    nextState = {
      ...nextState,
      tables: (nextState.tables || []).map(table => table.id === task.tableId
        ? clearDiningOwnership(table, 'empty') : table),
    };
  } else if (task.type === 'clean_floor') {
    nextState = {
      ...nextState,
      floorDirt: (nextState.floorDirt || []).filter(dirt => dirt.id !== task.dirtId),
    };
  } else if (task.type === 'wash_item') {
    nextState = {
      ...nextState,
      serviceItems: (nextState.serviceItems || []).filter((item, index) =>
        serviceItemIndex == null ? item.id !== task.serviceItemId : index !== serviceItemIndex),
    };
  }
  return {
    staff: clearNavigationGoal({ ...staff, task: null }),
    customers,
    queue,
    tables: nextState.tables ?? tables,
    serviceItems: nextState.serviceItems ?? serviceItems,
    ...(task.type === 'clean_floor' ? { floorDirt: nextState.floorDirt } : {}),
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
    const hasEligibleMember = orderTaskCustomerIds(staff.task)
      .map(id => customers.find(customer => customer.id === id))
      .some(customer => isOrderableCustomer(customer, staff.task));
    if (!hasEligibleMember) {
      return { staff: completedStaff, customers, queue, tables, serviceItems };
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
    return resolveTakeOrderTask({
      state, staff, customers, queue, tables, serviceItems,
      pendingPartyReviews, partyReviewHistory, restaurant,
    });
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
    if (!isTableReadyForCleaning(table, customers, state.chairs)) {
      return { staff: completedStaff, queue, customers, serviceItems, tables };
    }
    if (staff.task.cleaningStartedAt == null) {
      const started = beginCleaningTask(state, staff);
      if (!started) return { staff: completedStaff, tables, customers, queue, serviceItems };
      if (started.action.instantComplete) {
        return completedCleaningResult(started.state, started.staff, started.staff.task, {
          customers, queue, tables, serviceItems,
        });
      }
      return {
        staff: started.staff,
        tables: started.state.tables || tables,
        customers, queue, serviceItems,
      };
    }
    const tableCleaning = cleaningProgress(state, staff);
    const tableCleaningProgress = tableCleaning.progress;
    const progressedStaff = {
      ...staff,
      task: {
        ...staff.task,
        accumulatedWork: tableCleaningProgress.accumulatedWork,
        lastProgressAt: tableCleaningProgress.lastProgressAt,
      },
    };
    if (tableCleaningProgress.accumulatedWork < ACTIVITY_DURATIONS.wipeFloor) {
      const progressedState = tableCleaning.action
        ? updateCleaningActionProgress(state, staff.id, staff.task, tableCleaningProgress)
        : state;
      return {
        staff: clearNavigationGoal(progressedStaff), queue, customers, serviceItems,
        tables: progressedState.tables || tables,
      };
    }
    return completedCleaningResult(state, progressedStaff, staff.task, {
      customers, queue, tables, serviceItems,
    });
  }

  if (staff.task.type === 'clean_floor') {
    const dirt = (state.floorDirt || []).find(candidate => candidate.id === staff.task.dirtId);
    if (!dirt) return { staff: completedStaff, queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [] };
    if (staff.task.cleaningStartedAt == null) {
      const started = beginCleaningTask(state, staff);
      if (!started) return { staff: completedStaff, queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [] };
      if (started.action.instantComplete) {
        return completedCleaningResult(started.state, started.staff, started.staff.task, {
          customers, queue, tables, serviceItems,
        });
      }
      return {
        staff: started.staff,
        queue, customers, tables, serviceItems,
        floorDirt: started.state.floorDirt || state.floorDirt || [],
      };
    }
    const floorCleaning = cleaningProgress(state, staff);
    const floorCleaningProgress = floorCleaning.progress;
    const progressedStaff = {
      ...staff,
      task: {
        ...staff.task,
        accumulatedWork: floorCleaningProgress.accumulatedWork,
        lastProgressAt: floorCleaningProgress.lastProgressAt,
      },
    };
    if (floorCleaningProgress.accumulatedWork < ACTIVITY_DURATIONS.wipeFloor) {
      const progressedState = floorCleaning.action
        ? updateCleaningActionProgress(state, staff.id, staff.task, floorCleaningProgress)
        : state;
      return {
        staff: clearNavigationGoal(progressedStaff), queue, customers, tables, serviceItems,
        floorDirt: progressedState.floorDirt || state.floorDirt || [],
      };
    }
    return completedCleaningResult(state, progressedStaff, staff.task, {
      customers, queue, tables, serviceItems,
    });
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
      && ['dish', 'drink'].includes(item.kind)
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
         ? { ...candidate, state: 'to_clean', assignedStaffId: null, stationId: null }
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
    const item = serviceItems.find(candidate => sameId(candidate.id, staff.task.serviceItemId));
    const carriedIds = getCarriedServiceItemIds(staff);
    const table = item?.state === 'dirty_at_table'
      ? tables.find(candidate => sameId(candidate.id, item.tableId))
      : null;
    const validTableItem = item?.state === 'dirty_at_table'
      && table
      && sameId(table.id, item.tableId)
      && (staff.task.tableId == null || sameId(staff.task.tableId, item.tableId));
    const validPhysicalItem = item?.state === 'to_clean'
      && Number.isFinite(item.x) && Number.isFinite(item.y);
    const validTaskItem = staff.role === 'waiter'
      && carriedIds.length === 0
      && item
      && (validTableItem || validPhysicalItem)
      && (item.assignedStaffId == null || sameId(item.assignedStaffId, staff.id))
      && !anotherWorkerOwnsItem(state.staff, staff.id, item.id);
    if (!validTaskItem) {
      const retainedStaff = withCarriedServiceItemIds(completedStaff, carriedIds);
      return {
        staff: carriedIds.length > 0
          ? continueCarriedTask(state, retainedStaff, serviceItems, customers, tables, state.staff)
          : retainedStaff,
        queue, tables, customers, serviceItems,
      };
    }

    const target = validTableItem
      ? targetForRectOrCurrent(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff)
      : targetForRectOrCurrent(state, {
        x: item.x - 10, y: item.y - 10, w: 20, h: 20,
      }, staff);
    if (target === null) {
      return { staff: withCarriedServiceItemIds(completedStaff, carriedIds), queue, tables, customers, serviceItems };
    }
    if (target.distance > 0) {
      return { staff: setNavigationGoal(staff, target.goal), queue, tables, customers, serviceItems };
    }
    const capacity = getStaffCarryCapacity(staff);
    const candidates = serviceItems
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => (validTableItem
        ? candidate.state === 'dirty_at_table' && sameId(candidate.tableId, table.id)
        : candidate.state === 'to_clean'
          && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
          && candidate.x === item.x && candidate.y === item.y)
        && !anotherWorkerOwnsItem(state.staff, staff.id, candidate.id)
        && (candidate.assignedStaffId == null || sameId(candidate.assignedStaffId, staff.id)))
      .sort((left, right) => (left.candidate.dirtyAt ?? 0) - (right.candidate.dirtyAt ?? 0)
        || (left.candidate.eligibleAt ?? 0) - (right.candidate.eligibleAt ?? 0)
        || left.index - right.index
        || String(left.candidate.id).localeCompare(String(right.candidate.id)));
    const pickedItems = [
      item,
      ...candidates
        .filter(({ candidate }) => !sameId(candidate.id, item.id))
        .map(({ candidate }) => candidate),
    ].slice(0, capacity);
    const pickedIds = pickedItems.map(candidate => candidate.id);
    if (!pickedIds.some(id => sameId(id, item.id))) {
      return { staff: withCarriedServiceItemIds(completedStaff, []), queue, tables, customers, serviceItems };
    }
    const picked = new Set(pickedIds);
    const carriedItems = serviceItems.map(candidate => picked.has(candidate.id)
      ? {
        ...candidate,
        state: 'carried_dirty',
        x: staff.x,
        y: staff.y,
        assignedStaffId: null,
        stationId: null,
        serviceTableId: null,
        serviceSlotIndex: null,
        washStationId: null,
        reservedWashStationId: null,
      }
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

  if (staff.task.type === 'transfer_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const source = (state.washStations || []).find(candidate =>
      candidate.id === staff.task.sourceWashStationId && candidate.type === 'manual');
    const destination = (state.washStations || []).find(candidate =>
      candidate.id === staff.task.washStationId && candidate.type === 'automatic');
    const validTransfer = staff.role === 'waiter'
      && item?.state === 'queued_for_wash'
      && item.assignedStaffId === staff.id
      && item.washStationId === source?.id
      && item.reservedWashStationId === destination?.id;
    if (!validTransfer || !source || !destination) {
      return {
        staff: completedStaff,
        queue, tables, customers,
        serviceItems: serviceItems.map(candidate => candidate.id === item?.id
          ? {
            ...candidate,
            assignedStaffId: null,
            reservedWashStationId: null,
          }
          : candidate),
      };
    }
    const sourceTarget = targetForRectOrCurrent(state, source, staff);
    if (!sourceTarget) {
      return {
        staff: completedStaff, queue, tables, customers,
        serviceItems: serviceItems.map(candidate => candidate.id === item.id
          ? { ...candidate, assignedStaffId: null, reservedWashStationId: null }
          : candidate),
      };
    }
    if (sourceTarget.distance > 0) {
      return { staff: setNavigationGoal(staff, sourceTarget.goal), queue, tables, customers, serviceItems };
    }
    if (getCarriedServiceItemIds(staff).length > 0) {
      return {
        staff: continueCarriedTask(
          state,
          withCarriedServiceItemIds(completedStaff, getCarriedServiceItemIds(staff)),
          serviceItems,
          customers,
          tables,
          state.staff,
        ),
        queue, tables, customers, serviceItems,
      };
    }
    const carryingStaff = withCarriedServiceItemIds({
      ...staff,
      task: {
        type: 'deliver_dirty_item',
        serviceItemId: item.id,
        washStationId: destination.id,
        sourceWashStationId: source.id,
      },
    }, [item.id]);
    const carriedItems = serviceItems.map(candidate => candidate.id === item.id
      ? {
        ...candidate,
        state: 'carried_dirty',
        x: staff.x,
        y: staff.y,
        washStationId: null,
        assignedStaffId: staff.id,
      }
      : candidate);
    const destinationTarget = targetForRectOrCurrent(
      { ...state, serviceItems: carriedItems }, destination, carryingStaff,
    );
    if (!destinationTarget) {
      return {
        staff: completedStaff,
        queue, tables, customers,
        serviceItems: serviceItems.map(candidate => candidate.id === item.id
          ? {
            ...candidate,
            assignedStaffId: null,
            reservedWashStationId: null,
          }
          : candidate),
      };
    }
    return {
      staff: setNavigationGoal(carryingStaff, destinationTarget.goal),
      queue, tables, customers, serviceItems: carriedItems,
    };
  }

  if (staff.task.type === 'deliver_dirty_item') {
    const item = serviceItems.find(candidate => sameId(candidate.id, staff.task.serviceItemId));
    const station = (state.washStations || []).find(candidate =>
      sameId(candidate.id, staff.task.washStationId));
    const carriedIds = getCarriedServiceItemIds(staff);
    const taskItemId = staff.task.serviceItemId;
    const physicallyOwnsTaskItem = item?.state === 'carried_dirty'
      && workerOwnsItem(staff, taskItemId);
    const ownsTaskItem = staff.role === 'waiter' && physicallyOwnsTaskItem;
    const ownsTransferReservation = staff.task.sourceWashStationId == null
      || sameId(item?.reservedWashStationId, staff.task.washStationId);
    const anotherWorkerOwnsTaskItem = anotherWorkerOwnsItem(state.staff, staff.id, taskItemId);
    if (!item || !ownsTaskItem || !ownsTransferReservation) {
      const nextIds = anotherWorkerOwnsTaskItem
        ? carriedIds
        : item && physicallyOwnsTaskItem
          ? carriedIds
          : carriedIds.filter(id => !sameId(id, taskItemId));
      const nextStaff = withCarriedServiceItemIds(completedStaff, nextIds);
      const nextServiceItems = item && physicallyOwnsTaskItem && staff.role === 'waiter'
        ? serviceItems.map(candidate => sameId(candidate.id, taskItemId)
          ? {
            ...candidate,
            washStationId: null,
            reservedWashStationId: null,
            assignedStaffId: null,
          }
          : candidate)
        : serviceItems;
      const nextAllStaff = (state.staff || []).map(worker => worker.id === staff.id
        ? nextStaff
        : worker);
      return {
        staff: continueCarriedTask(
          { ...state, staff: nextAllStaff, serviceItems: nextServiceItems },
          nextStaff,
          nextServiceItems,
          customers,
          tables,
          nextAllStaff,
        ),
        queue, tables, customers, serviceItems: nextServiceItems,
      };
    }
    if (!station) {
      const nextServiceItems = serviceItems.map(candidate => sameId(candidate.id, taskItemId)
        ? {
          ...candidate,
          washStationId: null,
          reservedWashStationId: null,
          assignedStaffId: null,
        }
        : candidate);
      const nextStaff = withCarriedServiceItemIds(completedStaff, carriedIds);
      const nextAllStaff = (state.staff || []).map(worker => worker.id === staff.id
        ? nextStaff
        : worker);
      return {
        staff: continueCarriedTask(
          { ...state, staff: nextAllStaff, serviceItems: nextServiceItems },
          nextStaff,
          nextServiceItems,
          customers,
          tables,
          nextAllStaff,
        ),
        queue, tables, customers, serviceItems: nextServiceItems,
      };
    }
    const target = targetForRectOrCurrent(state, station, staff);
    if (target === null) {
      const nextServiceItems = serviceItems.map(candidate => sameId(candidate.id, taskItemId)
        ? {
          ...candidate,
          washStationId: null,
          reservedWashStationId: null,
          assignedStaffId: null,
        }
        : candidate);
      const nextStaff = withCarriedServiceItemIds(completedStaff, carriedIds);
      const nextAllStaff = (state.staff || []).map(worker => worker.id === staff.id
        ? nextStaff
        : worker);
      return {
        staff: continueCarriedTask(
          { ...state, staff: nextAllStaff, serviceItems: nextServiceItems },
          nextStaff,
          nextServiceItems,
          customers,
          tables,
          nextAllStaff,
        ),
        queue, tables, customers, serviceItems: nextServiceItems,
      };
    }
    if (target.distance > 0) {
      return { staff: setNavigationGoal(staff, target.goal), queue, tables, customers, serviceItems };
    }

    const carriedDirtyIds = carriedIds.filter(id => serviceItems.some(candidate =>
      sameId(candidate.id, id) && candidate.state === 'carried_dirty'));
    const occupied = getWashStationOccupancy(state, station, {
      excludeServiceItemIds: carriedDirtyIds,
    });
    const available = Math.max(0, getWashStationCapacity(station) - occupied);
    if (available === 0) {
      const nextServiceItems = serviceItems.map(candidate => sameId(candidate.id, taskItemId)
        ? {
          ...candidate,
          washStationId: null,
          reservedWashStationId: null,
          assignedStaffId: null,
        }
        : candidate);
      const nextStaff = withCarriedServiceItemIds(completedStaff, carriedIds);
      const nextAllStaff = (state.staff || []).map(worker => worker.id === staff.id
        ? nextStaff
        : worker);
      return {
        staff: continueCarriedTask(
          { ...state, staff: nextAllStaff, serviceItems: nextServiceItems },
          nextStaff,
          nextServiceItems,
          customers,
          tables,
          nextAllStaff,
        ),
        queue, tables, customers, serviceItems: nextServiceItems,
      };
    }

    const depositedIds = carriedDirtyIds.slice(0, available);
    const deposited = new Set(depositedIds);
    const nextServiceItems = serviceItems.map(candidate => deposited.has(candidate.id)
      ? {
        ...(() => {
          const { reservedWashStationId: _reservedWashStationId, ...withoutReservation } = candidate;
          return withoutReservation;
        })(),
        state: 'queued_for_wash',
        washStationId: station.id,
        washQueuedAt: state.restaurant.gameTime,
        assignedStaffId: null,
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
      const started = beginCleaningTask(state, staff);
      if (!started) return { staff: completedStaff, queue, tables, customers, serviceItems };
      if (started.action.instantComplete) {
        return completedCleaningResult(started.state, started.staff, started.staff.task, {
          customers, queue, tables, serviceItems,
          serviceItemIndex: serviceItems.indexOf(item),
        });
      }
      const washingStartedAt = started.action.startedAt;
      return {
        staff: started.staff,
        queue, tables, customers,
        serviceItems: (started.state.serviceItems || serviceItems).map((candidate, index) => index === serviceItems.indexOf(item)
          ? {
            ...candidate,
            state: 'washing',
            washStartedAt: washingStartedAt,
            accumulatedWork: started.action.accumulatedWork,
            lastProgressAt: started.action.lastProgressAt,
            assignedStaffId: staff.id,
          }
          : candidate),
      };
    }
    const washing = cleaningProgress(state, staff);
    const washingProgress = washing.progress;
    const progressedStaff = {
      ...staff,
      task: {
        ...staff.task,
        accumulatedWork: washingProgress.accumulatedWork,
        lastProgressAt: washingProgress.lastProgressAt,
      },
    };
    if (washingProgress.accumulatedWork < ACTIVITY_DURATIONS.manualWash) {
      const progressedState = washing.action
        ? updateCleaningActionProgress(state, staff.id, staff.task, washingProgress)
        : state;
      return {
        staff: clearNavigationGoal(progressedStaff),
        queue, tables, customers,
        serviceItems: (progressedState.serviceItems || serviceItems).map((candidate, index) => index === serviceItems.indexOf(item)
          ? {
            ...candidate,
            accumulatedWork: washingProgress.accumulatedWork,
            lastProgressAt: washingProgress.lastProgressAt,
            assignedStaffId: staff.id,
          }
        : candidate),
      };
    }
    return completedCleaningResult(state, progressedStaff, staff.task, {
      customers, queue, tables, serviceItems,
      serviceItemIndex: serviceItems.indexOf(item),
    });
  }

  if (staff.task.type === 'deliver_service_item') {
    const itemIndex = serviceItems.findIndex(candidate => candidate.id === staff.task.serviceItemId);
    const item = serviceItems[itemIndex];
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    if (!canDeliverServiceItem(staff, item, customer, table, state.restaurant.gameTime)) {
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
      ? { ...candidate, state: 'delivered', ...deliveredPosition, consumptionStartedAt: state.restaurant.gameTime }
      : candidate);
    const happiness = item.kind === 'dish'
      ? Math.min(100, (customer.happiness ?? 80) + happinessBonus)
      : customer.happiness;
    const deliveredCustomer = item.kind === 'dish'
      ? markFoodDelivered({ ...customer, happiness })
      : customer;
    const started = startCustomerConsumption(deliveredCustomer, deliveredServiceItems, state.restaurant.gameTime);
    const nextCarriedIds = getCarriedServiceItemIds(staff).filter(id => id !== item.id);
    const nextStaff = withCarriedServiceItemIds(completedStaff, nextCarriedIds);
    const nextServiceItems = started.serviceItems;
    return {
      staff: continueCarriedTask(
        { ...state, staff: state.staff || [] },
        nextStaff,
        nextServiceItems,
        customers.map(candidate => candidate.id === customer.id
          ? started.customer
          : candidate),
        tables,
        state.staff,
      ),
      queue, tables, serviceItems: started.serviceItems,
      customers: customers.map(candidate => candidate.id === customer.id
        ? started.customer
        : candidate),
    };
  }

  if (staff.task.type === 'prepare_drink') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const serviceTable = (state.serviceTables || []).find(candidate =>
      candidate.id === staff.task.serviceTableId);
    const station = (state.kitchenStations || []).find(candidate =>
      sameId(candidate.id, staff.task.stationId));
    const customer = item
      ? customers.find(candidate => sameId(candidate.id, item.customerId))
      : null;
    const validReservation = staff.role === 'cook'
      && staff.id != null
      && item
      && item.kind === 'drink'
      && ['ordered', 'preparing'].includes(item.state)
      && item.assignedStaffId === staff.id
      && item.stationId === staff.task.stationId
      && station?.equipmentId == null
      && customer?.state !== 'leaving'
      && staff.task.serviceItemId === item.id
      && staff.task.serviceTableId === item.serviceTableId
      && staff.task.serviceSlotIndex === item.serviceSlotIndex
      && Number.isInteger(item.serviceSlotIndex)
      && item.serviceSlotIndex >= 0
      && item.serviceSlotIndex < SERVICE_COUNTER_CAPACITY
      && serviceTable;

    if (!validReservation) {
      return {
        staff: completedStaff,
        customers, queue, tables,
        serviceItems: item?.assignedStaffId === staff.id
           ? clearDrinkReservation(serviceItems, staff.task.serviceItemId, state.restaurant?.gameTime)
          : serviceItems,
      };
    }

    if (item.state === 'ordered') {
      const preparationStartedAt = state.restaurant.gameTime;
      const hasProgress = Number.isFinite(item.accumulatedWork) && item.accumulatedWork > 0;
      return {
        staff: clearNavigationGoal({
          ...staff,
          task: {
            ...staff.task,
            preparationStartedAt: hasProgress && Number.isFinite(item.preparationStartedAt)
              ? item.preparationStartedAt : preparationStartedAt,
            accumulatedWork: Number.isFinite(item.accumulatedWork)
              ? Math.max(0, item.accumulatedWork) : 0,
            lastProgressAt: Number.isFinite(item.lastProgressAt)
              ? item.lastProgressAt : preparationStartedAt,
          },
        }),
        customers, queue, tables,
        serviceItems: serviceItems.map(candidate => candidate.id === item.id
          ? {
            ...candidate,
            state: 'preparing',
            preparationStartedAt: hasProgress && Number.isFinite(item.preparationStartedAt)
              ? item.preparationStartedAt : preparationStartedAt,
            accumulatedWork: Number.isFinite(item.accumulatedWork)
              ? Math.max(0, item.accumulatedWork) : 0,
            lastProgressAt: Number.isFinite(item.lastProgressAt)
              ? item.lastProgressAt : preparationStartedAt,
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

    const carriedIds = getCarriedServiceItemIds(staff);
    if (carriedIds.length >= getStaffCarryCapacity(staff)
      && !carriedIds.some(id => sameId(id, item.id))) {
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

    const nextCarriedIds = carriedIds.some(id => sameId(id, item.id))
      ? carriedIds : [...carriedIds, item.id];
    const nextServiceItems = serviceItems.map(candidate => candidate.id === item.id
      ? {
        ...candidate,
        state: 'carried',
        stationId: null,
        assignedStaffId: staff.id,
        x: staff.x,
        y: staff.y,
        readyAt: null,
      }
      : candidate);
    const nextStaff = withCarriedServiceItemIds(completedStaff, nextCarriedIds);
    const routed = continueCarriedCookTask(
      {
        ...state,
        staff: (state.staff || []).map(worker => worker.id === staff.id ? nextStaff : worker),
        serviceItems: nextServiceItems,
      },
      nextStaff,
      nextServiceItems,
    );
    return {
      staff: routed,
      customers, queue, tables,
      serviceItems: nextServiceItems,
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
          preparationStartedAt: Number.isFinite(candidate.accumulatedWork)
            && candidate.accumulatedWork > 0 && Number.isFinite(candidate.preparationStartedAt)
            ? candidate.preparationStartedAt : state.restaurant.gameTime,
          accumulatedWork: Number.isFinite(candidate.accumulatedWork)
            ? Math.max(0, candidate.accumulatedWork) : 0,
          lastProgressAt: Number.isFinite(candidate.lastProgressAt)
            ? candidate.lastProgressAt : state.restaurant.gameTime,
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
  const positionedStaff = allocateStaffPositions(state, state.staff || []);
  if (!positionedStaff) return quarantineNavigation(state);
  state = {
    ...state,
    staff: positionedStaff,
    cashierStations: clearUnavailableCashierAssignments(
      state.cashierStations,
      state.staff,
      state.restaurant?.gameTime,
    ),
  };
  state = normaliseServiceItemOwnership(state);
  state = normaliseCookingBatches(state);
  state = reconcilePreparationStationOwnership(state, state.restaurant?.gameTime);
  state = normaliseCleaningActionOwners(state);
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
    withCarriedServiceItemIds(s, getCarriedServiceItemIds(s)));

  // Task 3 saves may contain a drink reservation whose task predates the
  // station reference. Keep its durable work ledger, but release the stale
  // counter/staff claim so the current assignment pass can choose a reachable
  // dispenser and resume without crediting time spent away from it.
  const legacyDrinkReservationIds = new Set();
  for (const worker of staff) {
    if (worker.task?.type !== 'prepare_drink' || worker.task.stationId != null) continue;
    const item = serviceItems.find(candidate => candidate.id === worker.task.serviceItemId);
    const legacyState = { ...state, staff };
    if (!item || !hasValidDrinkReservation(legacyState, item)) continue;
    legacyDrinkReservationIds.add(String(item.id));
  }
  if (legacyDrinkReservationIds.size > 0) {
    const now = restaurant?.gameTime;
    serviceItems = serviceItems.map(item => legacyDrinkReservationIds.has(String(item.id))
      ? releaseLegacyDrinkReservation(serviceItems, item.id, now).find(candidate => candidate.id === item.id)
      : item);
    staff = staff.map(worker => legacyDrinkReservationIds.has(String(worker.task?.serviceItemId))
      ? clearNavigationGoal({ ...worker, task: null })
      : worker);
  }
  const activityState = { ...state, staff, customers, tables, serviceItems, cookingBatches };
  // Each optional destination sees claims accepted earlier in this tick. Use
  // stable IDs rather than array order, without changing the returned staff order.
  const activityOrder = staff.map((_, index) => index).sort((left, right) => {
    const a = String(staff[left].id);
    const b = String(staff[right].id);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const index of activityOrder) {
    if (staff[index].navigationYield
      || (staff[index].movementResidency?.kind !== 'staff_amenity'
        && (staff[index].task || isStaffWorkEligible(staff[index], restaurant?.gameTime)))) {
      staff[index] = prepareStaffActivity(activityState, staff[index]);
    }
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
       || hasValidDrinkReservation({ ...state, staff, serviceItems }, item)) return item;
    return {
      ...item,
      state: 'ordered',
      stationId: null,
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
      ...(Number.isFinite(item.accumulatedWork) && item.accumulatedWork > 0
        ? {} : { preparationStartedAt: null, readyAt: null }),
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
      || hasObsoleteCustomerTask(worker, customers, tables, serviceItems, state.washStations || [], restaurant?.gameTime)) continue;
    const currentState = { ...state, staff, customers, tables, serviceItems };
    const id = String(worker.id);
    const record = state.movementCoordinator?.records?.get?.(id);
    const status = state.movementCoordinator?.statuses?.get?.(id);
    const persistentlyBlocked = record?.goal?.x === worker.navigationGoal.x
      && record?.goal?.y === worker.navigationGoal.y
      && (record.waitingSeconds || 0) >= 2
      && ['traffic', 'destination-owned', 'static-geometry'].includes(status?.reason);
    if (!persistentlyBlocked && isStaffDestinationAvailable(currentState, worker.navigationGoal, worker)) continue;
    const tableId = worker.task.type === 'take_order'
      ? customers.find(customer => customer.id === worker.task.customerId)?.tableId
      : serviceItems.find(item => item.id === worker.task.serviceItemId)?.tableId;
    const table = tables.find(candidate => candidate.id === tableId);
    const target = table && targetForTable(currentState, table, worker,
      persistentlyBlocked ? worker.navigationGoal : null);
    if (target) staff[i] = setNavigationGoal(worker, target.goal);
  }

  const preparationArrivalIds = staff
    .filter(worker => ['prepare_dish', 'prepare_drink'].includes(worker.task?.type))
    .filter(worker => {
      const station = (state.kitchenStations || []).find(candidate =>
        sameId(candidate.id, worker.task.stationId));
      return station && !isAtPreparationPosition(worker, station);
    })
    .map(worker => String(worker.id));

  return {
    ...state, staff, customers, queue, tables, serviceItems, completedCustomers,
    pendingPartyReviews, partyReviewHistory, floorDirt, restaurant,
    queueAdmissionGate,
    ...(cookingBatches ? { cookingBatches } : {}),
    __staffClaimedServiceItemIds: cookDrinkTaskServiceItemIds,
    __preparationArrivalIds: preparationArrivalIds,
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

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function workerOwnsItem(worker, itemId) {
  return getCarriedServiceItemIds(worker).some(id => sameId(id, itemId));
}

function isStaffTaskExecutable(state, worker) {
  const task = worker?.task;
  if (task && !isStaffTaskRoleAllowed(task, worker.role)) return false;
  if (!task || task.type !== 'place_dish_on_service') return true;
  const item = (state.serviceItems || []).find(candidate =>
    sameId(candidate.id, task.serviceItemId));
  const customer = (state.customers || []).find(candidate =>
    sameId(candidate.id, item?.customerId));
  const serviceTable = (state.serviceTables || []).find(candidate =>
    sameId(candidate.id, task.serviceTableId));
  return worker.role === 'cook'
    && item?.state === 'carried'
    && ['dish', 'drink'].includes(item.kind)
    && workerOwnsItem(worker, item.id)
    && sameId(item.assignedStaffId, worker.id)
    && sameId(item.serviceTableId, task.serviceTableId)
    && item.serviceSlotIndex === task.serviceSlotIndex
    && customer?.state !== 'leaving'
    && serviceTable;
}

function isPreparationTaskResolvable(state, worker) {
  const task = worker?.task;
  if (!['prepare_dish', 'prepare_drink'].includes(task?.type) || worker.role !== 'cook') return false;
  const item = (state.serviceItems || []).find(candidate =>
    candidate.id === task.serviceItemId);
  if (task.type === 'prepare_drink') {
    const station = (state.kitchenStations || []).find(candidate =>
      sameId(candidate.id, task.stationId));
    const customer = (state.customers || []).find(candidate =>
      sameId(candidate.id, item?.customerId));
    return item?.kind === 'drink'
      && ['ordered', 'preparing'].includes(item.state)
      && sameId(item.assignedStaffId, worker.id)
      && sameId(item.stationId, task.stationId)
      && station?.equipmentId == null
      && customer?.state !== 'leaving'
      && sameId(task.serviceTableId, item.serviceTableId)
      && task.serviceSlotIndex === item.serviceSlotIndex
      && Number.isInteger(item.serviceSlotIndex)
      && item.serviceSlotIndex >= 0
      && item.serviceSlotIndex < SERVICE_COUNTER_CAPACITY
      && (state.serviceTables || []).some(table => sameId(table.id, item.serviceTableId));
  }
  const dish = item
    ? (state.dishes || []).find(candidate => candidate.id === item.menuItemId)
    : null;
  const station = (state.kitchenStations || []).find(candidate =>
    candidate.id === task.stationId);
  if (!item || item.kind !== 'dish' || !dish || !station
    || !isDishCompatibleWithStation(state, dish, station)) return false;
  const taskItemIds = new Set([
    ...(Array.isArray(task.serviceItemIds) ? task.serviceItemIds : []),
    task.serviceItemId,
  ].filter(id => id != null).map(id => String(id)));
  const taskMatchesItem = taskItemIds.has(String(item.id));
  const assignmentMatches = item.state === 'ordered'
    ? item.assignedStaffId == null || sameId(item.assignedStaffId, worker.id)
    : item.assignedStaffId != null && sameId(item.assignedStaffId, worker.id)
      && sameId(item.stationId, task.stationId);
  return taskMatchesItem && ['ordered', 'preparing', 'ready'].includes(item.state)
    && assignmentMatches;
}

function pausePreparationProgress(state, worker, now) {
  if (!Number.isFinite(now) || !['prepare_dish', 'prepare_drink'].includes(worker.task?.type)) {
    return state;
  }
  const itemIds = new Set([
    worker.task.serviceItemId,
    ...(Array.isArray(worker.task.serviceItemIds) ? worker.task.serviceItemIds : []),
  ].filter(id => id != null).map(id => String(id)));
  const serviceItems = (state.serviceItems || []).map(item => {
    if (!itemIds.has(String(item.id)) || item.assignedStaffId !== worker.id
      || !['ordered', 'preparing', 'ready'].includes(item.state)) return item;
    return {
      ...item,
      accumulatedWork: Number.isFinite(item.accumulatedWork)
        ? Math.max(0, item.accumulatedWork) : 0,
      lastProgressAt: Math.max(Number.isFinite(item.lastProgressAt) ? item.lastProgressAt : now, now),
    };
  });
  const task = {
    ...worker.task,
    accumulatedWork: Number.isFinite(worker.task.accumulatedWork)
      ? Math.max(0, worker.task.accumulatedWork) : 0,
    lastProgressAt: Math.max(Number.isFinite(worker.task.lastProgressAt) ? worker.task.lastProgressAt : now, now),
  };
  return {
    ...state,
    serviceItems,
    staff: (state.staff || []).map(candidate => candidate.id === worker.id
      ? { ...candidate, task }
      : candidate),
  };
}

function preparationStationClaim(state, worker) {
  const task = worker?.task;
  if (!['prepare_dish', 'prepare_drink'].includes(task?.type)
    || !isPreparationTaskResolvable(state, worker)
    || task.stationId == null) return null;
  return {
    workerId: worker.id,
    stationId: String(task.stationId),
    sortKey: `${String(worker.id ?? '\uffff')}\u0000${String(task.serviceItemId ?? '\uffff')}\u0000${String(task.batchId ?? '')}`,
  };
}

function reconcilePreparationStationOwnership(state, now) {
  const claims = (state.staff || [])
    .map(worker => preparationStationClaim(state, worker))
    .filter(Boolean)
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const ownedStations = new Set();
  const losingWorkers = [];
  for (const claim of claims) {
    if (ownedStations.has(claim.stationId)) losingWorkers.push(claim.workerId);
    else ownedStations.add(claim.stationId);
  }

  const released = losingWorkers.reduce((current, workerId) =>
    releaseStaffWork(current, workerId, 'conflicting-preparation', now), state);
  if (ownedStations.size === 0) return released;
  return {
    ...released,
    __preparationStationClaims: [
      ...new Set([...(released.__preparationStationClaims || []), ...ownedStations]),
    ],
  };
}

function requeueCancelledCarriedItem(item, worker, state) {
  return {
    ...item,
    state,
    x: Number.isFinite(worker?.x) ? worker.x : item.x,
    y: Number.isFinite(worker?.y) ? worker.y : item.y,
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
    const customer = customers.find(candidate => candidate.id === item.customerId);
    const foodExpired = Number.isFinite(state.restaurant?.gameTime)
      && Number.isFinite(customer?.foodDeadlineAt)
      && state.restaurant.gameTime >= customer.foodDeadlineAt;
    if (item.state === 'carried_dirty') {
      if (staff.role !== 'waiter') continue;
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
    if (item.foodCancelled === true || foodExpired) continue;
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
    const customer = (state.customers || []).find(candidate => candidate.id === item?.customerId);
    const foodExpired = Number.isFinite(state.restaurant?.gameTime)
      && Number.isFinite(customer?.foodDeadlineAt)
      && state.restaurant.gameTime >= customer.foodDeadlineAt;
    if (item?.foodCancelled === true || foodExpired) continue;
    const serviceTable = item
      ? (state.serviceTables || []).find(table => table.id === item.serviceTableId)
      : null;
    if (!item || !['dish', 'drink'].includes(item.kind) || item.state !== 'carried'
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
           ...(item.kind === 'dish' && item.batchId != null ? {
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

function reconcileCarriedInventory(staff, serviceItems, customers, tables, serviceTables, now = null) {
  const nextIds = [];
  const recoveredIds = new Set();
  const cancelledCookIds = new Set();
  const cancelledWaiterIds = new Set();
  let nextServiceItems = serviceItems;
  let inventoryKind = null;
  const capacity = getStaffCarryCapacity(staff);
  for (const itemId of getCarriedServiceItemIds(staff)) {
    const item = serviceItems.find(candidate => String(candidate.id) === String(itemId));
    if (!item || !['carried', 'carried_dirty'].includes(item.state)) continue;
    const customer = customers.find(candidate => String(candidate.id) === String(item.customerId));
    const table = tables.find(candidate => String(candidate.id) === String(item.tableId));
    const cookServiceTable = serviceTables.find(candidate =>
      String(candidate.id) === String(item.serviceTableId));
    const validCookDestination = staff.role === 'cook'
      && ['dish', 'drink'].includes(item.kind)
      && item.assignedStaffId === staff.id
      && customer?.state !== 'leaving'
      && cookServiceTable
      && Number.isInteger(item.serviceSlotIndex)
      && item.serviceSlotIndex >= 0
      && item.serviceSlotIndex < SERVICE_COUNTER_CAPACITY;
    const foodExpired = Number.isFinite(now)
      && Number.isFinite(customer?.foodDeadlineAt)
      && now >= customer.foodDeadlineAt;
    const cancelledWaiterLoad = staff.role === 'waiter'
      && item.state === 'carried'
      && (item.foodCancelled === true || foodExpired);
    if (cancelledWaiterLoad) cancelledWaiterIds.add(item.id);
    if (staff.role === 'cook' && item.state === 'carried'
      && (item.foodCancelled === true || foodExpired)) {
      recoveredIds.add(item.id);
      cancelledCookIds.add(String(item.id));
      continue;
    }
    const invalidCleanDestination = !cancelledWaiterLoad && item.state === 'carried'
      && item.foodCancelled !== true
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
    const itemKind = cancelledWaiterLoad || item.state === 'carried_dirty' ? 'dirty' : 'clean';
    if (inventoryKind == null) inventoryKind = itemKind;
    if (itemKind !== inventoryKind || nextIds.length >= capacity) {
      recoveredIds.add(item.id);
      continue;
    }
    nextIds.push(item.id);
  }
  if (recoveredIds.size > 0 || cancelledWaiterIds.size > 0) {
    nextServiceItems = serviceItems.map(item => {
      const recovered = recoveredIds.has(item.id);
      if (cancelledWaiterIds.has(item.id) && !recovered) {
        return requeueCancelledCarriedItem(item, staff, 'carried_dirty');
      }
      if (!recovered) return item;
      if (cancelledCookIds.has(String(item.id))) {
        return requeueCancelledCarriedItem(item, staff, 'to_clean');
      }
      if (cancelledWaiterIds.has(item.id)) {
        return requeueCancelledCarriedItem(item, staff, 'to_clean');
      }
      if (item.state === 'carried_dirty') {
        return item.tableId != null && tables.some(table => table.id === item.tableId)
          ? {
            ...item,
            state: 'dirty_at_table',
            assignedStaffId: null,
            washStationId: null,
            reservedWashStationId: null,
            washStartedAt: null,
          }
          : {
            ...item,
            state: 'queued_for_wash',
            washStationId: null,
            reservedWashStationId: null,
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
     const target = station ? findPreparationTarget(state, station, staff) : null;
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
  if ((state.serviceItems || []).some(item => item.kind === 'drink')
    || (state.staff || []).some(worker => worker.task?.type === 'prepare_drink')) {
    state = normaliseServiceItemOwnership(state);
  }
  state = normaliseCookingBatches(state);
  state = reconcilePreparationStationOwnership(state, state.restaurant?.gameTime);
  state = normaliseCleaningActionOwners(state);
  let {
    staff, customers, queue, serviceItems, completedCustomers,
    pendingPartyReviews, partyReviewHistory, floorDirt, restaurant, cookingBatches,
  } = state;
  let queueAdmissionGate = state.queueAdmissionGate ?? null;
  let queueSlots = Array.isArray(state.queueSlots) ? state.queueSlots : [];
  let tables = state.tables || [];
  const preparationArrivalIds = new Set(
    (state.__preparationArrivalIds || []).map(id => String(id)),
  );
  const claimedCustomerIds = new Set();
  const claimedServiceItemIds = new Set();
  const claimedTableIds = new Set();
  const claimedDirtIds = new Set();
  (state.__staffClaimedServiceItemIds || []).forEach(id => claimedServiceItemIds.add(id));
  for (const worker of staff) {
    if (!worker.task || !isStaffTaskExecutable(state, worker)) continue;
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
      staff[i], serviceItems, customers, tables, state.serviceTables || [], restaurant?.gameTime,
    );
    staff[i] = reconciledInventory.staff;
    serviceItems = reconciledInventory.serviceItems;
    let s = staff[i];
    const status = getMovementStatus(state, statuses, s.id);

    if (s.task && !isStaffTaskExecutable({ ...state, serviceItems }, s)) {
      const released = releaseStaffWork({
        ...state,
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
        cookingBatches,
      }, s.id, 'invalid-task', restaurant.gameTime);
      staff = released.staff || staff;
      customers = released.customers || customers;
      queue = released.queue || queue;
      tables = released.tables || tables;
      serviceItems = released.serviceItems || serviceItems;
      completedCustomers = released.completedCustomers || completedCustomers;
      pendingPartyReviews = released.pendingPartyReviews || pendingPartyReviews;
      partyReviewHistory = released.partyReviewHistory || partyReviewHistory;
      floorDirt = released.floorDirt || floorDirt;
      cookingBatches = released.cookingBatches || cookingBatches;
      continue;
    }

    // Cancellation cannot depend on reaching a destination which may itself be
    // blocked forever. Valid work still requires certified arrival below.
    const obsolete = s.task
      && hasObsoleteCustomerTask(s, customers, tables, serviceItems, state.washStations || [], restaurant?.gameTime);
    if (obsolete) {
      const released = releaseStaffWork({
        ...state,
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
        cookingBatches,
      }, s.id, 'cancelled', restaurant.gameTime);
      staff = released.staff || staff;
      customers = released.customers || customers;
      queue = released.queue || queue;
      tables = released.tables || tables;
      serviceItems = released.serviceItems || serviceItems;
      completedCustomers = released.completedCustomers || completedCustomers;
      pendingPartyReviews = released.pendingPartyReviews || pendingPartyReviews;
      partyReviewHistory = released.partyReviewHistory || partyReviewHistory;
      floorDirt = released.floorDirt || floorDirt;
      cookingBatches = released.cookingBatches || cookingBatches;
      continue;
    }

    if (preparationArrivalIds.has(String(s.id))
      && status.plan === 'arrived'
      && isPreparationTaskResolvable({ ...state, staff, serviceItems }, s)) {
      const paused = pausePreparationProgress({ ...state, staff, serviceItems }, s, restaurant?.gameTime);
      staff = paused.staff || staff;
      serviceItems = paused.serviceItems || serviceItems;
      s = staff[i];
    }

    // Preparation work is the only task whose interaction point is narrower
    // than an adjacent navigation cell. A stale arrival status must not let a
    // cook begin or resume work from elsewhere in that cell.
    if (['prepare_dish', 'prepare_drink'].includes(s.task?.type)
      && isPreparationTaskResolvable({ ...state, staff, serviceItems }, s)) {
      const station = (state.kitchenStations || []).find(candidate =>
        candidate.id === s.task.stationId);
      if (station && !isAtPreparationPosition(s, station)) {
        const target = findPreparationTarget({ ...state, staff }, station, s);
        if (target) {
          staff[i] = markTaskAssigned(setNavigationGoal(s, target.goal));
          continue;
        }
        // A valid station may be temporarily blocked by another actor's
        // destination. Keep the reservation paused in that case. If no side
        // position is statically reachable even after ignoring other actors,
        // release it so a new reachable dispenser/station can be selected.
        const staticTarget = findPreparationTarget(
          { ...state, staff: [s] },
          station,
          s,
        );
        if (staticTarget) {
          const paused = pausePreparationProgress({ ...state, staff, serviceItems }, s, restaurant?.gameTime);
          staff = paused.staff || staff;
          serviceItems = paused.serviceItems || serviceItems;
          staff[i] = markTaskAssigned(clearNavigationGoal(staff[i]));
          continue;
        }
        // Recovery must preserve work committed by earlier workers this tick,
        // including deliveries and the customers' consumption state.
        const paused = pausePreparationProgress({
          ...state, restaurant, staff, customers, queue, tables, serviceItems,
          completedCustomers, pendingPartyReviews, partyReviewHistory, floorDirt,
          queueAdmissionGate, queueSlots, cookingBatches,
        }, s, restaurant?.gameTime);
        const released = releaseStaffWork(paused, s.id, 'blocked-preparation', restaurant?.gameTime);
        staff = released.staff || staff;
        customers = released.customers || customers;
        queue = released.queue || queue;
        tables = released.tables || tables;
        serviceItems = released.serviceItems || serviceItems;
        completedCustomers = released.completedCustomers || completedCustomers;
        pendingPartyReviews = released.pendingPartyReviews || pendingPartyReviews;
        partyReviewHistory = released.partyReviewHistory || partyReviewHistory;
        floorDirt = released.floorDirt || floorDirt;
        cookingBatches = released.cookingBatches || cookingBatches;
        continue;
      }
    }
    if (s.task && status.plan !== 'arrived') {
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

    if (s.navigationYield) {
      staff[i] = s;
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

  const {
    __staffClaimedServiceItemIds,
    __preparationStationClaims,
    __preparationArrivalIds,
    ...cleanState
  } = state;
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
  const positionedStaff = allocateStaffPositions(state, state.staff || []);
  if (!positionedStaff) return quarantineNavigation(state);
  const positionedState = { ...state, staff: positionedStaff };
  // `updateStaff` remains a standalone compatibility entry point for callers
  // that do not run the canonical game loop. runTick owns wellbeing and never
  // calls this wrapper, so this legacy drain cannot be applied twice there.
  const standaloneState = gameDt > 0
    ? {
        ...positionedState,
        staff: positionedState.staff.map(worker => ({
          ...worker,
          morale: Math.max(0, worker.morale - 0.01 * gameDt / 60),
        })),
      }
    : positionedState;
  const prepared = prepareStaffForMovement(standaloneState, gameDt);
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
