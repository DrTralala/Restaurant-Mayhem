import { describe, expect, it } from 'vitest';
import { prepareIdleYield } from './idleYield';
import { advanceCharacterMovementBatch, createMovementCoordinator } from './coordinator';
import { minimumTrajectoryDistance } from '../movement/trajectory';
import {
  getStaffMovementEntries,
  prepareStaffForMovement,
  resolveStaffAfterMovement,
} from '../staff';

const state = {
  restaurant: { gameTime: 400, expansionLevel: 1 },
  tables: [],
  chairs: [],
  kitchenStations: [],
  serviceTables: [],
  cashierStations: [],
  staff: [],
  customers: [],
  movementCoordinator: {
    statuses: new Map(),
    records: new Map(),
    requests: new Map(),
    elapsedMovementSeconds: 0,
  },
};

const beneficiaryGoal = { x: 500, y: 300 };

function heldState(worker = {}, beneficiary = {}) {
  const heldWorker = { id: 'worker', role: 'waiter', x: 400, y: 340, task: null,
    activityPhase: 'idle_waiting', ...worker };
  const peer = { id: 'beneficiary', role: 'waiter', x: 400, y: 300,
    navigationGoal: beneficiaryGoal, task: { type: 'take_order' }, ...beneficiary };
  const coordinator = createMovementCoordinator();
  coordinator.elapsedMovementSeconds = 1;
  coordinator.requests.set('beneficiary', { id: 'beneficiary', goal: { ...peer.navigationGoal }, priority: 2 });
  coordinator.records.set('beneficiary', { goal: { ...peer.navigationGoal }, waitingSeconds: 1 });
  coordinator.statuses.set('beneficiary', {
    motion: 'holding', plan: 'waiting', reason: 'traffic', blockers: ['worker'],
  });
  return {
    ...state,
    staff: [heldWorker, peer],
    movementCoordinator: coordinator,
  };
}

function replaceWorker(current, worker) {
  return { ...current, staff: current.staff.map(candidate => candidate.id === worker.id ? worker : candidate) };
}

function blockedServiceTaskState(type) {
  const originalGoal = { x: 220, y: 220 };
  const coordinator = createMovementCoordinator();
  coordinator.records.set('worker', { goal: originalGoal, waitingSeconds: 2 });
  coordinator.statuses.set('worker', {
    motion: 'holding', plan: 'waiting', reason: 'traffic', blockers: ['blocker'],
  });
  const worker = {
    id: 'worker', role: 'waiter', skill: 5, morale: 100, x: 180, y: 220,
    activityPhase: 'task_assigned', navigationGoal: originalGoal,
    task: type === 'take_order'
      ? { type, customerId: 'customer', startedAt: 0, accumulatedWork: 0, lastProgressAt: 0 }
      : { type, serviceItemId: 'item', customerId: 'customer' },
    ...(type === 'deliver_service_item' ? { carryingServiceItemIds: ['item'] } : {}),
  };
  const blocker = { id: 'blocker', role: 'cook', morale: 100, x: 220, y: 220, task: null };
  const customer = type === 'take_order'
    ? {
        id: 'customer', state: 'seated', tableId: 'table', dishId: null, drinkId: null,
        spendingTier: 'budget', spendingBudget: 18, patience: 100, happiness: 80,
      }
    : {
        id: 'customer', state: 'waiting_for_items', tableId: 'table', dishId: 'dish',
        drinkId: null, happiness: 80,
      };
  return {
    ...state,
    restaurant: { ...state.restaurant, gameTime: 100, day: 1, reputation: 3, totalServed: 0 },
    tables: [{ id: 'table', status: 'occupied', seats: 2, x: 240, y: 220 }],
    dishes: [{ id: 'dish', price: 10, quality: 1, popularity: 50, prepTime: 60 }],
    staff: [worker, blocker],
    customers: [customer],
    serviceItems: type === 'deliver_service_item'
      ? [{ id: 'item', kind: 'dish', menuItemId: 'dish', customerId: 'customer',
          tableId: 'table', state: 'carried', assignedStaffId: 'worker', x: 180, y: 220 }]
      : [],
    pendingPartyReviews: [],
    partyReviewHistory: [],
    completedCustomers: [],
    upgrades: [],
    movementCoordinator: coordinator,
  };
}

