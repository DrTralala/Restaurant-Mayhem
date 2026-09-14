import { useState } from 'react';
import {
  getScheduledDuty,
  STAFF_DUTY_MODES,
  STAFF_SCHEDULE_SLOT_COUNT,
  validateStaffSchedule,
} from '../simulation/staffSchedules';
import { humaniseIdentifier, TYPOGRAPHY } from '../typography';

const MODE_LABELS = Object.freeze({ work: 'Work', rest: 'Rest', pto: 'PTO' });
const DAY_SECONDS = 24 * 60 * 60;

const MODE_OPTIONS = STAFF_DUTY_MODES.map(mode => ({
  value: mode,
  label: MODE_LABELS[mode] || humaniseIdentifier(mode),
}));

const VALID_MODES = new Set(STAFF_DUTY_MODES);

const REASON_LABELS = Object.freeze({
  'invalid-length': 'A repeating schedule needs exactly 48 half-hour slots.',
  'invalid-mode': 'Each slot must be Work, Rest, or PTO.',
  'pto-run-too-short': 'Every PTO run must last at least 7 in-game hours (14 half-hour slots), including across midnight.',
});

function allWorkSchedule() {
  return Array.from({ length: STAFF_SCHEDULE_SLOT_COUNT }, () => 'work');
}

/** Return a safe 48-slot draft without changing the worker record. */
export function getStaffSchedule(staff) {
  const source = Array.isArray(staff?.schedule)
    ? staff.schedule
    : Array.isArray(staff?.schedule?.schedule)
      ? staff.schedule.schedule
      : Array.isArray(staff?.duty?.schedule)
        ? staff.duty.schedule
        : null;

  if (!source) return allWorkSchedule();
  return Array.from({ length: STAFF_SCHEDULE_SLOT_COUNT }, (_, index) => {
    const mode = source[index];
    return VALID_MODES.has(mode) ? mode : 'work';
  });
}

export function formatSlotLabel(index) {
  const startMinutes = index * 30;
  const endMinutes = (startMinutes + 30) % (24 * 60);
  const format = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `${format(startMinutes)} to ${format(endMinutes)}`;
}

export function formatDutyMode(mode) {
  return MODE_LABELS[mode] || humaniseIdentifier(mode) || 'Unknown';
}

