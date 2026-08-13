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
