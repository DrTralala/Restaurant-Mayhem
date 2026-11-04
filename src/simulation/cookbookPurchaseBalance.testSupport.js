import { COOKBOOK_RECIPES, getCookbookRecipe } from '../data/cookbook';
import { EQUIPMENT } from '../data/equipment';
import { WALK_IN_ARCHETYPE_MIX } from '../data/customerArchetypes';
import { createCookbookState, validateCookbookState } from './cookbook';
import { clampDishPrice, getDishPricing } from './dishPricing';
import { chooseAffordableBasket, createSpendingProfile, getMenuAnalysis } from './menuEconomy';

const equipmentCostById = Object.freeze(Object.fromEntries(EQUIPMENT.map(item => [item.id, item.purchaseCost])));
const EQUIPMENT_ENTRY_RECIPE = Object.freeze({
  eq1: 'toast', eq2: 'roast-vegetables', eq3: 'fries', eq4: 'gazpacho',
});

function requireBalanceInput({ equipmentId, reputation, quality, policy }) {
  if (![null, 'eq1', 'eq2', 'eq3', 'eq4'].includes(equipmentId)) {
    throw new Error(`Unsupported cookbook balance equipment id: ${equipmentId}`);
  }
  if (![1, 5].includes(reputation)) throw new Error(`Unsupported balance reputation: ${reputation}`);
  if (![1, 5, 10].includes(quality)) throw new Error(`Unsupported balance quality: ${quality}`);
  if (!['minimum', 'reference', 'maximum'].includes(policy)) {
    throw new Error(`Unsupported cookbook balance price policy: ${policy}`);
  }
}

function policyPrice(cookbookId, quality, policy) {
  const pricing = getDishPricing(cookbookId, quality);
  if (!pricing) throw new Error(`No dish pricing for ${cookbookId} at quality ${quality}`);
  if (policy === 'minimum') return pricing.minPrice;
  if (policy === 'maximum') return pricing.maxPrice;
  return clampDishPrice(cookbookId, quality, pricing.referenceValue);
}

function selectedRecipes(equipmentId) {
  const toast = getCookbookRecipe('toast');
  return equipmentId == null
    ? [toast]
    : [toast, ...COOKBOOK_RECIPES.filter(recipe => recipe.requiredEquipmentId === equipmentId
      && recipe.id !== toast.id)];
}

function freshBalanceState({ equipmentId, reputation, quality, policy }) {
  requireBalanceInput({ equipmentId, reputation, quality, policy });
  const recipes = selectedRecipes(equipmentId);
  const cookbook = createCookbookState();
  const entries = Object.fromEntries(Object.entries(cookbook.entries).map(([id, entry]) => [id, { ...entry,
    menuSettings: { ...entry.menuSettings },
  }]));

  for (const recipe of recipes) {
    const entry = entries[recipe.id];
    entry.discovered = true;
    entry.owned = true;
    entry.paidPortions = 0;
    entry.perk = null;
    entry.menuSettings = {
      ...entry.menuSettings,
      price: policyPrice(recipe.id, quality, policy),
      quality,
    };
    for (const requirement of recipe.requirements) {
      if (requirement.type === 'paidPortions') {
        const parent = entries[requirement.cookbookId];
        if (!parent) throw new Error(`Missing prerequisite recipe ${requirement.cookbookId}`);
        parent.discovered = true;
        parent.owned = true;
        parent.paidPortions = Math.max(parent.paidPortions, requirement.count);
      }
    }
  }

  const equipment = EQUIPMENT.map(item => ({
    ...item,
    owned: item.id === 'eq1' || item.id === equipmentId,
    level: 1,
    speedMultiplier: 1,
    qualityBonus: 0,
  }));
  const dishes = recipes.map(recipe => {
    const { id, requirements: _requirements, purchaseCost: _purchaseCost, ...definition } = recipe;
    const settings = entries[id].menuSettings;
    return {
      ...definition,
      ...settings,
      id: id === 'toast' ? 'starter-toast' : `cookbook:${id}`,
      cookbookId: id,
      masteryPerk: null,
      unlocked: true,
    };
  });
  const state = {
    cookbook: { ...cookbook, entries },
    paidVisitSequence: 0,
    restaurant: { reputation, suspendedDishIds: [], suspendedDrinkIds: [], menuSalesThresholds: [] },
    dishes,
    equipment,
    unlockedDrinkIds: [],
    menuSales: { day: 1, dishes: [], drinks: [] },
  };

  // Required paid-portion predecessors are owned/discovered above; their
  // progress is only advanced enough to make every selected category recipe
  // an attainable, valid save state. No mastery is granted.
  validateCookbookState(state);
  return state;
}

export function createPurchaseBalanceState({ equipmentId, reputation, quality, policy }) {
  return freshBalanceState({ equipmentId, reputation, quality, policy });
}

