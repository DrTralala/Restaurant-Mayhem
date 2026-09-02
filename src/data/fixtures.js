import { getRestaurantWorld } from '../simulation/world';
import { getPlaceableDimensions } from './placeables';

export const FIXTURE_TYPES = {
  table: { collection: 'tables', width: 40, height: 40, placementType: 'table', label: () => 'Dining table' },
  chair: { collection: 'chairs', width: 20, height: 20, placementType: 'chair', label: () => 'Chair' },
  door: { collection: 'doors', width: 6, height: 40, placementType: 'door', label: () => 'Door' },
  serviceTable: { collection: 'serviceTables', width: 120, height: 40, placementType: 'serviceTable', label: () => 'Service counter' },
  cashierTable: { collection: 'cashierStations', width: 80, height: 40, placementType: 'cashierTable', label: () => 'Cashier table' },
  kitchenStation: { collection: 'kitchenStations', width: 40, height: 40, placementType: 'kitchenStation', label: (_state, data) => data.equipmentId ? 'Kitchen equipment' : 'Kitchen station' },
  washStation: { collection: 'washStations', width: 40, height: 40, placementType: data => data.type === 'automatic' ? 'automaticDishwasher' : 'manualSink', label: (_state, data) => data.type === 'automatic' ? 'Automatic dishwasher' : 'Sink' },
};

export function getFixtureDescriptor(type) {
  return Object.prototype.hasOwnProperty.call(FIXTURE_TYPES, type)
    ? FIXTURE_TYPES[type]
    : undefined;
}

export function listFixtures(state = {}) {
  const currentState = state || {};

  return Object.entries(FIXTURE_TYPES).flatMap(([type, descriptor]) => {
    const collection = currentState[descriptor.collection];
    if (!Array.isArray(collection)) return [];

    return collection.map(data => ({ type, id: data.id, data }));
  });
}

export function getFixture(state, type, id) {
  const descriptor = getFixtureDescriptor(type);
  const collection = descriptor && Array.isArray(state?.[descriptor.collection])
    ? state[descriptor.collection]
    : [];
  const data = collection.find(item => item?.id === id);

  return data ? { type, id: data.id, data } : null;
}

export function getFixtureRect(state, fixture) {
  const descriptor = getFixtureDescriptor(fixture?.type);
  const data = fixture?.data;
  if (!descriptor || !data || !Number.isFinite(data.y)
    || (fixture.type !== 'door' && !Number.isFinite(data.x))) return null;

  const dimensions = fixture.type === 'washStation'
    ? {
      w: Number.isFinite(data.w) ? data.w : descriptor.width,
      h: Number.isFinite(data.h) ? data.h : descriptor.height,
    }
    : fixture.type === 'serviceTable'
      ? (() => {
        const footprint = getPlaceableDimensions('serviceTable', data.rotation);
        return { w: footprint.width, h: footprint.height };
      })()
      : { w: descriptor.width, h: descriptor.height };
  const world = getRestaurantWorld(state?.restaurant || {});

  return {
    x: fixture.type === 'door' ? world.doorX : data.x,
    y: data.y,
    ...dimensions,
  };
}

export function getFixtureLabel(state, fixture) {
  const descriptor = getFixtureDescriptor(fixture?.type);
  return descriptor ? descriptor.label(state, fixture?.data || {}) : null;
}
