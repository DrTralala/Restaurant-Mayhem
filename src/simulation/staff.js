import { findAdjacentOpenCells, findPath, worldToCell } from './pathfinding';
import { ensureStaffRuntime, hasArrived, moveCharacterAlongPath, moveCharacterTowards, moveStaffAlongPath } from './movement';
import { getCashierWorkPosition, getDoorPosition, getDoors, getQueuePosition } from './world';
import { clampReputation, getDishValueScore, getTipRate, getUpgradeEffect } from './balance';
import { getAssignedCashierStation } from './cashiers';

function occupiedCharacterCells(staff, customers, excludeId) {
  return new Set([...staff, ...customers]
    .filter(character => character.id !== excludeId && Number.isFinite(character.x) && Number.isFinite(character.y))
    .map(character => {
      const cell = worldToCell(character);
      return `${cell.x},${cell.y}`;
    }));
}

function rerouteMovingStaff(state, staff, customers) {
  return staff.map(current => {
    if (!current.task || !current.path?.length) return current;
    const occupiedCells = occupiedCharacterCells(staff, customers, current.id);
    const next = current.path[0];
    if (!occupiedCells.has(`${next.x},${next.y}`)) return current;
    const goal = current.path.at(-1);
    const path = findPath(state, worldToCell(current), goal, { occupiedCells });
    return path.length ? { ...current, path } : current;
  });
}

function targetForTable(state, table, staff) {
  return targetForRect(state, { x: table.x, y: table.y, w: 40, h: 40 }, staff);
}

