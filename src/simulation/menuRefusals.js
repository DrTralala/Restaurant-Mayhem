import { getCurrentMenuDay } from './menuDay';

const MAX_COUNT = Number.MAX_SAFE_INTEGER;

const has = (object, key) => object !== null && typeof object === 'object'
  && Object.prototype.hasOwnProperty.call(object, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isKey = value => typeof value === 'string' && value.length > 0;
const isCount = value => Number.isSafeInteger(value) && value > 0;
const isPrice = value => Number.isInteger(value) && value >= 1 && value <= 100;

function currentDishIds(state) {
  return new Set((Array.isArray(state?.dishes) ? state.dishes : [])
    .filter(dish => isRecord(dish) && isKey(dish.id))
    .map(dish => dish.id));
}

/** Keep only well-formed current-day refusal counts for dishes still on the menu. */
export function normaliseMenuRefusals(value, state) {
  const day = getCurrentMenuDay(state);
  if (!isRecord(value) || !has(value, 'day') || value.day !== day) {
    return { day, dishes: [] };
  }

  const liveDishes = currentDishIds(state);
  const seen = new Set();
  const dishes = [];
  if (Array.isArray(value.dishes)) {
    for (const record of value.dishes) {
      if (!isRecord(record) || !has(record, 'key') || !has(record, 'count')
        || !has(record, 'lastPrice')) continue;
      const { key, count, lastPrice } = record;
      if (!isKey(key) || !isCount(count) || !isPrice(lastPrice)
        || !liveDishes.has(key) || seen.has(key)) continue;
      seen.add(key);
      dishes.push({ key, count, lastPrice });
    }
  }
  return { day, dishes };
}

/** Record one actual poor-value refusal, preserving a dish's latest declined price. */
export function recordMenuRefusal(state, { dishId, price } = {}) {
  const current = normaliseMenuRefusals(state?.menuRefusals, state);
  if (!isKey(dishId) || !isPrice(price) || !currentDishIds(state).has(dishId)) return current;

  let found = false;
  const dishes = current.dishes.map(record => {
    if (record.key !== dishId) return record;
    found = true;
    return { key: dishId, count: Math.min(MAX_COUNT, record.count + 1), lastPrice: price };
  });
  if (!found) dishes.push({ key: dishId, count: 1, lastPrice: price });
  return { day: current.day, dishes };
}

/** Return this live dish's current-day refusal, if any. */
export function getMenuRefusal(state, id) {
  if (!isKey(id) || !currentDishIds(state).has(id)) return null;
  const current = normaliseMenuRefusals(state?.menuRefusals, state);
  return current.dishes.find(record => record.key === id) || null;
}
