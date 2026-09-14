import {
  getAmenityGeometry,
  getStaffAmenityDefinition,
  isStaffAmenityType,
} from '../data/staffAmenities';
import { getDishwasherStats } from '../simulation/dishwasherProgression';
import { validateStaffSchedule } from '../simulation/staffSchedules';
import { isStaffTaskRoleAllowed } from '../simulation/taskRoles';
import { validateSavedNavigationGeometry } from './movementPersistence';
import { SAVE_VERSION } from './saveVersion';

const STAFF_ROLES = new Set(['cook', 'waiter', 'janitor']);
const STAFF_DUTIES = new Set(['work', 'rest', 'pto']);
const STAFF_DUTY_PHASES = new Set([
  'available', 'finishing_task', 'blocked_handoff', 'seeking_amenity',
  'waiting_for_amenity', 'travelling', 'active', 'exiting',
]);
const STAFF_ACTIVITY_PHASES = new Set([
  'idle_waiting', 'idle_roaming', 'task_assigned', 'working', 'stationed',
]);
const AMENITY_USE_PHASES = new Set(['reserved', 'occupied']);
const AMENITY_TYPES = new Set(['couch', 'arcade', 'bed']);
const SERVICE_ITEM_KINDS = new Set(['dish', 'drink']);
const SERVICE_ITEM_STATES = new Set([
  'ordered', 'preparing', 'ready', 'on_service', 'carried', 'delivered',
  'to_clean', 'dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing',
]);
const TASK_TYPES = new Set([
  'clean_table', 'clean_floor', 'wash_item', 'collect_dirty_item',
  'transfer_dirty_item', 'deliver_dirty_item', 'pickup_service_item', 'take_order', 'take_payment',
  'prepare_drink', 'prepare_dish', 'place_dish_on_service', 'deliver_service_item',
]);
const CUSTOMER_STATES = new Set([
  'queued', 'arriving', 'waiting', 'entering', 'seated', 'ordering',
  'waiting_for_items', 'waiting_for_party', 'eating', 'checkout_queued',
  'checkout_moving', 'checkout_processing', 'paying', 'leaving',
]);
const FOOD_OUTCOMES = new Set([null, 'pending', 'delivered', 'cancelled']);
const WASTE_ORIGIN_STATES = SERVICE_ITEM_STATES;
const PHYSICAL_ITEM_STATES = new Set([
  'ready', 'on_service', 'carried', 'delivered', 'to_clean', 'dirty_at_table',
  'carried_dirty', 'queued_for_wash', 'washing',
]);
const CANCELLED_PHYSICAL_STATES = new Set([
  'ready', 'on_service', 'carried', 'delivered', 'to_clean', 'carried_dirty',
  'dirty_at_table', 'queued_for_wash', 'washing',
]);

const has = (record, key) => record != null
  && Object.prototype.hasOwnProperty.call(record, key)
  && record[key] !== undefined;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const idKey = value => value == null ? null : String(value);

const VERSIONED_COLLECTIONS = Object.freeze([
  'tables', 'chairs', 'doors', 'cashierStations', 'kitchenStations', 'washStations',
  'staffAmenities', 'queue', 'queueDepartures', 'serviceItems',
  'cookingBatches', 'floorDirt', 'serviceTables', 'customers', 'staff',
]);
// queueSlots is intentionally backfilled by hydrateState for older current-format
// saves; unlike the domain collections above, its absence is a supported legacy
// shape rather than an ownership boundary failure.

const VERSIONED_STAFF_FIELDS = Object.freeze([
  'schedule', 'effectiveDuty', 'dutyPhase', 'dutyTransitionRequestedAt',
  'amenityUse', 'ptoSession', 'wellRestedUntil', 'amenityWaitingSince',
  'lastRestActivityType',
]);

function fail(path, reason) {
  throw new Error(`Invalid saved state: ${path} ${reason}`);
}

function validateObject(value, path) {
  if (!isRecord(value)) fail(path, 'must be an object');
}

function validateArray(value, path) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
}

function validateId(value, path, { nullable = false } = {}) {
  if (value == null && nullable) return;
  if (typeof value === 'string' && value.length > 0) return;
  if (Number.isSafeInteger(value) && value >= 0) return;
  fail(path, 'must be a non-empty ID');
}

function validateFinite(value, path, {
  nullable = false,
  minimum = null,
  maximum = null,
  integer = false,
} = {}) {
  if (value == null && nullable) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be finite');
  if (integer && !Number.isInteger(value)) fail(path, 'must be an integer');
  if (minimum != null && value < minimum) fail(path, `must be at least ${minimum}`);
  if (maximum != null && value > maximum) fail(path, `must be at most ${maximum}`);
}

function validateOptionalFinite(record, key, path, options = {}) {
  if (has(record, key)) validateFinite(record[key], `${path}.${key}`, options);
}

function validatePoint(record, path, { nullable = false } = {}) {
  if (record == null && nullable) return;
  validateObject(record, path);
  validateFinite(record.x, `${path}.x`);
  validateFinite(record.y, `${path}.y`);
}

function validateOptionalPoint(record, key, path, { nullable = false } = {}) {
  if (!has(record, key)) return;
  if (record[key] == null && nullable) return;
  validatePoint(record[key], `${path}.${key}`);
}

function validateOptionalId(record, key, path, options = {}) {
  if (has(record, key)) validateId(record[key], `${path}.${key}`, options);
}

function validateEnum(value, path, values, { nullable = false } = {}) {
  if (value == null && nullable) return;
  if (!values.has(value)) fail(path, `has unsupported value ${String(value)}`);
}

function validateOptionalEnum(record, key, path, values, options = {}) {
  if (has(record, key)) validateEnum(record[key], `${path}.${key}`, values, options);
}

function validateOptionalBoolean(record, key, path, { nullable = false } = {}) {
  if (!has(record, key)) return;
  if (record[key] == null && nullable) return;
  if (typeof record[key] !== 'boolean') fail(`${path}.${key}`, 'must be boolean');
}

function validateUniqueIds(value, path) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  const seen = new Set();
  value.forEach((id, index) => {
    validateId(id, `${path}[${index}]`);
    const key = idKey(id);
    if (seen.has(key)) fail(path, `contains duplicate ID ${key}`);
    seen.add(key);
  });
}

function validateRecordCollection(state, key) {
  if (!has(state, key)) return [];
  validateArray(state[key], key);
  state[key].forEach((record, index) => validateObject(record, `${key}[${index}]`));
  return state[key];
}

function validateVersionedStringId(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(path, 'must use a non-empty string ID representation in version 10');
  }
}

function validateVersionedIdRepresentations(value, path, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateVersionedIdRepresentations(
      child, `${path}[${index}]`, seen,
    ));
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  Object.entries(value).forEach(([key, child]) => {
    const isIdField = key === 'id' || key.endsWith('Id');
    const isIdList = key.endsWith('Ids');
    if (isIdField && child != null) validateVersionedStringId(child, `${path}.${key}`);
    if (isIdList && child != null) {
      if (!Array.isArray(child)) fail(`${path}.${key}`, 'must be an array of string IDs in version 10');
      child.forEach((id, index) => validateVersionedStringId(id, `${path}.${key}[${index}]`));
    }
    validateVersionedIdRepresentations(child, `${path}.${key}`, seen);
  });
}

