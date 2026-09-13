import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  getCustomerMovementEntries,
  getExitHeading,
  getQueueSafeExitGoal,
  prepareCustomersForMovement,
  resolveCustomersAfterMovement,
  spawnCustomers,
  updateCustomers,
} from './customers';
import { getQueuePartyCount, getQueueProjectedMembers, getQueueVisibleMembers, reconcileQueueSlots } from './customerQueue';
import { UPGRADES } from '../data/upgrades';
import { createInitialState } from '../state/initialState';
import { hydrateState, loadState, saveState } from '../state/persistence';

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

  it('avoids hydrated customer and party identities and leaves the existing pending review untouched', async () => {
    vi.resetModules();
    const [{ spawnCustomers: spawnAfterReload }, { hydrateState }, { createInitialState }, partyReviews] = await Promise.all([
      import('./customers'),
      import('../state/persistence'),
      import('../state/initialState'),
      import('./partyReviews'),
    ]);
    const fresh = createInitialState();
    const pendingPartyReviews = [
      {
        partyId: 'p1', memberIds: ['c1'], orderedMemberIds: [],
        unaffordableMemberIds: [], paidReviews: [],
      },
      {
        partyId: 'p4', memberIds: ['c4'], orderedMemberIds: ['c4'],
        unaffordableMemberIds: [], paidReviews: [],
      },
    ];
    const partyReviewHistory = [{
      partyId: 'p5', day: 1, score: 80, memberCount: 1,
      paidCount: 1, unaffordableCount: 0, reputationDelta: 0.016,
    }];
    const hydrated = hydrateState({
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 12 * 3600 },
      customers: [{ id: 'c1', partyId: 'p1', state: 'seated' }],
      queue: [{ partyId: 'p2', members: [{ id: 'c2', partyId: 'p2', state: 'queued' }] }],
      completedCustomers: [{ customerId: 'c3', revenue: 10 }],
      pendingPartyReviews,
      partyReviewHistory,
    }, fresh);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const spawned = spawnAfterReload(hydrated, 60);
    const newParty = spawned.queue.at(-1);
    const newMember = newParty.members[0];
    const existingCustomerIds = new Set(['c1', 'c2', 'c3', 'c4']);
    const existingPartyIds = new Set(['p1', 'p2', 'p4', 'p5']);
    const recorded = partyReviews.recordPartyOrderOutcome(
      hydrated.pendingPartyReviews,
      newParty.members,
      newMember,
      'ordered',
    );

    expect(existingCustomerIds.has(newMember.id)).toBe(false);
    expect(existingPartyIds.has(newParty.partyId)).toBe(false);
    expect(recorded[0]).toEqual(pendingPartyReviews[0]);
    expect(recorded).toHaveLength(3);
  });

  it('scales spawning probability by elapsed time instead of animation frames', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.03);

    const frameResult = spawnCustomers(baseState, 1);
    const oneRealSecondResult = spawnCustomers(baseState, 60);

    expect(frameResult.queue).toHaveLength(0);
    expect(oneRealSecondResult.queue).toHaveLength(1);
  });

  it('spawns dinner-rush parties every 8 to 15 real seconds on average', () => {
    const dinner = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 18.5 * 3600 } };
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
    for (let i = 0; i < 100; i += 1) result = spawnCustomers(result);
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
    expect(['regular', 'foodie', 'rusher', 'influencer']).toContain(result.queue[0].members[0].archetype);
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
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.8);

    const result = spawnCustomers(baseState, 1);

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0].members.map(customer => customer.partyType)).toEqual(['couple', 'couple']);
    expect(result.queue[0].members.map(customer => customer.partySize)).toEqual([2, 2]);
    expect(new Set(result.queue[0].members.map(customer => customer.partyId)).size).toBe(1);
    expect(result.queue[0].members.map(customer => customer.gender)).toEqual(['male', 'female']);
  });

  it.each([
    [0.449999, 1, 'solo'],
    [0.45, 2, 'couple'],
    [0.799999, 2, 'couple'],
    [0.8, 3, 'triple'],
    [0.899999, 3, 'triple'],
    [0.9, 4, 'family'],
  ])('uses the approved party boundary %s for a %s-person %s',
    (partyRoll, expectedSize, expectedType) => {
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0)
        .mockReturnValue(partyRoll);

      const result = spawnCustomers(baseState, 60);
      const members = result.queue[0].members;

      expect(members).toHaveLength(expectedSize);
      expect(members.every(customer => customer.partyType === expectedType)).toBe(true);
      expect(members.every(customer => customer.partySize === expectedSize)).toBe(true);
      expect(new Set(members.map(customer => customer.partyId)).size).toBe(1);
    });

  it('assigns independent spending profiles to members of one party', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.999999)
      .mockReturnValueOnce(0.999999);

    const result = spawnCustomers(baseState, 60);
    const members = result.queue[0].members;
    expect(new Set(members.map(member => member.partyId))).toEqual(new Set([members[0].partyId]));
    expect(members.map(member => [member.spendingTier, member.spendingBudget]))
      .toEqual([['budget', 6], ['premium', 120]]);
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

function movementState(overrides = {}) {
  return {
    ...baseState,
    doors: [
      { id: 'door1', y: 340, role: 'entrance' },
      { id: 'door2', y: 440, role: 'exit' },
    ],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    ...overrides,
  };
}

function clearedResidency(customer) {
  return {
    ...customer,
    seatResidency: {
      schema: 1, phase: 'clear', actorId: String(customer.id),
      partyId: customer.partyId == null ? null : String(customer.partyId),
    },
  };
}

function occupiedOwningTable(overrides = {}) {
  return {
    id: 't1', seats: 2, status: 'occupied', x: 200, y: 200,
    diningPartyId: 'p1', diningCustomerIds: ['c1'], ...overrides,
  };
}

function status(plan, motion = 'holding') {
  return { plan, motion };
}

