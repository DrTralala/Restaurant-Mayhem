import { describe, it, expect } from 'vitest';
import { calculateRevenue } from './revenue';

describe('calculateRevenue', () => {
  it('computes revenue from completed customers', () => {
    const state = {
      restaurant: { funds: 100, reputation: 3.0, gameTime: 0 },
      completedCustomers: [
        { customerId: 'c1', day: 1, dishId: 'd1', revenue: 20, tip: 3 },
        { customerId: 'c2', day: 1, dishId: 'd1', revenue: 18, tip: 1 },
      ],
      staff: [],
    };
    const result = calculateRevenue(state);
    expect(result.restaurant.funds).toBe(138);
  });

  it('does not change funds with no completed customers', () => {
    const state = {
      restaurant: { funds: 100, reputation: 3.0, gameTime: 0 },
      completedCustomers: [],
      staff: [],
    };
    const result = calculateRevenue(state);
    expect(result.restaurant.funds).toBe(100);
  });

  it('clears completed customers after processing', () => {
    const state = {
      restaurant: { funds: 100, reputation: 3.0, gameTime: 0 },
      completedCustomers: [{ customerId: 'c1', day: 1, dishId: 'd1', revenue: 20, tip: 3 }],
      staff: [],
    };
    const result = calculateRevenue(state);
    expect(result.completedCustomers.length).toBe(0);
  });
});
