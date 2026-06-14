import { describe, it, expect } from 'vitest';
import { processKitchen } from './kitchen';

const baseState = {
  kitchenStations: [{ id: 'k1', equipmentId: 'eq1' }],
  kitchenQueue: [],
  customers: [],
  dishes: [],
  equipment: [],
  restaurant: { gameTime: 0, totalServed: 0 },
  tables: [],
  completedCustomers: [],
};

describe('processKitchen', () => {
  it('adds ordering customers to kitchen queue', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const state = {
      ...baseState,
      customers: [customer],
      dishes: [{ id: 'd1', name: 'Pizza', prepTime: 180, quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', name: 'Oven', level: 1, speedMultiplier: 1.0, qualityBonus: 0, owned: true }],
    };
    const result = processKitchen(state);
    expect(result.kitchenQueue.length).toBe(1);
    expect(result.kitchenQueue[0].dishId).toBe('d1');
  });

  it('does not add if equipment not owned', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd2', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const state = {
      ...baseState,
      kitchenStations: [{ id: 'k1', equipmentId: null }],
      customers: [customer],
      dishes: [{ id: 'd2', name: 'Toast', prepTime: 60, requiredEquipmentId: 'eq2' }],
      equipment: [{ id: 'eq2', name: 'Toaster', level: 1, speedMultiplier: 1.0, qualityBonus: 0, owned: false }],
    };
    const result = processKitchen(state);
    expect(result.kitchenQueue.length).toBe(0);
  });

  it('marks order complete when cook time elapsed', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 200 },
      customers: [customer],
      dishes: [{ id: 'd1', name: 'Pizza', prepTime: 180, quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', name: 'Oven', level: 1, speedMultiplier: 1.0, qualityBonus: 0, owned: true }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: 0, completedAt: null }],
    };
    const result = processKitchen(state);
    expect(result.customers[0].state).toBe('eating');
  });

  it('transitions eating customer to paying after 30 seconds', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'eating', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: 10,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 50 },
      customers: [customer],
    };
    const result = processKitchen(state);
    expect(result.customers[0].state).toBe('paying');
  });
});
