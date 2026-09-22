import { expect, it } from 'vitest';
import { createCookbookState, getResolvedDish } from './cookbook';
import { buildAffordableBaskets, getBasketWeight } from './menuEconomy';

function comparison(archetype, perk) {
  const cookbook = createCookbookState();
  Object.assign(cookbook.entries['cheese-toast'], { discovered: true, paidPortions: 15, perk });
  const state = { cookbook, dishes: [{ id: 'cheese', cookbookId: 'cheese-toast' }], unlockedDrinkIds: [] };
  const resolved = getResolvedDish(state, 'cheese');
  // Feed the real basket builder resolved values until parent wires its resolution step.
  // The competitor is identical, unmastered Cheese Toast with independent custom identity.
  const competitor = { ...resolved, id: 'competitor', cookbookId: null, masteryPerk: null, prepTime: 90, popularity: 65 };
  const customer = { archetype, spendingTier: 'value', spendingBudget: 45 };
  const baskets = buildAffordableBaskets({ ...state, dishes: [resolved, competitor] }, customer);
  expect(baskets).toHaveLength(2);
  expect(baskets.map(basket => [basket.kind, basket.price])).toEqual([['dish', 14], ['dish', 14]]);
  const weights = baskets.map(basket => getBasketWeight(basket, customer));
  return { resolved, delta: weights[0] - weights[1], probability: weights[0] / (weights[0] + weights[1]) };
}

it('cheeseToastRusherChoice: speed has higher normalised probability than appeal', () => {
  const speed = comparison('rusher', 'speed');
  const appeal = comparison('rusher', 'appeal');
  expect(speed.resolved).toMatchObject({ prepTime: 77, popularity: 65 });
  expect(appeal.resolved).toMatchObject({ prepTime: 90, popularity: 75 });
  expect(speed.delta).toBeCloseTo(0.13, 10);
  expect(appeal.delta).toBeCloseTo(0.10, 10);
  expect(speed.probability).toBeGreaterThan(appeal.probability);
});

it('cheeseToastInfluencerChoice: appeal has higher normalised probability than speed', () => {
  const speed = comparison('influencer', 'speed');
  const appeal = comparison('influencer', 'appeal');
  expect(speed.delta).toBeCloseTo(13 / 600, 10);
  expect(appeal.delta).toBeCloseTo(0.60, 10);
  expect(appeal.probability).toBeGreaterThan(speed.probability);
});
