export const GRID_SIZE = 20;
export const WORLD_X = 50;
export const WORLD_Y = 50;

export function getRestaurantWorld(restaurant = {}) {
  const level = restaurant.expansionLevel || 1;
  const areaW = 760 + (level - 1) * 180;
  const areaH = 520 + (level - 1) * 120;
  const floorX = WORLD_X;
  const kitchenY = WORLD_Y;
  const diningY = 100;
  const floorW = areaW + 100;
  const floorH = areaH + 100;
  const doorX = floorX + floorW - 3;
  const doorY = areaH / 2 + 80;
  const queueX = doorX + 6;

  return {
    gridSize: GRID_SIZE,
    worldX: WORLD_X,
    worldY: WORLD_Y,
    areaW,
    areaH,
    floorX,
    kitchenY,
    diningY,
    floorW,
    floorH,
    doorX,
    doorY,
    queueX,
    queueY: kitchenY,
    queueW: 120,
    queueH: floorH,
    contentW: queueX + 120 - WORLD_X,
    contentH: floorH,
  };
}

export function getDoors(state = {}) {
  const world = getRestaurantWorld(state.restaurant || {});
  return state.doors?.length
    ? state.doors
    : [{ id: 'door1', y: world.doorY }];
}

export function getDoorPosition(state, door) {
  const world = getRestaurantWorld(state.restaurant || {});
  return {
    inside: { x: world.doorX - 20, y: door.y + 20 },
    outside: { x: world.queueX + 80, y: door.y + 20 },
  };
}

export function getQueuePosition(state, index = 0) {
  const world = getRestaurantWorld(state.restaurant);
  return {
    x: world.queueX + 50,
    y: world.doorY + 80 - index * 25,
  };
}

export function getCashierWorkPosition(station) {
  return { x: station.x + station.w / 2, y: station.y - GRID_SIZE };
}

export function getDefaultStaffPosition(role, index = 0, state = {}, staffId = null) {
  const currentState = state || {};
  const world = getRestaurantWorld(currentState.restaurant || {});
  const assigned = role === 'waiter'
    ? currentState.cashierStations?.find(station => station.assignedStaffId === staffId)
    : null;
  if (assigned) return getCashierWorkPosition(assigned);
  if (role === 'cook') return { x: world.floorX + 40 + index * 45, y: world.kitchenY + 25 };
  if (role === 'host') return { x: world.doorX - 35 - index * 20, y: world.doorY + 20 };
  if (role === 'cashier' || role === 'cashier_waiter') {
    const station = currentState.cashierStations?.find(candidate => candidate.assignedStaffId === staffId)
      || currentState.cashierStations?.[0];
    if (station) return getCashierWorkPosition(station);
    if (role === 'cashier_waiter') return { x: world.doorX - 90, y: world.diningY + 40 };
  }
  return { x: world.floorX + world.floorW / 2 + index * 25, y: world.diningY + world.areaH / 2 };
}
