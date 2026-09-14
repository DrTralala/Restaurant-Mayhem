import {
  DISHWASHER_BASE_WASH_WORK,
  getDishwasherStats,
} from './dishwasherProgression';
import { getCarriedServiceItemIds } from './staffInventory';

const DIRTY_STATES = new Set(['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing']);
const MANUAL_WASH_STATION_CAPACITY = 8;
const DIRTY_TRANSFER_TASKS = new Set(['deliver_dirty_item', 'transfer_dirty_item']);
const ACTIVE_WASH_STATE = 'washing';
const WORK_EPSILON = 1e-9;

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function getAutomaticStats(station) {
  const level = station?.level == null ? 1 : station.level;
  return getDishwasherStats(level);
}

export function getWashStationCapacity(station) {
  if (station?.type === 'manual') return MANUAL_WASH_STATION_CAPACITY;
  if (station?.type !== 'automatic') return 0;
  return getAutomaticStats(station)?.capacity ?? 0;
}

export function getWashStationOccupancy(state, station, {
  excludeServiceItemId = null,
  excludeServiceItemIds = [],
} = {}) {
  if (station?.id == null) return 0;
  const keyFor = id => String(id);
  const excludedIds = new Set(excludeServiceItemIds
    .filter(id => id != null)
    .map(keyFor));
  if (excludeServiceItemId != null) excludedIds.add(keyFor(excludeServiceItemId));
  const ids = new Set();
  const add = id => {
    if (id == null || excludedIds.has(keyFor(id))) return;
    ids.add(keyFor(id));
  };
  const serviceItems = state?.serviceItems || [];
  for (const item of serviceItems) {
    if (sameId(item?.washStationId, station.id)
      && ['queued_for_wash', 'washing', 'carried_dirty'].includes(item?.state)) {
      add(item.id);
    }
    if (sameId(item?.reservedWashStationId, station.id)) add(item.id);
  }
  for (const worker of state?.staff || []) {
    const task = worker?.task;
    if (DIRTY_TRANSFER_TASKS.has(task?.type) && sameId(task.washStationId, station.id)) {
      add(task.serviceItemId);
      for (const id of Array.isArray(task.serviceItemIds) ? task.serviceItemIds : []) add(id);
      for (const itemId of getCarriedServiceItemIds(worker)) {
        const item = serviceItems.find(candidate => sameId(candidate.id, itemId));
        if (item?.state === 'carried_dirty') add(itemId);
      }
    } else {
      // A carried item can have the destination on the item rather than on a
      // legacy task record. It is still one reservation for this station.
      for (const itemId of getCarriedServiceItemIds(worker)) {
        const item = serviceItems.find(candidate => sameId(candidate.id, itemId));
        if (item?.state === 'carried_dirty'
          && (sameId(item.washStationId, station.id)
            || sameId(item.reservedWashStationId, station.id))) add(itemId);
      }
    }
  }
  return ids.size;
}

export function hasWashStationCapacity(state, station, options) {
  return getWashStationOccupancy(state, station, options) < getWashStationCapacity(station);
}

/** Return whether a station currently has an item or worker doing wash work. */
export function isWashStationBusy(state, station) {
  const stationId = station?.id ?? station;
  if (stationId == null) return false;
  return (state?.serviceItems || []).some(item =>
    item?.state === ACTIVE_WASH_STATE && sameId(item?.washStationId, stationId))
    || (state?.staff || []).some(worker =>
      worker?.task?.type === 'wash_item' && sameId(worker.task.washStationId, stationId));
}

export const isAutomaticDishwasherBusy = (state, station) =>
  (station?.type === 'automatic'
    || (station?.type == null
      && state?.washStations?.find(candidate => sameId(candidate.id, station))?.type === 'automatic'))
  && isWashStationBusy(state, station);

function queueTime(item) {
  return Number.isFinite(item?.washQueuedAt) ? item.washQueuedAt : 0;
}

function compareQueuedItems(left, right) {
  return queueTime(left.item) - queueTime(right.item)
    || String(left.item.id).localeCompare(String(right.item.id))
    || left.index - right.index;
}

function isEligibleQueuedItem(item, station, now) {
  if (item?.state !== 'queued_for_wash') return false;
  if (item.washStationId != null && !sameId(item.washStationId, station.id)) return false;
  if (item.reservedWashStationId != null
    && !sameId(item.reservedWashStationId, station.id)) return false;
  return !Number.isFinite(item.washQueuedAt) || item.washQueuedAt <= now;
}

function queuedIndexFor(items, station, now, unassignedOnly = false) {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isEligibleQueuedItem(item, station, now)
      && (unassignedOnly ? item.washStationId == null : item.washStationId != null))
    .sort(compareQueuedItems)[0]?.index ?? -1;
}

function finiteWork(item) {
  return Number.isFinite(item?.accumulatedWork)
    ? Math.max(0, item.accumulatedWork) : 0;
}

