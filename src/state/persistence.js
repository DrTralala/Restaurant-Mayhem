const SAVE_KEY = 'restaurant-sim-save';
import { inferGender } from '../canvas/characterAppearance';

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

export function hydrateState(saved, fresh) {
  return {
    ...fresh,
    ...saved,
    restaurant: {
      ...fresh.restaurant,
      ...(saved.restaurant || {}),
    },
    staff: (saved.staff || fresh.staff || []).map(character => ({
      ...character,
      gender: inferGender(character),
    })),
    customers: (saved.customers || fresh.customers || []).map(character => ({
      ...character,
      gender: inferGender(character),
    })),
    queue: (saved.queue || fresh.queue || []).map(character => ({
      ...character,
      gender: inferGender(character),
    })),
  };
}