function moveBlockedServiceTask(state) {
  const originalGoal = state.staff.find(worker => worker.id === 'worker').navigationGoal;
  let current = prepareStaffForMovement(state, 0);
  const alternateGoal = current.staff.find(worker => worker.id === 'worker').navigationGoal;
  let sawMovement = false;
  for (let tick = 0; tick < 180; tick += 1) {
    const prepared = prepareStaffForMovement(current, 1 / 30);
    const batch = advanceCharacterMovementBatch(
      prepared,
      getStaffMovementEntries(prepared),
      1 / 30,
    );
    const staff = prepared.staff.map(worker => batch.moved.get(worker.id) || worker);
    const before = prepared.staff.find(worker => worker.id === 'worker');
    const after = staff.find(worker => worker.id === 'worker');
    sawMovement ||= after.x !== before.x || after.y !== before.y;
    current = {
      ...prepared,
      restaurant: { ...prepared.restaurant, gameTime: prepared.restaurant.gameTime + 1 / 30 },
      staff,
      movementCoordinator: batch.coordinator,
    };
    if (batch.statuses.get('worker')?.plan === 'arrived') {
      return { current, statuses: batch.statuses, originalGoal, alternateGoal, sawMovement };
    }
  }
  throw new Error('blocked service task did not reach its alternate interaction point');
}

