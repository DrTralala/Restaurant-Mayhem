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
  // An explicitly empty collection represents a restaurant with no openings.
  // Keep the old geometry-only fallback for partial rendering fixtures, but do
  // not let it become an eligible ingress/egress route (it has no role).
  return Array.isArray(state.doors)
    ? state.doors
    : [{ id: 'door1', y: world.doorY }];
}

const DOOR_ROLE_BY_FLOW = Object.freeze({ ingress: 'entrance', egress: 'exit' });

export function getDoorsForFlow(state = {}, direction) {
  const role = DOOR_ROLE_BY_FLOW[direction];
  if (!role) return [];
  return getDoors(state).filter(door => door?.role === role && Number.isFinite(door.y));
}

export function isDoorRoleForFlow(door, direction) {
  return Boolean(door && DOOR_ROLE_BY_FLOW[direction] === door.role);
}

export function getMissingDoorWarnings(state = {}) {
  if (!Array.isArray(state.doors)) return [];
  const warnings = [];
  if (getDoorsForFlow(state, 'ingress').length === 0) {
    warnings.push('No entrance door: queued customers are waiting.');
  }
  if (getDoorsForFlow(state, 'egress').length === 0) {
    warnings.push('No exit door: departing customers are waiting.');
  }
  return warnings;
}

export function getDoorPosition(state, door) {
  const world = getRestaurantWorld(state.restaurant || {});
  if (!door || !Number.isFinite(door.y)) return null;
  return {
    inside: { x: world.doorX - 20, y: door.y + 20 },
    outside: { x: world.queueX + 80, y: door.y + 20 },
  };
}

export function isDoorCrossing(state, actor, door) {
  const world = getRestaurantWorld(state.restaurant || {});
  const position = getDoorPosition(state, door);
  return Boolean(position && Number.isFinite(actor?.x) && Number.isFinite(actor?.y)
    && actor.x >= world.doorX - 40
    && actor.x <= world.doorX + 30
    && Math.abs(actor.y - position.inside.y) <= 30);
}

export function getCashierWorkPosition(station) {
  return { x: station.x + station.w / 2, y: station.y - GRID_SIZE };
}

export function getCashierCustomerPosition(station, queueIndex = 0) {
  return {
    x: station.x + station.w / 2,
    y: station.y + station.h + GRID_SIZE + queueIndex * GRID_SIZE,
  };
}

export function getDefaultStaffPosition(role, index = 0, state = {}, staffId = null) {
  const currentState = state || {};
  const world = getRestaurantWorld(currentState.restaurant || {});
  const assigned = role === 'waiter'
    ? currentState.cashierStations?.find(station => station.assignedStaffId === staffId)
    : null;
  if (assigned) return getCashierWorkPosition(assigned);
  if (role === 'cook') return { x: world.floorX + 40 + index * 45, y: world.diningY };
  return { x: world.floorX + world.floorW / 2 + index * 25, y: world.diningY + world.areaH / 2 };
}
