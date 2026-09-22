import {
  getAmenityGeometry,
  getStaffAmenityDefinition,
  isStaffAmenityType,
} from '../data/staffAmenities';
import {
  createStaffDutyDefaults,
  getScheduledDuty,
  validateStaffSchedule,
} from './staffSchedules';
import { getStaffMovementSpeed } from './staffActivity';
import { getMovementStatus } from './movement/status';
import { clearNavigationGoal, setNavigationGoal } from './movement/navigationGoal';
import { createNavigationWorkspace } from './movement/navigationWorkspace';
import { createGrid } from './navigation/grid';
import { findRoute } from './navigation/router';
import { queryReachability } from './navigation/preflight';
import { newSpatialIssues } from './navigation/occupancy';
import { getQueueVisibleMembers } from './customerQueue';
import { isStaticStaffAmenityExit } from './movement/staffAmenityExit';
import { releaseStaffWork } from './staffTaskLifecycle';

export const STAFF_WELLBEING_CONSTANTS = Object.freeze({
  moraleDrainPerMinute: 0.01,
  moraleDrainPerSecond: 0.01 / 60,
  restedDrainFactor: 0.5,
  couchSessionSeconds: 900,
  arcadeSessionSeconds: 600,
  couchMoralePerHour: 6,
  arcadeMoralePerHour: 8,
  minimumSleepSeconds: 25_200,
  wellRestedSeconds: 86_400,
  handoffTimeoutSeconds: 60,
  retrySeconds: 30,
});

export const STAFF_WELLBEING_RETRY_SECONDS = STAFF_WELLBEING_CONSTANTS.retrySeconds;
export const STAFF_HANDOFF_TIMEOUT_SECONDS = STAFF_WELLBEING_CONSTANTS.handoffTimeoutSeconds;

const DEFAULT_DUTY = 'work';
const REST_TYPES = new Set(['couch', 'arcade']);
const VALID_DUTIES = new Set(['work', 'rest', 'pto']);
const ACTIVE_PHASES = new Set(['active', 'exiting']);
const WAITING_PHASES = new Set(['seeking_amenity', 'waiting_for_amenity']);
const HANDOFF_PHASES = new Set(['finishing_task', 'blocked_handoff']);
const EPSILON = 1e-9;

const finite = value => Number.isFinite(value);
const finitePoint = point => finite(point?.x) && finite(point?.y);
const samePoint = (left, right) => finitePoint(left) && finitePoint(right)
  && left.x === right.x && left.y === right.y;
const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const copyPoint = point => ({ x: point.x, y: point.y });

function allWorkSchedule() {
  return createStaffDutyDefaults().schedule;
}

function getWorker(state, staffId) {
  return (state?.staff || []).find(worker => sameId(worker?.id, staffId)) || null;
}

function getAmenity(state, amenityId) {
  return (state?.staffAmenities || []).find(amenity => sameId(amenity?.id, amenityId)) || null;
}

function normalisedSchedule(worker) {
  const schedule = Array.isArray(worker?.schedule)
    ? worker.schedule
    : worker?.schedule?.schedule;
  return validateStaffSchedule(schedule).valid ? [...schedule] : allWorkSchedule();
}

function scheduledDuty(worker, now) {
  return getScheduledDuty(normalisedSchedule(worker), now) || DEFAULT_DUTY;
}

function validDuty(value) {
  return VALID_DUTIES.has(value) ? value : DEFAULT_DUTY;
}

function amenityForDuty(type, duty) {
  return duty === 'pto' ? type === 'bed' : duty === 'rest' && REST_TYPES.has(type);
}

function activityPolicy(amenity) {
  const definition = getStaffAmenityDefinition(amenity?.type);
  if (!definition) return null;
  return {
    sessionSeconds: finite(definition.sessionSeconds)
      ? definition.sessionSeconds : null,
    moralePerHour: finite(definition.moralePerHour) ? definition.moralePerHour : 0,
    minimumSleepSeconds: finite(definition.minimumSleepSeconds)
      ? definition.minimumSleepSeconds : null,
    fullMorale: definition.fullMorale === true,
  };
}

function slotAt(amenity, slotIndex) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0) return null;
  return Array.isArray(amenity?.slots)
    ? amenity.slots.find(slot => slot?.index === slotIndex) || null
    : null;
}

function slotIsFree(slot) {
  return slot && slot.reservedBy == null && slot.occupiedBy == null;
}

function slotBelongsTo(slot, staffId) {
  return sameId(slot?.reservedBy, staffId) || sameId(slot?.occupiedBy, staffId);
}

function ownedSlots(state, staffId) {
  return (state?.staffAmenities || []).flatMap(amenity => (amenity.slots || [])
    .filter(slot => slotBelongsTo(slot, staffId))
    .map(slot => ({ amenity, slot })));
}

function currentAmenity(state, worker) {
  const use = worker?.amenityUse;
  if (!use || !isStaffAmenityType(getAmenity(state, use.amenityId)?.type)) return null;
  const amenity = getAmenity(state, use.amenityId);
  const slot = slotAt(amenity, use.slotIndex);
  return amenity && slot ? { amenity, slot } : null;
}

function workerHasCarriedLoad(worker) {
  return (Array.isArray(worker?.carryingServiceItemIds) && worker.carryingServiceItemIds.length > 0)
    || worker?.carryingServiceItemId != null;
}

function taskSource(state, worker) {
  const task = worker?.task;
  if (!task) return null;
  const item = task.serviceItemId == null ? null
    : (state?.serviceItems || []).find(candidate => sameId(candidate?.id, task.serviceItemId));
  if (item) return item;
  if (task.type === 'clean_table') {
    return (state?.tables || []).find(candidate => sameId(candidate?.id, task.tableId))?.cleaningAction
      || null;
  }
  if (task.type === 'clean_floor') {
    return (state?.floorDirt || []).find(candidate => sameId(candidate?.id, task.dirtId))?.cleaningAction
      || null;
  }
  return task;
}

