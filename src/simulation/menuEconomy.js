import { getDrink } from '../data/drinks';
import { clampReputation } from './balance';

export const SPENDING_TIER_RANGES = Object.freeze({
  budget: Object.freeze([6, 18]),
  value: Object.freeze([15, 45]),
  premium: Object.freeze([35, 120]),
});

const MAX_ROLL = 1 - Number.EPSILON;

function boundedRoll(random) {
  const value = Number(typeof random === 'function' ? random() : 0);
  return Number.isFinite(value) ? Math.min(MAX_ROLL, Math.max(0, value)) : 0;
}

export function getSpendingTierProbabilities(reputation) {
  const rating = clampReputation(reputation);
  const rounded = value => Number(value.toFixed(12));
  return {
    budget: rounded(0.70 - 0.1375 * (rating - 1)),
    value: rounded(0.25 + 0.025 * (rating - 1)),
    premium: rounded(0.05 + 0.1125 * (rating - 1)),
  };
}

export function createSpendingProfile(reputation, random = Math.random) {
  const probabilities = getSpendingTierProbabilities(reputation);
  const tierRoll = boundedRoll(random);
  const spendingTier = tierRoll < probabilities.budget
    ? 'budget'
    : tierRoll < probabilities.budget + probabilities.value ? 'value' : 'premium';
  const [minimum, maximum] = SPENDING_TIER_RANGES[spendingTier];
  const spendingBudget = minimum
    + Math.floor(boundedRoll(random) * (maximum - minimum + 1));
  return { spendingTier, spendingBudget };
}

export function hasValidSpendingProfile(customer) {
  const range = SPENDING_TIER_RANGES[customer?.spendingTier];
  return Boolean(range)
    && Number.isInteger(customer?.spendingBudget)
    && customer.spendingBudget >= range[0]
    && customer.spendingBudget <= range[1];
}

export function ensureSpendingProfile(customer, reputation, random = Math.random) {
  return hasValidSpendingProfile(customer)
    ? customer
    : { ...customer, ...createSpendingProfile(reputation, random) };
}

export function normaliseCustomerEconomy(customer) {
  const normalised = { ...customer };
  if (!hasValidSpendingProfile(normalised)) {
    delete normalised.spendingTier;
    delete normalised.spendingBudget;
  }
  if (!['ordered', 'unaffordable'].includes(normalised.menuOutcome)) {
    delete normalised.menuOutcome;
    delete normalised.dishPriceAtOrder;
    delete normalised.drinkPriceAtOrder;
    delete normalised.orderSubtotal;
  } else if (normalised.menuOutcome === 'unaffordable') {
    normalised.dishPriceAtOrder = null;
    normalised.drinkPriceAtOrder = null;
    normalised.orderSubtotal = null;
  } else {
    for (const key of ['dishPriceAtOrder', 'drinkPriceAtOrder']) {
      if (normalised[key] !== null
        && !(Number.isFinite(normalised[key]) && normalised[key] >= 0)) delete normalised[key];
    }
    if (!(Number.isFinite(normalised.orderSubtotal) && normalised.orderSubtotal >= 0)) {
      delete normalised.orderSubtotal;
    }
  }
  return normalised;
}

const ORDER_KIND_WEIGHTS = Object.freeze({ dish: 0.75, dish_drink: 0.20, drink: 0.05 });
const ARCHETYPE_WEIGHTS = Object.freeze({
  regular: Object.freeze({ price: 4, quality: 2, popularity: 2, speed: 1 }),
  foodie: Object.freeze({ price: 2, quality: 5, popularity: 2, speed: 1 }),
  rusher: Object.freeze({ price: 2, quality: 1, popularity: 1, speed: 6 }),
  influencer: Object.freeze({ price: 1, quality: 2, popularity: 6, speed: 1 }),
});
const TIER_PRICE_SENSITIVITY = Object.freeze({ budget: 1.5, value: 1, premium: 0.5 });

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function toBasket(kind, dish = null, drink = null) {
  const items = [dish, drink].filter(Boolean);
  const price = items.reduce((sum, item) => sum + (Number.isFinite(item.price) ? item.price : 0), 0);
  return {
    kind, dish: dish || undefined, drink: drink || undefined, price,
    quality: clamp01(items.reduce((sum, item) => sum + (Number(item.quality) || 0), 0) / items.length / 10),
    popularity: clamp01(items.reduce((sum, item) => sum + (Number(item.popularity) || 0), 0) / items.length / 100),
    speed: clamp01(1 - Math.min(600, Math.max(...items.map(item => Number(item.prepTime) || 600))) / 600),
  };
}

// Task 2 deletes this temporary adapter after adding shared drink resolution.
function resolveDrinkForEconomy(state, drinkId) {
  const drink = getDrink(drinkId);
  if (!drink) return null;
  const override = state?.drinkOverrides?.[drinkId];
  const price = Number.isFinite(override?.price)
    ? Math.min(100, Math.max(1, Math.round(override.price)))
    : drink.price;
  const quality = Number.isFinite(override?.quality)
    ? Math.min(10, Math.max(1, Math.round(override.quality)))
    : drink.quality;
  return { ...drink, price, ...(quality == null ? {} : { quality }) };
}

