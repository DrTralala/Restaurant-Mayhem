import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/initialState';
import { createCookbookState } from './cookbook';
import { recordSeatResidency } from './movement/seatedDeparture';
import { runTick } from './gameLoop';
import { seededRandom } from './realServiceHarness.testSupport';
import {
  createCustomerOrder,
  expireFoodPatience,
  hasValidDrinkReservation,
  normaliseServiceItemOwnership,
} from './serviceItems';
import { buildAffordableBaskets, getBasketWeight } from './menuEconomy';
import { resolveStaffAfterMovement, updateStaff } from './staff';
import { getStaffTaskDuration } from './staffPerformance';
import { advanceConsumption } from './consumption';
import { withOwnedAuthoredDishes } from './menuTestFixtures';

afterEach(() => vi.restoreAllMocks());

const ARCHETYPES = {
  regular: { price: 4, quality: 2, popularity: 2, speed: 1 },
  foodie: { price: 2, quality: 5, popularity: 2, speed: 1 },
  rusher: { price: 2, quality: 1, popularity: 1, speed: 6 },
  influencer: { price: 1, quality: 2, popularity: 6, speed: 1 },
};
const TIERS = [
  { spendingTier: 'budget', spendingBudget: 12, priceSensitivity: 1.5 },
  { spendingTier: 'value', spendingBudget: 30, priceSensitivity: 1 },
  { spendingTier: 'premium', spendingBudget: 80, priceSensitivity: 0.5 },
];

function referenceWeight(basket, customer) {
  const items = [basket.dish, basket.drink].filter(Boolean);
  const price = items.reduce((sum, item) => sum + item.price, 0);
  const quality = items.reduce((sum, item) => sum + item.quality, 0) / items.length / 10;
  const popularity = items.reduce((sum, item) => sum + item.popularity, 0) / items.length / 100;
  const slowest = Math.max(...items.map(item => item.prepTime));
  const speed = 1 - Math.min(600, Math.max(0, slowest)) / 600;
  const weights = ARCHETYPES[customer.archetype];
  const priceFit = Math.min(1, Math.max(0, 1 - price / customer.spendingBudget));
  return 0.1
    + weights.price * customer.priceSensitivity * priceFit
    + weights.quality * quality
    + weights.popularity * popularity
    + weights.speed * speed;
}

function menuState({ dishes = [], drinkOverrides = {}, unlockedDrinkIds = ['juice', 'premium-lemonade'],
  cookbook = createCookbookState() } = {}) {
  return { restaurant: { reputation: 3 }, dishes, unlockedDrinkIds, drinkOverrides, cookbook };
}

function bakedPotatoEntry() {
  const menu = withOwnedAuthoredDishes({
    cookbook: createCookbookState(), dishes: [],
  }, [{ id: 'baked-potato', cookbookId: 'baked-potato', price: 22, quality: 1 }]);
  return { dish: menu.dishes[0], cookbook: menu.cookbook };
}

function bakedPotatoMenuState(overrides = {}) {
  const bakedPotato = bakedPotatoEntry();
  return menuState({
    ...overrides,
    dishes: [bakedPotato.dish],
    cookbook: bakedPotato.cookbook,
  });
}

function preparingDrink({ drinkId = 'premium-lemonade', gameTime = 0, morale = 50,
  accumulatedWork = 0, lastProgressAt = 0, dispenserPresent = true } = {}) {
  const initial = createInitialState();
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime },
    tables: [], chairs: [], doors: [], cashierStations: [], washStations: [],
    customers: [{ id: 'guest', state: 'waiting_for_items', tableId: 't1', drinkId }],
    queue: [], queueSlots: [], queueDepartures: [], cookingBatches: [], floorDirt: [],
    kitchenStations: dispenserPresent
      ? [{ id: 'dispenser', equipmentId: null, x: 100, y: 100 }]
      : [],
    serviceTables: [{ id: 'st1', x: 300, y: 120 }],
    serviceItems: [{
      id: 'drink', kind: 'drink', menuItemId: drinkId, customerId: 'guest', tableId: 't1',
      state: 'preparing', stationId: 'dispenser', serviceTableId: 'st1', serviceSlotIndex: 0,
      assignedStaffId: 'cook', preparationStartedAt: 0, accumulatedWork, lastProgressAt,
    }],
    staff: [{
      id: 'cook', role: 'cook', morale, x: 90, y: 110,
      task: {
        type: 'prepare_drink', serviceItemId: 'drink', stationId: 'dispenser',
        serviceTableId: 'st1', serviceSlotIndex: 0,
      },
    }],
  };
}

const BASE_TIME = 36_000;