describe('customer goal preparation and movement descriptors', () => {
  it('prepares checkout and door goals without changing coordinates', () => {
    const checkout = {
      id: 'checkout', state: 'paying', x: 400, y: 300,
      paymentQueuedAt: 10, patience: 100,
    };
    const leaving = {
      id: 'leaving', state: 'leaving', exitPhase: 'to_door',
      exitDoorId: 'door1', x: 500, y: 300, patience: 100,
    };
    const prepared = prepareCustomersForMovement(movementState({
      staff: [{ id: 'cashier', role: 'waiter' }],
      cashierStations: [{ id: 'register', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
      customers: [checkout, leaving],
    }), 0);

    expect(prepared.customers[0]).toMatchObject({
      state: 'checkout_moving', navigationGoal: { x: 840, y: 180 },
    });
    expect(prepared.customers[1]).toMatchObject({
      state: 'leaving', exitDoorId: 'door2', navigationGoal: { x: 993, y: 460 },
    });
    expect(prepared.customers.map(customer => ({ x: customer.x, y: customer.y })))
      .toEqual([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
  });

  it('retains a selected door goal across repeated preparation', () => {
    const customer = {
      id: 'leaving', state: 'leaving', exitPhase: 'to_door', x: 500, y: 300,
      patience: 100,
    };
    const first = prepareCustomersForMovement(movementState({ customers: [customer] }), 0);
    const goal = first.customers[0].navigationGoal;
    const second = prepareCustomersForMovement(first, 0);

    expect(second.customers[0].navigationGoal).toBe(goal);
    expect(second.customers[0]).toMatchObject({ exitDoorId: 'door2', navigationGoal: { x: 993, y: 460 } });
  });

  it('emits every finite active customer and synthetic queue blockers without routes', () => {
    const state = movementState({
      queue: [{ partyId: 'p1', members: [{ id: 'queued', partyId: 'p1', state: 'queued' }] }],
      queueSlots: [{ memberId: 'queued', partyId: 'p1', x: 973, y: 390, slot: 0 }],
      customers: [
        { id: 'idle', state: 'eating', x: 300, y: 300 },
        { id: 'missing-position', state: 'eating', x: Number.NaN, y: 300 },
      ],
    });

    const entries = getCustomerMovementEntries(state, 1);
    const projected = getQueueProjectedMembers(state, state.queue)[0];
    const idle = entries.find(entry => entry.character.id === 'idle');
    const queued = entries.find(entry => entry.character.id === 'queued');

    expect(entries).toHaveLength(2);
    expect(idle).toMatchObject({ speed: 0, terminalPolicy: 'hold', queueRank: null });
    expect(queued).toMatchObject({
      speed: 0, provenance: 'queue', character: { id: 'queued', x: projected.x, y: projected.y },
    });
  });

  it('allows non-fading customers to approach one door while leaving independent doors concurrent', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, expansionLevel: 1 },
       doors: [
         { id: 'door1', y: 340, role: 'exit' },
         { id: 'door2', y: 180, role: 'exit' },
       ],
      customers: [
        {
          id: 'door1-first', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
          x: 860, y: 280, navigationGoal: { x: 993, y: 360 },
        },
        {
          id: 'door1-second', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
          x: 860, y: 440, navigationGoal: { x: 993, y: 360 },
        },
        {
          id: 'door2-only', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door2',
          x: 860, y: 200, navigationGoal: { x: 993, y: 200 },
        },
      ],
    };

    const entries = getCustomerMovementEntries(state, 1);

    expect(entries.find(entry => entry.character.id === 'door1-first')).toMatchObject({ speed: 55 });
    expect(entries.find(entry => entry.character.id === 'door1-second')).toMatchObject({ speed: 55, doorApproach: true });
    expect(entries.find(entry => entry.character.id === 'door2-only')).toMatchObject({ speed: 55 });
    expect(entries.find(entry => entry.character.id === 'door1-second').character.navigationGoal)
      .toEqual({ x: 993, y: 360 });
  });

  it('does not commit synthetic queue blockers into the customer collection', () => {
    const state = movementState({
      queue: [{ partyId: 'p1', members: [{ id: 'queued', partyId: 'p1', state: 'queued' }] }],
      customers: [],
    });

    const result = updateCustomers(state, { gameDt: 0, movementDt: 0 });

    expect(result.customers).toEqual([]);
    expect(result.queue).toHaveLength(1);
    expect(result.movementCoordinator.requests.get('queued').speed).toBe(0);
    expect(result.movementCoordinator.plans.get('queued').every(action => action.from.x === action.to.x && action.from.y === action.to.y)).toBe(true);
  });

  it('describes checkout, door, fading, and entering goals with domain priorities', () => {
    const state = movementState({
      customers: [
        {
          id: 'checkout', state: 'checkout_moving', checkoutQueueIndex: 1, cashierStationId: 'register',
          checkoutPosition: { x: 840, y: 200 }, navigationGoal: { x: 840, y: 200 },
          x: 400, y: 300,
        },
         {
           id: 'door', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door2',
           navigationGoal: { x: 993, y: 460 }, x: 500, y: 300,
         },
         {
           id: 'fading', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door2',
           navigationGoal: { x: 1113, y: 460 }, x: 993, y: 460,
         },
        {
          id: 'entering', state: 'entering', entryDoorId: 'door1', tableId: 't1', chairId: 'ch1',
          navigationGoal: { x: 220, y: 190 }, x: 600, y: 300,
        },
      ],
    });

    const entries = getCustomerMovementEntries(state, 1);

    expect(entries.find(entry => entry.character.id === 'checkout')).toMatchObject({
      speed: 62, queueRank: 1, terminalPolicy: 'hold',
      doorFlow: { doorId: null, direction: 'none' },
    });
    expect(entries.find(entry => entry.character.id === 'door')).toMatchObject({
      speed: 55, terminalPolicy: 'hold', doorFlow: { doorId: 'door2', direction: 'egress' },
    });
    expect(entries.find(entry => entry.character.id === 'fading')).toMatchObject({
      speed: 30, terminalPolicy: 'release', doorFlow: { doorId: 'door2', direction: 'egress' },
    });
    expect(entries.find(entry => entry.character.id === 'entering')).toMatchObject({
      speed: 62, provenance: 'customer', doorFlow: { doorId: 'door1', direction: 'ingress' },
      ignoredIds: [],
    });
    expect(entries.find(entry => entry.character.id === 'checkout').provenance).toBe('customer');
  });

  it('constrains aligned checkout advancement but keeps table-to-queue travel on normal routing', () => {
    const state = movementState({
      cashierStations: [{ id: 'register', x: 800, y: 120, w: 80, h: 40 }],
      customers: [
        {
          id: 'aligned', state: 'checkout_moving', cashierStationId: 'register',
          checkoutQueueIndex: 0, checkoutPosition: { x: 840, y: 180 },
          navigationGoal: { x: 840, y: 180 }, x: 840, y: 200, checkoutLineMember: true,
        },
        {
          id: 'joining', state: 'checkout_moving', cashierStationId: 'register',
          checkoutQueueIndex: 1, checkoutPosition: { x: 840, y: 200 },
          navigationGoal: { x: 840, y: 200 }, x: 400, y: 300,
        },
      ],
    });

    const entries = getCustomerMovementEntries(state, 1);
    expect(entries.find(entry => entry.character.id === 'aligned').checkoutAdvance).toEqual({
      stationId: 'register', queueRank: 0, goal: { x: 840, y: 180 },
    });
    expect(entries.find(entry => entry.character.id === 'joining')).not.toHaveProperty('checkoutAdvance');
  });

  it('does not constrain a table customer before it reaches its checkout queue slot', () => {
    const state = movementState({
      tables: [{ id: 'blocking-table', x: 820, y: 240, status: 'occupied' }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
      customers: [{
        id: 'table-joiner', state: 'checkout_moving', tableId: 'blocking-table',
        cashierStationId: 'cashier1', checkoutQueueIndex: 1,
        checkoutPosition: { x: 840, y: 200 }, navigationGoal: { x: 840, y: 200 },
        x: 840, y: 300,
      }],
    });

    const entry = getCustomerMovementEntries(state, 1)[0];

    expect(entry).not.toHaveProperty('checkoutAdvance');
  });

  it('retains the deterministic customer-specific base exit heading', () => {
    const first = getExitHeading('c1');
    const repeated = getExitHeading('c1');

    expect(repeated).toEqual(first);
    expect([-35, 0, 35]).toContain(first.angleDegrees);
    expect(first.x).toBeGreaterThan(0);
  });

  it('advances a goal-bearing customer through the public cooperative batch and persists its coordinator', () => {
    let state = movementState({
      staff: [{ id: 'cashier', role: 'waiter', x: 840, y: 100 }],
      cashierStations: [{ id: 'register', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
      customers: [{
        id: 'c1', state: 'checkout_moving', cashierStationId: 'register',
        paymentQueuedAt: 10, x: 400, y: 300,
      }],
    });

    for (let tick = 0; tick < 20; tick += 1) {
      state = updateCustomers(state, { gameDt: 0, movementDt: 1 });
    }

    expect(state.movementCoordinator).toBeDefined();
    expect(state.customers[0]).toMatchObject({
      checkoutPosition: { x: 840, y: 180 }, paymentReady: true,
    });
    expect(Math.hypot(state.customers[0].x - 840, state.customers[0].y - 180)).toBeLessThanOrEqual(2);
  });

  it('retains finite staff blockers while the customer wrapper advances one persistent batch', () => {
    const state = movementState({
      staff: [{
        id: 'staff-blocker', role: 'waiter', x: 300, y: 300,
        navigationGoal: { x: 360, y: 300 }, task: null,
      }],
      customers: [{
        id: 'customer', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
        x: 500, y: 300, navigationGoal: { x: 620, y: 300 },
      }],
    });

    const result = updateCustomers(state, { gameDt: 0, movementDt: 1 });

    expect(result.staff[0]).toMatchObject({
      id: 'staff-blocker', x: 300, y: 300, navigationGoal: { x: 360, y: 300 },
    });
    expect(result.movementCoordinator.requests.get('staff-blocker').speed).toBe(0);
    expect(result.movementCoordinator.requests.has('customer')).toBe(true);
  });
});

describe('stable fading goals', () => {
  it.each([
    [1, 390, 35],
    [2, 390, -35],
    [3, 420, 60],
    [4, 420, -60],
    [5, 450, 60],
  ])('evaluates exit candidates in deterministic order for %s projected members', (memberCount, y, expectedAngle) => {
    const state = movementState({
      queue: [{
        partyId: 'p1',
        members: Array.from({ length: memberCount }, (_, index) => ({
          id: `queued-${index}`, state: 'queued',
        })),
      }],
      queueSlots: Array.from({ length: memberCount }, (_, index) => ({
        memberId: `queued-${index}`,
        partyId: 'p1',
        x: 973,
        y: 390 + index * 30,
        slot: index,
      })),
    });
    const customer = { id: 'c2', state: 'leaving', x: 933, y };
    const goal = getQueueSafeExitGoal(state, customer);
    const angle = Math.round(Math.atan2(goal.y - customer.y, goal.x - customer.x) * 180 / Math.PI);

    expect(angle).toBe(expectedAngle);
    expect(Math.hypot(goal.x - customer.x, goal.y - customer.y)).toBeCloseTo(120);
  });

  it('chooses the first clear candidate and returns a full 120 px goal', () => {
    const state = movementState({ customers: [] });
    const customer = { id: 'c2', state: 'leaving', x: 993, y: 360 };

    const goal = getQueueSafeExitGoal(state, customer);

    expect(goal).toEqual({ x: 1113, y: 360 });
    expect(Math.hypot(goal.x - customer.x, goal.y - customer.y)).toBe(120);
  });

  it('uses preferred-sign 35 degree alternatives after a blocked direct candidate', () => {
    const state = movementState({
      queue: [{ partyId: 'p1', members: [{ id: 'queued', state: 'queued' }] }],
      queueSlots: [{ memberId: 'queued', partyId: 'p1', x: 973, y: 390, slot: 0 }],
    });
    const customer = { id: 'c2', state: 'leaving', x: 933, y: 390 };
    const goal = getQueueSafeExitGoal(state, customer);
    const angle = Math.round(Math.atan2(goal.y - customer.y, goal.x - customer.x) * 180 / Math.PI);

    expect(angle).toBe(35);
    expect(Math.hypot(goal.x - customer.x, goal.y - customer.y)).toBeCloseTo(120);
  });

  it('falls back to the first deterministic heading while retaining the full goal when every prefix is zero', () => {
    const state = movementState({
      queue: [{ partyId: 'p1', members: [{ id: 'queued', state: 'queued' }] }],
      queueSlots: [{ memberId: 'queued', partyId: 'p1', x: 973, y: 390, slot: 0 }],
    });
    const customer = { id: 'c1', state: 'leaving', x: 973, y: 390 };

    const goal = getQueueSafeExitGoal(state, customer);

    expect(goal).toEqual({ x: 1093, y: 390 });
    expect(Math.hypot(goal.x - customer.x, goal.y - customer.y)).toBe(120);
  });

  it('starts fading only after an arrived door status and creates one stable terminal goal', () => {
    const atDoor = movementState({
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
        x: 993, y: 360, navigationGoal: { x: 993, y: 360 },
      }],
    });

    const faded = resolveCustomersAfterMovement(atDoor, 0, new Map([
      ['c1', status('arrived')],
    ]));
    const customer = faded.customers[0];

    expect(customer).toMatchObject({ exitPhase: 'fading', exitFadeProgress: 0 });
    expect(Math.hypot(
      customer.navigationGoal.x - customer.x,
      customer.navigationGoal.y - customer.y,
    )).toBeCloseTo(120);
    const repeated = resolveCustomersAfterMovement(faded, 0, new Map([
      ['c1', status('planning')],
    ]));
    expect(repeated.customers[0].navigationGoal).toBe(customer.navigationGoal);
  });

  it('does not increase fade progress while the planner is waiting', () => {
    const state = movementState({
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'fading', x: 993, y: 360,
        navigationGoal: { x: 1113, y: 360 }, exitFadeProgress: 0,
      }],
    });

    const waiting = resolveCustomersAfterMovement(state, 10, new Map([
      ['c1', status('planning')],
    ]));

    expect(waiting.customers[0]).toMatchObject({ exitFadeProgress: 0, x: 993, y: 360 });
  });

  it('derives partial fade progress from actual committed distance', () => {
    const state = movementState({
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'fading', x: 1023, y: 360,
        navigationGoal: { x: 1113, y: 360 }, exitFadeProgress: 0,
      }],
    });

    const partial = resolveCustomersAfterMovement(state, 99, new Map([
      ['c1', status('scheduled', 'traversing')],
    ]));

    expect(partial.customers[0].exitFadeProgress).toBe(0.25);
  });

  it('commits fading travel against the stable terminal goal rather than a frame-sized target', () => {
    let state = movementState({
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1',
        x: 993, y: 360, navigationGoal: { x: 1113, y: 360 }, exitFadeProgress: 0,
      }],
    });

    state = updateCustomers(state, { gameDt: 0, movementDt: 1 });
    expect(state.customers[0]).toMatchObject({ x: 1023, exitFadeProgress: 0.25 });
    state = updateCustomers(state, { gameDt: 0, movementDt: 1 });
    expect(state.customers[0].x).toBeGreaterThan(993);
    expect(state.customers[0].exitFadeProgress).toBeCloseTo((state.customers[0].x - 993) / 120);
  });

  it('removes a fading customer only at terminal arrival', () => {
    const state = movementState({
      customers: [{
        id: 'c1', state: 'leaving', exitPhase: 'fading', x: 1113, y: 360,
        navigationGoal: { x: 1113, y: 360 }, exitFadeProgress: 0.99,
      }],
    });

    const completed = resolveCustomersAfterMovement(state, 0, new Map([
      ['c1', status('arrived')],
    ]));

    expect(completed.customers).toEqual([]);
  });

  it('retains stale fade progress when the stable terminal goal is missing or malformed', () => {
    const states = [
      movementState({ customers: [{
        id: 'missing', state: 'leaving', exitPhase: 'fading',
        x: 1113, y: 360, exitFadeProgress: 1,
      }] }),
      movementState({ customers: [{
        id: 'malformed', state: 'leaving', exitPhase: 'fading',
        x: 1113, y: 360, navigationGoal: { x: Number.NaN, y: 360 }, exitFadeProgress: 1,
      }] }),
      movementState({ customers: [{
        id: 'stale', state: 'leaving', exitPhase: 'fading',
        x: 1113, y: 360, navigationGoal: { x: 1200, y: 360 }, exitFadeProgress: 1,
      }] }),
    ];

    for (const state of states) {
      const [customer] = state.customers;
      const result = resolveCustomersAfterMovement(state, 0, new Map([
        [customer.id, status('arrived')],
      ]));
      expect(result.customers).toHaveLength(1);
      if (customer.id === 'stale') {
        expect(result.customers[0].exitFadeProgress).toBeLessThan(1);
      } else {
        expect(result.customers[0].exitFadeProgress).toBe(1);
      }
    }
  });

  it('retains a finite-goal fade at progress one while the planner is still waiting', () => {
    const state = movementState({
      customers: [{
        id: 'waiting', state: 'leaving', exitPhase: 'fading',
        x: 1113, y: 360, navigationGoal: { x: 1113, y: 360 }, exitFadeProgress: 1,
      }],
    });

    const result = resolveCustomersAfterMovement(state, 0, new Map([
      ['waiting', status('planning')],
    ]));

    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].exitFadeProgress).toBe(1);
  });
});

