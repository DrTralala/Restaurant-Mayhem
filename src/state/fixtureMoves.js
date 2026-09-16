import { getFixture, getFixtureDescriptor } from '../data/fixtures';
import { validateFixtureMoves } from '../simulation/placement';
import {
  getOccupiedServiceSlotKeys,
  getServiceSlotPosition,
  normaliseServiceItemOwnership,
} from '../simulation/serviceItems';
import { recoverCookingBatches } from '../simulation/cookingBatches';
import { isCheckoutState, requeueCheckoutCustomer } from '../simulation/checkout';
import { getWashStationOccupancy, isWashStationBusy } from '../simulation/dishwashing';
import { clearNavigationGoal } from '../simulation/movement/navigationGoal';
import { createNavigationWorkspace } from '../simulation/movement/navigationWorkspace';
import { reconcileFixtureResidencies } from '../simulation/movement/seatedDeparture';
import { reconcileSelfSeatingState } from '../simulation/selfSeating';
import { clearDiningOwnership } from '../simulation/tableLifecycle';
import { getPartyKey } from '../simulation/partyReviews';

const PHYSICALLY_SEATED_CUSTOMER_STATES = new Set([
  'seated',
  'ordering',
  'waiting_for_items',
  'waiting_for_party',
  'eating',
]);

function cancelNavigation(actor) {
  return clearNavigationGoal(actor);
}

function cancelTask(worker) {
  return cancelNavigation({ ...worker, task: null });
}

function expandFixtureMoves(state, requestedMoves) {
  if (!Array.isArray(requestedMoves)) return null;
  const expanded = [...requestedMoves];

  for (const tableMove of requestedMoves.filter(move => move?.type === 'table')) {
    const table = getFixture(state, 'table', tableMove.id)?.data;
    if (!table) continue;
    const deltaX = tableMove.x - table.x;
    const deltaY = tableMove.y - table.y;

    for (const chair of (state.chairs || []).filter(candidate => candidate.tableId === table.id)) {
      const explicitMoves = requestedMoves.filter(move =>
        move?.type === 'chair' && move.id === chair.id);
      if (explicitMoves.length > 0) {
        const consistent = explicitMoves.every(move =>
          move.x === chair.x + deltaX && move.y === chair.y + deltaY);
        if (!consistent) return null;
        continue;
      }
      expanded.push({
        type: 'chair',
        id: chair.id,
        x: chair.x + deltaX,
        y: chair.y + deltaY,
      });
    }
  }

  return expanded;
}

function applyValidatedMoves(state, moves) {
  const movesByCollection = new Map();
  for (const move of moves) {
    const descriptor = getFixtureDescriptor(move.type);
    const entries = movesByCollection.get(descriptor.collection) || [];
    entries.push(move);
    movesByCollection.set(descriptor.collection, entries);
  }

  const next = { ...state };
  for (const [collection, collectionMoves] of movesByCollection) {
    const byId = new Map(collectionMoves.map(move => [move.id, move]));
    next[collection] = (state[collection] || []).map(record => {
      const move = byId.get(record.id);
      if (!move) return record;
      return {
        ...record,
        ...(move.type === 'door' ? {} : { x: move.x }),
        y: move.y,
        ...(move.type === 'chair' ? { tableId: move.tableId } : {}),
        ...(Object.prototype.hasOwnProperty.call(move, 'rotation')
          ? { rotation: move.rotation }
          : {}),
      };
    });
  }
  return next;
}

function intersectsIds(value, ids) {
  if (Array.isArray(value)) return value.some(id => ids.has(id));
  return value != null && ids.has(value);
}

function taskIsAffected(task, affected) {
  if (!task) return false;
  return intersectsIds(task.tableId, affected.tableIds)
    || (task.type === 'prepare_dish'
      && intersectsIds(task.stationId, affected.kitchenStationIds))
    || (task.type === 'take_payment'
      && intersectsIds(task.stationId, affected.cashierIds))
    || intersectsIds(task.serviceTableId, affected.serviceTableIds)
    || intersectsIds(task.washStationId, affected.washStationIds)
    || intersectsIds(task.chairIds, affected.chairIds)
    || intersectsIds(task.reservedChairIds, affected.chairIds)
    || intersectsIds(task.customerId, affected.customerIds)
    || intersectsIds(task.customerIds, affected.customerIds);
}

