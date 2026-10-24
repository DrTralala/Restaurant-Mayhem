import { createInitialState } from './initialState';

export const NEW_SANDBOX_CONFIRMATION = 'Start a new sandbox? This replaces your current restaurant, any career and its local autosave. No backup is created. Cancel keeps this restaurant.';

export function requestNewSandbox(dispatch) {
  if (!window.confirm(NEW_SANDBOX_CONFIRMATION)) return false;
  localStorage.removeItem('restaurant-sim-save');
  dispatch({ type: 'LOAD_STATE', state: createInitialState() });
  return true;
}
