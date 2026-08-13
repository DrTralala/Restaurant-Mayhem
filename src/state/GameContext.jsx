import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { createInitialState } from './initialState';
import { hydrateState, loadState, saveState } from './persistence';
import { ITEM_PRICES, ITEM_SELL_RATIO } from '../data/items';
import { getEquipmentLevelMultipliers } from '../data/equipment';
import { clampReputation } from '../simulation/balance';

const DISH_QUALITY_COST = 50;
const TRAINING_COST = 100;
const BONUS_COST = 50;
const SERVICE_TABLE_COST = 300;
const STARTING_DISH_QUALITY = 1;
const STAFF_SALARIES = { cook: 200, waiter: 150, host: 150 };
const EXPANSION_COSTS = [0, 1000, 3000, 6000];

function canAfford(state, cost) {
  return Number.isFinite(cost)
    && cost >= 0
    && Number.isFinite(state.restaurant.funds)
    && state.restaurant.funds >= cost;
}

const GameContext = createContext(null);
const DispatchContext = createContext(null);

function gameReducer(state, action) {
  switch (action.type) {
    case 'TICK':
      return action.nextState;
    case 'SET_SPEED':
      return { ...state, speed: action.speed };
    case 'TOGGLE_PAUSE':
      return { ...state, paused: !state.paused };
    case 'ADD_DISH': {
      const dish = action.dish;
      if (!dish || state.dishes.length >= state.recipeSlots
        || typeof dish.id !== 'string' || !dish.id
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
    case 'BUY_EQUIPMENT': {
      const equipment = state.equipment.find(candidate => candidate.id === action.id);
      const freeStation = state.kitchenStations.find(s => !s.equipmentId);
      if (!equipment || equipment.owned || !freeStation
        || !canAfford(state, equipment.purchaseCost)) return state;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - equipment.purchaseCost },
        equipment: state.equipment.map(e =>
          e.id === action.id ? { ...e, owned: true } : e
        ),
        kitchenStations: freeStation
          ? state.kitchenStations.map(s =>
              s.id === freeStation.id ? { ...s, equipmentId: action.id } : s
            )
          : state.kitchenStations,
      };
    }
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
    case 'HIRE_STAFF': {
      const salary = STAFF_SALARIES[action.staff?.role];
      if (!action.staff || state.staff.length >= state.staffSlots
        || salary == null || !canAfford(state, salary)) return state;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - salary },
        staff: [...state.staff, { ...action.staff, salary }],
      };
    }
    case 'FIRE_STAFF':
      return { ...state, staff: state.staff.filter(s => s.id !== action.id) };
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
    case 'TRAIN_STAFF': {
      const staff = state.staff.find(candidate => candidate.id === action.id);
      if (!staff || !Number.isFinite(staff.skill) || staff.skill >= 10
        || !canAfford(state, TRAINING_COST)) return state;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - TRAINING_COST },
        staff: state.staff.map(s =>
          s.id === action.id ? { ...s, skill: Math.min(s.skill + 1, 10) } : s
        ),
      };
    }
    case 'GIVE_BONUS': {
      const staff = state.staff.find(candidate => candidate.id === action.id);
      if (!staff || !Number.isFinite(staff.morale) || staff.morale >= 100
        || !canAfford(state, BONUS_COST)) return state;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - BONUS_COST },
        staff: state.staff.map(s =>
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
      const cost = ITEM_PRICES.table;
      if (!canAfford(state, cost)) return state;
      const nextNumber = Math.max(0, ...state.tables.map(table => Number(table.id.match(/^t(\d+)$/)?.[1]) || 0)) + 1;
      const count = state.tables.length;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - cost },
        tables: [...state.tables, {
          id: `t${nextNumber}`, seats: 4, status: 'empty',
          x: 200 + (count % 2) * 200,
          y: 200 + Math.floor(count / 2) * 200,
        }],
      };
    }
    case 'BUY_CHAIR': {
      const cost = ITEM_PRICES.chair;
      if (!canAfford(state, cost)) return state;
      const table = [...state.tables].reverse().find(candidate =>
        state.chairs.filter(chair => chair.tableId === candidate.id).length < candidate.seats);
      if (!table) return state;
      const existing = state.chairs.filter(chair => chair.tableId === table.id);
      const positions = [
        { x: table.x + 10, y: table.y - 20, rotation: 2 },
        { x: table.x + 10, y: table.y + 40, rotation: 0 },
        { x: table.x - 20, y: table.y + 10, rotation: 1 },
        { x: table.x + 40, y: table.y + 10, rotation: 3 },
      ];
      const nextNumber = Math.max(0, ...state.chairs.map(chair => Number(chair.id.match(/^ch(\d+)$/)?.[1]) || 0)) + 1;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - cost },
        chairs: [...state.chairs, { id: `ch${nextNumber}`, tableId: table.id, ...positions[existing.length] }],
      };
    }
    case 'BUY_DOOR': {
      const cost = ITEM_PRICES.door;
      if (!canAfford(state, cost)) return state;
      const doors = state.doors || [];
      const defaultY = 340;
      const offsets = [100, -100, 200, -200, 300, -300];
      const y = offsets
        .map(offset => defaultY + offset)
        .find(candidate => candidate >= 80 && candidate <= 600 && !doors.some(door => Math.abs(door.y - candidate) < 60));
      if (y == null) return state;
      const nextNumber = Math.max(0, ...doors.map(door => Number(door.id.match(/^door(\d+)$/)?.[1]) || 0)) + 1;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - cost },
        doors: [...doors, { id: `door${nextNumber}`, y }],
      };
    }
    case 'MOVE_ITEMS': {
      const tableMoves = new Map(action.items.filter(item => item.type === 'table').map(item => [item.id, item]));
      const chairMoves = new Map(action.items.filter(item => item.type === 'chair').map(item => [item.id, item]));
      return {
        ...state,
        tables: state.tables.map(table => tableMoves.has(table.id) ? { ...table, x: tableMoves.get(table.id).x, y: tableMoves.get(table.id).y } : table),
        chairs: state.chairs.map(chair => chairMoves.has(chair.id) ? { ...chair, x: chairMoves.get(chair.id).x, y: chairMoves.get(chair.id).y } : chair),
      };
    }
    case 'SELL_ITEMS': {
      const selectedTableIds = new Set(action.items
        .filter(item => item.type === 'table')
        .map(item => item.id)
        .filter(id => state.tables.some(table => table.id === id && table.status === 'empty')));
      const selectedChairIds = new Set(action.items
        .filter(item => item.type === 'chair')
        .map(item => item.id)
        .filter(id => {
          const chair = state.chairs.find(candidate => candidate.id === id);
          const table = chair && state.tables.find(candidate => candidate.id === chair.tableId);
          return chair && table?.status === 'empty' && !state.customers.some(customer => customer.chairId === id);
        }));
      const removedChairs = state.chairs.filter(chair => selectedChairIds.has(chair.id) || selectedTableIds.has(chair.tableId));
      const refund = Math.round((selectedTableIds.size * ITEM_PRICES.table + removedChairs.length * ITEM_PRICES.chair) * ITEM_SELL_RATIO);
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds + refund },
        tables: state.tables.filter(table => !selectedTableIds.has(table.id)),
        chairs: state.chairs.filter(chair => !selectedChairIds.has(chair.id) && !selectedTableIds.has(chair.tableId)),
      };
    }
    case 'MOVE_CHAIR':
      return {
        ...state,
        chairs: state.chairs.map(ch =>
          ch.id === action.id ? { ...ch, x: action.x, y: action.y, ...(action.rotation != null ? { rotation: action.rotation } : {}) } : ch
        ),
      };
    case 'MOVE_TABLE':
      return {
        ...state,
        tables: state.tables.map(t =>
          t.id === action.id ? { ...t, x: action.x, y: action.y } : t
        ),
      };
    case 'DELETE_TABLE':
      return {
        ...state,
        tables: state.tables.filter(t => t.id !== action.id),
        chairs: state.chairs.filter(ch => ch.tableId !== action.id),
      };
    case 'DELETE_CHAIR':
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
      if (!canAfford(state, SERVICE_TABLE_COST)) return state;
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - SERVICE_TABLE_COST },
        serviceTables: [...state.serviceTables, {
          id: `st${state.serviceTables.length + 1}`,
          x: 140 + state.serviceTables.length * 140,
          y: 120,
        }],
      };
    case 'MOVE_SERVICE_TABLE':
      return {
        ...state,
        serviceTables: state.serviceTables.map(st =>
          st.id === action.id ? { ...st, x: action.x, y: action.y } : st
        ),
      };
    case 'DELETE_SERVICE_TABLE': {
      const serviceTable = state.serviceTables.find(table => table.id === action.id);
      if (!serviceTable) return state;
      const hasFood = state.foodItems.some(food => food.serviceTableId === serviceTable.id
        || (!food.serviceTableId
          && food.x >= serviceTable.x && food.x < serviceTable.x + 120
          && food.y >= serviceTable.y && food.y < serviceTable.y + 40));
      if (hasFood) return state;
      return {
        ...state,
        serviceTables: state.serviceTables.filter(st => st.id !== action.id),
      };
    }
    case 'ADD_FOOD_ITEM':
      return { ...state, foodItems: [...state.foodItems, action.item] };
    case 'DELIVER_FOOD':
      return {
        ...state,
        foodItems: state.foodItems.map(f =>
          f.id === action.id ? { ...f, state: 'delivered', x: action.x, y: action.y } : f
        ),
      };
    case 'CLEAN_FOOD':
      return {
        ...state,
        foodItems: state.foodItems.filter(f => f.id !== action.id),
      };
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

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, null, () => {
    const saved = loadState();
    const fresh = createInitialState();
    if (saved && saved.version === fresh.version) return hydrateState(saved, fresh);
    return fresh;
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
        {children}
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
