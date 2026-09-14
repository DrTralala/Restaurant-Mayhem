import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { prepareStaffForMovement, resolveStaffAfterMovement, updateStaff } from './staff';

function stalledStaffState() {
  const initial = createInitialState();
  return {
    ...initial,
    customers: [],
    queue: [],
    tables: initial.tables.map(table => ({ ...table, status: 'dirty' })),
    serviceItems: [{
      id: 'abandoned-food', kind: 'dish', menuItemId: 'starter-toast',
      customerId: 'departed', tableId: 't3', state: 'to_clean',
      x: 240, y: 290.0000000000075,
    }],
    staff: initial.staff.filter(worker => ['starter-waiter', 'starter-host'].includes(worker.id))
      .map(worker => ({
        ...worker,
        x: worker.id === 'starter-waiter' ? 340 : 240,
        y: worker.id === 'starter-waiter' ? 340 : 290.0000000000075,
        navigationGoal: { x: 240, y: 340 },
        carryingServiceItemId: null,
        task: worker.id === 'starter-waiter'
          ? { type: 'take_order', customerId: 'leaving' }
          : { type: 'deliver_service_item', serviceItemId: 'abandoned-food', customerId: 'departed' },
      })),
  };
}

describe('staff task cancellation without arrival', () => {
  it.each(['planning', 'unreachable', 'scheduled'])('releases stale order and delivery tasks while movement is %s', plan => {
    const state = stalledStaffState();
    state.customers = [{ id: 'leaving', state: 'leaving', tableId: 't3', x: 566, y: 360 }];
    const prepared = prepareStaffForMovement(state, 2);
    const statuses = new Map(state.staff.map(worker => [worker.id, { plan, motion: 'holding' }]));
    const result = resolveStaffAfterMovement(prepared, 2, statuses);

    for (const worker of result.staff) {
      expect(worker.task).toBeNull();
      expect(worker).not.toHaveProperty('navigationGoal');
    }
    expect(result.serviceItems).toEqual(state.serviceItems);
    expect(result.customers).toEqual(state.customers);
    const reassigned = resolveStaffAfterMovement(prepareStaffForMovement(result, 2), 2);
    expect(reassigned.staff.map(worker => worker.task)).toEqual([
      { type: 'collect_dirty_item', serviceItemId: 'abandoned-food' },
      null,
    ]);
  });

  it('does not execute valid order or delivery tasks before arrival', () => {
    const state = stalledStaffState();
    state.customers = [
      { id: 'leaving', state: 'seated', tableId: 't3' },
      { id: 'departed', state: 'waiting_for_items', tableId: 't3', dishId: 'starter-toast' },
    ];
    state.serviceItems[0].state = 'carried';
    state.staff[1].carryingServiceItemIds = ['abandoned-food'];
    const originalTasks = structuredClone(state.staff.map(worker => worker.task));
    const result = resolveStaffAfterMovement(state, 2,
      new Map(state.staff.map(worker => [worker.id, { plan: 'planning', motion: 'holding' }])));
    expect(result.staff.map(worker => worker.task)).toEqual(originalTasks);
    expect(result.serviceItems[0].state).toBe('carried');
    expect(result.customers).toEqual(state.customers);
  });
});

function activeServiceState() {
  const state = stalledStaffState();
  return {
    ...state,
    unlockedDrinkIds: [],
    tables: state.tables.map(table => ({ ...table, status: table.id === 't3' ? 'occupied' : 'empty' })),
    customers: [
      { id: 'leaving', state: 'seated', tableId: 't3', chairId: 'ch6', x: 220, y: 410,
        happiness: 80, spendingTier: 'value', spendingBudget: 45 },
      { id: 'departed', state: 'waiting_for_items', tableId: 't3', chairId: 'ch5', x: 220, y: 350,
        dishId: 'starter-toast', happiness: 80 },
    ],
    serviceItems: state.serviceItems.map(item => ({ ...item, state: 'carried' })),
    staff: state.staff.map(worker => ({ ...worker,
      carryingServiceItemIds: worker.id === 'starter-host' ? ['abandoned-food'] : [],
    })),
  };
}

describe('distinct staff service destinations', () => {
  it('assigns distinct approach positions for simultaneous ordering and delivery at one table', () => {
    const initial = activeServiceState();
    initial.staff = initial.staff.map(({ navigationGoal, ...worker }) => ({ ...worker, task: null }));
    const result = resolveStaffAfterMovement(initial, 2);
    expect(result.staff.map(worker => worker.task?.type)).toEqual(['take_order', 'deliver_service_item']);
    const [first, second] = result.staff.map(worker => worker.navigationGoal);
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(16);
  });

  it('repairs conflicting destinations in existing tasks without completing them remotely', () => {
    const initial = activeServiceState();
    const result = prepareStaffForMovement(initial, 2);
    const [first, second] = result.staff.map(worker => worker.navigationGoal);
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(16);
    expect(result.staff.map(worker => worker.task)).toEqual(initial.staff.map(worker => worker.task));
    expect(result.staff.map(worker => [worker.x, worker.y])).toEqual(initial.staff.map(worker => [worker.x, worker.y]));
    expect(result.serviceItems[0].state).toBe('carried');
  });

  it('delivers food and takes the other order from initially conflicting goals', () => {
    let state = activeServiceState();
    for (let tick = 0; tick < 350; tick += 1) {
      state = updateStaff({ ...state,
        restaurant: { ...state.restaurant, gameTime: state.restaurant.gameTime + 2 },
      }, { movementDt: 1 / 30, gameDt: 2 });
      const [first, second] = state.staff;
      expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(16 - 1e-8);
      if (state.serviceItems.find(item => item.id === 'abandoned-food')?.state === 'delivered'
        && state.customers[0].state !== 'seated') break;
    }
    expect(state.serviceItems.find(item => item.id === 'abandoned-food')?.state).toBe('delivered');
    expect(state.customers[0]).toMatchObject({ state: 'waiting_for_items', menuOutcome: 'ordered' });
    expect(state.serviceItems).toContainEqual(expect.objectContaining({ customerId: 'leaving', state: 'ordered' }));
  }, 30000);
});
