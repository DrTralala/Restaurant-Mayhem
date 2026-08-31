import {
  buildBlockedCells,
  buildOccupiedCharacterCells,
  cellKey,
  findPath,
  isInsideWorld,
  worldToCell,
} from './pathfinding';
import { getAssignedCashierStation } from './cashiers';

export const STAFF_ACTIVITY_PHASES = Object.freeze([
  'idle_waiting', 'idle_roaming', 'task_assigned', 'working', 'stationed',
]);
export const IDLE_ROAM_SPEED = 20;
const MIN_IDLE_GAME_SECONDS = 180;
const IDLE_RANGE_GAME_SECONDS = 181;

function hashId(id) {
  return String(id).split('').reduce((hash, character) =>
    ((hash * 31) + character.charCodeAt(0)) >>> 0, 0);
}

function idleDelay(worker) {
  return MIN_IDLE_GAME_SECONDS
    + ((hashId(worker.id) + (worker.roamSequence || 0) * 53) % IDLE_RANGE_GAME_SECONDS);
}

function canRoam(state, worker) {
  return !worker.task
    && worker.role !== 'cook'
    && !worker.carryingServiceItemId
    && !getAssignedCashierStation(state.cashierStations, worker.id);
}

export function markTaskAssigned(worker) {
  return { ...worker, activityPhase: 'task_assigned', idleUntil: null };
}

export function markWorking(worker) {
  return { ...worker, activityPhase: 'working', idleUntil: null };
}

export function settleTasklessActivity(state, worker) {
  if (worker.task || worker.carryingServiceItemId) return markTaskAssigned(worker);
  if (!canRoam(state, worker)) {
    return { ...worker, activityPhase: 'stationed', idleUntil: null };
  }
  if (worker.activityPhase === 'idle_roaming' && worker.path?.length) return worker;
  return {
    ...worker,
    activityPhase: 'idle_waiting',
    idleUntil: state.restaurant.gameTime + idleDelay(worker),
    path: [],
  };
}

export function getStaffMovementSpeed(worker) {
  if (worker.activityPhase === 'idle_roaming') return IDLE_ROAM_SPEED;
  return worker.role === 'waiter' ? 75 : 55;
}

export function prepareStaffActivity(state, worker) {
  if (worker.task) {
    return worker.activityPhase === 'working' ? worker : markTaskAssigned(worker);
  }
  if (worker.carryingServiceItemId) return markTaskAssigned(worker);
  if (!canRoam(state, worker)) {
    return { ...worker, activityPhase: 'stationed', idleUntil: null };
  }
  if (!worker.activityPhase && worker.path?.length) {
    return worker;
  }
  if (worker.activityPhase === 'idle_roaming') {
    return worker.path?.length ? worker : settleTasklessActivity(state, worker);
  }
  if (worker.activityPhase !== 'idle_waiting' || !Number.isFinite(worker.idleUntil)) {
    return settleTasklessActivity(state, worker);
  }
  if (state.restaurant.gameTime < worker.idleUntil) return worker;

  const start = worldToCell(worker);
  const blocked = buildBlockedCells(state);
  const occupiedCells = buildOccupiedCharacterCells(
    [...(state.staff || []), ...(state.customers || [])],
    [worker.id],
  );
  const candidates = [];
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const distance = Math.abs(dx) + Math.abs(dy);
      const candidate = { x: start.x + dx, y: start.y + dy };
      if (distance < 1 || distance > 3 || !isInsideWorld(state, candidate)
        || blocked.has(cellKey(candidate)) || occupiedCells.has(cellKey(candidate))) continue;
      candidates.push(candidate);
    }
  }
  candidates.sort((left, right) => left.y - right.y || left.x - right.x);
  const offset = candidates.length
    ? (hashId(worker.id) + (worker.roamSequence || 0)) % candidates.length
    : 0;
  const ordered = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  for (const candidate of ordered) {
    const path = findPath(state, start, candidate, { occupiedCells });
    if (!path.length) continue;
    return {
      ...worker,
      activityPhase: 'idle_roaming',
      idleUntil: null,
      roamSequence: (worker.roamSequence || 0) + 1,
      path,
    };
  }
  return settleTasklessActivity(state, {
    ...worker,
    activityPhase: null,
    roamSequence: (worker.roamSequence || 0) + 1,
    path: [],
  });
}
