import { isAtNavigationGoal } from './movement/navigationGoal';

const CLEANING_TASK_TYPES = new Set([
  'clean_table',
  'clean_floor',
  'wash_item',
]);

const EPSILON = 1e-9;

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function finite(value) {
  return Number.isFinite(value);
}

function targetIdForTask(task, actionId) {
  if (actionId && typeof actionId === 'object') {
    if (actionId.id != null) return actionId.id;
    if (actionId.actionId != null) return actionId.actionId;
  }
  if (actionId != null) return actionId;
  return task?.type === 'clean_table'
    ? task.tableId
    : task?.type === 'clean_floor'
      ? task.dirtId
      : task?.serviceItemId;
}

function taskForAction(worker, actionId) {
  const task = worker?.task;
  if (!task || !CLEANING_TASK_TYPES.has(task.type)) return null;
  const targetId = targetIdForTask(task, actionId);
  if (targetId == null) return null;
  if (task.type === 'clean_table' && !sameId(task.tableId, targetId)) return null;
  if (task.type === 'clean_floor' && !sameId(task.dirtId, targetId)) return null;
  if (task.type === 'wash_item' && !sameId(task.serviceItemId, targetId)) return null;
  return { task, targetId };
}

function targetForTask(state, task, actionId) {
  const targetId = targetIdForTask(task, actionId);
  if (targetId == null) return null;
  if (task?.type === 'clean_table') {
    return (state?.tables || []).find(target => sameId(target.id, targetId)) || null;
  }
  if (task?.type === 'clean_floor') {
    return (state?.floorDirt || []).find(target => sameId(target.id, targetId)) || null;
  }
  if (task?.type === 'wash_item') {
    return (state?.serviceItems || []).find(target => sameId(target.id, targetId)) || null;
  }
  return null;
}

function targetCollectionKey(task) {
  if (task?.type === 'clean_table') return 'tables';
  if (task?.type === 'clean_floor') return 'floorDirt';
  if (task?.type === 'wash_item') return 'serviceItems';
  return null;
}

function getStation(state, item) {
  return (state?.washStations || []).find(station => sameId(station.id, item?.washStationId));
}

function normaliseAction(action, fallbackId) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const startedAt = finite(action.startedAt) ? action.startedAt : action.cleaningStartedAt;
  const lastProgressAt = finite(action.lastProgressAt)
    ? action.lastProgressAt
    : startedAt;
  const accumulatedWork = finite(action.accumulatedWork)
    ? Math.max(0, action.accumulatedWork) : 0;
  return {
    ...action,
    ...(action.id == null && fallbackId != null ? { id: fallbackId } : {}),
    ...(finite(startedAt) && !finite(action.startedAt) ? { startedAt } : {}),
    ...(finite(startedAt) && !finite(action.cleaningStartedAt)
      ? { cleaningStartedAt: startedAt } : {}),
    accumulatedWork,
    ...(finite(lastProgressAt) ? { lastProgressAt } : {}),
  };
}

function actionOn(target, actionId) {
  return normaliseAction(target?.cleaningAction, actionId);
}

function replaceTarget(state, task, targetId, update) {
  const collectionKey = targetCollectionKey(task);
  if (!collectionKey) return state;
  const collection = Array.isArray(state?.[collectionKey]) ? state[collectionKey] : [];
  const index = collection.findIndex(target => sameId(target.id, targetId));
  if (index < 0) return state;
  const replacement = update(collection[index]);
  if (replacement === collection[index]) return state;
  return {
    ...state,
    [collectionKey]: collection.map((target, candidateIndex) =>
      candidateIndex === index ? replacement : target),
  };
}

function isAtStart(state, worker) {
  if (!worker) return false;
  if (!worker.navigationGoal) return true;
  return isAtNavigationGoal(worker, 2);
}

function validTargetForStart(state, worker, task, target) {
  if (!target || !isAtStart(state, worker)) return false;
  if (task.type === 'clean_table') return target.status === 'dirty';
  if (task.type === 'clean_floor') return true;
  if (task.type !== 'wash_item' || worker.role !== 'janitor') return false;
  const station = getStation(state, target);
  return station?.type === 'manual'
    && ['queued_for_wash', 'washing'].includes(target.state)
    && (target.assignedStaffId == null || sameId(target.assignedStaffId, worker.id));
}

function instantDecision(worker, random) {
  if (worker?.role !== 'janitor' || !(Number(worker.skill) >= 10)) return false;
  return Number(random()) < 0.1;
}

