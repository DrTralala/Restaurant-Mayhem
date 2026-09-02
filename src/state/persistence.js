const SAVE_KEY = 'restaurant-sim-save';
import { inferGender } from '../canvas/characterAppearance';
import { normaliseDrinkOverrides } from '../data/drinks';
import { getEquipmentLevelMultipliers } from '../data/equipment';
import { normaliseOperatingHour } from '../simulation/clock';
import { normaliseConsumptionState } from '../simulation/consumption';
import { normaliseCustomerQueue } from '../simulation/customerQueue';
import { normaliseTableReservationOwners } from '../simulation/guidance';
import { normaliseCustomerEconomy } from '../simulation/menuEconomy';
import {
  normalisePartyReviewHistory,
  normalisePendingPartyReviews,
} from '../simulation/partyReviews';

export function saveState(state) {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(SAVE_KEY, serialized);
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

export function loadState() {
  try {
    const serialized = localStorage.getItem(SAVE_KEY);
    if (!serialized) return null;
    return JSON.parse(serialized);
  } catch (e) {
    console.warn('Failed to load state:', e);
    return null;
  }
}

export function hydrateState(saved, fresh) {
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
  const hydrated = {
    ...fresh,
    ...saved,
    restaurant: {
      ...fresh.restaurant,
      ...(saved.restaurant || {}),
    },
    staff,
    customers: (saved.customers || fresh.customers || []).map(character =>
      normaliseCustomerEconomy({
        ...character,
        gender: inferGender(character),
      })),
    queue,
    queueAdmissionGate: saved.queueAdmissionGate ?? fresh.queueAdmissionGate ?? null,
    pendingPartyReviews: normalisePendingPartyReviews(saved.pendingPartyReviews),
    partyReviewHistory: normalisePartyReviewHistory(saved.partyReviewHistory),
    drinkOverrides: normaliseDrinkOverrides(saved.drinkOverrides ?? fresh.drinkOverrides),
    floorDirt: Array.isArray(saved.floorDirt) ? saved.floorDirt : fresh.floorDirt,
    washStations: Array.isArray(saved.washStations) ? saved.washStations : fresh.washStations,
  };
  const consumption = normaliseConsumptionState(
    hydrated.customers,
    hydrated.serviceItems || [],
    hydrated.restaurant.gameTime,
  );
  hydrated.customers = consumption.customers;
  hydrated.serviceItems = consumption.serviceItems;
  if ('tables' in saved || 'tables' in fresh) {
    hydrated.tables = normaliseTableReservationOwners(saved.tables || fresh.tables || [], staff);
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

  return hydrated;
}
