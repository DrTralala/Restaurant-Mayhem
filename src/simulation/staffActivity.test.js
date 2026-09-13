import { describe, expect, it } from 'vitest';
import {
  buildBlockedCells,
  cellToWorld,
  findPath,
  worldToCell,
} from './pathfinding';
import {
  IDLE_ROAM_SPEED,
  getStaffMovementSpeed,
  prepareStaffActivity,
  settleTasklessActivity,
} from './staffActivity';
import { prepareStaffForMovement } from './staff';
import { createInitialState } from '../state/initialState';

const state = {
  restaurant: { gameTime: 400, expansionLevel: 1 },
  customers: [], tables: [], chairs: [], kitchenStations: [], serviceTables: [],
  cashierStations: [], washStations: [],
  staff: [{ id: 'waiter', role: 'waiter', x: 400, y: 300 }],
};

describe('staff activity', () => {
  it.each([
    [0, 37.5, 10],
    [50, 75, 20],
    [100, 112.5, 30],
  ])('scales walking and idle-roam speed for morale %s', (morale, walking, roaming) => {
    expect(getStaffMovementSpeed({ role: 'waiter', morale })).toBe(walking);
    expect(getStaffMovementSpeed({ role: 'waiter', morale, activityPhase: 'idle_roaming' }))
      .toBe(roaming);
  });

  it('schedules an eligible employee before roaming', () => {
    const worker = settleTasklessActivity(state, state.staff[0]);
    expect(worker).toMatchObject({ activityPhase: 'idle_waiting' });
    expect(worker.idleUntil).toBeGreaterThanOrEqual(580);
    expect(worker.idleUntil).toBeLessThanOrEqual(760);
  });

  it('chooses a nearby legal reachable route when the pause expires', () => {
    const worker = { ...state.staff[0], activityPhase: 'idle_waiting', idleUntil: 399, roamSequence: 0 };
    const roaming = prepareStaffActivity(state, worker);
    const start = worldToCell(worker);
    const goal = worldToCell(roaming.navigationGoal);
    const distance = Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y);
    expect(roaming.activityPhase).toBe('idle_roaming');
    expect(distance).toBeGreaterThanOrEqual(1);
    expect(distance).toBeLessThanOrEqual(3);
    expect(buildBlockedCells(state).has(`${goal.x},${goal.y}`)).toBe(false);
    expect(findPath(state, start, goal).length).toBeGreaterThan(0);
    expect(roaming).not.toHaveProperty('path');
    expect(getStaffMovementSpeed(roaming)).toBe(IDLE_ROAM_SPEED);
  });

  it.each(['planning', 'scheduled'])('retains an idle-roaming goal while movement is %s', plan => {
    const goal = cellToWorld({ x: 21, y: 15 });
    const worker = {
      ...state.staff[0], activityPhase: 'idle_roaming', navigationGoal: goal,
    };
    const movementState = {
      ...state,
      staff: [worker],
      movementCoordinator: {
        requests: new Map([['waiter', { goal }]]),
        statuses: new Map([['waiter', { plan, motion: 'holding' }]]),
      },
    };

    const prepared = prepareStaffActivity(movementState, worker);

    expect(prepared).toMatchObject({ activityPhase: 'idle_roaming', navigationGoal: goal });
  });

  it('clears an arrived roaming goal before scheduling the next pause', () => {
    const worker = {
      ...state.staff[0], activityPhase: 'idle_roaming',
      navigationGoal: { x: 400, y: 300 },
    };

    const prepared = prepareStaffActivity({ ...state, staff: [worker] }, worker);

    expect(prepared).toMatchObject({ activityPhase: 'idle_waiting' });
    expect(prepared).not.toHaveProperty('navigationGoal');
  });

  it('selects a different roaming destination when the static candidate is occupied', () => {
    const worker = { ...state.staff[0], activityPhase: 'idle_waiting', idleUntil: 399, roamSequence: 0 };
    const occupiedState = {
      ...state,
      customers: [{ id: 'occupier', state: 'eating', x: 360, y: 300 }],
    };

    const roaming = prepareStaffActivity(occupiedState, worker);

    expect(roaming.activityPhase).toBe('idle_roaming');
    expect(Math.hypot(roaming.navigationGoal.x - 360, roaming.navigationGoal.y - 300)).toBeGreaterThanOrEqual(16);
    expect(findPath(occupiedState, worldToCell(worker), worldToCell(roaming.navigationGoal)).length).toBeGreaterThan(0);
    expect(roaming).not.toHaveProperty('path');
  });

  it('releases the captured duplicate idle goal without moving either worker', () => {
    const staff = [
      { id: 'starter-host', role: 'waiter', x: 520, y: 360 },
      { id: 'starter-janitor', role: 'janitor', x: 533.3333333333333, y: 320 },
    ].map(worker => ({ ...worker, task: null, activityPhase: 'idle_roaming',
      navigationGoal: { x: 540, y: 320 } }));
    const prepared = prepareStaffActivity({ ...state, staff }, staff[0]);
    expect(prepared).toMatchObject({ x: 520, y: 360, activityPhase: 'idle_waiting' });
    expect(prepared).not.toHaveProperty('navigationGoal');
    expect(staff[1].navigationGoal).toEqual({ x: 540, y: 320 });
  });

  it('arbitrates simultaneous idle choices independently of the staff array order', () => {
    const initial = createInitialState();
    // These hashes/sequences both select (500,280) without shared claims.
      const staff = [
        { id: 'a', role: 'waiter', x: 500, y: 300, roamSequence: 5 },
        { id: 'b', role: 'janitor', x: 520, y: 300, roamSequence: 3 },
      ].map(worker => ({ ...worker, morale: 80, task: null, activityPhase: 'idle_waiting',
        idleUntil: 0 }));
      const fixture = { ...initial, staff, tables: [], chairs: [], customers: [],
        queue: [], floorDirt: [], cashierStations: [], serviceItems: [] };
      const forward = prepareStaffForMovement(fixture, 0).staff;
      const reverse = prepareStaffForMovement({ ...fixture, staff: [...staff].reverse() }, 0).staff;
      const goals = forward.map(worker => worker.navigationGoal);
      expect(goals.every(Boolean)).toBe(true);
      expect(Math.hypot(goals[0].x - goals[1].x, goals[0].y - goals[1].y)).toBeGreaterThanOrEqual(16);
      expect(Object.fromEntries(forward.map(worker => [worker.id, worker.navigationGoal])))
        .toEqual(Object.fromEntries(reverse.map(worker => [worker.id, worker.navigationGoal])));
  });

  it.each([
    ['cook', { id: 'cook', role: 'cook', x: 400, y: 300 }],
    ['carrier', { id: 'carrier', role: 'waiter', x: 400, y: 300, carryingServiceItemId: 'item' }],
    ['tasked', { id: 'tasked', role: 'waiter', x: 400, y: 300, task: { type: 'clean_floor' } }],
  ])('does not roam a %s', (_name, worker) => {
    const result = prepareStaffActivity({ ...state, staff: [worker] }, worker);
    expect(result.activityPhase).not.toBe('idle_roaming');
  });

  it('retains an off-station cashier goal while preparing taskless activity', () => {
    const goal = cellToWorld({ x: 42, y: 5 });
    const worker = {
      id: 'cashier', role: 'waiter', x: 300, y: 300,
      activityPhase: 'stationed', navigationGoal: goal, task: null,
    };
    const movementState = {
      ...state,
      staff: [worker],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier',
      }],
    };

    const prepared = prepareStaffActivity(movementState, worker);

    expect(prepared).toMatchObject({ activityPhase: 'stationed', navigationGoal: goal });
  });

  it('starts another pause after a roaming route is exhausted', () => {
    const worker = { ...state.staff[0], activityPhase: 'idle_roaming', roamSequence: 1 };
    const result = prepareStaffActivity(state, worker);
    expect(result).toMatchObject({ activityPhase: 'idle_waiting' });
    expect(result.idleUntil).toBeGreaterThanOrEqual(580);
    expect(result.idleUntil).toBeLessThanOrEqual(760);
  });

  it('schedules another pause when every nearby destination is blocked', () => {
    const worker = { ...state.staff[0], activityPhase: 'idle_waiting', idleUntil: 399, roamSequence: 0 };
    const start = worldToCell(worker);
    const tables = [];
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance < 1 || distance > 3) continue;
        const point = cellToWorld({ x: start.x + dx, y: start.y + dy });
        tables.push({ id: `${dx},${dy}`, ...point });
      }
    }
    const result = prepareStaffActivity({ ...state, tables }, worker);
    expect(result).toMatchObject({ activityPhase: 'idle_waiting' });
    expect(result.idleUntil).toBeGreaterThan(400);
  });
});