function taskProgressSnapshot(state, worker) {
  const source = taskSource(state, worker) || {};
  const task = worker?.task || {};
  const progressTimes = [
    source.lastProgressAt, task.lastProgressAt, source.readyAt, task.readyAt,
  ].filter(finite);
  const accumulated = [source.accumulatedWork, task.accumulatedWork]
    .filter(finite).reduce((maximum, value) => Math.max(maximum, value), 0);
  return {
    lastProgressAt: progressTimes.length ? Math.max(...progressTimes) : null,
    accumulatedWork: accumulated,
  };
}

function taskStarted(state, worker) {
  if (!worker?.task) return false;
  const source = taskSource(state, worker) || {};
  return [
    worker.task.startedAt,
    worker.task.preparationStartedAt,
    worker.task.cleaningStartedAt,
    worker.task.washingStartedAt,
    source.startedAt,
    source.preparationStartedAt,
    source.cleaningStartedAt,
    source.washStartedAt,
  ].some(finite)
    || [worker.task.accumulatedWork, source.accumulatedWork].some(value => finite(value) && value > 0);
}

function isTaskActuallyWorking(state, worker) {
  if (!worker?.task || workerHasCarriedLoad(worker)) return false;
  if (ACTIVE_PHASES.has(worker.dutyPhase)
    || WAITING_PHASES.has(worker.dutyPhase)
    || worker.dutyPhase === 'travelling'
    || worker.dutyPhase === 'blocked_handoff') return false;
  if (worker.activityPhase === 'working') return true;
  if (worker.dutyPhase === 'finishing_task') return taskStarted(state, worker);
  if (finitePoint(worker.navigationGoal)) return false;
  return taskStarted(state, worker) && validDuty(worker.effectiveDuty) === 'work';
}

function drainMorale(worker, state, fromTime, toTime) {
  if (!isTaskActuallyWorking(state, worker) || toTime <= fromTime) return worker;
  let morale = finite(worker.morale) ? worker.morale : 50;
  const buffUntil = finite(worker.wellRestedUntil) ? worker.wellRestedUntil : 0;
  const boundaries = [fromTime];
  if (buffUntil > fromTime + EPSILON && buffUntil < toTime - EPSILON) boundaries.push(buffUntil);
  boundaries.push(toTime);

  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1];
    const end = boundaries[index];
    if (end <= start) continue;
    const factor = start < buffUntil - EPSILON
      ? STAFF_WELLBEING_CONSTANTS.restedDrainFactor : 1;
    morale = Math.max(0, morale
      - (end - start) * STAFF_WELLBEING_CONSTANTS.moraleDrainPerSecond * factor);
  }
  return morale === worker.morale ? worker : { ...worker, morale };
}

function applyOccupiedRecovery(worker, state, fromTime, toTime) {
  const current = currentAmenity(state, worker);
  const use = worker?.amenityUse;
  const policy = activityPolicy(current?.amenity);
  if (!current || use?.phase !== 'occupied' || !policy || !finite(toTime) || toTime < fromTime) {
    return worker;
  }

  const startedAt = finite(use.activityStartedAt) ? use.activityStartedAt : null;
  if (startedAt == null) return worker;
  const lastRecoveryAt = finite(use.lastRecoveryAt) ? use.lastRecoveryAt : startedAt;
  const start = Math.max(fromTime, lastRecoveryAt, startedAt);
  let next = worker;

  if (policy.fullMorale) {
    const session = worker.ptoSession;
    const minimumEndAt = finite(session?.minimumEndAt)
      ? session.minimumEndAt
      : finite(use.activityEndsAt) ? use.activityEndsAt : startedAt;
    const sleepStartedAt = finite(session?.sleepStartedAt) ? session.sleepStartedAt : startedAt;
    const startingMorale = finite(session?.startingMorale)
      ? Math.min(100, Math.max(0, session.startingMorale))
      : Math.min(100, Math.max(0, finite(worker.morale) ? worker.morale : 50));
    const elapsed = Math.max(0, Math.min(toTime, minimumEndAt) - sleepStartedAt);
    const duration = Math.max(1, minimumEndAt - sleepStartedAt);
    const interpolated = startingMorale
      + (100 - startingMorale) * Math.min(1, elapsed / duration);
    const morale = Math.max(finite(worker.morale) ? worker.morale : 50, interpolated);
    const recoveryAt = Math.min(toTime, minimumEndAt);
    if (morale !== worker.morale || recoveryAt !== use.lastRecoveryAt) {
      next = {
        ...next,
        morale,
        amenityUse: { ...use, lastRecoveryAt: recoveryAt },
      };
    }
    return next;
  }

  const activityEndsAt = finite(use.activityEndsAt)
    ? use.activityEndsAt : toTime;
  const end = Math.min(toTime, activityEndsAt);
  if (end <= start) return next;
  const morale = Math.min(100, Math.max(0, finite(worker.morale) ? worker.morale : 50)
    + (end - start) * policy.moralePerHour / 3600);
  next = {
    ...next,
    morale,
    amenityUse: { ...use, lastRecoveryAt: end },
  };
  return next;
}

function actorPositions(state, excludedId) {
  const actors = [
    ...(state?.staff || []),
    ...(state?.customers || []),
    ...getQueueVisibleMembers(state, state?.queue || []),
  ].filter(actor => !sameId(actor?.id ?? actor?.memberId, excludedId) && finitePoint(actor));
  const claims = state?.movementCoordinator?.claims;
  const claimedPoints = claims instanceof Map
    ? [...claims.entries()]
      .filter(([id, point]) => !sameId(id, excludedId) && finitePoint(point))
      .map(([, point]) => point)
    : Object.entries(claims || {})
      .filter(([id, point]) => !sameId(id, excludedId) && finitePoint(point))
      .map(([, point]) => point);
  return [...actors, ...claimedPoints];
}

function pointIsFreeForExit(state, worker, point, grid) {
  if (!grid.isOpen(point)) return false;
  return actorPositions(state, worker.id).every(actor =>
    Math.hypot(actor.x - point.x, actor.y - point.y) >= 16 - EPSILON);
}

