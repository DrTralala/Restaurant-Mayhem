import {
  getNormalisedStaffSchedule,
  getStaffScheduleBoundary,
  STAFF_SCHEDULE_SLOT_COUNT,
  STAFF_SCHEDULE_SLOT_SECONDS,
} from '../simulation/staffSchedules';

export function getNextScheduledDutyChange(worker, gameTime) {
  if (!Number.isFinite(gameTime)) return null;

  const schedule = getNormalisedStaffSchedule(worker);
  const boundary = getStaffScheduleBoundary(gameTime);
  const currentMode = schedule[boundary.slotIndex];

  for (let offset = 1; offset <= STAFF_SCHEDULE_SLOT_COUNT; offset += 1) {
    const slotIndex = (boundary.slotIndex + offset) % STAFF_SCHEDULE_SLOT_COUNT;
    const nextMode = schedule[slotIndex];
    if (nextMode !== currentMode) {
      return {
        nextMode,
        startsAt: boundary.startsAt + offset * STAFF_SCHEDULE_SLOT_SECONDS,
        slotIndex,
      };
    }
  }

  return null;
}
