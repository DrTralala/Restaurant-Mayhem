const SAVE_KEY = 'restaurant-sim-save';
import { inferGender } from '../canvas/characterAppearance';
import { normaliseDrinkOverrides } from '../data/drinks';
import { getEquipmentLevelMultipliers } from '../data/equipment';
import { normaliseMilestones } from '../data/milestones';
import { getPlaceableDimensions } from '../data/placeables';
import { DEFAULT_OPERATING_HOURS, normaliseOperatingHour } from '../simulation/clock';
import { normaliseConsumptionState } from '../simulation/consumption';
import { isCheckoutState, requeueCheckoutCustomer } from '../simulation/checkout';
import { normaliseCustomerQueue, normaliseQueueDepartures, normaliseQueueSlots, reconcileQueueSlots } from '../simulation/customerQueue';
import { reconcileSelfSeatingState } from '../simulation/selfSeating';
import { clearNavigationGoal, setNavigationGoal } from '../simulation/movement/navigationGoal';
import { createMovementCoordinator } from '../simulation/navigation/coordinator';
import { getCashierCustomerPosition, getCashierWorkPosition } from '../simulation/world';
import { SAVE_VERSION } from './saveVersion';
import { normaliseDoorAdmissions } from './doorAdmissions';
import { hydrateMovementResidencies, movementSaveSnapshot, validateSavedNavigationGeometry } from './movementPersistence';
import { normaliseCustomerEconomy } from '../simulation/menuEconomy';
import { repairInvalidStaffOverlaps, repairInvalidStaffPreparationPositions } from './staffMoves';
import { getCarriedServiceItemIds, getStaffCarryCapacity, withCarriedServiceItemIds } from '../simulation/staffInventory';
import { normaliseServiceItemOwnership } from '../simulation/serviceItems';
import { normaliseCookingBatches } from '../simulation/cookingBatches';
import {
  normalisePartyReviewHistory,
  normalisePendingPartyReviews,
} from '../simulation/partyReviews';
import { validateSavedState } from './saveValidation';
import { allocateStaffPositions } from '../simulation/navigation/staffAllocation';
import { newSpatialIssues, quarantineNavigation } from '../simulation/navigation/occupancy';
import { createDishOrderSnapshot, normaliseCookbookState, validateDishOrderSnapshots } from '../simulation/cookbook';
import { hydrateServiceContractsState, settleServiceContracts } from '../simulation/serviceContracts';
import { evaluateCareerRun, normaliseCareerRun } from '../simulation/careerRun';
import { calculateRevenue } from '../simulation/revenue';

// Boolean outcome lets the provider report unsaved progress without turning a
// storage failure or navigation quarantine into a gameplay/runtime fault.
export function saveState(state) {
  if (state.navigationFault) return false;
  try {
    const serialized = JSON.stringify(movementSaveSnapshot(state));
    localStorage.setItem(SAVE_KEY, serialized);
    return true;
  } catch (e) {
    console.warn('Failed to save state:', e);
    return false;
  }
}