describe('customer lifecycle', () => {
  it('prepares without draining indoor patience and without moving customer coordinates', () => {
    const state = movementState({
      customers: [{ id: 'c1', state: 'waiting', patience: 10, happiness: 50, x: 400, y: 300 }],
    });

    const prepared = prepareCustomersForMovement(state, 2);

    expect(prepared.customers[0]).toMatchObject({ patience: 10, x: 400, y: 300 });
  });

  it('keeps a waiting customer seated when indoor patience runs out', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 5, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };

    const result = updateCustomers({ ...baseState, customers: [customer] }, { gameDt: 10, movementDt: 0 });

    expect(result.customers[0]).toMatchObject({ patience: 5, state: 'waiting' });
    expect(result.restaurant.reputation).toBe(3.0);
  });

  it('makes the whole queued party leave and lowers reputation once per abandoning party', () => {
    const state = {
      ...baseState,
      queue: [{
        partyId: 'p1',
        members: [
          { id: 'q1', partyId: 'p1', state: 'queued', patience: 1, happiness: 80 },
          { id: 'q2', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
        ],
      }],
    };

    const abandoned = updateCustomers(state, 2);
    const updatedAgain = updateCustomers(abandoned, 2);

    expect(abandoned.restaurant.reputation).toBe(2.9);
    expect(abandoned.customers.map(customer => customer.state)).toEqual(['leaving', 'leaving']);
    expect(abandoned.customers.every(customer => customer.reputationApplied)).toBe(true);
    expect(updatedAgain.restaurant.reputation).toBe(2.9);
  });

  it('sends outside queued parties away without a reputation penalty when closed', () => {
    const queue = [
      { id: 'q1', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
      { id: 'q2', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
    ];
    const state = {
      ...movementState(),
      restaurant: { ...baseState.restaurant, gameTime: 22 * 3600 },
      queue,
    };

    const result = updateCustomers(state, { gameDt: 60, movementDt: 0 });

    expect(result.queue).toEqual([]);
    expect(result.customers).toHaveLength(2);
    expect(result.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(result.customers.every(customer => customer.reputationApplied)).toBe(true);
    expect(result.restaurant.reputation).toBe(3);
  });

  it('marks the dining table dirty when the final customer physically clears checkout or departure', () => {
    const customer = clearedResidency({
      id: 'c1', partyId: 'p1', state: 'checkout_queued', tableId: 't1', patience: 100, happiness: 80,
    });
    const tables = baseState.tables.map(table => table.id === 't1'
      ? occupiedOwningTable()
      : table);

    const result = updateCustomers({ ...baseState, customers: [customer], tables }, { gameDt: 0, movementDt: 0 });

    expect(result.tables.find(table => table.id === 't1').status).toBe('dirty');
  });

  it('keeps the dining table occupied while the final customer is still physically seated', () => {
    const customer = {
      id: 'c1', partyId: 'p1', state: 'checkout_queued', tableId: 't1', patience: 100, happiness: 80, x: 220, y: 190,
      seatResidency: { schema: 1, phase: 'seated', actorId: 'c1', partyId: 'p1' },
    };
    const tables = baseState.tables.map(table => table.id === 't1'
      ? occupiedOwningTable()
      : table);

    const result = updateCustomers({ ...baseState, customers: [customer], tables }, { gameDt: 0, movementDt: 0 });

    expect(result.tables.find(table => table.id === 't1').status).toBe('occupied');
  });
});

describe('restored baseline customer gameplay', () => {
  it('does not reduce indoor patience over time', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 2);

    expect(result.customers[0].patience).toBe(100);
  });

  it('does not reduce patience while waiting for service items', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting_for_items', dishId: 'd1', drinkId: 'water', tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: 2, eatTime: null,
    };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 2);

    expect(result.customers[0].patience).toBe(100);
  });

  it('moves an arriving customer to waiting without assigning movement intent', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'arriving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 1);

    expect(result.customers[0].state).toBe('waiting');
    expect(result.customers[0]).not.toHaveProperty('navigationGoal');
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

    expect(result.customers.map(customer => customer.state)).toEqual([
      'checkout_moving', 'checkout_moving',
    ]);
    expect(result.customers.map(customer => customer.checkoutPosition)).toEqual([
      { x: 840, y: 180 }, { x: 840, y: 200 },
    ]);
    expect(result.customers.map(customer => customer.navigationGoal)).toEqual([
      { x: 840, y: 180 }, { x: 840, y: 200 },
    ]);
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
    expect(result.customers.map(customer => customer.checkoutPosition)).toEqual([
      { x: 440, y: 360 }, { x: 440, y: 380 },
    ]);
  });

  it('distributes unassigned paying customers across the shortest staffed queues', () => {
    const state = {
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      staff: [{ id: 'w1', role: 'waiter' }, { id: 'w2', role: 'waiter' }],
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

  it('keeps leaving customers visible while they move towards an exit', () => {
    const customer = clearedResidency({
      id: 'c1', partyId: 'p1', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    });
    const state = {
      ...movementState({ customers: [customer] }),
      tables: baseState.tables.map(table => table.id === 't1' ? occupiedOwningTable() : table),
    };

    const result = updateCustomers(state, 1);

    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]).toMatchObject({
      state: 'leaving', exitDoorId: 'door2', navigationGoal: { x: 993, y: 460 },
    });
    expect(result.tables.find(table => table.id === 't1').status).toBe('dirty');
  });

  it('does not auto-seat a queued customer when a table frees', () => {
    const leavingCustomer = clearedResidency({
      id: 'c2', partyId: 'p2', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    });
    const queuedCustomer = {
      id: 'q1', archetype: 'foodie', patience: 150, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const result = updateCustomers({
      ...movementState({
        customers: [leavingCustomer],
        queue: [{ partyId: 'q1', members: [queuedCustomer] }],
      }),
      tables: baseState.tables.map(table => table.id === 't1'
        ? occupiedOwningTable({ diningPartyId: 'p2', diningCustomerIds: ['c2'] })
        : table),
    }, 1);

    expect(result.customers).toHaveLength(1);
    expect(result.queue).toHaveLength(1);
    expect(result.tables.find(table => table.id === 't1').status).toBe('dirty');
  });

  it('uses separate doors for simultaneous departures when available', () => {
    const result = prepareCustomersForMovement(movementState({
      customers: [
        { id: 'c1', state: 'leaving', x: 400, y: 300, patience: 0, happiness: 80 },
        { id: 'c2', state: 'leaving', x: 420, y: 300, patience: 0, happiness: 80 },
      ],
      doors: [
        { id: 'door1', y: 300, role: 'exit' },
        { id: 'door2', y: 420, role: 'exit' },
      ],
    }), 0);

    expect(new Set(result.customers.map(customer => customer.exitDoorId)))
      .toEqual(new Set(['door1', 'door2']));
  });

  it('moves a queued customer to leaving when queue patience runs out', () => {
    const queuedCustomer = {
      id: 'q1', archetype: 'rusher', patience: 5, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const result = updateCustomers({
      ...baseState,
      doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: [{ partyId: 'q1', members: [queuedCustomer] }],
    }, { gameDt: 10, movementDt: 0.1 });

    expect(result.queue).toHaveLength(0);
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].state).toBe('leaving');
  });

  it('accelerates queued patience loss as the number of parties grows', () => {
    const queue = Array.from({ length: 6 }, (_, index) => ({
      partyId: `p${index}`,
      members: [{
        id: `q${index}`, partyId: `p${index}`, state: 'queued',
        patience: 100, patienceMax: 100, queuePatience: 100, queuePatienceMax: 100,
        happiness: 80,
      }],
    }));

    const result = updateCustomers({ ...baseState, queue }, 2);

    expect(result.queue[0].members[0]).toMatchObject({ patience: 100, queuePatience: 97 });
  });

  it('does not reduce patience while an admitted customer is eating', () => {
    const result = updateCustomers({
      ...baseState, customers: [{ id: 'c1', state: 'eating', patience: 100, happiness: 80 }],
    }, 10);

    expect(result.customers[0].patience).toBe(100);
  });

  it.each(['entering', 'ordering', 'eating'])('does not reduce patience while a customer is %s', stateName => {
    const result = updateCustomers({
      ...baseState, customers: [{ id: 'c1', state: stateName, patience: 100, happiness: 80 }],
    }, 10);

    expect(result.customers[0].patience).toBe(100);
  });

  it.each(['checkout_queued', 'checkout_moving', 'checkout_processing'])
    ('preserves patience while a customer is %s', stateName => {
      const result = updateCustomers({
        ...baseState,
        customers: [{ id: 'c1', state: stateName, patience: 100, happiness: 80 }],
      }, 10);

      expect(result.customers[0].patience).toBe(100);
    });

  it.each(['checkout_queued', 'checkout_moving', 'checkout_processing'])
    ('releases the dining table after its final physically cleared customer is %s', stateName => {
      const customer = clearedResidency({
        id: 'c1', partyId: 'p1', state: stateName, tableId: 't1', patience: 100, happiness: 80,
      });
      const tables = baseState.tables.map(table => table.id === 't1'
        ? occupiedOwningTable()
        : table);

      const result = updateCustomers({ ...baseState, customers: [customer], tables }, { gameDt: 0, movementDt: 0 });

      expect(result.tables.find(table => table.id === 't1').status).toBe('dirty');
    });

  it.each(['occupied', 'reserved'])
    ('does not dirty an in-use %s table before physical clearance and retains its owner', tableStatus => {
      const customer = {
        id: 'payer', partyId: 'p1', state: 'checkout_queued', tableId: 't1',
        patience: 100, happiness: 80, x: 400, y: 300,
        seatResidency: { schema: 1, phase: 'seated', actorId: 'payer', partyId: 'p1' },
      };
      const tables = baseState.tables.map(table => table.id === 't1'
        ? { ...table, status: tableStatus, diningPartyId: 'p1', diningCustomerIds: ['payer'] }
        : table);

      const result = updateCustomers({ ...baseState, customers: [customer], tables }, { gameDt: 0, movementDt: 0 });
      const table = result.tables.find(candidate => candidate.id === 't1');

      expect(table.status).toBe(tableStatus);
      expect(table.diningPartyId).toBe('p1');
      expect(result.customers[0].tableId).toBe('t1');
    });

  it.each(['checkout_queued', 'checkout_moving', 'checkout_processing', 'leaving'])
    ('does not re-dirty an empty table for a former customer in %s', stateName => {
      const customer = {
        id: 'former', state: stateName, tableId: 't1', patience: 100, happiness: 80, x: 400, y: 300,
        ...(stateName === 'leaving' ? { exitPhase: 'to_door' } : {}),
      };
      let current = {
        ...baseState,
        customers: [customer],
        tables: baseState.tables.map(table => table.id === 't1'
          ? { ...table, status: 'empty' }
          : table),
      };

      current = prepareCustomersForMovement(current, 0);
      current = prepareCustomersForMovement(current, 0);

      expect(current.tables.find(table => table.id === 't1').status).toBe('empty');
      expect(current.customers.find(candidate => candidate.id === 'former').tableId).toBe('t1');
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
    const result = updateCustomers({
      ...baseState,
      customers: [{ id: 'c1', state: 'paying', patience: 100, happiness: 80, paymentQueuedAt: 20, x: 400, y: 300 }],
    }, 10);

    expect(result.customers[0]).toMatchObject({
      state: 'checkout_queued', patience: 100, paymentQueuedAt: 20,
    });
  });

  it('does not reduce patience while a waiter actively takes the customer order', () => {
    const result = prepareCustomersForMovement({
      ...baseState,
      customers: [{ id: 'c1', state: 'seated', patience: 1, happiness: 80, tableId: 't1', dishId: null, drinkId: null }],
      staff: [{ id: 'w1', role: 'waiter', task: { type: 'take_order', customerId: 'c1', startedAt: 0 } }],
    }, 1);

    expect(result.customers[0]).toMatchObject({ state: 'seated', patience: 1 });
  });

  it('does not drain seated patience when the active order targets another customer', () => {
    const result = prepareCustomersForMovement({
      ...baseState,
      customers: [{ id: 'c1', state: 'seated', patience: 2, happiness: 80, tableId: 't1', dishId: null, drinkId: null }],
      staff: [{ id: 'w1', role: 'waiter', task: { type: 'take_order', customerId: 'c2', startedAt: 0 } }],
    }, 1);

    expect(result.customers[0]).toMatchObject({ state: 'seated', patience: 2 });
  });

  it.each(['waiting', 'seated'])('does not drain patience while a customer is %s', stateName => {
    const result = updateCustomers({
      ...baseState, customers: [{ id: 'c1', state: stateName, patience: 100, happiness: 80 }],
    }, 10);

    expect(result.customers[0].patience).toBe(100);
  });

  it('does not reduce patience while awaiting ordered items', () => {
    const result = updateCustomers({
      ...baseState, customers: [{ id: 'c1', state: 'waiting_for_items', patience: 100, happiness: 80 }],
    }, 10);

    expect(result.customers[0].patience).toBe(100);
  });

  it('does not drain indoor patience as game time advances', () => {
    const result = updateCustomers({
      ...baseState, customers: [{ id: 'c1', state: 'waiting', patience: 100, happiness: 80 }],
    }, { gameDt: 60, movementDt: 0 });

    expect(result.customers[0].patience).toBe(100);
  });

  it('continues serving admitted customers after closing', () => {
    const customer = { id: 'c1', state: 'eating', patience: 100, happiness: 80 };
    const result = updateCustomers({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 22 * 3600 },
      customers: [customer],
    }, { gameDt: 60, movementDt: 0 });

    expect(result.customers).toEqual([customer]);
  });

  it('cancels only the pending review for a queued party that abandons', () => {
    const queue = [
      { partyId: 'p1', members: [
        { id: 'q1', partyId: 'p1', state: 'queued', patience: 0, happiness: 80 },
        { id: 'q2', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
      ] },
    ];
    const pendingPartyReviews = [
      { partyId: 'p1', memberIds: ['q1', 'q2'], orderedMemberIds: ['q2'], unaffordableMemberIds: [], paidReviews: [] },
      { partyId: 'p2', memberIds: ['other'], orderedMemberIds: [], unaffordableMemberIds: ['other'], paidReviews: [] },
    ];

    const result = updateCustomers({ ...baseState, queue, pendingPartyReviews }, 2);

    expect(result.customers.map(customer => customer.state)).toEqual(['leaving', 'leaving']);
    expect(result.restaurant.reputation).toBe(2.9);
    expect(result.pendingPartyReviews).toEqual([pendingPartyReviews[1]]);
  });

  it('does not remove a checkout-committed member when their queued party abandons', () => {
    const customers = [
      { id: 'payer', partyId: 'p1', state: 'checkout_queued', patience: 1, happiness: 80, paymentQueuedAt: 20 },
    ];
    const queue = [{ partyId: 'p1', members: [
      { id: 'waiting', partyId: 'p1', state: 'queued', patience: 0.5, happiness: 80 },
    ] }];

    const result = updateCustomers({ ...baseState, customers, queue }, 2);

    expect(result.customers.find(customer => customer.id === 'waiting').state).toBe('leaving');
    expect(result.customers.find(customer => customer.id === 'payer')).toMatchObject({
      state: 'checkout_queued', patience: 1,
    });
    expect(result.restaurant.reputation).toBe(2.9);
  });

  it('penalises separate abandoning queued parties independently', () => {
    const result = updateCustomers({
      ...baseState,
      queue: [
        { partyId: 'p1', members: [
          { id: 'q1', partyId: 'p1', state: 'queued', patience: 1, happiness: 80 },
        ] },
        { partyId: 'p2', members: [
          { id: 'q2', partyId: 'p2', state: 'queued', patience: 0.5, happiness: 80 },
        ] },
      ],
    }, 2);

    expect(result.restaurant.reputation).toBe(2.8);
  });

  it('removes an entire queued party with one reputation penalty', () => {
    const result = updateCustomers({
      ...baseState,
      queue: [{ partyId: 'p1', members: [
        { id: 'q1', partyId: 'p1', state: 'queued', patience: 1, happiness: 80 },
        { id: 'q2', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
      ] }],
    }, 2);

    expect(result.queue).toHaveLength(0);
    expect(result.customers.map(customer => customer.state)).toEqual(['leaving', 'leaving']);
    expect(result.restaurant.reputation).toBe(2.9);
  });

  it('abandons a complete party record once with projected leaving positions', () => {
    const result = prepareCustomersForMovement({
      ...baseState,
      queue: [{ partyId: 'p1', members: [
        { id: 'q1', partyId: 'p1', state: 'queued', patience: 1, happiness: 80 },
        { id: 'q2', partyId: 'p1', state: 'queued', patience: 100, happiness: 80 },
      ] }],
    }, 2);

    expect(result.queue).toEqual([]);
    expect(result.customers.map(customer => customer.state)).toEqual(['leaving', 'leaving']);
    expect(result.customers.every(customer => Number.isFinite(customer.x) && Number.isFinite(customer.y))).toBe(true);
    expect(result.restaurant.reputation).toBe(2.9);
  });

  it('does not count a fading customer as door traffic for a new departure', () => {
    const result = prepareCustomersForMovement(movementState({
      doors: [
        { id: 'door1', y: 340, role: 'exit' },
        { id: 'door2', y: 420, role: 'exit' },
      ],
      customers: [
        { id: 'old', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door1', exitFadeProgress: 0.5, x: 960, y: 360 },
        { id: 'new', state: 'leaving', x: 400, y: 340 },
      ],
    }), 0);

    expect(result.customers.find(customer => customer.id === 'new').exitDoorId).toBe('door1');
  });

  it('never places spawned customers directly at a table', () => {
    let state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    for (let index = 0; index < 200; index += 1) state = spawnCustomers(state);

    expect(state.customers).toHaveLength(0);
    expect(state.queue.flatMap(party => party.members).every(customer => customer.tableId === null)).toBe(true);
  });
});

describe('queue overflow stages hidden departures with full identity conservation', () => {
  afterEach(() => vi.restoreAllMocks());

  function overflowParties(partyCount, queuePatience = 100) {
    return Array.from({ length: partyCount }, (_, partyIndex) => ({
      partyId: `overflow-party-${partyIndex + 1}`,
      members: Array.from({ length: 4 }, (_, memberIndex) => ({
        id: `overflow-${partyIndex + 1}-${memberIndex + 1}`,
        partyId: `overflow-party-${partyIndex + 1}`,
        partySize: 4,
        partyType: 'group',
        state: 'queued',
        patience: 100,
        happiness: 80,
        dishId: null,
        drinkId: null,
        tableId: null,
        chairId: null,
        queuePatience,
        queuePatienceMax: 100,
      })),
    }));
  }

  function pairwiseSpacing(actors) {
    let minimum = Infinity;
    for (let left = 0; left < actors.length; left += 1) {
      for (let right = left + 1; right < actors.length; right += 1) {
        minimum = Math.min(minimum, Math.hypot(
          actors[left].x - actors[right].x,
          actors[left].y - actors[right].y,
        ));
      }
    }
    return minimum;
  }

  it('emits only visible queue blockers and keeps a leaving customer moving through the standalone wrapper', () => {
    const state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      staff: [
        { id: 's1', role: 'waiter', x: 100, y: 100 },
        { id: 's2', role: 'waiter', x: 840, y: 100 },
      ],
      customers: [{
        id: 'leaver', state: 'leaving', exitPhase: 'to_door', x: 400, y: 300,
        patience: 100, tableId: null,
      }],
      queue: overflowParties(8),
    });

    // The pipeline's ownership reconciliation grants the FIFO visible leases
    // before any movement batch; mirror it so the projection is comparable.
    const reconciledState = { ...state, queueSlots: reconcileQueueSlots(state, []) };
    const visibleIds = new Set(
      getQueueVisibleMembers(reconciledState, reconciledState.queue).map(member => member.id),
    );
    expect(visibleIds.size).toBe(9);
    expect(getQueueProjectedMembers(reconciledState, reconciledState.queue).length).toBe(32);

    let current = reconciledState;
    const leaverPositions = [];
    for (let tick = 0; tick < 5; tick += 1) {
      current = updateCustomers(current, { gameDt: 0, movementDt: 0.1 });
      const coordinator = current.movementCoordinator;
      expect(coordinator.diagnostics.invariantFailure).toBeUndefined();
      const queueMemberIds = new Set(current.queue.flatMap(party => party.members).map(member => member.id));
      const stationaryQueueIds = [...coordinator.requests]
        .filter(([id, request]) => request.speed === 0 && queueMemberIds.has(id)).map(([id]) => id);
      expect(new Set(stationaryQueueIds)).toEqual(visibleIds);
      const liveActors = [
        ...(current.customers || []),
        ...(current.staff || []),
        ...getQueueVisibleMembers(current, current.queue),
      ].filter(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y));
      expect(pairwiseSpacing(liveActors)).toBeGreaterThanOrEqual(16);
      const leaver = current.customers.find(customer => customer.id === 'leaver');
      expect(leaver).toBeDefined();
      leaverPositions.push({ x: leaver.x, y: leaver.y });
    }
    const first = leaverPositions[0];
    expect(leaverPositions.some(position => Math.hypot(
      position.x - first.x, position.y - first.y,
    ) > 1e-9)).toBe(true);
  });

  it('emits only the canonical leased queue IDs as blockers, never hidden overflow copies', () => {
    const state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: overflowParties(8),
    });
    const reconciledState = { ...state, queueSlots: reconcileQueueSlots(state, []) };
    const canonical = getQueueVisibleMembers(reconciledState, reconciledState.queue);
    const entries = getCustomerMovementEntries(reconciledState, 1)
      .filter(entry => entry.provenance === 'queue');
    expect(entries.map(entry => entry.character.id))
      .toEqual(canonical.map(member => member.id));
    // Every overflow (unplaced) member stays out of movement entirely.
    const queuedIds = new Set(
      reconciledState.queue.flatMap(party => party.members).map(member => member.id),
    );
    const blockedIds = new Set(entries.map(entry => entry.character.id));
    for (const id of queuedIds) {
      expect(blockedIds.has(id) === canonical.some(member => member.id === id)).toBe(true);
    }
  });

  it('stages an overflowing abandonment until every seeded member physically departs', () => {
    const seedIds = overflowParties(8, 0).flatMap(party => party.members).map(member => member.id);
    let state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: overflowParties(8, 0),
    });
    const seenCustomerIds = new Set();
    let stagedNonEmpty = false;
    let reputationAfterDecision = null;
    let ticks = 0;
    for (; ticks < 6000; ticks += 1) {
      state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      for (const customer of state.customers) seenCustomerIds.add(String(customer.id));
      if (ticks === 0) {
        if ((state.queueDepartures || []).length > 0) stagedNonEmpty = true;
        // Accounting is applied once, at the decision tick: eight abandoning
        // parties lower reputation by 8 x 0.1 and never again.
        reputationAfterDecision = state.restaurant.reputation;
        expect(reputationAfterDecision).toBe(3 - 8 * 0.1);
      } else {
        expect(state.restaurant.reputation).toBe(reputationAfterDecision);
      }
      if (state.customers.length === 0 && state.queue.length === 0
        && (state.queueDepartures || []).length === 0) break;
    }
    expect(stagedNonEmpty).toBe(true);
    expect(ticks).toBeLessThan(6000);
    expect(seenCustomerIds.size).toBe(32);
    for (const id of seedIds) expect(seenCustomerIds.has(String(id))).toBe(true);
  });

  it('stages an overflowing closure until every seeded member physically departs', () => {
    const seedIds = overflowParties(8).flatMap(party => party.members).map(member => member.id);
    let state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 22 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: overflowParties(8),
    });
    const seenCustomerIds = new Set();
    let stagedNonEmpty = false;
    let ticks = 0;
    for (; ticks < 6000; ticks += 1) {
      state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      for (const customer of state.customers) seenCustomerIds.add(String(customer.id));
      if (ticks === 0 && (state.queueDepartures || []).length > 0) stagedNonEmpty = true;
      if (state.customers.length === 0 && state.queue.length === 0
        && (state.queueDepartures || []).length === 0) break;
    }
    expect(stagedNonEmpty).toBe(true);
    expect(ticks).toBeLessThan(6000);
    expect(seenCustomerIds.size).toBe(32);
    for (const id of seedIds) expect(seenCustomerIds.has(String(id))).toBe(true);
  });

  it('stages departures across later ticks with strict handoff spacing', () => {
    let state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: overflowParties(8, 0),
    });
    const firstTickIds = new Set();
    let newLeaverAfterFirstTick = false;
    let ticks = 0;
    for (; ticks < 6000; ticks += 1) {
      state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      const liveCustomers = state.customers.filter(customer =>
        Number.isFinite(customer.x) && Number.isFinite(customer.y));
      expect(pairwiseSpacing(liveCustomers)).toBeGreaterThanOrEqual(16);
      const positionKeys = liveCustomers.map(customer => `${customer.x},${customer.y}`);
      expect(new Set(positionKeys).size).toBe(positionKeys.length);
      if (ticks === 0) {
        for (const customer of state.customers) firstTickIds.add(String(customer.id));
      } else if (!newLeaverAfterFirstTick) {
        newLeaverAfterFirstTick = state.customers.some(customer =>
          !firstTickIds.has(String(customer.id)));
      }
      if (state.customers.length === 0 && state.queue.length === 0
        && (state.queueDepartures || []).length === 0) break;
    }
    expect(newLeaverAfterFirstTick).toBe(true);
    expect(ticks).toBeLessThan(6000);
  });

  it('keeps pending departures out of queue capacity, guide admission and future spawn identity', () => {
    const state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: overflowParties(8, 0),
    });
    const decided = prepareCustomersForMovement(state, 0);
    const pending = decided.queueDepartures || [];
    expect(pending.length).toBeGreaterThan(0);
    // Pending records are not part of the queue, so they cannot be selected for
    // guide admission and do not occupy the eight-party spawn capacity.
    const queuedMemberIds = new Set(decided.queue.flatMap(party => party.members).map(member => String(member.id)));
    expect(pending.every(record => !queuedMemberIds.has(String(record.id)))).toBe(true);
    const pendingIds = new Set(pending.map(record => String(record.id)));
    expect(decided.queue.flatMap(party => party.members).some(member =>
      pendingIds.has(String(member.id)))).toBe(false);
    expect(getQueuePartyCount(decided.queue)).toBeLessThan(8);

    // New arrivals may spawn while pending records still exist, and must not
    // reuse a pending member's identity or party.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const spawned = spawnCustomers({ ...decided, restaurant: { ...decided.restaurant, gameTime: 12 * 3600 } }, 1);
    expect(spawned.queue.flatMap(party => party.members).length).toBeGreaterThan(0);
    const newIds = new Set(spawned.queue.flatMap(party => party.members).map(member => String(member.id)));
    for (const id of pendingIds) expect(newIds.has(id)).toBe(false);
    const newPartyIds = new Set(spawned.queue.map(party => String(party.partyId)));
    for (const record of pending) expect(newPartyIds.has(String(record.partyId))).toBe(false);
  });

  it('persists staged pending departures through a v6 save and reload and still departs everyone', async () => {
    const seedIds = overflowParties(8, 0).flatMap(party => party.members).map(member => member.id);
    const fresh = createInitialState();
    let state = {
      ...fresh,
      restaurant: { ...fresh.restaurant, gameTime: 12 * 3600 },
      queue: overflowParties(8, 0),
      customers: [],
      serviceItems: [],
      staff: [],
    };
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
    const pending = state.queueDepartures || [];
    expect(pending.length).toBeGreaterThan(0);
    for (const record of pending) {
      expect(record).toHaveProperty('id');
      expect(record).toHaveProperty('partyId');
      expect(record.departureReason).toBe('abandoned');
      expect(seedIds.map(String)).toContain(String(record.id));
    }
    const queuedIds = new Set(state.queue.flatMap(party => party.members).map(member => String(member.id)));
    expect(pending.every(record => !queuedIds.has(String(record.id)))).toBe(true);

    saveState(state);
    const saved = loadState();
    expect(saved).not.toHaveProperty('movementCoordinator');
    let restored = hydrateState(saved, createInitialState());
    expect((restored.queueDepartures || []).map(record => String(record.id)).sort())
      .toEqual(pending.map(record => String(record.id)).sort());

    const seenCustomerIds = new Set([...restored.customers].map(customer => String(customer.id)));
    for (let tick = 0; tick < 6000; tick += 1) {
      restored = updateCustomers(restored, { gameDt: 0, movementDt: 0.5 });
      expect(restored.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      for (const customer of restored.customers) seenCustomerIds.add(String(customer.id));
      if (restored.customers.length === 0 && restored.queue.length === 0
        && (restored.queueDepartures || []).length === 0) break;
    }
    for (const id of seedIds) expect(seenCustomerIds.has(String(id))).toBe(true);
  });
});

