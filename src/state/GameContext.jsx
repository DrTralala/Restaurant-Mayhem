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
    case 'BUY_EQUIPMENT':
      return {
        ...state,
        restaurant: { ...state.restaurant, funds: state.restaurant.funds - action.cost },
        equipment: state.equipment.map(e =>
          e.id === action.id ? { ...e, owned: true } : e
        ),
      };
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
    case 'LOAD_STATE':
      return action.state;
    default:
      return state;
  }
}

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, null, () => loadState() || createInitialState());
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
