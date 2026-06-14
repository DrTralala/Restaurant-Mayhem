import { describe, it, expect } from 'vitest';
import { updateStaff } from './staff';

const baseState = {
  staff: [],
  customers: [],
  tables: [],
  foodItems: [],
  kitchenQueue: [],
  kitchenStations: [],
  dishes: [],
  restaurant: { gameTime: 12 * 3600 },
  serviceTables: [],
};

describe('updateStaff', () => {
  it('does nothing with no staff', () => {
    const result = updateStaff(baseState, 1);
    expect(result.staff).toEqual([]);
  });

  it('reduces morale slowly over time', () => {
    const staff = [{ id: 's1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200 }];
    const state = { ...baseState, staff };
    const result = updateStaff(state, 10);
    expect(result.staff[0].morale).toBeLessThan(80);
  });

  it('waiter seats waiting customer', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [customer],
    };
    const result = updateStaff(state, 2);
    expect(result.customers[0].state).toBe('seated');
  });

  it('waiter takes order from seated customer', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: Date.now(), orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = { ...baseState, staff: [waiter], customers: [customer], dishes };
    const result = updateStaff(state, 2);
    expect(result.customers[0].state).toBe('ordering');
    expect(result.customers[0].dishId).toBe('d1');
  });

  it('waiter delivers food from service table to customer', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: Date.now(), orderTime: Date.now(), eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 2);
    expect(result.foodItems[0].state).toBe('delivered');
    expect(result.customers[0].state).toBe('eating');
  });

  it('waiter cleans food from table after customer leaves', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150 };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const state = {
      ...baseState,
      staff: [waiter],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 2);
    expect(result.foodItems.length).toBe(0);
  });

  it('waiter does NOT deliver food when there is a waiting customer to seat first', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150 };
    const waitingCustomer = {
      id: 'c2', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't2', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const orderingCustomer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: Date.now(), orderTime: Date.now(), eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter],
      customers: [waitingCustomer, orderingCustomer],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'empty', x: 360, y: 200 },
      ],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 2);
    // Waiter should seat waiting customer first, not deliver food
    expect(result.customers[0].state).toBe('seated');
    expect(result.foodItems[0].state).toBe('on_service');
  });
});
