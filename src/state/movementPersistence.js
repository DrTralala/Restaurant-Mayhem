import {
  cellKey,
  createNavigationWorkspace,
  isTopInteriorWallCell,
  navigationFixtureRectangles,
  worldToCell,
} from '../simulation/movement/navigationWorkspace';
import { hydrateSeatResidency } from '../simulation/movement/seatedDeparture';
import { getDoors, getRestaurantWorld } from '../simulation/world';

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
  const rectangles = [
    ...navigationFixtureRectangles(state),
    { x: world.doorX, y: world.kitchenY, w: 6, h: world.floorH },
    ...getDoors(state).map(door => ({ x: world.doorX, y: door.y, w: 6, h: 40 })),
  ];
  for (const rect of rectangles) {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)
      || rect.w <= 0 || rect.h <= 0 || rect.w > world.floorW || rect.h > world.floorH) invalid();
    const start = worldToCell(rect);
    const end = worldToCell({ x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 });
    if (![start.x, start.y, end.x, end.y].every(Number.isSafeInteger)
      || end.x < start.x || end.y < start.y) invalid();
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

// Shared by both persistence transports. Input is live trusted state, not imported JSON.
export function movementSaveSnapshot(state) {
  const { movementCoordinator: _movementCoordinator, ...domain } = state;
  validateSavedNavigationGeometry(state);
  const workspace = createNavigationWorkspace(state);
  return {
    ...domain,
    ...(Array.isArray(state.staff) ? { staff: state.staff.map(withoutSeatingTransition) } : {}),
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
    staff: state.staff.map(withoutSeatingTransition),
    queue: state.queue.map(party => ({ ...party, members: party.members.map(withoutSeatingTransition) })),
    customers: state.customers.map(actor => hydrateSeatResidency(state, actor, workspace)),
  };
}
