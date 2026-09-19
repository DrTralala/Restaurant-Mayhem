import { ACTIVITY_DURATIONS } from './activity';
import {
  DISHWASHER_BASE_WASH_WORK,
  getDishwasherStats,
} from './dishwasherProgression';
import {
  findAdjacentOpenCells,
  findPath,
  cellToWorld,
  worldToCell,
} from './pathfinding';
import { getWashStationCapacity, getWashStationOccupancy } from './dishwashing';
import { getStaffTaskRate } from './staffPerformance';
import { getStaffMovementSpeed } from './staffActivity';

const TRANSFER_TASK_TYPES = new Set(['transfer_dirty_item', 'deliver_dirty_item']);
const TRANSFER_THRESHOLD_SECONDS = 5;
const PICKUP_SECONDS = 1;
const DROPOFF_SECONDS = 1;

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function finite(value) {
  return Number.isFinite(value);
}

function stationRect(station) {
  return {
    x: station?.x ?? 0,
    y: station?.y ?? 0,
    w: station?.w ?? 40,
    h: station?.h ?? 40,
  };
}

function stationCandidates(state, point, station) {
  if (!station || !finite(point?.x) || !finite(point?.y)) return [];
  const rect = stationRect(station);
  const start = worldToCell(point);
  const inside = point.x >= rect.x && point.x <= rect.x + rect.w
    && point.y >= rect.y && point.y <= rect.y + rect.h;
  if (inside) {
    const exit = findAdjacentOpenCells(state, rect, start)[0] || null;
    return [{
      cell: start,
      point: { x: point.x, y: point.y },
      exitPoint: exit ? cellToWorld(exit) : { x: point.x, y: point.y },
      route: [],
      distance: 0,
    }];
  }
  return findAdjacentOpenCells(state, rect, start)
    .map(cell => ({ cell, point: cellToWorld(cell), route: findPath(state, start, cell) }))
    .filter(candidate => candidate.route.length > 0
      || (candidate.cell.x === start.x && candidate.cell.y === start.y))
    .map(candidate => ({
      ...candidate,
      exitPoint: candidate.point,
      distance: candidate.route.length * 20
        + (candidate.cell.x === start.x && candidate.cell.y === start.y
          ? Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y) : 0),
    }));
}

function travelDistance(state, point, station) {
  return stationCandidates(state, point, station)
    .sort((left, right) => left.distance - right.distance
      || left.point.y - right.point.y || left.point.x - right.point.x)[0] || null;
}

function itemIsClaimed(state, item, workerId) {
  return (state?.staff || []).some(worker => worker.id !== workerId
    && (sameId(worker.task?.serviceItemId, item.id)
      || (worker.task?.serviceItemIds || []).some(id => sameId(id, item.id))
      || (worker.carryingServiceItemIds || []).some(id => sameId(id, item.id))
      || sameId(worker.carryingServiceItemId, item.id)));
}

function itemQueueTime(item, index) {
  return [item?.washQueuedAt, item?.eligibleAt, item?.createdAt]
    .find(finite) ?? index;
}

function isUnstartedQueuedDish(item) {
  return item?.kind === 'dish'
    && item.state === 'queued_for_wash'
    && !finite(item.washStartedAt)
    && !finite(item.cleaningAction?.startedAt)
    && item.reservedWashStationId == null;
}

function queueEntriesForStation(state, station, workerId) {
  return (state?.serviceItems || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => sameId(item.washStationId, station.id)
      && isUnstartedQueuedDish(item)
      && item.assignedStaffId == null
      && !itemIsClaimed(state, item, workerId))
    .sort((left, right) => itemQueueTime(left.item, left.index)
      - itemQueueTime(right.item, right.index)
      || String(left.item.id).localeCompare(String(right.item.id))
      || left.index - right.index);
}

function finiteWork(item) {
  return finite(item?.accumulatedWork) ? Math.max(0, item.accumulatedWork) : 0;
}

function automaticBacklogSeconds(state, station, now, excludeItemId = null) {
  const stats = getDishwasherStats(station?.level == null ? 1 : station.level);
  if (!stats || !finite(now)) return Infinity;
  const entries = new Map();
  const add = (id, queuedAt, duration) => {
    if (id == null || sameId(id, excludeItemId)) return;
    const key = String(id);
    if (!entries.has(key)) entries.set(key, { id, queuedAt, duration });
  };
  for (const item of state?.serviceItems || []) {
    if (!sameId(item.washStationId, station.id)
      || !['queued_for_wash', 'washing'].includes(item.state)) continue;
    const remaining = item.state === 'washing'
      ? Math.max(0, DISHWASHER_BASE_WASH_WORK - finiteWork(item)
        - (finite(item.lastProgressAt) && item.lastProgressAt < now
          ? (now - item.lastProgressAt) * stats.washRate : 0)) / stats.washRate
      : stats.secondsPerDish;
    add(item.id, itemQueueTime(item, 0), remaining);
  }
  for (const worker of state?.staff || []) {
    const task = worker.task;
    if (!TRANSFER_TASK_TYPES.has(task?.type) || !sameId(task.washStationId, station.id)) continue;
    const item = (state.serviceItems || []).find(candidate =>
      sameId(candidate.id, task.serviceItemId));
    add(task.serviceItemId, itemQueueTime(item, 0), stats.secondsPerDish);
  }
  const ordered = [...entries.values()].sort((left, right) => left.queuedAt - right.queuedAt
    || String(left.id).localeCompare(String(right.id)));
  return ordered.reduce((total, entry) => total + entry.duration, 0);
}

