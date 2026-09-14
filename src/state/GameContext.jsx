import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { createInitialState } from './initialState';
import { hydrateState, loadState, saveState } from './persistence';
import { ITEM_PRICES, ITEM_SELL_RATIO } from '../data/items';
import { getFixture, getFixtureDescriptor } from '../data/fixtures';
import { createEmptyAmenitySlots, isAmenityInUse } from '../data/staffAmenities';
import { getDrink, getResolvedDrink, normaliseDrinkOverrides } from '../data/drinks';
import { getPlaceable } from '../data/placeables';
import { getEquipmentLevelMultipliers } from '../data/equipment';
import { clampReputation } from '../simulation/balance';
import { assignWaiterToStation } from '../simulation/cashiers';
import { getNextNumericId, snapPlacement, validatePlacement } from '../simulation/placement';
import { getRestaurantWorld } from '../simulation/world';
import { getOccupiedServiceSlotKeys } from '../simulation/serviceItems';
import { getCarriedServiceItemIds, withCarriedServiceItemIds } from '../simulation/staffInventory';
import { normaliseOperatingHour } from '../simulation/clock';
import { getStaffTrainingCost, STAFF_SALARIES } from '../simulation/staffProgression';
import { getWashStationOccupancy, updateAutomaticDishwashers } from '../simulation/dishwashing';
import { getDishwasherStats } from '../simulation/dishwasherProgression';
import { createStaffDutyDefaults, validateStaffSchedule } from '../simulation/staffSchedules';
import {
  getStaffTaskLegacyRate,
  getStaffTaskTiming,
  settleStaffTaskProgress,
} from '../simulation/staffPerformance';
import { getCleaningTarget, isCleaningTask } from '../simulation/cleaningActions';
import { releaseStaffWork } from '../simulation/staffTaskLifecycle';
import { releaseAmenitySlot } from '../simulation/staffWellbeing';
import { copyFixtures } from './fixtureCopies';
import { moveFixtures } from './fixtureMoves';
import { invalidateMovementRuntime, moveStaff } from './staffMoves';

const DISH_QUALITY_COST = 50;
const BONUS_COST = 50;
const STARTING_DISH_QUALITY = 1;
const EXPANSION_COSTS = [0, 1000, 3000, 6000];

function canAfford(state, cost) {
  return Number.isFinite(cost)
    && cost >= 0
    && Number.isFinite(state.restaurant.funds)
    && state.restaurant.funds >= cost;
}

