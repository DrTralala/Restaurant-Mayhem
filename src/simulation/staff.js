import { buildBlockedCells, buildOccupiedCharacterCells, cellToWorld, findAdjacentOpenCells, findPath, findPathWithDynamicFallback, isInsideWorld, worldToCell } from './pathfinding';
import { ensureStaffRuntime, hasArrived, planCharacterPath, resolveCharacterMovementBatch } from './movement';
import { getCashierCustomerPosition, getCashierWorkPosition, getDoorPosition, getDoors, getQueuePosition, getRestaurantWorld } from './world';
import { clampReputation, getTipRate, getUpgradeEffect } from './balance';
import { getAssignedCashierStation } from './cashiers';
import { getDrink } from '../data/drinks';
import {
  allOrderedItemsDelivered,
  createCustomerOrder,
  findAvailableServiceSlot,
  getServiceSlotPosition,
  normaliseServiceItemOwnership,
  hasValidDrinkReservation,
} from './serviceItems';
import { ACTIVITY_DURATIONS } from './activity';
import { hasWashStationCapacity, markCustomerItemsDirty, releaseClearedTables } from './dishwashing';
import { getCustomerGuideContext, getGuidePartyContext, taskCustomerIds } from './guidance';

function occupiedCharacterCells(staff, customers, excludeId, ignoredIds = []) {
  return buildOccupiedCharacterCells([...staff, ...customers], [excludeId, ...ignoredIds]);
}

const CHARACTER_START_SPACING = 16;
const QUEUE_ADMISSION_SPACING = 16;

function getQueueAdmissionCandidates(state, door) {
  const world = getRestaurantWorld(state.restaurant || {});
  const outside = getDoorPosition(state, door).outside;
  const first = {
    x: Math.ceil(world.queueX / world.gridSize),
    y: Math.ceil(world.kitchenY / world.gridSize),
  };
  const last = {
    x: Math.floor((world.queueX + world.queueW) / world.gridSize),
    y: Math.floor((world.diningY + world.areaH + 50) / world.gridSize),
  };
  const blocked = buildBlockedCells(state);
  const candidates = [];
  for (let y = first.y; y <= last.y; y += 1) {
    for (let x = first.x; x <= last.x; x += 1) {
      const cell = { x, y };
      const point = cellToWorld(cell);
      const insideQueue = point.x >= world.queueX
        && point.x <= world.queueX + world.queueW
        && point.y >= world.kitchenY
        && point.y <= world.diningY + world.areaH + 50;
      if (insideQueue && isInsideWorld(state, cell) && !blocked.has(`${x},${y}`)) {
        candidates.push(point);
      }
    }
  }
  return candidates.sort((left, right) =>
    Math.hypot(left.x - outside.x, left.y - outside.y)
      - Math.hypot(right.x - outside.x, right.y - outside.y)
    || left.y - right.y
    || left.x - right.x);
}

function allocateQueuedPartyAdmission(state, {
  party,
  remainingQueue,
  door,
  guide,
  guidePath,
  staff,
  customers,
  partyIds,
  tableId,
}) {
  const queuedPositions = remainingQueue.map((customer, index) => ({
    ...getQueuePosition(state, index),
    id: customer.id,
  }));
  const occupiedPositions = [...staff, ...customers, ...queuedPositions]
    .filter(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y));
  const candidates = getQueueAdmissionCandidates(state, door);
  const admittedCustomers = [];

  for (const customer of party) {
    const candidate = candidates.find(point => occupiedPositions.every(actor =>
      Math.hypot(point.x - actor.x, point.y - actor.y) >= QUEUE_ADMISSION_SPACING));
    if (!candidate) return null;

    const routeToGuide = findPathWithDynamicFallback(
      state,
      worldToCell(candidate),
      worldToCell(guide),
      {
        occupiedCells: occupiedCharacterCells(
          staff,
          [...customers, ...admittedCustomers, ...queuedPositions],
          guide.id,
          partyIds,
        ),
      },
    ).path;
    if (!routeToGuide.length) return null;

    const admitted = {
      ...customer,
      state: 'guided',
      guideStaffId: guide.id,
      chairId: null,
      x: candidate.x,
      y: candidate.y,
      tableId,
      path: [...routeToGuide, ...guidePath],
    };
    admittedCustomers.push(admitted);
    occupiedPositions.push(admitted);
  }

  return admittedCustomers;
}

