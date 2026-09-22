import { COOKBOOK_RECIPES, getCookbookRecipe, MASTERY_PORTION_THRESHOLD } from '../data/cookbook';

const isText = value => typeof value === 'string' && value.trim().length > 0;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCounter = value => Number.isSafeInteger(value) && value >= 0;
const isMoney = value => Number.isFinite(value) && value >= 0;
const isIntegerIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const isPerk = value => value === null || value === 'speed' || value === 'appeal';
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const owned = (state, id) => (state.equipment || []).some(e => e.id === id && e.owned === true);
const identityFields = ['base', 'method', 'cuisine', 'requiredEquipmentId'];
const snapshotFields = ['schemaVersion', 'serviceItemId', 'menuItemId', 'cookbookId', 'orderedAt',
  'name', ...identityFields, 'price', 'quality', 'prepTime', 'popularity', 'masteryPerk'];

function requireValid(condition, message) {
  if (!condition) throw new Error(`Invalid cookbook: ${message}`);
}

function effectiveStats(recipe, perk) {
  return {
    prepTime: perk === 'speed' ? Math.max(1, Math.round(recipe.prepTime * 0.85)) : recipe.prepTime,
    popularity: perk === 'appeal' ? Math.min(100, recipe.popularity + 10) : recipe.popularity,
  };
}

export function createCookbookState(lastAppliedPaidVisitSequence = 0) {
  requireValid(isCounter(lastAppliedPaidVisitSequence), 'paid visit watermark');
  return {
    schemaVersion: 1, lastAppliedPaidVisitSequence,
    entries: Object.fromEntries(COOKBOOK_RECIPES.map(recipe => [recipe.id, {
      discovered: recipe.id === 'toast', paidPortions: 0, perk: null,
      menuSettings: { name: recipe.name, price: recipe.price, quality: 1 },
    }])),
  };
}

function requirementsFor(state, recipe) {
  return recipe.requirements.map(requirement => {
    const isEquipment = requirement.type === 'equipment';
    const id = isEquipment ? requirement.equipmentId : requirement.cookbookId;
    const current = isEquipment ? Number(owned(state, id)) : state.cookbook.entries[id].paidPortions;
    const required = isEquipment ? 1 : requirement.count;
    return { type: requirement.type, id, current, required, met: current >= required };
  });
}

export function reconcileCookbookDiscoveries(state) {
  let cookbook = state.cookbook;
  if (!cookbook) return cookbook;
  for (const recipe of COOKBOOK_RECIPES) {
    const entry = cookbook.entries[recipe.id];
    if (!entry.discovered && requirementsFor(state, recipe).every(requirement => requirement.met)) {
      cookbook = { ...cookbook, entries: { ...cookbook.entries, [recipe.id]: { ...entry, discovered: true } } };
    }
  }
  return cookbook;
}

export function getCookbookEntryStatus(state, cookbookId) {
  const recipe = getCookbookRecipe(cookbookId);
  const entry = state.cookbook?.entries[cookbookId];
  if (!recipe || !entry) return null;
  const activeDishId = (state.dishes || []).find(dish => dish.cookbookId === cookbookId)?.id ?? null;
  const equipmentOwned = owned(state, recipe.requiredEquipmentId);
  return {
    discovered: entry.discovered, requirements: requirementsFor(state, recipe), activeDishId, equipmentOwned,
    stationAvailable: (state.kitchenStations || []).some(station => station.equipmentId === recipe.requiredEquipmentId),
    canAdd: entry.discovered && equipmentOwned && activeDishId === null,
    paidPortions: entry.paidPortions, perk: entry.perk,
    canChoosePerk: entry.discovered && entry.paidPortions === MASTERY_PORTION_THRESHOLD && entry.perk === null,
  };
}

