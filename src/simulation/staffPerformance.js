import { ACTIVITY_DURATIONS } from './activity';
import { getUpgradeEffect } from './balance';

export const STAFF_PERFORMANCE_BASE = 0.5;

const TASK_DURATIONS = Object.freeze({
  take_order: ACTIVITY_DURATIONS.takeOrder,
  take_payment: ACTIVITY_DURATIONS.takePayment,
  prepare_drink: ACTIVITY_DURATIONS.prepareDrink,
  clean_table: ACTIVITY_DURATIONS.wipeFloor,
  clean_floor: ACTIVITY_DURATIONS.wipeFloor,
  wash_item: ACTIVITY_DURATIONS.manualWash,
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveRate(value, fallback = 1) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/** Return the work-rate multiplier contributed by an employee's morale. */
export function getStaffPerformanceMultiplier(worker) {
  const morale = Number.isFinite(worker?.morale) ? worker.morale : 50;
  return STAFF_PERFORMANCE_BASE + clamp(morale, 0, 100) / 100;
}

// These names make the small domain helper convenient to consume without
// changing the canonical multiplier API.
export const getStaffPerformanceFactor = getStaffPerformanceMultiplier;
export const getMoralePerformanceMultiplier = getStaffPerformanceMultiplier;

function getDish(state, task) {
  const item = (state?.serviceItems || []).find(candidate =>
    candidate.id === task?.serviceItemId);
  return (state?.dishes || []).find(candidate => candidate.id === item?.menuItemId);
}

function getStation(state, task) {
  return (state?.kitchenStations || []).find(candidate => candidate.id === task?.stationId);
}

function inheritProgress(source, task) {
  if (!source) return source;
  const progress = {};
  for (const field of ['accumulatedWork', 'lastProgressAt']) {
    if (!Number.isFinite(source[field]) && Number.isFinite(task?.[field])) {
      progress[field] = task[field];
    }
  }
  return Object.keys(progress).length > 0 ? { ...source, ...progress } : source;
}

/** Return the complete rate for a staff task, including kitchen modifiers. */
export function getStaffTaskRate(state, worker, task = worker?.task) {
  const moraleRate = getStaffPerformanceMultiplier(worker);
  if (task?.type !== 'prepare_dish') return moraleRate;

  const station = getStation(state, task);
  const equipment = (state?.equipment || []).find(candidate =>
    candidate.id === station?.equipmentId && candidate.owned);
  const equipmentRate = equipment?.speedMultiplier || 1;
  const globalRate = 1 + getUpgradeEffect(state, 'globalSpeed');
  return moraleRate * equipmentRate * globalRate;
}

export const getStaffWorkRate = getStaffTaskRate;

/** Return the pre-morale rate used by the legacy timestamp representation. */
export function getStaffTaskLegacyRate(state, worker, task = worker?.task) {
  if (task?.type !== 'prepare_dish') return 1;
  const station = getStation(state, task);
  const equipment = (state?.equipment || []).find(candidate =>
    candidate.id === station?.equipmentId && candidate.owned);
  return (equipment?.speedMultiplier || 1) * (1 + getUpgradeEffect(state, 'globalSpeed'));
}

/** Return the unmodified work required by a timed task. */
export function getStaffTaskDuration(state, worker, task = worker?.task) {
  if (!task?.type) return null;
  if (task.type === 'prepare_dish') {
    return getDish(state, task)?.prepTime || 60;
  }
  return TASK_DURATIONS[task.type] ?? null;
}

function taskSource(state, worker) {
  const task = worker?.task;
  if (!task) return null;
  if (['prepare_drink', 'prepare_dish'].includes(task.type)) {
    return inheritProgress(
      (state?.serviceItems || []).find(item => item.id === task.serviceItemId) || null,
      task,
    );
  }
  if (task.type === 'wash_item') {
    return inheritProgress(
      (state?.serviceItems || []).find(item => item.id === task.serviceItemId),
      task,
    ) || task;
  }
  return task;
}

function taskStartedAt(source, task) {
  if (task?.type === 'prepare_dish' || task?.type === 'prepare_drink') {
    return source?.preparationStartedAt;
  }
  if (task?.type === 'wash_item') {
    return source?.washStartedAt ?? task.washingStartedAt;
  }
  if (task?.type === 'clean_table' || task?.type === 'clean_floor') {
    return source?.cleaningStartedAt;
  }
  return source?.startedAt;
}

/**
 * Describe a timed task using the same source fields used by the simulator.
 * `duration` is work units; `rate` converts game seconds into those units.
 */
export function getStaffTaskTiming(state, worker) {
  const task = worker?.task;
  const source = taskSource(state, worker);
  const duration = getStaffTaskDuration(state, worker, task);
  const startedAt = taskStartedAt(source, task);
  if (!source || !Number.isFinite(duration)
    || (!Number.isFinite(startedAt) && !Number.isFinite(source.accumulatedWork))) return null;
  return {
    task,
    source,
    startedAt,
    duration,
    rate: getStaffTaskRate(state, worker, task),
  };
}

export function getStaffTaskSource(state, worker) {
  return taskSource(state, worker);
}

/**
 * Advance a task's durable work ledger. Old saves only have a start timestamp;
 * their elapsed time is adopted as legacy work once (with any legacy task rate),
 * then new time uses the supplied rate. No work is added for a repeated or
 * backwards clock.
 */
export function advanceStaffTaskProgress(
  task,
  now,
  rate = 1,
  legacyStartedAt = task?.startedAt,
  legacyRate = 1,
) {
  const source = task || {};
  const safeNow = Number.isFinite(now) ? now : null;
  let accumulatedWork = Number.isFinite(source.accumulatedWork)
    ? Math.max(0, source.accumulatedWork)
    : null;
  let lastProgressAt = Number.isFinite(source.lastProgressAt)
    ? source.lastProgressAt
    : null;

  if (accumulatedWork == null) {
    accumulatedWork = safeNow != null && Number.isFinite(legacyStartedAt)
      ? Math.max(0, safeNow - legacyStartedAt) * positiveRate(legacyRate)
      : 0;
    lastProgressAt = safeNow;
  } else if (lastProgressAt == null) {
    // A partially migrated record already owns its accumulated work. Do not
    // infer another interval from its legacy timestamp and double-count it.
    lastProgressAt = safeNow;
  }

  if (safeNow != null && Number.isFinite(lastProgressAt) && safeNow > lastProgressAt) {
    accumulatedWork += (safeNow - lastProgressAt) * positiveRate(rate);
    lastProgressAt = safeNow;
  }

  return {
    task: {
      ...source,
      accumulatedWork,
      lastProgressAt,
    },
    accumulatedWork,
    lastProgressAt,
  };
}

export const advanceStaffWork = advanceStaffTaskProgress;

/** Return a renderable, non-mutating view of a staff task's work ledger. */
export function getStaffTaskProgress(state, worker) {
  const timing = getStaffTaskTiming(state, worker);
  if (!timing) return null;
  const progressed = advanceStaffTaskProgress(
    timing.source,
    state?.restaurant?.gameTime,
    timing.rate,
    timing.startedAt,
    getStaffTaskLegacyRate(state, worker),
  );
  const progress = clamp(progressed.accumulatedWork / timing.duration, 0, 1);
  return {
    ...timing,
    accumulatedWork: progressed.accumulatedWork,
    lastProgressAt: progressed.lastProgressAt,
    progress,
    remaining: 1 - progress,
    complete: progressed.accumulatedWork >= timing.duration,
    effectiveDuration: timing.duration / positiveRate(timing.rate),
  };
}

export function getStaffTaskRemainingFraction(state, worker) {
  return getStaffTaskProgress(state, worker)?.remaining ?? null;
}

export function getServiceItemProgress(state, item) {
  const station = (state?.washStations || []).find(candidate =>
    candidate?.type === 'manual'
      && String(candidate.id) === String(item?.washStationId));
  const worker = (state?.staff || []).find(candidate =>
    station
      && item?.state === 'washing'
      && candidate.role === 'janitor'
      && (item?.assignedStaffId == null
        || String(candidate.id) === String(item.assignedStaffId))
      && candidate.task?.type === 'wash_item'
      && String(candidate.task.serviceItemId) === String(item.id)
      && String(candidate.task.washStationId) === String(item.washStationId));
  return worker ? getStaffTaskProgress(state, worker) : null;
}