function targetForRect(state, rect, staff) {
  const start = worldToCell(staff);
  const occupiedCells = occupiedCharacterCells(state.staff || [], state.customers || [], staff.id);
  const candidates = findAdjacentOpenCells(state, rect, start)
    .filter(candidate => !occupiedCells.has(`${candidate.x},${candidate.y}`));
  for (const target of candidates) {
    const path = findPath(state, start, target, { occupiedCells });
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

function bestDish(dishes) {
  if (!dishes || !dishes.length) return null;
  return dishes.reduce((best, dish) => getDishValueScore(dish) > getDishValueScore(best) ? dish : best, dishes[0]);
}

function getParty(members, lead) {
  if (!lead) return [];
  if (!lead.partyId) return [lead];
  return members.filter(member => member.partyId === lead.partyId);
}

function getPartySize(party, lead) {
  return Math.max(party.length, Number.isFinite(lead?.partySize) ? lead.partySize : 0);
}

function taskCustomerIds(task) {
  return task.customerIds || (task.customerId ? [task.customerId] : []);
}

function assignTask({ state, staff, customers, queue, tables, foodItems, kitchenQueue, claimedCustomerIds, claimedFoodIds, claimedTableIds }) {
  const cashierStation = staff.role === 'waiter'
    ? getAssignedCashierStation(state.cashierStations, staff.id)
    : null;

  if (cashierStation) {
    const paying = customers
      .filter(customer => customer.state === 'paying' && (!claimedCustomerIds || !claimedCustomerIds.has(customer.id)))
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
    if (staff.carryingFoodId) {
      const food = foodItems.find(f => f.id === staff.carryingFoodId);
      if (food) {
        const table = tables.find(t => t.id === food.tableId);
        if (table) {
          const path = targetForTable(state, table, staff);
          if (path.length) {
            return { staff: { ...staff, path, task: { type: 'deliver_food', foodId: food.id, customerId: food.customerId } } };
          }
        }
      }
    }

    const readyFood = foodItems.find(f => f.state === 'on_service' && (!claimedFoodIds || !claimedFoodIds.has(f.id)));
    if (readyFood) {
      const serviceTable = (state.serviceTables || []).find(table => table.id === readyFood.serviceTableId);
      if (serviceTable) {
        const path = targetForRect(state, { x: serviceTable.x, y: serviceTable.y, w: 120, h: 40 }, staff);
        if (path.length) {
          return { staff: { ...staff, path, task: { type: 'pickup_food', foodId: readyFood.id } }, claimedFoodId: readyFood.id };
        }
      }
    }

    const orderingCustomer = customers.find(c => c.state === 'seated' && !c.dishId && (!claimedCustomerIds || !claimedCustomerIds.has(c.id)));
    if (orderingCustomer && state.dishes && state.dishes.length > 0) {
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
            ? { ...c, state: 'guided', guideStaffId: staff.id, chairId: null, x: staff.x, y: staff.y }
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
        const outside = getDoorPosition(state, door).outside;
        const partyIds = party.map(c => c.id);
        const newCustomers = party.map((customer, index) => ({
          ...customer,
          state: 'guided', guideStaffId: staff.id, chairId: null,
          x: outside.x + index * 18, y: outside.y + index * 18,
          tableId: table.id,
          path: [...findPath(state, worldToCell(outside), worldToCell(staff)), ...path],
        }));
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
          queue: queue.filter(q => !party.some(member => member.id === q.id)),
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

    const dirtyFood = foodItems.find(f => f.state === 'to_clean' && (!claimedFoodIds || !claimedFoodIds.has(f.id)));
    if (dirtyFood) {
      const path = targetForRect(state, { x: dirtyFood.x - 10, y: dirtyFood.y - 10, w: 20, h: 20 }, staff);
      if (path.length) {
        return {
          staff: { ...staff, path, task: { type: 'clean_food', foodId: dirtyFood.id } },
          claimedFoodId: dirtyFood.id,
        };
      }
    }
  }

  if (staff.role === 'cook') {
    const pending = kitchenQueue.find(q => q.startTime === null && (!claimedCustomerIds || !claimedCustomerIds.has(q.customerId)));
    if (pending) {
      const station = state.kitchenStations.find(s => s.id === pending.stationId);
      if (station) {
        const path = targetForRect(state, { x: station.x, y: station.y, w: 40, h: 40 }, staff);
        if (path.length) {
          return {
            staff: { ...staff, path, task: { type: 'cook_order', stationId: pending.stationId, customerId: pending.customerId } },
            claimedCustomerId: pending.customerId,
          };
        }
      }
    }
  }

  return null;
}

function resolveTask({ state, staff, customers, queue, tables, foodItems, kitchenQueue }) {
  const completedStaff = { ...staff, task: null };

  if (staff.task.type === 'take_order') {
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    if (!customer || customer.state !== 'seated') return { staff: completedStaff, customers, queue, tables, foodItems, kitchenQueue };
    const dish = bestDish(state.dishes);
    return {
      staff: completedStaff, queue, tables, foodItems, kitchenQueue,
      customers: customers.map(c => c.id === staff.task.customerId ? { ...c, state: 'ordering', dishId: dish ? dish.id : null, orderTime: state.restaurant.gameTime } : c),
    };
  }

  if (staff.task.type === 'take_payment') {
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    if (!customer || customer.state !== 'paying') return { staff: completedStaff, customers, queue, tables, foodItems, kitchenQueue };
    const dish = state.dishes.find(candidate => candidate.id === customer.dishId);
    const price = dish?.price || 0;
    const happiness = Number.isFinite(customer.happiness) ? customer.happiness : 80;
    const tip = Math.round(price * getTipRate(happiness) * 100) / 100;
    const reputationGainEffect = getUpgradeEffect(state, 'reputationGain');
    const reputationGain = (0.01 + happiness / 10000) * (1 + reputationGainEffect);
    const payment = {
      customerId: customer.id,
      day: state.restaurant.day || Math.floor(state.restaurant.gameTime / 86400) + 1,
      dishId: customer.dishId,
      revenue: price + tip,
      tip,
      totalPaid: price + tip,
    };
    const remainingAtTable = customers.some(candidate => candidate.id !== customer.id && candidate.tableId === customer.tableId && candidate.state !== 'leaving');
    return {
      staff: completedStaff, queue, kitchenQueue,
      customers: customers.map(candidate => candidate.id === customer.id
        ? { ...candidate, state: 'leaving', departureReason: 'served', path: [], exitDoorId: null, checkoutPosition: null }
        : candidate),
      foodItems: foodItems.map(food => food.customerId === customer.id ? { ...food, state: 'to_clean' } : food),
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
      return { staff: { ...completedStaff, path: [] }, queue, foodItems, customers, kitchenQueue, tables };
    }
    if (staff.task.cleaningStartedAt == null) {
      return {
        staff: { ...staff, path: [], task: { ...staff.task, cleaningStartedAt: state.restaurant.gameTime } },
        tables, customers, queue, foodItems, kitchenQueue,
      };
    }
    if (state.restaurant.gameTime - staff.task.cleaningStartedAt < 2) {
      return { staff: { ...staff, path: [] }, queue, foodItems, customers, kitchenQueue, tables };
    }
    return {
      staff: { ...completedStaff, path: [] }, queue, foodItems, customers, kitchenQueue,
      tables: tables.map(t => t.id === staff.task.tableId ? { ...t, status: 'empty' } : t),
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
        staff: completedStaff, foodItems, kitchenQueue,
        queue: queue.filter(q => !ids.includes(q.id)),
        tables: tables.map(t => t.id === staff.task.tableId ? { ...t, status: 'empty' } : t),
        customers: customers.map(c => ids.includes(c.id)
          ? { ...c, state: 'leaving', tableId: null, guideStaffId: null, chairId: null, path: [], exitDoorId: null }
          : c),
      };
    }

    return {
      staff: completedStaff, foodItems, kitchenQueue,
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
          x: chairs[index].x + 10,
          y: chairs[index].y + 10,
          guideStaffId: null, seatTime,
        };
      }),
    };
  }

  if (staff.task.type === 'pickup_food') {
    const foodIndex = foodItems.findIndex(candidate => candidate.id === staff.task.foodId);
    const food = foodItems[foodIndex];
    const serviceTable = food
      ? (state.serviceTables || []).find(candidate => candidate.id === food.serviceTableId)
      : null;
    const anotherWorkerOwnsFood = food && state.staff.some(candidate =>
      candidate.id !== staff.id && candidate.carryingFoodId === food.id
    );
    const carriesAnotherFood = staff.carryingFoodId != null && staff.carryingFoodId !== food?.id;
    if (!food || food.state !== 'on_service' || !serviceTable || anotherWorkerOwnsFood || carriesAnotherFood) {
      return {
        staff: { ...completedStaff, carryingFoodId: staff.carryingFoodId ?? null },
        queue, tables, customers, kitchenQueue, foodItems,
      };
    }
    return {
      staff: { ...completedStaff, carryingFoodId: food.id },
      queue, tables, customers, kitchenQueue,
      foodItems: foodItems.map((candidate, index) => index === foodIndex ? { ...candidate, state: 'carried' } : candidate),
    };
  }

  if (staff.task.type === 'deliver_food') {
    const customer = customers.find(candidate => candidate.id === staff.task.customerId);
    const foodIndex = foodItems.findIndex(candidate => candidate.id === staff.task.foodId);
    const food = foodItems[foodIndex];
    const table = tables.find(candidate => candidate.id === food?.tableId);
    const canDeliver = customer
      && customer.state !== 'leaving'
      && food?.state === 'carried'
      && staff.carryingFoodId === food.id
      && food.customerId === customer.id
      && table;
    if (!canDeliver) {
      const ownsTaskFood = staff.carryingFoodId === staff.task.foodId;
      const anotherWorkerOwnsTaskFood = state.staff.some(candidate =>
        candidate.id !== staff.id && candidate.carryingFoodId === staff.task.foodId
      );
      return {
        staff: { ...staff, task: null, carryingFoodId: ownsTaskFood ? null : staff.carryingFoodId },
        customers, queue, tables, kitchenQueue,
        foodItems: foodItems.map(candidate => ownsTaskFood
          && !anotherWorkerOwnsTaskFood
          && candidate.id === staff.task.foodId
          && candidate.state === 'carried'
          ? { ...candidate, state: 'to_clean' }
          : candidate),
      };
    }
    const dish = state.dishes.find(candidate => candidate.id === food.dishId);
    const equipment = dish?.requiredEquipmentId
      ? state.equipment?.find(candidate => candidate.id === dish.requiredEquipmentId)
      : null;
    const happinessBonus = Math.round(
      ((dish?.quality ?? 1) - 1) * 2
      + getUpgradeEffect(state, 'qualityBonus') * 100
      + (equipment?.qualityBonus || 0) * 100
    );
    return {
      staff: { ...staff, task: null, carryingFoodId: null },
      queue, tables, kitchenQueue,
      foodItems: foodItems.map((candidate, index) => index === foodIndex
        ? { ...candidate, state: 'delivered', x: table.x + 8, y: table.y + 8 }
        : candidate),
      customers: customers.map(c => c.id === staff.task.customerId
        ? { ...c, state: 'eating', eatTime: state.restaurant.gameTime, happiness: Math.min(100, (c.happiness ?? 80) + happinessBonus) }
        : c),
    };
  }

  if (staff.task.type === 'clean_food') {
    return {
      staff: completedStaff, queue, tables, customers, kitchenQueue,
      foodItems: foodItems.filter(f => f.id !== staff.task.foodId),
    };
  }

  if (staff.task.type === 'cook_order') {
    return {
      staff: completedStaff, queue, tables, customers, foodItems,
      kitchenQueue: kitchenQueue.map(q =>
        q.stationId === staff.task.stationId && q.customerId === staff.task.customerId && q.startTime === null
          ? { ...q, startTime: state.restaurant.gameTime }
          : q
      ),
    };
  }

  return { staff: completedStaff, customers, queue, tables, foodItems, kitchenQueue };
}

