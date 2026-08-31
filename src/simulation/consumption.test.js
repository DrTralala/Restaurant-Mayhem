import { describe, expect, it } from 'vitest';
import {
  advanceConsumption,
  getItemConsumptionDuration,
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