describe('queue-slot lease ownership through conversion and staged departure', () => {
  afterEach(() => vi.restoreAllMocks());

  function ownedParties(partyCount, queuePatience = 100) {
    return Array.from({ length: partyCount }, (_, partyIndex) => ({
      partyId: `lease-party-${partyIndex + 1}`,
      members: Array.from({ length: 4 }, (_, memberIndex) => ({
        id: `lease-${partyIndex + 1}-${memberIndex + 1}`,
        partyId: `lease-party-${partyIndex + 1}`,
        partySize: 4,
        partyType: 'group',
        state: 'queued',
        patience: 100,
        happiness: 80,
        dishId: null,
        drinkId: null,
        tableId: null,
        chairId: null,
        queuePatience,
        queuePatienceMax: 100,
      })),
    }));
  }

  function queuePoint(slot) {
    return { x: 973, y: 390 + slot * 30 };
  }

  function memberAt(members, partyIndex, memberIndex) {
    return members.find(member => member.partyId === `lease-party-${partyIndex + 1}`
      && member.id === `lease-${partyIndex + 1}-${memberIndex + 1}`);
  }

  function queueSlotsFor(parties, partyCounts) {
    const members = parties.flatMap(party => party.members);
    const records = [];
    let slot = 0;
    partyCounts.forEach((memberCount, partyIndex) => {
      for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
        const member = memberAt(members, partyIndex, memberIndex);
        const point = queuePoint(slot);
        records.push({ memberId: member.id, partyId: member.partyId, x: point.x, y: point.y, slot });
        slot += 1;
      }
    });
    return records;
  }

  it('converts abandoning leased members at their exact stored points and retains departure ownership until each leaver clears', () => {
    const parties = ownedParties(3).map((party, index) => index === 0
      ? { ...party, members: party.members.map(member => ({ ...member, queuePatience: 0 })) }
      : party);
    const queueSlots = queueSlotsFor(parties, [4, 4, 0]);
    const state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: parties,
      queueSlots,
      customers: [],
    });

    const decided = prepareCustomersForMovement(state, 0);
    const leavers = decided.customers.filter(customer => customer.partyId === 'lease-party-1');
    expect(leavers).toHaveLength(4);
    expect(leavers.map(customer => ({ x: customer.x, y: customer.y }))).toEqual([
      { x: 973, y: 390 }, { x: 973, y: 420 }, { x: 973, y: 450 }, { x: 973, y: 480 },
    ]);
    expect(decided.queue.map(party => party.partyId)).toEqual(['lease-party-2', 'lease-party-3']);
    // Reconcile also filled the only free current candidate (slot 8) with the
    // first hidden FIFO member before the conversion ran.
    expect(decided.queueSlots.slice(0, 8)).toEqual(queueSlots);
    expect(decided.queueSlots[8]).toMatchObject({ memberId: 'lease-3-1', x: 973, y: 630, slot: 8 });

    let current = decided;
    let ticks = 0;
    for (; ticks < 2000; ticks += 1) {
      current = updateCustomers(current, { gameDt: 0, movementDt: 0.5 });
      expect(current.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      const actors = [
        ...current.customers,
        ...(current.staff || []),
        ...getQueueVisibleMembers(current, current.queue),
      ].filter(actor => actor?.id != null && Number.isFinite(actor.x) && Number.isFinite(actor.y));
      let minimum = Infinity;
      for (let left = 0; left < actors.length; left += 1) {
        for (let right = left + 1; right < actors.length; right += 1) {
          minimum = Math.min(minimum, Math.hypot(
            actors[left].x - actors[right].x,
            actors[left].y - actors[right].y,
          ));
        }
      }
      expect(minimum).toBeGreaterThanOrEqual(16);
      for (const member of getQueueVisibleMembers(current, current.queue)) {
        if (member.partyId !== 'lease-party-2') continue;
        const original = queueSlots.find(record => record.memberId === member.id);
        expect({ x: member.x, y: member.y }).toEqual({ x: original.x, y: original.y });
      }
      if (current.customers.every(customer => customer.partyId !== 'lease-party-1')) break;
    }
    expect(ticks).toBeLessThan(2000);
    // FIFO hidden members claimed the freed front origins only after the
    // release predicate: party 3's remaining members stand at the first free
    // candidates while the earlier granted member keeps its rear slot.
    const finalParty3 = getQueueVisibleMembers(current, current.queue)
      .filter(member => member.partyId === 'lease-party-3');
    expect(finalParty3.map(member => member.y).sort()).toEqual([390, 420, 450, 630]);
  });

  it('converts closed leased members at their stored points and keeps hidden members ordered pending', () => {
    const parties = ownedParties(3);
    const queueSlots = queueSlotsFor(parties, [4, 4, 0]);
    const state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 22 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: parties,
      queueSlots,
      customers: [],
    });

    const decided = prepareCustomersForMovement(state, 0);
    const closedLeavers = decided.customers.filter(customer => customer.partyId === 'lease-party-1');
    expect(closedLeavers).toHaveLength(4);
    expect(closedLeavers.map(customer => ({ x: customer.x, y: customer.y }))).toEqual([
      { x: 973, y: 390 }, { x: 973, y: 420 }, { x: 973, y: 450 }, { x: 973, y: 480 },
    ]);
    expect(closedLeavers.every(customer => customer.closedAt === 22 * 3600)).toBe(true);
    // Reconcile granted the free slot 8 to lease-3-1 before closure converted
    // every leased member, so nine members leave now and three stay pending.
    expect(decided.customers.filter(customer => customer.state === 'leaving')).toHaveLength(9);
    const pending = decided.queueDepartures || [];
    expect(pending).toHaveLength(3);
    expect(pending.map(record => record.id)).toEqual([
      'lease-3-2', 'lease-3-3', 'lease-3-4',
    ]);
    expect(pending.every(record => record.departureReason === 'closed')).toBe(true);
    expect(decided.queueSlots.slice(0, 8)).toEqual(queueSlots);
    expect(decided.queueSlots[8]).toMatchObject({ memberId: 'lease-3-1', x: 973, y: 630, slot: 8 });
  });

  it('gives a queued claim priority over staged materialisation at a single free candidate', () => {
    const members = ownedParties(1, 100)[0].members;
    const queue = [{
      partyId: 'lease-party-1',
      members: [
        ...members,
        ...Array.from({ length: 5 }, (_, memberIndex) => ({
          id: `lease-9-${memberIndex + 1}`,
          partyId: 'lease-party-1',
          partySize: 4,
          state: 'queued',
          patience: 100,
          happiness: 80,
          dishId: null,
          drinkId: null,
          tableId: null,
          chairId: null,
          queuePatience: 100,
          queuePatienceMax: 100,
        })),
      ],
    }];
    const allMembers = queue[0].members;
    const queueSlots = allMembers.slice(0, 8).map((member, slot) => ({
      memberId: member.id,
      partyId: member.partyId,
      x: 973,
      y: 390 + slot * 30,
      slot,
    }));
    const pendingRecord = {
      ...allMembers[0],
      id: 'pending-oldest',
      departureReason: 'abandoned',
    };
    const state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue,
      queueSlots,
      queueDepartures: [pendingRecord],
      customers: [],
    });

    const result = prepareCustomersForMovement(state, 0);
    const ninthLease = result.queueSlots.find(record => record.x === 973 && record.y === 630);
    expect(ninthLease.memberId).toBe('lease-9-5');
    expect((result.queueDepartures || []).map(record => record.id)).toEqual(['pending-oldest']);
    expect(result.queueDepartures[0]).toMatchObject(pendingRecord);
    expect(result.customers).toHaveLength(0);
  });

  it('materialises the oldest pending record with a retained departure lease and stays blocked until clear', () => {
    const members = ownedParties(1, 100)[0].members;
    const queue = [{
      partyId: 'lease-party-1',
      members: [
        ...members,
        ...Array.from({ length: 4 }, (_, memberIndex) => ({
          id: `lease-9-${memberIndex + 1}`,
          partyId: 'lease-party-1',
          partySize: 4,
          state: 'queued',
          patience: 100,
          happiness: 80,
          dishId: null,
          drinkId: null,
          tableId: null,
          chairId: null,
          queuePatience: 100,
          queuePatienceMax: 100,
        })),
      ],
    }];
    // Eight members stand at slots 0..7; slot 8 is the only free candidate.
    const queueSlots = queue[0].members.slice(0, 8).map((member, slot) => ({
      memberId: member.id,
      partyId: member.partyId,
      x: 973,
      y: 390 + slot * 30,
      slot,
    }));
    const pendingOldest = {
      ...queue[0].members[0],
      id: 'pending-oldest',
      departureReason: 'abandoned',
    };
    const pendingNext = {
      ...queue[0].members[0],
      id: 'pending-next',
      departureReason: 'abandoned',
    };
    const state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue,
      queueSlots,
      queueDepartures: [pendingOldest, pendingNext],
      customers: [],
    });

    const first = prepareCustomersForMovement(state, 0);
    expect((first.queueDepartures || []).map(record => record.id)).toEqual(['pending-next']);
    const staged = first.customers.find(customer => customer.id === 'pending-oldest');
    expect(staged).toMatchObject({ state: 'leaving', x: 973, y: 630 });
    const stagedLease = first.queueSlots.find(record => record.memberId === 'pending-oldest');
    expect(stagedLease).toEqual({
      memberId: 'pending-oldest', partyId: 'lease-party-1', x: 973, y: 630, slot: 8,
    });
    expect(new Set(first.queue.flatMap(party => party.members).map(member => member.id)))
      .not.toContain('pending-oldest');
    expect(new Set(first.customers.map(customer => customer.id))).not.toContain('pending-next');

    // While the staged leaver is still within 16 px of its origin the lease is
    // retained and no later record materialises over it.
    const second = prepareCustomersForMovement(first, 0);
    expect(second.queueSlots.find(record => record.memberId === 'pending-oldest')).toEqual(stagedLease);
    expect((second.queueDepartures || []).map(record => record.id)).toEqual(['pending-next']);
    expect(second.customers.filter(customer => customer.id === 'pending-oldest')).toHaveLength(1);

    // Once the leaver clears its origin, the lease releases and the next
    // oldest pending record may take the candidate.
    const cleared = {
      ...second,
      customers: second.customers.map(customer => customer.id === 'pending-oldest'
        ? { ...customer, x: 973, y: 660 }
        : customer),
    };
    const third = prepareCustomersForMovement(cleared, 0);
    expect(third.queueSlots.some(record => record.memberId === 'pending-oldest')).toBe(false);
    expect(third.queueDepartures).toHaveLength(0);
    expect(third.customers.some(customer => customer.id === 'pending-next'
      && customer.state === 'leaving' && customer.x === 973 && customer.y === 630)).toBe(true);
    expect(third.queueSlots.find(record => record.memberId === 'pending-next'))
      .toEqual({ memberId: 'pending-next', partyId: 'lease-party-1', x: 973, y: 630, slot: 8 });
  });
});