function validateVersionedShape(state) {
  if (state.version !== SAVE_VERSION) return;
  if (!has(state, 'restaurant')) fail('restaurant', 'is required in version 10 saves');
  for (const key of VERSIONED_COLLECTIONS) {
    if (!has(state, key)) fail(key, 'is required in version 10 saves');
    validateArray(state[key], key);
  }

  const idCollections = [
    'tables', 'chairs', 'doors', 'cashierStations', 'kitchenStations', 'washStations',
    'staffAmenities', 'serviceTables', 'customers', 'staff', 'serviceItems',
    'cookingBatches', 'floorDirt', 'queueDepartures',
  ];
  for (const key of idCollections) {
    state[key].forEach((record, index) => {
      validateObject(record, `${key}[${index}]`);
      validateVersionedStringId(record.id, `${key}[${index}].id`);
    });
  }
  state.queue.forEach((entry, index) => {
    validateObject(entry, `queue[${index}]`);
    if (Array.isArray(entry.members)) {
      validateVersionedStringId(entry.partyId, `queue[${index}].partyId`);
      entry.members.forEach((member, memberIndex) => {
        validateObject(member, `queue[${index}].members[${memberIndex}]`);
        validateVersionedStringId(member.id, `queue[${index}].members[${memberIndex}].id`);
      });
    } else {
      validateVersionedStringId(entry.id, `queue[${index}].id`);
    }
  });
  state.staff.forEach((worker, index) => {
    const path = `staff[${index}]`;
    validateVersionedStringId(worker.role, `${path}.role`);
    for (const key of VERSIONED_STAFF_FIELDS) {
      if (!has(worker, key)) fail(`${path}.${key}`, 'is required in version 10 saves');
    }
  });
  validateVersionedIdRepresentations(state, 'save');
}

function validatePositionFields(record, path, { allowNull = false } = {}) {
  const hasX = has(record, 'x');
  const hasY = has(record, 'y');
  if (!hasX && !hasY) return;
  if (!hasX || !hasY) fail(path, 'must contain both x and y positions');
  validateFinite(record.x, `${path}.x`, { nullable: allowNull });
  validateFinite(record.y, `${path}.y`, { nullable: allowNull });
}

function validateRotation(record, path) {
  if (!has(record, 'rotation')) return;
  validateFinite(record.rotation, `${path}.rotation`, { integer: true, minimum: 0, maximum: 3 });
}

function validateFixtureCollections(state) {
  const tables = validateRecordCollection(state, 'tables');
  const chairs = validateRecordCollection(state, 'chairs');
  const kitchenStations = validateRecordCollection(state, 'kitchenStations');
  const serviceTables = validateRecordCollection(state, 'serviceTables');
  const cashierStations = validateRecordCollection(state, 'cashierStations');
  const washStations = validateRecordCollection(state, 'washStations');
  const doors = validateRecordCollection(state, 'doors');

  const validatePositioned = (records, key, options = {}) => records.forEach((record, index) => {
    validatePositionFields(record, `${key}[${index}]`, options);
    validateRotation(record, `${key}[${index}]`);
  });
  validatePositioned(tables, 'tables');
  validatePositioned(chairs, 'chairs');
  validatePositioned(kitchenStations, 'kitchenStations');
  validatePositioned(serviceTables, 'serviceTables');
  validatePositioned(cashierStations, 'cashierStations');
  validatePositioned(washStations, 'washStations');
  doors.forEach((door, index) => {
    validateOptionalFinite(door, 'y', 'doors', { minimum: 0 });
    validateOptionalEnum(door, 'role', 'doors', new Set(['entrance', 'exit']));
    validateRotation(door, `doors[${index}]`);
  });

  [...tables, ...chairs, ...kitchenStations, ...serviceTables, ...cashierStations,
    ...washStations].forEach((record, index) => {
    const collection = tables.includes(record) ? 'tables'
      : chairs.includes(record) ? 'chairs'
        : kitchenStations.includes(record) ? 'kitchenStations'
          : serviceTables.includes(record) ? 'serviceTables'
            : cashierStations.includes(record) ? 'cashierStations' : 'washStations';
    validateOptionalId(record, 'id', `${collection}[${index}]`);
  });

  washStations.forEach((station, index) => {
    const path = `washStations[${index}]`;
    validateOptionalEnum(station, 'type', path, new Set(['manual', 'automatic']));
    validateOptionalFinite(station, 'w', path, { minimum: 0, nullable: false });
    validateOptionalFinite(station, 'h', path, { minimum: 0, nullable: false });
    if (station.type === 'automatic') {
      if (has(station, 'level') && !getDishwasherStats(station.level)) {
        fail(`${path}.level`, 'must be an integer from 1 to 10');
      }
    }
  });

  return { tables, chairs, kitchenStations, serviceTables, cashierStations, washStations, doors };
}

function validateRestaurant(state) {
  if (!has(state, 'restaurant')) return;
  validateObject(state.restaurant, 'restaurant');
  const restaurant = state.restaurant;
  validateOptionalFinite(restaurant, 'gameTime', 'restaurant', { minimum: 0 });
  validateOptionalFinite(restaurant, 'day', 'restaurant', { minimum: 1, integer: true });
  validateOptionalFinite(restaurant, 'totalServed', 'restaurant', { minimum: 0, integer: true });
  validateOptionalFinite(restaurant, 'funds', 'restaurant', { minimum: 0 });
  validateOptionalFinite(restaurant, 'dailyRevenue', 'restaurant');
  validateOptionalFinite(restaurant, 'reputation', 'restaurant');
}

function validateNavigationFields(record, path) {
  validatePositionFields(record, path);
  validateOptionalPoint(record, 'navigationGoal', path, { nullable: true });
}

function validateTask(task, path, role = null) {
  if (task == null) return;
  validateObject(task, path);
  validateEnum(task.type, `${path}.type`, TASK_TYPES);
  if (!isStaffTaskRoleAllowed(task, role)) {
    fail(`${path}.type`, `is not allowed for staff role ${String(role)}`);
  }
  const requiredIdentity = {
    clean_table: ['tableId'],
    clean_floor: ['dirtId'],
    wash_item: ['serviceItemId', 'washStationId'],
    collect_dirty_item: ['serviceItemId'],
    transfer_dirty_item: ['serviceItemId', 'washStationId', 'sourceWashStationId'],
    deliver_dirty_item: ['serviceItemId', 'washStationId'],
    pickup_service_item: ['serviceItemId'],
    take_order: ['customerId'],
    take_payment: ['customerId', 'stationId'],
    prepare_drink: ['serviceItemId', 'serviceTableId', 'serviceSlotIndex'],
    prepare_dish: ['serviceItemId', 'stationId'],
    place_dish_on_service: ['serviceItemId', 'serviceTableId', 'serviceSlotIndex'],
    deliver_service_item: ['serviceItemId', 'customerId'],
  }[task.type] || [];
  for (const key of requiredIdentity) {
    if (!has(task, key) || task[key] == null) fail(`${path}.${key}`, 'is required for this task');
  }
  for (const key of [
    'customerId', 'stationId', 'washStationId', 'sourceWashStationId', 'serviceItemId',
    'serviceTableId', 'tableId', 'dirtId', 'batchId',
  ]) validateOptionalId(task, key, path);
  if (has(task, 'customerIds')) validateUniqueIds(task.customerIds, `${path}.customerIds`);
  if (has(task, 'serviceItemIds')) validateUniqueIds(task.serviceItemIds, `${path}.serviceItemIds`);
  validateOptionalFinite(task, 'serviceSlotIndex', path, { minimum: 0, maximum: 3, integer: true });
  for (const key of [
    'startedAt', 'preparationStartedAt', 'washingStartedAt', 'cleaningStartedAt',
    'lastProgressAt',
  ]) validateOptionalFinite(task, key, path, { minimum: 0, nullable: true });
  validateOptionalFinite(task, 'accumulatedWork', path, { minimum: 0, nullable: true });
}