export function validateCookbookState(state) {
  if (!has(state, 'cookbook')) {
    requireValid(!(state.dishes || []).some(dish => dish.cookbookId != null || dish.masteryPerk != null),
      'authored metadata without cookbook');
    return;
  }
  const cookbook = state.cookbook;
  requireValid(isObject(cookbook) && cookbook.schemaVersion === 1, 'schema');
  requireValid(isCounter(cookbook.lastAppliedPaidVisitSequence)
    && isCounter(state.paidVisitSequence ?? 0)
    && cookbook.lastAppliedPaidVisitSequence <= (state.paidVisitSequence ?? 0), 'paid visit watermark');
  requireValid(isObject(cookbook.entries) && Object.keys(cookbook.entries).length === COOKBOOK_RECIPES.length
    && Object.keys(cookbook.entries).every(id => getCookbookRecipe(id)), 'entries');
  for (const recipe of COOKBOOK_RECIPES) {
    const entry = cookbook.entries[recipe.id];
    requireValid(isObject(entry) && typeof entry.discovered === 'boolean'
      && isIntegerIn(entry.paidPortions, 0, MASTERY_PORTION_THRESHOLD) && isPerk(entry.perk), `entry ${recipe.id}`);
    requireValid((entry.paidPortions === 0 || entry.discovered)
      && (entry.perk === null || (entry.discovered && entry.paidPortions === MASTERY_PORTION_THRESHOLD))
      && (recipe.id !== 'toast' || entry.discovered), `progress ${recipe.id}`);
    const settings = entry.menuSettings;
    requireValid(isObject(settings) && isText(settings.name) && isIntegerIn(settings.price, 1, 100)
      && isIntegerIn(settings.quality, 1, 10), `settings ${recipe.id}`);
  }
  const active = new Set();
  for (const dish of state.dishes || []) {
    if (dish.cookbookId == null) continue;
    const recipe = getCookbookRecipe(dish.cookbookId);
    requireValid(recipe && !active.has(recipe.id), 'unknown or duplicate active identity');
    const entry = cookbook.entries[recipe.id];
    requireValid(entry.discovered && isText(dish.id)
      && [...identityFields, 'prepTime', 'popularity'].every(key => dish[key] === recipe[key])
      && ['name', 'price', 'quality'].every(key => dish[key] === entry.menuSettings[key])
      && (dish.masteryPerk == null), `active dish ${recipe.id}`);
    active.add(recipe.id);
  }
}

export function normaliseCookbookState(state, { legacy, lastPaidVisitSequence = 0 } = {}) {
  // Absence alone is the legacy signal. A caller's legacy flag never repairs present corruption.
  if (has(state, 'cookbook')) {
    validateCookbookState({ ...state, paidVisitSequence: state.paidVisitSequence ?? lastPaidVisitSequence });
    return { cookbook: reconcileCookbookDiscoveries(state), dishes: state.dishes };
  }
  void legacy;
  validateCookbookState(state);
  let cookbook = createCookbookState(lastPaidVisitSequence);
  const toast = getCookbookRecipe('toast');
  const dishes = (state.dishes || []).map(dish => {
    if (dish.id !== 'starter-toast' || dish.cookbookId != null
      || !['base', 'method', 'requiredEquipmentId', 'prepTime', 'popularity'].every(key => dish[key] === toast[key])
      || !isText(dish.name) || !Number.isFinite(dish.price) || !isIntegerIn(dish.quality, 1, 10)) return dish;
    const menuSettings = { name: dish.name, price: Math.min(100, Math.max(1, Math.round(dish.price))), quality: dish.quality };
    cookbook = { ...cookbook, entries: { ...cookbook.entries, toast: { ...cookbook.entries.toast, menuSettings } } };
    return { ...dish, ...menuSettings, cuisine: toast.cuisine, cookbookId: 'toast' };
  });
  return { cookbook: reconcileCookbookDiscoveries({ ...state, cookbook, dishes }), dishes };
}

export function getResolvedDish(state, menuItemId) {
  const dish = (state.dishes || []).find(candidate => candidate.id === menuItemId);
  if (!dish) return null;
  if (dish.cookbookId == null) return { ...dish, cookbookId: null, masteryPerk: null };
  const recipe = getCookbookRecipe(dish.cookbookId);
  const entry = state.cookbook?.entries[dish.cookbookId];
  if (!recipe || !entry) return null;
  const { requirements, id, ...base } = recipe;
  return { ...dish, ...base, ...entry.menuSettings, ...effectiveStats(recipe, entry.perk),
    id: dish.id, cookbookId: id, masteryPerk: entry.perk };
}

export function validateDishOrderSnapshot(snapshot) {
  requireValid(isObject(snapshot) && snapshot.schemaVersion === 1, 'dish snapshot schema');
  requireValid(['serviceItemId', 'menuItemId', 'name', 'base', 'method', 'cuisine'].every(key => isText(snapshot[key]))
    && (snapshot.requiredEquipmentId === null || isText(snapshot.requiredEquipmentId))
    && Number.isFinite(snapshot.orderedAt)
    && isIntegerIn(snapshot.price, 1, 100) && isIntegerIn(snapshot.quality, 1, 10)
    && Number.isFinite(snapshot.prepTime) && snapshot.prepTime > 0
    && Number.isFinite(snapshot.popularity) && snapshot.popularity >= 0 && snapshot.popularity <= 100
    && isPerk(snapshot.masteryPerk), 'dish snapshot fields');
  if (snapshot.cookbookId === null) {
    requireValid(snapshot.masteryPerk === null, 'custom snapshot mastery');
  } else {
    const recipe = getCookbookRecipe(snapshot.cookbookId);
    requireValid(recipe && identityFields.every(key => snapshot[key] === recipe[key]), 'snapshot identity');
    const stats = effectiveStats(recipe, snapshot.masteryPerk);
    requireValid(snapshot.prepTime === stats.prepTime && snapshot.popularity === stats.popularity, 'snapshot mastery stats');
  }
}