export function formatGameTime(seconds) {
  if (!Number.isFinite(Number(seconds))) return '—';
  const secondsIntoDay = ((Number(seconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const hours = Math.floor(secondsIntoDay / 3600);
  const minutes = Math.floor((secondsIntoDay % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function readableReason(reason) {
  if (reason == null || reason === '') return null;
  if (typeof reason === 'object') {
    return readableReason(reason.reason || reason.message || reason.type);
  }
  return humaniseIdentifier(reason);
}

function getDutyReason(staff, dutyPhase) {
  const blockedReason = staff?.blockedHandoff?.reason
    || staff?.blocked_handoff?.reason
    || staff?.blockedHandoffReason
    || staff?.dutyBlockReason
    || staff?.duty_block_reason
    || (dutyPhase === 'blocked_handoff' ? staff?.reason : null);
  if (dutyPhase === 'blocked_handoff') {
    return blockedReason ? `blocked handoff: ${readableReason(blockedReason)}` : 'blocked handoff';
  }

  const taskType = staff?.task?.type;
  if (dutyPhase === 'finishing_task'
    || ['deliver_service_item', 'deliver_dirty_item', 'deliver_food_item'].includes(taskType)) {
    return 'finishing delivery';
  }

  if (['seeking_amenity', 'waiting_for_amenity'].includes(dutyPhase)) {
    const amenityType = staff?.amenityUse?.amenityType
      || staff?.amenityUse?.type
      || staff?.requestedAmenityType;
    return amenityType === 'bed' || staff?.effectiveDuty === 'pto'
      ? 'waiting for bed'
      : 'waiting for amenity';
  }

  if (['active', 'travelling'].includes(dutyPhase)
    && (staff?.ptoSession || staff?.effectiveDuty === 'pto')) {
    return 'sleeping';
  }

  if (dutyPhase === 'exiting' || staff?.exitBlocked || staff?.blockedExit) return 'exit blocked';
  return null;
}

/** Derive display-only duty information from current state and game time. */
export function getStaffDutyPresentation(staff, gameTime = 0) {
  const schedule = getStaffSchedule(staff);
  const requestedDuty = getScheduledDuty(schedule, gameTime) || 'work';
  const effectiveDuty = VALID_MODES.has(staff?.effectiveDuty)
    ? staff.effectiveDuty
    : requestedDuty;
  const dutyPhase = staff?.dutyPhase || 'available';
  return {
    requestedDuty,
    effectiveDuty,
    dutyPhase,
    reason: getDutyReason(staff, dutyPhase),
    minimumEndAt: staff?.ptoSession?.minimumEndAt,
    activityEndsAt: staff?.amenityUse?.activityEndsAt,
  };
}

export function scheduleValidationMessage(reason) {
  return REASON_LABELS[reason] || 'Check the schedule and try again.';
}

function normaliseDraft(schedule) {
  if (!Array.isArray(schedule)) return allWorkSchedule();
  return Array.from({ length: STAFF_SCHEDULE_SLOT_COUNT }, (_, index) =>
    VALID_MODES.has(schedule[index]) ? schedule[index] : 'work'
  );
}

export default function StaffScheduleEditor({
  staff,
  schedule,
  onChange,
  onApply,
  onCancel,
  dispatch,
}) {
  const controlled = Array.isArray(schedule) && typeof onChange === 'function';
  const [internalSchedule, setInternalSchedule] = useState(() => normaliseDraft(schedule));
  const [error, setError] = useState(null);
  const currentSchedule = controlled ? normaliseDraft(schedule) : internalSchedule;
  const staffKey = staff?.id || 'staff';

  const updateSchedule = (nextSchedule) => {
    if (!controlled) setInternalSchedule(nextSchedule);
    onChange?.(nextSchedule);
    setError(null);
  };

  const handleSlotChange = (index, event) => {
    const nextSchedule = currentSchedule.slice();
    nextSchedule[index] = event.target.value;
    updateSchedule(nextSchedule);
  };

  const handleApply = () => {
    const candidate = currentSchedule.slice();
    const validation = validateStaffSchedule(candidate);
    if (!validation.valid) {
      setError(scheduleValidationMessage(validation.reason));
      return;
    }
    setError(null);
    if (onApply) {
      onApply(candidate);
    } else if (dispatch) {
      dispatch({ type: 'SET_STAFF_SCHEDULE', id: staff?.id, schedule: candidate });
    }
  };

  return (
    <section
      aria-labelledby={`schedule-heading-${staffKey}`}
      style={{
        background: '#111a31', border: '1px solid #284a73', borderRadius: 6,
        marginTop: 10, padding: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h4 id={`schedule-heading-${staffKey}`} style={{ ...TYPOGRAPHY.subheading, color: '#dbe9ff', margin: 0 }}>
          Repeating schedule
        </h4>
        <span style={{ ...TYPOGRAPHY.secondary, color: '#8fa4c8' }}>48 half-hour slots</span>
      </div>
      <p style={{ ...TYPOGRAPHY.secondary, color: '#9da9bd', margin: '5px 0 9px' }}>
        Choose Work, Rest, or PTO for each time range. Apply checks the complete repeating day.
      </p>

      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
          Schedule time ranges for {staff?.name || 'staff member'}
        </legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 6 }}>
          {Array.from({ length: STAFF_SCHEDULE_SLOT_COUNT }, (_, index) => {
            const label = formatSlotLabel(index);
            const inputId = `schedule-${staffKey}-${index}`;
            return (
              <label key={inputId} htmlFor={inputId} style={{ ...TYPOGRAPHY.secondary, color: '#aab8cf' }}>
                <span style={{ display: 'block', marginBottom: 2 }}>{label}</span>
                <select
                  id={inputId}
                  name={inputId}
                  aria-label={label}
                  value={currentSchedule[index]}
                  onChange={event => handleSlotChange(index, event)}
                  aria-invalid={Boolean(error)}
                  style={{
                    ...TYPOGRAPHY.control, width: '100%', background: '#0b1224', color: '#e8eef8',
                    border: '1px solid #416187', borderRadius: 4, padding: '5px 6px',
                  }}
                >
                  {MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" style={{ ...TYPOGRAPHY.secondary, color: '#ffb3a7', margin: '9px 0 0' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={handleApply}
          style={{ ...TYPOGRAPHY.control, background: '#f0a500', color: '#111', border: 0, borderRadius: 4, padding: '6px 12px', cursor: 'pointer' }}
        >
          Apply schedule
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 4, padding: '6px 12px', cursor: 'pointer' }}
        >
          Cancel schedule
        </button>
      </div>
    </section>
  );
}