function initialAction(target, targetId, worker, now, random) {
  const existing = actionOn(target, targetId);
  const eligibleAt = finite(existing?.eligibleAt)
    ? existing.eligibleAt
    : [target?.eligibleAt, target?.cleaningEligibleAt, target?.dirtyAt, target?.createdAt]
      .find(finite) ?? now;
  const startedAt = finite(existing?.startedAt) ? existing.startedAt : now;
  const hasResolvedDecision = existing?.instantResolved === true;
  const instantResolved = hasResolvedDecision || existing?.instantResolved === false
    ? existing.instantResolved
    : true;
  const instantComplete = hasResolvedDecision || existing?.instantResolved === false
    ? existing.instantComplete === true
    : instantDecision(worker, random);
  return {
    ...(existing || {}),
    id: existing?.id ?? targetId,
    eligibleAt,
    startedAt,
    cleaningStartedAt: existing?.cleaningStartedAt ?? startedAt,
    accumulatedWork: finite(existing?.accumulatedWork)
      ? Math.max(0, existing.accumulatedWork) : 0,
    lastProgressAt: finite(existing?.lastProgressAt)
      ? existing.lastProgressAt : startedAt,
    instantResolved,
    instantComplete,
    staffId: worker.id,
  };
}

/** Return whether a task uses the target-owned cleaning ledger. */
export function isCleaningTask(task) {
  return CLEANING_TASK_TYPES.has(task?.type);
}

/** Return the target record for a cleaning task without mutating state. */
export function getCleaningTarget(state, task, actionId = null) {
  return targetForTask(state, task, actionId);
}

/** Return a normalised target-owned action, if one exists. */
export function getCleaningAction(state, task, actionId = null) {
  const target = targetForTask(state, task, actionId);
  return actionOn(target, targetIdForTask(task, actionId));
}

/**
 * Validate arrival and claim a cleaning target exactly once.
 *
 * The target owns the decision and progress ledger.  Re-entering this helper
 * for an existing action only repairs missing compatibility aliases and never
 * calls `random` again.
 */
export function resolveCleaningStart(state, staffId, actionId, now, random = Math.random) {
  if (!finite(now)) return state;
  const worker = (state?.staff || []).find(candidate => sameId(candidate.id, staffId));
  const taskInfo = taskForAction(worker, actionId);
  if (!taskInfo || !isAtStart(state, worker)) return state;
  const target = targetForTask(state, taskInfo.task, taskInfo.targetId);
  if (!validTargetForStart(state, worker, taskInfo.task, target)) return state;

  const existing = actionOn(target, taskInfo.targetId);
  if (existing?.staffId != null && !sameId(existing.staffId, staffId)) return state;
  const action = initialAction(target, taskInfo.targetId, worker, now, random);
  const next = replaceTarget(state, taskInfo.task, taskInfo.targetId, current => ({
    ...current,
    cleaningAction: action,
    ...(taskInfo.task.type === 'wash_item' && !finite(current.washStartedAt)
      ? { washStartedAt: action.startedAt } : {}),
    ...(['clean_table', 'clean_floor'].includes(taskInfo.task.type)
      && !finite(current.cleaningStartedAt)
      ? { cleaningStartedAt: action.startedAt } : {}),
  }));
  return next;
}

/** Persist a settled/advanced work ledger on the target that owns it. */
export function updateCleaningActionProgress(state, staffId, task, progress) {
  if (!isCleaningTask(task) || !progress || !finite(progress.accumulatedWork)) return state;
  const targetId = targetIdForTask(task);
  const target = targetForTask(state, task, targetId);
  const action = actionOn(target, targetId);
  if (!action || (action.staffId != null && !sameId(action.staffId, staffId))) return state;
  const lastProgressAt = finite(progress.lastProgressAt)
    ? progress.lastProgressAt : action.lastProgressAt;
  const nextAction = {
    ...action,
    accumulatedWork: Math.max(0, progress.accumulatedWork),
    ...(finite(lastProgressAt) ? { lastProgressAt } : {}),
    staffId,
  };
  return replaceTarget(state, task, targetId, current => ({
    ...current,
    cleaningAction: nextAction,
    ...(task.type === 'wash_item' ? {
      accumulatedWork: nextAction.accumulatedWork,
      lastProgressAt: nextAction.lastProgressAt,
    } : {}),
  }));
}

/** Release a target claim but retain its decision and accumulated work. */
export function releaseCleaningAction(state, task, staffId = null) {
  if (!isCleaningTask(task)) return state;
  const targetId = targetIdForTask(task);
  const target = targetForTask(state, task, targetId);
  const action = actionOn(target, targetId);
  if (!action || (staffId != null && action.staffId != null
    && !sameId(action.staffId, staffId))) return state;
  if (action.staffId == null) return state;
  return replaceTarget(state, task, targetId, current => ({
    ...current,
    cleaningAction: { ...action, staffId: null },
  }));
}

/** Remove a completed action ledger along with its ordinary target transaction. */
export function clearCleaningAction(state, task, actionId = null) {
  if (!isCleaningTask(task)) return state;
  const targetId = targetIdForTask(task, actionId);
  return replaceTarget(state, task, targetId, current => {
    if (!Object.hasOwn(current, 'cleaningAction')) return current;
    const { cleaningAction: _cleaningAction, ...withoutAction } = current;
    return withoutAction;
  });
}

export { CLEANING_TASK_TYPES };