describe('idle yielding', () => {
  it('leaves an eligible worker alone without held blocker evidence', () => {
    const worker = { id: 'worker', x: 400, y: 300, task: null };

    expect(prepareIdleYield({ ...state, staff: [worker] }, worker)).toBeUndefined();
  });

  it('selects a temporary side bay for a held request and permits optional roaming to yield', () => {
    const current = heldState();
    const yielded = prepareIdleYield(current, current.staff[0]);

    expect(yielded).toMatchObject({ activityPhase: 'idle_roaming', idleUntil: null });
    expect(yielded.navigationYield).toMatchObject({ beneficiaryId: 'beneficiary' });
    expect(yielded.navigationGoal).toEqual(yielded.navigationYield.goal);

    const roaming = prepareIdleYield(current, {
      ...current.staff[0], activityPhase: 'idle_roaming', navigationGoal: { x: 380, y: 340 },
    });
    expect(roaming.navigationYield).toBeDefined();
  });

  it.each([560, 564])('does not grant an immediately passed yield from x=%s', x => {
    const goal = { x: 560, y: 340 };
    const current = heldState({ x, y: 300, activityPhase: 'idle_roaming', navigationGoal: goal },
      { x: 580, y: 320, navigationGoal: { x: 640, y: 320 } });
    const worker = current.staff[0];

    for (let call = 0; call < 3; call += 1) {
      expect(prepareIdleYield(current, worker)).toBeUndefined();
      expect(worker.navigationGoal).toBe(goal);
      expect(worker).not.toHaveProperty('navigationYield');
    }
  });

  it.each([
    ['active preparation', { task: { type: 'prepare_dish' } }],
    ['carried item', { carryingServiceItemIds: ['item'] }],
    ['assigned cashier', {}, { cashierStations: [{ id: 'station', assignedStaffId: 'worker' }] }],
    ['protected rest', { movementResidency: { kind: 'staff_amenity' } }],
    ['PTO', { ptoSession: { minimumEndAt: 500 } }],
    ['off-duty', { effectiveDuty: 'off' }],
  ])('does not yield a %s worker', (_label, worker, extraState = {}) => {
    const current = { ...heldState(worker), ...extraState };
    expect(prepareIdleYield(current, current.staff[0])).toBeUndefined();
  });

  it('does not replace an assigned or stationed goal', () => {
    const current = heldState({
      activityPhase: 'stationed', navigationGoal: { x: 380, y: 340 },
    });
    expect(prepareIdleYield(current, current.staff[0])).toBeUndefined();
  });

  it('retains a yield when the beneficiary clears the blocker but keeps its goal', () => {
    const current = heldState();
    const yielded = prepareIdleYield(current, current.staff[0]);
    const retained = replaceWorker(current, yielded);
    retained.movementCoordinator.statuses.set('beneficiary', {
      motion: 'traversing', plan: 'moving', reason: null, blockers: [],
    });

    const next = prepareIdleYield(retained, retained.staff[0]);

    expect(next.navigationYield).toEqual(yielded.navigationYield);
    expect(next.navigationGoal).toEqual(yielded.navigationGoal);
  });

  it('restores the replaced optional roaming goal when the yield releases', () => {
    const originalGoal = { x: 360, y: 340 };
    const current = heldState({ activityPhase: 'idle_roaming', navigationGoal: originalGoal });
    const yielded = prepareIdleYield(current, current.staff[0]);
    const retained = replaceWorker(current, yielded);
    const expired = {
      ...retained,
      movementCoordinator: { ...retained.movementCoordinator,
        elapsedMovementSeconds: yielded.navigationYield.startedAt + 5 },
    };

    const released = prepareIdleYield(expired, expired.staff[0]);

    expect(released).not.toHaveProperty('navigationYield');
    expect(released.navigationGoal).toEqual(originalGoal);
  });

  it.each([
    ['changed goal', current => ({
      ...current,
      staff: current.staff.map(peer => peer.id === 'beneficiary'
        ? { ...peer, navigationGoal: { x: 500, y: 320 } } : peer),
    })],
    ['occupied bay', (current, yielded) => ({
      ...current, customers: [{ id: 'occupier', x: yielded.navigationYield.goal.x,
        y: yielded.navigationYield.goal.y }],
    })],
    ['expired age', (current, yielded) => ({
      ...current,
      movementCoordinator: { ...current.movementCoordinator,
        elapsedMovementSeconds: yielded.navigationYield.startedAt + 5 },
    })],
  ])('cancels a retained yield on %s', (_label, alter) => {
    const current = heldState();
    const yielded = prepareIdleYield(current, current.staff[0]);
    const retained = replaceWorker(current, yielded);
    const next = prepareIdleYield(alter(retained, yielded), retained.staff[0]);

    expect(next).not.toHaveProperty('navigationYield');
    expect(next).not.toHaveProperty('navigationGoal');
  });

  it('cancels an ineligible retained yield without erasing an unrelated assigned goal', () => {
    const current = heldState();
    const yielded = prepareIdleYield(current, current.staff[0]);
    const retained = replaceWorker(current, yielded);
    const assigned = { ...retained.staff[0], task: { type: 'take_order', customerId: 'new' },
      navigationGoal: { x: 600, y: 340 } };

    const next = prepareIdleYield(replaceWorker(retained, assigned), assigned);

    expect(next).not.toHaveProperty('navigationYield');
    expect(next.navigationGoal).toEqual({ x: 600, y: 340 });
    expect(next.task).toEqual(assigned.task);
  });

  it.each([1 / 30, 2 / 30, 4 / 30])('continues beyond a committed yield waypoint until beneficiary passage at dt=%s', dt => {
    const resumeGoal = { x: 600, y: 320 };
    let current = heldState({ x: 607.8666666666666, y: 320,
      activityPhase: 'idle_roaming', navigationGoal: resumeGoal },
    { x: 580, y: 320, navigationGoal: { x: 640, y: 320 },
      task: { type: 'deliver_service_item', serviceItemId: 'carried', customerId: 'customer' },
      carryingServiceItemIds: ['carried'] });
    const originalWorker = current.staff[0];
    const task = current.staff[1].task;
    const inventory = current.staff[1].carryingServiceItemIds;
    const yielded = prepareIdleYield(current, originalWorker);
    expect(yielded.navigationYield.goal).toEqual({ x: 600, y: 300 });
    current = replaceWorker(current, yielded);
    let reachedBay = false;
    let released = false;

    for (let tick = 0; tick < 120 && !released; tick += 1) {
      const before = current.staff;
      const batch = advanceCharacterMovementBatch(current,
        before.map(character => ({ character, speed: 26 })), dt);
      const [worker, beneficiary] = before.map(actor => batch.moved.get(actor.id));
      expect(batch.diagnostics.invariantFailure).toBeUndefined();
      expect(batch.diagnostics.expansionsThisTick).toBeLessThanOrEqual(2048);
      for (const spent of batch.diagnostics.actorExpansions.values()) expect(spent).toBeLessThanOrEqual(256);
      expect(minimumTrajectoryDistance(batch.trajectories.get('worker'), batch.trajectories.get('beneficiary')))
        .toBeGreaterThanOrEqual(16);
      for (const actor of [worker, beneficiary]) {
        const old = before.find(item => item.id === actor.id);
        expect(Math.hypot(actor.x - old.x, actor.y - old.y)).toBeLessThanOrEqual(26 * dt + 1e-9);
      }
      if (tick === 0) expect(batch.coordinator.records.get('worker').commitment).toEqual({ x: 600, y: 320 });
      // The selected first edge is westward; it must not reverse east each replan.
      if (before[0].y === 320 && before[0].x > 600) expect(worker.x).toBeLessThanOrEqual(before[0].x);
      reachedBay ||= worker.x === 600 && worker.y === 300;
      expect(beneficiary.task).toBe(task);
      expect(beneficiary.carryingServiceItemIds).toBe(inventory);
      current = { ...current, staff: [worker, beneficiary], movementCoordinator: batch.coordinator };
      const next = prepareIdleYield(current, worker);
      released = !next.navigationYield;
      if (released) {
        expect(beneficiary.x - yielded.navigationYield.origin.x,
          JSON.stringify({ tick, worker, beneficiary, status: batch.statuses.get('worker'),
            elapsed: batch.coordinator.elapsedMovementSeconds })).toBeGreaterThanOrEqual(16);
        expect(batch.coordinator.elapsedMovementSeconds - yielded.navigationYield.startedAt).toBeLessThan(5);
        expect(next.navigationGoal).toEqual(resumeGoal);
        expect(next.task).toBeNull();
      }
      current = replaceWorker(current, next);
    }
    expect(reachedBay).toBe(true);
    expect(released).toBe(true);
    expect(originalWorker.navigationGoal).toBe(resumeGoal);
    expect(originalWorker).not.toHaveProperty('navigationYield');
  });

  it('uses real movement batches to reach the bay while preserving swept clearance', () => {
    const corridorFurniture = [
      ...[320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 520]
        .map(x => ({ id: `top-${x}`, x, y: 280 })),
      ...[320, 340, 360, 380, 420, 440, 460, 480, 500, 520]
        .map(x => ({ id: `bottom-${x}`, x, y: 320 })),
    ];
    let current = {
      ...heldState({ x: 400, y: 300 }, { x: 360, y: 300 }),
      chairs: corridorFurniture,
    };
    const yielded = prepareIdleYield(current, current.staff[0]);
    expect(yielded.navigationYield.goal).toEqual({ x: 400, y: 320 });
    current = replaceWorker(current, yielded);
    const origin = { x: yielded.x, y: yielded.y };
    let sawMovement = false;
    let passed = false;

    for (let tick = 0; tick < 120; tick += 1) {
      const previous = current.staff;
      const batch = advanceCharacterMovementBatch(current, current.staff.map(character => ({
        character, speed: character.id === 'worker' ? 20 : 60,
      })), 1 / 30);
      const staff = current.staff.map(worker => batch.moved.get(worker.id));
      const worker = staff.find(candidate => candidate.id === 'worker');
      const peer = staff.find(candidate => candidate.id === 'beneficiary');
      expect(minimumTrajectoryDistance(batch.trajectories.get('worker'),
        batch.trajectories.get('beneficiary'))).toBeGreaterThanOrEqual(16 - 1e-9);
      expect(Math.hypot(worker.x - previous[0].x, worker.y - previous[0].y)).toBeLessThanOrEqual(2 + 1e-9);
      sawMovement ||= worker.x !== origin.x || worker.y !== origin.y;
      current = { ...current, staff, movementCoordinator: batch.coordinator };
      if (peer.x >= yielded.navigationYield.origin.x + 16) {
        passed = true;
        break;
      }
    }

    expect(sawMovement).toBe(true);
    expect(passed).toBe(true);
    const released = prepareIdleYield(current, current.staff[0]);
    expect(released).not.toHaveProperty('navigationYield');
  });

  it('runs preparation, movement, and resolution phases before resuming taskless dispatch', () => {
    const originalGoal = { x: 320, y: 340 };
    let current = heldState({ activityPhase: 'idle_roaming', navigationGoal: originalGoal });
    current = {
      ...current,
      staff: current.staff.map(worker => worker.id === 'worker'
        ? { ...worker, navigationGoal: originalGoal }
        : worker),
    };

    let sawYield = false;
    let sawRelease = false;
    for (let tick = 0; tick < 180; tick += 1) {
      const prepared = prepareStaffForMovement(current, 1 / 30);
      const preparedWorker = prepared.staff.find(worker => worker.id === 'worker');
      sawYield ||= Boolean(preparedWorker.navigationYield);
      const batch = advanceCharacterMovementBatch(
        prepared,
        getStaffMovementEntries(prepared),
        1 / 30,
      );
      const movedState = {
        ...prepared,
        restaurant: {
          ...prepared.restaurant,
          gameTime: prepared.restaurant.gameTime + 1 / 30,
        },
        staff: prepared.staff.map(worker => batch.moved.get(worker.id) || worker),
        movementCoordinator: batch.coordinator,
      };
      const resolved = resolveStaffAfterMovement(movedState, 1 / 30, batch.statuses);
      const worker = resolved.staff.find(candidate => candidate.id === 'worker');
      if (sawYield && !worker.navigationYield) {
        sawRelease = true;
        expect(worker.navigationGoal).toEqual(originalGoal);
        expect(worker.task).toBeNull();
        expect(worker.activityPhase).toBe('idle_roaming');
        const resumed = prepareStaffForMovement({
          ...resolved,
          restaurant: { ...resolved.restaurant, gameTime: resolved.restaurant.gameTime + 1 / 30 },
        }, 1 / 30);
        const resumedWorker = resumed.staff.find(candidate => candidate.id === 'worker');
        expect(resumedWorker.task).toBeNull();
        expect(['idle_roaming', 'idle_waiting']).toContain(resumedWorker.activityPhase);
        expect(resumedWorker).not.toHaveProperty('navigationYield');
        break;
      }
      current = resolved;
    }

    expect(sawYield).toBe(true);
    expect(sawRelease).toBe(true);
  });

  it('does not dispatch new work while the temporary yield is retained', () => {
    const current = heldState();
    const yielded = prepareIdleYield(current, current.staff[0]);
    const worker = { ...yielded, role: 'waiter' };
    const dispatchState = {
      ...replaceWorker(current, worker),
      customers: [{ id: 'new-customer', state: 'seated', tableId: 'table',
        x: 210, y: 230, dishId: null, drinkId: null }],
      tables: [{ id: 'table', status: 'occupied', x: 200, y: 220 }],
      dishes: [{ id: 'dish', price: 10, popularity: 50 }],
    };

    const result = resolveStaffAfterMovement(dispatchState, 0);

    expect(result.staff.find(candidate => candidate.id === 'worker').task).toBeNull();
    expect(result.staff.find(candidate => candidate.id === 'worker').navigationYield).toEqual(
      yielded.navigationYield,
    );
  });

  it('cancels an ineligible retained yield during staff preparation', () => {
    const current = heldState();
    const yielded = prepareIdleYield(current, current.staff[0]);
    const worker = { ...yielded, movementResidency: { kind: 'staff_amenity' } };
    const prepared = prepareStaffForMovement(replaceWorker(current, worker), 0);

    expect(prepared.staff[0]).not.toHaveProperty('navigationYield');
    expect(prepared.staff[0]).not.toHaveProperty('navigationGoal');
  });

  it.each([
    ['take_order', { customerId: 'customer' }, {}],
    ['deliver_service_item', { serviceItemId: 'item', customerId: 'customer' }, {
      carryingServiceItemIds: ['item'],
    }],
  ])('retargets a persistently blocked %s task without releasing ownership',
    (type, taskFields, workerFields) => {
      const original = { x: 180, y: 220 };
      const worker = { id: 'worker', role: 'waiter', x: 180, y: 220,
        task: { type, ...taskFields }, navigationGoal: original,
        activityPhase: 'task_assigned', ...workerFields };
      const coordinator = createMovementCoordinator();
      coordinator.records.set('worker', { goal: original, waitingSeconds: 2 });
      coordinator.statuses.set('worker', {
        plan: 'waiting', motion: 'holding', reason: 'traffic', blockers: ['other'],
      });
      const current = {
        ...state,
        staff: [worker],
        customers: [{ id: 'customer', state: 'seated', tableId: 'table',
          dishId: null, drinkId: null }],
        tables: [{ id: 'table', status: 'occupied', x: 200, y: 220 }],
        serviceItems: type === 'deliver_service_item'
          ? [{ id: 'item', state: 'carried', tableId: 'table', customerId: 'customer' }]
          : [],
        movementCoordinator: coordinator,
      };

      const prepared = prepareStaffForMovement(current, 0);
      const result = prepared.staff[0];

      expect(result.task).toEqual(worker.task);
      expect(result.navigationGoal).toBeDefined();
      expect(result.navigationGoal).not.toEqual(original);
       if (type === 'deliver_service_item') expect(result.carryingServiceItemIds).toEqual(['item']);
      });

  it.each(['take_order', 'deliver_service_item'])
    ('moves a retargeted %s to a real alternate interaction point and completes it once', type => {
      const moved = moveBlockedServiceTask(blockedServiceTaskState(type));
      expect(moved.alternateGoal).toBeDefined();
      expect(moved.alternateGoal).not.toEqual(moved.originalGoal);
      expect(moved.sawMovement).toBe(true);

      const completed = resolveStaffAfterMovement(moved.current, 0, moved.statuses);
      const worker = completed.staff.find(candidate => candidate.id === 'worker');
      const item = completed.serviceItems.find(candidate => candidate.id === 'item');
      expect(worker.task).toBeNull();

      if (type === 'take_order') {
        expect(completed.customers[0].state).toBe('waiting_for_items');
        expect(completed.serviceItems).toHaveLength(1);
        expect(completed.serviceItems[0]).toMatchObject({
          customerId: 'customer', tableId: 'table', state: 'ordered', assignedStaffId: null,
        });
        const repeated = resolveStaffAfterMovement(completed, 0, moved.statuses);
        expect(repeated.serviceItems).toHaveLength(1);
        expect(repeated.serviceItems[0].id).toBe(completed.serviceItems[0].id);
      } else {
        expect(item).toMatchObject({ state: 'delivered', customerId: 'customer', tableId: 'table' });
        expect(worker.carryingServiceItemIds).toEqual([]);
        const repeated = resolveStaffAfterMovement(completed, 0, moved.statuses);
        expect(repeated.serviceItems.filter(candidate => candidate.state === 'delivered')).toHaveLength(1);
        expect(repeated.staff.find(candidate => candidate.id === 'worker').carryingServiceItemIds).toEqual([]);
      }
    });

  it.each([
    ['customer', { id: 'customer', state: 'seated', x: 420, y: 300,
      navigationGoal: { x: 500, y: 300 } }, {}],
    ['established checkout member', { id: 'checkout', state: 'checkout_moving', x: 420, y: 300,
      navigationGoal: { x: 500, y: 300 }, cashierStationId: 'station',
      checkoutPosition: { x: 620, y: 140 }, checkoutQueueIndex: 0, paymentReady: false }, {
      cashierStations: [{ id: 'station', assignedStaffId: 'beneficiary', x: 600, y: 120, w: 40, h: 40 }],
    }],
  ])('does not grant a %s blocker staff idle-yield authority', (_label, actor, extraState) => {
    const current = {
      ...heldState(),
      ...extraState,
      customers: [actor],
    };
    current.movementCoordinator.statuses.set('beneficiary', {
      motion: 'holding', plan: 'waiting', reason: 'traffic', blockers: [actor.id],
    });

    const prepared = prepareStaffForMovement(current, 0);

    expect(prepared.customers[0]).not.toHaveProperty('navigationYield');
    expect(prepared.customers[0].navigationGoal).toEqual(actor.navigationGoal);
  });
});