function findGuidedCustomerStart(state, customer, guideContext, occupiedActors) {
  const memberIndex = Math.max(0, guideContext.genuinePartyIds.indexOf(customer.id));
  const preferred = getQueuePosition(state, memberIndex);
  const legalReference = getQueuePosition(state, 0);
  const world = getRestaurantWorld(state.restaurant || {});
  const preserveX = Number.isFinite(customer.x)
    && isInsideWorld(state, worldToCell({ x: customer.x, y: legalReference.y }));
  const preserveY = Number.isFinite(customer.y)
    && isInsideWorld(state, worldToCell({ x: legalReference.x, y: customer.y }));
  const maxQueueIndex = Math.ceil((world.doorY + 80 - world.kitchenY) / 25) + 1;
  const queueIndexes = Array.from({ length: maxQueueIndex + 1 }, (_, index) => index)
    .sort((left, right) => Math.abs(left - memberIndex) - Math.abs(right - memberIndex)
      || left - right);
  const candidates = queueIndexes.map(index => {
    const queuePosition = getQueuePosition(state, index);
    return {
      x: preserveX ? customer.x : queuePosition.x,
      y: preserveY ? customer.y : queuePosition.y,
    };
  });

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

function targetForRect(state, rect, staff) {
  const start = worldToCell(staff);
  const occupiedCells = occupiedCharacterCells(state.staff || [], state.customers || [], staff.id);
  const candidates = findAdjacentOpenCells(state, rect, start);
  for (const target of candidates) {
    const path = findPathWithDynamicFallback(state, start, target, { occupiedCells }).path;
    if (path.length) return path;
  }
  return [];
}

function getAvailableChairs(tableId, customers = [], activeGuideTasks = [], chairs = []) {
  const occupiedChairIds = new Set(customers
    .filter(customer => customer.state !== 'leaving' && customer.chairId)
    .map(customer => customer.chairId));
  const reservedChairIds = new Set(activeGuideTasks
    .filter(task => task.tableId === tableId)
    .flatMap(task => task.reservedChairIds || task.chairIds || []));

  return chairs.filter(chair => chair.tableId === tableId
    && !occupiedChairIds.has(chair.id)
    && !reservedChairIds.has(chair.id));
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
    const path = targetForTable(state, table, staff);
    if (path.length) return { table, path, chairs: distinctChairs.slice(0, partySize) };
  }
  return null;
}

function getParty(members, lead) {
  if (!lead) return [];
  if (!lead.partyId) return [lead];
  return members.filter(member => member.partyId === lead.partyId);
}

function getPartySize(party, lead) {
  return Math.max(party.length, Number.isFinite(lead?.partySize) ? lead.partySize : 0);
}

function leavingFields(customer) {
  const leaving = {
    ...customer,
    state: 'leaving',
    exitPhase: 'to_door',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: null,
    path: [],
    stalledFor: 0,
    checkoutPosition: null,
  };
  delete leaving.pathGoal;
  delete leaving.usingStaticFallback;
  delete leaving.minimumSpacing;
  return leaving;
}

function targetForRectOrCurrent(state, rect, staff) {
  const current = worldToCell(staff);
  const alreadyAdjacent = findAdjacentOpenCells(state, rect, current)
    .some(candidate => candidate.x === current.x && candidate.y === current.y);
  if (alreadyAdjacent) return [];

  const path = targetForRect(state, rect, staff);
  return path.length ? path : null;
}

