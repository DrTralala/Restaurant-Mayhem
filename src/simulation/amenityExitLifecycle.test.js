import { describe, expect, it } from 'vitest';
import { createEmptyAmenitySlots, getAmenityGeometry } from '../data/staffAmenities';
import { createInitialState } from '../state/initialState';
import { hydrateState } from '../state/persistence';
import { movementSaveSnapshot } from '../state/movementPersistence';
import { validateSavedState } from '../state/saveValidation';
import { runTick } from './gameLoop';
import { createGrid } from './navigation/grid';
import { createActorGrid } from './navigation/domainGrid';
import { findRoute } from './navigation/router';
import { selectStaffWellbeingExit } from './staffWellbeing';

const allWork = () => Array.from({ length: 48 }, () => 'work');

function dutySchedule(type) {
  const schedule = allWork();
  if (type === 'bed') {
    for (let index = 0; index < 14; index += 1) schedule[index] = 'pto';
  } else {
    schedule[0] = 'rest';
  }
  return schedule;
}

function makeWorker(id, position, type, overrides = {}) {
  const initial = createInitialState();
  return {
    ...initial.staff[0],
    id,
    name: id,
    x: position.x,
    y: position.y,
    schedule: dutySchedule(type),
    effectiveDuty: type === 'bed' ? 'pto' : 'work',
    dutyPhase: type === 'bed' ? 'seeking_amenity' : 'available',
    task: null,
    navigationGoal: undefined,
    ...overrides,
  };
}

function makeState({ type = 'couch', rotation = 0, gameTime = 0, staff = null } = {}) {
  const initial = createInitialState();
  const amenity = {
    id: `${type}-1`, type, x: 500, y: 300, rotation,
    slots: createEmptyAmenitySlots(type),
  };
  const geometry = getAmenityGeometry(amenity);
  const resident = makeWorker('resident', geometry.approachPoints[0], type, {
    morale: type === 'bed' ? 35 : 50,
  });
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime, funds: 10_000 },
    staff: staff || [resident],
    staffAmenities: [amenity],
    tables: [],
    chairs: [],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    customers: [],
    queue: [],
    queueSlots: [],
    doors: [
      { id: 'door-entrance', y: 340, role: 'entrance' },
      { id: 'door-exit', y: 440, role: 'exit' },
    ],
    serviceItems: [],
    cookingBatches: [],
    floorDirt: [],
  };
}

function makeExitingCouchState({
  workerId = 'resident',
  occupiedBy = workerId,
  position = null,
  navigationGoal = undefined,
} = {}) {
  const state = makeState({ type: 'couch' });
  const geometry = getAmenityGeometry(state.staffAmenities[0]);
  const anchor = geometry.slotAnchors[0];
  const worker = {
    ...state.staff[0],
    id: workerId,
    name: workerId,
    x: position?.x ?? anchor.x,
    y: position?.y ?? anchor.y,
    effectiveDuty: 'work',
    dutyPhase: 'exiting',
    amenityUse: {
      amenityId: 'couch-1', slotIndex: 0, phase: 'occupied',
      activityStartedAt: 0, activityEndsAt: 900, lastRecoveryAt: 0,
    },
    movementResidency: { kind: 'staff_amenity', amenityId: 'couch-1', slotIndex: 0 },
    navigationGoal: navigationGoal === undefined ? geometry.exitCandidates[0] : navigationGoal,
  };
  return {
    ...state,
    staff: [worker],
    staffAmenities: state.staffAmenities.map(amenity => ({
      ...amenity,
      slots: amenity.slots.map(slot => slot.index === 0
        ? { ...slot, occupiedBy, reservedBy: null } : slot),
    })),
  };
}

function step(state, gameDt = 1, movementDt = 1) {
  return runTick(state, { gameDt, movementDt });
}

function setWorkSchedule(state, ids = null) {
  const selected = ids ? new Set(ids) : null;
  return {
    ...state,
    staff: state.staff.map(worker => selected && !selected.has(worker.id)
      ? worker : { ...worker, schedule: allWork() }),
  };
}

