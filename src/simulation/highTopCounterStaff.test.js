import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHighTopCounterRecords } from '../data/highTopCounters';
import { createEmptyCounterTestState } from '../state/highTopCounter.testSupport';
import { resolveStaffAfterMovement, updateStaff } from './staff';
import { reduceCookbookAction } from './cookbook';
import { createGrid } from './navigation/grid';
import { findRoute } from './navigation/router';
import { recordSeatResidency } from './movement/seatedDeparture';

function occupiedCounter(counter, seatIndex = 0, blockBack = false) {
  const state = { ...createEmptyCounterTestState(), highTopCounters: [counter],
    ...createHighTopCounterRecords(counter) };
  state.tables = state.tables.map(table => ({ ...table, status: 'occupied' }));
  state.customers = state.tables.map((table, index) => {
    const chair = state.chairs[index];
    const customer = { id: `guest-${index}`, partyId: `solo-${index}`, tableId: table.id,
      chairId: chair.id, state: index === seatIndex ? 'seated' : 'eating',
      x: chair.x + 10, y: chair.y + 10 };
    return { ...customer, ...recordSeatResidency(customer, chair, table) };
  });
  if (blockBack) {
    state.chairs.push(...state.tables.map((table, index) => {
      const chair = state.chairs[index];
      return { id: `back-${index}`, tableId: null,
        x: table.x + table.x - chair.x, y: table.y + table.y - chair.y };
    }));
  }
  state.staff = [{ id: 'waiter', role: 'waiter', skill: 3, morale: 80, x: 460, y: 240 }];
  return state;
}

