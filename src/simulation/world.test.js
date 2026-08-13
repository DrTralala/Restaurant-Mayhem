import { describe, expect, it } from 'vitest';
import { getRestaurantWorld, getQueuePosition, getCashierWorkPosition, getDefaultStaffPosition } from './world';

describe('restaurant world geometry', () => {
  it('uses a larger base floor suitable for 1080p layouts', () => {
    const world = getRestaurantWorld({ expansionLevel: 1 });
    expect(world.areaW).toBeGreaterThanOrEqual(760);
    expect(world.areaH).toBeGreaterThanOrEqual(520);
    expect(world.worldX + world.contentW).toBe(world.queueX + world.queueW);
    expect(world.worldY + world.contentH).toBe(world.kitchenY + world.floorH);
  });

  it('places the queue outside the right-side door', () => {
    const world = getRestaurantWorld({ expansionLevel: 1 });
    const queue = getQueuePosition({ restaurant: { expansionLevel: 1 } }, 0);
    expect(queue.x).toBeGreaterThan(world.doorX);
    expect(queue.y).toBeGreaterThan(0);
  });

  it('aligns the queue height and fit bounds with the restaurant', () => {
    const world = getRestaurantWorld({ expansionLevel: 1 });

    expect(world.queueY).toBe(world.kitchenY);
    expect(world.queueH).toBe(world.floorH);
    expect(world.contentW).toBe(world.queueX + world.queueW - world.worldX);
    expect(world.contentH).toBe(world.floorH);
  });

  it('returns role-specific default staff positions inside useful work zones', () => {
    const cook = getDefaultStaffPosition('cook', 0, { restaurant: { expansionLevel: 1 } });
    const waiter = getDefaultStaffPosition('waiter', 0, { restaurant: { expansionLevel: 1 } });
    const host = getDefaultStaffPosition('host', 0, { restaurant: { expansionLevel: 1 } });

    expect(cook.y).toBeLessThan(waiter.y);
    expect(host.x).toBeGreaterThan(waiter.x);
    expect(waiter.y).toBeGreaterThan(100);
  });

  it('places cashiers one grid cell behind the cashier station', () => {
    const station = { x: 800, y: 120, w: 80, h: 40 };
    const state = { cashierStations: [station] };

    expect(getCashierWorkPosition(station)).toEqual({ x: 840, y: 100 });
    expect(getDefaultStaffPosition('cashier', 0, state)).toEqual({ x: 840, y: 100 });
    expect(getDefaultStaffPosition('cashier_waiter', 0, state)).toEqual({ x: 840, y: 100 });
  });
});
