import { expect, it, vi } from 'vitest';
import { COOKBOOK_RECIPES } from '../data/cookbook';
import { getResolvedDrink } from '../data/drinks';
import { getDishValueAcceptance } from './dishPricing';
import { buildAffordableBaskets, getMenuAnalysis } from './menuEconomy';
import { validateCookbookState } from './cookbook';
import {
  createPurchaseBalanceState,
  measurePurchaseBalance,
  samplePurchaseBalanceChoices,
} from './cookbookPurchaseBalance.testSupport';

const policies = ['minimum', 'reference', 'maximum'];
const equipmentIds = ['eq1', 'eq2', 'eq3', 'eq4'];
const reputations = [1, 5];
const qualities = [1, 5, 10];

function expectDemandMarginalsWithinFiveSE(sample, kind) {
  const expected = sample.expectedDemandProbabilities[kind];
  const observed = sample.observedDemandProbabilities[kind];
  expect(Object.keys(observed).sort()).toEqual(Object.keys(expected).sort());
  for (const [itemId, probability] of Object.entries(expected)) {
    const bound = 5 * Math.sqrt(probability * (1 - probability) / sample.sampleCount) + 0.002;
    expect(Math.abs(observed[itemId] - probability)).toBeLessThanOrEqual(bound);
  }
}

it('fails the low-reputation starter maximum-price directional check if mark-up improves gross or demand', () => {
  const reference = measurePurchaseBalance({
    equipmentId: null, reputation: 1, quality: 1, policy: 'reference',
  });
  const maximum = measurePurchaseBalance({
    equipmentId: null, reputation: 1, quality: 1, policy: 'maximum',
  });

  expect(reference.expectedGrossPer100).toBeCloseTo(812.3076923, 6);
  expect(maximum.expectedGrossPer100).toBeCloseTo(577.6998514, 6);
  expect(maximum.expectedGrossPer100).toBeLessThan(reference.expectedGrossPer100 - 1e-9);
  expect(maximum.dishDemandProbabilities['starter-toast'])
    .toBeLessThan(reference.dishDemandProbabilities['starter-toast']);
});

it('retains a premium markup trade-off in the isolated regular-customer budget-$120 scenario', () => {
  const reference = createPurchaseBalanceState({
    equipmentId: null, reputation: 1, quality: 1, policy: 'reference',
  });
  const maximum = createPurchaseBalanceState({
    equipmentId: null, reputation: 1, quality: 1, policy: 'maximum',
  });
  const customer = { archetype: 'regular', spendingTier: 'premium', spendingBudget: 120 };
  const referenceDish = buildAffordableBaskets(reference, customer)[0].dish;
  const maximumDish = buildAffordableBaskets(maximum, customer)[0].dish;
  const acceptance = getDishValueAcceptance(maximumDish, customer.spendingTier);

  expect(referenceDish.price).toBe(12);
  expect(maximumDish.price).toBe(15);
  expect(acceptance).toBeLessThan(1);
  expect(maximumDish.price * acceptance).toBeGreaterThan(referenceDish.price);
  expect(maximumDish.price * acceptance).toBeCloseTo(14.1861241, 6);
});