function validatePtoSession(worker, path) {
  if (!has(worker, 'ptoSession') || worker.ptoSession == null) return;
  validateObject(worker.ptoSession, `${path}.ptoSession`);
  for (const key of ['sleepStartedAt', 'minimumEndAt']) {
    validateFinite(worker.ptoSession[key], `${path}.ptoSession.${key}`, { minimum: 0 });
  }
  validateFinite(worker.ptoSession.startingMorale, `${path}.ptoSession.startingMorale`, {
    minimum: 0, maximum: 100,
  });
  if (worker.ptoSession.minimumEndAt < worker.ptoSession.sleepStartedAt) {
    fail(`${path}.ptoSession`, 'minimumEndAt must not precede sleepStartedAt');
  }
}

function validateAmenityUse(worker, path) {
  if (!has(worker, 'amenityUse') || worker.amenityUse == null) return;
  const use = worker.amenityUse;
  validateObject(use, `${path}.amenityUse`);
  validateOptionalId(use, 'amenityId', `${path}.amenityUse`);
  if (!has(use, 'amenityId') || use.amenityId == null) fail(`${path}.amenityUse.amenityId`, 'is required');
  validateFinite(use.slotIndex, `${path}.amenityUse.slotIndex`, { minimum: 0, integer: true });
  validateEnum(use.phase, `${path}.amenityUse.phase`, AMENITY_USE_PHASES);
  for (const key of ['activityStartedAt', 'activityEndsAt', 'lastRecoveryAt']) {
    if (has(use, key)) validateFinite(use[key], `${path}.amenityUse.${key}`, { minimum: 0, nullable: true });
  }
  if (use.phase === 'occupied' && (!Number.isFinite(use.activityStartedAt)
    || !Number.isFinite(use.activityEndsAt) || !Number.isFinite(use.lastRecoveryAt))) {
    fail(`${path}.amenityUse`, 'occupied use requires finite activity timestamps');
  }
  if (Number.isFinite(use.activityEndsAt) && Number.isFinite(use.activityStartedAt)
    && use.activityEndsAt < use.activityStartedAt) {
    fail(`${path}.amenityUse`, 'activityEndsAt must not precede activityStartedAt');
  }
}

function validateMovementResidency(worker, path) {
  if (!has(worker, 'movementResidency') || worker.movementResidency == null) return;
  const residency = worker.movementResidency;
  validateObject(residency, `${path}.movementResidency`);
  if (residency.kind !== 'staff_amenity') fail(`${path}.movementResidency.kind`, 'must be staff_amenity');
  validateOptionalId(residency, 'amenityId', `${path}.movementResidency`);
  if (!has(residency, 'amenityId') || residency.amenityId == null) {
    fail(`${path}.movementResidency.amenityId`, 'is required');
  }
  validateFinite(residency.slotIndex, `${path}.movementResidency.slotIndex`, { minimum: 0, integer: true });
}

function validateStaff(staff) {
  staff.forEach((worker, index) => {
    const path = `staff[${index}]`;
    validateOptionalId(worker, 'id', path);
    validateNavigationFields(worker, path);
    validateOptionalEnum(worker, 'role', path, STAFF_ROLES);
    validateOptionalFinite(worker, 'skill', path, { minimum: 1, maximum: 10, integer: true });
    validateOptionalFinite(worker, 'morale', path, { minimum: 0, maximum: 100 });
    validateOptionalFinite(worker, 'salary', path, { minimum: 0 });
    validateOptionalEnum(worker, 'effectiveDuty', path, STAFF_DUTIES, { nullable: true });
    validateOptionalEnum(worker, 'dutyPhase', path, STAFF_DUTY_PHASES, { nullable: true });
    validateOptionalEnum(worker, 'activityPhase', path, STAFF_ACTIVITY_PHASES, { nullable: true });
    if (has(worker, 'schedule')) {
      if (!validateStaffSchedule(worker.schedule).valid) {
        fail(`${path}.schedule`, 'must contain exactly 48 valid cyclic duty slots');
      }
    }
    for (const key of [
      'idleUntil', 'dutyTransitionRequestedAt', 'amenityWaitingSince', 'wellRestedUntil',
      'wellbeingWakeAt', 'amenityRetryAt', 'dutyHandoffProgressAt',
      'dutyHandoffAccumulatedWork', 'dutyHandoffLastProgressAt',
    ]) validateOptionalFinite(worker, key, path, { minimum: 0, nullable: true });
    validateOptionalEnum(worker, 'lastRestActivityType', path, new Set(['couch', 'arcade']), { nullable: true });
    validateTask(worker.task, `${path}.task`, worker.role);
    validateAmenityUse(worker, path);
    validatePtoSession(worker, path);
    validateMovementResidency(worker, path);
    if (has(worker, 'carryingServiceItemIds')) validateUniqueIds(
      worker.carryingServiceItemIds, `${path}.carryingServiceItemIds`,
    );
    if (has(worker, 'carryingServiceItemId')) validateOptionalId(worker, 'carryingServiceItemId', path, { nullable: true });
  });
}

function validateCustomer(customer, index) {
  const path = `customers[${index}]`;
  validateOptionalId(customer, 'id', path);
  validateNavigationFields(customer, path);
  for (const key of [
    'seatTime', 'orderTime', 'eatTime', 'consumptionStartedAt', 'paymentQueuedAt',
    'foodOrderedAt', 'foodPatienceBudget', 'foodDeadlineAt', 'foodCancelledAt',
  ]) validateOptionalFinite(customer, key, path, { minimum: 0, nullable: true });
  validateOptionalFinite(customer, 'patience', path, { minimum: 0 });
  validateOptionalFinite(customer, 'patienceMax', path, { minimum: 0 });
  validateOptionalFinite(customer, 'queuePatience', path, { minimum: 0 });
  validateOptionalFinite(customer, 'queuePatienceMax', path, { minimum: 0 });
  validateOptionalFinite(customer, 'happiness', path, { minimum: 0, maximum: 100 });
  validateOptionalFinite(customer, 'foodCancelledPrice', path, { minimum: 0, nullable: true });
  validateOptionalEnum(customer, 'foodOutcome', path, FOOD_OUTCOMES, { nullable: true });
  for (const key of ['orderedServiceItemIds', 'consumedServiceItemIds', 'cancelledServiceItemIds']) {
    if (has(customer, key)) validateUniqueIds(customer[key], `${path}.${key}`);
  }
  if (has(customer, 'consumedServiceItemIds') && has(customer, 'cancelledServiceItemIds')) {
    const cancelled = new Set(customer.cancelledServiceItemIds.map(idKey));
    if (customer.consumedServiceItemIds.some(id => cancelled.has(idKey(id)))) {
      fail(path, 'consumed and cancelled service-item IDs must remain distinct');
    }
  }
  if (has(customer, 'foodCancellationReason') && customer.foodCancellationReason != null
    && typeof customer.foodCancellationReason !== 'string') {
    fail(`${path}.foodCancellationReason`, 'must be a string');
  }

  const hasFoodFields = ['foodOrderedAt', 'foodPatienceBudget', 'foodDeadlineAt',
    'foodOutcome', 'foodCancelledAt', 'cancelledServiceItemIds', 'foodCancelledPrice']
    .some(key => has(customer, key));
  if (!hasFoodFields) return;

  const outcome = customer.foodOutcome ?? null;
  if (outcome === 'pending') {
    if (!Number.isFinite(customer.foodOrderedAt) || !Number.isFinite(customer.foodPatienceBudget)
      || customer.foodPatienceBudget <= 0 || !Number.isFinite(customer.foodDeadlineAt)) {
      fail(path, 'pending food outcome requires a complete finite deadline');
    }
    if (customer.foodDeadlineAt !== customer.foodOrderedAt + customer.foodPatienceBudget) {
      fail(path, 'foodDeadlineAt must equal foodOrderedAt plus foodPatienceBudget');
    }
    if (customer.foodCancelledAt != null) fail(path, 'pending food cannot have foodCancelledAt');
  }
  if (outcome === 'cancelled') {
    if (!Number.isFinite(customer.foodCancelledAt) || customer.foodCancelledAt < 0) {
      fail(path, 'cancelled food requires a finite foodCancelledAt');
    }
    if (!Array.isArray(customer.cancelledServiceItemIds)) {
      fail(path, 'cancelled food requires cancelledServiceItemIds history');
    }
    if (customer.dishId != null || customer.dishPriceAtOrder != null) {
      fail(path, 'cancelled food cannot retain an active dish or dish price');
    }
    if (!Number.isFinite(customer.foodCancelledPrice) || customer.foodCancelledPrice < 0) {
      fail(path, 'cancelled food requires a finite foodCancelledPrice');
    }
  }
  if (Number.isFinite(customer.foodOrderedAt) && Number.isFinite(customer.foodDeadlineAt)
    && customer.foodDeadlineAt < customer.foodOrderedAt) {
    fail(path, 'foodDeadlineAt must not precede foodOrderedAt');
  }
  if (Number.isFinite(customer.foodCancelledAt) && Number.isFinite(customer.foodOrderedAt)
    && customer.foodCancelledAt < customer.foodOrderedAt) {
    fail(path, 'foodCancelledAt must not precede foodOrderedAt');
  }
}

