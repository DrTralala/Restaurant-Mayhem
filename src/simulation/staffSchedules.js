export const STAFF_SCHEDULE_SLOT_COUNT = 48;
export const STAFF_SCHEDULE_SLOT_SECONDS = 30 * 60;
export const STAFF_SCHEDULE_DAY_SECONDS = 24 * 60 * 60;

export const STAFF_DUTY_MODES = Object.freeze(['work', 'rest', 'pto']);

const DUTY_MODE_SET = new Set(STAFF_DUTY_MODES);

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
