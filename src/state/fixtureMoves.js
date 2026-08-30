import { getFixture, getFixtureDescriptor } from '../data/fixtures';
import { validateFixtureMoves } from '../simulation/placement';
import {
  getServiceSlotPosition,
  normaliseServiceItemOwnership,
} from '../simulation/serviceItems';

const MOVEMENT_RECOVERY_FIELDS = [
  'pathGoal',
  'usingStaticFallback',
  'minimumSpacing',
  'localConflictTarget',
  'headOnRecovery',
  'recoveredHeadOnDetourTarget',
];
const PHYSICALLY_SEATED_CUSTOMER_STATES = new Set([
  'seated',
  'ordering',
  'waiting_for_items',
  'eating',
]);

function clearPath(actor) {
  const cleared = { ...actor, path: [], stalledFor: 0 };
  for (const field of MOVEMENT_RECOVERY_FIELDS) delete cleared[field];
  return cleared;
}

function cancelTask(worker) {
  return clearPath({ ...worker, task: null });
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

function releaseGuideReservation(table, guideId, task) {
  if (table.id !== task.tableId || table.status !== 'reserved'
    || table.reservationOwnerStaffId !== guideId) return table;
  const { reservationOwnerStaffId: _reservationOwnerStaffId, ...released } = table;
  return { ...released, status: 'empty' };
}

export function moveFixtures(state, requestedMoves) {
  const expandedMoves = expandFixtureMoves(state, requestedMoves);
  if (!expandedMoves || expandedMoves.length === 0) return state;

  const validation = validateFixtureMoves(state, expandedMoves);
  if (!validation.valid) return state;

  const moves = validation.moves;
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
  const doorMoved = (idsByType.get('door')?.size || 0) > 0;

  const chairDeltas = new Map(moves
    .filter(move => move.type === 'chair')
    .map(move => {
      const chair = getFixture(state, 'chair', move.id).data;
      return [move.id, {
        x: move.x - chair.x,
        y: move.y - chair.y,
        tableId: chair.tableId,
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
  const cancelledGuides = [];
  const cancelledTasks = [];
  const cancelledPaymentCustomerIds = new Set();
  next.staff = (state.staff || []).map(worker => {
    const affectedTask = taskIsAffected(worker.task, affected) || (doorMoved && worker.task != null);
    if (affectedTask) cancelledTasks.push({ workerId: worker.id, task: worker.task });
    if (affectedTask && worker.task.type === 'guide_customer') {
      cancelledGuides.push({ guideId: worker.id, task: worker.task });
    }
    if (affectedTask && worker.task.type === 'take_payment'
      && cashierIds.has(worker.task.stationId)) {
      cancelledPaymentCustomerIds.add(worker.task.customerId);
    }
    if (affectedTask) return cancelTask(worker);
    return doorMoved ? clearPath(worker) : worker;
  });

  next.tables = (next.tables || []).map(table => cancelledGuides.reduce(
    (current, guide) => releaseGuideReservation(current, guide.guideId, guide.task),
    table,
  ));

  next.customers = (state.customers || []).map(customer => {
    let updated = customer;
    const delta = chairDeltas.get(customer.chairId);
    if (delta && PHYSICALLY_SEATED_CUSTOMER_STATES.has(customer.state)
      && customer.tableId === delta.tableId) {
      updated = clearPath({
        ...updated,
        ...(Number.isFinite(customer.x) ? { x: customer.x + delta.x } : {}),
        ...(Number.isFinite(customer.y) ? { y: customer.y + delta.y } : {}),
      });
    } else if (doorMoved) {
      updated = clearPath(updated);
    }

    if (updated.state === 'paying'
      && (cashierIds.has(updated.cashierStationId)
        || cancelledPaymentCustomerIds.has(updated.id))) {
      updated = clearPath({ ...updated, checkoutPosition: null });
    }

    const cancelledGuide = cancelledGuides.find(guide => {
      const customerIds = guide.task.customerIds
        || (guide.task.customerId ? [guide.task.customerId] : []);
      return customerIds.includes(updated.id)
        && updated.state === 'guided'
        && updated.guideStaffId === guide.guideId;
    });
    if (cancelledGuide) {
      updated = clearPath({
        ...updated,
        state: 'waiting',
        guideStaffId: null,
        tableId: null,
        chairId: null,
      });
    }
    return updated;
  });

  next.serviceItems = (state.serviceItems || []).map(item => {
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

  return normaliseServiceItemOwnership(next);
}