function validateQueue(queue) {
  const actorIds = [];
  queue.forEach((entry, index) => {
    const path = `queue[${index}]`;
    if (Array.isArray(entry.members)) {
      entry.members.forEach((member, memberIndex) => {
        validateObject(member, `${path}.members[${memberIndex}]`);
        validateOptionalId(member, 'id', `${path}.members[${memberIndex}]`);
        if (member.id != null) actorIds.push({ id: member.id, path: `${path}.members[${memberIndex}]` });
      });
    } else if (entry.id != null) {
      validateId(entry.id, `${path}.id`);
      actorIds.push({ id: entry.id, path });
    }
  });
  return actorIds;
}

function validateQueueDepartures(queueDepartures) {
  const ids = [];
  queueDepartures.forEach((record, index) => {
    const path = `queueDepartures[${index}]`;
    validateId(record.id, `${path}.id`);
    validateId(record.partyId, `${path}.partyId`);
    validateEnum(record.departureReason, `${path}.departureReason`, new Set(['abandoned', 'closed']));
    ids.push({ id: record.id, path });
  });
  return ids;
}

function validateQueueSlots(state) {
  if (!has(state, 'queueSlots') || !Array.isArray(state.queueSlots)) return;
  state.queueSlots.forEach((record, index) => {
    if (!isRecord(record)) fail(`queueSlots[${index}]`, 'must be an object');
    if (record.memberId != null) validateId(record.memberId, `queueSlots[${index}].memberId`);
    if (record.partyId != null) validateId(record.partyId, `queueSlots[${index}].partyId`);
    validatePositionFields(record, `queueSlots[${index}]`);
    if (has(record, 'slot')) validateFinite(record.slot, `queueSlots[${index}].slot`, { minimum: 0, integer: true });
  });
}

function validateWasteOrigin(origin, path, serviceTables, tables) {
  validateObject(origin, path);
  validateOptionalEnum(origin, 'state', path, WASTE_ORIGIN_STATES);
  validateOptionalId(origin, 'serviceTableId', path, { nullable: true });
  validateOptionalId(origin, 'stationId', path, { nullable: true });
  validateOptionalId(origin, 'tableId', path, { nullable: true });
  validateOptionalFinite(origin, 'serviceSlotIndex', path, { minimum: 0, maximum: 3, integer: true, nullable: true });
  validateOptionalFinite(origin, 'eligibleAt', path, { minimum: 0, nullable: true });
  validateOptionalFinite(origin, 'createdAt', path, { minimum: 0, nullable: true });
  validatePositionFields(origin, path, { allowNull: true });
  if (origin.serviceTableId != null
    && !serviceTables.some(table => sameId(table.id, origin.serviceTableId))) {
    fail(`${path}.serviceTableId`, 'must name an existing service table');
  }
  if (origin.tableId != null
    && !tables.some(table => sameId(table.id, origin.tableId))) {
    fail(`${path}.tableId`, 'must name an existing table');
  }
}

function validateCleaningAction(target, path, staff) {
  if (!has(target, 'cleaningAction') || target.cleaningAction == null) return;
  const action = target.cleaningAction;
  validateObject(action, `${path}.cleaningAction`);
  if (has(action, 'id')) {
    validateId(action.id, `${path}.cleaningAction.id`);
    if (target.id != null && !sameId(action.id, target.id)) {
      fail(`${path}.cleaningAction.id`, 'must match its target ID');
    }
  } else if (has(action, 'eligibleAt')) {
    fail(`${path}.cleaningAction.id`, 'is required for a resolved action');
  }
  validateOptionalId(action, 'staffId', `${path}.cleaningAction`, { nullable: true });
  if (has(action, 'eligibleAt')) {
    validateFinite(action.eligibleAt, `${path}.cleaningAction.eligibleAt`, { minimum: 0 });
  }
  const startTimes = ['startedAt', 'cleaningStartedAt'].filter(key => has(action, key));
  if (startTimes.length === 0) {
    fail(`${path}.cleaningAction`, 'must contain a finite start time');
  }
  for (const key of startTimes) {
    validateFinite(action[key], `${path}.cleaningAction.${key}`, { minimum: 0 });
  }
  if (!has(action, 'lastProgressAt')) fail(`${path}.cleaningAction.lastProgressAt`, 'must be finite');
  validateFinite(action.lastProgressAt, `${path}.cleaningAction.lastProgressAt`, { minimum: 0 });
  validateFinite(action.accumulatedWork, `${path}.cleaningAction.accumulatedWork`, { minimum: 0 });
  validateOptionalBoolean(action, 'instantResolved', `${path}.cleaningAction`);
  validateOptionalBoolean(action, 'instantComplete', `${path}.cleaningAction`);
  if (has(action, 'eligibleAt')) {
    if (action.instantResolved !== true && action.instantResolved !== false) {
      fail(`${path}.cleaningAction.instantResolved`, 'must be a resolved boolean decision');
    }
    if (action.instantComplete !== true && action.instantComplete !== false) {
      fail(`${path}.cleaningAction.instantComplete`, 'must be a resolved boolean decision');
    }
    if (action.instantComplete && !action.instantResolved) {
      fail(`${path}.cleaningAction`, 'instantComplete requires instantResolved');
    }
  } else if (action.instantComplete === true && action.instantResolved !== true) {
    fail(`${path}.cleaningAction`, 'instantComplete requires instantResolved');
  }
  if (Number.isFinite(action.startedAt) && Number.isFinite(action.cleaningStartedAt)
    && action.startedAt !== action.cleaningStartedAt) {
    fail(`${path}.cleaningAction`, 'startedAt and cleaningStartedAt must agree');
  }
  if (action.staffId != null) {
    const owner = staff.find(worker => sameId(worker.id, action.staffId));
    if (!owner) fail(`${path}.cleaningAction.staffId`, 'must name an existing staff member');
  }
}

