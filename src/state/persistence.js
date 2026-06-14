const SAVE_KEY = 'restaurant-sim-save';

export function saveState(state) {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(SAVE_KEY, serialized);
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

export function loadState() {
  try {
    const serialized = localStorage.getItem(SAVE_KEY);
    if (!serialized) return null;
    return JSON.parse(serialized);
  } catch (e) {
    console.warn('Failed to load state:', e);
    return null;
  }
}
