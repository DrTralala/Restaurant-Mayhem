import { GRID_SIZE, getRestaurantWorld } from './world';

export const EXPANSION_COSTS = Object.freeze([0, 1000, 3000, 6000]);
export const MAX_EXPANSION_LEVEL = EXPANSION_COSTS.length;

function getFloorSize(level) {
  const world = getRestaurantWorld({ expansionLevel: level });
  return { width: world.floorW / GRID_SIZE, height: world.floorH / GRID_SIZE };
}

export function getExpansionPreview(restaurant = {}) {
  const level = restaurant?.expansionLevel;
  if (!Number.isInteger(level) || level < 1 || level > MAX_EXPANSION_LEVEL) return null;

  const currentFloor = getFloorSize(level);
  if (level === MAX_EXPANSION_LEVEL) {
    return {
      level,
      nextLevel: null,
      cost: null,
      currentFloor,
      nextFloor: null,
      affordable: false,
      fundsAfterPurchase: null,
    };
  }

  const cost = EXPANSION_COSTS[level];
  const funds = restaurant.funds;
  const affordable = Number.isFinite(funds) && funds >= cost;
  return {
    level,
    nextLevel: level + 1,
    cost,
    currentFloor,
    nextFloor: getFloorSize(level + 1),
    affordable,
    fundsAfterPurchase: affordable ? funds - cost : null,
  };
}
