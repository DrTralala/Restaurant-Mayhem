import { afterEach, describe, it, expect, vi } from 'vitest';
import { getExitHeading, spawnCustomers, updateCustomers } from './customers';
import { buildBlockedCells, worldToCell } from './pathfinding';

const baseState = {
  restaurant: { reputation: 3.0, gameTime: 12 * 3600, openHour: 10, closeHour: 22, totalServed: 0 },
  tables: [
    { id: 't1', seats: 2, status: 'empty' },
    { id: 't2', seats: 2, status: 'empty' },
  ],
  customers: [],
  queue: [],
  staff: [],
  dishes: [],
  serviceItems: [],
  completedCustomers: [],
};

describe('spawnCustomers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('scales spawning probability by elapsed time instead of animation frames', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const frameResult = spawnCustomers(baseState, 0.016);
    const oneSecondResult = spawnCustomers(baseState, 1);

    expect(frameResult.queue).toHaveLength(0);
    expect(oneSecondResult.queue).toHaveLength(1);
  });

  it('spawns customers into queue when restaurant is open', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
    }
    expect(result.queue.length).toBeGreaterThan(0);
    expect(result.queue[0].state).toBe('queued');
    expect(result.queue[0].tableId).toBeNull();
    expect(result.customers.length).toBe(0);
  });

  it('queues customers when no free tables', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const state = {
      ...baseState,
      tables: baseState.tables.map(t => ({ ...t, status: 'occupied' })),
    };
    let result = state;
    for (let i = 0; i < 100; i++) {
      result = spawnCustomers(result);
    }
    expect(result.queue.length).toBeGreaterThan(0);
    expect(result.queue[0].state).toBe('queued');
  });

  it('spawns regardless of the time of day', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 3 * 3600 } };
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let result = state;
    result = spawnCustomers(result, 1);
    expect(result.queue.length).toBeGreaterThan(0);
  });

  it('includes archetype in spawned customer', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
      if (result.queue.length > 0) break;
    }
    const archetypes = ['regular', 'foodie', 'rusher', 'influencer'];
    expect(archetypes).toContain(result.queue[0].archetype);
  });

  it('assigns a gender to spawned customers', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.75);

    const result = spawnCustomers(baseState, 1);

    expect(result.queue[0].gender).toBe('female');
    expect(result.queue[0]).toMatchObject({ dishId: null, drinkId: null });
  });

  it('spawns couples as linked customers who queue together', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.8);

    const result = spawnCustomers(baseState, 1);

    expect(result.queue).toHaveLength(2);
    expect(result.queue.map(customer => customer.partyType)).toEqual(['couple', 'couple']);
    expect(result.queue.map(customer => customer.partySize)).toEqual([2, 2]);
    expect(new Set(result.queue.map(customer => customer.partyId)).size).toBe(1);
    expect(result.queue.map(customer => customer.gender)).toEqual(['male', 'female']);
  });

  it('stops arrivals when eight parties are queued', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const queue = Array.from({ length: 8 }, (_, index) => ({ id: `q${index}`, partyId: `p${index}` }));

    const result = spawnCustomers({ ...baseState, queue }, 1);

    expect(result.queue).toHaveLength(8);
  });

  it('applies configured marketing and ambient-lighting effects', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.04);
    const upgrades = [
      { level: 2, effects: { type: 'customerRate', value: 0.02 } },
      { level: 2, effects: { type: 'happiness', value: 5 } },
    ];

    const result = spawnCustomers({ ...baseState, upgrades }, 1);

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0].happiness).toBe(90);
  });
});

