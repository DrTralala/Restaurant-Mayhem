import {
  cellToWorld,
  findPath,
  isInsideWorld,
  worldToCell,
} from './pathfinding';
import { getAssignedCashierStation } from './cashiers';
import { getCharacterMovementStatus } from './movement';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
import { getCashierWorkPosition } from './world';
import { canClaimDestination } from './navigation/destinations';
import { prepareIdleYield } from './navigation/idleYield';
import { getCarriedServiceItemIds } from './staffInventory';
import { getStaffPerformanceMultiplier } from './staffPerformance';

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
    && getCarriedServiceItemIds(worker).length === 0
    && !getAssignedCashierStation(state.cashierStations, worker.id);
}

function cashierStationGoal(state, worker) {
  const station = getAssignedCashierStation(state.cashierStations, worker.id);
  return station ? getCashierWorkPosition(station) : null;
}

function atPoint(worker, point) {
  return point
    && Number.isFinite(worker.x) && Number.isFinite(worker.y)
    && Math.hypot(worker.x - point.x, worker.y - point.y) <= 2;
}

export function markTaskAssigned(worker) {
  return { ...worker, activityPhase: 'task_assigned', idleUntil: null };
}

export function markWorking(worker) {
  return { ...worker, activityPhase: 'working', idleUntil: null };
}

export function settleTasklessActivity(state, worker) {
  if (worker.task || getCarriedServiceItemIds(worker).length > 0) return markTaskAssigned(worker);
  if (!canRoam(state, worker)) {
    const stationGoal = cashierStationGoal(state, worker);
    if (stationGoal && !atPoint(worker, stationGoal)) {
      return setNavigationGoal(
        { ...worker, activityPhase: 'stationed', idleUntil: null },
        stationGoal,
      );
    }
    return clearNavigationGoal({ ...worker, activityPhase: 'stationed', idleUntil: null });
  }
  return clearNavigationGoal({
    ...worker,
    activityPhase: 'idle_waiting',
    idleUntil: state.restaurant.gameTime + idleDelay(worker),
  });
}

export function getStaffMovementSpeed(worker) {
  const baseSpeed = worker.activityPhase === 'idle_roaming'
    ? IDLE_ROAM_SPEED
    : worker.role === 'waiter' ? 75 : 55;
  return baseSpeed * getStaffPerformanceMultiplier(worker);
}

export function prepareStaffActivity(state, worker) {
  const yielded = prepareIdleYield(state, worker);
  if (yielded !== undefined) return yielded;
  if (worker.task) {
    return worker.activityPhase === 'working' ? worker : markTaskAssigned(worker);
  }
  if (getCarriedServiceItemIds(worker).length > 0) return markTaskAssigned(worker);
  if (!canRoam(state, worker)) {
    const stationGoal = cashierStationGoal(state, worker);
    if (stationGoal && !atPoint(worker, stationGoal)) {
      return setNavigationGoal(
        { ...worker, activityPhase: 'stationed', idleUntil: null },
        stationGoal,
      );
    }
    return clearNavigationGoal({ ...worker, activityPhase: 'stationed', idleUntil: null });
  }
  if (worker.activityPhase === 'idle_roaming') {
    if (!canClaimDestination(state, worker, worker.navigationGoal)) {
      return settleTasklessActivity(state, worker);
    }
    const status = getCharacterMovementStatus(state, worker.id);
    if (['planning', 'scheduled'].includes(status.plan)
      && Number.isFinite(worker.navigationGoal?.x)
      && Number.isFinite(worker.navigationGoal?.y)) return worker;
    return settleTasklessActivity(state, worker);
  }
  if (worker.activityPhase !== 'idle_waiting' || !Number.isFinite(worker.idleUntil)) {
    return settleTasklessActivity(state, worker);
  }
  if (state.restaurant.gameTime < worker.idleUntil) return worker;

  const start = worldToCell(worker);
  const candidates = [];
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const distance = Math.abs(dx) + Math.abs(dy);
      const candidate = { x: start.x + dx, y: start.y + dy };
      if (distance < 1 || distance > 3 || !isInsideWorld(state, candidate)
        || !findPath(state, start, candidate).length) continue;
      candidates.push(candidate);
    }
  }
  candidates.sort((left, right) => left.y - right.y || left.x - right.x);
  const offset = candidates.length
    ? (hashId(worker.id) + (worker.roamSequence || 0)) % candidates.length
    : 0;
  const ordered = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  for (const candidate of ordered) {
    if (!canClaimDestination(state, worker, cellToWorld(candidate))) continue;
    return setNavigationGoal({
      ...worker,
      activityPhase: 'idle_roaming',
      idleUntil: null,
      roamSequence: (worker.roamSequence || 0) + 1,
    }, cellToWorld(candidate));
  }
  return settleTasklessActivity(state, {
    ...worker,
    activityPhase: null,
    roamSequence: (worker.roamSequence || 0) + 1,
  });
}
