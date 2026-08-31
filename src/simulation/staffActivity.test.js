import { describe, expect, it } from 'vitest';
import {
  buildBlockedCells,
  buildOccupiedCharacterCells,
  cellToWorld,
  worldToCell,
} from './pathfinding';
import {
  IDLE_ROAM_SPEED,
  getStaffMovementSpeed,
  prepareStaffActivity,
  settleTasklessActivity,
} from './staffActivity';

const state = {
  restaurant: { gameTime: 400, expansionLevel: 1 },
  customers: [], tables: [], chairs: [], kitchenStations: [], serviceTables: [],
  cashierStations: [], washStations: [],
  staff: [{ id: 'waiter', role: 'waiter', x: 400, y: 300, path: [] }],
};

describe('staff activity', () => {
  it('schedules an eligible employee before roaming', () => {
    const worker = settleTasklessActivity(state, state.staff[0]);
    expect(worker).toMatchObject({ activityPhase: 'idle_waiting', path: [] });
    expect(worker.idleUntil).toBeGreaterThanOrEqual(580);
    expect(worker.idleUntil).toBeLessThanOrEqual(760);
  });

  it('chooses a nearby legal reachable route when the pause expires', () => {
    const worker = { ...state.staff[0], activityPhase: 'idle_waiting', idleUntil: 399, roamSequence: 0 };
    const roaming = prepareStaffActivity(state, worker);
    const start = worldToCell(worker);
    const goal = roaming.path.at(-1);
    const distance = Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y);
    const occupied = buildOccupiedCharacterCells(state.staff, [worker.id]);
    expect(roaming.activityPhase).toBe('idle_roaming');
    expect(distance).toBeGreaterThanOrEqual(1);
    expect(distance).toBeLessThanOrEqual(3);
    expect(buildBlockedCells(state).has(`${goal.x},${goal.y}`)).toBe(false);
    expect(occupied.has(`${goal.x},${goal.y}`)).toBe(false);
    expect(getStaffMovementSpeed(roaming)).toBe(IDLE_ROAM_SPEED);
  });

  it.each([
    ['cook', { id: 'cook', role: 'cook', x: 400, y: 300 }],
    ['carrier', { id: 'carrier', role: 'waiter', x: 400, y: 300, carryingServiceItemId: 'item' }],
    ['tasked', { id: 'tasked', role: 'waiter', x: 400, y: 300, task: { type: 'clean_floor' } }],
  ])('does not roam a %s', (_name, worker) => {
    const result = prepareStaffActivity({ ...state, staff: [worker] }, worker);
    expect(result.activityPhase).not.toBe('idle_roaming');
  });

  it('starts another pause after a roaming route is exhausted', () => {
    const worker = { ...state.staff[0], activityPhase: 'idle_roaming', path: [], roamSequence: 1 };
    const result = prepareStaffActivity(state, worker);
    expect(result).toMatchObject({ activityPhase: 'idle_waiting', path: [] });
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
    expect(result).toMatchObject({ activityPhase: 'idle_waiting', path: [] });
    expect(result.idleUntil).toBeGreaterThan(400);
  });
});
