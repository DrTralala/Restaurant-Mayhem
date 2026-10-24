import { getDrink } from '../data/drinks';

const SECONDS_PER_DAY = 86400;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;

const has = (record, key) => record !== null && typeof record === 'object'
  && Object.prototype.hasOwnProperty.call(record, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isKey = value => typeof value === 'string' && value.length > 0;
const isCount = value => Number.isSafeInteger(value) && value >= 0;

function getCurrentDay(state) {
  const day = state?.restaurant?.day;
  if (Number.isSafeInteger(day) && day >= 1) return day;
  const gameTime = state?.restaurant?.gameTime;
  if (Number.isFinite(gameTime) && gameTime >= 0) return Math.floor(gameTime / SECONDS_PER_DAY) + 1;
  return 1;
}

function currentDishIds(state) {
  return new Set((Array.isArray(state?.dishes) ? state.dishes : [])
    .filter(dish => isRecord(dish) && isKey(dish.id))
    .map(dish => dish.id));
}

function normaliseRecords(value, isValidKey) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const records = [];
  for (const record of value) {
    if (!isRecord(record) || !has(record, 'key') || !has(record, 'count')) continue;
    const { key, count } = record;
    if (!isKey(key) || !isCount(count) || !isValidKey(key) || seen.has(key)) continue;
    seen.add(key);
    records.push({ key, count });
  }
  return records;
}

/**
 * Return the current game day's telemetry, bounded by the live menu and the
 * canonical drink catalogue. Missing, stale or malformed values become empty;
 * malformed records and duplicate keys are dropped without summing counts.
 */
export function normaliseMenuSales(value, state) {
  const day = getCurrentDay(state);
  if (!isRecord(value) || !has(value, 'day') || value.day !== day) {
    return { day, dishes: [], drinks: [] };
  }
  const dishIds = currentDishIds(state);
  return {
    day,
    dishes: normaliseRecords(value.dishes, key => dishIds.has(key)),
    drinks: normaliseRecords(value.drinks, key => getDrink(key) !== null),
  };
}

function incrementRecords(records, id, amount, isValidKey) {
  if (!Number.isFinite(amount) || amount <= 0 || !isKey(id) || !isValidKey(id)) return records;
  let found = false;
  const next = records.map(record => {
    if (record.key !== id) return record;
    found = true;
    return { key: id, count: Math.min(MAX_COUNT, record.count + 1) };
  });
  return found ? next : [...records, { key: id, count: 1 }];
}

/** Increment one unit for each positive charged line in the current-day branch. */
export function recordMenuSales(state, { dishId, dishAmount, drinkId, drinkAmount } = {}) {
  const current = normaliseMenuSales(state?.menuSales, state);
  const dishIds = currentDishIds(state);
  const dishes = incrementRecords(current.dishes, dishId, dishAmount,
    key => dishIds.has(key));
  const drinks = incrementRecords(current.drinks, drinkId, drinkAmount,
    key => getDrink(key) !== null);
  if (dishes === current.dishes && drinks === current.drinks) return current;
  return { day: current.day, dishes, drinks };
}

/** Return the current-day count for a menu item, never counting stale or unknown IDs. */
export function getMenuSalesCount(state, kind, id) {
  if ((kind !== 'dish' && kind !== 'drink') || !isKey(id)) return 0;
  const current = normaliseMenuSales(state?.menuSales, state);
  const records = kind === 'dish' ? current.dishes : current.drinks;
  const record = records.find(candidate => candidate.key === id);
  return record ? record.count : 0;
}
