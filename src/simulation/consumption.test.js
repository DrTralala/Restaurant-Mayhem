import { describe, expect, it } from 'vitest';
import {
  advanceConsumption,
  getItemConsumptionDuration,
  getCustomerConsumptionRemainingFraction,
  normaliseConsumptionState,
  startCustomerConsumption,
} from './consumption';

const items = [
  { id: 'dish', kind: 'dish', customerId: 'c1', tableId: 't1', state: 'delivered' },
  { id: 'drink', kind: 'drink', customerId: 'c1', tableId: 't1', state: 'delivered' },
];

it('starts every delivered order item together and records exact IDs', () => {
  const started = startCustomerConsumption(
    { id: 'c1', state: 'waiting_for_items', dishId: 'toast', drinkId: 'water' },
    items,
    100,
  );
  expect(started.customer).toMatchObject({
    state: 'eating', orderedServiceItemIds: ['dish', 'drink'], consumedServiceItemIds: [],
  });
  expect(started.serviceItems.map(item => item.consumptionStartedAt)).toEqual([100, 100]);
});

it('finishes a combined drink at 180 and food at 480 before entering checkout', () => {
  const started = startCustomerConsumption(
    { id: 'c1', state: 'waiting_for_items', dishId: 'toast', drinkId: 'water' },
    items,
    0,
  );
  const drinkDone = advanceConsumption({
    customers: [started.customer], serviceItems: started.serviceItems,
    restaurant: { gameTime: 180 },
  });
  expect(drinkDone.customers[0]).toMatchObject({ state: 'eating', consumedServiceItemIds: ['drink'] });
  expect(drinkDone.serviceItems.find(item => item.id === 'drink')).toMatchObject({
    state: 'dirty_at_table', consumedAt: 180, dirtyAt: 180,
  });
  expect(drinkDone.serviceItems.find(item => item.id === 'dish').state).toBe('delivered');

  const foodDone = advanceConsumption({
    ...drinkDone,
    restaurant: { gameTime: 480 },
  });
  expect(foodDone.customers[0]).toMatchObject({
    state: 'checkout_queued', consumedServiceItemIds: ['drink', 'dish'], paymentQueuedAt: 480,
  });
  expect(foodDone.serviceItems.find(item => item.id === 'dish').state).toBe('dirty_at_table');
});

it('keeps completion durable after a finished item is collected or removed', () => {
  const state = {
    customers: [{
      id: 'c1', state: 'eating', orderedServiceItemIds: ['drink', 'dish'],
      consumedServiceItemIds: ['drink'],
    }],
    serviceItems: [{
      id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered', consumptionStartedAt: 0,
    }],
    restaurant: { gameTime: 480 },
  };
  expect(advanceConsumption(state).customers[0]).toMatchObject({
    state: 'checkout_queued', consumedServiceItemIds: ['drink', 'dish'],
  });
});

it('uses the existing per-kind durations', () => {
  expect(getItemConsumptionDuration('drink')).toBe(180);
  expect(getItemConsumptionDuration('dish')).toBe(480);
  expect(getItemConsumptionDuration('unknown')).toBeNull();
});

