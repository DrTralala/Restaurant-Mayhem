import { expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { moveFixtures } from '../state/fixtureMoves';
import { minimumTrajectoryDistance, trajectorySegment } from './movement/trajectory';
import { prepareCustomersForMovement, updateCustomers } from './customers';
import { createGrid } from './navigation/grid';
import { getRestaurantWorld } from './world';

function exitState(customers, queueSlots = []) {
  const initial = createInitialState();
  return {
    ...initial,
    restaurant: {
      ...initial.restaurant,
      gameTime: 12 * 3600,
      openHour: 10,
      closeHour: 22,
      expansionLevel: 1,
    },
    tables: [],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    staff: [],
    queue: [],
    queueSlots,
    doors: [{ id: 'door1', y: 340, role: 'exit' }],
    customers,
  };
}

function assertClearance(state) {
  const actors = state.customers.filter(customer =>
    Number.isFinite(customer.x) && Number.isFinite(customer.y));
  for (let left = 0; left < actors.length; left += 1) {
    for (let right = left + 1; right < actors.length; right += 1) {
      expect(Math.hypot(
        actors[left].x - actors[right].x,
        actors[left].y - actors[right].y,
      )).toBeGreaterThanOrEqual(16 - 1e-6);
      const leftPlan = state.movementCoordinator.plans.get(String(actors[left].id));
      const rightPlan = state.movementCoordinator.plans.get(String(actors[right].id));
      if (leftPlan && rightPlan) {
        const leftTrajectory = leftPlan.map(action => trajectorySegment(
          action.from, action.to, action.start, action.end,
        ));
        const rightTrajectory = rightPlan.map(action => trajectorySegment(
          action.from, action.to, action.start, action.end,
        ));
        expect(minimumTrajectoryDistance(leftTrajectory, rightTrajectory)).toBeGreaterThanOrEqual(16 - 1e-6);
      }
    }
  }
}

function assertAllActorClearance(state) {
  const actors = [
    ...(state.customers || []),
    ...(state.staff || []),
  ].filter(customer => Number.isFinite(customer.x) && Number.isFinite(customer.y));
  for (let left = 0; left < actors.length; left += 1) {
    for (let right = left + 1; right < actors.length; right += 1) {
      expect(Math.hypot(
        actors[left].x - actors[right].x,
        actors[left].y - actors[right].y,
      )).toBeGreaterThanOrEqual(16 - 1e-6);
      const leftPlan = state.movementCoordinator.plans.get(String(actors[left].id));
      const rightPlan = state.movementCoordinator.plans.get(String(actors[right].id));
      if (leftPlan && rightPlan) {
        const leftTrajectory = leftPlan.map(action => trajectorySegment(
          action.from, action.to, action.start, action.end,
        ));
        const rightTrajectory = rightPlan.map(action => trajectorySegment(
          action.from, action.to, action.start, action.end,
        ));
        expect(minimumTrajectoryDistance(leftTrajectory, rightTrajectory)).toBeGreaterThanOrEqual(16 - 1e-6);
      }
    }
  }
}

it('finishes timed-out outdoor queue departures with individual finite tails', () => {
  const timedOut = [
    ['c57', 1000, 440, { x: 1033, y: 450 }, 0.7126510058405555],
    ['c70', 1020, 400, { x: 1033, y: 450 }, 0.5694802882303504],
    ['c89', 1020, 452, { x: 1033, y: 450 }, 0.8903921130169508],
    ['c109', 1020, 380, { x: 1033, y: 390 }, 0.8633231711095273],
    ['c111', 980, 440, { x: 1033, y: 450 }, 0.5505404479946067],
  ].map(([id, x, y, navigationGoal, exitFadeProgress]) => ({
    id,
    partyId: `party-${id}`,
    state: 'leaving',
    departureReason: 'abandoned',
    exitPhase: 'fading',
    exitDoorId: null,
    exitFadeProgress,
    x,
    y,
    happiness: 50,
    patience: 100,
    reputationApplied: true,
    navigationGoal,
  }));
  let state = exitState([
    ...timedOut,
    {
      id: 'c4',
      partyId: 'party-c4',
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'fading',
      exitDoorId: 'door2',
      exitFadeProgress: 0,
      x: 1041,
      y: 460,
      happiness: 80,
      patience: 900,
      navigationGoal: { x: 1161, y: 460 },
    },
  ], [{
    memberId: 'c111',
    partyId: 'party-c111',
    x: 973,
    y: 450,
    slot: 2,
  }]);
  state = {
    ...state,
    doors: [
      { id: 'door1', y: 340, role: 'entrance' },
      { id: 'door2', y: 180, role: 'exit' },
    ],
    staff: [
      { id: 'starter-cook', role: 'cook', x: 120, y: 100, task: null, activityPhase: 'stationed' },
      { id: 'starter-waiter', role: 'waiter', x: 260, y: 120, task: null,
        activityPhase: 'idle_roaming', navigationGoal: { x: 320, y: 100 } },
      { id: 'starter-host', role: 'waiter', x: 120, y: 160, task: null, activityPhase: 'idle_waiting' },
      { id: 'starter-cashier-waiter', role: 'waiter', x: 840, y: 100, task: null,
        activityPhase: 'stationed' },
      { id: 'starter-janitor', role: 'janitor', x: 320, y: 180, task: null, activityPhase: 'idle_waiting' },
      { id: 'staff-extra', role: 'waiter', x: 280, y: 100, task: null, activityPhase: 'idle_waiting' },
    ],
  };

  for (let tick = 0; tick < 500 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
    expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
    assertClearance(state);
  }

  expect(state.customers).toHaveLength(0);
  expect(state.queueSlots).toEqual([]);
});

it('moves multiple paid customers towards one exit before the first fade completes', () => {
  let state = exitState([
    {
      id: 'paid-first',
      partyId: 'paid-party-1',
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'to_door',
      exitDoorId: 'door1',
      x: 780,
      y: 280,
      patience: 100,
      happiness: 80,
    },
    {
      id: 'paid-second',
      partyId: 'paid-party-2',
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'to_door',
      exitDoorId: 'door1',
      x: 780,
      y: 440,
      patience: 100,
      happiness: 80,
    },
  ]);
  const starting = new Map(state.customers.map(customer => [customer.id, { x: customer.x, y: customer.y }]));
  state = updateCustomers(state, { gameDt: 0, movementDt: 1 });

  const first = state.customers.find(customer => customer.id === 'paid-first');
  const second = state.customers.find(customer => customer.id === 'paid-second');
  expect(first?.exitPhase).toBe('to_door');
  expect(second?.exitPhase).toBe('to_door');
  expect(first && (first.x !== starting.get(first.id).x || first.y !== starting.get(first.id).y)).toBe(true);
  expect(second && (second.x !== starting.get(second.id).x || second.y !== starting.get(second.id).y)).toBe(true);
  assertClearance(state);
});

it('routes two indoor served leavers around a blocked exit centre through the marked opening', () => {
  let state = exitState([
    {
      id: 'served-first',
      partyId: 'served-party-1',
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'to_door',
      exitDoorId: 'door1',
      x: 780,
      y: 280,
      patience: 100,
      happiness: 80,
    },
    {
      id: 'served-second',
      partyId: 'served-party-2',
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'to_door',
      exitDoorId: 'door1',
      x: 780,
      y: 440,
      patience: 100,
      happiness: 80,
    },
  ]);
  state.staff = [{ id: 'outside-blocker', role: 'waiter', x: 993, y: 360 }];
  const initialPositions = new Map(state.customers.map(customer => [customer.id, { x: customer.x, y: customer.y }]));
  let firstMoved = false;
  let secondMoved = false;
  let secondMovedBeforeFirstRemoved = false;

  for (let tick = 0; tick < 500 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
    expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
    assertAllActorClearance(state);
    for (const id of ['served-first', 'served-second']) {
      const customer = state.customers.find(candidate => candidate.id === id);
      if (!customer) continue;
      const initial = initialPositions.get(id);
      if (customer.x !== initial.x || customer.y !== initial.y) {
        if (id === 'served-first') firstMoved = true;
        if (id === 'served-second') {
          secondMoved = true;
          if (state.customers.some(candidate => candidate.id === 'served-first')) {
            secondMovedBeforeFirstRemoved = true;
          }
        }
      }
    }
  }

  expect(firstMoved).toBe(true);
  expect(secondMoved).toBe(true);
  expect(secondMovedBeforeFirstRemoved).toBe(true);
  expect(state.customers).toEqual([]);
});

it('persists the safe alternative crossing point while the centre is occupied', () => {
  const state = exitState([{
    id: 'alternative',
    partyId: 'alternative-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'to_door',
    exitDoorId: 'door1',
    x: 780,
    y: 280,
    patience: 100,
    happiness: 80,
  }]);
  state.staff = [{ id: 'outside-centre', role: 'waiter', x: 993, y: 360 }];

  const prepared = updateCustomers(state, { gameDt: 0, movementDt: 0 });
  const customer = prepared.customers[0];

  expect(customer).toMatchObject({
    exitDoorId: 'door1',
    exitCrossingPoint: { x: 993, y: 340 },
    navigationGoal: { x: 993, y: 340 },
  });
});

it('treats a retained queue member as a physical exit-opening blocker', () => {
  const state = exitState([{
    id: 'queue-obstacle-leaver',
    partyId: 'leaver-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'to_door',
    exitDoorId: 'door1',
    x: 780,
    y: 280,
    patience: 100,
    happiness: 80,
  }], [{ memberId: 'queue-obstacle', partyId: 'queue-party', x: 993, y: 360, slot: 0 }]);
  state.queue = [{ partyId: 'queue-party', members: [{ id: 'queue-obstacle', partyId: 'queue-party', state: 'queued' }] }];

  const prepared = updateCustomers(state, { gameDt: 0, movementDt: 0 });

  expect(prepared.customers[0]).toMatchObject({
    exitCrossingPoint: { x: 993, y: 340 },
    navigationGoal: { x: 993, y: 340 },
  });
});

it('holds without a goal when every safe point in the marked opening is occupied', () => {
  let state = exitState([{
    id: 'blocked-leaver',
    partyId: 'blocked-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'to_door',
    exitDoorId: 'door1',
    x: 780,
    y: 280,
    patience: 100,
    happiness: 80,
  }]);
  state.staff = [
    { id: 'opening-blocker-top', role: 'waiter', x: 993, y: 340 },
    { id: 'opening-blocker-centre', role: 'waiter', x: 993, y: 360 },
  ];

  for (let tick = 0; tick < 4; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
    expect(state.customers[0]).toMatchObject({ exitDoorId: 'door1' });
    expect(state.customers[0]).not.toHaveProperty('navigationGoal');
    expect(state.movementCoordinator.statuses.get('blocked-leaver')).toMatchObject({
      plan: 'arrived', motion: 'holding',
    });
  }
});

it('uses the current shifted marked opening instead of a stale centre', () => {
  let state = exitState([{
    id: 'shifted',
    partyId: 'shifted-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'to_door',
    exitDoorId: 'door1',
    x: 780,
    y: 280,
    patience: 100,
    happiness: 80,
  }]);
  state.doors = [{ id: 'door1', y: 360, role: 'exit' }];

  state = updateCustomers(state, { gameDt: 0, movementDt: 0 });
  expect(state.customers[0]).toMatchObject({
    exitCrossingPoint: { x: 993, y: 380 },
    navigationGoal: { x: 993, y: 380 },
  });

  for (let tick = 0; tick < 500 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
  }
  expect(state.customers).toEqual([]);
});

it('does not reclassify a moved off-centre door fade as queue abandonment', () => {
  const initial = exitState([{
    id: 'moving-tail',
    partyId: 'moving-tail-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'fading',
    exitDoorId: 'door1',
    exitCrossingPoint: { x: 993, y: 340 },
    exitFadeProgress: 0.25,
    x: 1023,
    y: 340,
    patience: 100,
    happiness: 80,
    navigationGoal: { x: 1113, y: 340 },
  }]);
  const state = {
    ...initial,
    doors: [{ id: 'door1', y: 440, role: 'exit' }],
  };

  const prepared = updateCustomers(state, { gameDt: 0, movementDt: 0 });

  expect(prepared.customers[0]).toMatchObject({
    exitDoorId: 'door1',
    exitPhase: 'fading',
    navigationGoal: { x: 1113, y: 340 },
  });
});

it('keeps the selected crossing point and navigation goal inside a moved opening', () => {
  const initial = exitState([{
    id: 'moved-opening',
    partyId: 'moved-opening-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'to_door',
    exitDoorId: 'door1',
    exitCrossingPoint: { x: 993, y: 360 },
    x: 900,
    y: 360,
    patience: 100,
    happiness: 80,
    navigationGoal: { x: 993, y: 360 },
  }]);
  const state = { ...initial, doors: [{ id: 'door1', y: 370, role: 'exit' }] };

  const prepared = prepareCustomersForMovement(state, 0);
  const customer = prepared.customers[0];

  expect(customer).toMatchObject({
    exitCrossingPoint: { x: 993, y: 390 },
    navigationGoal: { x: 993, y: 390 },
  });

  const world = getRestaurantWorld(state.restaurant);
  let current = state;
  let crossingY = null;
  for (let tick = 0; tick < 40 && current.customers.length; tick += 1) {
    current = updateCustomers(current, { gameDt: 0, movementDt: 0.5 });
    for (const action of current.movementCoordinator.plans.get('moved-opening') || []) {
      if (action.from.x < world.doorX && action.to.x >= world.doorX) {
        const fraction = (world.doorX - action.from.x) / (action.to.x - action.from.x);
        crossingY = action.from.y + (action.to.y - action.from.y) * fraction;
        expect(crossingY).toBeGreaterThanOrEqual(370);
        expect(crossingY).toBeLessThan(410);
      }
    }
    if (current.customers[0]?.x >= world.doorX) break;
  }
  expect(crossingY).not.toBeNull();
});

it('prevents moving a marked exit under an in-flight leaver and lets it finish', () => {
  let state = exitState([{
    id: 'fixture-moved-leaver',
    partyId: 'fixture-moved-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'to_door',
    exitDoorId: 'door1',
    exitCrossingPoint: { x: 993, y: 360 },
    x: 900,
    y: 360,
    patience: 100,
    happiness: 80,
    navigationGoal: { x: 993, y: 360 },
  }]);

  const moved = moveFixtures(state, [{ type: 'door', id: 'door1', x: 907, y: 440 }]);
  expect(moved).toBe(state);
  expect(moved.doors[0]).toMatchObject({ id: 'door1', y: 340, role: 'exit' });
  expect(moved.customers[0].navigationGoal).toEqual({ x: 993, y: 360 });

  const hypotheticalMovedLayout = {
    ...state,
    doors: [{ id: 'door1', y: 440, role: 'exit' }],
  };
  expect(createGrid(hypotheticalMovedLayout)
    .segmentClear({ x: 880, y: 360 }, { x: 920, y: 360 })).toBe(false);

  const world = getRestaurantWorld(state.restaurant);
  let crossingY = null;
  for (let tick = 0; tick < 500 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
    expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
    for (const action of state.movementCoordinator.plans.get('fixture-moved-leaver') || []) {
      if (action.from.x < world.doorX && action.to.x >= world.doorX) {
        const fraction = (world.doorX - action.from.x) / (action.to.x - action.from.x);
        crossingY = action.from.y + (action.to.y - action.from.y) * fraction;
      }
    }
  }

  expect(crossingY).toBeGreaterThanOrEqual(340);
  expect(crossingY).toBeLessThan(380);
  expect(state.customers).toEqual([]);
});

it('replans a served fade around a stationary actor on its outward ray', () => {
  let state = exitState([{
    id: 'blocked-fade',
    partyId: 'blocked-fade-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'fading',
    exitDoorId: 'door1',
    exitCrossingPoint: { x: 993, y: 360 },
    exitFadeProgress: 0,
    x: 993,
    y: 360,
    patience: 100,
    happiness: 80,
    navigationGoal: { x: 1113, y: 360 },
  }]);
  state.staff = [{ id: 'fade-blocker', role: 'waiter', x: 1053, y: 360 }];
  let alternativeGoal = null;

  for (let tick = 0; tick < 500 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
    const customer = state.customers.find(candidate => candidate.id === 'blocked-fade');
    if (customer && customer.navigationGoal?.y !== 360) alternativeGoal = customer.navigationGoal;
    if (customer) expect(customer.navigationGoal?.x).toBeLessThanOrEqual(1113 + 1e-6);
    expect(state.staff).toHaveLength(1);
  }

  expect(alternativeGoal).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  expect(state.customers).toEqual([]);
});

it('replans a partially completed door fade from its current safe position', () => {
  let state = exitState([{
    id: 'partial-fade',
    partyId: 'partial-fade-party',
    state: 'leaving',
    departureReason: 'served',
    exitPhase: 'fading',
    exitDoorId: 'door1',
    exitCrossingPoint: { x: 993, y: 360 },
    exitFadeOrigin: { x: 993, y: 360 },
    exitFadeProgress: 0.25,
    x: 1023,
    y: 360,
    patience: 100,
    happiness: 80,
    navigationGoal: { x: 1113, y: 360 },
  }]);
  state.staff = [{ id: 'partial-fade-blocker', role: 'waiter', x: 1053, y: 360 }];

  state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
  const customer = state.customers[0];
  expect(customer).toMatchObject({
    exitCrossingPoint: { x: 993, y: 360 },
    exitFadeOrigin: { x: 1023, y: 360 },
  });
  expect(customer.navigationGoal.y).not.toBe(360);

  for (let tick = 0; tick < 500 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
  }
  expect(state.customers).toEqual([]);
});

it('drains twenty same-door leavers without terminal starvation', () => {
  let state = exitState([
    ...Array.from({ length: 17 }, (_, index) => ({
      id: `approach-${index}`,
      partyId: `approach-party-${index}`,
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'to_door',
      exitDoorId: 'door1',
      x: 700 + (index % 5) * 30,
      y: 260 + Math.floor(index / 5) * 30,
      patience: 100,
      happiness: 80,
    })),
    {
      id: 'leaver-9',
      partyId: 'leaver-party-9',
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'to_door',
      exitDoorId: 'door1',
      x: 1020,
      y: 345,
      patience: 100,
      happiness: 80,
    },
    {
      id: 'fade-centre',
      partyId: 'fade-centre-party',
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'fading',
      exitDoorId: 'door1',
      exitCrossingPoint: { x: 993, y: 360 },
      exitFadeProgress: 0,
      x: 993,
      y: 360,
      navigationGoal: { x: 1113, y: 360 },
      patience: 100,
      happiness: 80,
    },
    {
      id: 'fade-top',
      partyId: 'fade-top-party',
      state: 'leaving',
      departureReason: 'served',
      exitPhase: 'fading',
      exitDoorId: 'door1',
      exitCrossingPoint: { x: 993, y: 340 },
      exitFadeProgress: 0,
      x: 993,
      y: 340,
      navigationGoal: { x: 1113, y: 340 },
      patience: 100,
      happiness: 80,
    },
  ]);
  const promoted = prepareCustomersForMovement(state, 0).customers.find(customer => customer.id === 'leaver-9');
  expect(promoted).toMatchObject({
    exitPhase: 'fading',
    exitCrossingPoint: { x: 1020, y: 345 },
    navigationGoal: { x: 1140, y: 345 },
  });
  let lastSnapshot = null;
  let unchangedTicks = 0;

  for (let tick = 0; tick < 3000 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
    const snapshot = JSON.stringify(state.customers.map(customer => [
      customer.id, customer.x, customer.y, customer.exitPhase, customer.navigationGoal,
    ]));
    unchangedTicks = snapshot === lastSnapshot ? unchangedTicks + 1 : 0;
    lastSnapshot = snapshot;
  }

  expect(unchangedTicks).toBeLessThan(100);
  expect(state.customers).toEqual([]);
});

it('replans an uncapped outdoor tail to a finite normal departure', () => {
  let state = exitState([{
    id: 'malformed-tail',
    partyId: 'malformed-party',
    state: 'leaving',
    departureReason: 'abandoned',
    exitPhase: 'fading',
    exitDoorId: null,
    exitFadeProgress: 0,
    x: 1040,
    y: 460,
    happiness: 50,
    patience: 100,
    reputationApplied: true,
    navigationGoal: { x: 100000, y: 460 },
  }]);
  const positions = [];
  const goals = [];

  for (let tick = 0; tick < 20 && state.customers.length; tick += 1) {
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.5 });
    positions.push(...state.customers.map(customer => customer.x));
    goals.push(...state.customers.map(customer => customer.navigationGoal));
    expect(state.movementCoordinator.diagnostics.invariantFailure).toBeUndefined();
  }

  expect(Math.max(...positions)).toBeLessThanOrEqual(1160 + 1e-6);
  expect(goals.every(goal => goal?.x === 1160 && goal?.y === 460)).toBe(true);
  expect(state.customers).toHaveLength(0);
});