function validateServiceItems(state, serviceItems, fixtures) {
  const { serviceTables, tables, washStations } = fixtures;
  const staff = Array.isArray(state.staff) ? state.staff : [];
  const itemIds = new Set();
  const occupiedSlots = new Map();
  serviceItems.forEach((item, index) => {
    const path = `serviceItems[${index}]`;
    validateOptionalId(item, 'id', path);
    if (item.id == null) fail(`${path}.id`, 'is required');
    const itemKey = idKey(item.id);
    if (itemIds.has(itemKey)) fail(path, `contains duplicate item ID ${itemKey}`);
    itemIds.add(itemKey);
    validateOptionalEnum(item, 'kind', path, SERVICE_ITEM_KINDS);
    validateOptionalEnum(item, 'state', path, SERVICE_ITEM_STATES);
    for (const key of [
      'customerId', 'tableId', 'serviceTableId', 'stationId', 'washStationId',
      'reservedWashStationId', 'assignedStaffId', 'batchId',
    ]) validateOptionalId(item, key, path, { nullable: true });
    validatePositionFields(item, path, { allowNull: true });
    validateOptionalFinite(item, 'serviceSlotIndex', path, { minimum: 0, maximum: 3, integer: true, nullable: true });
    for (const key of [
      'orderedAt', 'orderTime', 'createdAt', 'preparationStartedAt', 'readyAt', 'dirtyAt',
      'washQueuedAt', 'washStartedAt', 'consumedAt', 'consumptionStartedAt', 'cancelledAt',
      'lastProgressAt',
    ]) validateOptionalFinite(item, key, path, { minimum: 0, nullable: true });
    validateOptionalFinite(item, 'accumulatedWork', path, { minimum: 0, nullable: true });
    validateOptionalBoolean(item, 'foodCancelled', path);
    validateOptionalBoolean(item, 'deliveryProhibited', path);
    if (has(item, 'cancellationReason') && item.cancellationReason != null
      && typeof item.cancellationReason !== 'string') fail(`${path}.cancellationReason`, 'must be a string');
    if (has(item, 'wasteOrigin')) validateWasteOrigin(item.wasteOrigin, `${path}.wasteOrigin`, serviceTables, tables);

    const stateName = item.state;
    if (item.serviceSlotIndex != null && item.serviceTableId == null) {
      fail(path, 'service slot requires a service table');
    }
    if (item.serviceTableId != null
      && !serviceTables.some(table => sameId(table.id, item.serviceTableId))) {
      fail(`${path}.serviceTableId`, 'must name an existing service table');
    }
    if (item.tableId != null
      && !tables.some(table => sameId(table.id, item.tableId))) {
      fail(`${path}.tableId`, 'must name an existing dining table');
    }
    if (item.washStationId != null
      && !washStations.some(station => sameId(station.id, item.washStationId))) {
      fail(`${path}.washStationId`, 'must name an existing wash station');
    }
    if (item.reservedWashStationId != null) {
      const destination = washStations.find(station => sameId(station.id, item.reservedWashStationId));
      if (!destination || destination.type !== 'automatic') {
        fail(`${path}.reservedWashStationId`, 'must name an automatic wash station');
      }
    }
    if (stateName === 'on_service' || stateName === 'to_clean'
      || (stateName === 'carried' && item.kind === 'dish')) {
      if (item.serviceTableId != null && item.serviceSlotIndex != null) {
        const key = `${idKey(item.serviceTableId)}:${item.serviceSlotIndex}`;
        if (occupiedSlots.has(key)) fail(path, `duplicates occupied service slot ${key}`);
        occupiedSlots.set(key, item.id);
      }
    }
    if (item.foodCancelled === true) {
      if (item.deliveryProhibited !== true) fail(path, 'cancelled food must be delivery-prohibited');
      if (!Number.isFinite(item.cancelledAt)) fail(`${path}.cancelledAt`, 'must be finite for cancelled food');
      if (!CANCELLED_PHYSICAL_STATES.has(stateName)) fail(path, 'cancelled food has an invalid physical state');
      if (['to_clean', 'dirty_at_table'].includes(stateName)
        && (!has(item, 'wasteOrigin') || item.wasteOrigin == null)) {
        fail(path, 'cancelled waste requires wasteOrigin');
      }
    }
    if (item.deliveryProhibited === true && item.foodCancelled !== true) {
      fail(path, 'deliveryProhibited requires foodCancelled');
    }
    validateCleaningAction(item, path, staff);
  });
  return itemIds;
}

function validateCleaningTargets(state, staff) {
  for (const [collection, records] of [['tables', state.tables], ['floorDirt', state.floorDirt]]) {
    if (!Array.isArray(records)) continue;
    records.forEach((target, index) => {
      const path = `${collection}[${index}]`;
      validateOptionalId(target, 'id', path);
      validatePositionFields(target, path, { allowNull: true });
      for (const key of ['createdAt', 'dirtyAt', 'eligibleAt', 'cleaningEligibleAt']) {
        validateOptionalFinite(target, key, path, { minimum: 0, nullable: true });
      }
      validateCleaningAction(target, path, staff);
    });
  }
}

function validateCookingBatches(state, serviceItems) {
  if (!has(state, 'cookingBatches')) return;
  validateArray(state.cookingBatches, 'cookingBatches');
  const seen = new Set();
  const itemIds = new Set(serviceItems.map(item => idKey(item.id)));
  state.cookingBatches.forEach((batch, index) => {
    const path = `cookingBatches[${index}]`;
    validateObject(batch, path);
    validateId(batch.id, `${path}.id`);
    if (seen.has(idKey(batch.id))) fail(path, `contains duplicate batch ID ${idKey(batch.id)}`);
    seen.add(idKey(batch.id));
    validateOptionalId(batch, 'cookId', path, { nullable: true });
    validateOptionalId(batch, 'stationId', path, { nullable: true });
    if (has(batch, 'serviceItemIds')) {
      validateUniqueIds(batch.serviceItemIds, `${path}.serviceItemIds`);
      batch.serviceItemIds.forEach(id => {
        if (!itemIds.has(idKey(id))) fail(`${path}.serviceItemIds`, `references missing item ${String(id)}`);
      });
    }
    validateOptionalEnum(batch, 'status', path, new Set(['reserved', 'preparing', 'ready', 'delivering']));
    for (const key of ['startedAt', 'readyAt']) validateOptionalFinite(batch, key, path, { minimum: 0, nullable: true });
  });
}

function hasRecordId(records, value) {
  return value != null && (records || []).some(record => sameId(record?.id, value));
}

function historicalServiceItemIds(state) {
  const customers = [
    ...(state.customers || []),
    ...(state.queue || []).flatMap(party => party?.members || []),
    ...(state.queueDepartures || []),
  ];
  return new Set(customers.flatMap(customer => [
    ...(customer?.cancelledServiceItemIds || []),
    ...(customer?.consumedServiceItemIds || []),
  ]).map(idKey));
}

function historicalCustomerIds(state) {
  return new Set([
    ...(state.queueDepartures || []).map(record => record?.id),
    ...(state.completedCustomers || []).map(payment => payment?.customerId),
  ].filter(id => id != null).map(idKey));
}

function isHistoricalServiceItemReference(state, item) {
  return item?.foodCancelled === true
    || historicalServiceItemIds(state).has(idKey(item?.id));
}

// A station can be removed while an already-emitted preparation reservation is
// waiting for the next normalisation pass.  Keep that narrow recovery shape
// compatible with the existing release path; an unowned or batchless dangling
// batch remains invalid.
function isRecoverablePreparationReservation(state, batch, item = null, task = null) {
  const candidateTask = task || (state.staff || []).find(worker =>
    worker?.task?.type === 'prepare_dish'
      && sameId(worker.task.batchId, batch?.id))?.task;
  const worker = (state.staff || []).find(candidate => candidate?.task === candidateTask);
  const candidateItem = item || (state.serviceItems || []).find(serviceItem =>
    sameId(serviceItem?.batchId, batch?.id)
      && sameId(serviceItem?.id, candidateTask?.serviceItemId));
  return candidateTask?.type === 'prepare_dish'
    && worker?.role === 'cook'
    && candidateItem
    && ['ordered', 'preparing', 'ready', 'carried'].includes(candidateItem.state)
    && sameId(candidateItem.assignedStaffId, worker.id)
    && sameId(candidateTask.serviceItemId, candidateItem.id)
    && sameId(candidateTask.batchId, batch?.id);
}

