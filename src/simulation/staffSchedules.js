export const STAFF_SCHEDULE_SLOT_COUNT = 48;
export const STAFF_SCHEDULE_SLOT_SECONDS = 30 * 60;
export const STAFF_SCHEDULE_DAY_SECONDS = 24 * 60 * 60;

export const STAFF_DUTY_MODES = Object.freeze(['work', 'rest', 'pto']);

const DUTY_MODE_SET = new Set(STAFF_DUTY_MODES);
const SCHEDULE_CONTEXT_LIMIT = 256;
const ARRAY_SOME = Array.prototype.some;
const ARRAY_REDUCE = Array.prototype.reduce;
const ARRAY_ITERATOR = Array.prototype[Symbol.iterator];
let activeScheduleContext = null;
let internalPlainScheduleScope = false;

/**
 * Own ordinary schedule arrays for one synchronous tick. Callers must replace,
 * not mutate, schedules during the scope. Nothing is cached between ticks and
 * snapshots are internal only: worker.schedule keeps its original identity.
 */
export function withStaffScheduleContext(run) {
  return runStaffScheduleContext(run, false);
}

/** Internal-plain-state-v1: only runTick owns plain, stable schedules. */
export function withSimulationStaffScheduleContext(run) {
  return runStaffScheduleContext(run, true);
}

function runStaffScheduleContext(run, plain) {
  if (Object.prototype.toString.call(run) === '[object AsyncFunction]') {
    throw new Error('Staff schedule contexts must be synchronous');
  }
  const previous = activeScheduleContext;
  const previousPlain = internalPlainScheduleScope;
  activeScheduleContext = new Map();
  internalPlainScheduleScope = plain;
  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      throw new Error('Staff schedule contexts must be synchronous');
    }
    return result;
  } finally {
    activeScheduleContext = previous;
    internalPlainScheduleScope = previousPlain;
  }
}

function captureSchedule(slots) {
  if (Object.getPrototypeOf(slots) !== Array.prototype
    || Object.getOwnPropertyDescriptor(slots, 'length')?.value !== STAFF_SCHEDULE_SLOT_COUNT) return null;
  for (const [key, method] of [['some', ARRAY_SOME], ['reduce', ARRAY_REDUCE], [Symbol.iterator, ARRAY_ITERATOR]]) {
    const own = Object.getOwnPropertyDescriptor(slots, key);
    const inherited = Object.getOwnPropertyDescriptor(Array.prototype, key);
    if ((own && own.value !== method) || inherited?.value !== method) return null;
  }
  const snapshot = new Array(STAFF_SCHEDULE_SLOT_COUNT);
  for (let index = 0; index < STAFF_SCHEDULE_SLOT_COUNT; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(slots, String(index));
    // Holes and accessors retain the original validator/iterator semantics.
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    snapshot[index] = descriptor.value;
  }
  const validation = validateScheduleSlots(snapshot);
  return Object.freeze({ slots: Object.freeze(snapshot), validation: Object.freeze(validation) });
}

function capturePlainSchedule(slots) {
  if (slots.length !== STAFF_SCHEDULE_SLOT_COUNT) return null;
  const snapshot = new Array(STAFF_SCHEDULE_SLOT_COUNT);
  let leadingPto = 0;
  let runLength = 0;
  let hasNonPto = false;
  let shortRun = false;
  for (let index = 0; index < STAFF_SCHEDULE_SLOT_COUNT; index += 1) {
    const mode = slots[index];
    // Undefined reads (including holes) and invalid modes use the strict path.
    if (!DUTY_MODE_SET.has(mode)) return null;
    snapshot[index] = mode;
    if (mode === 'pto') {
      runLength += 1;
      if (!hasNonPto) leadingPto += 1;
    } else {
      if (hasNonPto && runLength > 0 && runLength < 14) shortRun = true;
      hasNonPto = true;
      runLength = 0;
    }
  }
  // The edge fragments are one cyclic run; all-PTO and zero-PTO are valid.
  // Judge PTO only after mode eligibility, preserving invalid-mode precedence.
  const edgeRun = leadingPto + runLength;
  const validation = shortRun || (hasNonPto && edgeRun > 0 && edgeRun < 14)
    ? invalid('pto-run-too-short') : { valid: true, reason: null };
  return Object.freeze({ slots: Object.freeze(snapshot), validation: Object.freeze(validation) });
}

