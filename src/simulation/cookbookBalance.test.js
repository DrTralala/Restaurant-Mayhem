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

it('gazpachoTradeOff: rushers prefer Gazpacho while influencers prefer Roast Vegetables at equal price and quality', () => {
  const cookbook = createCookbookState();
  Object.assign(cookbook.entries.gazpacho.menuSettings, { price: 18 });
  Object.assign(cookbook.entries['roast-vegetables'].menuSettings, { price: 18 });
  const state = { cookbook, unlockedDrinkIds: [], dishes: [
    { id: 'gazpacho-dish', cookbookId: 'gazpacho' },
    { id: 'roast-dish', cookbookId: 'roast-vegetables' },
  ] };
  expect(getResolvedDish(state, 'gazpacho-dish')).toMatchObject({ prepTime: 75, popularity: 55, price: 18, quality: 1 });
  expect(getResolvedDish(state, 'roast-dish')).toMatchObject({ prepTime: 150, popularity: 70, price: 18, quality: 1 });
  const weights = archetype => {
    const customer = { archetype, spendingTier: 'value', spendingBudget: 45 };
    const baskets = buildAffordableBaskets(state, customer);
    expect(baskets.map(basket => [basket.kind, basket.price])).toEqual([['dish', 18], ['dish', 18]]);
    return baskets.map(basket => getBasketWeight(basket, customer));
  };
  const [rusherGazpacho, rusherRoast] = weights('rusher');
  const [influencerGazpacho, influencerRoast] = weights('influencer');
  expect(rusherGazpacho).toBeGreaterThan(rusherRoast);
  expect(influencerGazpacho).toBeLessThan(influencerRoast);
});
