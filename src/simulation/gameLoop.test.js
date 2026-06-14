import { describe, it, expect } from 'vitest';
import { runTick } from './gameLoop';

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
});
