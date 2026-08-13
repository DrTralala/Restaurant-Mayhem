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
  serviceTables: [{ id: 'st1', x: 140, y: 120 }],
  foodItems: [],
};

describe('processKitchen', () => {
  it('adds ordering customers to kitchen queue with null startTime', () => {
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
    // Task 5: startTime is null until cook arrives at station
    expect(result.kitchenQueue[0].startTime).toBeNull();
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

  it('only assigns toast to a station containing the required toaster', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'toast', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const state = {
      ...baseState,
      customers: [customer],
      dishes: [{ id: 'toast', name: 'Toast', prepTime: 60, requiredEquipmentId: 'toaster' }],
      equipment: [{ id: 'toaster', name: 'Toaster', level: 1, speedMultiplier: 1, qualityBonus: 0, owned: true }],
    };

    const withoutToaster = processKitchen({
      ...state,
      kitchenStations: [{ id: 'empty', equipmentId: null }],
    });
    const withToaster = processKitchen({
      ...state,
      kitchenStations: [{ id: 'empty', equipmentId: null }, { id: 'toast-station', equipmentId: 'toaster' }],
    });

    expect(withoutToaster.kitchenQueue).toHaveLength(0);
    expect(withToaster.kitchenQueue).toHaveLength(1);
    expect(withToaster.kitchenQueue[0].stationId).toBe('toast-station');
  });

  it('combines equipment and global speed effects to complete cooking sooner', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 91 },
      customers: [{ id: 'c1', state: 'ordering', dishId: 'd1', tableId: 't1' }],
      dishes: [{ id: 'd1', prepTime: 120, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1.2, qualityBonus: 0 }],
      upgrades: [{ level: 1, effects: { type: 'globalSpeed', value: 0.1 } }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: 0, completedAt: null }],
    };

    const result = processKitchen(state);

    // 120 / (1.2 * 1.1) = 90.91 seconds.
    expect(result.kitchenQueue).toHaveLength(0);
    expect(result.foodItems).toHaveLength(1);
  });

  it('places food on service table when cook time elapsed', () => {
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
    expect(result.foodItems.length).toBe(1);
    expect(result.foodItems[0].state).toBe('on_service');
    expect(result.foodItems[0].customerId).toBe('c1');
  });

  it('places completed food on the second counter when the first counter has four items', () => {
    const existingFood = Array.from({ length: 4 }, (_, index) => ({
      id: `existing-${index}`, dishId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', state: 'on_service', x: 150 + index * 30, y: 130,
    }));
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 60 },
      customers: [{ id: 'c1', state: 'ordering', dishId: 'd1', tableId: 't1' }],
      dishes: [{ id: 'd1', prepTime: 60, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1, qualityBonus: 0 }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: 0, completedAt: null }],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
      foodItems: existingFood,
    };

    const result = processKitchen(state);
    const completedFood = result.foodItems.find(food => !food.id.startsWith('existing-'));

    expect(result.foodItems).toHaveLength(5);
    expect(completedFood).toMatchObject({ serviceTableId: 'st2', x: 410, y: 130 });
    expect(result.kitchenQueue).toHaveLength(0);
  });

  it('counts version-2 service food without a recorded counter against counter capacity', () => {
    const existingFood = Array.from({ length: 4 }, (_, index) => ({
      id: `legacy-${index}`, dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150 + index * 30, y: 130,
    }));
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 60 },
      customers: [{ id: 'c1', state: 'ordering', dishId: 'd1', tableId: 't1' }],
      dishes: [{ id: 'd1', prepTime: 60, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1, qualityBonus: 0 }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: 0, completedAt: null }],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
      foodItems: existingFood,
    };

    const result = processKitchen(state);

    expect(result.foodItems.slice(0, 4).every(food => food.serviceTableId === 'st1')).toBe(true);
    expect(result.foodItems[4].serviceTableId).toBe('st2');
  });

  it('retains completed work without duplicating food while every counter is full', () => {
    const existingFood = Array.from({ length: 8 }, (_, index) => ({
      id: `existing-${index}`, dishId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: index < 4 ? 'st1' : 'st2', state: 'on_service', x: 0, y: 0,
    }));
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 60 },
      customers: [{ id: 'c1', state: 'ordering', dishId: 'd1', tableId: 't1' }],
      dishes: [{ id: 'd1', prepTime: 60, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1, qualityBonus: 0 }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: 0, completedAt: null }],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
      foodItems: existingFood,
    };

    const firstResult = processKitchen(state);
    const secondResult = processKitchen({
      ...firstResult,
      restaurant: { ...firstResult.restaurant, gameTime: 61 },
    });

    expect(firstResult.foodItems).toHaveLength(8);
    expect(firstResult.kitchenQueue).toHaveLength(1);
    expect(firstResult.kitchenQueue[0].completedAt).toBe(60);
    expect(secondResult.foodItems).toHaveLength(8);
    expect(secondResult.kitchenQueue).toHaveLength(1);
  });

  it('cooking does not progress when startTime is null', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 9999 },
      customers: [customer],
      dishes: [{ id: 'd1', name: 'Pizza', prepTime: 180, quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', name: 'Oven', level: 1, speedMultiplier: 1.0, qualityBonus: 0, owned: true }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: null, completedAt: null }],
    };
    const result = processKitchen(state);
    // No food produced because cooking hasn't started (cook hasn't arrived)
    expect(result.foodItems.length).toBe(0);
    expect(result.kitchenQueue[0].completedAt).toBeNull();
  });

  it('does not re-add ordering customer who already has food on_service', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const existingFood = {
      id: 'food-1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 300 },
      customers: [customer],
      dishes: [{ id: 'd1', name: 'Pizza', prepTime: 180, quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', name: 'Oven', level: 1, speedMultiplier: 1.0, qualityBonus: 0, owned: true }],
      kitchenQueue: [],
      foodItems: [existingFood],
    };
    const result = processKitchen(state);
    expect(result.kitchenQueue.length).toBe(0);
    expect(result.foodItems.length).toBe(1);
    expect(result.foodItems[0].id).toBe('food-1');
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

  it('keeps paying customers in the checkout queue until a cashier serves them', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'paying', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: 0, orderTime: 1, eatTime: 2,
    };
    const state = {
      ...baseState,
      restaurant: { gameTime: 100, totalServed: 7 },
      customers: [customer],
      tables: [{ id: 't1', status: 'occupied' }],
      dishes: [{ id: 'd1', price: 12 }],
    };

    const result = processKitchen(state);

    expect(result.completedCustomers).toHaveLength(0);
    expect(result.restaurant.totalServed).toBe(7);
    expect(result.customers[0]).toMatchObject({ id: 'c1', state: 'paying' });
  });

  it('removes kitchenQueue items for leaving customers', () => {
    const leavingCustomer = {
      id: 'c1', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 200 },
      customers: [leavingCustomer],
      dishes: [{ id: 'd1', name: 'Pizza', prepTime: 180, quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', name: 'Oven', level: 1, speedMultiplier: 1.0, qualityBonus: 0, owned: true }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: 50, completedAt: null }],
    };
    const result = processKitchen(state);
    expect(result.kitchenQueue.length).toBe(0);
    expect(result.foodItems.length).toBe(0);
  });

  it('removes kitchenQueue items for customers no longer in customers array', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 200 },
      customers: [],
      kitchenQueue: [{ customerId: 'c-missing', dishId: 'd1', stationId: 'k1', startTime: 50, completedAt: null }],
    };
    const result = processKitchen(state);
    expect(result.kitchenQueue.length).toBe(0);
    expect(result.foodItems.length).toBe(0);
  });

  it('does not create food for completed queue items of leaving customers', () => {
    // Customer who left has a cooking queue item — food should not be produced
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 200 },
      customers: [],  // customer already removed
      dishes: [{ id: 'd1', name: 'Pizza', prepTime: 180, quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', name: 'Oven', level: 1, speedMultiplier: 1.0, qualityBonus: 0, owned: true }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: 0, completedAt: null }],
    };
    const result = processKitchen(state);
    expect(result.kitchenQueue.length).toBe(0);
    expect(result.foodItems.length).toBe(0);
  });

  // --- Task 5: Orphan food cleanup for leaving/absent customers ---

  it('converts on_service food to to_clean when customer is leaving', () => {
    const leavingCustomer = {
      id: 'c1', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      customers: [leavingCustomer],
      foodItems: [foodItem],
    };
    const result = processKitchen(state);
    expect(result.foodItems.length).toBe(1);
    expect(result.foodItems[0].state).toBe('to_clean');
  });

  it('converts carried food to to_clean when customer is leaving', () => {
    const leavingCustomer = {
      id: 'c1', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      customers: [leavingCustomer],
      foodItems: [foodItem],
    };
    const result = processKitchen(state);
    expect(result.foodItems.length).toBe(1);
    expect(result.foodItems[0].state).toBe('to_clean');
  });

  it('converts food to to_clean when customer is absent from customers array', () => {
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c-missing', tableId: 't1',
      state: 'delivered', x: 200, y: 220,
    };
    const state = {
      ...baseState,
      customers: [],
      foodItems: [foodItem],
    };
    const result = processKitchen(state);
    expect(result.foodItems.length).toBe(1);
    expect(result.foodItems[0].state).toBe('to_clean');
  });

  it('does not re-convert already to_clean food for leaving customers', () => {
    const leavingCustomer = {
      id: 'c1', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: 0, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      customers: [leavingCustomer],
      foodItems: [foodItem],
    };
    const result = processKitchen(state);
    expect(result.foodItems.length).toBe(1);
    expect(result.foodItems[0].state).toBe('to_clean');
    expect(result.foodItems[0].id).toBe('f1');
  });
});
