import { afterEach, describe, it, expect, vi } from 'vitest';
import { runTick } from './gameLoop';
import { createInitialState } from '../state/initialState';

const emptyState = {
  restaurant: { funds: 500, gameTime: 100, day: 1, openHour: 10, closeHour: 22, totalServed: 0, reputation: 2.0 },
  paused: false,
  speed: 1,
  tables: [],
  kitchenStations: [],
  kitchenQueue: [],
  queue: [],
  customers: [],
  foodItems: [],
  serviceTables: [],
  staff: [],
  dishes: [],
  equipment: [],
  upgrades: [],
  milestones: [],
  recipeSlots: 0,
  staffSlots: 0,
  completedCustomers: [],
  dailyHistory: [],
  notifications: [],
};

describe('runTick', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns same state when paused', () => {
    const state = { ...emptyState, paused: true };
    const result = runTick(state, 1);
    expect(result).toBe(state);
  });

  it('advances gameTime when not paused', () => {
    const result = runTick(emptyState, 5);
    expect(result.restaurant.gameTime).toBe(105);
  });

  it('applies speed multiplier', () => {
    const state = { ...emptyState, speed: 2 };
    const result = runTick(state, 5);
    expect(result.restaurant.gameTime).toBe(110); // 100 + 5 * 2
  });

  it('releases stale carried food for cleanup without leaving a carrier reference', () => {
    const state = {
      ...emptyState,
      customers: [{
        id: 'c1', state: 'leaving', happiness: 40, patience: 0,
        dishId: 'd1', tableId: 't1', x: 200, y: 200, path: [],
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      foodItems: [{
        id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
        state: 'carried', x: 150, y: 130,
      }],
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, salary: 150,
        x: 180, y: 220, path: [], carryingFoodId: 'f1',
        task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' },
      }],
    };

    const result = runTick(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.foodItems).toEqual([expect.objectContaining({ id: 'f1', state: 'to_clean' })]);
  });

  it("preserves another worker's carried food through stale delivery cancellation", () => {
    const food = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 400, y: 400,
    };
    const state = {
      ...emptyState,
      customers: [{
        id: 'c1', state: 'ordering', happiness: 80, patience: 100,
        dishId: 'd1', tableId: 't1', x: 200, y: 200, path: [],
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      foodItems: [food],
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, salary: 150,
          x: 180, y: 220, path: [], carryingFoodId: null,
          task: { type: 'deliver_food', foodId: 'f1', customerId: 'missing' },
        },
        {
          id: 'w2', role: 'waiter', morale: 80, salary: 150,
          x: 400, y: 400, path: [{ x: 10, y: 10 }], carryingFoodId: 'f1',
          task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' },
        },
      ],
    };

    const result = runTick(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.staff[1]).toMatchObject({ carryingFoodId: 'f1' });
    expect(result.foodItems).toEqual([food]);
  });

  it('routes a fresh-game customer through seating, service, cashier, and departure', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = createInitialState();
    state = {
      ...state,
      queue: [{
        id: 'integration-customer', partyId: 'integration-party', partySize: 1,
        partyType: 'solo', archetype: 'regular', gender: 'male', patience: 1000,
        happiness: 80, state: 'queued', dishId: null, tableId: null, chairId: null,
      }],
    };

    for (let second = 0; second < 600 && state.restaurant.totalServed === 0; second += 1) {
      state = runTick(state, 1);
    }

    expect(state.restaurant.totalServed).toBe(1);
  });
});