function orderDrink(drinkId, arrival, includeDish = false) {
  const initial = createInitialState();
  const menu = includeDish
    ? withOwnedAuthoredDishes(initial, [{
      id: 'toast', cookbookId: 'toast', name: 'Toasted Bread', price: 9, quality: 1,
    }])
    : { ...initial, dishes: [] };
  const dishes = menu.dishes;
  const customer = {
    id: `guest-${arrival}`, partyId: `party-${arrival}`, tableId: 't1', state: 'seated',
    archetype: 'regular', happiness: 80, spendingTier: 'value', spendingBudget: 45,
  };
  const rolls = includeDish ? [0.8, 0.99] : [0.99, 0.99];
  const order = createCustomerOrder({
    ...menu,
    restaurant: { ...menu.restaurant, gameTime: BASE_TIME + arrival, reputation: 3 },
    dishes, unlockedDrinkIds: [drinkId], drinkOverrides: {}, serviceItems: [], customers: [],
  }, customer, () => rolls.shift() ?? 0.99);
  return { ...order, dishes, cookbook: menu.cookbook };
}

function cashierReady(state) {
  const customer = state.customers[0];
  const now = state.restaurant.gameTime;
  return {
    ...state,
    cashierStations: [{ id: 'cashier', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier-worker' }],
    staff: [{
      id: 'cashier-worker', role: 'waiter', morale: 50, x: 840, y: 100,
      task: { type: 'take_payment', customerId: customer.id, stationId: 'cashier', startedAt: now - 60 },
    }],
    customers: [{
      ...customer, state: 'checkout_processing', cashierStationId: 'cashier',
      x: 840, y: 180, paymentReady: false, tableId: null,
    }],
  };
}

// Narrow payment fixture: it exercises real preparation completion and staff
// delivery/payment functions, but deliberately supplies carried/cashier-ready
// stages. Only runLiveDrinkScenario below is end-to-end scheduler evidence.
function prepareDeliverAndPayDrink(drinkId, arrival, start, includeDish = false) {
  const initial = createInitialState();
  const order = orderDrink(drinkId, arrival, includeDish);
  const item = order.serviceItems.find(candidate => candidate.kind === 'drink');
  const cook = {
    id: 'cook', role: 'cook', morale: 50, x: 90, y: 110,
    task: {
      type: 'prepare_drink', serviceItemId: item.id, stationId: 'dispenser',
      serviceTableId: 'st1', serviceSlotIndex: 0,
    },
  };
  const preparationState = {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: BASE_TIME + start },
    dishes: order.dishes,
    cookbook: order.cookbook,
    unlockedDrinkIds: [drinkId],
    kitchenStations: [{ id: 'dispenser', equipmentId: null, x: 100, y: 100 }],
    serviceTables: [{ id: 'st1', x: 300, y: 120 }],
    tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    customers: [order.customer],
    serviceItems: order.serviceItems.map(candidate => candidate.id === item.id
      ? {
        ...candidate, state: 'preparing', stationId: 'dispenser', serviceTableId: 'st1',
        serviceSlotIndex: 0, assignedStaffId: 'cook', preparationStartedAt: BASE_TIME + start,
        accumulatedWork: 0, lastProgressAt: BASE_TIME + start,
      }
      : candidate),
    staff: [cook],
  };
  const duration = getStaffTaskDuration(preparationState, cook);
  const prepared = resolveStaffAfterMovement({
    ...preparationState,
    restaurant: { ...preparationState.restaurant, gameTime: BASE_TIME + start + duration },
  }, 0);
  const completedPreparation = prepared.serviceItems.find(candidate => candidate.id === item.id);
  const carriedItems = prepared.serviceItems.filter(candidate => candidate.customerId === order.customer.id
    && ['dish', 'drink'].includes(candidate.kind));
  const carriedIds = carriedItems.map(candidate => candidate.id);
  const firstDeliveryItem = includeDish
    ? carriedItems.find(candidate => candidate.kind === 'dish')
    : item;
  const waiter = {
    id: 'delivery-waiter', role: 'waiter', morale: 50, skill: includeDish ? 5 : 1,
    x: 180, y: 220, carryingServiceItemIds: carriedIds,
    task: {
      type: 'deliver_service_item', serviceItemId: firstDeliveryItem.id,
      customerId: order.customer.id,
    },
  };
  let delivered = updateStaff({
    ...prepared,
    tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    staff: [waiter],
    serviceItems: prepared.serviceItems.map(candidate => carriedIds.includes(candidate.id)
      ? { ...candidate, state: 'carried', assignedStaffId: waiter.id, stationId: null, x: waiter.x, y: waiter.y }
      : candidate),
  }, 0);
  if (includeDish) delivered = updateStaff(delivered, 0);
  const consumed = advanceConsumption({
    ...delivered,
    restaurant: { ...delivered.restaurant, gameTime: BASE_TIME + start + duration + 180 },
  });
  const paid = updateStaff(cashierReady(consumed), 0);
  return {
    duration,
    preparedWork: duration,
    preparationCompleted: completedPreparation?.state === 'carried',
    delivered: carriedIds.every(id => delivered.serviceItems
      .find(candidate => candidate.id === id)?.state === 'delivered'),
    menuSubtotal: order.customer.orderSubtotal,
    customer: order.customer,
    paid,
    waitSeconds: start - arrival,
  };
}

function createLiveScenarioState(drinkId, includeDish = false) {
  const initial = createInitialState();
  const staffIds = new Set([
    'starter-cook', 'starter-waiter', 'starter-cashier-waiter', 'starter-janitor',
  ]);
  return {
    ...initial,
    restaurant: {
      ...initial.restaurant, gameTime: BASE_TIME, funds: 600, dailyRevenue: 0,
      reputation: 3, walkInsPaused: true,
    },
    dishes: includeDish ? initial.dishes : [],
    unlockedDrinkIds: [drinkId],
    drinkOverrides: {},
    customers: [],
    serviceItems: [],
    queue: [],
    queueSlots: [],
    queueDepartures: [],
    queueAdmissionGate: null,
    staff: initial.staff.filter(worker => staffIds.has(worker.id)).map(worker => ({
      ...worker, morale: 50, task: null, carryingServiceItemIds: [],
    })),
  };
}

function injectLiveDrinkOrder(state, drinkId, orderIndex, includeDish = false) {
  const table = state.tables[orderIndex];
  const chair = state.chairs.find(candidate => candidate.tableId === table.id);
  const customerId = `live-${drinkId}-${orderIndex + 1}`;
  const partyId = `party-${customerId}`;
  const customer = {
    id: customerId, partyId, partySize: 1, partyType: 'solo', archetype: 'regular',
    gender: 'female', patience: 5000, patienceMax: 5000, happiness: 80,
    state: 'seated', dishId: null, drinkId: null, tableId: table.id, chairId: chair.id,
    x: chair.x + 10, y: chair.y + 10, dirtFactor: 0,
    spendingTier: 'value', spendingBudget: 45,
  };
  const seatedCustomer = { ...customer, ...recordSeatResidency(customer, chair, table) };
  const occupiedTables = state.tables.map(candidate => candidate.id === table.id
    ? { ...candidate, status: 'occupied', diningPartyId: partyId, diningCustomerIds: [customerId] }
    : candidate);
  const orderState = {
    ...state,
    tables: occupiedTables,
    customers: [...state.customers, seatedCustomer],
  };
  const rolls = includeDish ? [0.8, 0.5] : [0.5, 0.5];
  const order = createCustomerOrder(orderState, seatedCustomer, () => rolls.shift() ?? 0.5);
  const ordered = {
    ...orderState,
    customers: orderState.customers.map(candidate => candidate.id === customerId
      ? order.customer : candidate),
    serviceItems: order.serviceItems,
  };
  const items = order.serviceItems.filter(item => item.customerId === customerId).map(item => ({
    serviceItemId: item.id,
    kind: item.kind,
    menuItemId: item.menuItemId,
    preparationStartedAt: null,
    preparationCompletedAt: null,
    deliveredAt: null,
  }));
  return {
    state: ordered,
    order: {
      customerId, dishId: order.customer.dishId, drinkId: order.customer.drinkId,
      dishPriceAtOrder: order.customer.dishPriceAtOrder,
      drinkPriceAtOrder: order.customer.drinkPriceAtOrder,
      orderSubtotal: order.customer.orderSubtotal,
      dishOrderSnapshot: order.customer.dishOrderSnapshot ?? null,
      items,
      arrivalAt: ordered.restaurant.gameTime,
      deliveredAt: null, paidAt: null, abandonedAt: null, receipt: null,
    },
  };
}

function menuSalesGross(state, kind, itemId) {
  const rows = kind === 'dish' ? state.menuSales?.dishes : state.menuSales?.drinks;
  return rows?.find(item => item.key === itemId)?.gross ?? 0;
}

function roundMoney(amount) {
  return Math.round(amount * 100) / 100;
}

function observeLiveScenario(previous, state, orders, drinkId) {
  const now = state.restaurant.gameTime;
  for (const order of orders) {
    const customer = state.customers.find(candidate => candidate.id === order.customerId);
    for (const service of order.items) {
      const item = state.serviceItems.find(candidate => candidate.id === service.serviceItemId);
      if (item?.state === 'preparing' && service.preparationStartedAt == null) {
        service.preparationStartedAt = item.preparationStartedAt;
      }
      if (['ready', 'carried', 'on_service', 'delivered', 'dirty_at_table'].includes(item?.state)
        && service.preparationCompletedAt == null) service.preparationCompletedAt = now;
      if (item?.state === 'delivered' && service.deliveredAt == null) service.deliveredAt = now;
    }
    if (order.items.every(item => item.deliveredAt != null) && order.deliveredAt == null) {
      order.deliveredAt = Math.max(...order.items.map(item => item.deliveredAt));
    }
    if (customer?.paidVisitSequence != null && order.paidAt == null) {
      order.paidAt = now;
      order.paidOrderFacts = {
        dishId: customer.dishId,
        drinkId: customer.drinkId,
        dishPriceAtOrder: customer.dishPriceAtOrder,
        drinkPriceAtOrder: customer.drinkPriceAtOrder,
        orderSubtotal: customer.orderSubtotal,
        dishOrderSnapshot: customer.dishOrderSnapshot ?? null,
        orderedServiceItemIds: customer.orderedServiceItemIds,
      };
    }
    if (customer?.state === 'leaving' && customer.paidVisitSequence == null
      && order.abandonedAt == null) order.abandonedAt = now;
  }

  const paidVisitDelta = state.paidVisitSequence - previous.paidVisitSequence;
  if (paidVisitDelta > 0) {
    const paidCustomer = state.customers.find(customer => customer.paidVisitSequence > previous.paidVisitSequence);
    const order = orders.find(candidate => candidate.customerId === paidCustomer?.id);
    if (order) {
      const totalPaid = roundMoney(state.restaurant.dailyRevenue - previous.restaurant.dailyRevenue);
      const menuCharge = roundMoney(order.items.reduce((sum, item) => sum
        + menuSalesGross(state, item.kind, item.menuItemId)
        - menuSalesGross(previous, item.kind, item.menuItemId), 0));
      order.paidAt ??= now;
      order.receipt = {
        customerId: order.customerId,
        paidVisitSequence: paidCustomer.paidVisitSequence,
        paidAt: order.paidAt,
        menuCharge,
        tip: roundMoney(totalPaid - menuCharge),
        totalPaid,
      };
    }
  }
}

function runLiveDrinkScenario(drinkId, arrivals, { includeDish = false, horizonAfterLastArrival = 3600 } = {}) {
  vi.spyOn(Math, 'random').mockImplementation(seededRandom(20261030));
  let state = createLiveScenarioState(drinkId, includeDish);
  const orders = [];
  let nextArrival = 0;
  const horizon = arrivals.at(-1) + horizonAfterLastArrival;

  for (let tick = 0; tick <= horizon; tick += 1) {
    const elapsed = state.restaurant.gameTime - BASE_TIME;
    while (nextArrival < arrivals.length && arrivals[nextArrival] === elapsed) {
      const injected = injectLiveDrinkOrder(state, drinkId, nextArrival, includeDish);
      state = injected.state;
      orders.push(injected.order);
      nextArrival += 1;
    }
    const previous = state;
    state = runTick(state, { gameDt: 1, movementDt: 1 / 60 });
    observeLiveScenario(previous, state, orders, drinkId);

    const allResolved = nextArrival === arrivals.length
      && orders.every(order => order.paidAt != null || order.abandonedAt != null);
    if (allResolved) break;
  }

  const receipts = orders.map(order => order.receipt).filter(Boolean);
  const preparationWork = orders.flatMap(order => order.items.map(item => item.preparationStartedAt != null
    && item.preparationCompletedAt != null
    ? item.preparationCompletedAt - item.preparationStartedAt
    : null));
  const orderPreparationStarts = orders.map(order => order.items
    .map(item => item.preparationStartedAt).filter(Number.isFinite));
  const waitsToPreparation = orders.map((order, index) => orderPreparationStarts[index].length
    ? Math.min(...orderPreparationStarts[index]) - order.arrivalAt
    : null);
  const waitsToDelivery = orders.map(order => order.deliveredAt != null
    ? order.deliveredAt - order.arrivalAt
    : null);
  return {
    orderCount: orders.length,
    prepared: orders.filter(order => order.items.every(item => item.preparationCompletedAt != null)).length,
    delivered: orders.filter(order => order.deliveredAt != null).length,
    paidReceipts: receipts.length,
    abandoned: orders.filter(order => order.abandonedAt != null).length,
    pending: orders.filter(order => order.paidAt == null && order.abandonedAt == null).length,
    menuCharges: roundMoney(receipts.reduce((sum, receipt) => sum + receipt.menuCharge, 0)),
    receiptTotals: roundMoney(receipts.reduce((sum, receipt) => sum + receipt.totalPaid, 0)),
    tips: roundMoney(receipts.reduce((sum, receipt) => sum + receipt.tip, 0)),
    prepOccupancy: preparationWork.reduce((sum, seconds) => sum + (seconds ?? 0), 0),
    waitsToPreparation,
    waitsToDelivery,
    waitsToPayment: orders.map(order => order.paidAt != null ? order.paidAt - order.arrivalAt : null),
    receipts,
    menuSales: state.menuSales,
    orderFacts: orders.map(order => ({
      customerId: order.customerId,
      dishId: order.dishId,
      drinkId: order.drinkId,
      dishPriceAtOrder: order.dishPriceAtOrder,
      drinkPriceAtOrder: order.drinkPriceAtOrder,
      orderSubtotal: order.orderSubtotal,
      dishOrderSnapshot: order.dishOrderSnapshot,
      paidOrderFacts: order.paidOrderFacts ?? null,
      items: order.items.map(item => ({
        kind: item.kind, menuItemId: item.menuItemId,
        prepared: item.preparationCompletedAt != null, delivered: item.deliveredAt != null,
      })),
      receipt: order.receipt,
    })),
    pendingCustomerIds: orders.filter(order => order.paidAt == null && order.abandonedAt == null)
      .map(order => order.customerId),
    horizonReached: state.restaurant.gameTime - BASE_TIME >= horizon,
    elapsed: state.restaurant.gameTime - BASE_TIME,
  };
}

describe('Premium Lemonade menu preference boundaries', () => {
  it('compares all archetypes and tiers against Juice using an independent basket-weight oracle', () => {
    const state = menuState();
    const lemonadeWins = {
      regular: [false, false, false],
      foodie: [false, false, false],
      rusher: [false, false, false],
      influencer: [false, true, true],
    };

    for (const [archetype] of Object.entries(ARCHETYPES)) {
      for (const [tierIndex, tier] of TIERS.entries()) {
        const customer = { archetype, ...tier };
        const drinks = buildAffordableBaskets(state, customer).filter(basket => basket.kind === 'drink');
        const juice = drinks.find(basket => basket.drink.id === 'juice');
        const lemonade = drinks.find(basket => basket.drink.id === 'premium-lemonade');
        expect(juice, `${archetype}/${tier.spendingTier} Juice`).toBeDefined();
        expect(lemonade, `${archetype}/${tier.spendingTier} lemonade`).toBeDefined();
        expect(getBasketWeight(juice, customer)).toBeCloseTo(referenceWeight(juice, customer), 12);
        expect(getBasketWeight(lemonade, customer)).toBeCloseTo(referenceWeight(lemonade, customer), 12);
        expect(getBasketWeight(lemonade, customer) > getBasketWeight(juice, customer))
          .toBe(lemonadeWins[archetype][tierIndex]);
      }
    }

  });

  it('uses the real 210-work Baked Potato to mask drink speed in mixed baskets', () => {
    const state = bakedPotatoMenuState();
    const lemonadeWins = {
      regular: [null, false, false],
      foodie: [null, false, true],
      rusher: [null, false, false],
      influencer: [null, true, true],
    };
    const tiers = [
      { spendingTier: 'budget', spendingBudget: 18 },
      { spendingTier: 'value', spendingBudget: 45 },
      { spendingTier: 'premium', spendingBudget: 80 },
    ];

    for (const [archetype] of Object.entries(ARCHETYPES)) {
      for (const [tierIndex, tier] of tiers.entries()) {
        const customer = { archetype, ...tier, priceSensitivity: TIERS[tierIndex].priceSensitivity };
        const mixed = buildAffordableBaskets(state, customer)
          .filter(basket => basket.kind === 'dish_drink');
        const juice = mixed.find(basket => basket.drink.id === 'juice');
        const lemonade = mixed.find(basket => basket.drink.id === 'premium-lemonade');
        if (tierIndex === 0) {
          expect(mixed).toEqual([]);
          continue;
        }
        expect(juice).toBeDefined();
        expect(lemonade).toBeDefined();
        expect(juice.dish).toMatchObject({
          name: 'Baked Potato', price: 22, prepTime: 210, popularity: 82,
        });
        expect(lemonade.dish).toEqual(juice.dish);
        expect(juice.speed).toBe(lemonade.speed);
        expect(getBasketWeight(juice, customer)).toBeCloseTo(referenceWeight(juice, customer), 12);
        expect(getBasketWeight(lemonade, customer)).toBeCloseTo(referenceWeight(lemonade, customer), 12);
        const preferenceDelta = getBasketWeight(lemonade, customer) - getBasketWeight(juice, customer);
        expect(preferenceDelta > 1e-10,
          `${archetype}/${tier.spendingTier} preference delta=${preferenceDelta}`)
          .toBe(lemonadeWins[archetype][tierIndex] === true);
      }
    }
  });

  it('honours price overrides, equal-price preference ties, and exact affordability edges', () => {
    const equalPrice = menuState({ drinkOverrides: { 'premium-lemonade': { price: 7 } } });
    const customer = { archetype: 'regular', spendingTier: 'value', spendingBudget: 30 };
    const equalDrinks = buildAffordableBaskets(equalPrice, customer).filter(basket => basket.kind === 'drink');
    expect(equalDrinks.find(basket => basket.drink.id === 'juice').price).toBe(7);
    expect(getBasketWeight(
      equalDrinks.find(basket => basket.drink.id === 'premium-lemonade'), customer,
    )).toBeCloseTo(getBasketWeight(
      equalDrinks.find(basket => basket.drink.id === 'juice'), customer,
    ), 12);

    const equalMixed = bakedPotatoMenuState({
      drinkOverrides: { 'premium-lemonade': { price: 7 } },
    });
    for (const archetype of Object.keys(ARCHETYPES)) {
      for (const [tierIndex, tier] of TIERS.entries()) {
        const mixedCustomer = {
          archetype,
          ...tier,
          ...(tier.spendingTier === 'budget' ? { spendingBudget: 18 } : {}),
        };
        const baskets = buildAffordableBaskets(equalMixed, mixedCustomer)
          .filter(basket => basket.kind === 'dish_drink');
        if (tierIndex === 0) {
          expect(baskets).toEqual([]);
          continue;
        }
        const equalJuice = baskets.find(basket => basket.drink.id === 'juice');
        const equalLemonade = baskets.find(basket => basket.drink.id === 'premium-lemonade');
        expect(equalLemonade.price).toBe(equalJuice.price);
        expect(equalLemonade.speed).toBe(equalJuice.speed);
        expect(getBasketWeight(equalLemonade, mixedCustomer))
          .toBeGreaterThan(getBasketWeight(equalJuice, mixedCustomer));
      }
    }

    const candidateOnly = menuState({ unlockedDrinkIds: ['premium-lemonade'] });
    expect(buildAffordableBaskets(candidateOnly, {
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 8,
    })).toEqual([]);
    expect(buildAffordableBaskets(candidateOnly, {
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 9,
    }).map(basket => basket.price)).toEqual([9]);

    const bakedPotatoMenu = bakedPotatoMenuState();
    const mixedAtBudget = budget => buildAffordableBaskets(bakedPotatoMenu, {
      archetype: 'regular', spendingTier: 'value', spendingBudget: budget,
    }).filter(basket => basket.kind === 'dish_drink');
    expect(mixedAtBudget(28)).toEqual([]);
    expect(mixedAtBudget(29).map(basket => [basket.drink.id, basket.price]))
      .toEqual([['juice', 29]]);
    expect(mixedAtBudget(30).map(basket => [basket.drink.id, basket.price]))
      .toEqual([['juice', 29]]);
    expect(mixedAtBudget(31).map(basket => [basket.drink.id, basket.price]))
      .toEqual([['juice', 29], ['premium-lemonade', 31]]);
  });
});

describe('Premium Lemonade shared drink preparation', () => {
  it('uses 180 work, stays unfinished at 179, and finishes at the exact boundary', () => {
    const before = preparingDrink({ drinkId: 'premium-lemonade', gameTime: 179 });
    expect(getStaffTaskDuration(before, before.staff[0])).toBe(180);
    expect(resolveStaffAfterMovement(before, 0).serviceItems[0])
      .toMatchObject({ state: 'preparing', accumulatedWork: 179 });
    expect(resolveStaffAfterMovement(
      preparingDrink({ drinkId: 'premium-lemonade', gameTime: 180 }), 0,
    ).serviceItems[0].state).toBe('carried');
  });

  it('applies the normal morale rate and preserves work while the dispenser is lost and restored', () => {
    const at119 = resolveStaffAfterMovement(
      preparingDrink({ drinkId: 'premium-lemonade', gameTime: 119, morale: 100 }), 0,
    );
    expect(at119.serviceItems[0]).toMatchObject({ state: 'preparing', accumulatedWork: 178.5 });
    expect(resolveStaffAfterMovement(
      preparingDrink({ drinkId: 'premium-lemonade', gameTime: 120, morale: 100 }), 0,
    ).serviceItems[0].state).toBe('carried');

    const started = preparingDrink({
      drinkId: 'premium-lemonade', gameTime: 90, accumulatedWork: 90, lastProgressAt: 90,
    });
    const lost = updateStaff({ ...started, kitchenStations: [] }, 0);
    expect(lost.serviceItems[0]).toMatchObject({
      state: 'ordered', assignedStaffId: null, accumulatedWork: 90, lastProgressAt: 90,
    });
    const waiting = updateStaff({
      ...lost, restaurant: { ...lost.restaurant, gameTime: 200 },
    }, 0);
    expect(waiting.serviceItems[0]).toMatchObject({ state: 'ordered', accumulatedWork: 90 });
    const restored = updateStaff({
      ...waiting,
      kitchenStations: [{ id: 'dispenser', equipmentId: null, x: 100, y: 100 }],
    }, 0);
    expect(restored.staff[0].task).toMatchObject({ type: 'prepare_drink', serviceItemId: 'drink' });
    const resumed = resolveStaffAfterMovement(restored, 0);
    expect(resumed.serviceItems[0]).toMatchObject({ state: 'preparing', accumulatedWork: 90 });
    expect(resolveStaffAfterMovement({
      ...resumed, restaurant: { ...resumed.restaurant, gameTime: 289 },
    }, 0).serviceItems[0]).toMatchObject({ state: 'preparing', accumulatedWork: 179 });
    expect(resolveStaffAfterMovement({
      ...resumed, restaurant: { ...resumed.restaurant, gameTime: 290 },
    }, 0).serviceItems[0].state).toBe('carried');
  });

  it('does not claim a missing dispenser and can start the ordered drink after recovery', () => {
    const unavailable = preparingDrink({ drinkId: 'premium-lemonade', dispenserPresent: false });
    unavailable.serviceItems[0] = {
      ...unavailable.serviceItems[0], state: 'ordered', stationId: null,
      serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
      preparationStartedAt: null, accumulatedWork: 0, lastProgressAt: null,
    };
    unavailable.staff[0].task = null;
    const stillWaiting = updateStaff(unavailable, 0);
    expect(stillWaiting.serviceItems[0]).toMatchObject({ state: 'ordered', assignedStaffId: null });
    const recovered = updateStaff({
      ...stillWaiting,
      kitchenStations: [{ id: 'dispenser', equipmentId: null, x: 100, y: 100 }],
    }, 0);
    expect(recovered.serviceItems[0]).toMatchObject({
      state: 'ordered', assignedStaffId: 'cook', stationId: 'dispenser',
    });
  });

  it('keeps a valid exclusive Lemonade reservation after mixed-food patience cancellation', () => {
    const initial = createInitialState();
    const customer = {
      id: 'mixed-guest', partyId: 'mixed-party', tableId: 't1', state: 'seated',
      archetype: 'regular', happiness: 80, patienceMax: 900,
      spendingTier: 'value', spendingBudget: 45,
    };
    const rolls = [0.8, 0.99];
    const orderState = withOwnedAuthoredDishes({
      ...initial,
      restaurant: { ...initial.restaurant, gameTime: 100, reputation: 3 },
      dishes: [],
      unlockedDrinkIds: ['premium-lemonade'], drinkOverrides: {}, serviceItems: [], customers: [],
    }, [{ id: 'toast', cookbookId: 'toast', name: 'Toasted Bread', price: 9, quality: 1 }]);
    const order = createCustomerOrder(orderState, customer, () => rolls.shift() ?? 0.99);
    const cook = {
      id: 'cook', role: 'cook', morale: 50, x: 90, y: 110,
      task: {
        type: 'prepare_drink', serviceItemId: order.serviceItems[1].id,
        stationId: 'dispenser', serviceTableId: 'st1', serviceSlotIndex: 0,
      },
    };
    const active = {
      ...initial,
      restaurant: { ...initial.restaurant, gameTime: 100 },
      dishes: orderState.dishes,
      cookbook: orderState.cookbook,
      kitchenStations: [{ id: 'dispenser', equipmentId: null, x: 100, y: 100 }],
      serviceTables: [{ id: 'st1', x: 300, y: 120 }],
      customers: [order.customer],
      serviceItems: order.serviceItems.map(item => item.kind === 'drink'
        ? { ...item, state: 'preparing', stationId: 'dispenser', serviceTableId: 'st1',
          serviceSlotIndex: 0, assignedStaffId: cook.id, preparationStartedAt: 100,
          accumulatedWork: 45, lastProgressAt: 100 }
        : item),
      staff: [cook],
    };
    const beverage = active.serviceItems.find(item => item.kind === 'drink');
    expect(hasValidDrinkReservation(active, beverage)).toBe(true);

    const secondCustomer = { id: 'second', state: 'waiting_for_items', drinkId: 'premium-lemonade' };
    const secondWorker = {
      id: 'cook-2', role: 'cook', task: {
        type: 'prepare_drink', serviceItemId: 'drink-2', stationId: 'dispenser',
        serviceTableId: 'st1', serviceSlotIndex: 1,
      },
    };
    const competing = {
      ...active,
      customers: [...active.customers, secondCustomer],
      staff: [...active.staff, secondWorker],
      serviceItems: [...active.serviceItems, {
        id: 'drink-2', kind: 'drink', menuItemId: 'premium-lemonade', customerId: 'second',
        state: 'preparing', stationId: 'dispenser', serviceTableId: 'st1',
        serviceSlotIndex: 1, assignedStaffId: secondWorker.id,
      }],
    };
    expect(competing.serviceItems.filter(item => hasValidDrinkReservation(competing, item)))
      .toHaveLength(1);

    const expired = expireFoodPatience(active, order.customer.foodDeadlineAt);
    const recovered = normaliseServiceItemOwnership(expired);
    expect(recovered.customers[0]).toMatchObject({
      foodOutcome: 'cancelled', dishId: null, drinkId: 'premium-lemonade',
    });
    expect(recovered.serviceItems).toHaveLength(1);
    expect(recovered.serviceItems[0]).toMatchObject({
      kind: 'drink', menuItemId: 'premium-lemonade', state: 'preparing',
      assignedStaffId: 'cook', accumulatedWork: 45,
    });
    expect(hasValidDrinkReservation(recovered, recovered.serviceItems[0])).toBe(true);
    expect(recovered.staff[0].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: recovered.serviceItems[0].id,
    });
  });
});