/** Return a private immutable snapshot, or null to use the standalone path. */
export function getOwnedStaffSchedule(slots) {
  const context = activeScheduleContext;
  if (!context || !Array.isArray(slots)) return null;
  if (context.has(slots)) return context.get(slots);
  if (context.size >= SCHEDULE_CONTEXT_LIMIT) return null;
  // Also acts as a capture-in-progress sentinel for re-entrant inspection.
  context.set(slots, null);
  let owned;
  try {
    owned = internalPlainScheduleScope ? capturePlainSchedule(slots) : captureSchedule(slots);
  } catch (_error) {
    // Eligibility inspection must not introduce a new failure for a fallback.
    return null;
  }
  context.set(slots, owned);
  return owned;
}

function invalid(reason) {
  return { valid: false, reason };
}

function scheduleSlots(schedule) {
  return Array.isArray(schedule) ? schedule : schedule?.schedule;
}

/**
 * Validate a repeating half-hour staff schedule.
 *
 * PTO is the only mode with a minimum run length: every cyclic PTO run must
 * span at least seven hours. A run beginning before midnight is counted as
 * one run rather than two independent fragments.
 */
export function validateStaffSchedule(slots) {
  const owned = getOwnedStaffSchedule(slots);
  return owned ? { ...owned.validation } : validateScheduleSlots(slots);
}

function validateScheduleSlots(slots) {
  if (!Array.isArray(slots) || slots.length !== STAFF_SCHEDULE_SLOT_COUNT) {
    return invalid('invalid-length');
  }
  if (slots.some(mode => !DUTY_MODE_SET.has(mode))) return invalid('invalid-mode');

  const ptoCount = slots.reduce((count, mode) => count + (mode === 'pto' ? 1 : 0), 0);
  if (ptoCount === 0 || ptoCount === STAFF_SCHEDULE_SLOT_COUNT) {
    return { valid: true, reason: null };
  }

  for (let index = 0; index < STAFF_SCHEDULE_SLOT_COUNT; index += 1) {
    if (slots[index] !== 'pto'
      || slots[(index + STAFF_SCHEDULE_SLOT_COUNT - 1) % STAFF_SCHEDULE_SLOT_COUNT] === 'pto') {
      continue;
    }

    let runLength = 0;
    while (runLength < STAFF_SCHEDULE_SLOT_COUNT
      && slots[(index + runLength) % STAFF_SCHEDULE_SLOT_COUNT] === 'pto') {
      runLength += 1;
    }
    if (runLength < 14) return invalid('pto-run-too-short');
  }

  return { valid: true, reason: null };
}

/** Return the repeating schedule slot containing an absolute game timestamp. */
export function getStaffScheduleBoundary(gameTime) {
  const seconds = Number.isFinite(gameTime) ? gameTime : 0;
  const secondsIntoDay = ((seconds % STAFF_SCHEDULE_DAY_SECONDS)
    + STAFF_SCHEDULE_DAY_SECONDS) % STAFF_SCHEDULE_DAY_SECONDS;
  const slotIndex = Math.floor(secondsIntoDay / STAFF_SCHEDULE_SLOT_SECONDS);
  return {
    slotIndex,
    startsAt: Math.floor(seconds / STAFF_SCHEDULE_SLOT_SECONDS)
      * STAFF_SCHEDULE_SLOT_SECONDS,
    secondsIntoDay,
  };
}

/** Resolve a repeating schedule against absolute game seconds. */
export function getScheduledDuty(schedule, gameTime) {
  const slots = scheduleSlots(schedule);
  if (!Array.isArray(slots) || slots.length !== STAFF_SCHEDULE_SLOT_COUNT) return null;
  return slots[getStaffScheduleBoundary(gameTime).slotIndex] ?? null;
}

export function createStaffDutyDefaults() {
  return {
    schedule: Array.from({ length: STAFF_SCHEDULE_SLOT_COUNT }, () => 'work'),
    effectiveDuty: 'work',
    dutyPhase: 'available',
    dutyTransitionRequestedAt: null,
    amenityUse: null,
    ptoSession: null,
    wellRestedUntil: 0,
    amenityWaitingSince: null,
    lastRestActivityType: null,
  };
}
