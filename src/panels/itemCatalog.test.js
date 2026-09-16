import { describe, expect, it } from 'vitest';
import { getPlaceable } from '../data/placeables';
import {
  DISHWASHER_MAX_LEVEL,
  getDishwasherStats,
} from '../simulation/dishwasherProgression';
import { SHOP_ITEMS, SHOP_ITEM_TYPES } from './itemCatalog';

const EXPECTED_SHOP_ITEM_TYPES = [
  'table',
  'chair',
  'door',
  'cashierTable',
  'automaticDishwasher',
  'couch',
  'arcade',
  'bed',
];

function countWord(value) {
  if (value === 1) return 'One';
  if (value === 2) return 'Two';
  return String(value);
}

describe('SHOP_ITEMS', () => {
  it('keeps the exact catalogue order and immutable entries', () => {
    expect(SHOP_ITEM_TYPES).toEqual(EXPECTED_SHOP_ITEM_TYPES);
    expect(SHOP_ITEMS.map(item => item.type)).toEqual(EXPECTED_SHOP_ITEM_TYPES);
    expect(Object.isFrozen(SHOP_ITEM_TYPES)).toBe(true);
    expect(Object.isFrozen(SHOP_ITEMS)).toBe(true);

    for (const item of SHOP_ITEMS) {
      expect(Object.isFrozen(item)).toBe(true);
    }
  });

  it('uses canonical placeable names and prices', () => {
    for (const item of SHOP_ITEMS) {
      expect(item.name).toBe(getPlaceable(item.type).label);
      expect(item.price).toBe(getPlaceable(item.type).price);
    }
  });

  it('uses exact descriptions with authoritative policy values', () => {
    const levelOne = getDishwasherStats(1);
    const couch = getPlaceable('couch');
    const arcade = getPlaceable('arcade');
    const bed = getPlaceable('bed');
    const expectedDescriptions = {
      table: 'A four-seat dining table. Add chairs separately before seating guests.',
      chair: 'Adds one movable chair next to a table with an available seat.',
      door: 'Adds a new entrance door. Change its role from the canvas when needed.',
      cashierTable: 'A cashier station assigned to an available waiter when placed.',
      automaticDishwasher: `${DISHWASHER_MAX_LEVEL} levels; level 1 washes items serially every `
        + `${levelOne.secondsPerDish} seconds and holds ${levelOne.capacity} items.`,
      couch: `${countWord(couch.capacity)} staff seat${couch.capacity === 1 ? '' : 's'} `
        + `for ${couch.sessionSeconds / 60} minutes; restores `
        + `+${couch.moralePerHour} morale per hour while occupied.`,
      arcade: `${countWord(arcade.capacity)} staff seat${arcade.capacity === 1 ? '' : 's'} `
        + `for ${arcade.sessionSeconds / 60} minutes; restores `
        + `+${arcade.moralePerHour} morale per hour while occupied.`,
      bed: `${countWord(bed.capacity)} staff bed: minimum `
        + `${bed.minimumSleepSeconds / 3600} in-game hours, restores full morale, `
        + 'then reduces morale drain during recovery.',
    };

    expect(SHOP_ITEMS.map(item => item.description)).toEqual(
      SHOP_ITEM_TYPES.map(type => expectedDescriptions[type]),
    );
  });
});