it('validates all canonical equipment-category, policy, reputation, and quality fixtures in the 72-row matrix', () => {
  const matrix = [];
  for (const equipmentId of equipmentIds) {
    for (const reputation of reputations) {
      for (const quality of qualities) {
        for (const policy of policies) {
          const state = createPurchaseBalanceState({ equipmentId, reputation, quality, policy });
          expect(() => validateCookbookState(state)).not.toThrow();
          expect(state.dishes.map(dish => dish.cookbookId)).toEqual([
            'toast', ...COOKBOOK_RECIPES.filter(recipe => recipe.requiredEquipmentId === equipmentId
              && recipe.id !== 'toast').map(recipe => recipe.id),
          ]);
          expect(state.dishes.every(dish => dish.quality === quality)).toBe(true);
          expect(state.dishes.every(dish => dish.masteryPerk == null)).toBe(true);
          expect(state.unlockedDrinkIds).toEqual([]);
          expect(state.restaurant.suspendedDishIds).toEqual([]);
          expect(state.restaurant.suspendedDrinkIds).toEqual([]);
          expect(state.restaurant.menuSalesThresholds).toEqual([]);
          expect(state.equipment.every(item => item.level === 1)).toBe(true);
          matrix.push(measurePurchaseBalance({ equipmentId, reputation, quality, policy }));
        }
      }
    }
  }

  const toastBaselines = [];
  for (const reputation of reputations) {
    for (const quality of qualities) {
      for (const policy of policies) {
        const state = createPurchaseBalanceState({ equipmentId: null, reputation, quality, policy });
        expect(() => validateCookbookState(state)).not.toThrow();
        expect(state.dishes).toHaveLength(1);
        toastBaselines.push(measurePurchaseBalance({
          equipmentId: null, reputation, quality, policy,
        }));
      }
    }
  }

  expect(matrix).toHaveLength(72);
  expect(toastBaselines).toHaveLength(18);
  expect(new Set(matrix.map(row => `${row.equipmentId}:${row.reputation}:${row.quality}:${row.policy}`)).size)
    .toBe(72);
  expect(matrix.every(row => Number.isFinite(row.expectedGrossPer100)
    && Number.isFinite(row.incrementalToastGrossPer100))).toBe(true);
});

it('uses canonical entry costs and checks per-recipe recovery, base-work throughput, and equipment-entry recovery arithmetic', () => {
  const expectedEntryRecipe = { eq1: 'toast', eq2: 'roast-vegetables', eq3: 'fries', eq4: 'gazpacho' };
  for (const equipmentId of equipmentIds) {
    const row = measurePurchaseBalance({
      equipmentId, reputation: 1, quality: 1, policy: 'reference',
    });
    const categoryRecipes = COOKBOOK_RECIPES.filter(recipe => recipe.requiredEquipmentId === equipmentId);
    expect(row.recipeCosts.map(recipe => [recipe.cookbookId, recipe.purchaseCost]))
      .toEqual([
        ['toast', 0],
        ...categoryRecipes.filter(recipe => recipe.id !== 'toast')
          .map(recipe => [recipe.id, recipe.purchaseCost]),
      ]);
    expect(row.totalRecipePurchaseCost)
      .toBe(categoryRecipes.reduce((sum, recipe) => sum + recipe.purchaseCost, 0));

    for (const metric of row.recipeMetrics) {
      const recipe = COOKBOOK_RECIPES.find(candidate => candidate.id === metric.cookbookId);
      expect(metric.purchaseRecoveryPortions).toBeCloseTo(recipe.purchaseCost / metric.price, 12);
      expect(metric.grossPerBaseWorkMinute).toBeCloseTo(60 * metric.price / recipe.prepTime, 12);
    }

    const entryRecipe = row.recipeMetrics.find(metric => metric.cookbookId === expectedEntryRecipe[equipmentId]);
    expect(row.equipmentEntryRecoveryPortions).toBeCloseTo(
      (row.equipmentCost + entryRecipe.purchaseCost) / entryRecipe.price, 12,
    );
  }
  const toaster = measurePurchaseBalance({
    equipmentId: 'eq1', reputation: 1, quality: 1, policy: 'reference',
  });
  expect(toaster.equipmentCost).toBe(0);
  expect(toaster.equipmentEntryRecoveryPortions).toBe(0);
});

it('records that the former multi-recipe sample fixture did not contain any unlocked drink', () => {
  const formerComboState = createPurchaseBalanceState({
    equipmentId: 'eq4', reputation: 1, quality: 1, policy: 'maximum',
  });
  const analysis = getMenuAnalysis(formerComboState);
  const baskets = buildAffordableBaskets(formerComboState, {
    archetype: 'regular', spendingTier: 'premium', spendingBudget: 120,
  });

  expect(formerComboState.unlockedDrinkIds).toEqual([]);
  expect(analysis.demandProbabilities.drinks.size).toBe(0);
  expect(baskets.some(basket => basket.kind === 'dish_drink')).toBe(false);
});

