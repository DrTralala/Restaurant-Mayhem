import { describe, it, expect } from 'vitest';
import { spawnCustomers, updateCustomers } from './customers';

const baseState = {
  restaurant: { reputation: 3.0, gameTime: 12 * 3600, openHour: 10, closeHour: 22, totalServed: 0 },
  tables: [
    { id: 't1', seats: 2, status: 'empty' },
    { id: 't2', seats: 2, status: 'empty' },
  ],
  customers: [],
  staff: [],
  dishes: [],
  kitchenQueue: [],
  completedCustomers: [],
};

describe('spawnCustomers', () => {
  it('creates customers when restaurant is open and tables free', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
    }
    expect(result.customers.length).toBeGreaterThan(0);
    expect(result.customers[0].state).toBe('arriving');
  });

  it('does not spawn if no free tables', () => {
    const state = {
      ...baseState,
      tables: baseState.tables.map(t => ({ ...t, status: 'occupied' })),
    };
    let result = state;
    for (let i = 0; i < 50; i++) {
      result = spawnCustomers(result);
    }
    expect(result.customers.length).toBe(0);
  });

  it('does not spawn during closed hours', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 3 * 3600 } };
    let result = state;
    for (let i = 0; i < 50; i++) {
      result = spawnCustomers(result);
    }
    expect(result.customers.length).toBe(0);
  });

  it('includes archetype in spawned customer', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
      if (result.customers.length > 0) break;
    }
    const archetypes = ['regular', 'foodie', 'rusher', 'influencer'];
    expect(archetypes).toContain(result.customers[0].archetype);
  });
});

describe('updateCustomers', () => {
  it('reduces patience over time', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 2);
    expect(result.customers[0].patience).toBe(98);
  });

  it('moves customer from arriving to waiting', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'arriving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 1);
    expect(result.customers[0].state).toBe('waiting');
  });

  it('sets leaving state and reduces happiness when patience runs out', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 5, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 10);
    expect(result.customers[0].patience).toBe(0);
    expect(result.customers[0].state).toBe('leaving');
    expect(result.customers[0].happiness).toBeLessThan(80);
  });

  it('removes leaving customers and frees tables', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      customers: [customer],
      tables: baseState.tables.map(t => t.id === 't1' ? { ...t, status: 'occupied' } : t),
    };
    const result = updateCustomers(state, 1);
    expect(result.customers.length).toBe(0);
    expect(result.tables.find(t => t.id === 't1').status).toBe('dirty');
  });
});
