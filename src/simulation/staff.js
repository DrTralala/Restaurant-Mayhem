import { cellToWorld, findAdjacentOpenCells, findPath, isInsideWorld, worldToCell } from './pathfinding';
import { advanceCharacterMovementBatch, getCharacterMovementStatus } from './movement';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
import { recordSeatResidency } from './movement/seatedDeparture';
import { chooseFollowerGoal, validFollowerGoal } from './navigation/following';
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
import { startCustomerConsumption } from './consumption';
import { hasWashStationCapacity } from './dishwashing';
import {
  getCustomerGuideContext,
  getGuidePartyContext,
  markTableDirtyIfInUse,
  normaliseTableReservationOwners,
  releaseTableReservation,
  reserveTableForGuide,
  taskCustomerIds,
} from './guidance';
import { buildChairApproachAssignments, getChairCentre, validateChairApproachAssignments } from './seating';
import { isCheckoutState, requeueCheckoutCustomer } from './checkout';
import {
  getStaffMovementSpeed,
  markTaskAssigned,
  markWorking,
  prepareStaffActivity,
  settleTasklessActivity,
} from './staffActivity';
import { findOldestCompatibleQueueParty, getQueueVisibleMembers } from './customerQueue';
import { getQueueAdmissionGateStatus, planQueuePartyAdmission } from './queueAdmission';
import {
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
    return { ...worker, ...position, task: worker.task || null };
  });
}

const CHARACTER_START_SPACING = 16;

