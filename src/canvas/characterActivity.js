import { getCharacterMovementStatus } from '../simulation/movement';
import { getItemConsumptionDuration } from '../simulation/consumption';
import { getFoodPatienceFraction } from '../simulation/foodPatience';
import { getCarriedServiceItemIds } from '../simulation/staffInventory';

/**
 * Presentation-only activity resolution.
 *
 * Resolvers read authoritative state and return an activity string for the
 * shared figure renderer. They never mutate simulation records, move actors or
 * add inventory. Precedence: anchored amenity residency, then actual
 * locomotion, then arrived work, then held loads, then waiting/idle fallbacks.
 */

/** Work pose for each fixed staff task. prepare_dish resolves by appliance. */
const TASK_ACTIVITIES = Object.freeze({
  clean_table: 'wiping',
  clean_floor: 'sweeping',
  wash_item: 'washing',
  take_order: 'taking_order',
  take_payment: 'taking_payment',
  prepare_drink: 'dispensing',
  place_dish_on_service: 'serving',
  pickup_service_item: 'pickup',
  deliver_service_item: 'serving',
  collect_dirty_item: 'collecting',
  deliver_dirty_item: 'depositing',
  transfer_dirty_item: 'depositing',
});

const EQUIPMENT_ACTIVITIES = Object.freeze({
  toaster: 'toasting',
  oven: 'baking',
  fryer: 'frying',
  blender: 'blending',
  coffee_machine: 'making_coffee',
});

const SEATED_CUSTOMER_STATES = new Set([
  'seated', 'ordering', 'waiting_for_items', 'waiting_for_party', 'eating',
]);
const WAITING_CUSTOMER_STATES = new Set([
  'queued', 'entering', 'waiting_for_items', 'waiting_for_party',
  'checkout_queued', 'checkout_moving', 'leaving',
]);
const CHECKOUT_PROCESSING_STATES = new Set(['checkout_processing', 'paying']);
const IMPATIENCE_THRESHOLD = 0.3;
const CONSUMPTION_ALTERNATION_MS = 900;

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function finitePoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Strict-first indexed lookup with a bounded legacy coercion fallback. */
function indexLookup(collection, id) {
  if (id == null) return null;
  if (collection instanceof Map) {
    if (collection.has(id)) return collection.get(id) || null;
    const stringId = String(id);
    if (stringId !== '' && collection.has(stringId)) return collection.get(stringId) || null;
    const numericId = Number(stringId);
    if (stringId !== '' && Number.isFinite(numericId) && collection.has(numericId)) {
      return collection.get(numericId) || null;
    }
    return null;
  }
  if (Array.isArray(collection)) {
    return collection.find(record =>
      record?.id != null && String(record.id) === String(id)) || null;
  }
  return null;
}

function resolveMovement(state, actor, movement, indexes) {
  if (movement && typeof movement === 'object') return movement;
  return getCharacterMovementStatus(state, actor?.id, indexes?.actorsByStringId || null);
}

function navigationIsPending(actor, movement) {
  if (!finitePoint(actor?.navigationGoal)) return false;
  if (movement?.plan == null) return true;
  return movement.plan !== 'arrived';
}

function findAmenity(state, indexes, amenityId) {
  return indexLookup(indexes?.staffAmenitiesByStringId, amenityId)
    || indexLookup(state?.staffAmenities, amenityId);
}

/**
 * Resolve an occupied amenity pose. Reserved/travelling use falls through so a
 * worker walking to a bed never appears asleep. Legacy anchored residency
 * without a resolvable record keeps the restrained resting pose.
 */
function staffResidency(state, staff, indexes, { seated, lying } = {}) {
  if (lying === true) return 'sleeping';
  if (seated === true) return 'resting';
  const use = staff?.amenityUse;
  if (use?.phase != null && use.phase !== 'occupied') return null;
  const residency = staff?.movementResidency;
  const amenityId = residency?.kind === 'staff_amenity' && residency.amenityId != null
    ? residency.amenityId
    : use?.phase === 'occupied' ? use.amenityId : null;
  if (amenityId == null) return null;
  const amenity = findAmenity(state, indexes, amenityId);
  if (amenity?.type === 'bed') return 'sleeping';
  if (amenity?.type === 'couch') return 'resting';
  if (amenity?.type === 'arcade') return 'gaming';
  return residency?.kind === 'staff_amenity' ? 'resting' : null;
}

function equipmentActivity(station, state, indexes) {
  const equipment = indexLookup(indexes?.equipmentById, station?.equipmentId)
    || indexLookup(state?.equipment, station?.equipmentId);
  return EQUIPMENT_ACTIVITIES[equipment?.type] || 'preparing';
}

function staffTaskActivity(task, state, indexes) {
  if (!task || typeof task !== 'object') return null;
  if (task.type === 'prepare_dish') {
    const station = indexLookup(indexes?.kitchenStationsById, task.stationId)
      || indexLookup(state?.kitchenStations, task.stationId);
    return equipmentActivity(station, state, indexes);
  }
  return TASK_ACTIVITIES[task.type] || null;
}

