const SAVE_KEY = 'restaurant-sim-save';
import { inferGender } from '../canvas/characterAppearance';
import { normaliseDrinkOverrides } from '../data/drinks';
import { getEquipmentLevelMultipliers } from '../data/equipment';
import { normaliseOperatingHour } from '../simulation/clock';
import { normaliseConsumptionState } from '../simulation/consumption';
import { isCheckoutState } from '../simulation/checkout';
import { normaliseCustomerQueue, normaliseQueueDepartures, normaliseQueueSlots, reconcileQueueSlots } from '../simulation/customerQueue';
import { reconcileSelfSeatingState } from '../simulation/selfSeating';
import { clearNavigationGoal } from '../simulation/movement/navigationGoal';
import { createMovementCoordinator } from '../simulation/navigation/coordinator';
import { SAVE_VERSION } from './saveVersion';
import { normaliseDoorAdmissions } from './doorAdmissions';
import { hydrateMovementResidencies, movementSaveSnapshot, validateSavedNavigationGeometry } from './movementPersistence';
import { normaliseCustomerEconomy } from '../simulation/menuEconomy';
import {
  normalisePartyReviewHistory,
  normalisePendingPartyReviews,
} from '../simulation/partyReviews';

export function saveState(state) {
  try {
    const serialized = JSON.stringify(movementSaveSnapshot(state));
    localStorage.setItem(SAVE_KEY, serialized);
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

export function loadState() {
  try {
    const serialized = localStorage.getItem(SAVE_KEY);
    if (!serialized) return null;
    const saved = JSON.parse(serialized);
    if (saved?.version !== SAVE_VERSION) return null;
    validateSavedNavigationGeometry(saved);
    return saved;
  } catch (e) {
    console.warn('Failed to load state:', e);
    return null;
  }
}

function uniqueCompletedCustomerVisits(value) {
  if (!Array.isArray(value)) return [];
  const seenCustomerIds = new Set();
  return value.filter(payment => {
    if (payment?.customerId == null) return true;
    if (seenCustomerIds.has(payment.customerId)) return false;
    seenCustomerIds.add(payment.customerId);
    return true;
  });
}

function finishCompletedCheckout(customer, completedCustomerIds) {
  if (!completedCustomerIds.has(customer.id) || !isCheckoutState(customer)) return customer;
  return clearNavigationGoal({
    ...customer,
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'to_door',
    exitDoorId: null,
    exitFadeProgress: 0,
    exitHeading: null,
    cashierStationId: null,
    checkoutPosition: null,
    paymentReady: false,
  });
}

export function hydrateState(saved, fresh) {
  // Partial domain fixtures may omit a version; imported saves are version-gated
  // by loadState/Settings before reaching this normalisation boundary.
  if (saved.version != null && saved.version !== SAVE_VERSION) {
    throw new Error('Saved game is incompatible with the current game version');
  }
  const staff = (saved.staff || fresh.staff || []).map(character => ({
    ...character,
    gender: inferGender(character),
  }));
  const queue = normaliseCustomerQueue(saved.queue || fresh.queue || []).map(party => ({
    ...party,
    members: party.members.map(character => normaliseCustomerEconomy({
      ...character,
      gender: inferGender(character),
    })),
  }));
  const queueDepartures = normaliseQueueDepartures(
    saved.queueDepartures ?? fresh.queueDepartures ?? [],
  );
  const completedCustomers = uniqueCompletedCustomerVisits(
    saved.completedCustomers || fresh.completedCustomers || [],
  );
  const completedCustomerIds = new Set(completedCustomers
    .map(payment => payment?.customerId).filter(id => id != null));
  const partyReviewHistory = normalisePartyReviewHistory(saved.partyReviewHistory);
  const settledPartyIds = new Set(partyReviewHistory.map(review => review.partyId));
  const pendingPartyReviews = normalisePendingPartyReviews(saved.pendingPartyReviews)
    .filter(record => !settledPartyIds.has(record.partyId));
  const hydrated = {
    ...fresh,
    ...saved,
    restaurant: {
      ...fresh.restaurant,
      ...(saved.restaurant || {}),
    },
    staff,
    customers: (saved.customers || fresh.customers || []).map(character =>
      finishCompletedCheckout(normaliseCustomerEconomy({
        ...character,
        gender: inferGender(character),
      }), completedCustomerIds)),
    queue,
    queueDepartures,
    queueAdmissionGate: saved.queueAdmissionGate ?? fresh.queueAdmissionGate ?? null,
    pendingPartyReviews,
    partyReviewHistory,
    drinkOverrides: normaliseDrinkOverrides(saved.drinkOverrides ?? fresh.drinkOverrides),
    floorDirt: Array.isArray(saved.floorDirt) ? saved.floorDirt : fresh.floorDirt,
    washStations: Array.isArray(saved.washStations) ? saved.washStations : fresh.washStations,
  };
  if ('completedCustomers' in saved || 'completedCustomers' in fresh) {
    hydrated.completedCustomers = completedCustomers;
  }
  const consumption = normaliseConsumptionState(
    hydrated.customers,
    hydrated.serviceItems || [],
    hydrated.restaurant.gameTime,
  );
  hydrated.customers = consumption.customers;
  hydrated.serviceItems = consumption.serviceItems.filter(item =>
    !completedCustomerIds.has(item?.customerId)
      || !['ordered', 'preparing'].includes(item?.state));
  if ('tables' in saved || 'tables' in fresh) {
    hydrated.tables = saved.tables || fresh.tables || [];
  }
  hydrated.restaurant.openHour = normaliseOperatingHour(
    hydrated.restaurant.openHour,
    normaliseOperatingHour(fresh.restaurant.openHour, 10),
  );
  hydrated.restaurant.closeHour = normaliseOperatingHour(
    hydrated.restaurant.closeHour,
    normaliseOperatingHour(fresh.restaurant.closeHour, 22),
  );

  if ('staffSlots' in saved || 'staffSlots' in fresh) {
    hydrated.staffSlots = Math.max(fresh.staffSlots || 0, staff.length, saved.staffSlots || 0);
  }

  if (saved.dishes || fresh.dishes) {
    hydrated.dishes = (saved.dishes || fresh.dishes).map((dish, index) => {
      const fallbackPrice = fresh.dishes?.find(candidate => candidate.id === dish?.id)?.price
        ?? fresh.dishes?.[index]?.price
        ?? 1;
      const price = Number.isFinite(dish?.price) ? dish.price : fallbackPrice;
      return {
        ...dish,
        price: Math.min(100, Math.max(1, Math.round(price))),
      };
    });
  }

  if (saved.equipment || fresh.equipment) {
    hydrated.equipment = (saved.equipment || fresh.equipment).map((equipment, index) => {
      const fallback = fresh.equipment?.find(candidate => candidate.id === equipment?.id)
        || fresh.equipment?.[index]
        || {};
      const level = Number.isInteger(equipment?.level) && equipment.level >= 1
        ? equipment.level
        : (Number.isInteger(fallback.level) && fallback.level >= 1 ? fallback.level : 1);
      return {
        ...fallback,
        ...equipment,
        level,
        ...getEquipmentLevelMultipliers(level),
      };
    });
  }

  // Durable queue-slot leases: structural validation of the saved records, then
  // the same idempotent ownership reconciliation used per tick. Missing leases
  // seed from [] and backfill legal current candidates in logical FIFO order.
  // Malformed records never supply a coordinate and never
  // create an overlapping claim; every logical queue member remains represented
  // (leased or unplaced) rather than dropped.
  const seedQueueSlots = normaliseQueueSlots(
    saved.queueSlots ?? fresh.queueSlots ?? [],
    hydrated,
  );
  hydrated.queueSlots = reconcileQueueSlots(
    { ...hydrated, queueSlots: seedQueueSlots },
    seedQueueSlots,
  );

  const residencies = hydrateMovementResidencies(normaliseDoorAdmissions(hydrated));
  return {
    ...reconcileSelfSeatingState(residencies),
    version: fresh.version,
    movementCoordinator: createMovementCoordinator(),
  };
}