export function loadState() {
  try {
    const serialized = localStorage.getItem(SAVE_KEY);
    if (!serialized) return null;
    const saved = JSON.parse(serialized);
    if (saved?.version !== SAVE_VERSION) return null;
    validateSavedNavigationGeometry(saved);
    validateSavedServiceItemInventory(saved);
    validateSavedState(saved);
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

const CARRIED_SERVICE_ITEM_STATES = new Set(['carried', 'carried_dirty']);

function rawCarriedServiceItemIds(worker) {
  if (Array.isArray(worker?.carryingServiceItemIds)) return worker.carryingServiceItemIds;
  return worker?.carryingServiceItemId == null ? [] : [worker.carryingServiceItemId];
}

function invalidSavedServiceItemInventory(reason) {
  throw new Error(`Invalid saved state: service-item inventory: ${reason}`);
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function samePoint(left, right) {
  return finitePoint(left) && finitePoint(right)
    && left.x === right.x && left.y === right.y;
}

function isValidCashierPaymentPosition(position, station, savedStation) {
  if (!finitePoint(position) || !station) return false;
  if (samePoint(position, getCashierCustomerPosition(station, 0))) return true;
  return savedStation
    && [savedStation.x, savedStation.y, savedStation.w, savedStation.h].every(Number.isFinite)
    && samePoint(position, getCashierCustomerPosition(savedStation, 0));
}

function cashierLineGeometry(station) {
  return station && [station.x, station.y, station.w, station.h].every(Number.isFinite)
    ? {
        stationId: String(station.id),
        x: station.x,
        y: station.y,
        w: station.w,
        h: station.h,
      }
    : null;
}

function sameCashierLineGeometry(left, right) {
  return left?.stationId === right?.stationId
    && left?.x === right?.x
    && left?.y === right?.y
    && left?.w === right?.w
    && left?.h === right?.h;
}

function normaliseCashierStations(stations) {
  if (!Array.isArray(stations)) return stations;
  const dimensions = getPlaceableDimensions('cashierTable');
  return stations.map(station => ({
    ...station,
    w: dimensions.width,
    h: dimensions.height,
  }));
}

function reconcileCashierRoutes(state, savedCashierStations = state.cashierStations) {
  const stations = Array.isArray(state.cashierStations) ? state.cashierStations : [];
  const savedStations = Array.isArray(savedCashierStations) ? savedCashierStations : [];
  const stationById = new Map(stations.map(station => [String(station.id), station]));

  const customers = Array.isArray(state.customers)
    ? state.customers.map(customer => {
      let next = customer;
      const departureStation = stationById.get(String(customer.checkoutDeparture?.stationId));
      const savedDepartureStation = savedStations.find(station =>
        String(station?.id) === String(customer.checkoutDeparture?.stationId));
      if (departureStation
        && isValidCashierPaymentPosition(
          customer.checkoutDeparture?.position, departureStation, savedDepartureStation,
        )) {
        next = {
          ...next,
          checkoutDeparture: {
            stationId: departureStation.id,
            position: getCashierCustomerPosition(departureStation, 0),
          },
        };
      }

      if (!['checkout_moving', 'checkout_processing'].includes(customer.state)) return next;
      const station = stationById.get(String(customer.cashierStationId));
      if (!station) return next;

      if (customer.state === 'checkout_processing') {
        const checkoutPosition = getCashierCustomerPosition(station, 0);
        const processing = clearNavigationGoal({
          ...next,
          // A processing checkout has already passed the arrival gate. Move the
          // saved actor onto the canonical point instead of leaving it stranded
          // at the old 80-wide centre after the station is normalised.
          x: checkoutPosition.x,
          y: checkoutPosition.y,
          checkoutPosition,
        });
        return Object.hasOwn(processing, 'checkoutLineGeometry')
          ? { ...processing, checkoutLineGeometry: null }
          : processing;
      }

      const queueIndex = Number.isInteger(customer.checkoutQueueIndex)
        && customer.checkoutQueueIndex >= 0
        ? customer.checkoutQueueIndex
        : 0;
      const checkoutPosition = getCashierCustomerPosition(station, queueIndex);
      const geometry = cashierLineGeometry(station);
      const geometryChanged = customer.checkoutLineGeometry != null
        && !sameCashierLineGeometry(customer.checkoutLineGeometry, geometry);
      const arrivedAtSlot = finitePoint(customer)
        && Math.hypot(customer.x - checkoutPosition.x, customer.y - checkoutPosition.y) <= 2;
      return setNavigationGoal({
        ...next,
        checkoutPosition,
        checkoutLineGeometry: geometry,
        checkoutLineMember: geometryChanged
          ? false
          : customer.checkoutLineMember === true || arrivedAtSlot,
        paymentReady: false,
      }, checkoutPosition);
    })
    : state.customers;

  const staff = Array.isArray(state.staff)
    ? state.staff.map(worker => {
      const taskStation = worker.task?.type === 'take_payment'
        ? stationById.get(String(worker.task.stationId))
        : null;
      const assignedStation = worker.role === 'waiter'
        ? stations.find(station => sameId(station.assignedStaffId, worker.id))
        : null;
      const station = taskStation || assignedStation;
      if (!station) return worker;
      if (!taskStation && worker.task) return worker;

      const goal = getCashierWorkPosition(station);
      const taskCustomer = taskStation
        ? customers.find(customer => sameId(customer.id, worker.task.customerId)
          && customer.state === 'checkout_processing')
        : null;
      if (taskCustomer) {
        return clearNavigationGoal({ ...worker, x: goal.x, y: goal.y });
      }
      if (taskStation) return setNavigationGoal(worker, goal);
      if (!finitePoint(worker) && !finitePoint(worker.navigationGoal)) return worker;
      if (finitePoint(worker)
        && Math.hypot(worker.x - goal.x, worker.y - goal.y) <= 2) {
        return clearNavigationGoal(worker);
      }
      return setNavigationGoal({ ...worker, activityPhase: 'stationed', idleUntil: null }, goal);
    })
    : state.staff;

  const candidate = { ...state, customers, staff };
  if (!newSpatialIssues(state, candidate).length) return candidate;
  return {
    ...candidate,
    customers: customers.map(customer => {
      const original = (state.customers || []).find(actor => sameId(actor.id, customer.id));
      if (!original || (original.x === customer.x && original.y === customer.y)) return customer;
      return requeueCheckoutCustomer({ ...customer, x: original.x, y: original.y, checkoutDeparture: null });
    }),
    staff: staff.map(worker => {
      const original = (state.staff || []).find(actor => sameId(actor.id, worker.id));
      if (!original || (original.x === worker.x && original.y === worker.y)) return worker;
      const station = stations.find(item => sameId(item.id, worker.task?.stationId))
        || stations.find(item => sameId(item.assignedStaffId, worker.id));
      const restored = { ...worker, x: original.x, y: original.y };
      return station ? setNavigationGoal(restored, getCashierWorkPosition(station)) : clearNavigationGoal(restored);
    }),
  };
}

// Save validation is deliberately narrow: reject contradictory inventory rather
// than silently dropping an item during ownership normalisation. Legitimate
// dish-plus-drink orders remain distinct because the owner key includes kind.
function validateSavedServiceItemInventory(saved) {
  const serviceItems = Array.isArray(saved?.serviceItems) ? saved.serviceItems : null;
  const workers = Array.isArray(saved?.staff) ? saved.staff : null;
  if (!serviceItems && !workers) return;

  const itemsById = new Map();
  const ownerKinds = new Set();
  for (const item of serviceItems || []) {
    if (item?.id == null) invalidSavedServiceItemInventory('service item is missing an ID');
    const itemId = String(item.id);
    if (itemsById.has(itemId)) {
      invalidSavedServiceItemInventory(`duplicate service item ID ${itemId}`);
    }
    itemsById.set(itemId, item);
    if (item.customerId != null && item.kind != null) {
      const ownerKey = `${String(item.customerId)}\u0000${String(item.kind)}`;
      if (ownerKinds.has(ownerKey)) {
        invalidSavedServiceItemInventory(
          `duplicate ${item.kind} item for customer ${item.customerId}`,
        );
      }
      ownerKinds.add(ownerKey);
    }
  }

  const carriedOwners = new Map();
  for (const worker of workers || []) {
    if (Array.isArray(worker?.carryingServiceItemIds)
      && worker.carryingServiceItemId != null) {
      invalidSavedServiceItemInventory(`worker ${worker.id} has conflicting inventory fields`);
    }
    const ids = rawCarriedServiceItemIds(worker);
    const seen = new Set();
    const loadKinds = new Set();
    for (const rawId of ids) {
      if (rawId == null) invalidSavedServiceItemInventory(`worker ${worker.id} has an empty item reference`);
      const itemId = String(rawId);
      if (seen.has(itemId)) {
        invalidSavedServiceItemInventory(`worker ${worker.id} repeats service item ${itemId}`);
      }
      seen.add(itemId);
      const item = itemsById.get(itemId);
      if (!item) invalidSavedServiceItemInventory(`worker ${worker.id} carries missing item ${itemId}`);
      if (!CARRIED_SERVICE_ITEM_STATES.has(item.state)) {
        invalidSavedServiceItemInventory(`worker ${worker.id} carries item ${itemId} in state ${item.state}`);
      }
      if (carriedOwners.has(itemId)) {
        invalidSavedServiceItemInventory(`service item ${itemId} has multiple carriers`);
      }
      carriedOwners.set(itemId, worker.id);
      loadKinds.add(item.state);
    }
    if (loadKinds.size > 1) {
      invalidSavedServiceItemInventory(`worker ${worker.id} mixes clean and dirty items`);
    }
    if (ids.length > getStaffCarryCapacity(worker)) {
      invalidSavedServiceItemInventory(`worker ${worker.id} exceeds carrying capacity`);
    }
  }

}

function getCheckoutDeparture(customer, cashierStations, savedCashierStations) {
  const departureStation = (cashierStations || []).find(candidate =>
    String(candidate?.id) === String(customer.checkoutDeparture?.stationId));
  const savedDepartureStation = (savedCashierStations || []).find(candidate =>
    String(candidate?.id) === String(customer.checkoutDeparture?.stationId));
  if (customer.checkoutDeparture?.stationId != null
    && Number.isFinite(customer.checkoutDeparture.position?.x)
    && Number.isFinite(customer.checkoutDeparture.position?.y)) {
    const position = { ...customer.checkoutDeparture.position };
    return {
      stationId: departureStation?.id ?? customer.checkoutDeparture.stationId,
      position: departureStation
        && isValidCashierPaymentPosition(position, departureStation, savedDepartureStation)
        ? getCashierCustomerPosition(departureStation, 0)
        : position,
    };
  }
  const station = (cashierStations || []).find(candidate =>
    String(candidate?.id) === String(customer.cashierStationId));
  const savedStation = (savedCashierStations || []).find(candidate =>
    String(candidate?.id) === String(customer.cashierStationId));
  const savedPosition = Number.isFinite(customer.checkoutPosition?.x)
    && Number.isFinite(customer.checkoutPosition?.y)
    ? { ...customer.checkoutPosition }
    : null;
  const position = station && isValidCashierPaymentPosition(savedPosition, station, savedStation)
    ? getCashierCustomerPosition(station, 0)
    : savedPosition || (station ? getCashierCustomerPosition(station, 0) : null);
  return station?.id != null && Number.isFinite(position?.x) && Number.isFinite(position?.y)
    ? { stationId: station.id, position: { x: position.x, y: position.y } }
    : null;
}

function finishCompletedCheckout(customer, completedCustomerIds, cashierStations, savedCashierStations) {
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
    checkoutQueueIndex: null,
    checkoutDeparture: getCheckoutDeparture(customer, cashierStations, savedCashierStations),
    checkoutLineMember: false,
    checkoutLineGeometry: null,
    paymentReady: false,
  });
}

function migrateLegacyDishSnapshots(saved) {
  let customers = saved.customers || [];
  let serviceItems = saved.serviceItems || [];
  for (const item of serviceItems) {
    if (item.kind !== 'dish' || Object.hasOwn(item, 'dishOrderSnapshot')) continue;
    const customer = customers.find(actor => actor.id === item.customerId);
    if (!customer || Object.hasOwn(customer, 'dishOrderSnapshot')) continue;
    const dish = (saved.dishes || []).find(candidate => candidate.id === item.menuItemId);
    if (!dish || (customer.dishId !== dish.id && customer.foodOutcome !== 'cancelled')) continue;
    const orderedAt = customer.foodOrderedAt ?? customer.orderTime;
    // Raw saved stats only, before cookbook adoption; never resolve today's perk
    // or fill missing recipe/order facts from the fresh restaurant.
    let snapshot;
    try {
      const price = customer.foodOutcome === 'cancelled' ? dish.price
        : Object.hasOwn(customer, 'dishPriceAtOrder') ? customer.dishPriceAtOrder : dish.price;
      snapshot = createDishOrderSnapshot({ ...dish, price, cookbookId: null, masteryPerk: null },
        { serviceItemId: item.id, orderedAt });
    } catch {
      continue; // Incomplete legacy evidence remains absent, never fake authored history.
    }
    customers = customers.map(actor => actor.id === customer.id ? { ...actor, dishOrderSnapshot: snapshot } : actor);
    serviceItems = serviceItems.map(candidate => candidate.id === item.id ? { ...candidate, dishOrderSnapshot: { ...snapshot } } : candidate);
  }
  const migrated = { ...saved,
    ...(saved.customers ? { customers } : {}), ...(saved.serviceItems ? { serviceItems } : {}),
  };
  validateDishOrderSnapshots(migrated);
  return migrated;
}

export function hydrateState(saved, fresh) {
  // Partial domain fixtures may omit a version; imported saves are version-gated
  // by loadState/Settings before reaching this normalisation boundary.
  if (saved.version != null && saved.version !== SAVE_VERSION) {
    throw new Error('Saved game is incompatible with the current game version');
  }
  validateSavedNavigationGeometry(saved);
  validateSavedServiceItemInventory(saved);
  validateSavedState(saved);
  saved = migrateLegacyDishSnapshots(saved);
  const staff = (saved.staff || fresh.staff || []).map(character => {
    const { navigationYield, ...withoutYield } = character;
    const clean = samePoint(withoutYield.navigationGoal, navigationYield?.goal)
      ? clearNavigationGoal(withoutYield) : withoutYield;
    return {
      ...withCarriedServiceItemIds(clean, getCarriedServiceItemIds(clean)),
      gender: inferGender(clean),
    };
  });
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
  const savedCashierStations = saved.cashierStations ?? fresh.cashierStations;
  const cashierStations = normaliseCashierStations(savedCashierStations);
  const { staffSlots: _savedStaffSlots, ...savedWithoutStaffSlots } = saved;
  const { staffSlots: _freshStaffSlots, ...freshWithoutStaffSlots } = fresh;
  const hasMilestones = 'milestones' in saved || 'milestones' in fresh;
  const hydrated = {
    ...freshWithoutStaffSlots,
    ...savedWithoutStaffSlots,
    restaurant: {
      ...fresh.restaurant,
      ...(saved.restaurant || {}),
    },
    staff,
    ...(Array.isArray(cashierStations) ? { cashierStations } : {}),
    customers: (saved.customers || fresh.customers || []).map(character =>
      finishCompletedCheckout(normaliseCustomerEconomy({
      ...character,
      gender: inferGender(character),
    }), completedCustomerIds, cashierStations, savedCashierStations)),
    queue,
    queueDepartures,
    queueAdmissionGate: saved.queueAdmissionGate ?? fresh.queueAdmissionGate ?? null,
    pendingPartyReviews,
    partyReviewHistory,
    ...(hasMilestones
      ? { milestones: normaliseMilestones(saved.milestones, fresh.milestones || []) }
      : {}),
    drinkOverrides: normaliseDrinkOverrides(saved.drinkOverrides ?? fresh.drinkOverrides),
    floorDirt: Array.isArray(saved.floorDirt) ? saved.floorDirt : fresh.floorDirt,
    washStations: Array.isArray(saved.washStations) ? saved.washStations : fresh.washStations,
  };
  hydrated.paidVisitSequence = saved.paidVisitSequence ?? 0;
  const cookbookSource = { ...hydrated };
  if (!Object.hasOwn(saved, 'cookbook') && Object.hasOwn(saved, 'dishes')) delete cookbookSource.cookbook;
  Object.assign(hydrated, normaliseCookbookState(cookbookSource, {
    lastPaidVisitSequence: hydrated.paidVisitSequence,
  }));
  hydrated.serviceContracts = hydrateServiceContractsState(saved.serviceContracts);
  hydrated.careerRun = normaliseCareerRun(saved.careerRun, {
    gameTime: hydrated.restaurant.gameTime, paidVisitSequence: hydrated.paidVisitSequence,
  }).run;
  if ('completedCustomers' in saved || 'completedCustomers' in fresh) {
    hydrated.completedCustomers = completedCustomers;
  }
  hydrated.movementCoordinator = createMovementCoordinator();
  delete hydrated.navigationPreflight;
  delete hydrated.navigationFault;
  const consumption = normaliseConsumptionState(
    hydrated.customers,
    hydrated.serviceItems || [],
    hydrated.restaurant.gameTime,
  );
  hydrated.customers = consumption.customers;
  hydrated.serviceItems = consumption.serviceItems.filter(item =>
    !completedCustomerIds.has(item?.customerId)
      || !['ordered', 'preparing'].includes(item?.state));
  const ownership = normaliseServiceItemOwnership(hydrated);
  hydrated.customers = ownership.customers;
  hydrated.staff = ownership.staff;
  hydrated.serviceItems = ownership.serviceItems;
  const cooking = normaliseCookingBatches(hydrated);
  hydrated.staff = cooking.staff || hydrated.staff;
  hydrated.serviceItems = cooking.serviceItems || hydrated.serviceItems;
  if (Array.isArray(cooking.cookingBatches)) hydrated.cookingBatches = cooking.cookingBatches;
  if ('tables' in saved || 'tables' in fresh) {
    hydrated.tables = (saved.tables || fresh.tables || []).map(table =>
      table.seats === 2 ? { ...table, seats: 4 } : table);
  }
  const savedRestaurant = saved.restaurant && typeof saved.restaurant === 'object'
    ? saved.restaurant
    : {};
  hydrated.restaurant.openHour = normaliseOperatingHour(
    savedRestaurant.openHour,
    DEFAULT_OPERATING_HOURS.openHour,
  );
  hydrated.restaurant.closeHour = normaliseOperatingHour(
    savedRestaurant.closeHour,
    DEFAULT_OPERATING_HOURS.closeHour,
  );

  if (saved.dishes || fresh.dishes) {
    hydrated.dishes = hydrated.dishes.map((dish, index) => {
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

  const positionedStaff = Array.isArray(hydrated.tables)
    ? allocateStaffPositions(hydrated) : null;
  if (positionedStaff) hydrated.staff = positionedStaff;

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
  const reconciled = reconcileSelfSeatingState(residencies);
  const routed = reconcileCashierRoutes(reconciled, savedCashierStations);
  const repaired = repairInvalidStaffPreparationPositions(repairInvalidStaffOverlaps(routed));
  const seed = normaliseQueueSlots(repaired.queueSlots || [], repaired);
  const finalState = {
    ...repaired,
    queueSlots: reconcileQueueSlots({ ...repaired, queueSlots: seed }, seed),
    version: fresh.version,
    movementCoordinator: createMovementCoordinator(),
  };
  const { navigationFault: _savedFault, navigationPreflight: _savedQueries, ...clean } = finalState;
  // Small partial domain fixtures used by legacy callers do not contain a
  // navigable fixture world; preserve their historical shape rather than
  // manufacturing an unplaced-staff quarantine for missing context.
  let result = Array.isArray(clean.tables) && Array.isArray(clean.doors)
    ? quarantineNavigation(clean) : clean;
  if (result.careerRun?.status === 'active' && result.restaurant.gameTime === result.careerRun.deadlineAt) {
    // Only already-committed monetary/ledger facts may settle on entry. No
    // arrivals, movement, service, payment hook or feature replay occurs here.
    result = calculateRevenue({ ...result, completedCustomers: result.completedCustomers || [] });
    if (result.serviceContracts.active?.deadlineAt <= result.restaurant.gameTime) {
      result = settleServiceContracts(result, result.restaurant.gameTime, { entry: true });
    }
    result = { ...result, careerRun: evaluateCareerRun(result.careerRun, result.restaurant) };
  }
  return result;
}