function washDuration(station) {
  return station.type === 'automatic'
    ? ACTIVITY_DURATIONS.automaticWash
    : ACTIVITY_DURATIONS.manualWash;
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
      path: targetForRectOrCurrent(state, station, staff),
      workload: projectedWashWorkload(state, station, staff, serviceItems, allStaff),
    }))
    .filter(candidate => candidate.path !== null)
    .sort((left, right) => left.workload - right.workload
      || left.path.length - right.path.length
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
        path: targetForRectOrCurrent(state, { x: candidate.x - 6, y: candidate.y - 6, w: 12, h: 12 }, staff),
      }))
      .filter(candidate => candidate.path)
      .sort((a, b) => a.path.length - b.path.length)[0];
    if (dirt) {
      return {
        staff: { ...staff, path: dirt.path, task: { type: 'clean_floor', dirtId: dirt.dirt.id } },
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
        .map(station => ({ station, path: targetForRectOrCurrent(state, station, staff) }))
        .filter(candidate => candidate.path !== null)
        .sort((left, right) => left.path.length - right.path.length
          || String(left.station.id).localeCompare(String(right.station.id)))[0];
      if (stationChoice) {
        const { station, path } = stationChoice;
        return {
          staff: { ...staff, path, task: { type: 'wash_item', serviceItemId: washItem.id, washStationId: station.id } },
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
      .filter(customer => customer.state === 'paying' && customer.paymentReady
        && (!claimedCustomerIds || !claimedCustomerIds.has(customer.id)))
      .sort((a, b) => (a.paymentQueuedAt ?? 0) - (b.paymentQueuedAt ?? 0));
    const payingCustomer = paying.find(customer => customer.cashierStationId === cashierStation.id)
      || paying.find(customer => customer.cashierStationId == null);
    const workCell = worldToCell(getCashierWorkPosition(cashierStation));
    const staffCell = worldToCell(staff);
    const occupiedCells = occupiedCharacterCells(state.staff || [], state.customers || [], staff.id);
    const path = findPath(state, staffCell, workCell, { occupiedCells });
    const workPointAvailable = !occupiedCells.has(`${workCell.x},${workCell.y}`);
    const canReachWorkPoint = path.length || (staffCell.x === workCell.x && staffCell.y === workCell.y);

    if (payingCustomer && workPointAvailable && canReachWorkPoint) {
      return {
        staff: { ...staff, path, task: { type: 'take_payment', customerId: payingCustomer.id, stationId: cashierStation.id } },
        customers: payingCustomer.cashierStationId == null
          ? customers.map(customer => customer.id === payingCustomer.id
            ? { ...customer, cashierStationId: cashierStation.id }
            : customer)
          : customers,
        claimedCustomerId: payingCustomer.id,
      };
    }

    return {
      staff: { ...staff, path: canReachWorkPoint ? path : [] },
    };
  }

  if (staff.role === 'waiter') {
    if (staff.carryingServiceItemId != null) {
      const item = serviceItems.find(candidate => candidate.id === staff.carryingServiceItemId);
      if (item?.state === 'carried_dirty') {
        const stationChoice = selectWashStation(state, staff, serviceItems, allStaff);
        if (stationChoice) {
          return {
            staff: { ...staff, path: stationChoice.path, task: { type: 'deliver_dirty_item', serviceItemId: item.id, washStationId: stationChoice.station.id } },
            claimedServiceItemId: item.id,
          };
        }
        return null;
      }
      const customer = item && customers.find(candidate => candidate.id === item.customerId);
      const table = item && tables.find(candidate => candidate.id === item.tableId);
      const path = table ? targetForTable(state, table, staff) : [];
      const canReachTable = table && (path.length || Math.hypot(staff.x - table.x, staff.y - table.y) <= 40);
      if (item?.state === 'carried'
        && customer
        && customer.state !== 'leaving'
        && customer?.id === item.customerId
        && customer?.tableId === item.tableId
        && canReachTable) {
        return {
          staff: {
            ...staff,
            path,
            task: { type: 'deliver_service_item', serviceItemId: item.id, customerId: item.customerId },
          },
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
      const path = targetForRectOrCurrent(
        state,
        { x: serviceTable.x, y: serviceTable.y, w: 120, h: 40 },
        staff,
      );
      if (path) {
        return {
          staff: {
            ...staff,
            path,
            task: {
              type: 'pickup_service_item',
              serviceItemId: readyServiceItem.id,
              serviceTableId: readyServiceItem.serviceTableId,
            },
          },
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
      const path = serviceTable
        ? targetForRectOrCurrent(
          state,
          { x: serviceTable.x, y: serviceTable.y, w: 120, h: 40 },
          staff,
        )
        : null;
      if (slot && path) {
        return {
          staff: {
            ...staff,
            path,
            task: {
              type: 'prepare_drink',
              serviceItemId: pendingDrink.id,
              serviceTableId: slot.serviceTableId,
              serviceSlotIndex: slot.serviceSlotIndex,
            },
          },
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
      const path = table ? targetForRectOrCurrent(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff) : null;
      if (path !== null) {
        return {
          staff: { ...staff, path, task: { type: 'collect_dirty_item', serviceItemId: dirtyItem.id, tableId: dirtyItem.tableId } },
          claimedServiceItemId: dirtyItem.id,
        };
      }
    }

    const orderingCustomer = customers.find(c => c.state === 'seated' && !c.dishId && !c.drinkId && (!claimedCustomerIds || !claimedCustomerIds.has(c.id)));
    const hasOrderableItem = state.dishes?.length > 0
      || state.unlockedDrinkIds?.some(drinkId => getDrink(drinkId));
    if (orderingCustomer && hasOrderableItem) {
      const table = tables.find(t => t.id === orderingCustomer.tableId);
      const path = table ? targetForTable(state, table, staff) : [];
      if (path.length || (table && Math.hypot(staff.x - table.x, staff.y - table.y) <= 40)) {
        return { staff: { ...staff, path, task: { type: 'take_order', customerId: orderingCustomer.id } }, claimedCustomerId: orderingCustomer.id };
      }
    }

    const waitingPartyIds = new Set();
    for (const waiting of customers.filter(c => c.state === 'waiting' && (!claimedCustomerIds || !claimedCustomerIds.has(c.id)))) {
      const partyKey = waiting.partyId || waiting.id;
      if (waitingPartyIds.has(partyKey)) continue;
      waitingPartyIds.add(partyKey);
      const party = getParty(customers.filter(c => c.state === 'waiting'), waiting);
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
        const { table, path, chairs } = reachable;
        const partyIds = party.map(c => c.id);
        return {
          staff: {
            ...staff,
            path,
            task: {
              type: 'guide_customer',
              customerId: waiting.id,
              customerIds: partyIds,
              partyId: waiting.partyId,
              tableId: table.id,
              reservedChairIds: chairs.map(chair => chair.id),
            },
          },
          customers: customers.map(c => party.some(member => member.id === c.id)
            ? { ...c, state: 'guided', guideStaffId: staff.id, chairId: null }
            : c),
          tables: tables.map(t => t.id === table.id ? { ...t, status: 'reserved' } : t),
          claimedCustomerIds: partyIds,
        };
      }
    }

    const queuedPartyIds = new Set();
    for (const queued of queue) {
      const partyKey = queued.partyId || queued.id;
      if (queuedPartyIds.has(partyKey)) continue;
      queuedPartyIds.add(partyKey);
      const party = getParty(queue, queued);
      const partySize = getPartySize(party, queued);
      if (party.length < partySize) continue;
      const reachable = findReachableTable(
        { ...state, customers },
        tables,
        staff,
        partySize,
        getActiveGuideTasks(state.staff),
      );
      if (reachable) {
        const { table, path, chairs } = reachable;
        const door = [...getDoors(state)].sort((a, b) => Math.abs(a.y - staff.y) - Math.abs(b.y - staff.y))[0];
        const partyIds = party.map(c => c.id);
        const remainingQueue = queue.filter(q => !party.some(member => member.id === q.id));
        const newCustomers = allocateQueuedPartyAdmission(state, {
          party,
          remainingQueue,
          door,
          guide: staff,
          guidePath: path,
          staff: allStaff || state.staff || [],
          customers,
          partyIds,
          tableId: table.id,
        });
        if (!newCustomers) continue;
        return {
          staff: {
            ...staff,
            path,
            task: {
              type: 'guide_customer',
              customerId: queued.id,
              customerIds: partyIds,
              partyId: queued.partyId,
              tableId: table.id,
              reservedChairIds: chairs.map(chair => chair.id),
            },
          },
          customers: [...customers, ...newCustomers],
          queue: remainingQueue,
          tables: tables.map(t => t.id === table.id ? { ...t, status: 'reserved' } : t),
          claimedCustomerIds: partyIds,
        };
      }
    }

    const dirty = tables.find(t => t.status === 'dirty'
      && (!claimedTableIds || !claimedTableIds.has(t.id)));
    if (dirty) {
      const path = targetForTable(state, dirty, staff);
      if (path.length) {
        return {
          staff: { ...staff, path, task: { type: 'clean_table', tableId: dirty.id } },
          claimedTableId: dirty.id,
        };
      }
    }

    const dirtyServiceItem = serviceItems.find(item => item.state === 'to_clean'
      && (!claimedServiceItemIds || !claimedServiceItemIds.has(item.id))
      && Number.isFinite(item.x) && Number.isFinite(item.y));
    if (dirtyServiceItem) {
      const path = targetForRectOrCurrent(
        state,
        { x: dirtyServiceItem.x - 10, y: dirtyServiceItem.y - 10, w: 20, h: 20 },
        staff,
      );
      if (path) {
        return {
          staff: { ...staff, path, task: { type: 'clean_service_item', serviceItemId: dirtyServiceItem.id } },
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
        const path = targetForRect(state, { x: station.x, y: station.y, w: 40, h: 40 }, staff);
        if (path.length) {
          return {
            staff: {
              ...staff,
              path,
              task: { type: 'prepare_dish', serviceItemId: pending.id, stationId: station.id },
            },
          };
        }
      }
    }
  }

  return null;
}

function resolveTask({ state, staff, customers, queue, tables, serviceItems }) {
  const completedStaff = { ...staff, task: null };

  if (staff.task.type === 'take_order') {
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    if (!customer || customer.state !== 'seated') return { staff: completedStaff, customers, queue, tables, serviceItems };
    if (staff.task.startedAt == null) {
      return { staff: { ...staff, path: [], task: { ...staff.task, startedAt: state.restaurant.gameTime } }, queue, tables, serviceItems, customers };
    }
    if (state.restaurant.gameTime - staff.task.startedAt < ACTIVITY_DURATIONS.takeOrder) {
      return { staff: { ...staff, path: [] }, queue, tables, serviceItems, customers };
    }
    const ordered = createCustomerOrder(
      { ...state, serviceItems },
      customer,
    );
    return {
      staff: completedStaff,
      queue,
      tables,
      serviceItems: ordered.serviceItems,
      customers: customers.map(candidate => candidate.id === customer.id
        ? ordered.customer
        : candidate),
    };
  }

  if (staff.task.type === 'take_payment') {
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    if (!customer || customer.state !== 'paying') return { staff: completedStaff, customers, queue, tables, serviceItems };
    const station = (state.cashierStations || []).find(candidate => candidate.id === staff.task.stationId);
    const customerPosition = station ? getCashierCustomerPosition(station, 0) : null;
    const cashierArrived = station && Math.hypot(staff.x - getCashierWorkPosition(station).x, staff.y - getCashierWorkPosition(station).y) <= 2;
    const customerArrived = customerPosition && Math.hypot(customer.x - customerPosition.x, customer.y - customerPosition.y) <= 2;
    if (!customer.paymentReady || !cashierArrived || !customerArrived) {
      return { staff: { ...completedStaff, path: [] }, customers, queue, tables, serviceItems };
    }
    if (staff.task.startedAt == null) {
      return { staff: { ...staff, path: [], task: { ...staff.task, startedAt: state.restaurant.gameTime } }, customers, queue, tables, serviceItems };
    }
    if (state.restaurant.gameTime - staff.task.startedAt < ACTIVITY_DURATIONS.takePayment) {
      return { staff: { ...staff, path: [] }, customers, queue, tables, serviceItems };
    }
    const dishPrice = (state.dishes || []).find(candidate => candidate.id === customer.dishId)?.price || 0;
    const drinkPrice = getDrink(customer.drinkId)?.price || 0;
    const price = dishPrice + drinkPrice;
    const happiness = Number.isFinite(customer.happiness) ? customer.happiness : 80;
    const tip = Math.round(price * getTipRate(happiness) * 100) / 100;
    const reputationGainEffect = getUpgradeEffect(state, 'reputationGain');
    const reputationGain = (0.01 + happiness / 10000) * (1 + reputationGainEffect);
    const payment = {
      customerId: customer.id,
      day: state.restaurant.day || Math.floor(state.restaurant.gameTime / 86400) + 1,
      dishId: customer.dishId,
      drinkId: customer.drinkId,
      revenue: price + tip,
      tip,
      totalPaid: price + tip,
    };
    const remainingAtTable = customers.some(candidate => candidate.id !== customer.id && candidate.tableId === customer.tableId && candidate.state !== 'leaving');
    const carriedServiceItemIds = serviceItems
      .filter(item => item.customerId === customer.id && ['carried', 'carried_dirty'].includes(item.state))
      .map(item => item.id);
    return {
      staff: completedStaff, queue,
      customers: customers.map(candidate => candidate.id === customer.id
        ? leavingFields({ ...candidate, departureReason: 'served' })
        : candidate),
       serviceItems: markCustomerItemsDirty(serviceItems.filter(item => item.customerId !== customer.id
          || !['ordered', 'preparing'].includes(item.state)), customer.id, state.restaurant.gameTime),
        clearCarriedServiceItemIds: carriedServiceItemIds,
       tables: tables.map(table => table.id === customer.tableId && !remainingAtTable ? { ...table, status: 'dirty' } : table),
      completedCustomers: [...(state.completedCustomers || []), payment],
      restaurant: {
        ...state.restaurant,
        totalServed: (state.restaurant.totalServed || 0) + 1,
        reputation: clampReputation(state.restaurant.reputation + reputationGain),
      },
    };
  }

  if (staff.task.type === 'clean_table') {
    const table = tables.find(candidate => candidate.id === staff.task.tableId);
    if (!table || table.status !== 'dirty') {
      return { staff: { ...completedStaff, path: [] }, queue, customers, serviceItems, tables };
    }
    if (staff.task.cleaningStartedAt == null) {
      return {
        staff: { ...staff, path: [], task: { ...staff.task, cleaningStartedAt: state.restaurant.gameTime } },
        tables, customers, queue, serviceItems,
      };
    }
    if (state.restaurant.gameTime - staff.task.cleaningStartedAt < 2) {
      return { staff: { ...staff, path: [] }, queue, customers, serviceItems, tables };
    }
    const hasDirtyItems = serviceItems.some(item => item.tableId === staff.task.tableId && item.state === 'dirty_at_table');
    if (hasDirtyItems || customers.some(customer => customer.tableId === staff.task.tableId
      && customer.state !== 'leaving' && customer.state !== 'paying')) {
      return { staff: { ...completedStaff, path: [] }, queue, customers, serviceItems, tables };
    }
    return {
      staff: { ...completedStaff, path: [] }, queue, customers, serviceItems,
      tables: tables.map(t => t.id === staff.task.tableId ? { ...t, status: 'empty' } : t),
    };
  }

  if (staff.task.type === 'clean_floor') {
    const dirt = (state.floorDirt || []).find(candidate => candidate.id === staff.task.dirtId);
    if (!dirt) return { staff: { ...completedStaff, path: [] }, queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [] };
    if (staff.task.cleaningStartedAt == null) {
      return {
        staff: { ...staff, path: [], task: { ...staff.task, cleaningStartedAt: state.restaurant.gameTime } },
        queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [],
      };
    }
    if (state.restaurant.gameTime - staff.task.cleaningStartedAt < ACTIVITY_DURATIONS.wipeFloor) {
      return { staff: { ...staff, path: [] }, queue, customers, tables, serviceItems, floorDirt: state.floorDirt || [] };
    }
    return {
      staff: { ...completedStaff, path: [] }, queue, customers, tables, serviceItems,
      floorDirt: (state.floorDirt || []).filter(candidate => candidate.id !== dirt.id),
    };
  }

  if (staff.task.type === 'guide_customer') {
    const table = tables.find(t => t.id === staff.task.tableId);
    const seatTime = state.restaurant.gameTime;
    const ids = taskCustomerIds(staff.task);
    const availableChairs = getAvailableChairs(
      table?.id,
      customers,
      getActiveGuideTasks(state.staff, staff.id),
      state.chairs || [],
    );
    const reservedChairIds = new Set(staff.task.reservedChairIds || staff.task.chairIds || []);
    const chairs = [
      ...availableChairs.filter(chair => reservedChairIds.has(chair.id)),
      ...availableChairs.filter(chair => !reservedChairIds.has(chair.id)),
    ].filter((chair, index, allChairs) => allChairs.findIndex(candidate => candidate.id === chair.id) === index);

    if (!table || ids.length === 0 || chairs.length < ids.length) {
      return {
        staff: completedStaff, serviceItems,
        queue: queue.filter(q => !ids.includes(q.id)),
        tables: tables.map(t => t.id === staff.task.tableId ? { ...t, status: 'empty' } : t),
        customers: customers.map(c => ids.includes(c.id)
          ? leavingFields({ ...c, tableId: null, guideStaffId: null, chairId: null })
          : c),
      };
    }

    return {
      staff: completedStaff, serviceItems,
      queue: queue.filter(q => !ids.includes(q.id)),
      tables: tables.map(t => t.id === staff.task.tableId ? { ...t, status: 'occupied' } : t),
      customers: customers.map(c => {
        const index = ids.indexOf(c.id);
        if (index < 0) return c;
        const chair = chairs[index];
        return {
          ...c,
          state: 'seated', tableId: table?.id || c.tableId,
          chairId: chairs[index].id,
          guideStaffId: null, seatTime, path: [],
        };
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

  if (staff.task.type === 'collect_dirty_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    if (!item || item.state !== 'dirty_at_table' || !table || staff.carryingServiceItemId != null) {
      return { staff: { ...completedStaff, carryingServiceItemId: null }, queue, tables, customers, serviceItems };
    }
    const pickupPath = targetForRectOrCurrent(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff);
    if (pickupPath === null) {
      return { staff: { ...completedStaff, path: [], carryingServiceItemId: null }, queue, tables, customers, serviceItems };
    }
    if (pickupPath.length) {
      return { staff: { ...staff, path: pickupPath }, queue, tables, customers, serviceItems };
    }
    const carriedItems = serviceItems.map(candidate => candidate.id === item.id
      ? { ...candidate, state: 'carried_dirty' } : candidate);
    const stationChoice = selectWashStation(state, staff, carriedItems, state.staff);
    return {
      staff: { ...staff, task: stationChoice ? { type: 'deliver_dirty_item', serviceItemId: item.id, washStationId: stationChoice.station.id } : null,
        carryingServiceItemId: item.id, path: stationChoice?.path || [] },
      queue, customers,
      tables: releaseClearedTables(tables, customers, carriedItems),
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
      return { staff: { ...completedStaff, path: [], carryingServiceItemId: item.id }, queue, tables, customers, serviceItems };
    }
    const deliveryPath = targetForRectOrCurrent(state, station, staff);
    if (deliveryPath === null) {
      return { staff: { ...completedStaff, path: [], carryingServiceItemId: item.id }, queue, tables, customers, serviceItems };
    }
    if (deliveryPath.length) {
      return { staff: { ...staff, path: deliveryPath }, queue, tables, customers, serviceItems };
    }
    if (!hasWashStationCapacity(state, station, { excludeServiceItemId: item.id })) {
      return {
        staff: { ...completedStaff, path: [], carryingServiceItemId: item.id },
        queue, tables, customers, serviceItems,
      };
    }
    return {
      staff: { ...completedStaff, carryingServiceItemId: null, path: [] }, queue, tables, customers,
      serviceItems: serviceItems.map(candidate => candidate.id === item.id
        ? { ...candidate, state: 'queued_for_wash', washStationId: station.id, washQueuedAt: state.restaurant.gameTime } : candidate),
    };
  }

  if (staff.task.type === 'wash_item') {
    const item = serviceItems.find(candidate => candidate.id === staff.task.serviceItemId);
    const station = (state.washStations || []).find(candidate => candidate.id === staff.task.washStationId && candidate.type === 'manual');
    if (!item || !['queued_for_wash', 'washing'].includes(item.state) || item.washStationId !== station?.id) {
      return { staff: { ...completedStaff, path: [] }, queue, tables, customers, serviceItems };
    }
    if (staff.task.washingStartedAt == null) {
      const itemIndex = serviceItems.indexOf(item);
      return { staff: { ...staff, path: [], task: { ...staff.task, washingStartedAt: state.restaurant.gameTime } }, queue, tables, customers, serviceItems: serviceItems.map((candidate, index) => index === itemIndex ? { ...candidate, state: 'washing', washStartedAt: state.restaurant.gameTime } : candidate) };
    }
    if (state.restaurant.gameTime - staff.task.washingStartedAt < ACTIVITY_DURATIONS.manualWash) {
      return { staff: { ...staff, path: [] }, queue, tables, customers, serviceItems };
    }
    const itemIndex = serviceItems.indexOf(item);
    return { staff: { ...completedStaff, path: [] }, queue, tables, customers, serviceItems: serviceItems.filter((_candidate, index) => index !== itemIndex) };
  }

  if (staff.task.type === 'deliver_service_item') {
    const itemIndex = serviceItems.findIndex(candidate => candidate.id === staff.task.serviceItemId);
    const item = serviceItems[itemIndex];
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    const table = tables.find(candidate => candidate.id === item?.tableId);
    const canDeliver = customer
      && customer.state !== 'leaving'
      && item?.state === 'carried'
      && staff.carryingServiceItemId === item.id
      && item.customerId === customer.id
      && staff.task.serviceItemId === item.id
      && staff.task.customerId === item.customerId
      && item.tableId === customer.tableId
      && table?.id === item.tableId;
    if (!canDeliver) {
      const ownsTaskItem = staff.carryingServiceItemId === staff.task.serviceItemId;
      const anotherWorkerOwnsTaskItem = (state.staff || []).some(candidate =>
        candidate.id !== staff.id && candidate.carryingServiceItemId === staff.task.serviceItemId
      );
      return {
        staff: {
          ...staff,
          task: null,
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
    return {
      staff: { ...staff, task: null, carryingServiceItemId: null },
      queue, tables, serviceItems: deliveredServiceItems,
      customers: customers.map(candidate => {
        if (candidate.id !== customer.id) return candidate;
        const happiness = item.kind === 'dish'
          ? Math.min(100, (candidate.happiness ?? 80) + happinessBonus)
          : candidate.happiness;
        return allOrderedItemsDelivered(candidate, deliveredServiceItems)
          ? {
            ...candidate,
            state: 'eating',
             eatTime: state.restaurant.gameTime,
             consumptionStartedAt: state.restaurant.gameTime,
             consumptionDuration: candidate.dishId && candidate.drinkId
               ? ACTIVITY_DURATIONS.consumeBoth
               : candidate.dishId ? ACTIVITY_DURATIONS.consumeFood : ACTIVITY_DURATIONS.consumeDrink,
            ...(item.kind === 'dish' ? { happiness } : {}),
          }
          : item.kind === 'dish'
            ? { ...candidate, happiness }
            : candidate;
      }),
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
        staff: { ...completedStaff, path: [] },
        customers, queue, tables,
        serviceItems: item?.assignedStaffId === staff.id
          ? clearDrinkReservation(serviceItems, staff.task.serviceItemId)
          : serviceItems,
      };
    }

    if (item.state === 'ordered') {
      return {
        staff: { ...staff, path: [] },
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
        staff: { ...staff, path: [] },
        customers, queue, tables, serviceItems,
      };
    }

    const position = getServiceSlotPosition(serviceTable, item.serviceSlotIndex);
    return {
      staff: { ...completedStaff, path: [] },
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
      staff: { ...staff, path: [] }, queue, tables, customers,
      serviceItems: serviceItems.map(candidate => item.state === 'ordered' && candidate.id === item.id
        ? {
          ...candidate,
          state: 'preparing',
          stationId: staff.task.stationId,
          assignedStaffId: staff.id,
          preparationStartedAt: state.restaurant.gameTime,
        }
        : candidate),
    };
  }

  return { staff: completedStaff, customers, queue, tables, serviceItems };
}

export function prepareStaffForMovement(state, gameDt) {
  gameDt = Math.max(0, Number(gameDt) || 0);
  state = normaliseServiceItemOwnership(state);
  let customers = [...(state.customers || [])];
  let queue = [...(state.queue || [])];
  let tables = [...(state.tables || [])];
  let serviceItems = [...(state.serviceItems || [])];
  let completedCustomers = [...(state.completedCustomers || [])];
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
      if (s.task.customerIds) s.task.customerIds.forEach(id => claimedCustomerIds.add(id));
      if (s.task.serviceItemId) claimedServiceItemIds.add(s.task.serviceItemId);
      if (s.task.type === 'clean_table' && s.task.tableId) claimedTableIds.add(s.task.tableId);
      if (s.task.type === 'clean_floor' && s.task.dirtId) claimedDirtIds.add(s.task.dirtId);
    }
  }
  staff = staff.map(worker => worker.task?.type === 'prepare_drink'
    && !serviceItems.some(item => item.id === worker.task.serviceItemId
      && item.assignedStaffId === worker.id
      && hasValidDrinkReservation({ ...state, staff }, item))
    ? { ...worker, task: null, path: [] } : worker);

  // Cancel tasks whose customer disappeared while being guided. Without this,
  // the guiding staff reaches the destination and creates a permanently occupied table.
  for (let i = 0; i < staff.length; i += 1) {
    const current = staff[i];
    if (current.task?.type !== 'guide_customer') continue;
    const ids = taskCustomerIds(current.task);
    if (ids.length && ids.some(id => !customers.some(customer => customer.id === id && customer.state !== 'leaving'))) {
      tables = tables.map(table => table.id === current.task.tableId && table.status === 'reserved'
        ? { ...table, status: 'empty' }
        : table);
      customers = customers.map(customer => {
        if (!ids.includes(customer.id)) return customer;
        if (customer.state === 'leaving') {
          return { ...customer, tableId: null, guideStaffId: null, chairId: null };
        }
        return {
          ...leavingFields(customer),
          tableId: null,
          guideStaffId: null,
          chairId: null,
          happiness: Math.max(0, customer.happiness - 30),
        };
      });
      staff[i] = { ...current, task: null, path: [] };
    }
  }

  // Legacy waiting customers can enter guidance without world coordinates.
  // Materialise them only in this pre-batch phase at deterministic queue slots;
  // subsequent route planning and movement still go through shared descriptors.
  const occupiedActors = [...staff, ...customers]
    .filter(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y));
  customers = customers.map(customer => {
    if (Number.isFinite(customer.x) && Number.isFinite(customer.y)) return customer;
    const guideContext = getCustomerGuideContext({ ...state, staff, customers }, customer);
    if (!guideContext) return customer;
    const start = findGuidedCustomerStart(state, customer, guideContext, occupiedActors);
    if (!start) return customer;
    const normalised = { ...customer, ...start };
    occupiedActors.push(normalised);
    return normalised;
  });

  // Followers must have routes before the shared movement commit; planning here
  // keeps the batch deterministic and prevents a follower from moving twice.
  for (const s of staff) {
    if (s.task?.type !== 'guide_customer' || hasArrived(s)) continue;
    const ids = taskCustomerIds(s.task);
    customers = customers.map((customer, index, allCustomers) => {
      const guideContext = getCustomerGuideContext({ ...state, staff, customers }, customer);
      if (!guideContext || guideContext.guide.id !== s.id || customer.path?.length) return customer;
      const memberIndex = Math.max(0, ids.indexOf(customer.id));
      const preceding = memberIndex > 0
        ? allCustomers.find(candidate => candidate.id === ids[memberIndex - 1])
        : s;
      return planCharacterPath(
        { ...state, staff, customers, tables, serviceItems },
        customer,
        { world: { x: preceding.x - 12, y: preceding.y + 12 } },
        [...staff, ...allCustomers.filter((_, candidateIndex) => candidateIndex !== index)],
        [s.id, ...ids],
      );
    });
  }

  return {
    ...state, staff, customers, queue, tables, serviceItems, completedCustomers, floorDirt, restaurant,
    __staffClaimedServiceItemIds: staleTaskServiceItemIds,
  };
}

export function getStaffMovementEntries(state) {
  const entries = [];
  const movingIds = new Set();
  for (const staff of state.staff || []) {
    if (!Number.isFinite(staff.x) || !Number.isFinite(staff.y)) continue;
    const ids = getGuidePartyContext(state, staff)?.ignoredIds || [];
    if (staff.path?.length) {
      const movementRecovery = Boolean(staff.headOnRecovery
        || (staff.usingStaticFallback && (staff.stalledFor || 0) >= 2));
      entries.push({
        character: staff,
        speed: staff.role === 'waiter' ? 75 : 55,
        ignoredIds: ids,
        ...(movementRecovery ? { headOnDetourEligible: true } : {}),
      });
      movingIds.add(staff.id);
    }
  }
  for (const customer of state.customers || []) {
    if (!Number.isFinite(customer.x) || !Number.isFinite(customer.y)) continue;
    const guideContext = getCustomerGuideContext(state, customer);
    if (guideContext && customer.path?.length) {
      entries.push({
        character: customer,
        speed: 62,
        ignoredIds: guideContext.ignoredIds,
        provenance: 'guide',
      });
      movingIds.add(customer.id);
    }
  }
  for (const character of [...(state.staff || []), ...(state.customers || [])]) {
    if (!Number.isFinite(character.x) || !Number.isFinite(character.y) || movingIds.has(character.id)) continue;
    entries.push({ character, speed: 0, ignoredIds: [] });
  }
  return entries;
}

export function resolveStaffAfterMovement(state, gameDt) {
  let { staff, customers, queue, tables, serviceItems, completedCustomers, floorDirt, restaurant } = state;
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

    if (s.task && !hasArrived(s)) continue;

    if (s.task && hasArrived(s)) {
      const resolved = resolveTask({
        state: { ...state, restaurant, staff, customers, queue, tables, serviceItems, completedCustomers, floorDirt },
        staff: s, customers, queue, tables, serviceItems,
      });
      if (resolved.customers) customers = resolved.customers;
      if (resolved.queue) queue = resolved.queue;
      if (resolved.tables) tables = resolved.tables;
      if (resolved.serviceItems) serviceItems = resolved.serviceItems;
      if (resolved.completedCustomers) completedCustomers = resolved.completedCustomers;
      if (resolved.restaurant) restaurant = resolved.restaurant;
      if (resolved.floorDirt) floorDirt = resolved.floorDirt;
      staff[i] = resolved.staff;
      if (resolved.clearCarriedServiceItemIds) {
        const clearedIds = new Set(resolved.clearCarriedServiceItemIds);
        staff = staff.map(worker => clearedIds.has(worker.carryingServiceItemId)
          ? { ...worker, carryingServiceItemId: null }
          : worker);
      }
      continue;
    }

    const result = assignTask({
      state: { ...state, restaurant, staff, customers, queue, tables, serviceItems, completedCustomers, floorDirt },
      staff: s, allStaff: staff, customers, queue, tables, serviceItems,
      claimedCustomerIds, claimedServiceItemIds, claimedTableIds, claimedDirtIds,
    });
    if (result) {
      staff[i] = result.staff;
      if (result.customers) customers = result.customers;
      if (result.queue) queue = result.queue;
      if (result.tables) tables = result.tables;
      if (result.serviceItems) serviceItems = result.serviceItems;
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
  const result = { ...cleanState, restaurant, staff, customers, queue, tables, serviceItems, completedCustomers, floorDirt };
  return result;
}

export function updateStaff(state, timing) {
  const gameDt = Math.max(0, Number.isFinite(timing) ? timing : Number(timing?.gameDt) || 0);
  const movementDt = Math.max(0, Number.isFinite(timing) ? timing : Number(timing?.movementDt) || 0);
  const prepared = prepareStaffForMovement(state, gameDt);
  const movementEntries = getStaffMovementEntries(prepared);
  const moved = resolveCharacterMovementBatch(prepared, movementEntries, movementDt);
  const committed = {
    ...prepared,
    staff: prepared.staff.map(character => moved.get(character.id) || character),
    customers: prepared.customers.map(character => moved.get(character.id) || character),
  };
  return resolveStaffAfterMovement(committed, gameDt);
}