describe('Premium Lemonade actual service comparison', () => {
  it('checks mixed-order payment using an explicitly forced carried/checkout fixture', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mixed = prepareDeliverAndPayDrink('premium-lemonade', 0, 0, true);

    expect(mixed.customer).toMatchObject({
      dishId: 'toast', drinkId: 'premium-lemonade', dishPriceAtOrder: 9,
      drinkPriceAtOrder: 9, orderSubtotal: 18,
    });
    expect(mixed.preparationCompleted).toBe(true);
    expect(mixed.delivered).toBe(true);
    expect(mixed.paid.completedCustomers).toHaveLength(1);
    expect(mixed.paid.paidVisitSequence).toBe(1);
    expect(mixed.paid.completedCustomers[0]).toMatchObject({
      customerId: 'guest-0', revenue: 21.6, tip: 3.6, totalPaid: 21.6,
    });
    expect(mixed.paid.menuSales.drinks).toEqual([
      { key: 'premium-lemonade', count: 1, gross: 9, grossComplete: true },
    ]);
  });

  it('compares Juice and Lemonade in one shared live runTick state at low and saturated arrivals', () => {
    const lowJuice = runLiveDrinkScenario('juice', [0]);
    const lowLemonade = runLiveDrinkScenario('premium-lemonade', [0]);
    const rushArrivals = [0, 60, 120, 180];
    const busyJuice = runLiveDrinkScenario('juice', rushArrivals);
    const busyLemonade = runLiveDrinkScenario('premium-lemonade', rushArrivals);
    const liveMixed = runLiveDrinkScenario('premium-lemonade', [0], { includeDish: true });

    expect(liveMixed).toMatchObject({
      orderCount: 1, prepared: 1, delivered: 1, paidReceipts: 1,
      abandoned: 0, pending: 0, menuCharges: 21, tips: 5.88,
      receiptTotals: 26.88, waitsToPreparation: [50], waitsToDelivery: [809],
      waitsToPayment: [1771], horizonReached: false,
    });
    expect(liveMixed.orderFacts[0]).toMatchObject({
      dishId: 'starter-toast', drinkId: 'premium-lemonade',
      dishPriceAtOrder: 12, drinkPriceAtOrder: 9, orderSubtotal: 21,
      dishOrderSnapshot: { menuItemId: 'starter-toast', price: 12 },
      items: [
        { kind: 'dish', menuItemId: 'starter-toast', prepared: true, delivered: true },
        { kind: 'drink', menuItemId: 'premium-lemonade', prepared: true, delivered: true },
      ],
      receipt: { paidVisitSequence: 1, menuCharge: 21, tip: 5.88, totalPaid: 26.88 },
      paidOrderFacts: {
        dishId: 'starter-toast', drinkId: 'premium-lemonade',
        dishPriceAtOrder: 12, drinkPriceAtOrder: 9, orderSubtotal: 21,
        dishOrderSnapshot: { menuItemId: 'starter-toast', price: 12 },
      },
    });
    expect(liveMixed.orderFacts[0].items).toHaveLength(2);
    expect(liveMixed.orderFacts[0].paidOrderFacts.orderedServiceItemIds).toHaveLength(2);
    expect(liveMixed.receipts).toHaveLength(1);
    expect(liveMixed.menuSales).toMatchObject({
      dishes: [{ key: 'starter-toast', count: 1, gross: 12, grossComplete: true }],
      drinks: [{ key: 'premium-lemonade', count: 1, gross: 9, grossComplete: true }],
    });
    expect(lowJuice).toMatchObject({
      orderCount: 1, prepared: 1, delivered: 1, paidReceipts: 1, abandoned: 0, pending: 0,
      menuCharges: 7, receiptTotals: 8.96, tips: 1.96, prepOccupancy: 121,
      waitsToPreparation: [314], waitsToDelivery: [920], horizonReached: false,
    });
    expect(lowLemonade).toMatchObject({
      orderCount: 1, prepared: 1, delivered: 1, paidReceipts: 1, abandoned: 0, pending: 0,
      menuCharges: 9, receiptTotals: 11.52, tips: 2.52, prepOccupancy: 181,
      waitsToPreparation: [314], waitsToDelivery: [980], horizonReached: false,
    });
    expect(busyJuice).toMatchObject({
      orderCount: 4, prepared: 4, delivered: 4, paidReceipts: 4, abandoned: 0, pending: 0,
      menuCharges: 28, receiptTotals: 34.3, tips: 6.3, prepOccupancy: 484,
      waitsToPreparation: [314, 672, 1030, 1388],
      // The dirty-table pickup-before-wipe rule changes route overlap at
      // saturation; the same four drinks and receipts still complete.
      waitsToDelivery: [920, 1054, 1524, 2080], horizonReached: false,
    });
    expect(busyLemonade).toMatchObject({
      orderCount: 4, prepared: 4, delivered: 4, paidReceipts: 4, abandoned: 0, pending: 0,
      menuCharges: 36, receiptTotals: 44.1, tips: 8.1, prepOccupancy: 724,
      waitsToPreparation: [314, 732, 1150, 1568],
      waitsToDelivery: [980, 1174, 1704, 2259], horizonReached: false,
    });
    expect(lowJuice.receipts.map(({ menuCharge, tip, totalPaid }) => [menuCharge, tip, totalPaid]))
      .toEqual([[7, 1.96, 8.96]]);
    expect(lowLemonade.receipts.map(({ menuCharge, tip, totalPaid }) => [menuCharge, tip, totalPaid]))
      .toEqual([[9, 2.52, 11.52]]);
    expect(busyJuice.receipts.map(receipt => receipt.paidVisitSequence)).toEqual([1, 2, 3, 4]);
    expect(busyLemonade.receipts.map(receipt => receipt.paidVisitSequence)).toEqual([1, 2, 3, 4]);
  });
});
