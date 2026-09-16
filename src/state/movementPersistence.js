import {
  cellKey,
  createNavigationWorkspace,
  isTopInteriorWallCell,
  navigationFixtureRectangles,
  worldToCell,
} from '../simulation/movement/navigationWorkspace';
import { hydrateSeatResidency } from '../simulation/movement/seatedDeparture';
import { getDoors, getRestaurantWorld } from '../simulation/world';
import { getCarriedServiceItemIds, withCarriedServiceItemIds } from '../simulation/staffInventory';
import { getAmenityGeometry } from '../data/staffAmenities';

// Validate before any unit-step raster loop. Finite numbers alone need not advance by one.
export function validateSavedNavigationGeometry(state) {
  const invalid = () => { throw new Error('Invalid saved navigation geometry'); };
  const level = state.restaurant?.expansionLevel ?? 1;
  // The game's expansion purchase domain is levels 1–4; imported worlds must be bounded too.
  if (!Number.isInteger(level) || level < 1 || level > 4) invalid();
  const world = getRestaurantWorld(state.restaurant || {});
  for (const key of ['tables', 'chairs', 'kitchenStations', 'serviceTables', 'cashierStations', 'washStations', 'doors']) {
    const fixtures = state[key];
    if (fixtures != null && (!Array.isArray(fixtures)
      || fixtures.some(fixture => !fixture || typeof fixture !== 'object'))) invalid();
  }
  if (Array.isArray(state.doors) && state.doors.some(door =>
    !['entrance', 'exit'].includes(door.role))) invalid();
  const positionedCollections = [
    'tables', 'chairs', 'kitchenStations', 'serviceTables', 'cashierStations', 'washStations',
    'staffAmenities',
  ];
  for (const key of positionedCollections) {
    for (const fixture of state[key] || []) {
      if (fixture.rotation != null
        && (!Number.isInteger(fixture.rotation) || fixture.rotation < 0 || fixture.rotation > 3)) {
        invalid();
      }
    }
  }
  for (const cashier of state.cashierStations || []) {
    for (const key of ['w', 'h']) {
      if (cashier[key] != null
        && (!Number.isFinite(cashier[key]) || cashier[key] <= 0
          || cashier[key] > (key === 'w' ? world.floorW : world.floorH))) invalid();
    }
  }
  const rectangles = [
    ...navigationFixtureRectangles(state),
    { x: world.doorX, y: world.kitchenY, w: 6, h: world.floorH },
    ...getDoors(state).map(door => ({ x: world.doorX, y: door.y, w: 6, h: 40 })),
  ];
  const isInside = (rect, right) => rect.x >= world.floorX
    && rect.x + rect.w <= right
    && rect.y >= world.kitchenY
    && rect.y + rect.h <= world.kitchenY + world.floorH;
  const intersects = (first, second) => first.x <= second.x + second.w - 1
    && first.x + first.w - 1 >= second.x
    && first.y <= second.y + second.h - 1
    && first.y + first.h - 1 >= second.y;
  const contains = (outer, inner) => inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
  const allowedSharedFixtureGeometry = (first, second) => {
    const kinds = new Set([first.kind, second.kind]);
    if (!kinds.has('service') || !kinds.has('kitchen')) return false;
    const service = first.kind === 'service' ? first : second;
    const kitchen = first.kind === 'kitchen' ? first : second;
    // The starter layout intentionally nests the second kitchen station behind
    // the service counter. Keep this one shared physical convention explicit,
    // rather than disabling all overlap validation.
    return contains(service, kitchen);
  };
  for (const rect of rectangles) {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)
      || rect.w <= 0 || rect.h <= 0 || rect.w > world.floorW || rect.h > world.floorH) invalid();
    const right = rect.x === world.doorX ? world.queueX : world.floorX + world.floorW;
    if (!isInside(rect, right)) invalid();
    const start = worldToCell(rect);
    const end = worldToCell({ x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 });
    if (![start.x, start.y, end.x, end.y].every(Number.isSafeInteger)
      || end.x < start.x || end.y < start.y) invalid();
  }
  const furniture = navigationFixtureRectangles(state);
  for (let firstIndex = 0; firstIndex < furniture.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < furniture.length; secondIndex += 1) {
      if (intersects(furniture[firstIndex], furniture[secondIndex])
        && !allowedSharedFixtureGeometry(furniture[firstIndex], furniture[secondIndex])) invalid();
    }
  }
  for (const amenity of state.staffAmenities || []) {
    const geometry = getAmenityGeometry(amenity);
    if (!geometry) invalid();
    for (const point of [
      ...geometry.slotAnchors,
      ...geometry.approachPoints,
      ...geometry.exitCandidates,
    ]) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)
        || point.x < world.floorX || point.x >= world.floorX + world.floorW
        || point.y < world.kitchenY || point.y >= world.kitchenY + world.floorH) invalid();
    }
  }
  const navigation = createNavigationWorkspace(state);
  const actors = [
    ...(Array.isArray(state.staff) ? state.staff : []),
    ...(Array.isArray(state.customers) ? state.customers : []),
    ...(Array.isArray(state.queue) ? state.queue.flatMap(party => party?.members || []) : []),
  ];
  if (actors.some(actor => {
    if (!Number.isFinite(actor?.x) || !Number.isFinite(actor?.y)) return false;
    const cell = worldToCell(actor);
    return isTopInteriorWallCell(world, cell) && navigation.blockedCells.has(cellKey(cell));
  })) invalid();
}

const withoutSeatingTransition = actor => {
  const { seatingTransition: _seatingTransition, ...domain } = actor;
  return domain;
};

const canonicalStaff = worker => withCarriedServiceItemIds(
  worker,
  getCarriedServiceItemIds(worker),
);

// Shared by both persistence transports. Input is live trusted state, not imported JSON.
export function movementSaveSnapshot(state) {
  const { movementCoordinator: _movementCoordinator, ...domain } = state;
  validateSavedNavigationGeometry(state);
  const workspace = createNavigationWorkspace(state);
  return {
    ...domain,
    ...(Array.isArray(state.staff) ? { staff: state.staff.map(worker =>
      withoutSeatingTransition(canonicalStaff(worker))) } : {}),
    ...(Array.isArray(state.queue) ? { queue: state.queue.map(party => Array.isArray(party.members)
      ? { ...party, members: party.members.map(withoutSeatingTransition) } : withoutSeatingTransition(party)) } : {}),
    ...(Array.isArray(state.customers) ? { customers: state.customers.map(actor =>
      hydrateSeatResidency(state, actor, workspace)) } : {}),
  };
}

export function hydrateMovementResidencies(state) {
  validateSavedNavigationGeometry(state);
  const workspace = createNavigationWorkspace(state);
  return { ...state,
    staff: state.staff.map(worker => withoutSeatingTransition(canonicalStaff(worker))),
    queue: state.queue.map(party => ({ ...party, members: party.members.map(withoutSeatingTransition) })),
    customers: state.customers.map(actor => hydrateSeatResidency(state, actor, workspace)),
  };
}