export function measurePurchaseBalance({ equipmentId, reputation, quality, policy }) {
  const state = createPurchaseBalanceState({ equipmentId, reputation, quality, policy });
  const analysis = getMenuAnalysis(state);
  const matchedToast = equipmentId == null
    ? analysis
    : getMenuAnalysis(createPurchaseBalanceState({ equipmentId: null, reputation, quality, policy }));
  const categoryRecipes = selectedRecipes(equipmentId);
  const recipeMetrics = categoryRecipes.map(recipe => {
    const dish = state.dishes.find(candidate => candidate.cookbookId === recipe.id);
    return {
      cookbookId: recipe.id,
      price: dish.price,
      purchaseCost: recipe.purchaseCost,
      prepTime: recipe.prepTime,
      purchaseRecoveryPortions: recipe.purchaseCost / dish.price,
      grossPerBaseWorkMinute: 60 * dish.price / recipe.prepTime,
    };
  });
  const recipeCosts = categoryRecipes.map(recipe => ({
    cookbookId: recipe.id,
    purchaseCost: recipe.purchaseCost,
  }));
  const equipmentCost = equipmentId == null || equipmentId === 'eq1'
    ? 0 : equipmentCostById[equipmentId];
  const equipmentEntryRecipe = equipmentId == null ? 'toast' : EQUIPMENT_ENTRY_RECIPE[equipmentId];
  const entryRecipeMetric = recipeMetrics.find(metric => metric.cookbookId === equipmentEntryRecipe);
  const dishDemandProbabilities = Object.fromEntries(analysis.demandProbabilities.dishes);

  return {
    equipmentId,
    equipmentCost,
    recipeCosts,
    totalRecipePurchaseCost: recipeCosts.reduce((sum, recipe) => sum + recipe.purchaseCost, 0),
    reputation,
    quality,
    policy,
    expectedGrossPer100: analysis.expectedGrossPer100,
    matchedToastExpectedGrossPer100: matchedToast.expectedGrossPer100,
    incrementalToastGrossPer100: analysis.expectedGrossPer100 - matchedToast.expectedGrossPer100,
    dishDemandProbabilities,
    dishPrices: Object.fromEntries(recipeMetrics.map(metric => [metric.cookbookId, metric.price])),
    recipeMetrics,
    equipmentEntryRecipe,
    equipmentEntryRecoveryPortions: (equipmentCost + entryRecipeMetric.purchaseCost) / entryRecipeMetric.price,
  };
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseWeighted(entries, random) {
  const roll = random();
  let target = roll;
  for (const [value, probability] of entries) {
    if (target < probability) return value;
    target -= probability;
  }
  return entries.at(-1)?.[0];
}

export function samplePurchaseBalanceChoices(state, { sampleCount, seed }) {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 2) {
    throw new Error('Balance sample count must be an integer greater than one');
  }
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Balance sample seed must be a non-negative integer');
  const random = seededRandom(seed);
  const analysis = getMenuAnalysis(state);
  const expectedDemandProbabilities = {
    dishes: Object.fromEntries(analysis.demandProbabilities.dishes),
    drinks: Object.fromEntries(analysis.demandProbabilities.drinks),
  };
  const observedDemandCounts = {
    dishes: Object.fromEntries(Object.keys(expectedDemandProbabilities.dishes).map(id => [id, 0])),
    drinks: Object.fromEntries(Object.keys(expectedDemandProbabilities.drinks).map(id => [id, 0])),
  };
  const outcomeCounts = { ordered: 0, poor_value: 0, unaffordable: 0 };
  let grossSum = 0;
  let grossSquareSum = 0;
  let comboCount = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const spendingProfile = createSpendingProfile(state.restaurant.reputation, random);
    const archetype = chooseWeighted(Object.entries(WALK_IN_ARCHETYPE_MIX), random);
    const outcome = chooseAffordableBasket(state, { ...spendingProfile, archetype }, random);
    if (!Object.prototype.hasOwnProperty.call(outcomeCounts, outcome.menuOutcome)) {
      throw new Error(`Unexpected menu outcome in balance sample: ${outcome.menuOutcome}`);
    }
    outcomeCounts[outcome.menuOutcome] += 1;
    const gross = outcome.menuOutcome === 'ordered' ? outcome.basket.price : 0;
    grossSum += gross;
    grossSquareSum += gross * gross;
    if (outcome.menuOutcome === 'ordered') {
      const { basket } = outcome;
      if (!basket) throw new Error('Ordered balance sample did not contain its selected basket');
      if (basket.dish) observedDemandCounts.dishes[basket.dish.id] += 1;
      if (basket.drink) observedDemandCounts.drinks[basket.drink.id] += 1;
      if (basket.kind === 'dish_drink') {
        if (!basket.dish || !basket.drink) throw new Error('Dish-and-drink balance basket is incomplete');
        comboCount += 1;
      }
    }
  }

  const meanGross = grossSum / sampleCount;
  const grossVariance = Math.max(0,
    (grossSquareSum - sampleCount * meanGross * meanGross) / (sampleCount - 1));
  const grossPer100StandardError = 100 * Math.sqrt(grossVariance / sampleCount);
  return {
    sampleCount,
    seed,
    outcomeCounts,
    comboCount,
    expectedDemandProbabilities,
    observedDemandProbabilities: {
      dishes: Object.fromEntries(Object.entries(observedDemandCounts.dishes)
        .map(([id, count]) => [id, count / sampleCount])),
      drinks: Object.fromEntries(Object.entries(observedDemandCounts.drinks)
        .map(([id, count]) => [id, count / sampleCount])),
    },
    expectedGrossPer100: analysis.expectedGrossPer100,
    observedGrossPer100: meanGross * 100,
    grossPer100StandardError,
  };
}
