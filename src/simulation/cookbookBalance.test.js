import { expect, it } from 'vitest';
import { getResolvedDish, validateCookbookState } from './cookbook';
import { buildAffordableBaskets, getBasketWeight, getMenuAnalysis } from './menuEconomy';
import { createPurchaseBalanceState } from './cookbookPurchaseBalance.testSupport';

function canonicalState(equipmentId, cookbookIds, mastery = {}) {
  const state = createPurchaseBalanceState({
    equipmentId, reputation: 1, quality: 1, policy: 'reference',
  });
  state.dishes = state.dishes.filter(dish => cookbookIds.includes(dish.cookbookId));
  for (const [cookbookId, perk] of Object.entries(mastery)) {
    const entry = state.cookbook.entries[cookbookId];
    entry.paidPortions = 15;
    entry.perk = perk;
  }
  validateCookbookState(state);
  return state;
}

function basketWeight(state, cookbookId, archetype) {
  const customer = { archetype, spendingTier: 'value', spendingBudget: 45 };
  const basket = buildAffordableBaskets(state, customer)
    .find(candidate => candidate.dish.cookbookId === cookbookId);
  expect(basket).toBeDefined();
  return getBasketWeight(basket, customer);
}

function masteryComparison(archetype, perk) {
  const state = canonicalState('eq1', ['cheese-toast'], { 'cheese-toast': perk });
  const baseline = canonicalState('eq1', ['cheese-toast']);
  const resolved = getResolvedDish(state, 'cookbook:cheese-toast');
  return {
    resolved,
    delta: basketWeight(state, 'cheese-toast', archetype)
      - basketWeight(baseline, 'cheese-toast', archetype),
  };
}

function pairSummary(equipmentId, cookbookIds, archetypes) {
  const state = canonicalState(equipmentId, cookbookIds);
  const analysis = getMenuAnalysis(state);
  const resolved = Object.fromEntries(cookbookIds.map(cookbookId => {
    const dish = state.dishes.find(candidate => candidate.cookbookId === cookbookId);
    return [cookbookId, getResolvedDish(state, dish.id)];
  }));
  const rows = archetypes.map(archetype => {
    const weights = cookbookIds.map(cookbookId => basketWeight(state, cookbookId, archetype));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return { archetype, probabilities: weights.map(weight => weight / total) };
  });
  return { state, analysis, resolved, rows };
}

it('cheese-toast mastery: speed has greater rusher choice weight than appeal in equivalent canonical states', () => {
  const speed = masteryComparison('rusher', 'speed');
  const appeal = masteryComparison('rusher', 'appeal');
  expect(speed.resolved).toMatchObject({ prepTime: 77, popularity: 65 });
  expect(appeal.resolved).toMatchObject({ prepTime: 90, popularity: 75 });
  expect(speed.delta).toBeCloseTo(0.13, 10);
  expect(appeal.delta).toBeCloseTo(0.10, 10);
  expect(speed.delta).toBeGreaterThan(appeal.delta);
});

it('cheese-toast mastery: appeal has greater influencer choice weight than speed in equivalent canonical states', () => {
  const speed = masteryComparison('influencer', 'speed');
  const appeal = masteryComparison('influencer', 'appeal');
  expect(speed.delta).toBeCloseTo(13 / 600, 10);
  expect(appeal.delta).toBeCloseTo(0.60, 10);
  expect(appeal.delta).toBeGreaterThan(speed.delta);
});

it('Gazpacho/Fish Bisque at Q1 reference prices exposes rusher and influencer niches, demand, and throughput', () => {
  const { analysis, resolved, rows } = pairSummary(
    'eq4', ['gazpacho', 'fish-bisque'], ['regular', 'rusher', 'influencer'],
  );
  expect(resolved.gazpacho).toMatchObject({ prepTime: 75, popularity: 55, price: 16, quality: 1 });
  expect(resolved['fish-bisque']).toMatchObject({ prepTime: 135, popularity: 68, price: 20, quality: 1 });
  expect(rows.find(row => row.archetype === 'regular').probabilities[0])
    .toBeGreaterThan(rows.find(row => row.archetype === 'regular').probabilities[1]);
  expect(rows.find(row => row.archetype === 'rusher').probabilities[0])
    .toBeGreaterThan(rows.find(row => row.archetype === 'rusher').probabilities[1]);
  expect(rows.find(row => row.archetype === 'influencer').probabilities[0])
    .toBeLessThan(rows.find(row => row.archetype === 'influencer').probabilities[1]);
  expect(analysis.demandProbabilities.dishes.get('cookbook:gazpacho')).toBeGreaterThan(0);
  expect(analysis.demandProbabilities.dishes.get('cookbook:fish-bisque')).toBeGreaterThan(0);
  expect(60 * resolved.gazpacho.price / resolved.gazpacho.prepTime)
    .toBeGreaterThan(60 * resolved['fish-bisque'].price / resolved['fish-bisque'].prepTime);
});