function findGuidedCustomerStart(state, customer, occupiedActors) {
  const fallbackReference = getDoorPosition(state, getDoors(state)[0]).outside;
  const preferred = {
    x: Number.isFinite(customer.x) ? customer.x : fallbackReference.x,
    y: Number.isFinite(customer.y) ? customer.y : fallbackReference.y,
  };
  const world = getRestaurantWorld(state.restaurant || {});
  const preserveX = Number.isFinite(customer.x)
    && isInsideWorld(state, worldToCell({ x: customer.x, y: fallbackReference.y }));
  const preserveY = Number.isFinite(customer.y)
    && isInsideWorld(state, worldToCell({ x: fallbackReference.x, y: customer.y }));
  const candidates = [preferred];

  const firstCell = worldToCell({ x: world.floorX, y: world.kitchenY });
  const lastCell = worldToCell({
    x: world.queueX + world.queueW,
    y: world.diningY + world.areaH + 50,
  });
  const fallbackCandidates = [];
  for (let y = firstCell.y; y <= lastCell.y; y += 1) {
    for (let x = firstCell.x; x <= lastCell.x; x += 1) {
      const point = cellToWorld({ x, y });
      fallbackCandidates.push({
        x: preserveX ? customer.x : point.x,
        y: preserveY ? customer.y : point.y,
      });
    }
  }
  fallbackCandidates.sort((left, right) =>
    Math.hypot(left.x - preferred.x, left.y - preferred.y)
      - Math.hypot(right.x - preferred.x, right.y - preferred.y)
    || left.y - right.y
    || left.x - right.x);

  const seen = new Set();
  return [...candidates, ...fallbackCandidates].find(candidate => {
    const key = `${candidate.x},${candidate.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Number.isFinite(candidate.x)
      && Number.isFinite(candidate.y)
      && isInsideWorld(state, worldToCell(candidate))
      && occupiedActors.every(actor => Math.hypot(candidate.x - actor.x, candidate.y - actor.y)
        >= CHARACTER_START_SPACING);
  }) || null;
}

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

function getAvailableChairs(tableId, customers = [], activeGuideTasks = [], chairs = []) {
  const occupiedChairIds = new Set(customers
    .filter(customer => customer.state !== 'leaving' && customer.chairId)
    .map(customer => customer.chairId));
  const reservedChairIds = new Set(activeGuideTasks
    .filter(task => task.tableId === tableId)
    .flatMap(task => task.reservedChairIds || task.chairIds || []));

  return chairs.filter(chair => {
    const centre = getChairCentre(chair);
    return chair.tableId === tableId && centre
      && !occupiedChairIds.has(chair.id)
      && !reservedChairIds.has(chair.id)
      // Leaving is a lifecycle state, not proof that the chair is physically clear.
      && customers.every(customer => customer.state !== 'leaving'
        || !Number.isFinite(customer.x) || !Number.isFinite(customer.y)
        || Math.hypot(customer.x - centre.x, customer.y - centre.y) >= CHARACTER_START_SPACING);
  });
}

function getActiveGuideTasks(staff, excludeStaffId = null) {
  return (staff || [])
    .filter(candidate => candidate.id !== excludeStaffId && candidate.task?.type === 'guide_customer')
    .map(candidate => candidate.task);
}

function findReachableTable(state, tables, staff, partySize = 1, activeGuideTasks = []) {
  for (const table of tables) {
    if (table.status !== 'empty') continue;
    const availableChairs = getAvailableChairs(
      table.id,
      state.customers || [],
      activeGuideTasks,
      state.chairs || [],
    );
    const distinctChairs = availableChairs.filter((chair, index, chairs) =>
      chairs.findIndex(candidate => candidate.id === chair.id) === index,
    );
    const chairCount = (state.chairs || []).filter(chair => chair.tableId === table.id).length;
    if ((table.seats || chairCount) < partySize || distinctChairs.length < partySize) continue;
    const target = targetForTable(state, table, staff);
    if (target) return { table, target, chairs: distinctChairs.slice(0, partySize) };
  }
  return null;
}

function getWaitingParty(members, lead) {
  if (!lead) return [];
  if (!lead.partyId) return [lead];
  return members.filter(member => member.partyId === lead.partyId);
}

function getPartySize(party, lead) {
  return Math.max(party.length, Number.isFinite(lead?.partySize) ? lead.partySize : 0);
}

function withoutEntryDoorId(customer) {
  const { entryDoorId: _entryDoorId, ...withoutEntryDoor } = customer;
  return withoutEntryDoor;
}

function leavingFields(customer) {
  return clearNavigationGoal({
    ...withoutEntryDoorId(customer),
    state: 'leaving',
    exitPhase: 'to_door',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: null,
    checkoutPosition: null,
    cashierStationId: null,
    paymentReady: false,
  });
}

function hasMatchingQueueAdmissionTask(worker, gate) {
  if (worker.id !== gate.guideStaffId
    || worker.task?.type !== 'guide_customer'
    || worker.task.partyId !== gate.partyId
    || worker.task.tableId !== gate.tableId
    || worker.task.customerId !== gate.customerIds?.[0]) return false;
  const taskIds = taskCustomerIds(worker.task);
  return Array.isArray(gate.customerIds)
    && Array.isArray(taskIds)
    && taskIds.length === gate.customerIds.length
    && taskIds.every((id, index) => id === gate.customerIds[index]);
}

function cancelGuideTask({ staff, customers, queue, tables, serviceItems }) {
  const ids = taskCustomerIds(staff.task);
  return {
    staff: clearNavigationGoal({ ...staff, task: null }),
    serviceItems,
    queue,
    tables: tables.map(table => table.id === staff.task.tableId
      && table.status === 'reserved'
      && table.reservationOwnerStaffId === staff.id
      ? releaseTableReservation(table, 'empty')
      : table),
    customers: customers.map(customer => ids.includes(customer.id)
      ? leavingFields({ ...customer, tableId: null, guideStaffId: null, chairId: null })
      : customer),
  };
}

function hasGenuineGuideParty(customers, ids, staff) {
  const customersById = new Map(customers.map(customer => [customer.id, customer]));
  return ids.every(id => {
    const customer = customersById.get(id);
    return customer?.state === 'guided'
      && customer.guideStaffId === staff.id
      && customer.tableId === staff.task.tableId;
  });
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

function isTableReadyForCleaning(tableId, customers, serviceItems) {
  const hasBlockingCustomer = customers.some(customer => customer.tableId === tableId
    && customer.state !== 'leaving' && !isCheckoutState(customer));
  const hasDirtyItem = serviceItems.some(item => item.tableId === tableId
    && item.state === 'dirty_at_table');
  return !hasBlockingCustomer && !hasDirtyItem;
}

function projectedWashWorkload(state, station, staff, serviceItems, allStaff) {
  const duration = washDuration(station);
  const active = serviceItems.find(item => item.state === 'washing' && item.washStationId === station.id);
  const activeRemaining = active && Number.isFinite(active.washStartedAt)
    && Number.isFinite(state.restaurant?.gameTime)
    ? Math.max(0, duration - (state.restaurant.gameTime - active.washStartedAt))
    : active ? duration : 0;
  const queuedCount = serviceItems.filter(item => item.state === 'queued_for_wash'
    && item.washStationId === station.id).length;
  const pendingDeliveries = (allStaff || state.staff || []).filter(worker => worker.id !== staff.id
    && worker.task?.type === 'deliver_dirty_item'
    && worker.task.washStationId === station.id).length;
  return activeRemaining + (queuedCount + pendingDeliveries) * duration;
}

function selectWashStation(state, staff, serviceItems, allStaff) {
  const occupancyState = { ...state, staff: allStaff || state.staff || [], serviceItems };
  return (state.washStations || [])
    .filter(station => hasWashStationCapacity(occupancyState, station))
    .map(station => ({
      station,
      target: targetForRectOrCurrent(state, station, staff),
      workload: projectedWashWorkload(state, station, staff, serviceItems, allStaff),
    }))
    .filter(candidate => candidate.target !== null)
    .sort((left, right) => left.workload - right.workload
      || left.target.distance - right.target.distance
      || String(left.station.id).localeCompare(String(right.station.id)))[0] || null;
}

function hasExactDrinkReservation(staff, item, serviceTables) {
  if (!item || item.kind !== 'drink' || !['ordered', 'preparing'].includes(item.state)) return false;
  const owner = (staff || []).find(candidate => candidate.id === item.assignedStaffId);
  return owner?.id != null
    && owner?.role === 'waiter'
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
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
    }
    : item);
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
          serviceItems: washItem.washStationId == null
            ? serviceItems.map(item => item === washItem ? { ...item, washStationId: station.id } : item)
            : serviceItems,
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
    if (staff.carryingServiceItemId != null) {
      const item = serviceItems.find(candidate => candidate.id === staff.carryingServiceItemId);
      if (item?.state === 'carried_dirty') {
        const stationChoice = selectWashStation(state, staff, serviceItems, allStaff);
        if (stationChoice) {
          return {
            staff: setNavigationGoal(
              { ...staff, task: { type: 'deliver_dirty_item', serviceItemId: item.id, washStationId: stationChoice.station.id } },
              stationChoice.target.goal,
            ),
            claimedServiceItemId: item.id,
          };
        }
        return null;
      }
      const customer = item && customers.find(candidate => candidate.id === item.customerId);
      const table = item && tables.find(candidate => candidate.id === item.tableId);
      const target = table ? targetForTable(state, table, staff) : null;
      const canReachTable = table && target;
      if (item?.state === 'carried'
        && customer
        && customer.state !== 'leaving'
        && customer?.id === item.customerId
        && customer?.tableId === item.tableId
        && canReachTable) {
        return {
          staff: setNavigationGoal(
            { ...staff, task: { type: 'deliver_service_item', serviceItemId: item.id, customerId: item.customerId } },
            target.goal,
          ),
        };
      }

      return null;
    }

    const readyServiceItem = serviceItems.find(item => {
      if (item.state !== 'on_service'
        || claimedServiceItemIds?.has(item.id)
        || (state.staff || []).some(candidate => candidate.id !== staff.id
          && candidate.carryingServiceItemId === item.id)) return false;
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

    const pendingDrink = serviceItems.find(item => {
      if (item.kind !== 'drink' || !['ordered', 'preparing'].includes(item.state)
        || item.assignedStaffId != null
        || claimedServiceItemIds?.has(item.id)) return false;
      const customer = customers.find(candidate => candidate.id === item.customerId);
      return customer && customer.state !== 'leaving';
    });
    if (pendingDrink) {
      const slot = findAvailableServiceSlot({ ...state, staff: allStaff, serviceItems });
      const serviceTable = slot
        ? (state.serviceTables || []).find(table => table.id === slot.serviceTableId)
        : null;
      const target = serviceTable
        ? targetForRectOrCurrent(
          state,
          getServiceTableRect(serviceTable),
          staff,
        )
        : null;
      if (slot && target) {
        return {
          staff: setNavigationGoal(
            {
              ...staff,
              task: {
                type: 'prepare_drink',
                serviceItemId: pendingDrink.id,
                serviceTableId: slot.serviceTableId,
                serviceSlotIndex: slot.serviceSlotIndex,
              },
            },
            target.goal,
          ),
          serviceItems: serviceItems.map(item => item.id === pendingDrink.id
            ? {
              ...item,
              serviceTableId: slot.serviceTableId,
              serviceSlotIndex: slot.serviceSlotIndex,
              state: 'ordered',
              preparationStartedAt: null,
              assignedStaffId: staff.id,
            }
            : item),
          claimedServiceItemId: pendingDrink.id,
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

    const waitingPartyIds = new Set();
    for (const waiting of customers.filter(c => c.state === 'waiting' && (!claimedCustomerIds || !claimedCustomerIds.has(c.id)))) {
      const partyKey = waiting.partyId || waiting.id;
      if (waitingPartyIds.has(partyKey)) continue;
      waitingPartyIds.add(partyKey);
      const party = getWaitingParty(customers.filter(c => c.state === 'waiting'), waiting);
      const partySize = getPartySize(party, waiting);
      if (party.length < partySize) continue;
      const reachable = findReachableTable(
        { ...state, customers },
        tables,
        staff,
        partySize,
        getActiveGuideTasks(state.staff),
      );
      if (reachable) {
        const { table, target, chairs } = reachable;
        const partyIds = party.map(c => c.id);
        return {
          staff: setNavigationGoal(
            {
              ...staff,
              task: {
                type: 'guide_customer',
                customerId: waiting.id,
                customerIds: partyIds,
                partyId: waiting.partyId,
                tableId: table.id,
                chairIds: chairs.map(chair => chair.id),
                stage: 'follow_guide',
                approaches: [],
              },
            },
            target.goal,
          ),
          customers: customers.map(c => party.some(member => member.id === c.id)
            ? { ...c, state: 'guided', guideStaffId: staff.id, chairId: null }
            : c),
          tables: tables.map(t => t.id === table.id ? reserveTableForGuide(t, staff.id) : t),
          claimedCustomerIds: partyIds,
        };
      }
    }

    if (state.queueAdmissionGate == null) {
      let reachable = null;
      const party = findOldestCompatibleQueueParty(queue, candidate => {
        reachable = findReachableTable(
          { ...state, customers },
          tables,
          staff,
          candidate.members.length,
          getActiveGuideTasks(state.staff),
        );
        return reachable != null;
      });
      if (party && reachable) {
        const { table, target, chairs } = reachable;
        const doors = [...getDoors(state)].sort((left, right) =>
          Math.abs(left.y - staff.y) - Math.abs(right.y - staff.y)
            || String(left.id).localeCompare(String(right.id)));
        const planned = doors
          .map(door => planQueuePartyAdmission(
            { ...state, staff: allStaff || state.staff || [], customers },
            { party, door, guide: staff, guideGoal: target.goal, tableId: table.id },
          ))
          .find(Boolean) || null;
        if (planned) {
          const partyIds = party.members.map(customer => customer.id);
          return {
            staff: setNavigationGoal(
              {
                ...staff,
                task: {
                  type: 'guide_customer',
                  customerId: party.members[0].id,
                  customerIds: partyIds,
                  partyId: party.partyId,
                  tableId: table.id,
                  chairIds: chairs.map(chair => chair.id),
                  stage: 'follow_guide',
                  approaches: [],
                },
              },
              target.goal,
            ),
            customers: [...customers, ...planned.admittedCustomers],
            queue: queue.filter(record => record.partyId !== party.partyId),
            queueSlots: (state.queueSlots || []).filter(record =>
              String(record?.partyId) !== String(party.partyId)),
            tables: tables.map(t => t.id === table.id ? reserveTableForGuide(t, staff.id) : t),
            queueAdmissionGate: planned.gate,
            claimedCustomerIds: partyIds,
          };
        }
      }
    }

    const dirty = tables.find(t => t.status === 'dirty'
      && isTableReadyForCleaning(t.id, customers, serviceItems)
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
    const activeDishTasks = (state.staff || [])
      .filter(candidate => candidate.id !== staff.id && candidate.task?.type === 'prepare_dish')
      .map(candidate => candidate.task);
    const claimedServiceItemIds = new Set(activeDishTasks.map(task => task.serviceItemId));
    const occupiedStationIds = new Set([
      ...activeDishTasks.map(task => task.stationId),
      ...(state.serviceItems || [])
        .filter(item => item.kind === 'dish' && item.state === 'preparing')
        .map(item => item.stationId),
    ]);
    const pending = (state.serviceItems || []).find(item =>
      item.kind === 'dish'
      && item.state === 'ordered'
      && !claimedServiceItemIds.has(item.id));
    if (pending) {
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
        if (target) {
          return {
            staff: setNavigationGoal(
              { ...staff, task: { type: 'prepare_dish', serviceItemId: pending.id, stationId: station.id } },
              target.goal,
            ),
          };
        }
      }
    }
  }

  return null;
}

function getMovementStatus(state, statuses, id) {
  if (statuses instanceof Map) {
    return statuses.get(id) ?? statuses.get(String(id)) ?? getCharacterMovementStatus(state, id);
  }
  return getCharacterMovementStatus(state, id);
}

function canDeliverServiceItem(staff, item, customer, table) {
  return Boolean(customer
    && customer.state !== 'leaving'
    && item?.state === 'carried'
    && staff.carryingServiceItemId === item.id
    && item.customerId === customer.id
    && staff.task.serviceItemId === item.id
    && staff.task.customerId === item.customerId
    && item.tableId === customer.tableId
    && table?.id === item.tableId);
}

function hasObsoleteCustomerTask(staff, customers, tables, serviceItems) {
  const customer = customers.find(candidate => candidate.id === staff.task?.customerId);
  if (staff.task?.type === 'take_order') return !customer || customer.state !== 'seated';
  if (staff.task?.type === 'deliver_service_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    return !canDeliverServiceItem(staff, item, customer, table);
  }
  return false;
}

function resolveTask({
  state, staff, customers, queue, tables, serviceItems,
  pendingPartyReviews, partyReviewHistory, restaurant, statuses,
}) {
  const completedStaff = clearNavigationGoal({ ...staff, task: null });

  if (staff.task.type === 'take_order') {
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    if (!customer || customer.state !== 'seated') return { staff: completedStaff, customers, queue, tables, serviceItems };
    if (staff.task.startedAt == null) {
      return { staff: clearNavigationGoal({ ...staff, task: { ...staff.task, startedAt: state.restaurant.gameTime } }), queue, tables, serviceItems, customers };
    }
    if (state.restaurant.gameTime - staff.task.startedAt < ACTIVITY_DURATIONS.takeOrder) {
      return { staff: clearNavigationGoal(staff), queue, tables, serviceItems, customers };
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
        ? leavingFields({ ...candidate, departureReason: 'served' })
        : candidate);
      const remainingAtTable = updatedCustomers.some(candidate =>
        candidate.tableId === customer.tableId && candidate.state !== 'leaving');
      const carriedServiceItemIds = serviceItems
        .filter(item => item.customerId === customer.id && ['carried', 'carried_dirty'].includes(item.state))
        .map(item => item.id);
      return {
        staff: completedStaff,
        queue,
        customers: updatedCustomers,
        serviceItems: serviceItems.filter(item => item.customerId !== customer.id
          || !['ordered', 'preparing'].includes(item.state)),
        clearCarriedServiceItemIds: carriedServiceItemIds,
        tables: tables.map(table => table.id === customer.tableId && !remainingAtTable
          ? markTableDirtyIfInUse(table) : table),
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
        staff: clearNavigationGoal({ ...staff, task: { ...staff.task, startedAt: state.restaurant.gameTime } }),
        customers: customers.map(candidate => candidate.id === customer.id
          ? { ...candidate, state: 'checkout_processing', paymentReady: false }
          : candidate),
        queue, tables, serviceItems,
      };
    }
    if (state.restaurant.gameTime - staff.task.startedAt < ACTIVITY_DURATIONS.takePayment) {
      return { staff: clearNavigationGoal(staff), customers, queue, tables, serviceItems };
    }
    const legacyDishPrice = (state.dishes || []).find(candidate => candidate.id === customer.dishId)?.price || 0;
    const legacyDrinkPrice = getResolvedDrink(state, customer.drinkId)?.price || 0;
    const snapshotSubtotal = getOrderSnapshotSubtotal(customer);
    const price = snapshotSubtotal ?? legacyDishPrice + legacyDrinkPrice;
    const happiness = Number.isFinite(customer.happiness) ? customer.happiness : 80;
    const tip = Math.round(price * getTipRate(happiness) * 100) / 100;
    const reviewScore = getCustomerReviewScore(customer, happiness);
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
      const paymentRecorded = recordPartyPayment(pendingPartyReviews, customer, reviewScore);
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
      const reputationGain = (0.01 + reviewScore / 10000) * (1 + reputationGainEffect);
      nextRestaurant = {
        ...restaurant,
        reputation: clampReputation(restaurant.reputation + reputationGain),
      };
    }
    let updatedCustomers = customers.map(candidate => candidate.id === customer.id
      ? leavingFields({ ...candidate, departureReason: 'served' })
      : candidate);
    if (settledReview) {
      updatedCustomers = updatedCustomers.map(candidate =>
        getPartyKey(candidate) === partyId && candidate.state === 'waiting_for_party'
          ? leavingFields({ ...candidate, departureReason: 'menu_unaffordable' })
          : candidate);
    }
    const remainingAtTable = updatedCustomers.some(candidate =>
      candidate.tableId === customer.tableId && candidate.state !== 'leaving');
    const carriedServiceItemIds = serviceItems
      .filter(item => item.customerId === customer.id && ['carried', 'carried_dirty'].includes(item.state))
      .map(item => item.id);
    return {
      staff: completedStaff, queue,
      customers: updatedCustomers,
      serviceItems: serviceItems.filter(item => item.customerId !== customer.id
        || !['ordered', 'preparing'].includes(item.state)),
      clearCarriedServiceItemIds: carriedServiceItemIds,
      tables: tables.map(table => table.id === customer.tableId && !remainingAtTable
        ? markTableDirtyIfInUse(table) : table),
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
    if (!isTableReadyForCleaning(staff.task.tableId, customers, serviceItems)) {
      return { staff: completedStaff, queue, customers, serviceItems, tables };
    }
    if (staff.task.cleaningStartedAt == null) {
      return {
        staff: clearNavigationGoal({ ...staff, task: { ...staff.task, cleaningStartedAt: state.restaurant.gameTime } }),
        tables, customers, queue, serviceItems,
      };
    }
    if (state.restaurant.gameTime - staff.task.cleaningStartedAt < ACTIVITY_DURATIONS.wipeFloor) {
      return { staff: clearNavigationGoal(staff), queue, customers, serviceItems, tables };
    }
    return {
      staff: completedStaff, queue, customers, serviceItems,
      tables: tables.map(t => t.id === staff.task.tableId
        ? releaseTableReservation(t, 'empty') : t),
    };
  }

  if (staff.task.type === 'clean_floor') {
    const dirt = (state.floorDirt || []).find(candidate => candidate.id === staff.task.dirtId);
    if (!dirt) return { staff: completedStaff, queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [] };
    if (staff.task.cleaningStartedAt == null) {
      return {
        staff: clearNavigationGoal({ ...staff, task: { ...staff.task, cleaningStartedAt: state.restaurant.gameTime } }),
        queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [],
      };
    }
    if (state.restaurant.gameTime - staff.task.cleaningStartedAt < ACTIVITY_DURATIONS.wipeFloor) {
      return { staff: clearNavigationGoal(staff), queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [] };
    }
    return {
      staff: completedStaff, queue, customers, tables, serviceItems,
      floorDirt: (state.floorDirt || []).filter(candidate => candidate.id !== dirt.id),
    };
  }

  if (staff.task.type === 'guide_customer') {
    const table = tables.find(t => t.id === staff.task.tableId);
    const ids = taskCustomerIds(staff.task);
    const legacyChairIds = staff.task.reservedChairIds;
    const chairIds = staff.task.chairIds || legacyChairIds || getAvailableChairs(
      table?.id,
      customers,
      getActiveGuideTasks(state.staff, staff.id),
      state.chairs || [],
    ).slice(0, ids.length).map(chair => chair.id);
    const chairsById = new Map((state.chairs || []).map(chair => [chair?.id, chair]));
    const chairs = chairIds.map(chairId => chairsById.get(chairId));
    const conflictingChairIds = new Set(customers
      .filter(customer => !ids.includes(customer.id)
        && customer.state !== 'leaving' && customer.chairId)
      .map(customer => customer.chairId));
    const validReservation = table?.status === 'reserved'
      && table.reservationOwnerStaffId === staff.id
      && ids.length > 0
      && chairIds.length === ids.length
      && new Set(chairIds).size === chairIds.length
      && chairs.every(chair => chair?.tableId === table.id && getChairCentre(chair))
      && chairIds.every(chairId => !conflictingChairIds.has(chairId));

    if (!validReservation) {
      return cancelGuideTask({ staff, customers, queue, tables, serviceItems });
    }

    const stage = staff.task.stage || 'follow_guide';
    if (stage === 'follow_guide') {
      if (!hasGenuineGuideParty(customers, ids, staff)) {
        return cancelGuideTask({ staff, customers, queue, tables, serviceItems });
      }
      const approaches = buildChairApproachAssignments(
        { ...state, customers, tables, serviceItems },
        ids,
        chairIds,
      );
      if (!approaches) {
        return cancelGuideTask({ staff, customers, queue, tables, serviceItems });
      }
      if (!validateChairApproachAssignments(
        { ...state, customers, tables, serviceItems }, ids, chairIds, approaches, table.id,
      )) {
        return cancelGuideTask({ staff, customers, queue, tables, serviceItems });
      }

      const approachesByCustomerId = new Map(approaches
        .map(assignment => [assignment.customerId, assignment]));
      const approachingCustomers = customers.map(customer => {
        const assignment = approachesByCustomerId.get(customer.id);
        return assignment
          ? setNavigationGoal({ ...customer, state: 'guided' }, assignment.approachPoint)
          : customer;
      });

      return {
        staff: {
          ...clearNavigationGoal(staff),
          task: { ...staff.task, chairIds, stage: 'approach_chairs', approaches },
        },
        customers: approachingCustomers,
        queue,
        tables,
        serviceItems,
      };
    }

    const approaches = staff.task.approaches;
    const validApproaches = validateChairApproachAssignments(
      { ...state, customers, tables, serviceItems }, ids, chairIds, approaches, table.id,
    );
    if (stage !== 'approach_chairs' || !validApproaches) {
      return cancelGuideTask({ staff, customers, queue, tables, serviceItems });
    }
    if (!hasGenuineGuideParty(customers, ids, staff)) {
      return cancelGuideTask({ staff, customers, queue, tables, serviceItems });
    }

    const customersById = new Map(customers.map(customer => [customer.id, customer]));
    const allAtApproaches = staff.task.approaches.every(assignment => {
      const customer = customersById.get(assignment.customerId);
      return customer
        && Number.isFinite(customer.x)
        && Number.isFinite(customer.y)
        && Math.hypot(
          customer.x - assignment.approachPoint.x,
          customer.y - assignment.approachPoint.y,
        ) <= 2
        && getMovementStatus(state, statuses, customer.id).plan === 'arrived';
    });
    if (!allAtApproaches) {
      return { staff: clearNavigationGoal(staff), customers, queue, tables, serviceItems };
    }

    const seatTime = state.restaurant.gameTime;
    const chairByCustomerId = new Map(ids.map((id, index) => [id, chairs[index]]));
    return {
      staff: completedStaff,
      serviceItems,
      queue,
      tables: tables.map(candidate => candidate.id === table.id
        ? releaseTableReservation(candidate, 'occupied')
        : candidate),
      customers: customers.map(customer => {
        const chair = chairByCustomerId.get(customer.id);
        if (!chair) return customer;
        const centre = getChairCentre(chair);
        return clearNavigationGoal({
          ...customer,
          state: 'seated',
          tableId: table.id,
          chairId: chair.id,
          guideStaffId: null,
          ...recordSeatResidency(customer, chair, table),
          seatTime,
          x: centre.x,
          y: centre.y,
        });
      }),
    };
  }

  if (staff.task.type === 'pickup_service_item') {
    const itemIndex = serviceItems.findIndex(candidate => candidate.id === staff.task.serviceItemId);
    const item = serviceItems[itemIndex];
    const serviceTable = item
      ? (state.serviceTables || []).find(candidate => candidate.id === item.serviceTableId)
      : null;
    const customer = item
      ? customers.find(candidate => candidate.id === item.customerId)
      : null;
    const anotherWorkerOwnsItem = item && (state.staff || []).some(candidate =>
      candidate.id !== staff.id && candidate.carryingServiceItemId === item.id
    );
    const carriesAnotherItem = staff.carryingServiceItemId != null
      && staff.carryingServiceItemId !== item?.id;
    const canPickUp = item
      && item.state === 'on_service'
      && staff.task.serviceTableId === item.serviceTableId
      && customer
      && customer.state !== 'leaving'
      && serviceTable
      && !anotherWorkerOwnsItem
      && !carriesAnotherItem;
    if (!canPickUp) {
      return {
        staff: { ...completedStaff, carryingServiceItemId: staff.carryingServiceItemId ?? null },
        queue, tables, customers, serviceItems,
      };
    }
    return {
      staff: { ...completedStaff, carryingServiceItemId: item.id },
      queue, tables, customers,
      serviceItems: serviceItems.map((candidate, index) => index === itemIndex
        ? { ...candidate, state: 'carried' }
        : candidate),
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
      && staff.carryingServiceItemId === item.id
      && item.assignedStaffId === staff.id
      && item.serviceTableId === staff.task.serviceTableId
      && item.serviceSlotIndex === staff.task.serviceSlotIndex;
    const validDelivery = ownsItem && customer?.state !== 'leaving' && serviceTable;
    if (!validDelivery) {
      return {
        staff: { ...completedStaff, carryingServiceItemId: ownsItem ? null : staff.carryingServiceItemId },
        queue, tables, customers,
        serviceItems: serviceItems.map(candidate => ownsItem && candidate.id === item.id
          ? { ...candidate, state: 'to_clean', assignedStaffId: null }
          : candidate),
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
    return {
      staff: { ...completedStaff, carryingServiceItemId: null },
      queue, tables, customers,
      serviceItems: serviceItems.map(candidate => candidate.id === item.id
        ? { ...candidate, state: 'on_service', assignedStaffId: null, ...position }
        : candidate),
    };
  }

  if (staff.task.type === 'collect_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    if (!item || item.state !== 'dirty_at_table' || !table || staff.carryingServiceItemId != null) {
      return { staff: { ...completedStaff, carryingServiceItemId: null }, queue, tables, customers, serviceItems };
    }
    const target = targetForRectOrCurrent(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff);
    if (target === null) {
      return { staff: { ...completedStaff, carryingServiceItemId: null }, queue, tables, customers, serviceItems };
    }
    if (target.distance > 0) {
      return { staff: setNavigationGoal(staff, target.goal), queue, tables, customers, serviceItems };
    }
    const carriedItems = serviceItems.map(candidate => candidate.id === item.id
      ? { ...candidate, state: 'carried_dirty' } : candidate);
    const stationChoice = selectWashStation(state, staff, carriedItems, state.staff);
    const nextStaff = {
      ...staff,
      task: stationChoice
        ? { type: 'deliver_dirty_item', serviceItemId: item.id, washStationId: stationChoice.station.id }
        : null,
      carryingServiceItemId: item.id,
    };
    return {
      staff: stationChoice
        ? stationChoice.target.distance > 0
          ? setNavigationGoal(nextStaff, stationChoice.target.goal)
          : clearNavigationGoal(nextStaff)
        : clearNavigationGoal(nextStaff),
      queue, customers,
      tables,
      serviceItems: carriedItems,
    };
  }

  if (staff.task.type === 'deliver_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const station = (state.washStations || []).find(candidate => candidate.id === staff.task.washStationId);
    if (!item || item.state !== 'carried_dirty' || staff.carryingServiceItemId !== item.id) {
      return { staff: { ...completedStaff, carryingServiceItemId: null }, queue, tables, customers, serviceItems };
    }
    if (!station) {
      return { staff: { ...completedStaff, carryingServiceItemId: item.id }, queue, tables, customers, serviceItems };
    }
    const target = targetForRectOrCurrent(state, station, staff);
    if (target === null) {
      return { staff: { ...completedStaff, carryingServiceItemId: item.id }, queue, tables, customers, serviceItems };
    }
    if (target.distance > 0) {
      return { staff: setNavigationGoal(staff, target.goal), queue, tables, customers, serviceItems };
    }
    if (!hasWashStationCapacity(state, station, { excludeServiceItemId: item.id })) {
      return {
        staff: { ...completedStaff, carryingServiceItemId: item.id },
        queue, tables, customers, serviceItems,
      };
    }
    return {
      staff: { ...completedStaff, carryingServiceItemId: null }, queue, tables, customers,
      serviceItems: serviceItems.map(candidate => candidate.id === item.id
        ? { ...candidate, state: 'queued_for_wash', washStationId: station.id, washQueuedAt: state.restaurant.gameTime } : candidate),
    };
  }

  if (staff.task.type === 'wash_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const station = (state.washStations || []).find(candidate => candidate.id === staff.task.washStationId && candidate.type === 'manual');
    if (!item || !['queued_for_wash', 'washing'].includes(item.state) || item.washStationId !== station?.id) {
      return { staff: completedStaff, queue, tables, customers, serviceItems };
    }
    if (staff.task.washingStartedAt == null) {
      const itemIndex = serviceItems.indexOf(item);
      return { staff: clearNavigationGoal({ ...staff, task: { ...staff.task, washingStartedAt: state.restaurant.gameTime } }), queue, tables, customers, serviceItems: serviceItems.map((candidate, index) => index === itemIndex ? { ...candidate, state: 'washing', washStartedAt: state.restaurant.gameTime } : candidate) };
    }
    if (state.restaurant.gameTime - staff.task.washingStartedAt < ACTIVITY_DURATIONS.manualWash) {
      return { staff: clearNavigationGoal(staff), queue, tables, customers, serviceItems };
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
      const ownsTaskItem = staff.carryingServiceItemId === staff.task.serviceItemId;
      const anotherWorkerOwnsTaskItem = (state.staff || []).some(candidate =>
        candidate.id !== staff.id && candidate.carryingServiceItemId === staff.task.serviceItemId
      );
      return {
        staff: {
          ...completedStaff,
          carryingServiceItemId: ownsTaskItem ? null : staff.carryingServiceItemId,
        },
        customers, queue, tables,
        serviceItems: serviceItems.map(candidate => ownsTaskItem
          && !anotherWorkerOwnsTaskItem
          && candidate.id === staff.task.serviceItemId
          && candidate.state === 'carried'
          ? { ...candidate, state: 'to_clean' }
          : candidate),
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
    return {
      staff: { ...completedStaff, carryingServiceItemId: null },
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
    const validReservation = staff.role === 'waiter'
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
      return {
        staff: clearNavigationGoal(staff),
        customers, queue, tables,
        serviceItems: serviceItems.map(candidate => candidate.id === item.id
          ? {
            ...candidate,
            state: 'preparing',
            preparationStartedAt: state.restaurant.gameTime,
          }
          : candidate),
      };
    }

    const elapsed = state.restaurant.gameTime - item.preparationStartedAt;
    if (!Number.isFinite(item.preparationStartedAt) || elapsed < ACTIVITY_DURATIONS.prepareDrink) {
      return {
        staff: clearNavigationGoal(staff),
        customers, queue, tables, serviceItems,
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
    const anotherWorkerOwnsItem = (state.staff || []).some(candidate =>
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
      && !anotherWorkerOwnsItem
      && !anotherWorkerOwnsStation;
    if (validReadyDish) {
      const slot = findAvailableServiceSlot(state);
      const serviceTable = slot
        ? (state.serviceTables || []).find(candidate => candidate.id === slot.serviceTableId)
        : null;
      const target = serviceTable
        ? targetForRectOrCurrent(state, getServiceTableRect(serviceTable), staff)
        : null;
      if (!slot || !serviceTable || target === null) {
        return { staff: clearNavigationGoal(staff), queue, tables, customers, serviceItems };
      }
      return {
        staff: setNavigationGoal(
          {
            ...staff,
            carryingServiceItemId: item.id,
            task: {
              type: 'place_dish_on_service',
              serviceItemId: item.id,
              serviceTableId: slot.serviceTableId,
              serviceSlotIndex: slot.serviceSlotIndex,
            },
          },
          target.goal,
        ),
        queue, tables, customers,
        serviceItems: serviceItems.map(candidate => candidate.id === item.id
          ? {
            ...candidate,
            ...slot,
            state: 'carried',
            assignedStaffId: staff.id,
            x: staff.x,
            y: staff.y,
          }
          : candidate),
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
      && !anotherWorkerOwnsItem
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
  const gateStatus = getQueueAdmissionGateStatus(state);
  let queueAdmissionGate = state.queueAdmissionGate ?? null;
  let customers = [...(state.customers || [])];
  let queue = [...(state.queue || [])];
  let tables = normaliseTableReservationOwners(state.tables, state.staff);
  let serviceItems = [...(state.serviceItems || [])];
  let completedCustomers = [...(state.completedCustomers || [])];
  let pendingPartyReviews = [...(state.pendingPartyReviews || [])];
  let partyReviewHistory = [...(state.partyReviewHistory || [])];
  let floorDirt = [...(state.floorDirt || [])];
  let restaurant = state.restaurant;

  const claimedCustomerIds = new Set();
  const claimedServiceItemIds = new Set();
  const claimedTableIds = new Set();
  const claimedDirtIds = new Set();

  let staff = ensureStaffRuntime(state.staff, state).map(s => ({
    ...s,
    morale: Math.max(0, s.morale - 0.01 * gameDt / 60),
    carryingServiceItemId: s.carryingServiceItemId ?? null,
  }));
  if (gateStatus.clear) {
    const gateMemberIds = new Set(queueAdmissionGate?.customerIds || []);
    customers = customers.map(customer => gateMemberIds.has(customer.id)
      ? withoutEntryDoorId(customer)
      : customer);
    queueAdmissionGate = null;
  } else if (gateStatus.stale) {
    const gateMemberIds = new Set(queueAdmissionGate.customerIds || []);
    tables = tables.map(table => table.id === queueAdmissionGate.tableId
      && table.status === 'reserved'
      && table.reservationOwnerStaffId === queueAdmissionGate.guideStaffId
      ? releaseTableReservation(table, 'empty')
      : table);
    staff = staff.map(worker => hasMatchingQueueAdmissionTask(worker, queueAdmissionGate)
      ? clearNavigationGoal({ ...worker, task: null })
      : worker);
    customers = customers.map(customer => {
      if (!gateMemberIds.has(customer.id)) return customer;
      if (customer.state === 'leaving') return withoutEntryDoorId(customer);
      return leavingFields({ ...customer, tableId: null, guideStaffId: null, chairId: null });
    });
  }
  const activityState = { ...state, staff, customers, tables, serviceItems };
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
  const staleTaskServiceItemIds = staff
    .filter(worker => worker.task?.type === 'prepare_drink')
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
      serviceTableId: null,
      serviceSlotIndex: null,
      assignedStaffId: null,
    };
  });

  // Seed claimed sets from existing active staff tasks to prevent cross-tick duplicate claims.
  for (const s of staff) {
    if (s.task) {
      if (s.task.customerId) claimedCustomerIds.add(s.task.customerId);
      if (Array.isArray(s.task.customerIds)) {
        s.task.customerIds.forEach(id => claimedCustomerIds.add(id));
      }
      if (s.task.serviceItemId) claimedServiceItemIds.add(s.task.serviceItemId);
      if (s.task.type === 'clean_table' && s.task.tableId) claimedTableIds.add(s.task.tableId);
      if (s.task.type === 'clean_floor' && s.task.dirtId) claimedDirtIds.add(s.task.dirtId);
    }
  }
  staff = staff.map(worker => worker.task?.type === 'prepare_drink'
    && !serviceItems.some(item => item.id === worker.task.serviceItemId
      && item.assignedStaffId === worker.id
      && hasValidDrinkReservation({ ...state, staff }, item))
    ? clearNavigationGoal({ ...worker, task: null }) : worker);

  // Cancel tasks whose customer disappeared while being guided. Without this,
  // the guiding staff reaches the destination and creates a permanently occupied table.
  for (let i = 0; i < staff.length; i += 1) {
    const current = staff[i];
    if (current.task?.type !== 'guide_customer') continue;
    const ids = taskCustomerIds(current.task);
    if (ids.length && ids.some(id => !customers.some(customer => customer.id === id && customer.state !== 'leaving'))) {
      tables = tables.map(table => table.id === current.task.tableId
        && table.status === 'reserved'
        && table.reservationOwnerStaffId === current.id
        ? releaseTableReservation(table, 'empty')
        : table);
      customers = customers.map(customer => {
        if (!ids.includes(customer.id)) return customer;
        if (customer.state === 'leaving') {
          return {
            ...withoutEntryDoorId(customer), tableId: null, guideStaffId: null, chairId: null,
          };
        }
        return {
          ...leavingFields(customer),
          tableId: null,
          guideStaffId: null,
          chairId: null,
          happiness: Math.max(0, customer.happiness - 30),
        };
      });
      staff[i] = settleTasklessActivity(
        { ...state, restaurant, staff, customers, tables, serviceItems },
        clearNavigationGoal({ ...current, task: null }),
      );
    }
  }

  // A hold-at-goal planner cannot solve two staff tasks ending at the same
  // service point. Repair old assignments as well as avoiding new duplicates.
  for (let i = 0; i < staff.length; i += 1) {
    const worker = staff[i];
    if (!['take_order', 'deliver_service_item'].includes(worker.task?.type)
      || !worker.navigationGoal
      || hasObsoleteCustomerTask(worker, customers, tables, serviceItems)) continue;
    const currentState = { ...state, staff, customers, tables, serviceItems };
    if (isStaffDestinationAvailable(currentState, worker.navigationGoal, worker)) continue;
    const tableId = worker.task.type === 'take_order'
      ? customers.find(customer => customer.id === worker.task.customerId)?.tableId
      : serviceItems.find(item => item.id === worker.task.serviceItemId)?.tableId;
    const table = tables.find(candidate => candidate.id === tableId);
    const target = table && targetForTable(currentState, table, worker);
    if (target) staff[i] = setNavigationGoal(worker, target.goal);
  }

  // Legacy waiting customers can enter guidance without world coordinates.
  // Materialise them only in this pre-batch phase at deterministic queue slots;
  // subsequent route planning and movement still go through shared descriptors.
  // The vacancy check must respect the canonical standing queue leases: this
  // writer runs after the queue claims, so a safe grant does not by itself
  // protect the point against this later materialiser.
  const occupiedActors = [
    ...staff,
    ...customers,
    ...getQueueVisibleMembers(state, state.queue),
  ].filter(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y));
  customers = customers.map(customer => {
    if (Number.isFinite(customer.x) && Number.isFinite(customer.y)) return customer;
    const guideContext = getCustomerGuideContext({ ...state, staff, customers }, customer);
    if (!guideContext) return customer;
    const start = findGuidedCustomerStart(state, customer, occupiedActors);
    if (!start) return customer;
    const normalised = { ...customer, ...start };
    occupiedActors.push(normalised);
    return normalised;
  });

  // Followers keep one formation waypoint episode until its public movement
  // status reports arrival. A preceding actor's movement alone never changes
  // the follower's exact goal.
  for (const s of staff) {
    if (s.task?.type !== 'guide_customer'
      || (s.task.stage || 'follow_guide') !== 'follow_guide') continue;
    const currentState = { ...state, restaurant, staff, customers, tables, serviceItems };
    if (getMovementStatus(currentState, null, s.id).plan === 'arrived') continue;
    const ids = taskCustomerIds(s.task);
    for (const customerId of ids) {
      const index = customers.findIndex(customer => customer.id === customerId);
      if (index < 0) continue;
      const customer = customers[index];
      const customerState = { ...state, restaurant, staff, customers, tables, serviceItems };
      const guideContext = getCustomerGuideContext(customerState, customer);
      if (!guideContext || guideContext.guide.id !== s.id) continue;
      const status = getMovementStatus(customerState, null, customer.id);
      const hasGoal = Number.isFinite(customer.navigationGoal?.x)
        && Number.isFinite(customer.navigationGoal?.y);
      if (hasGoal && !['arrived', 'unreachable'].includes(status.plan)
        && validFollowerGoal(customerState, customer)) continue;
      const memberIndex = Math.max(0, ids.indexOf(customer.id));
      const preceding = memberIndex > 0
        ? customers.find(candidate => candidate.id === ids[memberIndex - 1])
        : s;
      if (!Number.isFinite(preceding?.x) || !Number.isFinite(preceding?.y)) continue;
      const goal = chooseFollowerGoal(customerState, customer, preceding);
      customers[index] = goal ? setNavigationGoal(customer, goal) : clearNavigationGoal(customer);
    }
  }

  return {
    ...state, staff, customers, queue, tables, serviceItems, completedCustomers,
    pendingPartyReviews, partyReviewHistory, floorDirt, restaurant,
    queueAdmissionGate,
    __staffClaimedServiceItemIds: staleTaskServiceItemIds,
  };
}

export function getStaffMovementEntries(state) {
  const entries = [];
  const goalFor = character => Number.isFinite(character.navigationGoal?.x)
    && Number.isFinite(character.navigationGoal?.y)
    ? { x: character.navigationGoal.x, y: character.navigationGoal.y }
    : null;
  const queueRankFor = customer => {
    if (Number.isInteger(customer.checkoutQueueIndex) && customer.checkoutQueueIndex >= 0) {
      return customer.checkoutQueueIndex;
    }
    const station = (state.cashierStations || [])
      .find(candidate => candidate.id === customer.cashierStationId);
    const position = customer.checkoutPosition;
    if (!station || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    const rank = (position.y - station.y - station.h - 20) / 20;
    return Number.isInteger(rank) && rank >= 0 ? rank : null;
  };
  const customerFields = (customer, guideContext) => {
    const isLeaving = customer.state === 'leaving';
    const isFading = isLeaving && customer.exitPhase === 'fading';
    const isCheckout = customer.state === 'checkout_moving';
    const isGuided = Boolean(guideContext);
    const doorId = customer.exitDoorId ?? customer.entryDoorId ?? null;
    return {
      doorFlow: {
        doorId: isLeaving || isGuided ? doorId : null,
        direction: isLeaving ? 'egress' : isGuided ? 'ingress' : 'none',
      },
      queueRank: isCheckout ? queueRankFor(customer) : null,
      terminalPolicy: isFading ? 'release' : 'hold',
    };
  };
  for (const staff of state.staff || []) {
    if (!Number.isFinite(staff.x) || !Number.isFinite(staff.y)) continue;
    const ids = getGuidePartyContext(state, staff)?.ignoredIds || [];
    const target = goalFor(staff);
    entries.push({
      character: staff,
      speed: target ? getStaffMovementSpeed(staff) : 0,
      ignoredIds: ids,
      doorFlow: { doorId: null, direction: 'none' },
      queueRank: null,
      terminalPolicy: 'hold',
      ...(target ? { target } : {}),
    });
  }
  for (const customer of state.customers || []) {
    if (!Number.isFinite(customer.x) || !Number.isFinite(customer.y)) continue;
    const guideContext = getCustomerGuideContext(state, customer);
    const target = goalFor(customer);
    entries.push({
      character: customer,
      speed: target && guideContext ? 62 : 0,
      ignoredIds: guideContext?.ignoredIds || [],
      ...customerFields(customer, guideContext),
      ...(target && guideContext ? { target } : {}),
      ...(guideContext ? { provenance: 'guide' } : {}),
    });
  }
  return entries;
}

function getStaffBatchEntries(state) {
  const entriesById = new Map();
  const add = entry => {
    if (entry?.character?.id == null) return;
    const id = String(entry.character.id);
    const existing = entriesById.get(id);
    if (!existing
      || (entry.provenance === 'guide' && existing.provenance !== 'guide')
      || (entry.provenance !== 'guide' && existing.provenance !== 'guide'
        && Number(entry.speed) > 0 && !(Number(existing.speed) > 0))) {
      entriesById.set(id, entry);
    }
  };

  for (const entry of getStaffMovementEntries(state)) add(entry);
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
  let {
    staff, customers, queue, serviceItems, completedCustomers,
    pendingPartyReviews, partyReviewHistory, floorDirt, restaurant,
  } = state;
  let queueAdmissionGate = state.queueAdmissionGate ?? null;
  let queueSlots = Array.isArray(state.queueSlots) ? state.queueSlots : [];
  let tables = normaliseTableReservationOwners(state.tables, staff);
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
    if (worker.task.type === 'clean_table' && worker.task.tableId) claimedTableIds.add(worker.task.tableId);
    if (worker.task.type === 'clean_floor' && worker.task.dirtId) claimedDirtIds.add(worker.task.dirtId);
  }

  for (let i = 0; i < staff.length; i += 1) {
    const s = staff[i];
    const status = getMovementStatus(state, statuses, s.id);

    // Cancellation cannot depend on reaching a destination which may itself be
    // blocked forever. Valid work still requires certified arrival below.
    if (s.task && status.plan !== 'arrived'
      && !hasObsoleteCustomerTask(s, customers, tables, serviceItems)) {
      staff[i] = markTaskAssigned(s);
      continue;
    }

    if (s.task) {
      const resolved = resolveTask({
        state: {
          ...state, restaurant, staff, customers, queue, tables, serviceItems,
          completedCustomers, pendingPartyReviews, partyReviewHistory, floorDirt,
          queueAdmissionGate,
        },
        staff: s, customers, queue, tables, serviceItems,
        pendingPartyReviews, partyReviewHistory, restaurant, statuses,
      });
      if (resolved.customers) customers = resolved.customers;
      if (resolved.queue) queue = resolved.queue;
      if (resolved.tables) tables = resolved.tables;
      if (resolved.serviceItems) serviceItems = resolved.serviceItems;
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
        staff = staff.map(worker => clearedIds.has(worker.carryingServiceItemId)
          ? { ...worker, carryingServiceItemId: null }
          : worker);
      }
      continue;
    }

    const result = assignTask({
      state: {
        ...state, restaurant, staff, customers, queue, tables, serviceItems,
        completedCustomers, pendingPartyReviews, partyReviewHistory, floorDirt,
        queueAdmissionGate,
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
      if (Object.hasOwn(result, 'queueAdmissionGate')) {
        queueAdmissionGate = result.queueAdmissionGate;
      }
      if (result.claimedCustomerId) claimedCustomerIds.add(result.claimedCustomerId);
      if (result.claimedCustomerIds) result.claimedCustomerIds.forEach(id => claimedCustomerIds.add(id));
      if (result.claimedServiceItemId) claimedServiceItemIds.add(result.claimedServiceItemId);
      if (result.claimedTableId) claimedTableIds.add(result.claimedTableId);
      if (result.claimedDirtId) claimedDirtIds.add(result.claimedDirtId);
    }
  }

  serviceItems = serviceItems.map(item => {
    const carrier = staff.find(candidate => candidate.carryingServiceItemId === item.id);
    return carrier && item.state === 'carried'
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
  };
  return result;
}

export function updateStaff(state, timing) {
  const gameDt = Math.max(0, Number.isFinite(timing) ? timing : Number(timing?.gameDt) || 0);
  const movementDt = Math.max(0, Number.isFinite(timing) ? timing : Number(timing?.movementDt) || 0);
  const prepared = prepareStaffForMovement(state, gameDt);
  const movementEntries = getStaffBatchEntries(prepared);
  const batch = advanceCharacterMovementBatch(prepared, movementEntries, movementDt);
  const guideCustomerIds = new Set(movementEntries
    .filter(entry => entry.provenance === 'guide' && Number(entry.speed) > 0)
    .map(entry => String(entry.character.id)));
  const movedFor = id => batch.moved.get(id) || batch.moved.get(String(id));
  const committed = {
    ...prepared,
    staff: prepared.staff.map(character => movedFor(character.id) || character),
    customers: prepared.customers.map(character => guideCustomerIds.has(String(character.id))
      ? movedFor(character.id) || character
      : character),
    movementCoordinator: batch.coordinator,
  };
  return resolveStaffAfterMovement(committed, gameDt, batch.statuses);
}
function getCustomerReviewScore(customer, fallback) {
  const queueScore = Number.isFinite(customer.queuePatience)
    && Number.isFinite(customer.queuePatienceMax)
    && customer.queuePatienceMax > 0
    ? Math.min(1, Math.max(0, customer.queuePatience / customer.queuePatienceMax)) * 100
    : null;
  const serviceScore = Number.isFinite(customer.patience)
    && Number.isFinite(customer.patienceMax)
    && customer.patienceMax > 0
    ? Math.min(1, Math.max(0, customer.patience / customer.patienceMax)) * 100
    : null;
  return queueScore == null || serviceScore == null
    ? fallback
    : (queueScore + serviceScore) / 2;
}
