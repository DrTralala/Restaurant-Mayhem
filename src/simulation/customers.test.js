import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  getExitHeading,
  getCustomerMovementEntries,
  prepareCustomersForMovement,
  recoverStuckCustomers,
  resolveCustomersAfterMovement,
  spawnCustomers,
  updateCustomers,
} from './customers';
import { buildBlockedCells, worldToCell } from './pathfinding';
import { getRestaurantWorld } from './world';
import { UPGRADES } from '../data/upgrades';

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
    vi.spyOn(Math, 'random').mockReturnValue(0.03);

    const frameResult = spawnCustomers(baseState, 1);
    const oneRealSecondResult = spawnCustomers(baseState, 60);

    expect(frameResult.queue).toHaveLength(0);
    expect(oneRealSecondResult.queue).toHaveLength(1);
  });

  it('spawns dinner-rush parties every 8 to 15 real seconds on average', () => {
    const dinner = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 19 * 3600 } };
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    expect(spawnCustomers(dinner, 60).queue).toHaveLength(1);

    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.12);
    expect(spawnCustomers(dinner, 60).queue).toHaveLength(0);
  });

  it('spawns customers into queue when restaurant is open', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = spawnCustomers(state, 60);
    expect(result.queue.length).toBeGreaterThan(0);
    expect(result.queue[0].members[0].state).toBe('queued');
    expect(result.queue[0].members[0].tableId).toBeNull();
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
    expect(result.queue[0].members[0].state).toBe('queued');
  });

  it('does not spawn while the restaurant is closed', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 3 * 3600 } };
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = spawnCustomers(state, 60);
    expect(result).toEqual(state);
    expect(result.queue).toHaveLength(0);
  });

  it('canonicalises a flat below-capacity queue while closed without changing unrelated state', () => {
    const queue = [{ id: 'q1', partyId: 'p1', state: 'queued' }];
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 3 * 3600 },
      queue,
    };

    const result = spawnCustomers(state, 60);

    expect(result.queue).toEqual([{ partyId: 'p1', members: queue }]);
    expect(result.restaurant).toBe(state.restaurant);
    expect(result.customers).toBe(state.customers);
  });

  it('canonicalises a flat below-capacity queue when the arrival roll fails', () => {
    const queue = [{ id: 'q1', partyId: 'p1', state: 'queued' }];
    const state = { ...baseState, queue };
    vi.spyOn(Math, 'random').mockReturnValue(1);

    const result = spawnCustomers(state, 60);

    expect(result.queue).toEqual([{ partyId: 'p1', members: queue }]);
    expect(result.restaurant).toBe(state.restaurant);
    expect(result.customers).toBe(state.customers);
  });

  it('includes archetype in spawned customer', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.7)
      .mockReturnValueOnce(0);
    const result = spawnCustomers(state, 60);
    const archetypes = ['regular', 'foodie', 'rusher', 'influencer'];
    expect(archetypes).toContain(result.queue[0].members[0].archetype);
  });

  it('assigns a gender to spawned customers', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.75);

    const result = spawnCustomers(baseState, 1);

    expect(result.queue[0].members[0].gender).toBe('female');
    expect(result.queue[0].members[0]).toMatchObject({ dishId: null, drinkId: null });
  });

  it('spawns couples as linked customers who queue together', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.8);

    const result = spawnCustomers(baseState, 1);

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0].members.map(customer => customer.partyType)).toEqual(['couple', 'couple']);
    expect(result.queue[0].members.map(customer => customer.partySize)).toEqual([2, 2]);
    expect(new Set(result.queue[0].members.map(customer => customer.partyId)).size).toBe(1);
    expect(result.queue[0].members.map(customer => customer.gender)).toEqual(['male', 'female']);
  });

  it('stores one couple as one queue record', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0).mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0).mockReturnValueOnce(0.2).mockReturnValueOnce(0.8);
    const result = spawnCustomers(baseState, 60);
    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]).toMatchObject({ partyId: expect.any(String) });
    expect(result.queue[0].members).toHaveLength(2);
  });

  it('gives a family of four additional queue and service patience', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0)
      .mockReturnValue(0);

    const result = spawnCustomers(baseState, 60);

    expect(result.queue[0].members).toHaveLength(4);
    expect(result.queue[0].members.every(customer =>
      customer.patience === 1575
      && customer.patienceMax === 1575
      && customer.queuePatience === 1575
      && customer.queuePatienceMax === 1575)).toBe(true);
  });

  it('stops arrivals when eight parties are queued', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const queue = Array.from({ length: 8 }, (_, index) => ({ id: `q${index}`, partyId: `p${index}` }));

    const result = spawnCustomers({ ...baseState, queue }, 1);

    expect(result.queue).toHaveLength(8);
  });

  it('preserves an oversized legacy queue and postpones spawning', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const queue = Array.from({ length: 9 }, (_, index) => ({
      partyId: `p${index}`,
      members: [{ id: `q${index}`, partyId: `p${index}`, state: 'queued' }],
    }));
    expect(spawnCustomers({ ...baseState, queue }, 60).queue).toEqual(queue);
  });

  it('applies configured marketing and ambient-lighting effects', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.08)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0);
    const upgrades = [
      { level: 2, effects: { type: 'customerRate', value: 0.0001 } },
      { level: 2, effects: { type: 'happiness', value: 5 } },
    ];

    const result = spawnCustomers({ ...baseState, upgrades }, 60);

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0].members[0].happiness).toBe(90);
  });

  it('keeps the configured marketing campaign proportional to the corrected arrival rate', () => {
    const upgrades = UPGRADES.map(upgrade => upgrade.id === 'u5' ? { ...upgrade, level: 2 } : upgrade);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const result = spawnCustomers({ ...baseState, upgrades }, 60);

    expect(result.queue).toHaveLength(0);
  });

  it.each([
    [0, 900],
    [0.5, 1200],
    [0.7, 600],
    [0.9, 1080],
  ])('assigns balanced patience for archetype roll %s', (archetypeRoll, expectedPatience) => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(archetypeRoll)
      .mockReturnValueOnce(0);

    const result = spawnCustomers(baseState, 60);

    expect(result.queue[0].members[0]).toMatchObject({
      patience: expectedPatience,
      patienceMax: expectedPatience,
      queuePatience: expectedPatience,
      queuePatienceMax: expectedPatience,
    });
  });
});