export function createDishOrderSnapshot(resolvedDish, { serviceItemId, orderedAt }) {
  const snapshot = Object.fromEntries(snapshotFields.map(key => [key, resolvedDish?.[key]]));
  Object.assign(snapshot, { schemaVersion: 1, serviceItemId, orderedAt, menuItemId: resolvedDish?.id });
  validateDishOrderSnapshot(snapshot);
  return snapshot;
}

export function getDishForServiceItem(state, serviceItem) {
  if (serviceItem?.kind !== 'dish') return null;
  if (has(serviceItem, 'dishOrderSnapshot')) {
    const snapshot = serviceItem.dishOrderSnapshot;
    try {
      validateDishOrderSnapshot(snapshot);
      if (snapshot.serviceItemId !== serviceItem.id || snapshot.menuItemId !== serviceItem.menuItemId) return null;
    } catch {
      return null;
    }
    return { ...snapshot, id: snapshot.menuItemId };
  }
  // Partial legacy fixtures must never gain current mastery or authored provenance.
  const raw = (state.dishes || []).find(dish => dish.id === serviceItem.menuItemId);
  return raw ? { ...raw, cookbookId: null, masteryPerk: null } : null;
}

// Parent persistence can use these guards before normalising cooking/service state.
export function validateDishOrderSnapshots(state) {
  const customers = state.customers || [];
  const items = state.serviceItems || [];
  const retainedServiceIds = new Set();
  const sameSnapshot = (a, b) => snapshotFields.every(key => a[key] === b[key]);
  for (const customer of customers) {
    if (!has(customer, 'dishOrderSnapshot')) continue;
    const snapshot = customer.dishOrderSnapshot;
    validateDishOrderSnapshot(snapshot);
    requireValid(!retainedServiceIds.has(snapshot.serviceItemId), 'duplicate snapshot owner');
    retainedServiceIds.add(snapshot.serviceItemId);
    requireValid(customer.dishId === snapshot.menuItemId
      || (customer.dishId == null && customer.foodOutcome === 'cancelled'), 'customer snapshot menu identity');
    if (has(customer, 'dishPriceAtOrder')) {
      requireValid(customer.foodOutcome === 'cancelled' ? customer.dishPriceAtOrder === null
        : customer.dishPriceAtOrder === snapshot.price, 'customer snapshot price');
    }
    const item = items.find(candidate => candidate.id === snapshot.serviceItemId);
    if (item) requireValid(item.customerId === customer.id && item.kind === 'dish'
      && isObject(item.dishOrderSnapshot) && sameSnapshot(snapshot, item.dishOrderSnapshot), 'snapshot owner/copies');
  }
  for (const item of items) {
    if (!has(item, 'dishOrderSnapshot')) continue;
    validateDishOrderSnapshot(item.dishOrderSnapshot);
    requireValid(item.kind === 'dish' && item.id === item.dishOrderSnapshot.serviceItemId
      && item.menuItemId === item.dishOrderSnapshot.menuItemId, 'service item snapshot identity');
    const customer = customers.find(candidate => candidate.id === item.customerId);
    if (customer) requireValid(isObject(customer.dishOrderSnapshot)
      && sameSnapshot(customer.dishOrderSnapshot, item.dishOrderSnapshot), 'snapshot copies');
  }
}

function validPaidVisit(outcome) {
  if (!isObject(outcome) || outcome.schemaVersion !== 1 || !isCounter(outcome.sequence) || outcome.sequence === 0
    || !isText(outcome.customerId) || !isText(outcome.partyId) || !Number.isFinite(outcome.paidAt)
    || ![null, 'ordered'].includes(outcome.menuOutcome)
    || !['delivered', 'cancelled', 'pending', 'none', 'unknown'].includes(outcome.foodOutcome)
    || ![outcome.serviceContractId, outcome.serviceContractGuestId].every(id => id === null || isText(id))
    || ![outcome.subtotal, outcome.tip, outcome.totalPaid].every(isMoney)
    || outcome.totalPaid !== outcome.subtotal + outcome.tip) return false;
  const dish = outcome.dish;
  if (dish === null) return outcome.foodOutcome !== 'delivered';
  if (!isObject(dish) || !(dish.serviceItemId === null || isText(dish.serviceItemId))
    || !isText(dish.menuItemId) || !(dish.cookbookId === null || getCookbookRecipe(dish.cookbookId))
    || !(dish.priceAtOrder === null || isMoney(dish.priceAtOrder))
    || !isMoney(dish.chargedAmount) || dish.chargedAmount > outcome.subtotal
    || typeof dish.fulfilled !== 'boolean' || typeof dish.paid !== 'boolean') return false;
  if (dish.fulfilled !== (outcome.foodOutcome === 'delivered')
    || dish.paid !== (dish.fulfilled && dish.chargedAmount > 0)) return false;
  return outcome.foodOutcome !== 'none'
    && (outcome.foodOutcome !== 'cancelled' || dish.chargedAmount === 0);
}