describe('updateCustomers', () => {
  it('derives one stable outward heading from each customer ID', () => {
    const first = getExitHeading('c1');
    const repeated = getExitHeading('c1');

    expect(repeated).toEqual(first);
    expect([-35, 0, 35]).toContain(first.angleDegrees);
    expect(first.x).toBeGreaterThan(0);
  });

  it('passes the outside door point, moves outward, and fades over four seconds', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 993, y: 360, path: [], patience: 0, happiness: 50,
      }],
    };

    const started = updateCustomers(state, 0);
    const startX = started.customers[0].x;
    const halfway = updateCustomers(started, 2);
    const completed = updateCustomers(halfway, 2);

    expect(started.customers[0]).toMatchObject({ exitPhase: 'fading', exitFadeProgress: 0 });
    expect(halfway.customers[0].x).toBeGreaterThan(startX);
    expect(halfway.customers[0].exitFadeProgress).toBeCloseTo(0.5);
    expect(completed.customers).toEqual([]);
  });

  it('does not fade a pathless customer outside the two-pixel tolerance', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      customers: [{ id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 940, y: 350, path: [], patience: 0, happiness: 50 }],
    };

    expect(updateCustomers(state, 0).customers[0].exitPhase).toBe('to_door');
  });

  it('uses only the remaining frame budget for exact outside completion', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      customers: [{ id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 975, y: 360, path: [], patience: 0, happiness: 50 }],
    };
    const result = updateCustomers(state, 0.5);
    const customer = result.customers[0];
    expect(Math.hypot(customer.x - 975, customer.y - 360)).toBeLessThanOrEqual(55 * 0.5 + 1e-6);
    expect(buildBlockedCells(result).has(`${worldToCell(customer).x},${worldToCell(customer).y}`)).toBe(false);
    expect(customer.exitPhase).toBe('to_door');
  });

  it('keeps near-door waypoint traversal within a tiny whole-update budget', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      customers: [{ id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 980.5, y: 360, path: [{ x: 49, y: 18 }], pathGoal: { x: 49, y: 18 },
        patience: 0, happiness: 50 }],
    };
    const dt = 0.001;
    const result = updateCustomers(state, dt);
    const customer = result.customers[0];

    expect(Math.hypot(customer.x - 980.5, customer.y - 360)).toBeLessThanOrEqual(55 * dt + 1e-6);
    expect(buildBlockedCells(result).has(`${worldToCell(customer).x},${worldToCell(customer).y}`)).toBe(false);
    expect(customer.exitPhase).toBe('to_door');
  });

  it('does not directly move through an intervening hard obstacle when the static route fails', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      tables: [{ id: 'hard-block', x: 980, y: 360, status: 'occupied' }],
      customers: [{ id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 940, y: 360, path: [], patience: 0, happiness: 50 }],
    };
    const result = updateCustomers(state, 1);
    const customer = result.customers[0];
    expect(customer.exitPhase).toBe('to_door');
    expect(Math.hypot(customer.x - 940, customer.y - 360)).toBeLessThanOrEqual(55 + 1e-6);
    expect(buildBlockedCells(result).has(`${worldToCell(customer).x},${worldToCell(customer).y}`)).toBe(false);
    expect(customer).toMatchObject({ x: 940, y: 360 });
    expect(Math.hypot(customer.x - 993, customer.y - 360)).toBeGreaterThan(2);
  });

  it('completes same-cell exact outside movement over multiple updates instead of deadlocking', () => {
    let state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      customers: [{ id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 981, y: 360, path: [], patience: 0, happiness: 50 }],
    };
    const outside = { x: 993, y: 360 };
    const dt = 0.1;
    let updates = 0;
    for (let update = 0; update < 10 && state.customers[0]?.exitPhase !== 'fading'; update += 1) {
      const before = state.customers[0];
      const previousDistance = Math.hypot(before.x - outside.x, before.y - outside.y);
      state = updateCustomers(state, dt);
      updates += 1;
      const after = state.customers[0];
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThanOrEqual(55 * dt + 1e-6);
      const crossedSteps = Math.max(1, Math.ceil(Math.hypot(after.x - before.x, after.y - before.y)));
      for (let step = 0; step <= crossedSteps; step += 1) {
        const ratio = step / crossedSteps;
        const crossed = {
          x: before.x + (after.x - before.x) * ratio,
          y: before.y + (after.y - before.y) * ratio,
        };
        const cell = worldToCell(crossed);
        expect(buildBlockedCells(state).has(`${cell.x},${cell.y}`)).toBe(false);
      }
      if (after.exitPhase !== 'fading') {
        expect(Math.hypot(after.x - outside.x, after.y - outside.y)).toBeLessThan(previousDistance);
      }
    }
    expect(state.customers[0].exitPhase).toBe('fading');
    expect(updates).toBeGreaterThanOrEqual(2);
  });

  it('moves a congested checkout queue towards both positions over ten ticks without furniture collisions', () => {
    let state = {
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      tables: [{ id: 'blocker', x: 600, y: 260, status: 'occupied' }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
      customers: [
        { id: 'c1', state: 'paying', x: 400, y: 300, patience: 100, paymentQueuedAt: 10 },
        { id: 'c2', state: 'paying', x: 420, y: 300, patience: 100, paymentQueuedAt: 20 },
      ],
    };
    const goals = [{ x: 840, y: 180 }, { x: 840, y: 200 }];
    const initial = new Map(state.customers.map((customer, index) => [customer.id,
      Math.hypot(customer.x - goals[index].x, customer.y - goals[index].y)]));
    const histories = new Map(state.customers.map(customer => [customer.id, []]));
    for (let tick = 0; tick < 10; tick += 1) {
      state = updateCustomers(state, 1);
      state.customers.forEach(customer => histories.get(customer.id).push({ x: customer.x, y: customer.y }));
    }
    expect(histories.get('c1')).toHaveLength(10);
    expect(histories.get('c2')).toHaveLength(10);
    state.customers.forEach(customer => {
      const goal = goals[customer.id === 'c1' ? 0 : 1];
      expect(Math.hypot(customer.x - goal.x, customer.y - goal.y)).toBeLessThan(initial.get(customer.id));
      histories.get(customer.id).forEach(position => {
        expect(buildBlockedCells(state).has(`${worldToCell(position).x},${worldToCell(position).y}`)).toBe(false);
      });
      expect(buildBlockedCells(state).has(`${worldToCell(customer).x},${worldToCell(customer).y}`)).toBe(false);
    });
  });

  it('moves two congested departures around a staff blocker and removes them after fading', () => {
    const buildDepartureState = (withBlocker) => ({
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      tables: [{ id: 'blocker', x: 500, y: 260, status: 'occupied' }],
      staff: withBlocker ? [{ id: 'staff-blocker', role: 'waiter', x: 999, y: 280, path: [] }] : [],
      customers: [
        { id: 'c1', state: 'leaving', x: 900, y: 280, exitPhase: 'to_door', exitDoorId: 'door1', path: [], patience: 0, happiness: 50 },
        { id: 'c2', state: 'leaving', x: 900, y: 440, exitPhase: 'to_door', exitDoorId: 'door1', path: [], patience: 0, happiness: 50 },
      ],
    });
    const blockerCell = worldToCell({ x: 999, y: 280 });
    const routeKeys = route => route.map(cell => `${cell.x},${cell.y}`);

    const blockedFirst = updateCustomers(buildDepartureState(true), 0);
    const unblockedFirst = updateCustomers(buildDepartureState(false), 0);
    const blockedRoute = blockedFirst.customers.find(customer => customer.id === 'c1').path;
    const unblockedRoute = unblockedFirst.customers.find(customer => customer.id === 'c1').path;
    expect(blockedRoute.length).toBeGreaterThan(0);
    expect(unblockedRoute.length).toBeGreaterThan(0);
    const goalCell = unblockedRoute[unblockedRoute.length - 1];
    expect(blockerCell).not.toEqual(goalCell);
    expect(unblockedRoute.some(cell => cell.x === blockerCell.x && cell.y === blockerCell.y)).toBe(true);
    expect(blockedRoute.some(cell => cell.x === blockerCell.x && cell.y === blockerCell.y)).toBe(false);
    expect(routeKeys(blockedRoute)).not.toEqual(routeKeys(unblockedRoute));
    const unblockedKeys = new Set(routeKeys(unblockedRoute));
    expect(blockedRoute.some(cell => !unblockedKeys.has(`${cell.x},${cell.y}`))).toBe(true);

    let state = buildDepartureState(true);
    const outside = { x: 993, y: 360 };
    const initial = new Map(state.customers.map(customer => [customer.id, Math.hypot(customer.x - outside.x, customer.y - outside.y)]));
    const recorded = new Map(state.customers.map(customer => [customer.id, []]));
    for (let tick = 0; tick < 10; tick += 1) {
      state = updateCustomers(state, 1);
      state.customers.forEach(customer => {
        recorded.get(customer.id).push({ x: customer.x, y: customer.y, exitPhase: customer.exitPhase });
        expect(buildBlockedCells(state).has(`${worldToCell(customer).x},${worldToCell(customer).y}`)).toBe(false);
      });
    }
    expect(recorded.get('c1')).toHaveLength(10);
    expect(recorded.get('c2')).toHaveLength(10);
    for (const id of ['c1', 'c2']) {
      const toDoorRecords = recorded.get(id).filter(record => record.exitPhase === 'to_door');
      expect(toDoorRecords.length).toBeGreaterThan(0);
      const lastToDoor = toDoorRecords[toDoorRecords.length - 1];
      expect(Math.hypot(lastToDoor.x - outside.x, lastToDoor.y - outside.y)).toBeLessThan(initial.get(id));
    }
    expect(state.customers.map(customer => customer.id).sort()).toEqual(['c1', 'c2']);
    for (const id of ['c1', 'c2']) {
      const customer = state.customers.find(candidate => candidate.id === id);
      expect(customer.exitPhase).toBe('fading');
      expect(customer.exitFadeProgress).toBeGreaterThan(0);
    }
    for (let tick = 0; tick < 4; tick += 1) state = updateCustomers(state, 1);
    expect(state.customers).toEqual([]);
  });

  it('does not count fading customers as door traffic or indoor blockers', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }, { id: 'door2', y: 420 }],
      customers: [
        { id: 'old', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1', exitFadeProgress: 0.5, x: 960, y: 360 },
        { id: 'new', state: 'leaving', exitPhase: 'to_door', x: 400, y: 340, path: [] },
      ],
    };

    const result = updateCustomers(state, 0);

    expect(result.customers.find(customer => customer.id === 'new').exitDoorId).toBe('door1');
  });

  it('reduces patience over time', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 2);
    expect(result.customers[0].patience).toBe(98);
  });

  it('retains ordering patience while waiting for service items', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting_for_items', dishId: 'd1', drinkId: 'water', tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: 2, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };

    const result = updateCustomers(state, 2);

    expect(result.customers[0].patience).toBe(98);
  });

  it('moves customer from arriving to waiting', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'arriving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 1);
    expect(result.customers[0].state).toBe('waiting');
  });

  it('moves paying customers into a single-file checkout queue', () => {
    const state = {
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
      customers: [
        { id: 'c1', state: 'paying', x: 400, y: 300, patience: 100, paymentQueuedAt: 10 },
        { id: 'c2', state: 'paying', x: 420, y: 300, patience: 100, paymentQueuedAt: 20 },
      ],
    };

    const result = updateCustomers(state, 0);

    expect(result.customers[0].checkoutPosition).toEqual({ x: 840, y: 180 });
    expect(result.customers[1].checkoutPosition).toEqual({ x: 840, y: 200 });
    expect(result.customers.every(customer => customer.path.length > 0)).toBe(true);
  });

  it('assigns paying customers to the staffed station instead of station zero', () => {
    const state = {
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      staff: [{ id: 'w2', role: 'waiter' }],
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, w: 80, h: 40 },
        { id: 'cashier2', x: 400, y: 300, w: 80, h: 40, assignedStaffId: 'w2' },
      ],
      customers: [
        { id: 'c1', state: 'paying', x: 100, y: 300, patience: 100, paymentQueuedAt: 10 },
        { id: 'c2', state: 'paying', x: 120, y: 300, patience: 100, paymentQueuedAt: 20 },
      ],
    };

    const result = updateCustomers(state, 0);

    expect(result.customers.map(customer => customer.cashierStationId)).toEqual(['cashier2', 'cashier2']);
    expect(result.customers[0].checkoutPosition).toEqual({ x: 440, y: 360 });
    expect(result.customers[1].checkoutPosition).toEqual({ x: 440, y: 380 });
    expect(result.customers.every(customer => customer.path.length > 0)).toBe(true);
  });

  it('distributes unassigned paying customers across the shortest staffed queues', () => {
    const state = {
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      staff: [
        { id: 'w1', role: 'waiter' },
        { id: 'w2', role: 'waiter' },
      ],
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'w1' },
        { id: 'cashier2', x: 600, y: 300, w: 80, h: 40, assignedStaffId: 'w2' },
      ],
      customers: [
        { id: 'c1', state: 'paying', x: 400, y: 300, patience: 100, paymentQueuedAt: 10 },
        { id: 'c2', state: 'paying', x: 420, y: 300, patience: 100, paymentQueuedAt: 20 },
        { id: 'c3', state: 'paying', x: 440, y: 300, patience: 100, paymentQueuedAt: 30 },
      ],
    };

    const result = updateCustomers(state, 0);

    expect(result.customers.map(customer => customer.cashierStationId))
      .toEqual(['cashier1', 'cashier2', 'cashier1']);
  });

  it('reassigns a paying customer from an unstaffed station to the shortest staffed queue', () => {
    const result = updateCustomers({
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      staff: [{ id: 'w1', role: 'waiter' }, { id: 'w2', role: 'waiter' }],
      cashierStations: [
        { id: 'abandoned', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'missing' },
        { id: 'busy', x: 600, y: 300, w: 80, h: 40, assignedStaffId: 'w1' },
        { id: 'short', x: 400, y: 300, w: 80, h: 40, assignedStaffId: 'w2' },
      ],
      customers: [
        { id: 'existing', state: 'paying', x: 600, y: 400, patience: 100, paymentQueuedAt: 10, cashierStationId: 'busy' },
        { id: 'stale', state: 'paying', x: 700, y: 300, patience: 100, paymentQueuedAt: 20, cashierStationId: 'abandoned' },
      ],
    }, 0);
    expect(result.customers.find(customer => customer.id === 'stale')).toMatchObject({
      cashierStationId: 'short', checkoutPosition: { x: 440, y: 360 },
    });
  });

  it('sets leaving state and reduces happiness when patience runs out', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 5, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 10);
    expect(result.customers[0].patience).toBe(0);
    expect(result.customers[0].state).toBe('leaving');
    expect(result.customers[0].happiness).toBeLessThan(80);
  });

  it('clears recovery metadata when patience abandonment starts departure', () => {
    const result = updateCustomers({ ...baseState, doors: [{ id: 'door1', y: 340 }], customers: [{ id: 'c1', state: 'waiting', patience: 1, happiness: 80,
      x: 993, y: 360, path: [{ x: 1, y: 1 }], pathGoal: { x: 3, y: 3 }, usingStaticFallback: true, minimumSpacing: 6 }] }, 2);
    expect(result.customers[0]).toMatchObject({ state: 'leaving' });
    expect(result.customers[0]).not.toHaveProperty('pathGoal');
    expect(result.customers[0]).not.toHaveProperty('usingStaticFallback');
    expect(result.customers[0]).not.toHaveProperty('minimumSpacing');
  });

  it('keeps leaving customers visible while they walk towards an exit', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      customers: [customer],
      tables: baseState.tables.map(t => t.id === 't1' ? { ...t, status: 'occupied' } : t),
    };
    const result = updateCustomers(state, 1);
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]).toMatchObject({ state: 'leaving', exitDoorId: 'door1' });
    expect(result.customers[0].path.length).toBeGreaterThan(0);
    expect(result.tables.find(t => t.id === 't1').status).toBe('dirty');
  });

  it('does not auto-seat queued customer when table frees (waiter controls seating)', () => {
    const leavingCustomer = {
      id: 'c2', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const queuedCustomer = {
      id: 'q1', archetype: 'foodie', patience: 150, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      customers: [leavingCustomer],
      queue: [queuedCustomer],
      tables: baseState.tables.map(t => t.id === 't1' ? { ...t, status: 'occupied' } : t),
    };
    const result = updateCustomers(state, 1);
    expect(result.customers.length).toBe(1);
    expect(result.queue.length).toBe(1);
    expect(result.tables.find(t => t.id === 't1').status).toBe('dirty');
  });

  it('uses separate doors for simultaneous departures when available', () => {
    const customers = [
      { id: 'c1', state: 'leaving', x: 400, y: 300, patience: 0, happiness: 80 },
      { id: 'c2', state: 'leaving', x: 420, y: 300, patience: 0, happiness: 80 },
    ];
    const state = {
      ...baseState,
      customers,
      doors: [{ id: 'door1', y: 300 }, { id: 'door2', y: 420 }],
      chairs: [], kitchenStations: [], serviceTables: [],
    };

    const result = updateCustomers(state, 0);

    expect(new Set(result.customers.map(customer => customer.exitDoorId))).toEqual(new Set(['door1', 'door2']));
  });

  it('removes queue customer when patience runs out', () => {
    const queuedCustomer = {
      id: 'q1', archetype: 'rusher', patience: 5, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, queue: [queuedCustomer] };
    const result = updateCustomers(state, 10);
    expect(result.queue.length).toBe(0);
    // Dead queue mbr becomes a leaving customer (reputation loss)
    expect(result.customers.length).toBe(1);
    expect(result.customers[0].state).toBe('leaving');
  });

  it('accelerates queued patience loss as the number of parties grows', () => {
    const queue = Array.from({ length: 6 }, (_, index) => ({
      id: `q${index}`, partyId: `p${index}`, state: 'queued', patience: 100, happiness: 80,
    }));

    const result = updateCustomers({ ...baseState, queue }, 2);

    expect(result.queue[0].patience).toBe(97);
  });

  it('does not reduce patience while a customer is eating', () => {
    const customer = { id: 'c1', state: 'eating', patience: 100, happiness: 80 };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 10);

    expect(result.customers[0].patience).toBe(100);
  });

  it('lowers reputation once for each abandoning customer', () => {
    const customer = { id: 'c1', state: 'waiting', patience: 1, happiness: 80 };

    const abandoned = updateCustomers({ ...baseState, customers: [customer] }, 2);
    const updatedAgain = updateCustomers(abandoned, 2);

    expect(abandoned.restaurant.reputation).toBe(2.98);
    expect(abandoned.customers[0].reputationApplied).toBe(true);
    expect(updatedAgain.restaurant.reputation).toBe(2.98);
  });

  it('spawn never assigns tableId or adds directly to customers', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
    }
    expect(result.customers.length).toBe(0);
    for (const q of result.queue) {
      expect(q.tableId).toBeNull();
    }
  });
});