export function getStaffVisualActivity(state, staff, options = {}) {
  const actor = asObject(staff);
  const { movement, indexes, seated, lying } = asObject(options);

  const status = resolveMovement(state, actor, movement, indexes);
  // staffWellbeing retains occupied amenity use and movement residency for a
  // worker in dutyPhase 'exiting' until the legal exit is certified. Actual
  // travel out must walk; a blocked exit keeps the anchored pose.
  const exitingLocomotion = actor.dutyPhase === 'exiting' && status?.motion === 'traversing';
  if (!exitingLocomotion) {
    const residency = staffResidency(state, actor, indexes, { seated, lying });
    if (residency) return residency;
  }

  if (status?.motion === 'traversing') return 'walking';

  const carrying = getCarriedServiceItemIds(actor).length > 0;
  if (actor.task && actor.activityPhase === 'working' && !navigationIsPending(actor, status)) {
    const activity = staffTaskActivity(actor.task, state, indexes);
    if (activity) return activity;
  }
  if (carrying) return 'carrying';
  return 'idle';
}

function isSeatedCustomer(customer, seated) {
  if (seated === true) return true;
  if (customer?.seatResidency?.phase === 'seated') return true;
  return SEATED_CUSTOMER_STATES.has(customer?.state);
}

function isDecidingCustomer(customer) {
  if (customer?.state === 'ordering') return true;
  if (customer?.state !== 'seated') return false;
  if (customer.menuOutcome || customer.dishId || customer.drinkId) return false;
  return customer.foodOutcome !== 'cancelled';
}

function customerServiceItems(state, customer, indexes) {
  const byCustomer = indexes?.serviceItemsByCustomerId;
  if (byCustomer instanceof Map && customer?.id != null) {
    const group = indexLookup(byCustomer, customer.id);
    if (Array.isArray(group)) return group;
  }
  return Array.isArray(state?.serviceItems)
    ? state.serviceItems.filter(item =>
      item?.customerId != null && String(item.customerId) === String(customer?.id))
    : [];
}

function idSet(ids) {
  return new Set((Array.isArray(ids) ? ids : []).map(id => String(id)));
}

/**
 * Return eating/drinking only for an actually delivered, started and still
 * ongoing item. Cancelled, consumed, undelivered, untimed, unknown-kind and
 * expired items are ignored so stale timers cannot reanimate a finished meal.
 */
function activeConsumptionActivity(state, customer, indexes, { timeMs, reducedMotion } = {}) {
  const gameTime = state?.restaurant?.gameTime;
  if (!Number.isFinite(gameTime)) return null;
  const cancelledIds = idSet(customer?.cancelledServiceItemIds);
  const consumedIds = idSet(customer?.consumedServiceItemIds);
  let dish = false;
  let drink = false;

  for (const item of customerServiceItems(state, customer, indexes)) {
    if (item?.state !== 'delivered' || item.foodCancelled === true) continue;
    const id = String(item.id);
    if (cancelledIds.has(id) || consumedIds.has(id) || Number.isFinite(item.consumedAt)) continue;
    const duration = getItemConsumptionDuration(item.kind);
    if (duration == null || !Number.isFinite(item.consumptionStartedAt)) continue;
    if (gameTime - item.consumptionStartedAt >= duration) continue;
    if (item.kind === 'dish') dish = true;
    else if (item.kind === 'drink') drink = true;
  }

  if (dish && drink) {
    if (reducedMotion === true || !Number.isFinite(timeMs)) return 'eating';
    return Math.floor(timeMs / CONSUMPTION_ALTERNATION_MS) % 2 === 0 ? 'eating' : 'drinking';
  }
  if (dish) return 'eating';
  if (drink) return 'drinking';
  return null;
}

function isImpatient(state, customer) {
  const fraction = getFoodPatienceFraction(customer, state?.restaurant?.gameTime);
  return Number.isFinite(fraction) && fraction <= IMPATIENCE_THRESHOLD;
}

export function getCustomerVisualActivity(state, customer, options = {}) {
  const actor = asObject(customer);
  const { movement, indexes, seated, timeMs, reducedMotion } = asObject(options);

  if (isSeatedCustomer(actor, seated)) {
    const consumption = activeConsumptionActivity(state, actor, indexes, { timeMs, reducedMotion });
    if (consumption) return consumption;
    if (isDecidingCustomer(actor)) return 'reading';
    return isImpatient(state, actor) ? 'impatient' : 'waiting';
  }

  const status = resolveMovement(state, actor, movement, indexes);
  if (status?.motion === 'traversing') return 'walking';
  if (CHECKOUT_PROCESSING_STATES.has(actor.state)) return 'paying';
  if (isImpatient(state, actor)) return 'impatient';
  if (WAITING_CUSTOMER_STATES.has(actor.state)) return 'waiting';
  return 'idle';
}