function getCataloguePrice(itemType, fallback = null) {
  return Number.isFinite(ITEM_PRICES[itemType]) ? ITEM_PRICES[itemType] : fallback;
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function getFixtureSalePrice(fixture) {
  const descriptor = getFixtureDescriptor(fixture?.type);
  const placementType = typeof descriptor?.placementType === 'function'
    ? descriptor.placementType(fixture?.data)
    : descriptor?.placementType;
  return getCataloguePrice(placementType, getPlaceable(placementType)?.price);
}

function isWashStationSaleSafe(state, station) {
  return station?.type === 'automatic'
    && getWashStationOccupancy(state, station) === 0;
}

function isServiceTableSaleSafe(state, table) {
  const prefix = `${String(table.id)}:`;
  return ![...getOccupiedServiceSlotKeys(state)].some(key => key.startsWith(prefix));
}

function isCashierSaleSafe(state, station) {
  return !(state.staff || []).some(worker => worker.task?.type === 'take_payment'
    && sameId(worker.task.stationId, station.id))
    && !(state.customers || []).some(customer => sameId(customer.cashierStationId, station.id)
      && ['checkout_moving', 'checkout_processing', 'checkout_queued'].includes(customer.state));
}

function isDoorSaleSafe(state, door) {
  const doorId = door?.id;
  if (doorId == null) return false;
  const activeActors = [
    ...(state.customers || []),
    ...(state.queue || []).flatMap(party => party?.members || []),
  ];
  if (activeActors.some(actor => actor.state === 'entering'
    && sameId(actor.entryDoorId, doorId))) return false;
  if (activeActors.some(actor => actor.state === 'leaving'
    && sameId(actor.exitDoorId, doorId) && actor.exitPhase !== 'fading')) return false;
  if (sameId(state.queueAdmissionGate?.doorId, doorId)) return false;
  const requests = state.doorAdmissions?.requests;
  return !Object.values(requests || {}).some(request => sameId(request?.doorId, doorId));
}

function isFixtureSaleSafe(state, fixture) {
  const data = fixture?.data;
  if (!data) return false;
  if (fixture.type === 'table') return data.status === 'empty';
  if (fixture.type === 'chair') {
    const table = (state.tables || []).find(candidate => sameId(candidate.id, data.tableId));
    return table?.status === 'empty'
      && !(state.customers || []).some(customer => sameId(customer.chairId, data.id));
  }
  if (fixture.type === 'washStation') return isWashStationSaleSafe(state, data);
  if (fixture.type === 'staffAmenity') return !isAmenityInUse(data);
  if (fixture.type === 'serviceTable') return isServiceTableSaleSafe(state, data);
  if (fixture.type === 'cashierTable') return isCashierSaleSafe(state, data);
  return fixture.type === 'door' && isDoorSaleSafe(state, data);
}

function getSaleSelection(state, requestedItems) {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) return null;

  const seen = new Set();
  const fixtures = [];
  for (const item of requestedItems) {
    if (!item || item.type == null || item.id == null) return null;
    const key = `${item.type}:${String(item.id)}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const fixture = getFixture(state, item.type, item.id);
    if (!fixture || getFixtureSalePrice(fixture) == null || !isFixtureSaleSafe(state, fixture)) {
      return null;
    }
    fixtures.push(fixture);
  }

  const selectedTables = new Set(fixtures
    .filter(fixture => fixture.type === 'table')
    .map(fixture => fixture.id));
  const selectedChairs = new Set(fixtures
    .filter(fixture => fixture.type === 'chair')
    .map(fixture => fixture.id));
  const removedChairs = new Set(selectedChairs);
  for (const chair of state.chairs || []) {
    if (selectedTables.has(chair.tableId)) removedChairs.add(chair.id);
  }

  let refundBase = 0;
  for (const fixture of fixtures) {
    if (fixture.type === 'table') refundBase += ITEM_PRICES.table;
    else if (fixture.type === 'chair' && selectedTables.has(fixture.data.tableId)) continue;
    else refundBase += getFixtureSalePrice(fixture);
  }
  for (const chair of state.chairs || []) {
    if (selectedTables.has(chair.tableId)
      && !fixtures.some(fixture => fixture.type === 'chair' && fixture.id === chair.id)) {
      refundBase += ITEM_PRICES.chair;
    }
  }

  return {
    fixtures,
    selectedTables,
    removedChairs,
    refund: Math.round(refundBase * ITEM_SELL_RATIO),
  };
}

function sellFixtures(state, requestedItems) {
  const selection = getSaleSelection(state, requestedItems);
  if (!selection) return state;

  const selectedByType = new Map();
  for (const fixture of selection.fixtures) {
    const ids = selectedByType.get(fixture.type) || new Set();
    ids.add(fixture.id);
    selectedByType.set(fixture.type, ids);
  }
  const remove = (type, record) => selectedByType.get(type)?.has(record.id);

  return {
    ...state,
    restaurant: { ...state.restaurant, funds: state.restaurant.funds + selection.refund },
    tables: (state.tables || []).filter(table => !selection.selectedTables.has(table.id)),
    chairs: (state.chairs || []).filter(chair => !selection.removedChairs.has(chair.id)),
    doors: (state.doors || []).filter(door => !remove('door', door)),
    serviceTables: (state.serviceTables || []).filter(table => !remove('serviceTable', table)),
    cashierStations: (state.cashierStations || []).filter(station => !remove('cashierTable', station)),
    washStations: (state.washStations || []).filter(station => !remove('washStation', station)),
    staffAmenities: (state.staffAmenities || []).filter(amenity => !remove('staffAmenity', amenity)),
  };
}

function taskServiceItemIds(state, worker) {
  const task = worker?.task;
  const ids = [
    ...(Array.isArray(task?.serviceItemIds) ? task.serviceItemIds : []),
    task?.serviceItemId,
  ].filter(id => id != null);
  if (task?.type === 'prepare_dish' && task.batchId != null) {
    const batch = (state.cookingBatches || []).find(candidate =>
      sameId(candidate.id, task.batchId));
    ids.push(...(batch?.serviceItemIds || []));
  }
  return [...new Set(ids.map(id => String(id)))];
}

function progressStartForItem(item, task, fallback) {
  return item?.preparationStartedAt
    ?? item?.washStartedAt
    ?? item?.startedAt
    ?? item?.cleaningStartedAt
    ?? task?.preparationStartedAt
    ?? task?.washingStartedAt
    ?? task?.startedAt
    ?? fallback;
}

// The lifecycle module exposes release semantics for turnover, while the
// performance module exposes the pure boundary settlement used by rate changes.
// Keep rate changes on the canonical target/item ledgers rather than rerolling a
// task from its old timestamp after morale or skill changes.
function settleStaffWorkBeforeRateChange(state, worker) {
  const now = state.restaurant?.gameTime;
  const timing = getStaffTaskTiming(state, worker);
  if (!timing || !Number.isFinite(now)) return state;

  const task = worker.task;
  const legacyRate = getStaffTaskLegacyRate(state, worker, task);
  const primaryProgress = settleStaffTaskProgress(
    timing.source,
    now,
    timing.rate,
    timing.startedAt,
    legacyRate,
  );
  let next = state;
  let taskProgress = primaryProgress;

  if (isCleaningTask(task) && task.type !== 'wash_item') {
    const target = getCleaningTarget(next, task);
    if (target?.cleaningAction) {
      const collectionKey = task.type === 'clean_floor' ? 'floorDirt' : 'tables';
      const targetId = task.type === 'clean_floor' ? task.dirtId : task.tableId;
      next = {
        ...next,
        [collectionKey]: (next[collectionKey] || []).map(candidate => sameId(candidate.id, targetId)
          ? {
            ...candidate,
            cleaningAction: {
              ...candidate.cleaningAction,
              accumulatedWork: primaryProgress.accumulatedWork,
              lastProgressAt: primaryProgress.lastProgressAt,
            },
          }
          : candidate),
      };
    }
  } else if (Array.isArray(next.serviceItems)) {
    const itemIds = new Set(taskServiceItemIds(next, worker));
    next = {
      ...next,
      serviceItems: next.serviceItems.map(item => {
        if (!itemIds.has(String(item.id))) return item;
        const progress = String(item.id) === String(task.serviceItemId)
          ? primaryProgress
          : settleStaffTaskProgress(
            item,
            now,
            timing.rate,
            progressStartForItem(item, task, timing.startedAt),
            legacyRate,
          );
        if (!Number.isFinite(progress.accumulatedWork)) return item;
        return {
          ...item,
          accumulatedWork: progress.accumulatedWork,
          lastProgressAt: progress.lastProgressAt,
        };
      }),
    };
  }

  if (Number.isFinite(taskProgress.accumulatedWork)) {
    next = {
      ...next,
      staff: next.staff.map(candidate => candidate.id === worker.id
        ? {
          ...candidate,
          task: {
            ...candidate.task,
            accumulatedWork: taskProgress.accumulatedWork,
            lastProgressAt: taskProgress.lastProgressAt,
          },
        }
        : candidate),
    };
  }
  return next;
}

function getLegacyPlacement(state, action, itemType) {
  if (itemType === 'table') {
    const tables = Array.isArray(state.tables) ? state.tables : [];
    const count = tables.length;
    return {
      itemType,
      x: action.x ?? 200 + (count % 2) * 200,
      y: action.y ?? 200 + Math.floor(count / 2) * 200,
      rotation: action.rotation ?? 0,
    };
  }

  if (itemType === 'chair') {
    const tables = Array.isArray(state.tables) ? state.tables : [];
    const chairs = Array.isArray(state.chairs) ? state.chairs : [];
    const table = [...tables].reverse().find(candidate =>
      chairs.filter(chair => chair.tableId === candidate.id).length < candidate.seats);
    if (!table) return null;

    const existing = chairs.filter(chair => chair.tableId === table.id);
    const positions = [
      { x: table.x + 10, y: table.y - 20, rotation: 2 },
      { x: table.x + 10, y: table.y + 40, rotation: 0 },
      { x: table.x - 20, y: table.y + 10, rotation: 1 },
      { x: table.x + 40, y: table.y + 10, rotation: 3 },
    ];
    const position = positions[existing.length];
    if (!position) return null;
    return {
      itemType,
      x: action.x ?? position.x,
      y: action.y ?? position.y,
      rotation: action.rotation ?? position.rotation,
    };
  }

  if (itemType === 'door') {
    const doors = Array.isArray(state.doors) ? state.doors : [];
    const world = getRestaurantWorld(state.restaurant || {});
    const defaultY = 340;
    const offsets = [100, -100, 200, -200, 300, -300];
    const y = offsets
      .map(offset => defaultY + offset)
      .find(candidate => candidate >= 80 && candidate <= 600
        && !doors.some(door => Math.abs(door.y - candidate) < 60));
    if (y == null) return null;
    return {
      itemType,
      x: action.x ?? world.doorX,
      y: action.y ?? y,
      rotation: action.rotation ?? 0,
    };
  }

  if (itemType === 'serviceTable') {
    const serviceTables = Array.isArray(state.serviceTables) ? state.serviceTables : [];
    return {
      itemType,
      x: action.x ?? 140 + serviceTables.length * 140,
      y: action.y ?? 120,
      rotation: action.rotation ?? 0,
    };
  }

  return null;
}

function placeLegacyItem(state, action, itemType) {
  const placement = getLegacyPlacement(state, action, itemType);
  return placement ? placeItem(state, placement) : state;
}

function placeItem(state, action) {
  const item = getPlaceable(action.itemType);
  const equipment = action.itemType === 'equipmentStation'
    ? state.equipment.find(candidate => candidate.id === action.equipmentId)
    : null;
  const requestedPlacement = {
    itemType: action.itemType,
    x: action.x,
    y: action.y,
    rotation: action.rotation ?? 0,
  };
  const snappedDoor = action.itemType === 'door'
    ? snapPlacement(action.itemType, requestedPlacement, state)
    : null;
  const placement = snappedDoor
    ? { ...requestedPlacement, y: snappedDoor.y }
    : requestedPlacement;
  const result = item && validatePlacement(state, placement);
  const price = equipment
    ? equipment.purchaseCost
    : getCataloguePrice(action.itemType, item?.price);
  if (!item || !result?.valid || !canAfford(state, price)
    || (action.itemType === 'equipmentStation' && (!equipment || equipment.owned))) return state;

  const nextState = {
    ...state,
    restaurant: { ...state.restaurant, funds: state.restaurant.funds - price },
  };

  if (action.itemType === 'equipmentStation') {
    return {
      ...nextState,
      equipment: state.equipment.map(candidate => candidate.id === equipment.id
        ? { ...candidate, owned: true }
        : candidate),
      kitchenStations: [...state.kitchenStations, {
        id: getNextNumericId(state.kitchenStations, 'k'),
        equipmentId: equipment.id,
        x: placement.x,
        y: placement.y,
      }],
    };
  }

  if (action.itemType === 'table') {
    const id = getNextNumericId(state.tables, 't');
    return {
      ...nextState,
      tables: [...state.tables, { id, seats: 4, status: 'empty', x: placement.x, y: placement.y }],
    };
  }

  if (action.itemType === 'chair') {
    const id = getNextNumericId(state.chairs, 'ch');
    return {
      ...nextState,
      chairs: [...state.chairs, {
        id,
        tableId: result.tableId,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
      }],
    };
  }

  if (action.itemType === 'door') {
    const doors = state.doors || [];
    const id = getNextNumericId(doors, 'door');
    return {
      ...nextState,
      doors: [...doors, { id, y: placement.y, role: 'entrance' }],
    };
  }

  if (action.itemType === 'serviceTable') {
    const serviceTables = state.serviceTables || [];
    const id = getNextNumericId(serviceTables, 'st');
    return {
      ...nextState,
      serviceTables: [...serviceTables, {
        id, x: placement.x, y: placement.y, rotation: placement.rotation,
      }],
    };
  }

  if (action.itemType === 'cashierTable') {
    const cashierStations = state.cashierStations || [];
    const id = getNextNumericId(cashierStations, 'cashier');
    const station = { id, x: placement.x, y: placement.y, w: 80, h: 40 };
    return {
      ...nextState,
      cashierStations: assignWaiterToStation(
        [...cashierStations, station],
        state.staff,
        id,
      ),
    };
  }

  if (action.itemType === 'automaticDishwasher') {
    const washStations = state.washStations || [];
    return {
      ...nextState,
      washStations: [...washStations, {
        id: getNextNumericId(washStations, 'wash'), type: 'automatic',
        level: 1, x: placement.x, y: placement.y, w: 40, h: 40,
      }],
    };
  }

  if (item.staffAmenity) {
    const staffAmenities = state.staffAmenities || [];
    return {
      ...nextState,
      staffAmenities: [...staffAmenities, {
        id: getNextNumericId(staffAmenities, 'amenity'),
        type: action.itemType,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        slots: createEmptyAmenitySlots(action.itemType),
      }],
    };
  }

  return state;
}

const GameContext = createContext(null);
const DispatchContext = createContext(null);

function gameReducer(state, action) {
  switch (action.type) {
    case 'TICK':
      return action.nextState;
    case 'SET_SPEED':
      return { ...state, speed: action.speed };
    case 'SET_OPERATING_HOURS': {
      const openHour = normaliseOperatingHour(action.openHour, null);
      const closeHour = normaliseOperatingHour(action.closeHour, null);
      if (openHour == null || closeHour == null) return state;
      return {
        ...state,
        restaurant: { ...state.restaurant, openHour, closeHour },
      };
    }
    case 'TOGGLE_PAUSE':
      return { ...state, paused: !state.paused };
    case 'UNLOCK_DRINK': {
      const drink = getDrink(action.id);
      const unlockedDrinkIds = Array.isArray(state.unlockedDrinkIds)
        ? state.unlockedDrinkIds
        : [];
      if (!drink || drink.unlockCost == null || unlockedDrinkIds.includes(drink.id)
        || !canAfford(state, drink.unlockCost)) return state;
      return {
        ...state,
        restaurant: {
          ...state.restaurant,
          funds: state.restaurant.funds - drink.unlockCost,
        },
        unlockedDrinkIds: [...unlockedDrinkIds, drink.id],
      };
    }
    case 'ADD_DISH': {
      const dish = action.dish;
      if (!dish || typeof dish.id !== 'string' || !dish.id
        || typeof dish.name !== 'string' || !dish.name.trim()
        || !Number.isFinite(dish.price) || !Number.isFinite(dish.quality)
        || dish.quality < STARTING_DISH_QUALITY) return state;
      return {
        ...state,
        dishes: [...state.dishes, {
          ...dish,
          price: Math.min(100, Math.max(1, Math.round(dish.price))),
          quality: STARTING_DISH_QUALITY,
        }],
      };
    }
    case 'REMOVE_DISH':
      return { ...state, dishes: state.dishes.filter(d => d.id !== action.id) };
    case 'UPDATE_DISH': {
      const dish = state.dishes.find(candidate => candidate.id === action.id);
      if (!dish || !action.changes) return state;
      const changes = { ...action.changes };
      delete changes.quality;
      if ('price' in changes) {
        if (!Number.isFinite(changes.price)) delete changes.price;
        else changes.price = Math.min(100, Math.max(1, Math.round(changes.price)));
      }
      return {
        ...state,
        dishes: state.dishes.map(candidate => candidate.id === action.id
          ? { ...candidate, ...changes }
          : candidate),
      };
    }
    case 'UPDATE_DRINK': {
      const drink = getDrink(action.id);
      const unlockedDrinkIds = Array.isArray(state.unlockedDrinkIds)
        ? state.unlockedDrinkIds
        : [];
      if (!drink || !unlockedDrinkIds.includes(drink.id)
        || !action.changes || !Number.isFinite(action.changes.price)) return state;
      const currentOverrides = normaliseDrinkOverrides(state.drinkOverrides);
      const price = Math.min(100, Math.max(1, Math.round(action.changes.price)));
      const drinkOverrides = normaliseDrinkOverrides({
        ...currentOverrides,
        [drink.id]: { ...currentOverrides[drink.id], price },
      });
      return { ...state, drinkOverrides };
    }
    case 'UPGRADE_DISH_QUALITY': {
      const dish = state.dishes.find(candidate => candidate.id === action.id);
      const quality = Math.min(10, Math.max(0, Math.floor(dish?.quality)));
      if (!dish || !Number.isFinite(dish.quality) || quality >= 10
        || !canAfford(state, DISH_QUALITY_COST)) return state;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - DISH_QUALITY_COST },
        dishes: state.dishes.map(candidate => candidate.id === dish.id
          ? { ...candidate, quality: quality + 1 }
          : candidate),
      };
    }
    case 'UPGRADE_DRINK_QUALITY': {
      const drink = getResolvedDrink(state, action.id);
      const unlockedDrinkIds = Array.isArray(state.unlockedDrinkIds)
        ? state.unlockedDrinkIds
        : [];
      const quality = Math.min(10, Math.max(0, Math.floor(drink?.quality)));
      if (!drink || !unlockedDrinkIds.includes(drink.id) || !Number.isFinite(drink.quality)
        || quality >= 10 || !canAfford(state, DISH_QUALITY_COST)) return state;
      const currentOverrides = normaliseDrinkOverrides(state.drinkOverrides);
      const drinkOverrides = normaliseDrinkOverrides({
        ...currentOverrides,
        [drink.id]: { ...currentOverrides[drink.id], quality: quality + 1 },
      });
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - DISH_QUALITY_COST },
        drinkOverrides,
      };
    }
    case 'BUY_UPGRADE': {
      const upgrade = state.upgrades.find(candidate => candidate.id === action.id);
      const cost = upgrade?.costs?.[upgrade.level];
      if (!upgrade || !Number.isInteger(upgrade.level) || upgrade.level < 0
        || upgrade.level >= upgrade.costs.length || !canAfford(state, cost)) return state;
      const reputation = upgrade.effects?.type === 'reputation'
        ? clampReputation(state.restaurant.reputation
          + (Number.isFinite(upgrade.effects.value) ? upgrade.effects.value : 0))
        : state.restaurant.reputation;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - cost, reputation },
        upgrades: state.upgrades.map(u =>
          u.id === action.id ? { ...u, level: u.level + 1 } : u
        ),
      };
    }
    case 'BUY_EQUIPMENT':
      return state;
    case 'UPGRADE_EQUIPMENT': {
      const equipment = state.equipment.find(candidate => candidate.id === action.id);
      const cost = equipment?.upgradeCosts?.[equipment.level - 1];
      if (!equipment?.owned || !Number.isInteger(equipment.level) || equipment.level < 1
        || equipment.level >= 10 || !canAfford(state, cost)) return state;
      const level = equipment.level + 1;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - cost },
        equipment: state.equipment.map(e =>
          e.id === action.id ? { ...e, level, ...getEquipmentLevelMultipliers(level) } : e
        ),
      };
    }
    case 'UPGRADE_DISHWASHER': {
      const station = (state.washStations || []).find(candidate => candidate.id === action.id);
      const level = station?.level;
      const stats = getDishwasherStats(level);
      const cost = stats?.nextUpgradeCost;
      if (station?.type !== 'automatic' || !Number.isInteger(level) || level < 1 || level > 9
        || !Number.isFinite(cost) || !canAfford(state, cost)) return state;

      const settled = updateAutomaticDishwashers(state);
      return {
        ...settled,
        restaurant: { ...settled.restaurant, funds: settled.restaurant.funds - cost },
        washStations: (settled.washStations || []).map(candidate => candidate.id === station.id
          ? { ...candidate, level: level + 1 }
          : candidate),
      };
    }
    case 'HIRE_STAFF': {
      const salary = STAFF_SALARIES[action.staff?.role];
      if (!action.staff || salary == null || !canAfford(state, salary)) return state;
      const { ...staff } = action.staff;
      const hiredStaff = {
        ...staff,
        ...createStaffDutyDefaults(),
        task: null,
        activityPhase: null,
        idleUntil: null,
      };
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - salary },
        staff: [...state.staff, { ...withCarriedServiceItemIds(hiredStaff, []), salary }],
      };
    }
    case 'SET_STAFF_SCHEDULE': {
      const worker = state.staff.find(candidate => candidate.id === action.id);
      const validation = validateStaffSchedule(action.schedule);
      if (!worker || !validation.valid) return state;
      return {
        ...state,
        staff: state.staff.map(candidate => candidate.id === worker.id
          ? { ...candidate, schedule: [...action.schedule] }
          : candidate),
      };
    }
    case 'FIRE_STAFF': {
      const fired = state.staff.find(staff => staff.id === action.id);
      if (!fired) return state;
      const now = state.restaurant?.gameTime;
      let released = releaseStaffWork(state, action.id, 'fired', now);
      released = releaseAmenitySlot(released, action.id, now, { reason: 'fired', force: true });
      released = {
        ...released,
        serviceItems: (released.serviceItems || []).map(item => {
          if (item.assignedStaffId !== action.id) return item;
          if (item.kind === 'dish' && ['ordered', 'preparing', 'ready'].includes(item.state)) {
            return {
              ...item, state: 'ordered', stationId: null, serviceTableId: null,
              serviceSlotIndex: null, assignedStaffId: null,
              preparationStartedAt: null, readyAt: null,
            };
          }
          if (item.kind === 'drink' && ['ordered', 'preparing'].includes(item.state)) {
            return {
              ...item, serviceTableId: null, serviceSlotIndex: null,
              assignedStaffId: null, preparationStartedAt: null,
            };
          }
          return item;
        }),
        staff: released.staff.filter(staff => staff.id !== action.id),
        cashierStations: (released.cashierStations || []).map(station => {
          if (station.assignedStaffId !== action.id) return station;
          const { assignedStaffId, ...unassigned } = station;
          return unassigned;
        }),
      };
      return invalidateMovementRuntime(released, action.id);
    }
    case 'RENAME_STAFF':
      return {
        ...state,
        staff: state.staff.map(s =>
          s.id === action.id ? { ...s, name: action.name } : s
        ),
      };
    case 'SET_STAFF_SALARY': {
      const staff = state.staff.find(candidate => candidate.id === action.id);
      if (!staff || !Number.isFinite(action.salary) || action.salary < staff.salary) return state;
      return {
        ...state,
        staff: state.staff.map(s =>
          s.id === action.id ? { ...s, salary: action.salary } : s
        ),
      };
    }
    case 'MOVE_STAFF':
      return moveStaff(state, action.id, { x: action.x, y: action.y });
    case 'TRAIN_STAFF': {
      const staff = state.staff.find(candidate => candidate.id === action.id);
      const cost = getStaffTrainingCost(staff);
      if (!staff || !Number.isFinite(staff.skill) || staff.skill >= 10
        || cost == null || !canAfford(state, cost)) return state;
      const settled = settleStaffWorkBeforeRateChange(state, staff);
      return {
        ...settled,
        restaurant: { ...settled.restaurant, funds: settled.restaurant.funds - cost },
        staff: settled.staff.map(s =>
          s.id === action.id
            ? {
              ...s,
              skill: Math.min(s.skill + 1, 10),
              morale: Math.min((Number.isFinite(s.morale) ? s.morale : 0) + 10, 100),
            }
            : s
        ),
      };
    }
    case 'GIVE_BONUS': {
      const staff = state.staff.find(candidate => candidate.id === action.id);
      if (!staff || !Number.isFinite(staff.morale) || staff.morale >= 100
        || !canAfford(state, BONUS_COST)) return state;
      const settled = settleStaffWorkBeforeRateChange(state, staff);
      return {
        ...settled,
        restaurant: { ...settled.restaurant, funds: settled.restaurant.funds - BONUS_COST },
        staff: settled.staff.map(s =>
          s.id === action.id ? { ...s, morale: Math.min(s.morale + 20, 100) } : s
        ),
      };
    }
    case 'ADD_TABLE': {
      const newId = `t${state.tables.length + 1}`;
      const count = state.tables.length;
      const col = count % 2;
      const row = Math.floor(count / 2);
      const tx = 200 + col * 200;
      const ty = 200 + row * 200;
      const seats = 4;
      const chairIdBase = state.chairs.length + 1;
      const newChairs = [
        { id: `ch${chairIdBase}`, tableId: newId, x: tx + 10, y: ty - 20, rotation: 2 },
        { id: `ch${chairIdBase + 1}`, tableId: newId, x: tx + 10, y: ty + 40, rotation: 0 },
      ];
      if (seats >= 4) {
        newChairs.push(
          { id: `ch${chairIdBase + 2}`, tableId: newId, x: tx - 20, y: ty + 10, rotation: 1 },
          { id: `ch${chairIdBase + 3}`, tableId: newId, x: tx + 40, y: ty + 10, rotation: 3 },
        );
      }
      return {
        ...state,
        tables: [...state.tables, { id: newId, seats, status: 'empty', x: tx, y: ty }],
        chairs: [...state.chairs, ...newChairs],
      };
    }
    case 'BUY_TABLE': {
      return placeLegacyItem(state, action, 'table');
    }
    case 'BUY_CHAIR': {
      return placeLegacyItem(state, action, 'chair');
    }
    case 'BUY_DOOR': {
      return placeLegacyItem(state, action, 'door');
    }
    case 'SET_DOOR_ROLE': {
      if (!['entrance', 'exit'].includes(action.role)
        || !(state.doors || []).some(door => door.id === action.id)) return state;
      return {
        ...state,
        doors: state.doors.map(door => door.id === action.id
          ? { ...door, role: action.role }
          : door),
      };
    }
    case 'PLACE_ITEM':
      return placeItem(state, action);
    case 'MOVE_FIXTURES':
    case 'MOVE_ITEMS':
      return moveFixtures(state, action.items);
    case 'COPY_FIXTURES':
      return copyFixtures(state, action.items);
    case 'SELL_ITEMS':
      return sellFixtures(state, action.items);
    case 'MOVE_CHAIR':
      return moveFixtures(state, [{
        type: 'chair', id: action.id, x: action.x, y: action.y,
        ...(action.rotation != null ? { rotation: action.rotation } : {}),
      }]);
    case 'MOVE_TABLE':
      return moveFixtures(state, [
        { type: 'table', id: action.id, x: action.x, y: action.y },
      ]);
    case 'MOVE_WASH_STATION':
      return moveFixtures(state, [
        { type: 'washStation', id: action.id, x: action.x, y: action.y },
      ]);
    case 'DELETE_TABLE':
      if (!isFixtureSaleSafe(state, getFixture(state, 'table', action.id))) return state;
      return {
        ...state,
        tables: state.tables.filter(t => t.id !== action.id),
        chairs: state.chairs.filter(ch => ch.tableId !== action.id),
      };
    case 'DELETE_CHAIR':
      if (!isFixtureSaleSafe(state, getFixture(state, 'chair', action.id))) return state;
      return {
        ...state,
        chairs: state.chairs.filter(ch => ch.id !== action.id),
      };
    case 'ROTATE_CHAIR':
      return {
        ...state,
        chairs: state.chairs.map(ch =>
          ch.id === action.id ? { ...ch, rotation: ((ch.rotation || 0) + 1) % 4 } : ch
        ),
      };
    case 'BUY_SERVICE_TABLE':
      return placeLegacyItem(state, action, 'serviceTable');
    case 'MOVE_SERVICE_TABLE':
      return moveFixtures(state, [
        {
          type: 'serviceTable', id: action.id, x: action.x, y: action.y,
          ...(action.rotation != null ? { rotation: action.rotation } : {}),
        },
      ]);
    case 'DELETE_SERVICE_TABLE': {
      const serviceTable = state.serviceTables.find(table => table.id === action.id);
      if (!isFixtureSaleSafe(state, serviceTable
        ? { type: 'serviceTable', id: serviceTable.id, data: serviceTable }
        : null)) return state;
      return {
        ...state,
        serviceTables: state.serviceTables.filter(st => st.id !== action.id),
      };
    }
    case 'EXPAND': {
      const level = state.restaurant.expansionLevel;
      const cost = EXPANSION_COSTS[level];
      if (!Number.isInteger(level) || level < 1 || cost == null || !canAfford(state, cost)) return state;
      const newLevel = state.restaurant.expansionLevel + 1;
      // Add a new kitchen station when expanding
      const newStationId = `k${state.kitchenStations.length + 1}`;
      return {
        ...state,
        restaurant: {
          ...state.restaurant,
          funds: state.restaurant.funds - cost,
          expansionLevel: newLevel,
        },
        kitchenStations: [...state.kitchenStations, {
          id: newStationId,
          equipmentId: null,
          x: 50 + state.kitchenStations.length * 100,
          y: 120,
        }],
      };
    }
    case 'LOAD_STATE':
      return action.state;
    default:
      return state;
  }
}

const GameGenerationContext = createContext(0);

function reduceGameSession(session, action) {
  const state = gameReducer(session.state, action);
  if (action.type === 'LOAD_STATE') return { state, generation: session.generation + 1 };
  return state === session.state ? session : { ...session, state };
}

export function GameProvider({ children }) {
  const [{ state, generation }, dispatch] = useReducer(reduceGameSession, null, () => {
    const saved = loadState();
    const fresh = createInitialState();
    return {
      state: saved && saved.version === fresh.version ? hydrateState(saved, fresh) : fresh,
      generation: 0,
    };
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const interval = setInterval(() => {
      saveState(stateRef.current);
    }, 30000);
    const handleBeforeUnload = () => saveState(stateRef.current);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  return (
    <GameContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <GameGenerationContext.Provider value={generation}>
          {children}
        </GameGenerationContext.Provider>
      </DispatchContext.Provider>
    </GameContext.Provider>
  );
}

export function useGameState() {
  return useContext(GameContext);
}

export function useDispatch() {
  return useContext(DispatchContext);
}

export function useGameGeneration() {
  return useContext(GameGenerationContext);
}
