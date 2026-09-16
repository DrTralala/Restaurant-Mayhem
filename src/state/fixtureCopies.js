import {
  getFixture,
  getFixtureDescriptor,
  listFixtures,
} from '../data/fixtures';
import { ITEM_PRICES } from '../data/items';
import { createEmptyAmenitySlots } from '../data/staffAmenities';
import { getPlaceable } from '../data/placeables';
import {
  getNextNumericId,
  validateFixtureCopies,
} from '../simulation/placement';
import { invalidateMovementRuntime } from './staffMoves';

export const COPY_REASONS = Object.freeze({
  EMPTY_SELECTION: 'empty-selection',
  MALFORMED_SELECTION: 'malformed-selection',
  UNKNOWN_FIXTURE_TYPE: 'unknown-fixture-type',
  MISSING_FIXTURE: 'missing-fixture',
  DUPLICATE_COPY: 'duplicate-copy',
  UNIQUE_EQUIPMENT: 'unique-equipment',
  UNPRICED_KITCHEN_STATION: 'unpriced-kitchen-station',
  UNPRICED_MANUAL_SINK: 'unpriced-manual-sink',
  MALFORMED_SOURCE: 'malformed-source',
  INSUFFICIENT_FUNDS: 'insufficient-funds',
});

const COPY_REASON_MESSAGES = Object.freeze({
  [COPY_REASONS.EMPTY_SELECTION]: 'Select at least one fixture to copy.',
  [COPY_REASONS.MALFORMED_SELECTION]: 'The selected fixtures cannot be copied.',
  [COPY_REASONS.UNKNOWN_FIXTURE_TYPE]: 'This fixture cannot be copied.',
  [COPY_REASONS.MISSING_FIXTURE]: 'A selected fixture no longer exists.',
  [COPY_REASONS.DUPLICATE_COPY]: 'A fixture can only be copied once.',
  [COPY_REASONS.UNIQUE_EQUIPMENT]: 'Unique kitchen equipment cannot be copied.',
  [COPY_REASONS.UNPRICED_KITCHEN_STATION]: 'Unpriced drinks dispensers cannot be copied.',
  [COPY_REASONS.UNPRICED_MANUAL_SINK]: 'Manual sinks cannot be copied.',
  [COPY_REASONS.MALFORMED_SOURCE]: 'A selected fixture has invalid geometry.',
  [COPY_REASONS.INSUFFICIENT_FUNDS]: 'There are not enough funds to copy this selection.',
  'inconsistent-table-chair': 'The selected table and chairs no longer line up.',
  'non-finite-coordinate': 'The copy position is invalid.',
  'malformed-rotation': 'The copy rotation is invalid.',
  'malformed-copies': 'The selected fixtures cannot be copied.',
  'malformed-copy': 'The copy has invalid geometry.',
  overlap: 'The copy overlaps existing furniture.',
  'outside-floor': 'The copy must fit inside the restaurant floor.',
  'door-overlap': 'Copied doors cannot overlap another door.',
  'door-occupied': 'A copied door would block someone in the doorway.',
  'cashier-work-cell': 'The copied cashier needs a clear reachable work cell.',
  'chair-table': 'Every copied chair must remain beside its linked table.',
});

function reasonResult(reason, extra = {}) {
  return {
    valid: false,
    reason,
    message: getFixtureCopyReasonMessage(reason),
    ...extra,
  };
}