function isRecoverableManualWashOwnership(state, item, fixtures) {
  if (!['queued_for_wash', 'washing'].includes(item?.state)) return false;
  const owner = (state.staff || []).find(worker =>
    worker?.task?.type === 'wash_item'
      && sameId(worker.task.serviceItemId, item.id));
  const station = fixtures.washStations.find(candidate =>
    sameId(candidate.id, owner?.task?.washStationId));
  const customer = (state.customers || []).find(candidate =>
    sameId(candidate.id, item.customerId));
  return owner?.role === 'janitor'
    && station?.type === 'manual'
    && customer?.state === 'leaving';
}

function taskHasHistoricalServiceItem(task, history) {
  return [
    task?.serviceItemId,
    ...(Array.isArray(task?.serviceItemIds) ? task.serviceItemIds : []),
  ].some(id => id != null && history.has(idKey(id)));
}

function validateTaskForeignKeys(state, worker, task, fixtures, serviceItemHistory, customerHistory) {
  if (!task) return;
  const path = `staff.${String(worker.id)}.task`;
  const historicalItem = taskHasHistoricalServiceItem(task, serviceItemHistory);
  const historicalCustomer = task.customerId != null
    && customerHistory.has(idKey(task.customerId));
  const recoverablePreparation = task.type === 'prepare_dish'
    && isRecoverablePreparationReservation(
      state,
      (state.cookingBatches || []).find(batch => sameId(batch.id, task.batchId)),
      (state.serviceItems || []).find(item => sameId(item.id, task.serviceItemId)),
      task,
    );
  const serviceItems = state.serviceItems || [];
  const allowHistorical = (kind, value) => {
    if (kind === 'service item') return historicalItem;
    if (kind === 'customer') return historicalCustomer;
    return historicalItem || recoverablePreparation;
  };
  const requireReference = (value, records, key, kind, { nullable = false } = {}) => {
    if (value == null && nullable) return;
    if (!hasRecordId(records, value) && !allowHistorical(kind, value)) {
      fail(`${path}.${key}`, `must name an existing ${kind}`);
    }
  };

  const references = {
    clean_table: [['tableId', state.tables, 'table']],
    clean_floor: [['dirtId', state.floorDirt, 'floor dirt']],
    wash_item: [
      ['serviceItemId', serviceItems, 'service item'],
      ['washStationId', fixtures.washStations, 'wash station'],
    ],
    collect_dirty_item: [
      ['serviceItemId', serviceItems, 'service item'],
      ['tableId', state.tables, 'table', { nullable: true }],
    ],
    transfer_dirty_item: [
      ['serviceItemId', serviceItems, 'service item'],
      ['washStationId', fixtures.washStations, 'wash station'],
      ['sourceWashStationId', fixtures.washStations, 'wash station'],
    ],
    deliver_dirty_item: [
      ['serviceItemId', serviceItems, 'service item'],
      ['washStationId', fixtures.washStations, 'wash station'],
    ],
    pickup_service_item: [['serviceItemId', serviceItems, 'service item']],
    take_order: [['customerId', state.customers, 'customer']],
    take_payment: [
      ['customerId', state.customers, 'customer'],
      ['stationId', fixtures.cashierStations, 'cashier station'],
    ],
    prepare_drink: [
      ['serviceItemId', serviceItems, 'service item'],
      ['serviceTableId', fixtures.serviceTables, 'service table'],
    ],
    prepare_dish: [
      ['serviceItemId', serviceItems, 'service item'],
      ['stationId', state.kitchenStations, 'kitchen station'],
      ['batchId', state.cookingBatches, 'cooking batch', { nullable: true }],
    ],
    place_dish_on_service: [
      ['serviceItemId', serviceItems, 'service item'],
      ['serviceTableId', fixtures.serviceTables, 'service table'],
      ['stationId', state.kitchenStations, 'kitchen station', { nullable: true }],
      ['batchId', state.cookingBatches, 'cooking batch', { nullable: true }],
    ],
    deliver_service_item: [
      ['serviceItemId', serviceItems, 'service item'],
      ['customerId', state.customers, 'customer'],
    ],
  }[task.type] || [];

  for (const [key, records, kind, options = {}] of references) {
    requireReference(task[key], records, key, kind, options);
  }
  if (task.batchId != null) {
    const batch = (state.cookingBatches || []).find(candidate =>
      sameId(candidate.id, task.batchId));
    if (!batch && !historicalItem) {
      fail(`${path}.batchId`, 'must name an existing cooking batch');
    }
  }
  if (Array.isArray(task.customerIds)) {
    task.customerIds.forEach((id, index) => requireReference(
      id, state.customers, `customerIds[${index}]`, 'customer',
    ));
  }
  if (Array.isArray(task.serviceItemIds)) {
    task.serviceItemIds.forEach((id, index) => requireReference(
      id, serviceItems, `serviceItemIds[${index}]`, 'service item',
    ));
  }
}

function validateForeignKeys(state, serviceItems, fixtures) {
  // Versionless objects are intentionally partial hydration fixtures.  The
  // persisted version-ten boundary is the point at which all FK collections
  // are known to be present and can be checked without defeating legacy fill-in.
  if (state.version !== SAVE_VERSION) return;

  const staff = Array.isArray(state.staff) ? state.staff : [];
  const batches = Array.isArray(state.cookingBatches) ? state.cookingBatches : [];
  const serviceItemHistory = historicalServiceItemIds(state);
  const staffById = value => hasRecordId(staff, value);
  const batchById = value => hasRecordId(batches, value);

  serviceItems.forEach((item, index) => {
    const path = `serviceItems[${index}]`;
    if (item.assignedStaffId != null && !staffById(item.assignedStaffId)
      && !isRecoverableManualWashOwnership(state, item, fixtures)) {
      fail(`${path}.assignedStaffId`, 'must name an existing staff member');
    }
    if (item.batchId != null && !batchById(item.batchId)
      && !isHistoricalServiceItemReference(state, item)) {
      fail(`${path}.batchId`, 'must name an existing cooking batch');
    }
  });

  batches.forEach((batch, index) => {
    const path = `cookingBatches[${index}]`;
    const recoverable = isRecoverablePreparationReservation(state, batch);
    if ((batch.cookId == null || !staffById(batch.cookId)) && !recoverable) {
      fail(`${path}.cookId`, 'must name an existing staff member');
    }
    if ((batch.stationId == null || !hasRecordId(state.kitchenStations, batch.stationId))
      && !recoverable) {
      fail(`${path}.stationId`, 'must name an existing kitchen station');
    }
  });

  const customerHistory = historicalCustomerIds(state);
  for (const worker of staff) {
    validateTaskForeignKeys(
      state,
      worker,
      worker.task,
      fixtures,
      serviceItemHistory,
      customerHistory,
    );
  }
}