export function buildAffordableBaskets(state, customer) {
  const budget = Number(customer?.spendingBudget);
  if (!Number.isFinite(budget) || budget < 0) return [];
  const dishes = (state?.dishes || []).filter(dish => Number.isFinite(dish?.price));
  const drinks = (state?.unlockedDrinkIds || [])
    .map(id => resolveDrinkForEconomy(state, id)).filter(Boolean);
  return [
    ...dishes.map(dish => toBasket('dish', dish)),
    ...drinks.map(drink => toBasket('drink', null, drink)),
    ...dishes.flatMap(dish => drinks.map(drink => toBasket('dish_drink', dish, drink))),
  ].filter(basket => basket.price <= budget);
}

export function getBasketWeight(basket, customer) {
  const coefficients = ARCHETYPE_WEIGHTS[customer?.archetype] || ARCHETYPE_WEIGHTS.regular;
  const priceSensitivity = TIER_PRICE_SENSITIVITY[customer?.spendingTier] || 1;
  const budget = Math.max(1, Number(customer?.spendingBudget) || 1);
  const priceFit = clamp01(1 - (Number(basket?.price) || 0) / budget);
  return 0.1
    + coefficients.price * priceSensitivity * priceFit
    + coefficients.quality * clamp01(basket?.quality)
    + coefficients.popularity * clamp01(basket?.popularity)
    + coefficients.speed * clamp01(basket?.speed);
}

function chooseByWeight(entries, getWeight, roll) {
  if (!entries.length) return null;
  const weights = entries.map(entry => Math.max(0, Number(getWeight(entry)) || 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return entries[0];
  let target = clamp01(Number(roll)) * total;
  for (let index = 0; index < entries.length; index += 1) {
    if (target < weights[index]) return entries[index];
    target -= weights[index];
  }
  return entries.at(-1);
}

export function chooseAffordableBasket(state, customer, random = Math.random) {
  const profiledCustomer = ensureSpendingProfile(
    customer,
    state?.restaurant?.reputation,
    random,
  );
  const baskets = buildAffordableBaskets(state, profiledCustomer);
  if (!baskets.length) return { customer: profiledCustomer, basket: null };
  const kinds = Object.keys(ORDER_KIND_WEIGHTS)
    .filter(kind => baskets.some(basket => basket.kind === kind));
  const kind = chooseByWeight(
    kinds,
    candidate => ORDER_KIND_WEIGHTS[candidate],
    boundedRoll(random),
  );
  const candidates = baskets.filter(basket => basket.kind === kind);
  return {
    customer: profiledCustomer,
    basket: chooseByWeight(
      candidates,
      basket => getBasketWeight(basket, profiledCustomer),
      boundedRoll(random),
    ),
  };
}

const ARCHETYPE_MIX = Object.freeze({
  regular: 3 / 6,
  foodie: 1 / 6,
  rusher: 1 / 6,
  influencer: 1 / 6,
});
const REPRESENTATIVE_BUDGET_FRACTIONS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

function basketContains(basket, kind, itemId) {
  return kind === 'dish'
    ? basket.dish?.id === itemId
    : kind === 'drink' && basket.drink?.id === itemId;
}

export function estimateMenuItemDemand(state, kind, itemId) {
  const itemExists = kind === 'dish'
    ? (state?.dishes || []).some(dish => dish?.id === itemId)
    : kind === 'drink'
      && (state?.unlockedDrinkIds || []).includes(itemId)
      && resolveDrinkForEconomy(state, itemId) != null;
  if (!itemExists) return 0;

  const tierMix = getSpendingTierProbabilities(state?.restaurant?.reputation);
  let totalProbability = 0;
  for (const [spendingTier, tierProbability] of Object.entries(tierMix)) {
    const [minimum, maximum] = SPENDING_TIER_RANGES[spendingTier];
    for (const [archetype, archetypeProbability] of Object.entries(ARCHETYPE_MIX)) {
      for (const fraction of REPRESENTATIVE_BUDGET_FRACTIONS) {
        const customer = {
          spendingTier,
          spendingBudget: Math.round(minimum + (maximum - minimum) * fraction),
          archetype,
        };
        const baskets = buildAffordableBaskets(state, customer);
        const kinds = Object.keys(ORDER_KIND_WEIGHTS)
          .filter(candidateKind => baskets.some(basket => basket.kind === candidateKind));
        const kindWeightTotal = kinds.reduce(
          (sum, candidateKind) => sum + ORDER_KIND_WEIGHTS[candidateKind],
          0,
        );
        let profileProbability = 0;
        for (const candidateKind of kinds) {
          const candidates = baskets.filter(basket => basket.kind === candidateKind);
          const basketWeightTotal = candidates.reduce(
            (sum, basket) => sum + getBasketWeight(basket, customer),
            0,
          );
          const containingWeight = candidates
            .filter(basket => basketContains(basket, kind, itemId))
            .reduce((sum, basket) => sum + getBasketWeight(basket, customer), 0);
          if (kindWeightTotal > 0 && basketWeightTotal > 0) {
            profileProbability += ORDER_KIND_WEIGHTS[candidateKind] / kindWeightTotal
              * containingWeight / basketWeightTotal;
          }
        }
        totalProbability += tierProbability * archetypeProbability
          * profileProbability / REPRESENTATIVE_BUDGET_FRACTIONS.length;
      }
    }
  }
  return Math.round(clamp01(totalProbability) * 100);
}