function advanceWashingItem(item, stats, now, {
  startAt,
  existing = false,
} = {}) {
  const work = finiteWork(item);
  const hasWorkLedger = Number.isFinite(item.accumulatedWork);
  const queueAt = Number.isFinite(item.washQueuedAt) ? item.washQueuedAt : null;
  const itemStart = Number.isFinite(item.washStartedAt)
    ? item.washStartedAt
    : (Number.isFinite(startAt)
      ? startAt
      : Number.isFinite(item.lastProgressAt) ? item.lastProgressAt : now);
  if (itemStart > now) return { item, completed: false };

  // If accumulatedWork exists without a progress boundary, it is already a
  // partially migrated record. Establish the boundary at now rather than
  // inferring a second interval from its legacy start timestamp.
  const inferredBoundary = Number.isFinite(item.lastProgressAt)
    ? item.lastProgressAt
    : hasWorkLedger && existing
      ? now
      : itemStart;
  const progressStart = Math.max(
    Number.isFinite(inferredBoundary) ? inferredBoundary : now,
    queueAt ?? Number.NEGATIVE_INFINITY,
  );
  if (progressStart > now) {
    return {
      item: {
        ...item,
        state: ACTIVE_WASH_STATE,
        washStartedAt: itemStart,
        accumulatedWork: work,
        lastProgressAt: Number.isFinite(item.lastProgressAt) ? item.lastProgressAt : progressStart,
      },
      completed: false,
    };
  }

  const rate = stats.washRate;
  const remainingWork = Math.max(0, DISHWASHER_BASE_WASH_WORK - work);
  const completionAt = progressStart + remainingWork / rate;
  if (completionAt <= now + WORK_EPSILON) {
    return {
      item: null,
      completed: true,
      completionAt: Math.min(now, Math.max(progressStart, completionAt)),
    };
  }

  const elapsed = Math.max(0, now - progressStart);
  return {
    item: {
      ...item,
      state: ACTIVE_WASH_STATE,
      washStartedAt: itemStart,
      accumulatedWork: work + elapsed * rate,
      lastProgressAt: now,
    },
    completed: false,
  };
}

function replaceItem(items, index, replacement) {
  return items.map((item, candidateIndex) => candidateIndex === index ? replacement : item);
}

function removeItem(items, index) {
  return items.filter((_item, candidateIndex) => candidateIndex !== index);
}

function processAutomaticStation(state, serviceItems, station, now) {
  const stats = getAutomaticStats(station);
  if (!stats) return serviceItems;

  let items = serviceItems;
  let serialTime = Number.NEGATIVE_INFINITY;

  while (true) {
    const activeIndex = items.findIndex(item =>
      item.state === ACTIVE_WASH_STATE && sameId(item.washStationId, station.id));
    if (activeIndex >= 0) {
      const active = items[activeIndex];
      const progress = advanceWashingItem(active, stats, now, { existing: true });
      if (!progress.completed) return progress.item === active
        ? items : replaceItem(items, activeIndex, progress.item);
      items = removeItem(items, activeIndex);
      serialTime = progress.completionAt;
      continue;
    }

    let queuedIndex = queuedIndexFor(items, station, now);
    if (queuedIndex < 0) {
      const unassignedIndex = queuedIndexFor(items, station, now, true);
      if (unassignedIndex < 0 || !hasWashStationCapacity(
        { ...state, serviceItems: items },
        station,
        { excludeServiceItemId: items[unassignedIndex].id },
      )) return items;
      items = replaceItem(items, unassignedIndex, {
        ...items[unassignedIndex],
        washStationId: station.id,
      });
      queuedIndex = unassignedIndex;
    }

    const queued = items[queuedIndex];
    const queuedAt = Number.isFinite(queued.washQueuedAt) ? queued.washQueuedAt : now;
    const startAt = Math.max(
      Number.isFinite(serialTime) ? serialTime : Number.NEGATIVE_INFINITY,
      queuedAt,
    );
    const progress = advanceWashingItem(
      {
        ...queued,
        state: ACTIVE_WASH_STATE,
        washStartedAt: startAt,
        accumulatedWork: finiteWork(queued),
        lastProgressAt: startAt,
      },
      stats,
      now,
      { startAt },
    );
    if (!progress.completed) return replaceItem(items, queuedIndex, progress.item);
    items = removeItem(items, queuedIndex);
    serialTime = progress.completionAt;
  }
}

export function updateAutomaticDishwashers(state) {
  const now = state.restaurant?.gameTime;
  if (!Number.isFinite(now)) return { ...state, serviceItems: [...(state.serviceItems || [])] };
  let serviceItems = [...(state.serviceItems || [])];
  for (const station of (state.washStations || []).filter(candidate => candidate.type === 'automatic')) {
    serviceItems = processAutomaticStation(state, serviceItems, station, now);
  }
  return { ...state, serviceItems };
}

export { DIRTY_STATES };