describe('updateCustomers', () => {
  it('prepares patience changes without moving customer coordinates', () => {
    const state = {
      ...baseState,
      customers: [{ id: 'c1', state: 'waiting', patience: 10, happiness: 50, x: 400, y: 300, path: [] }],
    };

    const prepared = prepareCustomersForMovement(state, 2);

    expect(prepared.customers[0]).toMatchObject({ patience: 8, x: 400, y: 300 });
  });

  it('prepares a paying route without moving customer coordinates', () => {
    const state = {
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      staff: [{ id: 'cashier', role: 'waiter' }],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
      customers: [{ id: 'c1', state: 'paying', x: 400, y: 300, patience: 100, paymentQueuedAt: 10 }],
    };

    const prepared = prepareCustomersForMovement(state, 1);

    expect(prepared.customers[0]).toMatchObject({ x: 400, y: 300, checkoutPosition: { x: 840, y: 180 } });
    expect(prepared.customers[0].path.length).toBeGreaterThan(0);
  });

  it('prepares customer routes without moving customer coordinates', () => {
    const stateWithLeavingCustomer = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 900, y: 280, path: [], patience: 10, happiness: 50,
      }],
    };
    const prepared = prepareCustomersForMovement(stateWithLeavingCustomer, 1);
    expect(prepared.customers[0]).toMatchObject({ x: 900, y: 280 });
    expect(prepared.customers[0].path.length).toBeGreaterThan(0);
  });

  it('starts exit fading only in post-movement resolution', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 993, y: 360, path: [], patience: 10, happiness: 50,
      }],
    };
    expect(resolveCustomersAfterMovement(state, 1).customers[0].exitPhase).toBe('fading');
  });

  it('removes watchdog metadata when a leaver reaches the fading phase', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      customers: [{
        id: 'leaver', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 993, y: 360, path: [],
        stuckWatchdog: {
          state: 'leaving', goalKey: 'leaving:49,18:993,360',
          x: 993, y: 360, noProgressFor: 9,
        },
      }],
    };

    const result = resolveCustomersAfterMovement(state, 1);

    expect(result.customers[0].exitPhase).toBe('fading');
    expect(result.customers[0].stuckWatchdog).toBeUndefined();
  });

  it('does not advance or remove a customer that starts fading after arrival', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 993, y: 360, path: [], patience: 10, happiness: 50,
      }],
    };

    const result = updateCustomers(state, { gameDt: 0, movementDt: 10 });

    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]).toMatchObject({ exitPhase: 'fading', exitFadeProgress: 0 });
  });

  it('does not advance fading progress when its displacement is rejected', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      staff: [{ id: 'staff-blocker', role: 'waiter', x: 990, y: 360, path: [] }],
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
        exitHeading: { angleDegrees: 0, x: 1, y: 0 }, exitFadeProgress: 0.5,
        x: 980, y: 360, path: [], patience: 10, happiness: 50,
      }],
    };

    const result = updateCustomers(state, { gameDt: 0, movementDt: 1 });

    expect(result.customers[0]).toMatchObject({ x: 980, y: 360, exitFadeProgress: 0.5 });
  });

  it('requires explicit movement evidence to advance an already-fading customer', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
        exitHeading: { angleDegrees: 0, x: 1, y: 0 }, exitFadeProgress: 0.5,
        x: 980, y: 360, path: [], patience: 10, happiness: 50,
      }],
    };

    const result = resolveCustomersAfterMovement(state, 1);

    expect(result.customers[0]).toMatchObject({ x: 980, y: 360, exitFadeProgress: 0.5 });
  });

  it('stops at the furthest safe prefix before stationary compatibility blockers', () => {
    const moving = {
      id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
      x: 960, y: 360, path: [{ x: 49, y: 18 }], pathGoal: { x: 49, y: 18 },
      patience: 10, happiness: 50,
    };
    const baseMovementState = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
    };

    const staffBlocked = updateCustomers({
      ...baseMovementState,
      staff: [{ id: 'staff-blocker', role: 'waiter', x: 980, y: 360, path: [] }],
      customers: [moving],
    }, 1);
    const customerBlocked = updateCustomers({
      ...baseMovementState,
      customers: [moving, { id: 'stationary', state: 'eating', x: 980, y: 360, path: [] }],
    }, 1);

    expect(staffBlocked.customers[0].x).toBeCloseTo(964, 5);
    expect(customerBlocked.customers[0].x).toBeCloseTo(964, 5);
    expect(staffBlocked.customers[0]).toMatchObject({ y: 360, exitPhase: 'to_door' });
    expect(customerBlocked.customers[0]).toMatchObject({ y: 360, exitPhase: 'to_door' });
  });

  it('describes the exact outside-door continuation after the final cell route', () => {
    const state = {
      ...baseState,
      doors: [{ id: 'door1', y: 340 }],
      chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 960, y: 360, path: [{ x: 49, y: 18 }], pathGoal: { x: 49, y: 18 },
        patience: 10, happiness: 50,
      }],
    };

    const [entry] = getCustomerMovementEntries(state, 1);

    expect(entry).toMatchObject({
      targetAfterPath: { x: 993, y: 360 },
      ignoredIds: [],
    });
  });

  it.each([
    ['missing guide', [], 'missing'],
    ['null guide task', [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [], task: null }], 'guide'],
    ['non-guide task', [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [], task: { type: 'clean_table', tableId: 't1' } }], 'guide'],
    ['excluded party member', [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [],
      task: { type: 'guide_customer', customerIds: ['other-party'], tableId: 't1' } }], 'guide'],
  ])('does not emit customer movement for a stale guided customer with a %s', (_name, staff, guideStaffId) => {
    const entries = getCustomerMovementEntries({
      ...baseState,
      staff,
      customers: [{
        id: 'party-1', state: 'guided', guideStaffId, x: 80, y: 120,
        path: [{ x: 7, y: 6 }],
      }],
    }, 1);

    expect(entries).toEqual([]);
  });

  it.each([
    ['plural', { customerIds: ['party-1', 'party-2'] }],
    ['legacy singular', { customerId: 'party-1' }],
  ])('emits mutually ignored guide movement for a genuine %s party', (_name, partyFields) => {
    const state = {
      ...baseState,
      staff: [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }],
        task: { type: 'guide_customer', ...partyFields, tableId: 't1' } }],
      customers: [
        { id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 80, y: 120, path: [{ x: 7, y: 6 }] },
        ...('customerIds' in partyFields
          ? [{ id: 'party-2', state: 'guided', guideStaffId: 'guide', x: 60, y: 140, path: [{ x: 6, y: 7 }] }]
          : []),
      ],
    };

    const entries = getCustomerMovementEntries(state, 1);

    expect(entries.find(entry => entry.character.id === 'party-1')).toMatchObject({
      speed: 62,
      ignoredIds: ['guide', ...('customerIds' in partyFields ? partyFields.customerIds : [partyFields.customerId])],
      provenance: 'guide',
    });
  });

  it('sends outside queued parties away without a reputation penalty when closed', () => {
    const queue = [
      { id: 'q1', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
      { id: 'q2', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
    ];
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 22 * 3600 },
      queue,
    };

    const result = updateCustomers(state, { gameDt: 60, movementDt: 0 });

    expect(result.queue).toEqual([]);
    expect(result.customers).toHaveLength(2);
    expect(result.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(result.customers.every(customer => customer.reputationApplied)).toBe(true);
    expect(result.customers.every(customer => customer.closedAt === 22 * 3600)).toBe(true);
    expect(result.restaurant.reputation).toBe(3);
  });

  it('continues serving admitted customers after closing', () => {
    const customer = { id: 'c1', state: 'eating', patience: 100, happiness: 80 };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 22 * 3600 },
      customers: [customer],
    };

    const result = updateCustomers(state, { gameDt: 60, movementDt: 0 });

    expect(result.customers).toEqual([customer]);
  });

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
    expect(customer).toMatchObject({ x: 993, exitPhase: 'fading', exitFadeProgress: 0 });
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
      staff: [{ id: 'cashier', role: 'waiter' }],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
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

  it('reduces patience at half speed while waiting for service items', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting_for_items', dishId: 'd1', drinkId: 'water', tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: 2, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };

    const result = updateCustomers(state, 2);

    expect(result.customers[0].patience).toBe(99);
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
      staff: [{ id: 'cashier', role: 'waiter' }],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
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
      x: 993, y: 360, path: [{ x: 1, y: 1 }], pathGoal: { x: 3, y: 3 }, usingStaticFallback: true, minimumSpacing: 6,
      localConflictTarget: { x: 2, y: 2 }, headOnRecovery: true, recoveredHeadOnDetourTarget: { x: 4, y: 4 } }] }, 2);
    expect(result.customers[0]).toMatchObject({ state: 'leaving' });
    expect(result.customers[0]).not.toHaveProperty('pathGoal');
    expect(result.customers[0]).not.toHaveProperty('usingStaticFallback');
    expect(result.customers[0]).not.toHaveProperty('minimumSpacing');
    expect(result.customers[0]).not.toHaveProperty('localConflictTarget');
    expect(result.customers[0]).not.toHaveProperty('headOnRecovery');
    expect(result.customers[0]).not.toHaveProperty('recoveredHeadOnDetourTarget');
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
      queue: [{ partyId: 'q1', members: [queuedCustomer] }],
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
    const state = { ...baseState, queue: [{ partyId: 'q1', members: [queuedCustomer] }] };
    const result = updateCustomers(state, 10);
    expect(result.queue.length).toBe(0);
    // Dead queue mbr becomes a leaving customer (reputation loss)
    expect(result.customers.length).toBe(1);
    expect(result.customers[0].state).toBe('leaving');
  });

  it('accelerates queued patience loss as the number of parties grows', () => {
    const queue = Array.from({ length: 6 }, (_, index) => ({
      partyId: `p${index}`,
      members: [{
        id: `q${index}`, partyId: `p${index}`, state: 'queued',
        patience: 100, patienceMax: 100,
        queuePatience: 100, queuePatienceMax: 100,
        happiness: 80,
      }],
    }));

    const result = updateCustomers({ ...baseState, queue }, 2);

    expect(result.queue[0].members[0]).toMatchObject({ patience: 100, queuePatience: 97 });
  });

  it('does not reduce patience while a customer is eating', () => {
    const customer = { id: 'c1', state: 'eating', patience: 100, happiness: 80 };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 10);

    expect(result.customers[0].patience).toBe(100);
  });

  it.each(['guided', 'ordering', 'eating'])('does not reduce patience while a customer is %s', stateName => {
    const customer = { id: 'c1', state: stateName, patience: 100, happiness: 80 };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 10);

    expect(result.customers[0].patience).toBe(100);
  });

  it.each(['checkout_queued', 'checkout_moving', 'checkout_processing'])
    ('preserves patience while a customer is %s', stateName => {
      const customer = { id: 'c1', state: stateName, patience: 100, happiness: 80 };

      const result = updateCustomers({ ...baseState, customers: [customer] }, 10);

      expect(result.customers[0].patience).toBe(100);
    });

  it.each(['checkout_queued', 'checkout_moving', 'checkout_processing'])
    ('releases the dining table when its final customer is %s', stateName => {
      const customer = {
        id: 'c1', state: stateName, tableId: 't1', patience: 100, happiness: 80,
      };
      const tables = baseState.tables.map(table => table.id === 't1'
        ? { ...table, status: 'occupied' }
        : table);

      const result = prepareCustomersForMovement({ ...baseState, customers: [customer], tables }, 0);

      expect(result.tables.find(table => table.id === 't1').status).toBe('dirty');
    });

  it('keeps a table occupied while another party member is still dining', () => {
    const customers = [
      { id: 'payer', state: 'checkout_queued', tableId: 't1', patience: 100, happiness: 80 },
      { id: 'diner', state: 'eating', tableId: 't1', patience: 100, happiness: 80 },
    ];
    const tables = baseState.tables.map(table => table.id === 't1'
      ? { ...table, status: 'occupied' }
      : table);

    const result = prepareCustomersForMovement({ ...baseState, customers, tables }, 0);

    expect(result.tables.find(table => table.id === 't1').status).toBe('occupied');
  });

  it('normalises legacy paying without consuming checkout patience', () => {
    const customer = {
      id: 'c1', state: 'paying', patience: 100, happiness: 80,
      paymentQueuedAt: 20, x: 400, y: 300,
    };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 10);

    expect(result.customers[0]).toMatchObject({
      state: 'checkout_queued', patience: 100, paymentQueuedAt: 20,
    });
  });

  it('does not reduce patience while a waiter actively takes the customer order', () => {
    const customer = {
      id: 'c1', state: 'seated', patience: 1, happiness: 80,
      tableId: 't1', dishId: null, drinkId: null,
    };
    const staff = [{
      id: 'w1', role: 'waiter',
      task: { type: 'take_order', customerId: 'c1', startedAt: 0 },
    }];

    const result = prepareCustomersForMovement({ ...baseState, customers: [customer], staff }, 1);

    expect(result.customers[0]).toMatchObject({ state: 'seated', patience: 1 });
  });

  it('continues seated patience loss when the active order targets another customer', () => {
    const customer = {
      id: 'c1', state: 'seated', patience: 2, happiness: 80,
      tableId: 't1', dishId: null, drinkId: null,
    };
    const staff = [{
      id: 'w1', role: 'waiter',
      task: { type: 'take_order', customerId: 'c2', startedAt: 0 },
    }];

    const result = prepareCustomersForMovement({ ...baseState, customers: [customer], staff }, 1);

    expect(result.customers[0]).toMatchObject({ state: 'seated', patience: 1 });
  });

  it.each(['waiting', 'seated'])('reduces patience at full speed while a customer is %s', stateName => {
    const customer = { id: 'c1', state: stateName, patience: 100, happiness: 80 };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 10);

    expect(result.customers[0].patience).toBe(90);
  });

  it('reduces patience at half speed while awaiting an order', () => {
    const customer = { id: 'c1', state: 'waiting_for_items', patience: 100, happiness: 80 };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 10);

    expect(result.customers[0].patience).toBe(95);
  });

  it('uses game time for patience independently of movement time', () => {
    const customer = { id: 'c1', state: 'waiting', patience: 100, happiness: 80 };

    const result = updateCustomers(
      { ...baseState, customers: [customer] },
      { gameDt: 60, movementDt: 0 },
    );

    expect(result.customers[0].patience).toBe(40);
  });

  it('makes the whole party leave and lowers reputation once per abandoning party', () => {
    const customers = [
      { id: 'c1', partyId: 'p1', state: 'waiting', patience: 1, happiness: 80 },
      { id: 'c2', partyId: 'p1', state: 'ordering', patience: 100, happiness: 80 },
    ];

    const abandoned = updateCustomers({ ...baseState, customers }, 2);
    const updatedAgain = updateCustomers(abandoned, 2);

    expect(abandoned.restaurant.reputation).toBe(2.9);
    expect(abandoned.customers.map(customer => customer.state)).toEqual(['leaving', 'leaving']);
    expect(abandoned.customers.every(customer => customer.reputationApplied)).toBe(true);
    expect(updatedAgain.restaurant.reputation).toBe(2.9);
  });

  it('does not remove a checkout-committed member when their party abandons', () => {
    const customers = [
      {
        id: 'waiting', partyId: 'p1', state: 'waiting_for_items',
        patience: 1, happiness: 80,
      },
      {
        id: 'payer', partyId: 'p1', state: 'checkout_queued',
        patience: 1, happiness: 80, paymentQueuedAt: 20,
      },
    ];

    const result = updateCustomers({ ...baseState, customers }, 2);

    expect(result.customers.find(customer => customer.id === 'waiting').state).toBe('leaving');
    expect(result.customers.find(customer => customer.id === 'payer')).toMatchObject({
      state: 'checkout_queued', patience: 1,
    });
    expect(result.restaurant.reputation).toBe(2.9);
  });

  it('penalises separate abandoning parties independently', () => {
    const customers = [
      { id: 'c1', partyId: 'p1', state: 'waiting', patience: 1, happiness: 80 },
      { id: 'c2', partyId: 'p2', state: 'waiting_for_items', patience: 1, happiness: 80 },
    ];

    const result = updateCustomers({ ...baseState, customers }, 2);

    expect(result.restaurant.reputation).toBe(2.8);
  });

  it('removes an entire queued party with one reputation penalty', () => {
    const queue = [{ partyId: 'p1', members: [
      { id: 'q1', partyId: 'p1', state: 'queued', patience: 1, happiness: 80 },
      { id: 'q2', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
    ] }];

    const result = updateCustomers({ ...baseState, queue }, 2);

    expect(result.queue).toHaveLength(0);
    expect(result.customers.map(customer => customer.state)).toEqual(['leaving', 'leaving']);
    expect(result.restaurant.reputation).toBe(2.9);
  });

  it('abandons a complete party record once with projected leaving positions', () => {
    const queue = [{ partyId: 'p1', members: [
      { id: 'q1', partyId: 'p1', state: 'queued', patience: 1, happiness: 80 },
      { id: 'q2', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
    ] }];
    const result = prepareCustomersForMovement({ ...baseState, queue }, 2);
    expect(result.queue).toEqual([]);
    expect(result.customers.map(customer => customer.state)).toEqual(['leaving', 'leaving']);
    expect(result.customers.every(customer => Number.isFinite(customer.x) && Number.isFinite(customer.y))).toBe(true);
    expect(result.restaurant.reputation).toBe(2.9);
  });

  it('spawn never assigns tableId or adds directly to customers', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
    }
    expect(result.customers.length).toBe(0);
    for (const party of result.queue) {
      for (const member of party.members) expect(member.tableId).toBeNull();
    }
  });
});

