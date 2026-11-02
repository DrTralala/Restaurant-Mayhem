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

function blenderPair({ gazpachoPrice = 16, fishBisquePrice = 20,
  gazpachoPerk = null, fishBisquePerk = null } = {}) {
  const cookbook = createCookbookState();
  for (const [id, price, perk] of [
    ['gazpacho', gazpachoPrice, gazpachoPerk],
    ['fish-bisque', fishBisquePrice, fishBisquePerk],
  ]) {
    cookbook.entries[id] = { ...cookbook.entries[id], discovered: true,
      paidPortions: perk ? 15 : 0, perk,
      menuSettings: { ...cookbook.entries[id].menuSettings, price } };
  }
  return { cookbook, unlockedDrinkIds: [], dishes: [
    { id: 'gazpacho-dish', cookbookId: 'gazpacho' },
    { id: 'fish-bisque-dish', cookbookId: 'fish-bisque' },
  ] };
}

function ovenPair({ eggsPrice = 15, roastPrice = 18 } = {}) {
  const cookbook = createCookbookState();
  cookbook.entries['baked-eggs'] = { ...cookbook.entries['baked-eggs'], discovered: true,
    menuSettings: { ...cookbook.entries['baked-eggs'].menuSettings, price: eggsPrice } };
  cookbook.entries['roast-vegetables'] = { ...cookbook.entries['roast-vegetables'], discovered: true,
    menuSettings: { ...cookbook.entries['roast-vegetables'].menuSettings, price: roastPrice } };
  return { cookbook, unlockedDrinkIds: [], dishes: [
    { id: 'baked-eggs-dish', cookbookId: 'baked-eggs' },
    { id: 'roast-vegetables-dish', cookbookId: 'roast-vegetables' },
  ] };
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

it.each([
  ['default prices', 16, 20],
  ['equal $18 prices', 18, 18],
])('blenderTradeOff: %s keeps Gazpacho attractive to rushers and Bisque to influencers', (_label, gazpachoPrice, fishBisquePrice) => {
  const state = blenderPair({ gazpachoPrice, fishBisquePrice });
  const customer = archetype => ({ archetype, spendingTier: 'value', spendingBudget: 45 });
  const baskets = buildAffordableBaskets(state, customer('rusher'));
  expect(baskets.map(basket => [basket.dish.cookbookId, basket.price])).toEqual([
    ['gazpacho', gazpachoPrice], ['fish-bisque', fishBisquePrice],
  ]);
  const gazpacho = baskets.find(basket => basket.dish.cookbookId === 'gazpacho');
  const fishBisque = baskets.find(basket => basket.dish.cookbookId === 'fish-bisque');
  expect(getBasketWeight(gazpacho, customer('rusher')))
    .toBeGreaterThan(getBasketWeight(fishBisque, customer('rusher')));
  expect(getBasketWeight(fishBisque, customer('influencer')))
    .toBeGreaterThan(getBasketWeight(gazpacho, customer('influencer')));
});

it('bakedEggsBudget: Baked Eggs alone is affordable among canonical Oven recipes at budgets $15-17', () => {
  const cookbook = createCookbookState();
  for (const id of ['baked-eggs', 'roast-vegetables', 'baked-potato']) {
    cookbook.entries[id].discovered = true;
  }
  const state = { cookbook, unlockedDrinkIds: [], dishes: [
    { id: 'baked-eggs-dish', cookbookId: 'baked-eggs' },
    { id: 'roast-vegetables-dish', cookbookId: 'roast-vegetables' },
    { id: 'baked-potato-dish', cookbookId: 'baked-potato' },
  ] };
  for (const spendingBudget of [15, 16, 17]) {
    const baskets = buildAffordableBaskets(state, {
      archetype: 'rusher', spendingTier: 'budget', spendingBudget,
    });
    expect(baskets.map(basket => [basket.dish.cookbookId, basket.price]))
      .toEqual([['baked-eggs', 15]]);
  }
});

it.each([
  ['default prices', 15, 18],
  ['equal $18 prices', 18, 18],
])('bakedEggsTradeOff: %s favours rushers but not foodies or influencers', (_label, eggsPrice, roastPrice) => {
  const state = ovenPair({ eggsPrice, roastPrice });
  const weights = archetype => {
    const customer = { archetype, spendingTier: 'value', spendingBudget: 45 };
    const baskets = buildAffordableBaskets(state, customer);
    expect(baskets.map(basket => [basket.dish.cookbookId, basket.price])).toEqual([
      ['baked-eggs', eggsPrice], ['roast-vegetables', roastPrice],
    ]);
    return baskets.map(basket => getBasketWeight(basket, customer));
  };
  const [rusherEggs, rusherRoast] = weights('rusher');
  const [foodieEggs, foodieRoast] = weights('foodie');
  const [influencerEggs, influencerRoast] = weights('influencer');
  expect(rusherEggs).toBeGreaterThan(rusherRoast);
  expect(foodieEggs).toBeLessThan(foodieRoast);
  expect(influencerEggs).toBeLessThan(influencerRoast);
});

it('blenderBudget: Fish Bisque is excluded below $20 and included at its $20 default price', () => {
  const state = blenderPair();
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
      const state = blenderPair({ gazpachoPerk, fishBisquePerk });
      const gazpacho = buildAffordableBaskets(state, {
        archetype: 'regular', spendingTier: 'value', spendingBudget: 45,
      }).find(basket => basket.dish.cookbookId === 'gazpacho');
      const fishBisque = buildAffordableBaskets(state, {
        archetype: 'regular', spendingTier: 'value', spendingBudget: 45,
      }).find(basket => basket.dish.cookbookId === 'fish-bisque');
      expect(gazpacho.dish.prepTime).toBeLessThan(fishBisque.dish.prepTime);
      expect(gazpacho.speed).toBeGreaterThan(fishBisque.speed);
    }
  }
});