export function updateStaff(state, dt) {
  let customers = [...state.customers];
  let queue = [...(state.queue || [])];
  let tables = [...state.tables];
  let foodItems = [...state.foodItems];
  let kitchenQueue = [...(state.kitchenQueue || [])];
  let completedCustomers = [...(state.completedCustomers || [])];
  let restaurant = state.restaurant;

  const claimedCustomerIds = new Set();
  const claimedFoodIds = new Set();
  const claimedTableIds = new Set();

  // Seed claimed sets from existing active staff tasks to prevent cross-tick duplicate claims
  for (const s of state.staff) {
    if (s.task) {
      if (s.task.customerId) claimedCustomerIds.add(s.task.customerId);
      if (s.task.customerIds) s.task.customerIds.forEach(id => claimedCustomerIds.add(id));
      if (s.task.foodId) claimedFoodIds.add(s.task.foodId);
      if (s.task.type === 'clean_table' && s.task.tableId) claimedTableIds.add(s.task.tableId);
    }
  }

  let staff = ensureStaffRuntime(state.staff, state).map(s => ({
    ...s,
    morale: Math.max(0, s.morale - 0.01 * dt),
  }));

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
          ...customer,
          state: 'leaving',
          tableId: null,
          guideStaffId: null,
          chairId: null,
          happiness: Math.max(0, customer.happiness - 30),
        };
      });
      staff[i] = { ...current, task: null, path: [] };
    }
  }

  staff = rerouteMovingStaff({ ...state, customers, tables, foodItems, kitchenQueue }, staff, customers);
  staff = staff.map((s, index, allStaff) => moveStaffAlongPath(s, dt, [
    ...allStaff.filter((_, candidateIndex) => candidateIndex !== index),
    ...customers,
  ]));

  for (const s of staff) {
    if (s.task && s.task.type === 'guide_customer' && !hasArrived(s)) {
      const ids = taskCustomerIds(s.task);
      customers = customers.map((c, customerIndex, allCustomers) => {
        if (c.guideStaffId !== s.id) return c;
        const memberIndex = Math.max(0, ids.indexOf(c.id));
        const preceding = memberIndex > 0
          ? allCustomers.find(candidate => candidate.id === ids[memberIndex - 1])
          : s;
        const others = [
          ...staff,
          ...allCustomers.filter((_, index) => index !== customerIndex),
        ];
        if (c.path?.length) return moveCharacterAlongPath(c, dt, others, 62);
        return moveCharacterTowards(c, {
          x: preceding.x - 12,
          y: preceding.y + 12,
        }, dt, others, 62);
      });
    }
  }

  for (let i = 0; i < staff.length; i += 1) {
    const s = staff[i];

    if (s.task && !hasArrived(s)) continue;

    if (s.task && hasArrived(s)) {
      const resolved = resolveTask({
        state: { ...state, restaurant, staff, customers, queue, tables, foodItems, kitchenQueue, completedCustomers },
        staff: s, customers, queue, tables, foodItems, kitchenQueue,
      });
      customers = resolved.customers;
      queue = resolved.queue;
      tables = resolved.tables;
      foodItems = resolved.foodItems;
      if (resolved.kitchenQueue) kitchenQueue = resolved.kitchenQueue;
      if (resolved.completedCustomers) completedCustomers = resolved.completedCustomers;
      if (resolved.restaurant) restaurant = resolved.restaurant;
      staff[i] = resolved.staff;
      continue;
    }

    const result = assignTask({ state: { ...state, restaurant, staff, customers, queue, tables, foodItems, kitchenQueue, completedCustomers }, staff: s, customers, queue, tables, foodItems, kitchenQueue, claimedCustomerIds, claimedFoodIds, claimedTableIds });
    if (result) {
      staff[i] = result.staff;
      if (result.customers) customers = result.customers;
      if (result.queue) queue = result.queue;
      if (result.tables) tables = result.tables;
      if (result.foodItems) foodItems = result.foodItems;
      if (result.kitchenQueue) kitchenQueue = result.kitchenQueue;
      if (result.claimedCustomerId) claimedCustomerIds.add(result.claimedCustomerId);
      if (result.claimedCustomerIds) result.claimedCustomerIds.forEach(id => claimedCustomerIds.add(id));
      if (result.claimedFoodId) claimedFoodIds.add(result.claimedFoodId);
      if (result.claimedTableId) claimedTableIds.add(result.claimedTableId);
    }
  }

  foodItems = foodItems.map(food => {
    const carrier = staff.find(candidate => candidate.carryingFoodId === food.id);
    return carrier ? { ...food, x: carrier.x, y: carrier.y } : food;
  });

  return { ...state, restaurant, staff, customers, queue, tables, foodItems, kitchenQueue, completedCustomers };
}