function validateAmenities(state, staff) {
  if (!has(state, 'staffAmenities')) return;
  validateArray(state.staffAmenities, 'staffAmenities');
  const amenityIds = new Set();
  const owners = new Map();
  const staffById = new Map(staff.filter(worker => worker.id != null)
    .map(worker => [idKey(worker.id), worker]));
  const records = state.staffAmenities;
  records.forEach((amenity, index) => {
    const path = `staffAmenities[${index}]`;
    validateObject(amenity, path);
    validateId(amenity.id, `${path}.id`);
    const amenityId = idKey(amenity.id);
    if (amenityIds.has(amenityId)) fail(path, `contains duplicate amenity ID ${amenityId}`);
    amenityIds.add(amenityId);
    if (!isStaffAmenityType(amenity.type)) fail(`${path}.type`, 'must be couch, arcade or bed');
    validateFinite(amenity.x, `${path}.x`);
    validateFinite(amenity.y, `${path}.y`);
    validateFinite(amenity.rotation, `${path}.rotation`, { minimum: 0, maximum: 3, integer: true });
    const definition = getStaffAmenityDefinition(amenity.type);
    validateArray(amenity.slots, `${path}.slots`);
    if (amenity.slots.length !== definition.capacity) {
      fail(`${path}.slots`, `must contain exactly ${definition.capacity} slots`);
    }
    const indexes = new Set();
    amenity.slots.forEach((slot, slotPosition) => {
      const slotPath = `${path}.slots[${slotPosition}]`;
      validateObject(slot, slotPath);
      validateFinite(slot.index, `${slotPath}.index`, { minimum: 0, integer: true });
      if (indexes.has(slot.index)) fail(`${path}.slots`, `contains duplicate slot index ${slot.index}`);
      indexes.add(slot.index);
      if (slot.index !== slotPosition) fail(`${slotPath}.index`, 'must be the canonical zero-based slot index');
      validateOptionalId(slot, 'reservedBy', slotPath, { nullable: true });
      validateOptionalId(slot, 'occupiedBy', slotPath, { nullable: true });
      if (slot.reservedBy != null && slot.occupiedBy != null) fail(slotPath, 'cannot be both reserved and occupied');
      for (const key of ['reservedBy', 'occupiedBy']) {
        const ownerId = slot[key];
        if (ownerId == null) continue;
        const ownerKey = idKey(ownerId);
        if (!staffById.has(ownerKey)) fail(`${slotPath}.${key}`, 'must name an existing staff member');
        if (owners.has(ownerKey)) fail(`${slotPath}.${key}`, 'duplicates another amenity reservation or occupant');
        owners.set(ownerKey, { amenity, slot, phase: key === 'reservedBy' ? 'reserved' : 'occupied' });
      }
    });
  });

  staff.forEach((worker, index) => {
    const path = `staff[${index}]`;
    if (worker.amenityUse == null) {
      if (worker.movementResidency != null) fail(`${path}.movementResidency`, 'requires an occupied amenity use');
      return;
    }
    const use = worker.amenityUse;
    const amenity = records.find(candidate => sameId(candidate.id, use.amenityId));
    if (!amenity) fail(`${path}.amenityUse.amenityId`, 'must name an existing amenity');
    const slot = amenity.slots[use.slotIndex];
    if (!slot) fail(`${path}.amenityUse.slotIndex`, 'must name an existing amenity slot');
    const ownerKey = idKey(worker.id);
    const expectedOwner = use.phase === 'reserved' ? slot.reservedBy : slot.occupiedBy;
    if (!sameId(expectedOwner, worker.id)) fail(`${path}.amenityUse`, 'does not match the slot owner');
    if (use.phase === 'reserved' && slot.occupiedBy != null) fail(`${path}.amenityUse`, 'reserved slot is occupied');
    if (use.phase === 'occupied' && slot.reservedBy != null) fail(`${path}.amenityUse`, 'occupied slot remains reserved');
      if (use.phase === 'occupied') {
        if (amenity.type === 'bed') {
          if (!worker.ptoSession) fail(`${path}.ptoSession`, 'is required for an occupied bed');
          if (worker.ptoSession.minimumEndAt - worker.ptoSession.sleepStartedAt !== 25_200) {
            fail(`${path}.ptoSession`, 'bed sleep must preserve the exact 25200-second minimum');
          }
        } else if (worker.ptoSession != null) {
          fail(`${path}.ptoSession`, 'is only valid for bed occupancy');
        }
        const geometry = getAmenityGeometry(amenity);
        if (['couch', 'bed'].includes(amenity.type)) {
          if (worker.movementResidency == null) {
            fail(`${path}.movementResidency`, 'is required for an occupied amenity');
          }
          const residency = worker.movementResidency;
          if (!sameId(residency.amenityId, amenity.id) || residency.slotIndex !== slot.index) {
            fail(`${path}.movementResidency`, 'must point to the occupied amenity slot');
          }
          const anchor = geometry?.slotAnchors?.[slot.index];
          if (!anchor || worker.x !== anchor.x || worker.y !== anchor.y) {
            fail(`${path}.movementResidency`, 'must preserve the occupied slot anchor position');
          }
        } else {
          if (worker.movementResidency != null) {
            fail(`${path}.movementResidency`, 'arcade occupancy must remain a standing actor');
          }
          const approach = geometry?.approachPoints?.[slot.index];
          if (!approach || worker.x !== approach.x || worker.y !== approach.y) {
            fail(`${path}.amenityUse`, 'occupied arcade actor must remain at its approach point');
          }
        }
      } else if (worker.movementResidency != null) {
      fail(`${path}.movementResidency`, 'requires an occupied amenity use');
    }
    if (!owners.has(ownerKey) || owners.get(ownerKey).amenity.id !== amenity.id
      || owners.get(ownerKey).slot.index !== slot.index) {
      fail(`${path}.amenityUse`, 'has no matching bidirectional slot ownership');
    }
  });

  for (const [ownerKey, owner] of owners) {
    const worker = staffById.get(ownerKey);
    const use = worker?.amenityUse;
    if (!use || !sameId(use.amenityId, owner.amenity.id)
      || use.slotIndex !== owner.slot.index || use.phase !== owner.phase) {
      fail(`staffAmenities[${records.indexOf(owner.amenity)}].slots`, 'has one-sided ownership');
    }
  }
}