function workerAtExit(state, workerId = 'resident') {
  return state.staff.find(worker => worker.id === workerId);
}

function expectReleasedAtWork(state, workerId = 'resident') {
  const worker = workerAtExit(state, workerId);
  expect(worker).toMatchObject({
    effectiveDuty: 'work', dutyPhase: 'available', amenityUse: null,
  });
  expect(worker).not.toHaveProperty('movementResidency');
  expect(state.staffAmenities[0].slots.every(slot =>
    slot.reservedBy == null && slot.occupiedBy == null)).toBe(true);
}

function advanceToCouchEnd(state) {
  return runTick(setWorkSchedule(state), { gameDt: 900, movementDt: 0 });
}

function advanceToBedMinimum(state) {
  return runTick(state, { gameDt: 25_200, movementDt: 0 });
}

describe('canonical staff amenity exits', () => {
  it('exits a couch in fixed one-second steps and returns the worker to work', () => {
    let state = makeState({ type: 'couch', gameTime: 899 });
    validateSavedState(state);
    state = step(state);
    expect(state.restaurant.gameTime).toBe(900);
    expect(state.staff[0].amenityUse?.phase).toBe('occupied');

    const expectedExit = selectStaffWellbeingExit(state, 'resident');
    const activityEnd = state.staff[0].amenityUse.activityEndsAt;
    while (state.restaurant.gameTime < activityEnd - 1) state = step(state);
    expect(state.restaurant.gameTime).toBe(activityEnd - 1);
    expect(state.staff[0].amenityUse?.phase).toBe('occupied');

    state = step(state);

    expectReleasedAtWork(state);
    expect(state.staff[0]).toMatchObject(expectedExit);
    expect(state.movementCoordinator.statuses.get('resident')?.plan).toBe('arrived');
  });

  it('honours the actual seven-hour bed minimum and awards one idempotent waking buff', () => {
    let state = makeState({ type: 'bed' });
    validateSavedState(state);
    state = step(state);
    const started = state.staff[0];
    const minimumEndAt = started.ptoSession.minimumEndAt;
    const expectedExit = selectStaffWellbeingExit(state, 'resident');

    while (state.restaurant.gameTime < minimumEndAt - 1) state = step(state);
    expect(state.restaurant.gameTime).toBe(minimumEndAt - 1);
    expect(state.staff[0]).toMatchObject({ effectiveDuty: 'pto', dutyPhase: 'active' });
    expect(state.staff[0].amenityUse?.phase).toBe('occupied');
    expect(state.staff[0].morale).toBeLessThan(100);

    state = step(state);
    expectReleasedAtWork(state);
    expect(state.staff[0]).toMatchObject({
      morale: 100,
      wellRestedUntil: minimumEndAt + 86_400,
      ...expectedExit,
    });
    const waking = {
      morale: state.staff[0].morale,
      wellRestedUntil: state.staff[0].wellRestedUntil,
    };

    state = runTick(state, { gameDt: 0, movementDt: 0 });
    expect(state.staff[0]).toMatchObject(waking);
    expect(state.staff[0].amenityUse).toBeNull();
  });

  it.each(['couch', 'bed'])('round-trips an exiting %s before canonical movement resumes', type => {
    let state = makeState({ type, gameTime: type === 'couch' ? 899 : 0 });
    state = step(state);
    state = type === 'couch' ? advanceToCouchEnd(state) : advanceToBedMinimum(state);

    expect(state.staff[0]).toMatchObject({
      dutyPhase: 'exiting', amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity' },
    });
    const snapshot = movementSaveSnapshot(state);
    const restored = hydrateState(snapshot, createInitialState());
    expect(restored.staff[0]).toMatchObject({
      dutyPhase: 'exiting', amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity' },
    });

    const continued = step(restored);
    expectReleasedAtWork(continued);
  });

  it.each(['couch', 'bed'])('round-trips a partially traversed exiting %s', type => {
    let state = makeState({ type, gameTime: type === 'couch' ? 899 : 0 });
    state = step(state);
    state = type === 'couch' ? advanceToCouchEnd(state) : advanceToBedMinimum(state);
    state = step(state, 1, 0.1);
    expect(state.staff[0]).toMatchObject({
      dutyPhase: 'exiting', amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity' },
    });
    expect(state.staff[0].movementResidency).toBeTruthy();

    const restored = hydrateState(movementSaveSnapshot(state), createInitialState());
    expect(restored.staff[0]).toMatchObject({
      dutyPhase: 'exiting', amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity' },
    });
    expectReleasedAtWork(step(restored));
  });

  it('requires a matching state staff record while accepting coordinator clones', () => {
    const state = makeExitingCouchState();
    const worker = state.staff[0];
    const clone = {
      ...worker,
      amenityUse: { ...worker.amenityUse },
      movementResidency: { ...worker.movementResidency },
      navigationGoal: { ...worker.navigationGoal },
    };
    const grid = createActorGrid(state, clone, createGrid(state));
    expect(findRoute(grid, clone, clone.navigationGoal).status).toBe('found');

    const forgedState = { ...state, staff: [] };
    const forgedGrid = createActorGrid(forgedState, worker, createGrid(forgedState));
    expect(findRoute(forgedGrid, worker, worker.navigationGoal).status).toBe('unreachable');
  });

  it('excludes a customer-shaped actor from staff amenity departure authorisation', () => {
    const state = makeExitingCouchState();
    const customer = {
      ...state.staff[0], id: 'customer', role: 'customer', state: 'leaving',
      amenityUse: { ...state.staff[0].amenityUse },
      movementResidency: { ...state.staff[0].movementResidency },
      navigationGoal: { ...state.staff[0].navigationGoal },
    };
    const forgedState = { ...state, staff: [], customers: [{ ...customer, id: 'real-customer' }] };
    const grid = createActorGrid(forgedState, customer, createGrid(forgedState));
    expect(findRoute(grid, customer, customer.navigationGoal).status).toBe('unreachable');
  });

  it('rejects stale occupied ownership before creating an exit grid', () => {
    const state = makeExitingCouchState({ occupiedBy: 'other-worker' });
    const grid = createActorGrid(state, state.staff[0], createGrid(state));
    expect(findRoute(grid, state.staff[0], state.staff[0].navigationGoal).status).toBe('unreachable');
  });

  it('does not select an exit for a resident whose occupied slot belongs elsewhere', () => {
    const state = makeExitingCouchState({ occupiedBy: 'other-worker' });
    expect(selectStaffWellbeingExit(state, 'resident')).toBeNull();
  });

  it('validates a non-null exit goal even when the resident remains at its anchor', () => {
    const state = makeExitingCouchState({ navigationGoal: { x: 515, y: 295 } });
    expect(() => validateSavedState(state)).toThrow(/goal|anchor|exit/i);
  });

  it('rejects an exit segment that crosses another couch slot', () => {
    const state = makeExitingCouchState({
      position: { x: 520, y: 310 },
      navigationGoal: { x: 550, y: 310 },
    });
    const grid = createActorGrid(state, state.staff[0], createGrid(state));
    expect(() => validateSavedState(state)).toThrow(/anchor|goal|exit|residen/i);
    expect(findRoute(grid, state.staff[0], state.staff[0].navigationGoal).status).toBe('unreachable');
  });

  it('round-trips a blocked anchor exit with no navigation goal', () => {
    let state = makeState({ type: 'couch' });
    state = step(state);
    const geometry = getAmenityGeometry(state.staffAmenities[0]);
    const blockers = geometry.exitCandidates.map((point, index) => makeWorker(
      `blocked-exit-${index}`, point, 'couch', {
        schedule: allWork(), effectiveDuty: 'work', dutyPhase: 'available',
      },
    ));
    state = setWorkSchedule({ ...state, staff: [state.staff[0], ...blockers] }, ['resident']);
    state = runTick(state, { gameDt: 900, movementDt: 0 });
    expect(state.staff[0]).toMatchObject({
      dutyPhase: 'exiting', dutyBlockReason: 'blocked-exit',
      amenityUse: { phase: 'occupied' }, movementResidency: { kind: 'staff_amenity' },
    });
    expect(state.staff[0].navigationGoal).toBeUndefined();

    const restored = hydrateState(movementSaveSnapshot(state), createInitialState());
    expect(restored.staff[0]).toMatchObject({
      dutyPhase: 'exiting', dutyBlockReason: 'blocked-exit',
      amenityUse: { phase: 'occupied' }, movementResidency: { kind: 'staff_amenity' },
    });
    expect(restored.staff[0].navigationGoal).toBeUndefined();
  });

  it('keeps an occupied resident until an actor blocking its selected exit moves away', () => {
    let state = makeState({ type: 'couch', gameTime: 899 });
    state = step(state);
    state = advanceToCouchEnd(state);
    const exit = state.staff[0].navigationGoal;
    const blocker = makeWorker('exit-blocker', exit, 'couch', {
      schedule: allWork(), effectiveDuty: 'work', dutyPhase: 'available',
    });
    state = { ...state, staff: [...state.staff, blocker] };

    state = step(state);
    const blocked = workerAtExit(state);
    expect(blocked).toMatchObject({
      x: state.staffAmenities[0].x + 10,
      y: state.staffAmenities[0].y + 10,
      amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity' },
    });
    expect(state.movementCoordinator.statuses.get('resident')?.plan).not.toBe('arrived');

    state = {
      ...state,
      staff: state.staff.map(worker => worker.id === 'exit-blocker'
        ? { ...worker, x: 700, y: 600 } : worker),
    };
    state = step(state);
    expectReleasedAtWork(state);
  });

  it('does not authorise a stale exit through an unrelated solid fixture', () => {
    let state = makeState({ type: 'couch', gameTime: 899 });
    state = step(state);
    state = {
      ...state,
      tables: [
        { id: 'exit-top', x: 500, y: 260, status: 'empty', seats: 2 },
        { id: 'exit-left', x: 460, y: 300, status: 'empty', seats: 2 },
        { id: 'exit-right', x: 540, y: 300, status: 'empty', seats: 2 },
        { id: 'exit-bottom', x: 500, y: 320, status: 'empty', seats: 2 },
      ],
    };
    validateSavedState(state);
    state = advanceToCouchEnd(state);
    state = step(state);

    expect(state.staff[0]).toMatchObject({
      amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity' },
      dutyPhase: 'exiting',
      dutyBlockReason: 'blocked-exit',
    });
    expect(state.staff[0].navigationGoal).toBeUndefined();
  });

  it('keeps simultaneous couch exits exclusive and avoids duplicate actor positions', () => {
    const geometry = getAmenityGeometry({ type: 'couch', x: 500, y: 300, rotation: 0 });
    const staff = [
      makeWorker('a', geometry.approachPoints[0], 'couch'),
      makeWorker('b', geometry.approachPoints[1], 'couch'),
    ];
    let state = makeState({ type: 'couch', gameTime: 899, staff });
    state = step(state);
    expect(state.staff.map(worker => worker.amenityUse?.phase)).toEqual(['occupied', 'occupied']);
    expect(state.staffAmenities[0].slots.map(slot => slot.occupiedBy)).toEqual(['a', 'b']);
    state = advanceToCouchEnd(state);

    state = step(state);
    expect(new Set(state.staffAmenities[0].slots.map(slot => slot.occupiedBy).filter(Boolean)).size)
      .toBeLessThanOrEqual(1);
    expect(Math.hypot(
      state.staff[0].x - state.staff[1].x,
      state.staff[0].y - state.staff[1].y,
    )).toBeGreaterThanOrEqual(16);
    expect(state.staff.filter(worker => worker.amenityUse?.phase === 'occupied').length)
      .toBeLessThanOrEqual(1);

    if (state.staff.some(worker => worker.amenityUse?.phase === 'occupied')) {
      state = runTick(state, { gameDt: 29, movementDt: 0 });
      expect(state.staff.find(worker => worker.amenityUse?.phase === 'occupied')).toBeTruthy();
      state = step(state);
    }
    expectReleasedAtWork({ ...state, staffAmenities: state.staffAmenities }, 'a');
    expectReleasedAtWork({ ...state, staffAmenities: state.staffAmenities }, 'b');
    expect(Math.hypot(
      state.staff[0].x - state.staff[1].x,
      state.staff[0].y - state.staff[1].y,
    )).toBeGreaterThanOrEqual(16);
  });

  it('retries a fully blocked exit and releases only after an exterior point is available', () => {
    let state = makeState({ type: 'couch' });
    state = step(state);
    const geometry = getAmenityGeometry(state.staffAmenities[0]);
    const blockers = geometry.exitCandidates.map((point, index) => makeWorker(
      `exit-blocker-${index}`, point, 'couch', {
        schedule: allWork(), effectiveDuty: 'work', dutyPhase: 'available',
      },
    ));
    state = setWorkSchedule({ ...state, staff: [state.staff[0], ...blockers] }, ['resident']);
    validateSavedState(state);
    state = runTick(state, { gameDt: 900, movementDt: 0 });

    expect(state.staff[0]).toMatchObject({
      dutyPhase: 'exiting', dutyBlockReason: 'blocked-exit',
      amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity' },
    });
    expect(state.staff[0].navigationGoal).toBeUndefined();

    state = {
      ...state,
      staff: state.staff.map((worker, index) => index === 0
        ? worker : { ...worker, x: 700 + index * 20, y: 600 }),
    };
    state = runTick(state, { gameDt: 30, movementDt: 0 });
    expect(state.staff[0]).toMatchObject({
      dutyPhase: 'exiting', amenityUse: { phase: 'occupied' },
      movementResidency: { kind: 'staff_amenity' },
      navigationGoal: expect.any(Object),
    });
    state = step(state);
    expectReleasedAtWork(state);
  });

  it('gives an older waiting worker a freed couch slot before the prior resident renews', () => {
    const geometry = getAmenityGeometry({ type: 'couch', x: 500, y: 300, rotation: 0 });
    const staff = [
      makeWorker('a', geometry.approachPoints[0], 'couch'),
      makeWorker('b', geometry.approachPoints[1], 'couch'),
      makeWorker('older-waiter', { x: 700, y: 330 }, 'couch'),
    ];
    let state = makeState({ type: 'couch', staff });
    state = step(state);
    expect(state.staff.find(worker => worker.id === 'older-waiter')).toMatchObject({
      dutyPhase: 'waiting_for_amenity', amenityUse: null,
    });
    state = runTick(state, { gameDt: 900, movementDt: 0 });
    state = step(state);

    expect(state.staff.find(worker => worker.id === 'older-waiter')).toMatchObject({
      amenityUse: { phase: 'reserved', amenityId: 'couch-1' },
      dutyPhase: 'travelling',
    });
    expect(state.staff.filter(worker => worker.amenityUse?.phase === 'occupied')).toHaveLength(1);
    expect(state.staff.filter(worker => worker.amenityUse?.phase === 'reserved')).toHaveLength(1);
  });

  it.each([
    ['couch', 0], ['couch', 1], ['couch', 2], ['couch', 3],
    ['bed', 0], ['bed', 1], ['bed', 2], ['bed', 3],
  ])('exits a %s at rotation %s through the real coordinator', (type, rotation) => {
    let state = makeState({ type, rotation, gameTime: type === 'couch' ? 899 : 0 });
    validateSavedState(state);
    state = step(state);
    state = type === 'couch' ? advanceToCouchEnd(state) : advanceToBedMinimum(state);
    expect(state.staff[0].dutyPhase).toBe('exiting');
    expect(state.staff[0].amenityUse?.phase).toBe('occupied');

    state = step(state);
    expectReleasedAtWork(state);
  });
});