describe('recoverStuckCustomers observation', () => {
  const guidedState = customer => ({
    ...baseState,
    chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
    customers: [customer],
  });

  it('starts at zero and accumulates only movement-seconds without meaningful displacement', () => {
    const initial = guidedState({
      id: 'guided', state: 'guided', x: 100, y: 100,
      path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 },
    });

    const observed = recoverStuckCustomers(initial, 4);
    const aged = recoverStuckCustomers(observed, 4);
    const invalidDuration = recoverStuckCustomers(aged, -10);

    expect(observed.customers[0].stuckWatchdog).toMatchObject({
      state: 'guided', x: 100, y: 100, noProgressFor: 0,
    });
    expect(aged.customers[0].stuckWatchdog.noProgressFor).toBe(4);
    expect(invalidDuration.customers[0].stuckWatchdog.noProgressFor).toBe(4);
    expect(initial.customers[0].stuckWatchdog).toBeUndefined();
  });

  it('resets observation after meaningful movement or a goal change', () => {
    const observed = recoverStuckCustomers(guidedState({
      id: 'guided', state: 'guided', x: 100, y: 100,
      path: [{ x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
    }), 0);
    const aged = recoverStuckCustomers(observed, 5);
    const moved = recoverStuckCustomers({
      ...aged,
      customers: [{ ...aged.customers[0], x: 100.1 }],
    }, 1);
    const oldGoalKey = moved.customers[0].stuckWatchdog.goalKey;
    const retargeted = recoverStuckCustomers({
      ...moved,
      customers: [{
        ...moved.customers[0],
        path: [{ x: 9, y: 5 }],
        pathGoal: { x: 9, y: 5 },
      }],
    }, 1);

    expect(moved.customers[0].stuckWatchdog).toMatchObject({
      x: 100.1, y: 100, noProgressFor: 0,
    });
    expect(retargeted.customers[0].stuckWatchdog.noProgressFor).toBe(0);
    expect(retargeted.customers[0].stuckWatchdog.goalKey).not.toBe(oldGoalKey);
  });

  it.each([
    ['a non-array path', { path: { x: 8, y: 5 } }, null],
    ['a non-finite final path element', { path: [{ x: Infinity, y: 5 }] }, null],
    [
      'a non-finite pathGoal with a finite path fallback',
      { pathGoal: { x: Infinity, y: 5 }, path: [{ x: 8, y: 5 }] },
      'guided:8,5:160,100',
    ],
    [
      'a finite pathGoal with a malformed path',
      { pathGoal: { x: 8, y: 5 }, path: { x: 9, y: 5 } },
      'guided:8,5:160,100',
    ],
  ])('handles guided goal data with %s without throwing', (_name, goalFields, goalKey) => {
    let result;
    expect(() => {
      result = recoverStuckCustomers(guidedState({
        id: 'guided', state: 'guided', x: 100, y: 100,
        ...goalFields,
      }), 10);
    }).not.toThrow();

    expect(result.customers[0]).toMatchObject({ x: 100, y: 100 });
    if (goalKey) {
      expect(result.customers[0].stuckWatchdog).toMatchObject({ goalKey, noProgressFor: 0 });
    } else {
      expect(result.customers[0].stuckWatchdog).toBeUndefined();
    }
  });

  it.each([
    ['a non-finite x anchor', watchdog => ({ ...watchdog, x: Infinity })],
    ['a symbol x anchor', watchdog => ({ ...watchdog, x: Symbol('x') })],
    ['a non-finite y anchor', watchdog => ({ ...watchdog, y: NaN })],
    ['a string elapsed duration', watchdog => ({ ...watchdog, noProgressFor: 'Infinity' })],
    ['a symbol elapsed duration', watchdog => ({ ...watchdog, noProgressFor: Symbol('elapsed') })],
    ['a negative elapsed duration', watchdog => ({ ...watchdog, noProgressFor: -1 })],
  ])('safely resets invalid prior observation metadata with %s', (_name, corrupt) => {
    const initial = guidedState({
      id: 'guided', state: 'guided', x: 100, y: 100,
      path: [{ x: 6, y: 5 }, { x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
    });
    const observed = recoverStuckCustomers(initial, 0);
    const malformed = {
      ...observed,
      customers: [{
        ...observed.customers[0],
        stuckWatchdog: corrupt(observed.customers[0].stuckWatchdog),
      }],
    };
    let result;

    expect(() => {
      result = recoverStuckCustomers(malformed, 10);
    }).not.toThrow();

    expect(result.customers[0]).toMatchObject({
      x: 100,
      y: 100,
      path: initial.customers[0].path,
      stuckWatchdog: {
        state: 'guided',
        goalKey: observed.customers[0].stuckWatchdog.goalKey,
        x: 100,
        y: 100,
        noProgressFor: 0,
      },
    });
    expect(Number.isFinite(result.customers[0].stuckWatchdog.noProgressFor)).toBe(true);
  });

  it.each(['queued', 'waiting', 'seated', 'eating', 'checkout_processing'])(
    'does not monitor the %s lifecycle state',
    stateName => {
      const customer = {
        id: stateName, state: stateName, x: 100, y: 100, path: [],
        stuckWatchdog: { state: 'guided', goalKey: 'old', x: 100, y: 100, noProgressFor: 9 },
      };
      const result = recoverStuckCustomers(guidedState(customer), 1);
      expect(result.customers[0].stuckWatchdog).toBeUndefined();
    },
  );

  it('removes stale watchdog metadata from a fading leaver', () => {
    const result = recoverStuckCustomers(guidedState({
      id: 'leaver', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
      x: 980, y: 360, path: [],
      stuckWatchdog: { state: 'leaving', goalKey: 'old', x: 980, y: 360, noProgressFor: 9 },
    }), 1);
    expect(result.customers[0].stuckWatchdog).toBeUndefined();
  });

  it('removes stale watchdog metadata from a fading guided customer', () => {
    const result = recoverStuckCustomers(guidedState({
      id: 'guided-fading', state: 'guided', exitPhase: 'fading',
      x: 100, y: 100, path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 },
      stuckWatchdog: { state: 'guided', goalKey: 'old', x: 100, y: 100, noProgressFor: 9 },
    }), 1);
    expect(result.customers[0].stuckWatchdog).toBeUndefined();
  });

  it('recovers a same-cell pathless checkout customer through updateCustomers', () => {
    const checkoutPosition = { x: 840, y: 180 };
    const state = {
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
      staff: [{ id: 'cashier', role: 'waiter', x: 840, y: 100, path: [], task: null }],
      customers: [{
        id: 'checkout', state: 'checkout_moving', cashierStationId: 'cashier1',
        checkoutPosition, paymentQueuedAt: 1, paymentReady: false,
        x: 859, y: 199, path: [],
      }],
    };
    const observed = recoverStuckCustomers(state, 0);
    const aged = recoverStuckCustomers(observed, 9);

    const result = updateCustomers(aged, { gameDt: 0, movementDt: 1 });

    expect(result.customers[0]).toMatchObject({ x: 840, y: 180 });
    expect(result.customers[0].stuckWatchdog).toBeUndefined();
  });
});

describe('recoverStuckCustomers recovery', () => {
  const openState = overrides => ({
    ...baseState,
    chairs: [], tables: [], kitchenStations: [], serviceTables: [], cashierStations: [],
    doors: [{ id: 'door1', y: 340 }],
    ...overrides,
  });
  const ageToThreshold = state => recoverStuckCustomers(
    recoverStuckCustomers(state, 0),
    10,
  );

  it.each([
    ['guided', {
      id: 'guided', state: 'guided', x: 100, y: 100,
      path: [{ x: 6, y: 5 }, { x: 8, y: 5 }], pathGoal: { x: 8, y: 5 },
    }, { x: 8, y: 5 }],
    ['checkout_moving', {
      id: 'checkout', state: 'checkout_moving', x: 100, y: 100,
      checkoutPosition: { x: 200, y: 100 }, path: [],
    }, { x: 10, y: 5 }],
    ['leaving', {
      id: 'leaving', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
      x: 900, y: 360, path: [],
    }, { x: 49, y: 18 }],
  ])('relocates and replans a stuck %s customer at ten seconds', (_name, customer, goal) => {
    const result = ageToThreshold(openState({ customers: [{
      ...customer,
      stalledFor: 8,
      headOnRecovery: true,
      localConflictTarget: { x: 1, y: 1 },
    }] }));
    const recovered = result.customers[0];

    expect({ x: recovered.x, y: recovered.y }).not.toEqual({ x: customer.x, y: customer.y });
    expect(recovered.pathGoal).toEqual(goal);
    expect(recovered.stalledFor).toBe(0);
    expect(recovered.headOnRecovery).toBeUndefined();
    expect(recovered.localConflictTarget).toBeUndefined();
    expect(recovered.stuckWatchdog).toBeUndefined();
  });

  it('uses a safe exact checkout destination when start and goal share a cell', () => {
    const result = ageToThreshold(openState({
      customers: [{
        id: 'checkout', state: 'checkout_moving', x: 139, y: 119,
        checkoutPosition: { x: 120, y: 100 }, path: [],
      }],
    }));
    expect(result.customers[0]).toMatchObject({ x: 120, y: 100, path: [] });
  });

  it('skips an occupied first route position', () => {
    const state = openState({
      staff: [{ id: 'blocker', role: 'waiter', x: 120, y: 100, path: [] }],
      customers: [{
        id: 'stuck', state: 'guided', x: 100, y: 100,
        path: [{ x: 10, y: 5 }], pathGoal: { x: 10, y: 5 },
      }],
    });
    const result = ageToThreshold(state);
    const recovered = result.customers[0];

    expect(recovered).toMatchObject({ x: 140, y: 100 });
    expect(Math.hypot(recovered.x - 120, recovered.y - 100)).toBeGreaterThanOrEqual(16);
  });

  it('rejects a blocked same-cell exact candidate', () => {
    const path = [{ x: 8, y: 8 }];
    const state = openState({
      tables: [{ id: 'block', x: 120, y: 100, status: 'occupied' }],
      customers: [{
        id: 'checkout', state: 'checkout_moving', x: 139, y: 119,
        checkoutPosition: { x: 120, y: 100 }, path,
      }],
    });

    const result = ageToThreshold(state);

    expect(worldToCell(state.customers[0])).toEqual(worldToCell(state.customers[0].checkoutPosition));
    expect(buildBlockedCells(state).has('6,5')).toBe(true);
    expect(result.customers[0]).toMatchObject({
      x: 139,
      y: 119,
      path,
      stuckWatchdog: { noProgressFor: 10 },
    });
  });

  const world = getRestaurantWorld(baseState.restaurant);
  it.each([
    ['left', { x: world.floorX, y: 200 }, { x: world.floorX - 1, y: 200 }],
    ['right', { x: world.queueX + world.queueW - 1, y: 640 }, { x: world.queueX + world.queueW + 1, y: 640 }],
    ['top', { x: 200, y: world.kitchenY }, { x: 200, y: world.kitchenY - 1 }],
    ['bottom', { x: 800, y: world.diningY + world.areaH + 49 }, { x: 800, y: world.diningY + world.areaH + 51 }],
  ])('rejects a same-cell exact checkout goal outside the %s world boundary', (_name, position, checkoutPosition) => {
    const path = [{ x: 8, y: 8 }];
    const state = openState({
      customers: [{
        id: 'checkout', state: 'checkout_moving', ...position, checkoutPosition, path,
      }],
    });

    const result = ageToThreshold(state);

    expect(worldToCell(position)).toEqual(worldToCell(checkoutPosition));
    expect(result.customers[0]).toMatchObject({
      ...position,
      path,
      stuckWatchdog: { noProgressFor: 10 },
    });
  });

  it('preserves position and path until the next ten-second retry interval', () => {
    const stuck = {
      id: 'stuck', state: 'guided', x: 100, y: 100,
      path: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 10, y: 5 }],
      pathGoal: { x: 10, y: 5 },
    };
    const blockers = [120, 140, 160, 180, 200].map(x => ({
      id: `blocker-${x}`, state: 'eating', x, y: 100, path: [],
    }));
    const blocked = ageToThreshold(openState({ customers: [stuck, ...blockers] }));
    const unblocked = { ...blocked, customers: [blocked.customers[0]] };
    const beforeNextInterval = recoverStuckCustomers(unblocked, 9);
    const retried = recoverStuckCustomers(beforeNextInterval, 1);

    expect(blocked.customers[0]).toMatchObject({ x: 100, y: 100, path: stuck.path });
    expect(blocked.customers[0].stuckWatchdog.noProgressFor).toBe(10);
    expect(beforeNextInterval.customers[0]).toMatchObject({ x: 100, y: 100 });
    expect(retried.customers[0].x).toBe(120);
    expect(retried.customers[0].stuckWatchdog).toBeUndefined();
  });

  it('recovers simultaneous customers by stable ID without changing array order', () => {
    const customers = ['b', 'a'].map(id => ({
      id, state: 'guided', x: 100, y: 100,
      path: [{ x: 6, y: 5 }, { x: 10, y: 5 }], pathGoal: { x: 10, y: 5 },
    }));
    const result = ageToThreshold(openState({ customers }));

    expect(result.customers.map(customer => customer.id)).toEqual(['b', 'a']);
    expect(result.customers.find(customer => customer.id === 'a')).toMatchObject({ x: 120, y: 100 });
    expect(result.customers.find(customer => customer.id === 'b')).toMatchObject({ x: 140, y: 100 });
    expect(Math.hypot(
      result.customers[0].x - result.customers[1].x,
      result.customers[0].y - result.customers[1].y,
    )).toBeGreaterThanOrEqual(16);
  });
});