function manualBacklogSeconds(state, station, candidate, now, worker) {
  const rate = getStaffTaskRate(state, worker, {
    type: 'wash_item', serviceItemId: candidate.id, washStationId: station.id,
  });
  const safeRate = rate > 0 ? rate : 1;
  const active = (state.serviceItems || []).find(item =>
    sameId(item.washStationId, station.id) && item.state === 'washing');
  const activeRemaining = active
    ? Math.max(0, ACTIVITY_DURATIONS.manualWash - finiteWork(active)
      - (finite(active.lastProgressAt) && active.lastProgressAt < now
        ? (now - active.lastProgressAt) * safeRate : 0)) / safeRate
    : 0;
  const candidateTime = Math.max(0, ACTIVITY_DURATIONS.manualWash - finiteWork(candidate)) / safeRate;
  const queuedBefore = (state.serviceItems || [])
    .filter(item => sameId(item.washStationId, station.id)
      && item.state === 'queued_for_wash'
      && item.id !== candidate.id
      && itemQueueTime(item, 0) <= itemQueueTime(candidate, 0))
    .length;
  return activeRemaining
    + queuedBefore * (ACTIVITY_DURATIONS.manualWash / safeRate)
    + candidateTime;
}

function compareCandidates(left, right) {
  return right.saving - left.saving
    || String(left.serviceItemId).localeCompare(String(right.serviceItemId))
    || String(left.sourceWashStationId).localeCompare(String(right.sourceWashStationId))
    || String(left.washStationId).localeCompare(String(right.washStationId));
}

/**
 * Find the best queued dish to move from a manual sink to an automatic one.
 * The return value is a reservation descriptor; callers should copy its IDs
 * onto the item/task before routing so another worker cannot claim it.
 */
export function selectSinkTransfer(state, staffId, now = state?.restaurant?.gameTime) {
  const worker = (state?.staff || []).find(candidate => sameId(candidate.id, staffId));
  if (!worker || worker.role !== 'waiter' || worker.task || !finite(now)) return null;
  const movementSpeed = getStaffMovementSpeed(worker);
  if (!(movementSpeed > 0)) return null;
  const manualStations = (state?.washStations || []).filter(station => station.type === 'manual');
  const automaticStations = (state?.washStations || []).filter(station => station.type === 'automatic');
  const candidates = [];

  for (const source of manualStations) {
    const candidate = queueEntriesForStation(state, source, staffId)[0]?.item;
    if (!candidate) continue;
    const toSource = travelDistance(state, worker, source);
    if (!toSource) continue;
    const manualSeconds = toSource.distance / movementSpeed
      + PICKUP_SECONDS
      + manualBacklogSeconds(state, source, candidate, now, worker);

    for (const destination of automaticStations) {
      const stats = getDishwasherStats(destination.level == null ? 1 : destination.level);
      if (!stats || sameId(destination.id, source.id)) continue;
      const capacity = getWashStationCapacity(destination);
      const occupancy = getWashStationOccupancy(state, destination, {
        excludeServiceItemId: candidate.id,
      });
      if (occupancy >= capacity) continue;
      const toDestination = travelDistance(
        state,
        toSource.exitPoint ?? toSource.point,
        destination,
      );
      if (!toDestination) continue;
      const travelAndDropoff = toSource.distance / movementSpeed
        + PICKUP_SECONDS
        + toDestination.distance / movementSpeed
        + DROPOFF_SECONDS;
      const machineBacklog = automaticBacklogSeconds(state, destination, now, candidate.id);
      const machineSeconds = Math.max(travelAndDropoff, machineBacklog) + stats.secondsPerDish;
      const saving = manualSeconds - machineSeconds;
      if (saving < TRANSFER_THRESHOLD_SECONDS) continue;
      candidates.push({
        serviceItemId: candidate.id,
        washStationId: destination.id,
        sourceWashStationId: source.id,
        saving,
        manualCompletionAt: now + manualSeconds,
        machineCompletionAt: now + machineSeconds,
      });
    }
  }
  return candidates.sort(compareCandidates)[0] || null;
}

export const SINK_TRANSFER_THRESHOLD_SECONDS = TRANSFER_THRESHOLD_SECONDS;