describe('all-32 queue departure completion with clean lease accounting', () => {
  afterEach(() => vi.restoreAllMocks());

  it('departs every member once with one reputation decision and no leftover lease or pending record', () => {
    const seedIds = Array.from({ length: 8 }, (_, partyIndex) => Array.from({ length: 4 },
      (_, memberIndex) => `complete-${partyIndex + 1}-${memberIndex + 1}`)).flat();
    const queue = Array.from({ length: 8 }, (_, partyIndex) => ({
      partyId: `complete-party-${partyIndex + 1}`,
      members: Array.from({ length: 4 }, (_, memberIndex) => ({
        id: `complete-${partyIndex + 1}-${memberIndex + 1}`,
        partyId: `complete-party-${partyIndex + 1}`,
        partySize: 4,
        state: 'queued',
        patience: 100,
        happiness: 80,
        dishId: null,
        drinkId: null,
        tableId: null,
        chairId: null,
        queuePatience: 0,
        queuePatienceMax: 100,
      })),
    }));
    let state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue,
      customers: [],
    });
    const seenCustomerIds = new Set();
    let reputationAfterDecision = null;
    let ticks = 0;
    for (; ticks < 6000; ticks += 1) {
      state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
      expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
      for (const customer of state.customers) seenCustomerIds.add(String(customer.id));
      if (ticks === 0) reputationAfterDecision = state.restaurant.reputation;
      else expect(state.restaurant.reputation).toBe(reputationAfterDecision);
      const actors = [
        ...state.customers,
        ...(state.staff || []),
        ...getQueueVisibleMembers(state, state.queue),
      ].filter(actor => actor?.id != null && Number.isFinite(actor.x) && Number.isFinite(actor.y));
      let minimum = Infinity;
      for (let left = 0; left < actors.length; left += 1) {
        for (let right = left + 1; right < actors.length; right += 1) {
          minimum = Math.min(minimum, Math.hypot(
            actors[left].x - actors[right].x,
            actors[left].y - actors[right].y,
          ));
        }
      }
      expect(minimum).toBeGreaterThanOrEqual(16);
      if (state.customers.length === 0 && state.queue.length === 0
        && (state.queueDepartures || []).length === 0 && (state.queueSlots || []).length === 0) break;
    }
    expect(ticks).toBeLessThan(6000);
    expect(reputationAfterDecision).toBe(3 - 8 * 0.1);
    expect(seenCustomerIds.size).toBe(32);
    for (const id of seedIds) expect(seenCustomerIds.has(String(id))).toBe(true);
    expect(state.queueSlots).toEqual([]);
    expect(state.queueDepartures).toEqual([]);
  });
});

