import { describe, it, expect } from 'vitest';
import { updateStaff } from './staff';

const baseState = {
  staff: [],
  customers: [],
  tables: [],
  kitchenQueue: [],
  kitchenStations: [],
  dishes: [],
  restaurant: { gameTime: 12 * 3600 },
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

  it('waiter seats waiting customers', () => {
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
      dishes: [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 50, cuisine: 'italian', requiredEquipmentId: null }],
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
});
