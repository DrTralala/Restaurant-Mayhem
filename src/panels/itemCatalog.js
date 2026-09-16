import { getPlaceable } from '../data/placeables';
import {
  DISHWASHER_MAX_LEVEL,
  getDishwasherStats,
} from '../simulation/dishwasherProgression';

export const SHOP_ITEM_TYPES = Object.freeze([
  'table',
  'chair',
  'door',
  'cashierTable',
  'automaticDishwasher',
  'couch',
  'arcade',
  'bed',
]);

function countWord(value) {
  if (value === 1) return 'One';
  if (value === 2) return 'Two';
  return String(value);
}

function descriptionFor(type, placeable) {
  if (type === 'table') {
    return 'A four-seat dining table. Add chairs separately before seating guests.';
  }
  if (type === 'chair') {
    return 'Adds one movable chair next to a table with an available seat.';
  }
  if (type === 'door') {
    return 'Adds a new entrance door. Change its role from the canvas when needed.';
  }
  if (type === 'cashierTable') {
    return 'A cashier station assigned to an available waiter when placed.';
  }
  if (type === 'automaticDishwasher') {
    const levelOne = getDishwasherStats(1);
    return `${DISHWASHER_MAX_LEVEL} levels; level 1 washes items serially every `
      + `${levelOne.secondsPerDish} seconds and holds ${levelOne.capacity} items.`;
  }
  if (type === 'couch' || type === 'arcade') {
    return `${countWord(placeable.capacity)} staff seat${placeable.capacity === 1 ? '' : 's'} `
      + `for ${placeable.sessionSeconds / 60} minutes; restores `
      + `+${placeable.moralePerHour} morale per hour while occupied.`;
  }
  if (type === 'bed') {
    return `${countWord(placeable.capacity)} staff bed: minimum `
      + `${placeable.minimumSleepSeconds / 3600} in-game hours, restores full morale, `
      + 'then reduces morale drain during recovery.';
  }
  return '';
}

export const SHOP_ITEMS = Object.freeze(SHOP_ITEM_TYPES.map(type => {
  const placeable = getPlaceable(type);
  if (!placeable || !Number.isFinite(placeable.price)) {
    throw new Error(`Invalid shop item: ${type}`);
  }

  return Object.freeze({
    type,
    name: placeable.label,
    price: placeable.price,
    description: descriptionFor(type, placeable),
  });
}));