describe('runtime queue-slot reconciliation stays fail-closed without relocating a physical member', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the unsafe diagnostic and the exact lease across ticks instead of relocating the member', () => {
    const state = movementState({
      restaurant: { ...baseState.restaurant, gameTime: 12 * 3600, expansionLevel: 1 },
       doors: [{ id: 'door1', y: 340, role: 'exit' }],
      queue: [{
        partyId: 'p',
        members: [{
          id: 'q', partyId: 'p', partySize: 1, state: 'queued', patience: 100,
          happiness: 80, dishId: null, drinkId: null, tableId: null, chairId: null,
          queuePatience: 100, queuePatienceMax: 100,
        }],
      }],
      queueSlots: [{ memberId: 'q', partyId: 'p', x: 973, y: 390, slot: 0 }],
      customers: [],
      staff: [{ id: 'cook', role: 'cook', x: 973, y: 400 }],
    });
    const originalSlots = state.queueSlots;

    let current = state;
    for (let tick = 0; tick < 2; tick += 1) {
      current = updateCustomers(current, { gameDt: 0, movementDt: 0.1 });
      expect(current.movementCoordinator.diagnostics.invariantFailure).toBe('unsafeInitialState');
      expect(current.queueSlots).toEqual(originalSlots);
      const visible = getQueueVisibleMembers(current, current.queue);
      expect(visible).toHaveLength(1);
      expect(visible[0]).toMatchObject({ id: 'q', x: 973, y: 390 });
    }
  });
});

describe('queue-only indoor patience', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['seated', { chairId: 'ch1' }],
    ['waiting', {}],
    ['waiting_for_items', { dishId: 'starter-toast' }],
    ['waiting_for_party', {}],
    ['eating', { dishId: 'starter-toast' }],
  ])('keeps an indoor %s customer after a long timeout without reputation loss',
    (stateName, extra) => {
      const fresh = createInitialState();
      const state = {
        ...fresh,
        staff: [],
        queue: [],
        customers: [{
          id: 'c1',
          state: stateName,
          tableId: 't1',
          x: 210,
          y: 180,
          patience: 0,
          patienceMax: 100,
          happiness: 80,
          ...extra,
        }],
        restaurant: { ...fresh.restaurant, gameTime: 12 * 3600, reputation: 3 },
      };

      const result = updateCustomers(state, { gameDt: 600, movementDt: 0 });

      expect(result.customers[0]).toMatchObject({ id: 'c1', state: stateName });
      expect(result.restaurant.reputation).toBe(3);
    });
});