function hasProtectedWashStationMove(state, moves) {
  return moves.some(move => {
    if (move?.type !== 'washStation') return false;
    const station = (state.washStations || []).find(candidate => candidate.id === move.id);
    return station && (getWashStationOccupancy(state, station) > 0
      || isWashStationBusy(state, station));
  });
}

function hasProtectedServiceTableMove(state, moves) {
  const occupiedSlots = getOccupiedServiceSlotKeys(state);
  return moves.some(move => move?.type === 'serviceTable'
    && [...occupiedSlots].some(key => key.startsWith(`${String(move.id)}:`)));
}

export function moveFixtures(state, requestedMoves) {
  const expandedMoves = expandFixtureMoves(state, requestedMoves);
  if (!expandedMoves || expandedMoves.length === 0) return state;
  if (hasProtectedWashStationMove(state, expandedMoves)) return state;
  if (hasProtectedServiceTableMove(state, expandedMoves)) return state;

  const validation = validateFixtureMoves(state, expandedMoves);
  if (!validation.valid) return state;

  const moves = validation.moves.filter(move => {
    const fixture = getFixture(state, move.type, move.id).data;
    return (move.type !== 'door' && move.x !== fixture.x)
      || move.y !== fixture.y
      || (move.type === 'chair' && move.tableId !== fixture.tableId)
      || (Object.prototype.hasOwnProperty.call(move, 'rotation')
        && move.rotation !== fixture.rotation);
  });
  if (moves.length === 0) return state;

  const idsByType = new Map();
  for (const move of moves) {
    const ids = idsByType.get(move.type) || new Set();
    ids.add(move.id);
    idsByType.set(move.type, ids);
  }
  const tableIds = idsByType.get('table') || new Set();
  const chairIds = idsByType.get('chair') || new Set();
  const kitchenStationIds = idsByType.get('kitchenStation') || new Set();
  const serviceTableIds = idsByType.get('serviceTable') || new Set();
  const cashierIds = idsByType.get('cashierTable') || new Set();
  const washStationIds = idsByType.get('washStation') || new Set();
  const movedDoorIds = idsByType.get('door') || new Set();
  const doorMoved = movedDoorIds.size > 0;
  const movedCashierStaffIds = new Set((state.cashierStations || [])
    .filter(station => cashierIds.has(station.id) && station.assignedStaffId != null)
    .map(station => station.assignedStaffId));

  const chairDeltas = new Map(moves
    .filter(move => move.type === 'chair')
    .map(move => {
      const chair = getFixture(state, 'chair', move.id).data;
      return [move.id, {
        x: move.x - chair.x,
        y: move.y - chair.y,
        tableId: chair.tableId,
        destinationTableId: move.tableId,
      }];
    }));
  const affectedCustomerIds = new Set((state.customers || [])
    .filter(customer => PHYSICALLY_SEATED_CUSTOMER_STATES.has(customer.state)
      && (tableIds.has(customer.tableId) || chairIds.has(customer.chairId)))
    .map(customer => customer.id));
  const affected = {
    tableIds,
    chairIds,
    kitchenStationIds,
    cashierIds,
    serviceTableIds,
    washStationIds,
    customerIds: affectedCustomerIds,
  };

  let next = applyValidatedMoves(state, moves);
  const cancelledTasks = [];
  const cancelledPaymentCustomerIds = new Set();
  next.staff = (state.staff || []).map(worker => {
    const affectedTask = taskIsAffected(worker.task, affected) || (doorMoved && worker.task != null);
    if (affectedTask) cancelledTasks.push({ workerId: worker.id, task: worker.task });
    if (affectedTask && worker.task.type === 'take_payment'
      && cashierIds.has(worker.task.stationId)) {
      cancelledPaymentCustomerIds.add(worker.task.customerId);
    }
    if (affectedTask) return cancelTask(worker);
    return doorMoved || (worker.task == null && movedCashierStaffIds.has(worker.id))
      ? cancelNavigation(worker)
      : worker;
  });

  next.customers = (state.customers || []).map(customer => {
    let updated = customer;
    const delta = chairDeltas.get(customer.chairId);
    if (delta && PHYSICALLY_SEATED_CUSTOMER_STATES.has(customer.state)
      && customer.tableId === delta.tableId) {
      updated = cancelNavigation({
        ...updated,
        tableId: delta.destinationTableId,
        ...(Number.isFinite(customer.x) ? { x: customer.x + delta.x } : {}),
        ...(Number.isFinite(customer.y) ? { y: customer.y + delta.y } : {}),
      });
    } else if (doorMoved) {
      updated = cancelNavigation(updated);
    }

    if (isCheckoutState(updated)
      && (cashierIds.has(updated.cashierStationId)
        || cancelledPaymentCustomerIds.has(updated.id))) {
      updated = requeueCheckoutCustomer(updated);
    }

    return updated;
  });

  next.serviceItems = (state.serviceItems || []).map(item => {
    const owner = next.customers.find(customer => customer.id === item.customerId);
    const priorOwner = (state.customers || []).find(customer => customer.id === item.customerId);
    if (owner && affectedCustomerIds.has(owner.id) && owner.tableId !== priorOwner?.tableId) {
      const table = next.tables.find(candidate => candidate.id === owner.tableId);
      const priorTable = state.tables.find(candidate => candidate.id === priorOwner?.tableId);
      item = { ...item, tableId: owner.tableId,
        ...(['delivered', 'dirty_at_table'].includes(item.state) && table && priorTable
          ? { x: item.x + table.x - priorTable.x, y: item.y + table.y - priorTable.y } : {}) };
    }
    const cancelledPreparation = cancelledTasks.some(({ workerId, task }) =>
      task.type === 'prepare_dish'
      && task.serviceItemId === item.id
      && task.stationId === item.stationId
      && item.assignedStaffId === workerId);
    if (item.state === 'preparing'
      && (kitchenStationIds.has(item.stationId) || cancelledPreparation)) {
      return {
        ...item,
        state: 'ordered',
        stationId: null,
        assignedStaffId: null,
        preparationStartedAt: null,
      };
    }
    const cancelledWash = cancelledTasks.some(({ task }) =>
      task.type === 'wash_item'
      && task.serviceItemId === item.id
      && task.washStationId === item.washStationId);
    const movedWashStation = washStationIds.has(item.washStationId);
    if (['washing', 'queued_for_wash'].includes(item.state)
      && (movedWashStation || cancelledWash)) {
      return {
        ...item,
        state: 'queued_for_wash',
        washStationId: movedWashStation ? null : item.washStationId,
        washStartedAt: null,
      };
    }
    if (item.state === 'on_service' && serviceTableIds.has(item.serviceTableId)) {
      const serviceTable = (next.serviceTables || []).find(table => table.id === item.serviceTableId);
      if (serviceTable && Number.isInteger(item.serviceSlotIndex)) {
        return { ...item, ...getServiceSlotPosition(serviceTable, item.serviceSlotIndex) };
      }
    }
    return item;
  });

  const transfers = next.customers.filter(customer => affectedCustomerIds.has(customer.id)
    && customer.tableId !== state.customers.find(prior => prior.id === customer.id)?.tableId);
  if (transfers.length > 0) {
    next.tables = next.tables.map(table => {
      const departing = transfers.filter(customer => state.customers.find(prior => prior.id === customer.id)?.tableId === table.id);
      const arriving = transfers.filter(customer => customer.tableId === table.id);
      if (departing.length === 0 && arriving.length === 0) return table;
      const ids = [...new Set([
        ...(table.diningCustomerIds || []).filter(id => !departing.some(customer => customer.id === id)),
        ...next.customers.filter(customer => customer.tableId === table.id
          && PHYSICALLY_SEATED_CUSTOMER_STATES.has(customer.state)).map(customer => customer.id),
      ])];
      if (ids.length === 0) {
        const dirty = next.serviceItems.some(item => item.tableId === table.id && ['dirty_at_table', 'to_clean'].includes(item.state));
        return clearDiningOwnership(table, dirty ? 'dirty' : 'empty');
      }
      return { ...table, status: 'occupied', diningCustomerIds: ids,
        diningPartyId: table.diningPartyId ?? getPartyKey(arriving[0]) };
    });
  }

  // Invalidate only the gate whose own door moved; an unrelated door edit must
  // leave the active crossing gate intact so reassessment stays per-door.
  if (next.queueAdmissionGate != null && movedDoorIds.has(next.queueAdmissionGate.doorId)) {
    next.queueAdmissionGate = null;
  }
  next = recoverCookingBatches(next, { stationIds: [...kitchenStationIds] });
  const residencies = reconcileFixtureResidencies(state, next, createNavigationWorkspace(next));
  return normaliseServiceItemOwnership(reconcileSelfSeatingState(residencies));
}