function isLegalExitPoint(state, worker, amenity, point) {
  const geometry = getAmenityGeometry(amenity);
  if (!geometry || !finitePoint(point)) return false;
  if (!geometry.exitCandidates.some(candidate => samePoint(candidate, point))) return false;
  const workspace = createNavigationWorkspace(state);
  const grid = createGrid(state, workspace);
  return pointIsFreeForExit(state, worker, point, grid)
    && isStaticStaffAmenityExit(state, amenity, worker.amenityUse?.slotIndex, point, {
      workspace, grid,
    });
}

/** Return the first legal, free exterior point for a resident staff member. */
export function selectStaffWellbeingExit(state, staffId) {
  const worker = getWorker(state, staffId);
  const current = worker ? currentAmenity(state, worker) : null;
  if (!worker || !current || !sameId(current.slot.occupiedBy, worker.id)
    || current.slot.reservedBy != null) return null;
  const geometry = getAmenityGeometry(current.amenity);
  if (!geometry) return null;
  return geometry.exitCandidates.find(point => isLegalExitPoint(state, worker, current.amenity, point))
    || null;
}

export const getStaffWellbeingExit = selectStaffWellbeingExit;

function wellbeingFingerprint(state) {
  const workspace = createNavigationWorkspace(state || {});
  const amenityState = (state?.staffAmenities || []).map(amenity => [
    amenity?.id,
    amenity?.type,
    amenity?.x,
    amenity?.y,
    amenity?.rotation ?? 0,
    (amenity?.slots || []).map(slot => [slot?.index, slot?.reservedBy, slot?.occupiedBy]),
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return `${workspace.topologyFingerprint}:staff-amenities:${JSON.stringify(amenityState)}`;
}

function routeToApproach(state, worker, approach) {
  if (!finitePoint(worker) || !finitePoint(approach)) return false;
  const workspace = createNavigationWorkspace(state);
  const grid = createGrid(state, workspace);
  if (!grid.isOpen(worker) || !grid.isOpen(approach)) return false;
  if (samePoint(worker, approach)) return true;
  return queryReachability(`amenity:${String(worker.id)}`, grid, worker, approach, 512) === 'found';
}

function approachFor(amenity, slotIndex) {
  const geometry = getAmenityGeometry(amenity);
  if (!geometry) return null;
  const index = amenity.type === 'couch' ? slotIndex : 0;
  return geometry.approachPoints[index] || null;
}

/**
 * Select one reachable, currently free amenity slot. The result is a planning
 * record; this function does not reserve capacity or mutate state.
 */
export function selectStaffWellbeingAmenity(state, staffId, now) {
  const worker = getWorker(state, staffId);
  const duty = validDuty(worker?.effectiveDuty || scheduledDuty(worker, now));
  if (!worker || !finite(now) || !['rest', 'pto'].includes(duty)) return null;
  const candidates = [];
  for (const amenity of state?.staffAmenities || []) {
    if (!amenityForDuty(amenity?.type, duty)) continue;
    const slots = Array.isArray(amenity.slots) ? amenity.slots : [];
    for (const slot of slots) {
      if (!slotIsFree(slot)) continue;
      const approach = approachFor(amenity, slot.index);
      if (!approach || !routeToApproach(state, worker, approach)) continue;
      candidates.push({
        amenity,
        amenityId: amenity.id,
        slotIndex: slot.index,
        approachPoint: copyPoint(approach),
        distance: Math.hypot(worker.x - approach.x, worker.y - approach.y),
        switchPenalty: worker.lastRestActivityType
          && worker.lastRestActivityType === amenity.type ? 1 : 0,
      });
    }
  }
  candidates.sort((left, right) => left.switchPenalty - right.switchPenalty
    || left.distance - right.distance
    || String(left.amenityId).localeCompare(String(right.amenityId))
    || left.slotIndex - right.slotIndex);
  return candidates[0] || null;
}

export const selectStaffAmenity = selectStaffWellbeingAmenity;

function withOwnedSlots(amenity, staffId, phase) {
  const slots = Array.isArray(amenity?.slots) ? amenity.slots : [];
  return slots.map(slot => {
    if (!sameId(slot?.reservedBy, staffId) && !sameId(slot?.occupiedBy, staffId)) return slot;
    return {
      ...slot,
      reservedBy: phase === 'reserved' ? staffId : null,
      occupiedBy: phase === 'occupied' ? staffId : null,
    };
  });
}

function clearWorkerUse(worker, { phase = null, lastRestActivityType = undefined } = {}) {
  const {
    movementResidency: _movementResidency,
    exitRetryAt: _exitRetryAt,
    exitRetryFingerprint: _exitRetryFingerprint,
    amenityRetryAt: _amenityRetryAt,
    amenityRetryFingerprint: _amenityRetryFingerprint,
    wellbeingWakeAt: _wellbeingWakeAt,
    ...withoutTransientUse
  } = worker || {};
  const cleared = clearNavigationGoal({
    ...withoutTransientUse,
    amenityUse: null,
    ptoSession: null,
    ...(lastRestActivityType === undefined ? {} : { lastRestActivityType }),
  });
  if (phase == null) return cleared;
  return { ...cleared, dutyPhase: phase };
}

function clearUseState(state, staffId, { phase = null, lastRestActivityType = undefined } = {}) {
  const worker = getWorker(state, staffId);
  if (!worker) return state;
  const staff = state.staff.map(candidate => sameId(candidate.id, staffId)
    ? clearWorkerUse(candidate, { phase, lastRestActivityType }) : candidate);
  return {
    ...state,
    staff,
    staffAmenities: (state.staffAmenities || []).map(amenity => ({
      ...amenity,
      slots: withOwnedSlots(amenity, staffId, null),
    })),
  };
}

function setReservation(state, staffId, amenityId, slotIndex, now) {
  const worker = getWorker(state, staffId);
  const amenity = getAmenity(state, amenityId);
  const slot = slotAt(amenity, slotIndex);
  const policy = activityPolicy(amenity);
  const duty = validDuty(worker?.effectiveDuty || scheduledDuty(worker, now));
  if (!worker || !amenity || !slot || !policy || !finite(now)
    || !amenityForDuty(amenity.type, duty) || !slotIsFree(slot)
    || worker.task || workerHasCarriedLoad(worker)
    || ownedSlots(state, staffId).length > 0) return state;
  const approach = approachFor(amenity, slotIndex);
  if (!approach || !routeToApproach(state, worker, approach)) return state;

  const nextStaff = state.staff.map(candidate => sameId(candidate.id, staffId)
    ? setNavigationGoal({
      ...candidate,
      dutyPhase: 'travelling',
      amenityWaitingSince: null,
      amenityRetryAt: null,
      amenityRetryFingerprint: null,
      dutyBlockReason: null,
      amenityUse: {
        amenityId: amenity.id,
        slotIndex,
        phase: 'reserved',
        activityStartedAt: null,
        activityEndsAt: null,
        lastRecoveryAt: null,
      },
    }, approach) : candidate);
  return {
    ...state,
    staff: nextStaff,
    staffAmenities: state.staffAmenities.map(candidate => sameId(candidate.id, amenity.id)
      ? {
        ...candidate,
        slots: candidate.slots.map(candidateSlot => candidateSlot.index === slotIndex
          ? { ...candidateSlot, reservedBy: staffId, occupiedBy: null }
          : candidateSlot),
      }
      : candidate),
  };
}

/** Reserve one exact amenity slot for a staff member, atomically. */
export function reserveAmenitySlot(state, staffId, amenityId, slotIndex, now) {
  if (!state || !Array.isArray(state.staff) || !Array.isArray(state.staffAmenities)) return state;
  const worker = getWorker(state, staffId);
  const amenity = getAmenity(state, amenityId);
  const slot = slotAt(amenity, slotIndex);
  if (worker?.amenityUse && sameId(worker.amenityUse.amenityId, amenityId)
    && worker.amenityUse.slotIndex === slotIndex && sameId(slot?.reservedBy, staffId)) {
    return state;
  }
  return setReservation(state, staffId, amenityId, slotIndex, now);
}

function requestedExitRetry(worker, now, fingerprint) {
  return worker?.dutyPhase === 'exiting'
    && (!finite(worker.exitRetryAt) || now >= worker.exitRetryAt
      || worker.exitRetryFingerprint !== fingerprint);
}

function beginExit(state, worker, now, fingerprint) {
  const current = currentAmenity(state, worker);
  if (!current) return { ...worker, dutyPhase: 'available' };
  const exit = selectStaffWellbeingExit(state, worker.id);
  const next = {
    ...worker,
    dutyPhase: 'exiting',
    exitRetryAt: now + STAFF_WELLBEING_CONSTANTS.retrySeconds,
    exitRetryFingerprint: fingerprint,
    dutyBlockReason: exit ? null : 'blocked-exit',
  };
  return exit ? setNavigationGoal(next, exit) : clearNavigationGoal(next);
}

function normaliseWorkerForController(worker) {
  const defaults = createStaffDutyDefaults();
  const effectiveDuty = validDuty(worker.effectiveDuty);
  const storedPhase = typeof worker.dutyPhase === 'string' ? worker.dutyPhase : 'available';
  const dutyPhase = worker.amenityUse?.phase === 'occupied' && storedPhase !== 'exiting'
    ? 'active'
    : worker.amenityUse?.phase === 'reserved' && !HANDOFF_PHASES.has(storedPhase)
      ? 'travelling' : storedPhase;
  return {
    ...defaults,
    ...worker,
    effectiveDuty,
    dutyPhase,
    schedule: Array.isArray(worker.schedule) || worker.schedule?.schedule
      ? worker.schedule : defaults.schedule,
  };
}

function firstDutyBoundary(worker, fromTime, toTime) {
  const schedule = normalisedSchedule(worker);
  if (toTime <= fromTime) return toTime;
  if (getScheduledDuty(schedule, fromTime) !== validDuty(worker.effectiveDuty)) return fromTime;
  const slotSeconds = 1800;
  let boundary = Math.floor(fromTime / slotSeconds) * slotSeconds;
  if (boundary <= fromTime) boundary += slotSeconds;
  while (boundary <= toTime + EPSILON) {
    const before = getScheduledDuty(schedule, boundary - EPSILON);
    const after = getScheduledDuty(schedule, boundary);
    if (before !== after) return boundary;
    boundary += slotSeconds;
  }
  return toTime;
}

function nextWorkerWellbeingBoundary(worker, fromTime, toTime) {
  const candidates = [
    worker?.amenityUse?.activityEndsAt,
    worker?.ptoSession?.minimumEndAt,
    worker?.wellRestedUntil,
  ].filter(value => finite(value)
    && value > fromTime + EPSILON
    && value <= toTime + EPSILON);
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * Return the next absolute schedule transition in a tick range. Game-loop
 * integration can use this to settle `[fromTime, boundary]` before applying a
 * new duty mode; `null` means that no worker changes mode in the range.
 */
export function getNextStaffWellbeingBoundary(state, fromTime, toTime = Infinity) {
  if (!state || !Array.isArray(state.staff) || !finite(fromTime) || !finite(toTime)
    || toTime <= fromTime) return null;
  let next = Infinity;
  for (const worker of state.staff) {
    const workerBoundary = nextWorkerWellbeingBoundary(worker, fromTime, toTime);
    if (workerBoundary != null) next = Math.min(next, workerBoundary);
    const schedule = normalisedSchedule(worker);
    let boundary = nextScheduleBoundary(fromTime);
    for (let count = 0; count < 48 && boundary <= toTime + EPSILON; count += 1) {
      if (getScheduledDuty(schedule, boundary - EPSILON)
        !== getScheduledDuty(schedule, boundary)) {
        next = Math.min(next, boundary);
        break;
      }
      boundary += 1800;
    }
  }
  return Number.isFinite(next) && next <= toTime + EPSILON ? next : null;
}

export const getStaffWellbeingBoundary = getNextStaffWellbeingBoundary;

function nextScheduleBoundary(afterTime) {
  const slotSeconds = 1800;
  return (Math.floor(afterTime / slotSeconds) + 1) * slotSeconds;
}

// Return the first instant at which the current occupied amenity must stop.
// A short rest can end at either its policy duration or a schedule boundary;
// protected PTO ignores work/rest requests until its actual minimum is met.
function occupiedUseTransitionTime(state, worker, fromTime, toTime) {
  const current = currentAmenity(state, worker);
  const use = worker?.amenityUse;
  if (!current || use?.phase !== 'occupied' || worker.dutyPhase === 'exiting') return null;
  const policy = activityPolicy(current.amenity);
  const activityEnd = policy?.fullMorale
    ? (finite(worker.ptoSession?.minimumEndAt)
      ? worker.ptoSession.minimumEndAt : use.activityEndsAt)
    : use.activityEndsAt;
  const limit = finite(activityEnd) ? Math.min(toTime, activityEnd) : toTime;
  const dutyAtFrom = scheduledDuty(worker, fromTime);

  if (current.amenity.type !== 'bed') {
    if (dutyAtFrom !== 'rest') return fromTime;
    if (finite(activityEnd) && activityEnd <= toTime + EPSILON) return activityEnd;
    for (let boundary = nextScheduleBoundary(fromTime); boundary <= limit + EPSILON; boundary += 1800) {
      if (scheduledDuty(worker, boundary) !== 'rest') return boundary;
    }
    return null;
  }

  const minimumEndAt = finite(worker.ptoSession?.minimumEndAt)
    ? worker.ptoSession.minimumEndAt : activityEnd;
  if (!finite(minimumEndAt) || toTime < minimumEndAt - EPSILON) return null;
  if (fromTime >= minimumEndAt - EPSILON) {
    if (dutyAtFrom !== 'pto') return fromTime;
  } else if (scheduledDuty(worker, minimumEndAt) !== 'pto') {
    return minimumEndAt;
  }
  for (let boundary = Math.max(nextScheduleBoundary(fromTime), nextScheduleBoundary(minimumEndAt - EPSILON));
    boundary <= toTime + EPSILON; boundary += 1800) {
    if (scheduledDuty(worker, boundary) !== 'pto') return boundary;
  }
  return null;
}

function progressSinceHandoff(state, worker) {
  const snapshot = taskProgressSnapshot(state, worker);
  const baselineTime = finite(worker.dutyHandoffProgressAt)
    ? worker.dutyHandoffProgressAt : null;
  const baselineWork = finite(worker.dutyHandoffAccumulatedWork)
    ? worker.dutyHandoffAccumulatedWork : 0;
  return (baselineTime != null && snapshot.lastProgressAt != null
    && snapshot.lastProgressAt > baselineTime + EPSILON)
    || snapshot.accumulatedWork > baselineWork + EPSILON;
}

function beginDutyTransition(state, worker, desiredDuty, requestedAt, now) {
  const currentDuty = validDuty(worker.effectiveDuty);
  if (desiredDuty === currentDuty && !HANDOFF_PHASES.has(worker.dutyPhase)) return worker;
  if (desiredDuty === 'work' && worker.ptoSession
    && finite(worker.ptoSession.minimumEndAt)
    && now < worker.ptoSession.minimumEndAt - EPSILON) {
    return { ...worker, effectiveDuty: 'pto', dutyPhase: 'active' };
  }

  const busy = Boolean(worker.task) || workerHasCarriedLoad(worker);
  if (desiredDuty !== 'work' && busy
    && (currentDuty === 'work' || HANDOFF_PHASES.has(worker.dutyPhase))) {
    const snapshot = taskProgressSnapshot(state, worker);
    const requested = finite(worker.dutyTransitionRequestedAt)
      ? worker.dutyTransitionRequestedAt : requestedAt;
    const baselineTime = finite(worker.dutyHandoffLastProgressAt)
      ? worker.dutyHandoffLastProgressAt
      : Math.max(requested, finite(snapshot.lastProgressAt) ? snapshot.lastProgressAt : requested);
    const progressMade = progressSinceHandoff(state, worker);
    const progressAt = progressMade
      ? Math.max(requested, finite(snapshot.lastProgressAt) ? snapshot.lastProgressAt : now)
      : baselineTime;
    const timedOut = now - progressAt >= STAFF_WELLBEING_CONSTANTS.handoffTimeoutSeconds - EPSILON;
    return {
      ...worker,
      effectiveDuty: desiredDuty,
      dutyPhase: timedOut ? 'blocked_handoff' : 'finishing_task',
      dutyTransitionRequestedAt: requested,
      dutyHandoffProgressAt: snapshot.lastProgressAt,
      dutyHandoffAccumulatedWork: snapshot.accumulatedWork,
      dutyHandoffLastProgressAt: progressAt,
      dutyBlockReason: timedOut ? 'handoff-timeout' : null,
    };
  }

  return {
    ...worker,
    effectiveDuty: desiredDuty,
    dutyPhase: desiredDuty === 'work' ? 'available' : 'seeking_amenity',
    amenityWaitingSince: desiredDuty === currentDuty ? worker.amenityWaitingSince : null,
    amenityRetryAt: null,
    amenityRetryFingerprint: null,
    dutyTransitionRequestedAt: desiredDuty === currentDuty
      ? worker.dutyTransitionRequestedAt : requestedAt,
    dutyBlockReason: null,
  };
}

function transitionActiveUse(state, worker, desiredDuty, now, fingerprint) {
  const current = currentAmenity(state, worker);
  const use = worker.amenityUse;
  if (!current || !use) return worker;
  if (worker.dutyPhase === 'exiting' && !requestedExitRetry(worker, now, fingerprint)) return worker;
  if (use.phase === 'reserved') {
    if (amenityForDuty(current.amenity.type, desiredDuty)) return worker;
    return clearWorkerUse(worker, { phase: desiredDuty === 'work' ? 'available' : 'seeking_amenity' });
  }
  if (use.phase !== 'occupied') return worker;

  const policy = activityPolicy(current.amenity);
  const minimumEndAt = finite(worker.ptoSession?.minimumEndAt)
    ? worker.ptoSession.minimumEndAt : use.activityEndsAt;
  if (current.amenity.type === 'bed' && desiredDuty !== 'pto'
    && finite(minimumEndAt) && now < minimumEndAt - EPSILON) {
    return { ...worker, effectiveDuty: 'pto', dutyPhase: 'active' };
  }

  const finished = policy?.fullMorale
    ? now >= (minimumEndAt ?? Infinity) - EPSILON
    : finite(use.activityEndsAt) && now >= use.activityEndsAt - EPSILON;
  if (desiredDuty !== 'rest' && desiredDuty !== 'pto') {
    const waking = policy?.fullMorale && finite(minimumEndAt)
      && now >= minimumEndAt - EPSILON;
    if (waking) {
      const previousBuff = finite(worker.wellRestedUntil) ? worker.wellRestedUntil : 0;
      const wakeAt = finite(worker.wellbeingWakeAt) ? worker.wellbeingWakeAt : now;
      return beginExit(state, {
        ...worker,
        effectiveDuty: desiredDuty,
        morale: 100,
        wellbeingWakeAt: wakeAt,
        wellRestedUntil: Math.max(previousBuff, wakeAt + STAFF_WELLBEING_CONSTANTS.wellRestedSeconds),
      }, now, fingerprint);
    }
    return beginExit(state, { ...worker, effectiveDuty: desiredDuty }, now, fingerprint);
  }
  if (!amenityForDuty(current.amenity.type, desiredDuty)
    || (finished && !(policy?.fullMorale && desiredDuty === 'pto'))) {
    if (policy?.fullMorale && finished && desiredDuty !== 'pto') {
      const previousBuff = finite(worker.wellRestedUntil) ? worker.wellRestedUntil : 0;
      const wakeAt = finite(worker.wellbeingWakeAt) ? worker.wellbeingWakeAt : now;
      return beginExit(state, {
        ...worker,
        effectiveDuty: desiredDuty,
        morale: 100,
        wellbeingWakeAt: wakeAt,
        wellRestedUntil: Math.max(previousBuff, wakeAt + STAFF_WELLBEING_CONSTANTS.wellRestedSeconds),
      }, now, fingerprint);
    }
    return beginExit(state, { ...worker, effectiveDuty: desiredDuty }, now, fingerprint);
  }
  return worker;
}

function settleWorker(state, rawWorker, fromTime, toTime, fingerprint) {
  let worker = normaliseWorkerForController(rawWorker);
  const useTransitionAt = occupiedUseTransitionTime(state, worker, fromTime, toTime);
  const recoveryTo = useTransitionAt == null ? toTime : Math.min(toTime, useTransitionAt);
  worker = drainMorale(worker, state, fromTime, toTime);
  worker = applyOccupiedRecovery(worker, state, fromTime, recoveryTo);

  const decisionTime = useTransitionAt == null ? toTime : useTransitionAt;
  const desiredDuty = scheduledDuty(worker, decisionTime);
  const requestedAt = firstDutyBoundary(worker, fromTime, decisionTime);
  worker = beginDutyTransition(state, worker, desiredDuty, requestedAt, decisionTime);

  if (worker.dutyPhase === 'blocked_handoff' && progressSinceHandoff(state, worker)) {
    const snapshot = taskProgressSnapshot(state, worker);
    worker = {
      ...worker,
      dutyPhase: 'finishing_task',
      dutyBlockReason: null,
      dutyHandoffProgressAt: snapshot.lastProgressAt,
      dutyHandoffAccumulatedWork: snapshot.accumulatedWork,
      dutyHandoffLastProgressAt: finite(snapshot.lastProgressAt)
        ? snapshot.lastProgressAt : worker.dutyHandoffLastProgressAt,
    };
  }

  const current = currentAmenity(state, worker);
  if (current) {
    worker = transitionActiveUse(state, worker, desiredDuty, decisionTime, fingerprint);
  }

  return worker;
}

function shouldRetryAmenity(worker, now, fingerprint) {
  return !finite(worker.amenityRetryAt)
    || now >= worker.amenityRetryAt - EPSILON
    || worker.amenityRetryFingerprint !== fingerprint;
}

function markWaiting(worker, now, fingerprint, phase = 'waiting_for_amenity') {
  return {
    ...worker,
    dutyPhase: phase,
    amenityWaitingSince: finite(worker.amenityWaitingSince)
      ? worker.amenityWaitingSince : now,
    amenityRetryAt: now + STAFF_WELLBEING_CONSTANTS.retrySeconds,
    amenityRetryFingerprint: fingerprint,
    dutyBlockReason: 'no-reachable-amenity',
  };
}

function dispatchAmenity(state, worker, now, fingerprint) {
  const duty = validDuty(worker.effectiveDuty);
  if (!['rest', 'pto'].includes(duty) || worker.task || workerHasCarriedLoad(worker)) {
    return { state, worker };
  }
  if (worker.amenityUse) return { state, worker };
  if (!shouldRetryAmenity(worker, now, fingerprint)) return { state, worker };
  const choice = selectStaffWellbeingAmenity(state, worker.id, now);
  if (!choice) return { state, worker: markWaiting(worker, now, fingerprint) };
  const reserved = setReservation(state, worker.id, choice.amenityId, choice.slotIndex, now);
  return reserved === state
    ? { state, worker: markWaiting(worker, now, fingerprint) }
    : {
      state: reserved,
      worker: reserved.staff.find(candidate => sameId(candidate.id, worker.id)) || worker,
    };
}

function orderForAmenityDispatch(staff, now) {
  return staff.map((worker, index) => ({ worker, index })).sort((left, right) => {
    const leftWaiting = finite(left.worker.amenityWaitingSince)
      ? left.worker.amenityWaitingSince : now;
    const rightWaiting = finite(right.worker.amenityWaitingSince)
      ? right.worker.amenityWaitingSince : now;
    return leftWaiting - rightWaiting || String(left.worker.id).localeCompare(String(right.worker.id));
  });
}

function isNewHandoff(previous, current) {
  return current?.dutyPhase === 'finishing_task'
    && previous?.dutyPhase !== 'finishing_task'
    && previous?.dutyPhase !== 'blocked_handoff';
}

function needsImmediateHandoff(state, worker) {
  if (workerHasCarriedLoad(worker)) return true;
  if (!worker?.task) return false;
  return worker.task.type === 'prepare_dish' || !taskStarted(state, worker);
}

function releaseDutyHandoffs(state, previousStaff, now) {
  let next = state;
  for (let index = 0; index < previousStaff.length; index += 1) {
    const previous = previousStaff[index];
    const worker = next.staff[index];
    if (!worker || !isNewHandoff(previous, worker) || !needsImmediateHandoff(next, worker)) continue;
    const settledAt = finite(worker.dutyTransitionRequestedAt)
      ? worker.dutyTransitionRequestedAt : now;
    const released = releaseStaffWork(next, worker.id, 'duty-change', settledAt);
    const releasedWorker = released.staff?.find(candidate => sameId(candidate.id, worker.id));
    if (!releasedWorker) continue;
    next = {
      ...released,
      staff: released.staff.map(candidate => sameId(candidate.id, worker.id)
        ? { ...releasedWorker, effectiveDuty: worker.effectiveDuty,
          dutyPhase: releasedWorker.task || workerHasCarriedLoad(releasedWorker)
            ? 'finishing_task' : 'seeking_amenity',
          dutyTransitionRequestedAt: worker.dutyTransitionRequestedAt,
          dutyHandoffProgressAt: worker.dutyHandoffProgressAt,
          dutyHandoffAccumulatedWork: worker.dutyHandoffAccumulatedWork,
        }
        : candidate),
    };
  }
  return next;
}

/**
 * Advance the canonical game-time wellbeing ledger and issue/rescind amenity
 * travel intents. This function never reads a wall clock and does not own
 * staff inventory or task progress.
 */
export function advanceStaffWellbeing(state, fromTime, toTime) {
  if (!state || !Array.isArray(state.staff) || !finite(fromTime) || !finite(toTime)
    || toTime < fromTime) return state;

  const initialFingerprint = wellbeingFingerprint(state);
  let staff = state.staff.map(worker => settleWorker(state, worker, fromTime, toTime, initialFingerprint));
  let next = { ...state, staff };

  // A schedule change can cancel a reservation before movement reaches its
  // approach point. Keep the durable slot descriptor bidirectional instead of
  // leaving a reservation owned by a worker whose use was cleared above.
  for (let index = 0; index < state.staff.length; index += 1) {
    const previousUse = state.staff[index]?.amenityUse;
    if (previousUse?.phase !== 'reserved' || next.staff[index]?.amenityUse) continue;
    next = clearUseState(next, state.staff[index].id, {
      phase: next.staff[index].effectiveDuty === 'work' ? 'available' : 'seeking_amenity',
    });
  }

  next = releaseDutyHandoffs(next, state.staff, toTime);

  // An occupied or reserved slot is processed before new claims. Waiting staff
  // are then stable-sorted by waiting age, so a just-freed slot cannot be
  // immediately renewed by the previous occupant.
  const ordered = orderForAmenityDispatch(staff, toTime);
  for (const { index } of ordered) {
    const current = next.staff[index];
    if (current.amenityUse) continue;
    if (current.effectiveDuty === 'work') {
      next.staff[index] = {
        ...current,
        dutyPhase: HANDOFF_PHASES.has(current.dutyPhase) ? current.dutyPhase : 'available',
      };
      continue;
    }
    if (current.dutyPhase === 'exiting' || current.task || workerHasCarriedLoad(current)) continue;
    const fingerprint = wellbeingFingerprint(next);
    const dispatched = dispatchAmenity(next, current, toTime, fingerprint);
    next = dispatched.state;
    next.staff[index] = dispatched.worker;
  }
  return next;
}

function actualArrival(state, worker, status) {
  return status?.plan === 'arrived'
    && finitePoint(worker?.navigationGoal)
    && finitePoint(worker)
    && Math.hypot(worker.x - worker.navigationGoal.x, worker.y - worker.navigationGoal.y) <= 2;
}

function startAmenityActivity(state, worker, now) {
  const current = currentAmenity(state, worker);
  const use = worker.amenityUse;
  const policy = activityPolicy(current?.amenity);
  const geometry = getAmenityGeometry(current?.amenity);
  if (!current || !use || use.phase !== 'reserved' || !policy || !geometry
    || !sameId(current.slot.reservedBy, worker.id)) return { state, worker };
  const activityStartedAt = now;
  const activityEndsAt = policy.fullMorale
    ? now + (policy.minimumSleepSeconds || STAFF_WELLBEING_CONSTANTS.minimumSleepSeconds)
    : now + (policy.sessionSeconds || 0);
  const anchor = geometry.slotAnchors[use.slotIndex] || geometry.slotAnchors[0];
  const movedToAnchor = current.amenity.type === 'couch' || current.amenity.type === 'bed';
  const nextWorkerBase = clearNavigationGoal({
    ...worker,
    dutyPhase: 'active',
    amenityUse: {
      ...use,
      phase: 'occupied',
      activityStartedAt,
      activityEndsAt,
      lastRecoveryAt: activityStartedAt,
    },
    ...(policy.fullMorale ? {
      ptoSession: {
        sleepStartedAt: activityStartedAt,
        minimumEndAt: activityEndsAt,
        startingMorale: Math.min(100, Math.max(0, finite(worker.morale) ? worker.morale : 50)),
      },
    } : { ptoSession: null }),
    ...(movedToAnchor ? {
      x: anchor.x,
      y: anchor.y,
      movementResidency: {
        kind: 'staff_amenity',
        amenityId: current.amenity.id,
        slotIndex: use.slotIndex,
      },
    } : {}),
    ...(movedToAnchor ? {} : { movementResidency: undefined }),
  });
  const nextWorker = Object.hasOwn(nextWorkerBase, 'movementResidency')
    && nextWorkerBase.movementResidency === undefined
    ? (() => {
      const { movementResidency: _movementResidency, ...withoutResidency } = nextWorkerBase;
      return withoutResidency;
    })()
    : nextWorkerBase;
  const result = {
    state: {
      ...state,
      staff: state.staff.map(candidate => sameId(candidate.id, worker.id) ? nextWorker : candidate),
      staffAmenities: state.staffAmenities.map(amenity => sameId(amenity.id, current.amenity.id)
        ? {
          ...amenity,
          slots: amenity.slots.map(slot => slot.index === use.slotIndex
            ? { ...slot, reservedBy: null, occupiedBy: worker.id }
            : slot),
        }
        : amenity),
    },
    worker: nextWorker,
  };
  return newSpatialIssues(state, result.state).length ? { state, worker } : result;
}

function releaseableUse(state, worker, now) {
  const current = currentAmenity(state, worker);
  if (!current || worker.amenityUse?.phase !== 'occupied') return false;
  return worker.dutyPhase === 'exiting'
    && finitePoint(worker)
    && finitePoint(worker.navigationGoal)
    && Math.hypot(
      worker.x - worker.navigationGoal.x, worker.y - worker.navigationGoal.y,
    ) <= 2
    && (finite(now) && isLegalExitPoint(state, worker, current.amenity, worker.navigationGoal));
}

/**
 * Release all slots owned by a worker. Occupied sessions require a verified
 * legal exit unless `{ force: true }` is supplied. Forced release is used by
 * firing and never grants recovery or a waking bonus.
 */
export function releaseAmenitySlot(state, staffId, now, options = {}) {
  if (!state || !Array.isArray(state.staff) || !Array.isArray(state.staffAmenities)
    || !finite(now)) return state;
  const worker = getWorker(state, staffId);
  if (!worker) {
    if (options?.force !== true) return state;
    return {
      ...state,
      staffAmenities: state.staffAmenities.map(amenity => ({
        ...amenity,
        slots: withOwnedSlots(amenity, staffId, null),
      })),
    };
  }
  const matches = ownedSlots(state, staffId);
  const force = options?.force === true;
  const occupied = matches.some(({ slot }) => sameId(slot.occupiedBy, staffId));
  if (occupied && !force && !releaseableUse(state, worker, now)) return state;
  if (!matches.length && !worker.amenityUse) return state;

  const occupiedType = matches.find(({ slot }) => sameId(slot.occupiedBy, staffId))?.amenity?.type;
  const nextDuty = validDuty(worker.effectiveDuty);
  const phase = nextDuty === 'work' ? 'available' : 'seeking_amenity';
  const nextWorker = clearWorkerUse(worker, {
    phase,
    lastRestActivityType: !force && REST_TYPES.has(occupiedType)
      ? occupiedType : worker.lastRestActivityType,
  });
  return {
    ...state,
    staff: state.staff.map(candidate => sameId(candidate.id, staffId) ? nextWorker : candidate),
    staffAmenities: state.staffAmenities.map(amenity => ({
      ...amenity,
      slots: withOwnedSlots(amenity, staffId, null),
    })),
  };
}

function statusFor(state, statuses, id) {
  if (statuses && typeof statuses === 'object' && !(statuses instanceof Map)) {
    return statuses[id] ?? statuses[String(id)] ?? getMovementStatus(state, statuses, id);
  }
  return getMovementStatus(state, statuses, id);
}

/**
 * Commit only movement-certified amenity arrivals and legal exits. The
 * coordinator remains the authority for all intermediate positions.
 */
export function resolveStaffWellbeingAfterMovement(state, statuses, now) {
  if (!state || !Array.isArray(state.staff) || !finite(now)) return state;
  let next = state;
  for (const original of state.staff) {
    const worker = getWorker(next, original.id);
    if (!worker?.amenityUse) continue;
    const status = statusFor(next, statuses, worker.id);
    if (worker.amenityUse.phase === 'reserved') {
      if (actualArrival(next, worker, status)) {
        const started = startAmenityActivity(next, worker, now);
        next = started.state;
      } else if (status?.plan === 'unreachable' && status.reason === 'static-geometry') {
        next = clearUseState(next, worker.id, {
          phase: 'waiting_for_amenity',
        });
      }
      continue;
    }
    if (worker.amenityUse.phase === 'occupied' && worker.dutyPhase === 'exiting'
      && releaseableUse(next, worker, now) && status?.plan === 'arrived') {
      next = releaseAmenitySlot(next, worker.id, now, { reason: 'completed' });
    }
  }

  // A release is a capacity/topology event. Re-run only the bounded dispatch
  // phase at the same game timestamp so older waiting workers win the slot.
  return advanceStaffWellbeing(next, now, now);
}

function wellbeingEntry(worker) {
  if (!worker?.amenityUse || !['travelling', 'exiting'].includes(worker.dutyPhase)
    || !finitePoint(worker.navigationGoal) || !finitePoint(worker)) return null;
  return {
    character: worker,
    speed: getStaffMovementSpeed(worker),
    target: copyPoint(worker.navigationGoal),
    ignoredIds: [],
    doorFlow: { doorId: null, direction: 'none' },
    queueRank: null,
    terminalPolicy: 'hold',
    provenance: 'staff-wellbeing',
  };
}

/** Return movement descriptors for amenity travel/exit only. */
export function getStaffWellbeingMovementEntries(state) {
  return (state?.staff || []).map(wellbeingEntry).filter(Boolean);
}