it('Baked Eggs/Roast Vegetables at Q1 reference prices exposes rusher and influencer niches, demand, and throughput', () => {
  const { analysis, resolved, rows } = pairSummary(
    'eq2', ['baked-eggs', 'roast-vegetables'], ['regular', 'rusher', 'influencer'],
  );
  expect(resolved['baked-eggs']).toMatchObject({ prepTime: 120, popularity: 60, price: 15, quality: 1 });
  expect(resolved['roast-vegetables']).toMatchObject({ prepTime: 150, popularity: 70, price: 18, quality: 1 });
  expect(rows.find(row => row.archetype === 'regular').probabilities[0])
    .toBeGreaterThan(rows.find(row => row.archetype === 'regular').probabilities[1]);
  expect(rows.find(row => row.archetype === 'rusher').probabilities[0])
    .toBeGreaterThan(rows.find(row => row.archetype === 'rusher').probabilities[1]);
  expect(rows.find(row => row.archetype === 'influencer').probabilities[0])
    .toBeLessThan(rows.find(row => row.archetype === 'influencer').probabilities[1]);
  expect(analysis.demandProbabilities.dishes.get('cookbook:baked-eggs')).toBeGreaterThan(0);
  expect(analysis.demandProbabilities.dishes.get('cookbook:roast-vegetables')).toBeGreaterThan(0);
  expect(60 * resolved['baked-eggs'].price / resolved['baked-eggs'].prepTime)
    .toBeGreaterThan(60 * resolved['roast-vegetables'].price / resolved['roast-vegetables'].prepTime);
});

it('Baked Eggs alone is affordable among canonical Oven recipes at budgets $15–17', () => {
  const state = canonicalState('eq2', ['baked-eggs', 'roast-vegetables', 'baked-potato']);
  for (const spendingBudget of [15, 16, 17]) {
    const baskets = buildAffordableBaskets(state, {
      archetype: 'rusher', spendingTier: 'budget', spendingBudget,
    });
    expect(baskets.map(basket => [basket.dish.cookbookId, basket.price]))
      .toEqual([['baked-eggs', 15]]);
  }
});

it('blenderBudget: Fish Bisque is excluded below $20 and included at its Q1 reference price', () => {
  const state = canonicalState('eq4', ['gazpacho', 'fish-bisque']);
  const basketsAt = spendingBudget => buildAffordableBaskets(state, {
    archetype: 'regular', spendingTier: 'budget', spendingBudget,
  });
  for (const spendingBudget of [18, 19]) {
    expect(basketsAt(spendingBudget).some(basket => basket.dish?.cookbookId === 'fish-bisque')).toBe(false);
  }
  expect(basketsAt(20).some(basket => basket.dish?.cookbookId === 'fish-bisque')).toBe(true);
});

it('blenderMasterySpeed: Gazpacho remains faster for every standard mastery pairing', () => {
  for (const gazpachoPerk of [null, 'speed', 'appeal']) {
    for (const fishBisquePerk of [null, 'speed', 'appeal']) {
      const state = canonicalState('eq4', ['gazpacho', 'fish-bisque'], {
        ...(gazpachoPerk ? { gazpacho: gazpachoPerk } : {}),
        ...(fishBisquePerk ? { 'fish-bisque': fishBisquePerk } : {}),
      });
      const gazpacho = getResolvedDish(state, 'cookbook:gazpacho');
      const fishBisque = getResolvedDish(state, 'cookbook:fish-bisque');
      expect(gazpacho.prepTime).toBeLessThan(fishBisque.prepTime);
      expect(60 * gazpacho.price / gazpacho.prepTime).toBeGreaterThan(0);
      expect(60 * fishBisque.price / fishBisque.prepTime).toBeGreaterThan(0);
    }
  }
});