function fixtureKey(type, id) {
  return `${type}:${String(id)}`;
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function expandSelection(state, selectedItems) {
  if (!Array.isArray(selectedItems)) return reasonResult(COPY_REASONS.MALFORMED_SELECTION);
  if (selectedItems.length === 0) return reasonResult(COPY_REASONS.EMPTY_SELECTION);

  const selected = new Set();
  for (const item of selectedItems) {
    if (!item || item.type == null || item.id == null) {
      return reasonResult(COPY_REASONS.MALFORMED_SELECTION);
    }
    if (!getFixtureDescriptor(item.type)) {
      return reasonResult(COPY_REASONS.UNKNOWN_FIXTURE_TYPE);
    }
    const key = fixtureKey(item.type, item.id);
    if (selected.has(key)) return reasonResult(COPY_REASONS.DUPLICATE_COPY);
    if (!getFixture(state, item.type, item.id)) return reasonResult(COPY_REASONS.MISSING_FIXTURE);
    selected.add(key);
  }

  for (const item of selectedItems) {
    if (item.type !== 'table') continue;
    for (const chair of state?.chairs || []) {
      if (chair?.tableId === item.id) selected.add(fixtureKey('chair', chair.id));
    }
  }

  return {
    valid: true,
    items: listFixtures(state)
      .filter(fixture => selected.has(fixtureKey(fixture.type, fixture.id)))
      .map(fixture => ({ type: fixture.type, id: fixture.id })),
  };
}

function copyPlacementType(fixture) {
  const descriptor = getFixtureDescriptor(fixture.type);
  return typeof descriptor?.placementType === 'function'
    ? descriptor.placementType(fixture.data)
    : descriptor?.placementType;
}

function copyPrice(fixture) {
  const placementType = copyPlacementType(fixture);
  return Number.isFinite(ITEM_PRICES[placementType])
    ? ITEM_PRICES[placementType]
    : getPlaceable(placementType)?.price;
}

function getEligibilityReason(fixture) {
  const placementType = copyPlacementType(fixture);
  if (fixture.type === 'kitchenStation') {
    return fixture.data.equipmentId != null
      ? COPY_REASONS.UNIQUE_EQUIPMENT
      : COPY_REASONS.UNPRICED_KITCHEN_STATION;
  }
  if (fixture.type === 'washStation' && fixture.data.type !== 'automatic') {
    return COPY_REASONS.UNPRICED_MANUAL_SINK;
  }
  const placeable = getPlaceable(placementType);
  if (!placeable || placeable.price == null) return COPY_REASONS.UNKNOWN_FIXTURE_TYPE;
  return null;
}

function sourceIsMalformed(state, fixture) {
  const descriptor = getFixtureDescriptor(fixture.type);
  if (!descriptor) return true;
  if (fixture.type !== 'door' && !isFinitePoint(fixture.data)) return true;
  if (fixture.type === 'door' && !Number.isFinite(fixture.data.y)) return true;
  if (fixture.type === 'cashierTable'
    && ((fixture.data.w != null && (!Number.isFinite(fixture.data.w) || fixture.data.w <= 0))
      || (fixture.data.h != null && (!Number.isFinite(fixture.data.h) || fixture.data.h <= 0)))) {
    return true;
  }
  if (fixture.type === 'washStation'
    && ((fixture.data.w != null && (!Number.isFinite(fixture.data.w) || fixture.data.w <= 0))
      || (fixture.data.h != null && (!Number.isFinite(fixture.data.h) || fixture.data.h <= 0)))) {
    return true;
  }
  const placeable = getPlaceable(copyPlacementType(fixture));
  if (placeable?.rotatable && Object.prototype.hasOwnProperty.call(fixture.data, 'rotation')
    && (!Number.isInteger(fixture.data.rotation)
      || fixture.data.rotation < 0 || fixture.data.rotation > 3)) {
    return true;
  }
  return false;
}

export function getFixtureCopyReasonMessage(reason) {
  return COPY_REASON_MESSAGES[reason] || 'This copy cannot be placed.';
}

export function getFixtureCopyEligibility(state = {}, selectedItems = []) {
  const expanded = expandSelection(state || {}, selectedItems);
  if (!expanded.valid) return expanded;

  let price = 0;
  for (const item of expanded.items) {
    const fixture = getFixture(state, item.type, item.id);
    const reason = getEligibilityReason(fixture);
    if (reason) return reasonResult(reason, { items: expanded.items });
    if (sourceIsMalformed(state, fixture)) {
      return reasonResult(COPY_REASONS.MALFORMED_SOURCE, { items: expanded.items });
    }
    price += copyPrice(fixture);
  }

  return {
    valid: true,
    reason: null,
    message: null,
    items: expanded.items,
    price,
    totalPrice: price,
  };
}

export function getFixtureCopyPrice(state, selectedItems) {
  const result = getFixtureCopyEligibility(state, selectedItems);
  return result.valid ? result.price : null;
}

export const getFixtureCopyCost = getFixtureCopyPrice;

function normaliseRotation(value) {
  return Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
}

function getCopyRecord(source, copy, id, copiedTableIds) {
  if (source.type === 'table') {
    return {
      id,
      seats: Number.isFinite(source.data.seats) ? source.data.seats : 4,
      status: 'empty',
      x: copy.x,
      y: copy.y,
    };
  }

  if (source.type === 'chair') {
    return {
      id,
      tableId: copiedTableIds.get(fixtureKey('table', source.data.tableId)) ?? source.data.tableId,
      x: copy.x,
      y: copy.y,
      rotation: normaliseRotation(source.data.rotation),
    };
  }

  if (source.type === 'door') {
    return { id, y: copy.y, role: source.data.role || 'entrance' };
  }

  if (source.type === 'serviceTable') {
    return {
      id, x: copy.x, y: copy.y, rotation: normaliseRotation(source.data.rotation),
    };
  }

  if (source.type === 'cashierTable') {
    return {
      id,
      x: copy.x,
      y: copy.y,
      w: getPlaceable('cashierTable').width,
      h: getPlaceable('cashierTable').height,
    };
  }

  if (source.type === 'washStation') {
    return {
      id,
      type: 'automatic',
      level: 1,
      x: copy.x,
      y: copy.y,
      w: Number.isFinite(source.data.w) ? source.data.w : 40,
      h: Number.isFinite(source.data.h) ? source.data.h : 40,
    };
  }

  if (source.type === 'staffAmenity') {
    return {
      id,
      type: source.data.type,
      x: copy.x,
      y: copy.y,
      rotation: normaliseRotation(copy.rotation ?? source.data.rotation),
      slots: createEmptyAmenitySlots(source.data.type),
    };
  }

  return null;
}

function allocateIds(state, copies) {
  const generated = new Map();
  const tableIds = new Map();
  for (const copy of copies) {
    const source = getFixture(state, copy.type, copy.id);
    const descriptor = getFixtureDescriptor(copy.type);
    const collection = descriptor.collection;
    const records = generated.get(collection) || [];
    const id = getNextNumericId([...(state[collection] || []), ...records], copy.type === 'table'
      ? 't'
      : copy.type === 'chair'
        ? 'ch'
        : copy.type === 'door'
          ? 'door'
          : copy.type === 'serviceTable'
            ? 'st'
            : copy.type === 'cashierTable'
              ? 'cashier'
              : copy.type === 'staffAmenity'
                ? 'amenity'
              : 'wash');
    records.push({ id });
    generated.set(collection, records);
    if (source.type === 'table') tableIds.set(fixtureKey('table', source.id), id);
  }
  return { generated, tableIds };
}

function invalidateCopyNavigation(state) {
  const ids = new Set([
    ...(state.staff || []).map(worker => worker?.id),
    ...(state.customers || []).map(customer => customer?.id),
    ...(state.queueSlots || []).map(slot => slot?.memberId),
  ].filter(id => id != null));
  let next = state;
  for (const id of ids) next = invalidateMovementRuntime(next, id);
  return next;
}

export function copyFixtures(state, requestedCopies = []) {
  const eligibility = getFixtureCopyEligibility(state || {}, requestedCopies);
  if (!eligibility.valid) return state;

  const validation = validateFixtureCopies(state, requestedCopies);
  if (!validation.valid) return state;
  if (!Number.isFinite(state?.restaurant?.funds)
    || state.restaurant.funds < eligibility.price) return state;

  const copies = validation.copies;
  const { generated, tableIds } = allocateIds(state, copies);
  const recordsByCollection = new Map();
  for (const copy of copies) {
    const source = getFixture(state, copy.type, copy.id);
    const descriptor = getFixtureDescriptor(copy.type);
    const records = generated.get(descriptor.collection) || [];
    const id = records.shift()?.id;
    const record = getCopyRecord(source, copy, id, tableIds);
    if (!record) return state;
    const target = recordsByCollection.get(descriptor.collection) || [];
    target.push(record);
    recordsByCollection.set(descriptor.collection, target);
  }

  let next = {
    ...state,
    restaurant: { ...state.restaurant, funds: state.restaurant.funds - eligibility.price },
  };
  for (const [collection, records] of recordsByCollection) {
    next[collection] = [...(state[collection] || []), ...records];
  }
  return invalidateCopyNavigation(next);
}