function validateCarriersAndReservations(state, serviceItems, fixtures) {
  const staff = Array.isArray(state.staff) ? state.staff : [];
  const workersById = new Map(staff.filter(worker => worker.id != null)
    .map(worker => [idKey(worker.id), worker]));
  const itemsById = new Map(serviceItems.map(item => [idKey(item.id), item]));
  const carriers = new Map();
  const itemCarrierIds = worker => {
    if (Array.isArray(worker.carryingServiceItemIds)) return worker.carryingServiceItemIds;
    return worker.carryingServiceItemId == null ? [] : [worker.carryingServiceItemId];
  };
  for (const worker of staff) {
    const ids = itemCarrierIds(worker);
    const seen = new Set();
    let kind = null;
    const capacity = Number.isFinite(worker.skill) && worker.skill >= 10
      ? 3 : Number.isFinite(worker.skill) && worker.skill >= 5 ? 2 : 1;
    if (ids.length > capacity) fail(`staff.${String(worker.id)}`, 'exceeds carrying capacity');
    ids.forEach((rawId, index) => {
      const key = idKey(rawId);
      if (key == null || seen.has(key)) fail(`staff.${String(worker.id)}.carryingServiceItemIds[${index}]`, 'is duplicated');
      seen.add(key);
      const item = itemsById.get(key);
      if (!item) fail(`staff.${String(worker.id)}.carryingServiceItemIds`, `references missing item ${key}`);
      if (!['carried', 'carried_dirty'].includes(item.state)) {
        fail(`staff.${String(worker.id)}.carryingServiceItemIds`, `item ${key} is not physically carried`);
      }
      if (item.state === 'carried_dirty' && worker.role !== 'waiter') {
        fail(`staff.${String(worker.id)}.carryingServiceItemIds`, `worker cannot carry dirty item ${key}`);
      }
      if (carriers.has(key)) fail(`serviceItems.${key}`, 'has multiple carriers');
      carriers.set(key, worker.id);
      const itemKind = item.state === 'carried_dirty' ? 'dirty' : 'clean';
      if (kind == null) kind = itemKind;
      if (kind !== itemKind) fail(`staff.${String(worker.id)}.carryingServiceItemIds`, 'mixes clean and dirty loads');
      if (item.assignedStaffId != null && !sameId(item.assignedStaffId, worker.id)) {
        fail(`serviceItems.${key}.assignedStaffId`, 'contradicts its physical carrier');
      }
      if (Number.isFinite(item.x) && Number.isFinite(worker.x)
        && (item.x !== worker.x || item.y !== worker.y)) {
        fail(`serviceItems.${key}`, 'physical carrier position does not match item position');
      }
    });
  }

  const transferReservations = new Map();
  for (const worker of staff) {
    const task = worker.task;
    if (!task || !['transfer_dirty_item', 'deliver_dirty_item'].includes(task.type)) continue;
    const item = itemsById.get(idKey(task.serviceItemId));
    if (!item) fail(`staff.${String(worker.id)}.task`, 'references a missing service item');
    const destination = fixtures.washStations.find(station => sameId(station.id, task.washStationId));
    if (!destination) fail(`staff.${String(worker.id)}.task.washStationId`, 'references a missing wash station');
    if (task.type === 'transfer_dirty_item' && destination.type !== 'automatic') {
      fail(`staff.${String(worker.id)}.task`, 'transfer destination must be automatic');
    }
    if (task.type === 'transfer_dirty_item') {
      const source = fixtures.washStations.find(station => sameId(station.id, task.sourceWashStationId));
      if (!source || source.type !== 'manual') fail(`staff.${String(worker.id)}.task`, 'transfer source must be manual');
      if (!sameId(item.washStationId, source.id) || !sameId(item.reservedWashStationId, destination.id)) {
        fail(`staff.${String(worker.id)}.task`, 'contradicts the item source/destination reservation');
      }
      if (!carriers.has(idKey(item.id)) && item.state === 'carried_dirty') {
        fail(`staff.${String(worker.id)}.task`, 'carried transfer item has no physical carrier');
      }
    } else if (item.state !== 'carried_dirty' || !carriers.has(idKey(item.id))) {
      fail(`staff.${String(worker.id)}.task`, 'dirty delivery must own a carried dirty item');
    }
    const itemKey = idKey(item.id);
    if (transferReservations.has(itemKey)) fail(`serviceItems.${itemKey}`, 'has duplicate incoming reservations');
    transferReservations.set(itemKey, { worker, task });
  }

  for (const item of serviceItems) {
    if (item.reservedWashStationId == null) continue;
    const key = idKey(item.id);
    const reservation = transferReservations.get(key);
    if (!reservation) fail(`serviceItems.${key}.reservedWashStationId`, 'has no matching incoming reservation task');
    if (!sameId(reservation.task.washStationId, item.reservedWashStationId)) {
      fail(`serviceItems.${key}.reservedWashStationId`, 'contradicts its incoming reservation task');
    }
  }

  // Validate station occupancy from the same physical IDs used by the runtime.
  for (const station of fixtures.washStations) {
    const ids = new Set();
    for (const item of serviceItems) {
      if ((item.state === 'queued_for_wash' || item.state === 'washing' || item.state === 'carried_dirty')
        && sameId(item.washStationId, station.id)) ids.add(idKey(item.id));
      if (sameId(item.reservedWashStationId, station.id)) ids.add(idKey(item.id));
    }
    for (const { task } of transferReservations.values()) {
      if (sameId(task.washStationId, station.id)) ids.add(idKey(task.serviceItemId));
    }
    const capacity = station.type === 'manual'
      ? 8 : getDishwasherStats(station.level ?? 1)?.capacity ?? 0;
    if (ids.size > capacity) fail(`washStations.${String(station.id)}`, 'exceeds canonical physical occupancy');
  }

  return { carriers, itemsById, workersById };
}

function validateCrossDomainFoodHistory(state, serviceItems) {
  const customers = Array.isArray(state.customers) ? state.customers : [];
  const customerById = new Map(customers.filter(customer => customer.id != null)
    .map(customer => [idKey(customer.id), customer]));
  for (const customer of customers) {
    const cancelled = new Set((customer.cancelledServiceItemIds || []).map(idKey));
    const consumed = new Set((customer.consumedServiceItemIds || []).map(idKey));
    for (const item of serviceItems) {
      if (!sameId(item.customerId, customer.id)) continue;
      if (cancelled.has(idKey(item.id)) && item.foodCancelled !== true) {
        fail(`serviceItems.${String(item.id)}`, 'contradicts cancelled customer history');
      }
      if (item.foodCancelled === true && customer.foodOutcome !== 'cancelled') {
        fail(`serviceItems.${String(item.id)}`, 'cancelled food requires a cancelled customer outcome');
      }
    }
    if ([...cancelled].some(id => consumed.has(id))) fail(`customers.${String(customer.id)}`, 'reuses a cancelled ID as consumed');
  }
  for (const item of serviceItems) {
    if (item.customerId == null) continue;
    const customer = customerById.get(idKey(item.customerId));
    if (item.foodCancelled === true && customer && customer.foodOutcome !== 'cancelled') {
      fail(`serviceItems.${String(item.id)}`, 'cancelled food owner is not in cancelled outcome');
    }
  }
}

function validateActorIdentityUniqueness(state, queueActors, departureActors) {
  const seen = new Map();
  const add = ({ id, path }) => {
    if (id == null) return;
    const key = idKey(id);
    if (seen.has(key)) fail(path, `duplicates actor ID ${key} already used by ${seen.get(key)}`);
    seen.set(key, path);
  };
  (state.staff || []).forEach((worker, index) => add({ id: worker.id, path: `staff[${index}]` }));
  (state.customers || []).forEach((customer, index) => add({ id: customer.id, path: `customers[${index}]` }));
  queueActors.forEach(add);
  departureActors.forEach(add);
}

/**
 * Validate the persisted domain before any normaliser is allowed to repair it.
 * The validator intentionally treats omitted optional fields as absent so that
 * the existing direct hydration fixtures can still exercise default filling;
 * fields emitted by the version-ten runtime are validated strictly.
 */
export function validateSavedState(state) {
  validateObject(state, 'save');
  validateVersionedShape(state);
  if (state.version === SAVE_VERSION) validateSavedNavigationGeometry(state);
  validateRestaurant(state);
  const fixtures = validateFixtureCollections(state);
  const staff = validateRecordCollection(state, 'staff');
  const customers = validateRecordCollection(state, 'customers');
  const queue = validateRecordCollection(state, 'queue');
  const queueDepartures = validateRecordCollection(state, 'queueDepartures');
  const serviceItems = validateRecordCollection(state, 'serviceItems');
  validateRecordCollection(state, 'floorDirt');

  validateStaff(staff);
  customers.forEach(validateCustomer);
  const queueActors = has(state, 'queue') ? validateQueue(queue) : [];
  const departureActors = has(state, 'queueDepartures') ? validateQueueDepartures(queueDepartures) : [];
  validateActorIdentityUniqueness({ ...state, staff, customers }, queueActors, departureActors);
  validateCleaningTargets(state, staff);
  const itemIds = validateServiceItems(state, serviceItems, fixtures);
  validateCookingBatches(state, serviceItems);
  validateForeignKeys(state, serviceItems, fixtures);
  validateAmenities(state, staff);
  validateCarriersAndReservations(state, serviceItems, fixtures);
  validateCrossDomainFoodHistory(state, serviceItems);
  return { valid: true, itemIds };
}

export function isSaveValidationError(error) {
  return error instanceof Error && /^Invalid saved state:/.test(error.message);
}
