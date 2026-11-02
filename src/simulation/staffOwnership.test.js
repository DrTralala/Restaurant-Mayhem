import { describe, expect, it } from 'vitest';
import { resolveStaffAfterMovement, updateStaff } from './staff';
import { releaseStaffWork } from './staffTaskLifecycle';
import { getWashStationUsage } from './dishwashing';

const baseState = {
  staff: [],
  customers: [],
  queue: [],
  tables: [],
  chairs: [],
  serviceItems: [],
  unlockedDrinkIds: [],
  kitchenStations: [],
  dishes: [{ id: 'toast', price: 10, quality: 1, popularity: 50, prepTime: 60 }],
  restaurant: { gameTime: 0, expansionLevel: 1 },
  serviceTables: [],
  washStations: [],
  doors: [{ id: 'door1', y: 340, role: 'exit' }],
};

describe('staff task ownership', () => {
  it('assigns one low-skill waiter to a table with multiple ready diners', () => {
    const result = updateStaff({
      ...baseState,
      tables: [{ id: 'table-1', status: 'occupied', seats: 2, x: 200, y: 220 }],
      customers: [
        { id: 'guest-1', partyId: 'party-1', state: 'seated', tableId: 'table-1' },
        { id: 'guest-2', partyId: 'party-1', state: 'seated', tableId: 'table-1' },
      ],
      staff: [
        { id: 'waiter-1', role: 'waiter', skill: 2, morale: 80, x: 400, y: 300, task: null },
        { id: 'waiter-2', role: 'waiter', skill: 2, morale: 80, x: 440, y: 300, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    const tableDinerIds = new Set(['guest-1', 'guest-2']);
    const tableOrderTasks = result.staff.filter(worker =>
      worker.task?.type === 'take_order' && tableDinerIds.has(worker.task.customerId));

    expect(tableOrderTasks).toHaveLength(1);
    expect(tableOrderTasks[0].task.customerId).toBe('guest-1');
    expect(tableOrderTasks[0].task.tableId).toBe('table-1');
  });

  it('allows different waiters to take orders at different tables', () => {
    const result = updateStaff({
      ...baseState,
      tables: [
        { id: 'table-1', status: 'occupied', seats: 1, x: 200, y: 220 },
        { id: 'table-2', status: 'occupied', seats: 1, x: 400, y: 420 },
      ],
      customers: [
        { id: 'guest-1', state: 'seated', tableId: 'table-1' },
        { id: 'guest-2', state: 'seated', tableId: 'table-2' },
      ],
      staff: [
        { id: 'waiter-1', role: 'waiter', skill: 2, morale: 80, x: 400, y: 300, task: null },
        { id: 'waiter-2', role: 'waiter', skill: 2, morale: 80, x: 440, y: 300, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.staff.map(worker => worker.task?.tableId)).toEqual(['table-1', 'table-2']);
  });

  it('keeps the same waiter through sequential low-skill orders at one table', () => {
    const result = updateStaff({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 60 },
      tables: [{ id: 'table-1', status: 'occupied', seats: 2, x: 200, y: 220 }],
      customers: [
        { id: 'guest-1', partyId: 'party-1', state: 'seated', tableId: 'table-1',
          spendingTier: 'budget', spendingBudget: 18, archetype: 'regular' },
        { id: 'guest-2', partyId: 'party-1', state: 'seated', tableId: 'table-1',
          spendingTier: 'budget', spendingBudget: 18, archetype: 'regular' },
      ],
      staff: [
        { id: 'waiter-1', role: 'waiter', skill: 2, morale: 80, x: 180, y: 220,
          task: { type: 'take_order', customerId: 'guest-1', tableId: 'table-1', startedAt: 0 } },
        { id: 'waiter-2', role: 'waiter', skill: 2, morale: 80, x: 440, y: 300, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.customers.find(customer => customer.id === 'guest-1').state)
      .toBe('waiting_for_items');
    expect(result.staff[0].task).toMatchObject({
      type: 'take_order', customerId: 'guest-2', tableId: 'table-1',
    });
    expect(result.staff[0].task.startedAt).toBeUndefined();
    expect(result.staff[1].task).toBeNull();
  });

  it('reconciles saved duplicate order tasks to one deterministic table owner', () => {
    const result = updateStaff({
      ...baseState,
      tables: [{ id: 'table-1', status: 'occupied', seats: 2, x: 200, y: 220 }],
      customers: [
        { id: 'guest-1', partyId: 'party-1', state: 'seated', tableId: 'table-1' },
        { id: 'guest-2', partyId: 'party-1', state: 'seated', tableId: 'table-1' },
      ],
      staff: [
        { id: 'waiter-a', role: 'waiter', skill: 2, morale: 80, x: 180, y: 220,
          task: { type: 'take_order', customerId: 'guest-1', tableId: 'table-1', startedAt: 0 } },
        { id: 'waiter-b', role: 'waiter', skill: 2, morale: 80, x: 220, y: 220,
          task: { type: 'take_order', customerId: 'guest-2', tableId: 'table-1', startedAt: 0 } },
      ],
    }, { gameDt: 0, movementDt: 0 });

    const tableOwners = result.staff.filter(worker =>
      worker.task?.type === 'take_order' && worker.task.tableId === 'table-1');
    expect(tableOwners.map(worker => worker.id)).toEqual(['waiter-a']);
  });

  it('retains level-ten party batching while recording the table claim', () => {
    const result = updateStaff({
      ...baseState,
      tables: [{ id: 'table-1', status: 'occupied', seats: 2, x: 200, y: 220 }],
      customers: [
        { id: 'guest-1', partyId: 'party-1', state: 'seated', tableId: 'table-1' },
        { id: 'guest-2', partyId: 'party-1', state: 'seated', tableId: 'table-1' },
      ],
      staff: [{ id: 'waiter', role: 'waiter', skill: 10, morale: 80,
        x: 400, y: 300, task: null }],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.staff[0].task).toMatchObject({
      type: 'take_order', customerId: 'guest-1', tableId: 'table-1',
      partyId: 'party-1', customerIds: ['guest-1', 'guest-2'],
    });
  });

  it('keeps a janitor on the same manual station for the next queued dish', () => {
    const result = resolveStaffAfterMovement({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 300 },
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      tables: [{ id: 'dirty-table', status: 'dirty', x: 400, y: 200, dirtyAt: 0 }],
      serviceItems: [
        { id: 'first', kind: 'dish', state: 'washing', washStationId: 'sink',
          assignedStaffId: 'janitor', washStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 },
        { id: 'second', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 1 },
      ],
      staff: [{ id: 'janitor', role: 'janitor', skill: 1, morale: 80, x: 180, y: 220,
        task: { type: 'wash_item', serviceItemId: 'first', washStationId: 'sink',
          serviceItemIds: ['first', 'second'],
          washingStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 } }],
    }, 0);

    expect(result.serviceItems.map(item => item.id)).toEqual(['second']);
    expect(result.serviceItems[0]).toMatchObject({
      state: 'queued_for_wash', washStationId: 'sink', assignedStaffId: 'janitor',
    });
    expect(result.staff[0].task).toMatchObject({
      type: 'wash_item', serviceItemId: 'second', washStationId: 'sink',
    });
  });

  it('releases station affinity when no queued dish remains', () => {
    const completed = resolveStaffAfterMovement({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 300 },
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      tables: [{ id: 'dirty-table', status: 'dirty', x: 400, y: 200 }],
      serviceItems: [{ id: 'last-dish', kind: 'dish', state: 'washing', washStationId: 'sink',
        assignedStaffId: 'janitor', washStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 }],
      staff: [{ id: 'janitor', role: 'janitor', skill: 1, morale: 80, x: 180, y: 220,
        task: { type: 'wash_item', serviceItemId: 'last-dish', washStationId: 'sink',
          washingStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 } }],
    }, 0);

    expect(completed.staff[0].task).toBeNull();
    expect(completed.serviceItems).toEqual([]);

    const reassigned = updateStaff(completed, { gameDt: 0, movementDt: 0 });
    expect(reassigned.staff[0].task).toMatchObject({
      type: 'clean_table', tableId: 'dirty-table',
    });
  });

  it('ends a bounded wash batch and returns to older floor dirt despite a replenished queue', () => {
    const initial = updateStaff({
      ...baseState,
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [
        { id: 'first', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 0 },
        { id: 'second', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 10 },
      ],
      staff: [{ id: 'janitor', role: 'janitor', skill: 1, morale: 80, x: 180, y: 220, task: null }],
    }, { gameDt: 0, movementDt: 0 });

    expect(initial.staff[0].task).toMatchObject({
      type: 'wash_item', serviceItemId: 'first', washStationId: 'sink',
      serviceItemIds: ['first', 'second'],
    });
    const firstFinished = resolveStaffAfterMovement({
      ...initial,
      restaurant: { ...initial.restaurant, gameTime: 300 },
      floorDirt: [{ id: 'old-dirt', x: 400, y: 200, createdAt: 0 }],
      staff: initial.staff.map(worker => {
        const { navigationGoal: _navigationGoal, ...positioned } = worker;
        return { ...positioned, task: { ...worker.task,
          washingStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 } };
      }),
      serviceItems: [
        ...initial.serviceItems.map(item => item.id === 'first'
          ? { ...item, state: 'washing', washStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 }
          : item),
        { id: 'replenished', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 250 },
      ],
    }, 0);

    expect(firstFinished.staff[0].task).toMatchObject({
      type: 'wash_item', serviceItemId: 'second', washStationId: 'sink',
      serviceItemIds: ['second'],
    });
    const secondStarted = updateStaff(firstFinished, { gameDt: 0, movementDt: 0 });
    expect(secondStarted.serviceItems.find(item => item.id === 'second').state).toBe('washing');
    const batchFinished = resolveStaffAfterMovement({
      ...secondStarted,
      restaurant: { ...secondStarted.restaurant, gameTime: 600 },
    }, 0);

    expect(batchFinished.staff[0].task).toBeNull();
    expect(batchFinished.serviceItems.find(item => item.id === 'replenished').state)
      .toBe('queued_for_wash');
    expect(updateStaff(batchFinished, { gameDt: 0, movementDt: 0 }).staff[0].task)
      .toMatchObject({ type: 'clean_floor', dirtId: 'old-dirt' });
  });

  it('settles only the active manual dish when a bounded wash task is released', () => {
    const released = releaseStaffWork({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [
        { id: 'active', kind: 'dish', state: 'washing', washStationId: 'sink',
          assignedStaffId: 'janitor', washStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 },
        { id: 'queued', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 10 },
      ],
      staff: [{ id: 'janitor', role: 'janitor', skill: 1, morale: 80, x: 180, y: 220,
        task: { type: 'wash_item', serviceItemId: 'active', serviceItemIds: ['active', 'queued'],
          washStationId: 'sink', washingStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 } }],
    }, 'janitor', 'break', 100);

    expect(released.serviceItems.find(item => item.id === 'active')).toMatchObject({
      state: 'queued_for_wash', washStationId: 'sink', assignedStaffId: null,
    });
    expect(released.serviceItems.find(item => item.id === 'active').accumulatedWork).toBeGreaterThan(0);
    expect(released.serviceItems.find(item => item.id === 'queued')).not.toHaveProperty('accumulatedWork');
    expect(released.serviceItems.find(item => item.id === 'queued')).not.toHaveProperty('lastProgressAt');
  });

  it('releases a table-cleaning owner without losing work when a dirty dish appears', () => {
    const result = resolveStaffAfterMovement({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 20 },
      tables: [{ id: 'table-1', status: 'dirty', x: 200, y: 200,
        cleaningAction: { id: 'table-1', startedAt: 0, cleaningStartedAt: 0,
          accumulatedWork: 10, lastProgressAt: 10, staffId: 'janitor', instantResolved: true,
          instantComplete: false } }],
      serviceItems: [{ id: 'dish', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' }],
      staff: [{ id: 'janitor', role: 'janitor', skill: 1, morale: 80, x: 180, y: 220,
        task: { type: 'clean_table', tableId: 'table-1', cleaningStartedAt: 0,
          accumulatedWork: 10, lastProgressAt: 10 } }],
    }, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0]).toMatchObject({
      status: 'dirty',
      cleaningAction: { staffId: null, lastProgressAt: 20 },
    });
    expect(result.tables[0].cleaningAction.accumulatedWork).toBeGreaterThan(10);
  });

  it('does not clean a dirty table until its dirty dishes have been collected', () => {
    const state = {
      ...baseState,
      tables: [{ id: 'table-1', status: 'dirty', x: 200, y: 220 }],
      serviceItems: [{ id: 'dish', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' }],
      staff: [{ id: 'janitor', role: 'janitor', skill: 1, morale: 80,
        x: 180, y: 220, task: null }],
    };

    const blocked = updateStaff(state, 0);
    expect(blocked.staff[0].task).toBeNull();
    expect(blocked.tables[0].status).toBe('dirty');

    const collected = updateStaff({ ...state, serviceItems: [] }, 0);
    expect(collected.staff[0].task).toMatchObject({ type: 'clean_table', tableId: 'table-1' });
  });

  it('assigns only one waiter to collect dirty items from a table', () => {
    const result = updateStaff({
      ...baseState,
      tables: [{ id: 'table-1', status: 'dirty', x: 200, y: 220 }],
      washStations: [{ id: 'sink', type: 'manual', x: 600, y: 200, w: 40, h: 40 }],
      serviceItems: [
        { id: 'dish-1', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
        { id: 'dish-2', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
      ],
      staff: [
        { id: 'waiter-1', role: 'waiter', skill: 5, morale: 80, x: 400, y: 300, task: null },
        { id: 'waiter-2', role: 'waiter', skill: 5, morale: 80, x: 440, y: 300, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    const pickupTasks = result.staff.filter(worker => worker.task?.type === 'collect_dirty_item');
    expect(pickupTasks).toHaveLength(1);
    expect(pickupTasks[0].task.tableId).toBe('table-1');
  });

  it('assigns another waiter when a dirty-table backlog exceeds one collector capacity', () => {
    const result = updateStaff({
      ...baseState,
      tables: [{ id: 'table-1', status: 'dirty', x: 200, y: 220 }],
      serviceItems: [
        { id: 'dish-1', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
        { id: 'dish-2', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
      ],
      staff: [
        { id: 'waiter-1', role: 'waiter', skill: 2, morale: 80, x: 400, y: 300, task: null },
        { id: 'waiter-2', role: 'waiter', skill: 2, morale: 80, x: 440, y: 300, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    const pickupTasks = result.staff.filter(worker => worker.task?.type === 'collect_dirty_item');
    expect(pickupTasks).toHaveLength(2);
    expect(pickupTasks.map(worker => worker.task.serviceItemId).sort()).toEqual(['dish-1', 'dish-2']);
    expect(pickupTasks.every(worker => worker.task.tableId === 'table-1')).toBe(true);

    const continued = updateStaff(result, { gameDt: 0, movementDt: 0 });
    expect(continued.staff.filter(worker => worker.task?.type === 'collect_dirty_item'))
      .toHaveLength(2);
  });

  it('reconciles saved dirty-table pickup tasks to one owner within its capacity', () => {
    const result = updateStaff({
      ...baseState,
      tables: [{ id: 'table-1', status: 'dirty', x: 200, y: 220 }],
      washStations: [{ id: 'sink', type: 'manual', x: 600, y: 200, w: 40, h: 40 }],
      serviceItems: [
        { id: 'dish-1', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
        { id: 'dish-2', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
      ],
      staff: [
        { id: 'waiter-a', role: 'waiter', skill: 5, morale: 80, x: 180, y: 220,
          task: { type: 'collect_dirty_item', serviceItemId: 'dish-1', tableId: 'table-1' } },
        { id: 'waiter-b', role: 'waiter', skill: 5, morale: 80, x: 220, y: 220,
          task: { type: 'collect_dirty_item', serviceItemId: 'dish-2', tableId: 'table-1' } },
      ],
    }, { gameDt: 0, movementDt: 0 });

    const owners = result.staff.filter(worker => worker.carryingServiceItemIds?.length > 0);
    expect(owners.map(worker => worker.id), JSON.stringify(result.staff.map(worker => ({
      id: worker.id, task: worker.task, carryingServiceItemIds: worker.carryingServiceItemIds,
    })))).toEqual(['waiter-a']);
  });

  it('allows separate waiters to collect dirty items from separate tables', () => {
    const result = updateStaff({
      ...baseState,
      tables: [
        { id: 'table-1', status: 'dirty', x: 200, y: 220 },
        { id: 'table-2', status: 'dirty', x: 400, y: 220 },
      ],
      serviceItems: [
        { id: 'dish-1', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
        { id: 'dish-2', kind: 'dish', tableId: 'table-2', state: 'dirty_at_table' },
      ],
      staff: [
        { id: 'waiter-1', role: 'waiter', morale: 80, x: 400, y: 300, task: null },
        { id: 'waiter-2', role: 'waiter', morale: 80, x: 440, y: 300, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.staff.map(worker => worker.task?.tableId)).toEqual(['table-1', 'table-2']);
  });

  it('releases an order-table claim when its waiter is unavailable', () => {
    const result = updateStaff({
      ...baseState,
      tables: [{ id: 'table-1', status: 'occupied', seats: 2, x: 200, y: 220 }],
      customers: [
        { id: 'guest-1', partyId: 'party-1', state: 'seated', tableId: 'table-1' },
        { id: 'guest-2', partyId: 'party-1', state: 'seated', tableId: 'table-1' },
      ],
      staff: [
        { id: 'resting', role: 'waiter', skill: 2, morale: 80, effectiveDuty: 'rest',
          x: 180, y: 220, task: { type: 'take_order', customerId: 'guest-1',
            tableId: 'table-1', startedAt: 0 } },
        { id: 'available', role: 'waiter', skill: 2, morale: 80, x: 440, y: 300, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[1].task).toMatchObject({ type: 'take_order', tableId: 'table-1' });
  });

  it('releases dirty-table pickup ownership when its waiter is unavailable', () => {
    const result = updateStaff({
      ...baseState,
      tables: [{ id: 'table-1', status: 'dirty', x: 200, y: 220 }],
      serviceItems: [
        { id: 'dish-1', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
        { id: 'dish-2', kind: 'dish', tableId: 'table-1', state: 'dirty_at_table' },
      ],
      staff: [
        { id: 'resting', role: 'waiter', morale: 80, effectiveDuty: 'rest',
          x: 180, y: 220, task: { type: 'collect_dirty_item', serviceItemId: 'dish-1', tableId: 'table-1' } },
        { id: 'available', role: 'waiter', morale: 80, x: 440, y: 300, task: null },
      ],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[1].task).toMatchObject({ type: 'collect_dirty_item', tableId: 'table-1' });
  });

  it('releases a dirty-table pickup when its target table is removed', () => {
    const result = updateStaff({
      ...baseState,
      tables: [],
      serviceItems: [{ id: 'dish', kind: 'dish', tableId: 'missing-table', state: 'dirty_at_table' }],
      staff: [{ id: 'waiter', role: 'waiter', morale: 80, x: 180, y: 220,
        task: { type: 'collect_dirty_item', serviceItemId: 'dish', tableId: 'missing-table' } }],
    }, { gameDt: 0, movementDt: 0 });

    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems[0].state).toBe('dirty_at_table');
  });

  it('counts a dirty dish only after waiter pickup, travel, and deposit', () => {
    const station = { id: 'auto', type: 'automatic', level: 1, x: 200, y: 200, w: 40, h: 40 };
    const stationAtEnd = { ...station, x: 400 };
    const state = {
      ...baseState,
      tables: [{ id: 'table-1', status: 'dirty', x: 200, y: 200 }],
      washStations: [stationAtEnd],
      serviceItems: [{ id: 'dirty', kind: 'dish', state: 'dirty_at_table',
        customerId: 'departed', tableId: 'table-1', dirtyAt: 0 }],
      staff: [{ id: 'waiter', role: 'waiter', morale: 80, x: 180, y: 220,
        carryingServiceItemIds: [],
        task: { type: 'collect_dirty_item', serviceItemId: 'dirty', tableId: 'table-1' } }],
    };

    expect(getWashStationUsage(state, stationAtEnd)).toEqual({ deposited: 0, incoming: 0 });
    let current = updateStaff(state, { gameDt: 0, movementDt: 0 });
    expect(current.serviceItems[0].state).toBe('carried_dirty');
    expect(current.staff[0].task).toMatchObject({
      type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'auto',
    });
    expect(getWashStationUsage(current, stationAtEnd)).toEqual({ deposited: 0, incoming: 1 });

    for (let tick = 0; tick < 30 && current.serviceItems[0].state === 'carried_dirty'; tick += 1) {
      current = updateStaff(current, { gameDt: 0, movementDt: 1 });
      if (current.serviceItems[0].state === 'carried_dirty') {
        expect(getWashStationUsage(current, stationAtEnd)).toEqual({ deposited: 0, incoming: 1 });
      }
    }

    expect(current.serviceItems[0]).toMatchObject({
      state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 0,
    });
    expect(getWashStationUsage(current, stationAtEnd)).toEqual({ deposited: 1, incoming: 0 });
  });
});