export function applyCookbookPaidVisit(cookbook, paidVisitOutcome) {
  if (!validPaidVisit(paidVisitOutcome)
    || paidVisitOutcome.sequence <= cookbook.lastAppliedPaidVisitSequence) return cookbook;
  const { dish, sequence, menuOutcome, foodOutcome } = paidVisitOutcome;
  const entry = dish?.cookbookId ? cookbook.entries[dish.cookbookId] : null;
  const eligible = menuOutcome === 'ordered' && foodOutcome === 'delivered'
    && isText(dish?.serviceItemId) && entry?.discovered
    && dish.fulfilled && dish.paid && dish.chargedAmount > 0;
  return {
    ...cookbook, lastAppliedPaidVisitSequence: sequence,
    entries: eligible && entry.paidPortions < MASTERY_PORTION_THRESHOLD
      ? { ...cookbook.entries, [dish.cookbookId]: { ...entry, paidPortions: entry.paidPortions + 1 } }
      : cookbook.entries,
  };
}

function updateEntry(state, cookbookId, changes) {
  return { ...state, cookbook: { ...state.cookbook, entries: {
    ...state.cookbook.entries, [cookbookId]: { ...state.cookbook.entries[cookbookId], ...changes },
  } } };
}

function allocateMenuId(state, cookbookId) {
  const used = new Set((state.dishes || []).map(dish => dish.id));
  for (const holder of [...(state.customers || []), ...(state.serviceItems || [])]) {
    if (holder.dishOrderSnapshot) used.add(holder.dishOrderSnapshot.menuItemId);
  }
  const base = `cookbook:${cookbookId}`;
  let id = base;
  for (let suffix = 2; used.has(id); suffix += 1) id = `${base}:${suffix}`;
  return id;
}

export function reduceCookbookAction(state, action) {
  if (action.type === 'ADD_COOKBOOK_DISH') {
    const status = getCookbookEntryStatus(state, action.cookbookId);
    if (!status?.canAdd) return state;
    const { requirements, id, ...recipe } = getCookbookRecipe(action.cookbookId);
    return { ...state, dishes: [...state.dishes, { ...recipe, ...state.cookbook.entries[id].menuSettings,
      id: allocateMenuId(state, id), cookbookId: id, unlocked: true }] };
  }
  if (action.type === 'CHOOSE_DISH_MASTERY') {
    const status = getCookbookEntryStatus(state, action.cookbookId);
    if (!status?.canChoosePerk || !['speed', 'appeal'].includes(action.perk)) return state;
    return updateEntry(state, action.cookbookId, { perk: action.perk });
  }
  if (!['UPDATE_DISH', 'REMOVE_DISH', 'UPGRADE_DISH_QUALITY'].includes(action.type)) return null;
  const dish = (state.dishes || []).find(candidate => candidate.id === action.id);
  if (dish?.cookbookId == null) return null;
  const entry = state.cookbook?.entries[dish.cookbookId];
  if (!getCookbookRecipe(dish.cookbookId) || !entry) return state;
  if (action.type === 'REMOVE_DISH') {
    return { ...updateEntry(state, dish.cookbookId, { menuSettings: {
      name: dish.name, price: dish.price, quality: dish.quality,
    } }), dishes: state.dishes.filter(candidate => candidate.id !== dish.id) };
  }
  let settings = { ...entry.menuSettings };
  let restaurant = state.restaurant;
  if (action.type === 'UPGRADE_DISH_QUALITY') {
    if (settings.quality >= 10 || !Number.isFinite(restaurant.funds) || restaurant.funds < 50) return state;
    settings.quality += 1;
    restaurant = { ...restaurant, funds: restaurant.funds - 50 };
  } else {
    if (isText(action.changes?.name)) settings.name = action.changes.name.trim();
    if (Number.isFinite(action.changes?.price)) settings.price = Math.max(1, Math.min(100, Math.round(action.changes.price)));
    if (['name', 'price', 'quality'].every(key => settings[key] === entry.menuSettings[key])) return state;
  }
  return { ...updateEntry(state, dish.cookbookId, { menuSettings: settings }), restaurant,
    dishes: state.dishes.map(candidate => candidate.id === dish.id ? { ...candidate, ...settings } : candidate) };
}
