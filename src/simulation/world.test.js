import { describe, expect, it } from 'vitest';
import {
  getCashierCustomerPosition,
  getCashierWorkPosition,
  getDefaultStaffPosition,
  getDoors,
  getDoorsForFlow,
  getMissingDoorWarnings,
  getRestaurantWorld,
} from './world';
import { createInitialState } from '../state/initialState';

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
    expect(world.queueX).toBeGreaterThan(world.doorX);
    expect(world.queueY).toBeGreaterThan(0);
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

    expect(cook).toEqual({ x: 90, y: 100 });
    expect(cook.y).toBeLessThan(waiter.y);
    expect(waiter.y).toBeGreaterThan(100);
  });

  it('places an assigned waiter one grid cell behind the cashier station', () => {
    const station = { x: 800, y: 120, w: 40, h: 40, assignedStaffId: 'w1' };
    const state = { cashierStations: [station] };

    expect(getCashierWorkPosition(station)).toEqual({ x: 820, y: 100 });
    expect(getDefaultStaffPosition('waiter', 0, state, 'w1')).toEqual({ x: 820, y: 100 });
  });

  it('places customers below the public side of a cashier station', () => {
    const station = { x: 800, y: 120, w: 40, h: 40 };
    expect(getCashierCustomerPosition(station)).toEqual({ x: 820, y: 180 });
    expect(getCashierCustomerPosition(station, 1)).toEqual({ x: 820, y: 200 });
  });

  it('keeps physical doors intact while selecting only the requested flow role', () => {
    const state = createInitialState();

    expect(getDoors(state)).toHaveLength(2);
    expect(getDoorsForFlow(state, 'ingress')).toEqual([
      expect.objectContaining({ id: 'door1', role: 'entrance' }),
    ]);
    expect(getDoorsForFlow(state, 'egress')).toEqual([
      expect.objectContaining({ id: 'door2', role: 'exit' }),
    ]);
  });

  it('does not manufacture a shared route for an explicit empty door array', () => {
    const state = { restaurant: { expansionLevel: 1 }, doors: [] };

    expect(getDoors(state)).toEqual([]);
    expect(getDoorsForFlow(state, 'ingress')).toEqual([]);
    expect(getDoorsForFlow(state, 'egress')).toEqual([]);
  });

  it('reports each missing directional route without changing physical doors', () => {
    const state = { restaurant: { expansionLevel: 1 }, doors: [{ id: 'door1', y: 340, role: 'entrance' }] };

    expect(getMissingDoorWarnings(state)).toEqual([
      'No exit door: departing customers are waiting.',
    ]);
    expect(getDoors(state)).toEqual(state.doors);

    expect(getMissingDoorWarnings({
      restaurant: state.restaurant,
      doors: [{ id: 'door2', y: 440, role: 'exit' }],
    })).toEqual([
      'No entrance door: queued customers are waiting.',
    ]);
  });
});
