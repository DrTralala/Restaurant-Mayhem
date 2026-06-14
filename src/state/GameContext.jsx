import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { createInitialState } from './initialState';
import { loadState, saveState } from './persistence';

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
    case 'ADD_DISH':
      return { ...state, dishes: [...state.dishes, action.dish] };
    case 'REMOVE_DISH':
      return { ...state, dishes: state.dishes.filter(d => d.id !== action.id) };
    case 'UPDATE_DISH':
      return {
        ...state,
        dishes: state.dishes.map(d => d.id === action.id ? { ...d, ...action.changes } : d),
      };
    case 'BUY_UPGRADE':
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - action.cost },
        upgrades: state.upgrades.map(u =>
          u.id === action.id ? { ...u, level: u.level + 1 } : u
        ),
      };
    case 'BUY_EQUIPMENT': {
      const freeStation = state.kitchenStations.find(s => !s.equipmentId);
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - action.cost },
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
    case 'UPGRADE_EQUIPMENT':
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - action.cost },
        equipment: state.equipment.map(e =>
          e.id === action.id ? { ...e, level: e.level + 1 } : e
        ),
      };
    case 'HIRE_STAFF':
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - action.staff.salary },
        staff: [...state.staff, action.staff],
      };
    case 'FIRE_STAFF':
      return { ...state, staff: state.staff.filter(s => s.id !== action.id) };
    case 'TRAIN_STAFF':
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - action.cost },
        staff: state.staff.map(s =>
          s.id === action.id ? { ...s, skill: Math.min(s.skill + 1, 10) } : s
        ),
      };
    case 'GIVE_BONUS':
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - action.cost },
        staff: state.staff.map(s =>
          s.id === action.id ? { ...s, morale: Math.min(s.morale + 20, 100) } : s
        ),
      };
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
        { id: `ch${chairIdBase}`, tableId: newId, x: tx + 10, y: ty - 20 },
        { id: `ch${chairIdBase + 1}`, tableId: newId, x: tx + 10, y: ty + 40 },
      ];
      if (seats >= 4) {
        newChairs.push(
          { id: `ch${chairIdBase + 2}`, tableId: newId, x: tx - 20, y: ty + 10 },
          { id: `ch${chairIdBase + 3}`, tableId: newId, x: tx + 40, y: ty + 10 },
        );
      }
      return {
        ...state,
        tables: [...state.tables, { id: newId, seats, status: 'empty', x: tx, y: ty }],
        chairs: [...state.chairs, ...newChairs],
      };
    }
    case 'MOVE_CHAIR':
      return {
        ...state,
        chairs: state.chairs.map(ch =>
          ch.id === action.id ? { ...ch, x: action.x, y: action.y } : ch
        ),
      };
    case 'MOVE_TABLE':
      return {
        ...state,
        tables: state.tables.map(t =>
          t.id === action.id ? { ...t, x: action.x, y: action.y } : t
        ),
      };
    case 'EXPAND': {
      const cost = [0, 1000, 3000, 6000][state.restaurant.expansionLevel] || 10000;
      if (state.restaurant.funds < cost) return state;
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
    if (saved && saved.version === fresh.version) return saved;
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
