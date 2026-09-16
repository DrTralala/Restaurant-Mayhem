import { ITEM_PRICES, ITEM_SELL_RATIO } from '../data/items';
import { getFixture, getFixtureDescriptor } from '../data/fixtures';
import { isAmenityInUse } from '../data/staffAmenities';
import { getPlaceable } from '../data/placeables';
import { getOccupiedServiceSlotKeys } from '../simulation/serviceItems';
import { getWashStationOccupancy } from '../simulation/dishwashing';

export const FIXTURE_SALE_REASONS = Object.freeze({
  MISSING_FIXTURE: 'missing-fixture',
  NOT_SELLABLE: 'not-sellable',
  IN_USE: 'in-use',
});

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function getCataloguePrice(itemType, fallback = null) {
  return Number.isFinite(ITEM_PRICES[itemType]) ? ITEM_PRICES[itemType] : fallback;
}

export function getFixtureSalePrice(fixture) {
  const descriptor = getFixtureDescriptor(fixture?.type);
  const placementType = typeof descriptor?.placementType === 'function'
    ? descriptor.placementType(fixture?.data)
    : descriptor?.placementType;
  return getCataloguePrice(placementType, getPlaceable(placementType)?.price);
}

function isWashStationSaleSafe(state, station) {
  return station?.type === 'automatic'
    && getWashStationOccupancy(state, station) === 0;
}

function isServiceTableSaleSafe(state, table) {
  const prefix = `${String(table.id)}:`;
  return ![...getOccupiedServiceSlotKeys(state)].some(key => key.startsWith(prefix));
}

function isCashierSaleSafe(state, station) {
  return !(state.staff || []).some(worker => worker.task?.type === 'take_payment'
    && sameId(worker.task.stationId, station.id))
    && !(state.customers || []).some(customer => sameId(customer.cashierStationId, station.id)
      && ['checkout_moving', 'checkout_processing', 'checkout_queued'].includes(customer.state));
}

function isDoorSaleSafe(state, door) {
  const doorId = door?.id;
  if (doorId == null) return false;

  const activeActors = [
    ...(state.customers || []),
    ...(state.queue || []).flatMap(party => party?.members || []),
  ];

  if (activeActors.some(actor => actor.state === 'entering'
    && sameId(actor.entryDoorId, doorId))) return false;
  if (activeActors.some(actor => actor.state === 'leaving'
    && sameId(actor.exitDoorId, doorId)
    && actor.exitPhase !== 'fading')) return false;
  if (sameId(state.queueAdmissionGate?.doorId, doorId)) return false;

  const requests = state.doorAdmissions?.requests;
  return !Object.values(requests || {}).some(request => sameId(request?.doorId, doorId));
}

function isFixtureSaleSafe(state, fixture) {
  const data = fixture?.data;
  if (!data) return false;

  if (fixture.type === 'table') return data.status === 'empty';
  if (fixture.type === 'chair') {
    const table = (state.tables || []).find(candidate => sameId(candidate.id, data.tableId));
    return table?.status === 'empty'
      && !(state.customers || []).some(customer => sameId(customer.chairId, data.id));
  }
  if (fixture.type === 'washStation') return isWashStationSaleSafe(state, data);
  if (fixture.type === 'staffAmenity') return !isAmenityInUse(data);
  if (fixture.type === 'serviceTable') return isServiceTableSaleSafe(state, data);
  if (fixture.type === 'cashierTable') return isCashierSaleSafe(state, data);
  return fixture.type === 'door' && isDoorSaleSafe(state, data);
}

function resolveFixture(state, itemOrFixture) {
  if (itemOrFixture?.type == null || itemOrFixture?.id == null) return null;
  return getFixture(state, itemOrFixture.type, itemOrFixture.id);
}

export function getFixtureSaleEligibility(state, itemOrFixture) {
  const fixture = resolveFixture(state || {}, itemOrFixture);
  if (!fixture) {
    return {
      valid: false,
      reason: FIXTURE_SALE_REASONS.MISSING_FIXTURE,
      fixture: null,
      price: null,
    };
  }

  const price = getFixtureSalePrice(fixture);
  if (price == null) {
    return {
      valid: false,
      reason: FIXTURE_SALE_REASONS.NOT_SELLABLE,
      fixture,
      price: null,
    };
  }

  if (!isFixtureSaleSafe(state, fixture)) {
    return {
      valid: false,
      reason: FIXTURE_SALE_REASONS.IN_USE,
      fixture,
      price,
    };
  }

  return { valid: true, reason: null, fixture, price };
}

export function getSaleSelection(state, requestedItems) {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) return null;

  const seen = new Set();
  const fixtures = [];

  for (const item of requestedItems) {
    if (!item || item.type == null || item.id == null) return null;
    const key = `${item.type}:${String(item.id)}`;
    if (seen.has(key)) return null;
    seen.add(key);

    const eligibility = getFixtureSaleEligibility(state, item);
    if (!eligibility.valid) return null;
    fixtures.push(eligibility.fixture);
  }

  const selectedTables = new Set(fixtures
    .filter(fixture => fixture.type === 'table')
    .map(fixture => fixture.id));
  const selectedChairs = new Set(fixtures
    .filter(fixture => fixture.type === 'chair')
    .map(fixture => fixture.id));
  const removedChairs = new Set(selectedChairs);

  for (const chair of state.chairs || []) {
    if (selectedTables.has(chair.tableId)) removedChairs.add(chair.id);
  }

  let refundBase = 0;
  for (const fixture of fixtures) {
    if (fixture.type === 'table') refundBase += ITEM_PRICES.table;
    else if (fixture.type === 'chair' && selectedTables.has(fixture.data.tableId)) continue;
    else refundBase += getFixtureSalePrice(fixture);
  }

  for (const chair of state.chairs || []) {
    if (selectedTables.has(chair.tableId)) {
      refundBase += ITEM_PRICES.chair;
    }
  }

  return {
    fixtures,
    selectedTables,
    removedChairs,
    refund: Math.round(refundBase * ITEM_SELL_RATIO),
  };
}

export function sellFixtures(state, requestedItems) {
  const selection = getSaleSelection(state, requestedItems);
  if (!selection) return state;

  const selectedByType = new Map();
  for (const fixture of selection.fixtures) {
    const ids = selectedByType.get(fixture.type) || new Set();
    ids.add(fixture.id);
    selectedByType.set(fixture.type, ids);
  }

  const remove = (type, record) => selectedByType.get(type)?.has(record.id);

  return {
    ...state,
    restaurant: {
      ...state.restaurant,
      funds: state.restaurant.funds + selection.refund,
    },
    tables: (state.tables || []).filter(table => !selection.selectedTables.has(table.id)),
    chairs: (state.chairs || []).filter(chair => !selection.removedChairs.has(chair.id)),
    doors: (state.doors || []).filter(door => !remove('door', door)),
    serviceTables: (state.serviceTables || []).filter(table => !remove('serviceTable', table)),
    cashierStations: (state.cashierStations || []).filter(
      station => !remove('cashierTable', station),
    ),
    washStations: (state.washStations || []).filter(
      station => !remove('washStation', station),
    ),
    staffAmenities: (state.staffAmenities || []).filter(
      amenity => !remove('staffAmenity', amenity),
    ),
  };
}