describe('counter chair-side service access', () => {
  afterEach(() => vi.restoreAllMocks());

  it('takes the corner counter order from the saved layout without crossing stools or diners', () => {
    const state = occupiedCounter({ id: 'htc1', x: 60, y: 100, rotation: 0 });
    const prepared = updateStaff(state, 0);
    expect(prepared.staff[0].task).toMatchObject({ type: 'take_order', customerId: 'guest-0' });
    expect(prepared.staff[0].navigationGoal).toEqual({ x: 70, y: 150 });
    const grid = createGrid(state);
    const route = findRoute(grid, state.staff[0], prepared.staff[0].navigationGoal);
    expect(route.status).toBe('found');
    let previous = state.staff[0];
    for (const point of route.points) {
      expect(grid.segmentClear(previous, point)).toBe(true);
      previous = point;
    }
  });

  it('completes a counter-seated poor-value order without service or a bill', () => {
    let state = occupiedCounter({ id: 'htc1', x: 60, y: 100, rotation: 0 });
    state = reduceCookbookAction(state, {
      type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 15 },
    });
    state.unlockedDrinkIds = [];
    state.customers = state.customers.map(customer => customer.id === 'guest-0'
      ? { ...customer, archetype: 'regular', spendingTier: 'budget', spendingBudget: 18,
        dishId: null, drinkId: null }
      : customer);
    const rolls = [0, 0, 0.9];
    vi.spyOn(Math, 'random').mockImplementation(() => rolls.shift() ?? 0);

    const assigned = updateStaff(state, 0);
    expect(assigned.staff[0].task).toMatchObject({
      type: 'take_order', customerId: 'guest-0', tableId: 'htc1-seat-0',
    });
    const goal = assigned.staff[0].navigationGoal;
    const atCounter = {
      ...assigned,
      staff: assigned.staff.map(worker => worker.id === 'waiter'
        ? { ...worker, x: goal.x, y: goal.y }
        : worker),
    };
    const arrived = resolveStaffAfterMovement(atCounter, 0, new Map([
      ['waiter', { plan: 'arrived', motion: 'holding' }],
    ]));
    const completed = resolveStaffAfterMovement({
      ...arrived,
      restaurant: { ...arrived.restaurant, gameTime: arrived.restaurant.gameTime + 60 },
    }, 60, new Map([['waiter', { plan: 'arrived', motion: 'holding' }]]));
    const refused = completed.customers.find(customer => customer.id === 'guest-0');

    expect(refused).toMatchObject({
      state: 'leaving', menuOutcome: 'poor_value', departureReason: 'menu_poor_value',
      dishId: null, drinkId: null, dishPriceAtOrder: null, drinkPriceAtOrder: null,
      orderSubtotal: null,
    });
    expect(refused).not.toHaveProperty('dishOrderSnapshot');
    expect(completed.serviceItems).toEqual([]);
    expect(completed.completedCustomers).toEqual([]);
    expect(completed.restaurant.totalServed).toBe(0);
    expect(completed.partyReviewHistory).toEqual([expect.objectContaining({
      partyId: 'solo-0', score: -50, paidCount: 0, unaffordableCount: 0,
      poorValueCount: 1, reputationDelta: -0.01,
    })]);
    expect(rolls).toEqual([]);
  });

  it.each([
    [0, { x: 330, y: 350 }], [1, { x: 290, y: 330 }],
    [2, { x: 350, y: 290 }], [3, { x: 350, y: 350 }],
  ])('serves an inner place with occupied neighbours at rotation %i', (rotation, goal) => {
    const state = occupiedCounter({ id: 'htc1', x: 300, y: 300, rotation }, 1, true);
    const prepared = updateStaff(state, 0);
    expect(prepared.staff[0].task).toMatchObject({ type: 'take_order', customerId: 'guest-1' });
    expect(prepared.staff[0].navigationGoal).toEqual(goal);
  });

  it.each(['furniture', 'actor', 'destination'])('rejects a chair-side point blocked by %s', blocker => {
    const state = occupiedCounter({ id: 'htc1', x: 60, y: 100, rotation: 0 });
    if (blocker === 'furniture') state.chairs.push({ id: 'blocker', x: 60, y: 140 });
    if (blocker === 'actor') state.customers.push({ id: 'blocker', state: 'leaving', x: 70, y: 150 });
    if (blocker === 'destination') {
      state.customers[1].state = 'seated';
      state.staff.push({ id: 'other', role: 'waiter', x: 200, y: 240,
        task: { type: 'take_order', customerId: 'guest-1' }, navigationGoal: { x: 70, y: 150 } });
    }
    expect(updateStaff(state, 0).staff[0].task).toBeNull();
  });

  it('cleans a wall-backed place from the aisle without clearing neighbouring places', () => {
    const state = occupiedCounter({ id: 'htc1', x: 60, y: 100, rotation: 0 });
    state.customers = state.customers.slice(1);
    state.tables[0].status = 'dirty';
    state.staff[0].role = 'janitor';
    state.restaurant.gameTime = 100;
    const assigned = updateStaff(state, 0);
    expect(assigned.staff[0].task).toMatchObject({ type: 'clean_table', tableId: 'htc1-seat-0' });
    expect(assigned.staff[0].navigationGoal).toEqual({ x: 70, y: 150 });
    assigned.staff[0] = { ...assigned.staff[0], x: 70, y: 150 };
    const started = updateStaff(assigned, 0);
    expect(started.staff[0].task.cleaningStartedAt).toBe(100);
    const cleaned = updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 220 } }, 0);
    expect(cleaned.tables.map(table => table.status)).toEqual(['empty', 'occupied', 'occupied', 'occupied']);
  });

  it('collects dirty dishes after arriving at the chair-side point', () => {
    const state = occupiedCounter({ id: 'htc1', x: 60, y: 100, rotation: 0 });
    state.customers[0].state = 'eating';
    state.serviceItems = [{ id: 'dirty', kind: 'dish', tableId: 'htc1-seat-0',
      customerId: 'guest-0', state: 'dirty_at_table' }];
    const assigned = updateStaff(state, 0);
    expect(assigned.staff[0].task).toMatchObject({ type: 'collect_dirty_item', serviceItemId: 'dirty' });
    expect(assigned.staff[0].navigationGoal).toEqual({ x: 70, y: 150 });
    assigned.staff[0] = { ...assigned.staff[0], x: 70, y: 150 };
    const collected = updateStaff(assigned, 0);
    expect(collected.serviceItems[0].state).toBe('carried_dirty');
    expect(collected.staff[0].carryingServiceItemIds).toEqual(['dirty']);
  });
});