it('is idempotent after all ordered items are completed', () => {
  const state = {
    customers: [{
      id: 'c1', state: 'eating', orderedServiceItemIds: ['drink', 'dish'],
      consumedServiceItemIds: [],
    }],
    serviceItems: [
      { id: 'drink', kind: 'drink', customerId: 'c1', state: 'delivered', consumptionStartedAt: 0 },
      { id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered', consumptionStartedAt: 0 },
    ],
    restaurant: { gameTime: 480 },
  };
  const once = advanceConsumption(state);
  const twice = advanceConsumption(once);

  expect(twice.customers[0].orderedServiceItemIds).toEqual(once.customers[0].orderedServiceItemIds);
  expect(twice.customers[0].consumedServiceItemIds).toEqual(once.customers[0].consumedServiceItemIds);
  expect(twice.customers[0].paymentQueuedAt).toBe(once.customers[0].paymentQueuedAt);
  for (const id of ['drink', 'dish']) {
    const first = once.serviceItems.find(item => item.id === id);
    const second = twice.serviceItems.find(item => item.id === id);
    expect(second).toMatchObject({ consumedAt: first.consumedAt, dirtyAt: first.dirtyAt });
  }
});

it('derives legacy ordered IDs and preserves per-item and customer start times', () => {
  const customers = [{
    id: 'c1', state: 'eating', consumptionStartedAt: 40,
  }];
  const serviceItems = [
    { id: 'drink', kind: 'drink', customerId: 'c1', state: 'delivered', consumptionStartedAt: 12 },
    { id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered' },
    { id: 'dirty', kind: 'drink', customerId: 'c1', state: 'dirty_at_table' },
    { id: 'other', kind: 'dish', customerId: 'other', state: 'delivered' },
  ];

  const result = normaliseConsumptionState(customers, serviceItems, 100);

  expect(result.customers[0]).toMatchObject({
    orderedServiceItemIds: ['drink', 'dish', 'dirty'], consumedServiceItemIds: ['dirty'],
  });
  expect(result.serviceItems.find(item => item.id === 'drink')).toMatchObject({
    consumptionStartedAt: 12,
  });
  expect(result.serviceItems.find(item => item.id === 'dish')).toMatchObject({
    consumptionStartedAt: 40,
  });
});

it('falls back to gameTime when legacy item and customer start times are missing', () => {
  const result = normaliseConsumptionState(
    [{ id: 'c1', state: 'eating' }],
    [{ id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered' }],
    100,
  );

  expect(result.serviceItems[0]).toMatchObject({ consumptionStartedAt: 100 });
});

it('falls back to gameTime when the legacy customer start time is NaN', () => {
  const result = normaliseConsumptionState(
    [{ id: 'c1', state: 'eating', consumptionStartedAt: Number.NaN }],
    [{ id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered' }],
    100,
  );

  expect(result.serviceItems[0]).toMatchObject({ consumptionStartedAt: 100 });
});

it.each([
  ['NaN item and Infinity customer starts', Number.NaN, Infinity],
  ['Infinity item and non-number customer starts', Infinity, 'legacy-start'],
  ['non-number item and missing customer start', 'legacy-start', undefined],
])('falls back to gameTime for %s', (_label, itemStart, customerStart) => {
  const customer = {
    id: 'c1', state: 'eating',
    ...(customerStart === undefined ? {} : { consumptionStartedAt: customerStart }),
  };
  const serviceItem = {
    id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered',
    consumptionStartedAt: itemStart,
  };

  const result = normaliseConsumptionState([customer], [serviceItem], 100);

  expect(result.serviceItems[0]).toMatchObject({ consumptionStartedAt: 100 });
});

it('recognises dirty states and finite completion timestamps as consumed', () => {
  const result = normaliseConsumptionState(
    [{ id: 'c1', state: 'eating', orderedServiceItemIds: ['dirty', 'stamped', 'pending'] }],
    [
      { id: 'dirty', kind: 'dish', customerId: 'c1', state: 'carried_dirty' },
      { id: 'stamped', kind: 'drink', customerId: 'c1', state: 'delivered', consumedAt: 75 },
      { id: 'pending', kind: 'dish', customerId: 'c1', state: 'delivered' },
    ],
    100,
  );

  expect(result.customers[0].consumedServiceItemIds).toEqual(['dirty', 'stamped']);
});

it('keeps normalisation equal when repeated and does not mutate its inputs', () => {
  const customers = [{ id: 'c1', state: 'eating', consumptionStartedAt: 40 }];
  const serviceItems = [{ id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered' }];
  const originalCustomers = customers.map(customer => ({ ...customer }));
  const originalServiceItems = serviceItems.map(item => ({ ...item }));

  const first = normaliseConsumptionState(customers, serviceItems, 100);
  const second = normaliseConsumptionState(first.customers, first.serviceItems, 200);

  expect(second).toEqual(first);
  expect(customers).toEqual(originalCustomers);
  expect(serviceItems).toEqual(originalServiceItems);
  expect(first.customers).not.toBe(customers);
  expect(first.serviceItems).not.toBe(serviceItems);
});

it('returns the greatest remaining fraction among unconsumed items', () => {
  const customer = { id: 'c1', state: 'eating', consumedServiceItemIds: ['finished'] };
  const serviceItems = [
    { id: 'finished', kind: 'drink', customerId: 'c1', state: 'dirty_at_table', consumptionStartedAt: 0 },
    { id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered', consumptionStartedAt: 0 },
    { id: 'drink', kind: 'drink', customerId: 'c1', state: 'delivered', consumptionStartedAt: 120 },
  ];

  expect(getCustomerConsumptionRemainingFraction(customer, serviceItems, 240)).toBe(0.5);
});

it('returns null when no owned item has a valid consumption timer', () => {
  expect(getCustomerConsumptionRemainingFraction(
    { id: 'c1', state: 'eating' },
    [
      { id: 'unknown', kind: 'unknown', customerId: 'c1', state: 'delivered', consumptionStartedAt: 0 },
      { id: 'invalid', kind: 'drink', customerId: 'c1', state: 'ordered', consumptionStartedAt: Number.NaN },
    ],
    100,
  )).toBeNull();
});

it('finishes a legacy checkout item immediately without changing its phase', () => {
  const result = advanceConsumption({
    customers: [{ id: 'c1', state: 'checkout_processing', paymentQueuedAt: 80 }],
    serviceItems: [{ id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered' }],
    restaurant: { gameTime: 100 },
  });

  expect(result.customers[0]).toMatchObject({
    state: 'checkout_processing', orderedServiceItemIds: ['dish'],
    consumedServiceItemIds: ['dish'], paymentQueuedAt: 80,
  });
  expect(result.serviceItems[0]).toMatchObject({
    state: 'dirty_at_table', consumedAt: 100, dirtyAt: 100,
  });
});

it('does not mutate inputs or their arrays across consumption operations', () => {
  const customer = { id: 'c1', state: 'waiting_for_items' };
  const serviceItems = [
    { id: 'dish', kind: 'dish', customerId: 'c1', state: 'delivered' },
  ];
  const originalCustomer = structuredClone(customer);
  const originalServiceItems = structuredClone(serviceItems);

  const started = startCustomerConsumption(customer, serviceItems, 0);
  const customers = [started.customer];
  const beforeAdvanceCustomers = structuredClone(customers);
  const beforeAdvanceItems = structuredClone(started.serviceItems);
  const advanced = advanceConsumption({
    customers, serviceItems: started.serviceItems,
    restaurant: { gameTime: 480 },
  });
  const beforeRemainingCustomer = structuredClone(started.customer);
  const beforeRemainingItems = structuredClone(started.serviceItems);
  getCustomerConsumptionRemainingFraction(started.customer, started.serviceItems, 1);

  expect(customer).toEqual(originalCustomer);
  expect(serviceItems).toEqual(originalServiceItems);
  expect(customers).toEqual(beforeAdvanceCustomers);
  expect(started.serviceItems).toEqual(beforeAdvanceItems);
  expect(started.customer).toEqual(beforeRemainingCustomer);
  expect(started.serviceItems).toEqual(beforeRemainingItems);
  expect(started.serviceItems).not.toBe(serviceItems);
  expect(advanced.customers).not.toBe(customers);
  expect(advanced.serviceItems).not.toBe(started.serviceItems);
});

describe('party checkout synchronisation', () => {
  it('keeps an early finisher seated until the final meal ends, then queues both together', () => {
    const initial = {
      customers: [
        {
          id: 'fast', partyId: 'p1', state: 'eating', menuOutcome: 'ordered',
          orderedServiceItemIds: ['drink'], consumedServiceItemIds: [],
        },
        {
          id: 'slow', partyId: 'p1', state: 'eating', menuOutcome: 'ordered',
          orderedServiceItemIds: ['dish'], consumedServiceItemIds: [],
        },
      ],
      serviceItems: [
        {
          id: 'drink', kind: 'drink', customerId: 'fast', state: 'delivered',
          consumptionStartedAt: 0,
        },
        {
          id: 'dish', kind: 'dish', customerId: 'slow', state: 'delivered',
          consumptionStartedAt: 0,
        },
      ],
      restaurant: { gameTime: 180 },
    };

    const waiting = advanceConsumption(initial);
    expect(waiting.customers.find(customer => customer.id === 'fast')).toMatchObject({
      state: 'eating', consumedServiceItemIds: ['drink'],
    });
    expect(waiting.customers.find(customer => customer.id === 'slow')).toMatchObject({
      state: 'eating', consumedServiceItemIds: [],
    });

    const released = advanceConsumption({
      ...waiting,
      restaurant: { gameTime: 480 },
    });
    expect(released.customers.map(customer => customer.state))
      .toEqual(['checkout_queued', 'checkout_queued']);
    expect(released.customers.map(customer => customer.paymentQueuedAt))
      .toEqual([480, 480]);
  });

  it('keeps an ordering member seated until every party member has a menu outcome', () => {
    const result = advanceConsumption({
      customers: [
        {
          id: 'ordered', partyId: 'p1', state: 'eating', menuOutcome: 'ordered',
          orderedServiceItemIds: ['dish'], consumedServiceItemIds: [],
        },
        { id: 'deciding', partyId: 'p1', state: 'seated' },
      ],
      serviceItems: [{
        id: 'dish', kind: 'dish', customerId: 'ordered', state: 'delivered',
        consumptionStartedAt: 0,
      }],
      restaurant: { gameTime: 480 },
    });

    expect(result.customers.find(customer => customer.id === 'ordered')).toMatchObject({
      state: 'eating', consumedServiceItemIds: ['dish'],
    });
  });

  it('sends an unaffordable member away when ordering members leave for checkout', () => {
    const result = advanceConsumption({
      customers: [
        {
          id: 'payer', partyId: 'mixed', state: 'eating', menuOutcome: 'ordered',
          tableId: 't1', orderedServiceItemIds: ['dish'], consumedServiceItemIds: [],
        },
        {
          id: 'non-payer', partyId: 'mixed', state: 'waiting_for_party',
          menuOutcome: 'unaffordable', tableId: 't1', path: [{ x: 1, y: 1 }],
          pathGoal: { x: 2, y: 2 }, usingStaticFallback: true, paymentReady: true,
        },
      ],
      serviceItems: [{
        id: 'dish', kind: 'dish', customerId: 'payer', state: 'delivered',
        consumptionStartedAt: 0,
      }],
      restaurant: { gameTime: 480 },
    });

    expect(result.customers.find(customer => customer.id === 'payer')).toMatchObject({
      state: 'checkout_queued', paymentQueuedAt: 480,
    });
    const nonPayer = result.customers.find(customer => customer.id === 'non-payer');
    expect(nonPayer).toMatchObject({
      state: 'leaving', departureReason: 'menu_unaffordable', exitPhase: 'to_door',
      exitDoorId: null, exitFadeProgress: 0, exitHeading: null, path: [], stalledFor: 0,
      cashierStationId: null, checkoutPosition: null, paymentReady: false,
    });
    expect(nonPayer.paymentQueuedAt).toBeUndefined();
    expect(nonPayer).not.toHaveProperty('pathGoal');
    expect(nonPayer).not.toHaveProperty('usingStaticFallback');
  });

  it('keeps immediate individual checkout for an all-legacy party', () => {
    const result = advanceConsumption({
      customers: [
        {
          id: 'legacy-fast', partyId: 'legacy', state: 'eating',
          orderedServiceItemIds: ['drink'], consumedServiceItemIds: [],
        },
        {
          id: 'legacy-slow', partyId: 'legacy', state: 'eating',
          orderedServiceItemIds: ['dish'], consumedServiceItemIds: [],
        },
      ],
      serviceItems: [
        {
          id: 'drink', kind: 'drink', customerId: 'legacy-fast', state: 'delivered',
          consumptionStartedAt: 0,
        },
        {
          id: 'dish', kind: 'dish', customerId: 'legacy-slow', state: 'delivered',
          consumptionStartedAt: 0,
        },
      ],
      restaurant: { gameTime: 180 },
    });

    expect(result.customers.map(customer => customer.state))
      .toEqual(['checkout_queued', 'eating']);
  });
});
