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
const SLOT_MINUTES = 30;

const MODE_COLOURS = Object.freeze({
  work: Object.freeze({ background: '#2f8f6b', color: '#effff7' }),
  rest: Object.freeze({ background: '#416a99', color: '#eef5ff' }),
  pto: Object.freeze({ background: '#b8793d', color: '#fff4df' }),
});

const MODE_OPTIONS = STAFF_DUTY_MODES.map(mode => ({
  value: mode,
  label: MODE_LABELS[mode] || humaniseIdentifier(mode),
}));

const VALID_MODES = new Set(STAFF_DUTY_MODES);

function formatSlotTime(index) {
  const minutes = Number(index) * SLOT_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function formatBoundaryTime(index) {
  return Number(index) === STAFF_SCHEDULE_SLOT_COUNT ? '24:00 (midnight)' : formatSlotTime(index);
}

const SLOT_OPTIONS = Array.from({ length: STAFF_SCHEDULE_SLOT_COUNT }, (_, index) => ({
  value: String(index),
  label: formatSlotTime(index),
}));

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
  const slotIndex = Number(index);
  return `${formatSlotTime(slotIndex)} to ${formatSlotTime((slotIndex + 1) % STAFF_SCHEDULE_SLOT_COUNT)}`;
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

function formatHours(hours) {
  const value = Number(hours);
  const unit = value === 1 ? 'hour' : 'hours';
  const minutes = Math.round(value * 60);
  const minuteDetail = value % 1 === 0 ? '' : ` (${minutes} minutes)`;
  return `${value} ${unit}${minuteDetail}`;
}

function buildSchedulePeriods(schedule) {
  const periods = [];
  let start = 0;
  let mode = schedule[0];

  for (let index = 1; index <= STAFF_SCHEDULE_SLOT_COUNT; index += 1) {
    if (index < STAFF_SCHEDULE_SLOT_COUNT && schedule[index] === mode) continue;
    const slotCount = index - start;
    periods.push({
      start,
      end: index,
      mode,
      slotCount,
      hours: slotCount * 0.5,
    });
    if (index < STAFF_SCHEDULE_SLOT_COUNT) {
      start = index;
      mode = schedule[index];
    }
  }

  if (periods.length > 1 && periods[0].mode === periods[periods.length - 1].mode) {
    const first = periods[0];
    const last = periods[periods.length - 1];
    const overnight = {
      start: last.start,
      end: first.end,
      mode: first.mode,
      slotCount: first.slotCount + last.slotCount,
      hours: (first.slotCount + last.slotCount) * 0.5,
      overnight: true,
    };
    return [overnight, ...periods.slice(1, -1)];
  }

  return periods;
}

function getScheduleTotals(schedule) {
  return STAFF_DUTY_MODES.map(mode => ({
    mode,
    hours: schedule.reduce((total, slot) => total + (slot === mode ? 0.5 : 0), 0),
  }));
}

function controlStyle() {
  return {
    ...TYPOGRAPHY.control,
    width: '100%', background: '#0b1224', color: '#e8eef8',
    border: '1px solid #416187', borderRadius: 4, padding: '5px 6px',
  };
}

export default function StaffScheduleEditor({
  staff,
  schedule,
  onChange,
  onApply,
  onCancel,
  dispatch,
  staffList = [],
}) {
  const controlled = Array.isArray(schedule) && typeof onChange === 'function';
  const [internalSchedule, setInternalSchedule] = useState(() => normaliseDraft(
    Array.isArray(schedule) ? schedule : getStaffSchedule(staff),
  ));
  const [error, setError] = useState(null);
  const [dutyMode, setDutyMode] = useState('work');
  const [fromSlot, setFromSlot] = useState('0');
  const [toSlot, setToSlot] = useState('16');
  const [copyStaffId, setCopyStaffId] = useState('');
  const currentSchedule = controlled ? normaliseDraft(schedule) : internalSchedule;
  const staffKey = staff?.id || 'staff';
  const otherStaff = (Array.isArray(staffList) ? staffList : [])
    .filter(worker => worker && (staff?.id != null ? worker.id !== staff.id : worker !== staff));
  const copySource = otherStaff.find(worker => String(worker.id) === copyStaffId);
  const schedulePeriods = buildSchedulePeriods(currentSchedule);
  const scheduleTotals = getScheduleTotals(currentSchedule);

  const updateSchedule = (nextSchedule) => {
    if (!controlled) setInternalSchedule(nextSchedule);
    onChange?.(nextSchedule);
    setError(null);
  };

  const handleSetRange = () => {
    const from = Number(fromSlot);
    const to = Number(toSlot);
    if (from === to) {
      setError('From and To must be different times. Choose All day to fill the whole schedule.');
      return;
    }

    const nextSchedule = currentSchedule.slice();
    for (let index = from; index !== to; index = (index + 1) % STAFF_SCHEDULE_SLOT_COUNT) {
      nextSchedule[index] = dutyMode;
    }
    updateSchedule(nextSchedule);
  };

  const handleAllDay = () => {
    updateSchedule(Array.from({ length: STAFF_SCHEDULE_SLOT_COUNT }, () => dutyMode));
  };

  const handleCopy = () => {
    if (!copySource) return;
    updateSchedule(getStaffSchedule(copySource));
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
        Choose a duty and time range. Apply checks the complete repeating day.
      </p>

      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
          Schedule time ranges for {staff?.name || 'staff member'}
        </legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
          <label htmlFor={`schedule-duty-${staffKey}`} style={{ ...TYPOGRAPHY.secondary, color: '#aab8cf', flex: '1 1 120px' }}>
            <span style={{ display: 'block', marginBottom: 2 }}>Duty</span>
            <select
              id={`schedule-duty-${staffKey}`}
              name={`schedule-duty-${staffKey}`}
              aria-label="Duty"
              value={dutyMode}
              onChange={event => {
                setDutyMode(event.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error)}
              style={controlStyle()}
            >
              {MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label htmlFor={`schedule-from-${staffKey}`} style={{ ...TYPOGRAPHY.secondary, color: '#aab8cf', flex: '1 1 120px' }}>
            <span style={{ display: 'block', marginBottom: 2 }}>From</span>
            <select
              id={`schedule-from-${staffKey}`}
              name={`schedule-from-${staffKey}`}
              aria-label="From"
              value={fromSlot}
              onChange={event => {
                setFromSlot(event.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error)}
              style={controlStyle()}
            >
              {SLOT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label htmlFor={`schedule-to-${staffKey}`} style={{ ...TYPOGRAPHY.secondary, color: '#aab8cf', flex: '1 1 120px' }}>
            <span style={{ display: 'block', marginBottom: 2 }}>To</span>
            <select
              id={`schedule-to-${staffKey}`}
              name={`schedule-to-${staffKey}`}
              aria-label="To"
              value={toSlot}
              onChange={event => {
                setToSlot(event.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error)}
              style={controlStyle()}
            >
              {SLOT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={handleSetRange}
            style={{ ...TYPOGRAPHY.control, background: '#f0a500', color: '#111', border: 0, borderRadius: 4, padding: '6px 12px', cursor: 'pointer' }}
          >
            Set range
          </button>
          <button
            type="button"
            onClick={handleAllDay}
            style={{ ...TYPOGRAPHY.control, background: '#253b59', color: '#dbe9ff', border: '1px solid #416187', borderRadius: 4, padding: '5px 10px', cursor: 'pointer' }}
          >
            All day
          </button>
        </div>
      </fieldset>

      {otherStaff.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end', marginTop: 10 }}>
          <label htmlFor={`schedule-copy-${staffKey}`} style={{ ...TYPOGRAPHY.secondary, color: '#aab8cf', flex: '1 1 180px' }}>
            <span style={{ display: 'block', marginBottom: 2 }}>Copy from</span>
            <select
              id={`schedule-copy-${staffKey}`}
              name={`schedule-copy-${staffKey}`}
              aria-label="Copy from"
              value={copyStaffId}
              onChange={event => {
                setCopyStaffId(event.target.value);
                setError(null);
              }}
              style={controlStyle()}
            >
              <option value="">Choose a staff member</option>
              {otherStaff.map(worker => (
                <option key={worker.id} value={worker.id}>{worker.name || worker.id}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!copySource}
            style={{ ...TYPOGRAPHY.control, background: copySource ? '#253b59' : '#333', color: copySource ? '#dbe9ff' : '#777', border: '1px solid #416187', borderRadius: 4, padding: '5px 10px', cursor: copySource ? 'pointer' : 'not-allowed' }}
          >
            Copy schedule
          </button>
        </div>
      )}

      <div style={{ marginTop: 12, background: '#0d1528', border: '1px solid #223d62', borderRadius: 5, padding: 8 }}>
        <div role="group" aria-label="Duty legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 7 }}>
          {STAFF_DUTY_MODES.map(mode => (
            <span key={mode} style={{ ...TYPOGRAPHY.secondary, color: MODE_COLOURS[mode].color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: MODE_COLOURS[mode].background }} />
              {formatDutyMode(mode)}
            </span>
          ))}
        </div>
        <div role="img" aria-label="24-hour schedule band" style={{ display: 'flex', gap: 1, width: '100%', minHeight: 18, overflow: 'hidden', borderRadius: 3, background: '#080e1c' }}>
          {currentSchedule.map((mode, index) => (
            <span
              key={`${mode}-${index}`}
              aria-hidden="true"
              style={{ ...MODE_COLOURS[mode], flex: '1 1 0', minWidth: 2, height: 18 }}
            />
          ))}
        </div>
        <div style={{ ...TYPOGRAPHY.secondary, color: '#8fa4c8', display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 3 }}>
          <span>00:00</span>
          <span>24:00 (midnight)</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 9 }}>
          <ul aria-label="Schedule totals" style={{ ...TYPOGRAPHY.secondary, color: '#c9d7ec', listStyle: 'none', padding: 0, margin: 0, flex: '1 1 150px' }}>
            {scheduleTotals.map(({ mode, hours }) => (
              <li key={mode}>
                <span style={{ color: MODE_COLOURS[mode].color }}>{formatDutyMode(mode)}</span>: {formatHours(hours)}
              </li>
            ))}
          </ul>
          <ul aria-label="Schedule periods" style={{ ...TYPOGRAPHY.secondary, color: '#c9d7ec', listStyle: 'none', padding: 0, margin: 0, flex: '2 1 260px' }}>
            {schedulePeriods.map(period => (
              <li key={`${period.start}-${period.end}-${period.mode}`}>
                {formatBoundaryTime(period.start)} to {formatBoundaryTime(period.end)}{period.overnight ? ' (overnight)' : ''} · {formatDutyMode(period.mode)} · {formatHours(period.hours)}
              </li>
            ))}
          </ul>
        </div>
      </div>

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