it.each([
  ['one dish, no drinks', null, 11],
  ['multi-recipe menu, no drinks', 'eq4', 13],
])('matches seeded 50,000-arrival runtime samples to analytical %s gross and dish demand',
  (_label, equipmentId, seed) => {
    const state = createPurchaseBalanceState({
      equipmentId, reputation: 1, quality: 1, policy: 'maximum',
    });
    const unseededRandom = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('balance sampling must only consume the fixed test seed');
    });
    let sample;
    try {
      sample = samplePurchaseBalanceChoices(state, { sampleCount: 50_000, seed });
    } finally {
      unseededRandom.mockRestore();
    }
    const expectedOrderProbability = Object.values(sample.expectedDemandProbabilities.dishes)
      .reduce((sum, probability) => sum + probability, 0);
    const observedOrderProbability = Object.values(sample.observedDemandProbabilities.dishes)
      .reduce((sum, probability) => sum + probability, 0);
    const probabilityBound = 5 * Math.sqrt(
      expectedOrderProbability * (1 - expectedOrderProbability) / sample.sampleCount,
    ) + 0.002;
    const grossBound = 5 * sample.grossPer100StandardError + 1e-9;

    expect(sample.sampleCount).toBe(50_000);
    expect(sample.comboCount).toBe(0);
    expect(sample.outcomeCounts.ordered + sample.outcomeCounts.poor_value
      + sample.outcomeCounts.unaffordable).toBe(50_000);
    expect(sample.outcomeCounts.poor_value).toBeGreaterThan(0);
    expect(sample.outcomeCounts.unaffordable).toBeGreaterThan(0);
    expect(sample.expectedDemandProbabilities.drinks).toEqual({});
    expectDemandMarginalsWithinFiveSE(sample, 'dishes');
    expect(Math.abs(observedOrderProbability - expectedOrderProbability))
      .toBeLessThanOrEqual(probabilityBound);
    expect(Math.abs(sample.observedGrossPer100 - sample.expectedGrossPer100))
      .toBeLessThanOrEqual(grossBound);
  });

it('matches seeded 50,000-arrival canonical meal-and-drink choices to analytical gross and per-item demand', () => {
  const noDrinkMenu = createPurchaseBalanceState({
    equipmentId: 'eq4', reputation: 1, quality: 1, policy: 'maximum',
  });
  const state = { ...noDrinkMenu, unlockedDrinkIds: ['water'], drinkOverrides: {} };
  const premiumCustomer = { archetype: 'regular', spendingTier: 'premium', spendingBudget: 120 };
  const affordableBaskets = buildAffordableBaskets(state, premiumCustomer);
  const analysis = getMenuAnalysis(state);

  expect(getResolvedDrink(state, 'water')).toMatchObject({ id: 'water', price: 2 });
  expect(affordableBaskets.some(basket => basket.kind === 'dish_drink'
    && basket.dish && basket.drink?.id === 'water')).toBe(true);
  expect(analysis.demandProbabilities.drinks.get('water')).toBeGreaterThan(0);

  const unseededRandom = vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('balance sampling must only consume the fixed test seed');
  });
  let sample;
  try {
    sample = samplePurchaseBalanceChoices(state, { sampleCount: 50_000, seed: 17 });
  } finally {
    unseededRandom.mockRestore();
  }
  const grossBound = 5 * sample.grossPer100StandardError + 1e-9;

  expect(sample.sampleCount).toBe(50_000);
  expect(sample.outcomeCounts.ordered + sample.outcomeCounts.poor_value
    + sample.outcomeCounts.unaffordable).toBe(50_000);
  expect(sample.comboCount).toBeGreaterThan(0);
  expect(sample.comboCount).toBeLessThanOrEqual(sample.outcomeCounts.ordered);
  // Check dish and drink marginals independently. A dish_drink basket counts
  // once in each matching item marginal, but is never summed as two orders.
  expectDemandMarginalsWithinFiveSE(sample, 'dishes');
  expectDemandMarginalsWithinFiveSE(sample, 'drinks');
  expect(Math.abs(sample.observedGrossPer100 - sample.expectedGrossPer100))
    .toBeLessThanOrEqual(grossBound);
});
