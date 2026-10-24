import { useEffect, useId, useRef } from 'react';
import StaffFireButton from './StaffFireButton';
import { getStaffCarryCapacity } from '../simulation/staffInventory';
import { getStaffBonusPreview, STAFF_BONUS_COST } from '../simulation/staffProgression';
import { getCharacterMovementStatus } from '../simulation/movement';
import { getStaffTaskProgress } from '../simulation/staffPerformance';
import { humaniseIdentifier, TYPOGRAPHY } from '../typography';
import { useGameState } from '../state/GameContext';
import {
  formatDutyMode,
  formatGameTime,
  getStaffDutyPresentation,
} from '../panels/StaffScheduleEditor';
import { getStaffTaskLabel } from '../panels/staffTaskLabel';

const actionButton = {
  ...TYPOGRAPHY.control,
  border: '1px solid #0f3460', borderRadius: 5, padding: '8px 12px',
  cursor: 'pointer',
};

export default function StaffDetailsPanel({ staff, cashierStations, dispatch, onMove, onClose, gameTime }) {
  const state = useGameState();
  const headingId = useId();
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [staff.id]);

  const role = humaniseIdentifier(staff.role);
  const assignedStation = staff.id != null && Array.isArray(cashierStations)
    ? cashierStations.find(station => station?.assignedStaffId === staff.id)
    : null;
  const task = getStaffTaskLabel(staff, cashierStations);
  const currentGameTime = Number.isFinite(Number(gameTime))
    ? Number(gameTime)
    : state?.restaurant?.gameTime ?? 0;
  const duty = getStaffDutyPresentation(staff, currentGameTime);
  const hasTask = !!staff.task?.type;
  const taskState = state?.restaurant?.gameTime === currentGameTime
    ? state
    : {
        ...(state || {}),
        restaurant: {
          ...(state?.restaurant || {}),
          gameTime: currentGameTime,
        },
      };
  const movement = hasTask
    ? getCharacterMovementStatus(
        taskState,
        staff.id,
        new Map([[String(staff.id), staff]]),
      )
    : null;
  const travelling = hasTask
    && staff.navigationGoal != null
    && movement?.plan !== 'arrived';
  const taskProgress = hasTask && !travelling
    ? getStaffTaskProgress(taskState, staff)
    : null;
  const taskProgressValue = Number.isFinite(taskProgress?.progress)
    ? taskProgress.progress
    : null;
  const bonus = getStaffBonusPreview(staff);
  const funds = state?.restaurant?.funds;
  const reason = !Number.isFinite(staff.morale) ? 'Morale unavailable.'
    : staff.morale >= 100 ? 'Morale is already full.'
      : !Number.isFinite(funds) ? 'Funds unavailable.'
        : funds < STAFF_BONUS_COST ? 'Needs $50 in available funds.' : null;

  return (
    <aside aria-labelledby={headingId} style={{
      ...TYPOGRAPHY.body,
      position: 'absolute', top: 64, right: 16, zIndex: 250, width: 250,
      maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
      background: '#0d1528', border: '1px solid #0f3460', borderRadius: 8,
      color: '#ccc', padding: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <h3 id={headingId} ref={headingRef} tabIndex={-1} style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: 0 }}>{staff.name}</h3>
          <div style={{ ...TYPOGRAPHY.secondary, color: '#8fa4c8', marginTop: 3 }}>{role}</div>
        </div>
        <button
          type="button"
          aria-label="Close staff details"
          onClick={onClose}
          style={{ ...TYPOGRAPHY.icon, background: 'transparent', border: 0, color: '#aaa', cursor: 'pointer' }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '16px 0' }}>
        <div style={{ background: '#16213e', borderRadius: 5, padding: 9 }}>
          <div style={{ ...TYPOGRAPHY.secondary, color: '#7788a8' }}>Morale</div>
          <strong style={{ color: '#fff' }}>{Number.isFinite(staff.morale) ? `${Math.round(staff.morale)}%` : 'Unavailable'}</strong>
        </div>
        <div style={{ background: '#16213e', borderRadius: 5, padding: 9 }}>
          <div style={{ ...TYPOGRAPHY.secondary, color: '#7788a8' }}>Skill</div>
          <strong style={{ color: '#fff' }}>{staff.skill}/10</strong>
        </div>
      </div>

      <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 16 }}>
        Current task: <strong style={{ color: '#fff' }}>{task}</strong>
      </div>

      {staff.role === 'waiter' && (
        <>
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
            Checkout assignment: <strong style={{ color: '#fff' }}>{assignedStation ? String(assignedStation.id) : 'None'}</strong>.
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, color: '#8fa4c8', marginBottom: 16 }}>
            Assignment does not guarantee current availability.
          </div>
        </>
      )}

      {hasTask && (
        <section
          aria-label="Task work progress"
          style={{ ...TYPOGRAPHY.secondary, color: '#aab8cf', background: '#121c35', borderRadius: 4, padding: '7px 9px', marginBottom: 16 }}
        >
          <div style={{ color: '#e8eef8', marginBottom: 4 }}>Task work progress</div>
          {travelling ? (
            <div>Travelling or waiting to reach the task.</div>
          ) : taskProgressValue != null ? (
            <>
              <div>{`Work completed: ${Math.round(taskProgressValue * 100)}%.`}</div>
              <progress
                aria-label="Task work completed"
                max={1}
                value={taskProgressValue}
                style={{ width: '100%', accentColor: '#f0a500' }}
              />
            </>
          ) : (
            <div>Work progress unavailable for this task.</div>
          )}
          <div style={{ color: '#8fa4c8' }}>
            Work progress only; excludes travel and later service steps.
          </div>
        </section>
      )}

      <div
        data-testid={`staff-detail-status-${staff.id}`}
        style={{ ...TYPOGRAPHY.secondary, color: '#aab8cf', background: '#121c35', borderRadius: 4, padding: '7px 9px', marginBottom: 16 }}
      >
        <div>Effective duty: <strong style={{ color: '#e8eef8' }}>{formatDutyMode(duty.effectiveDuty)}</strong></div>
        <div>Duty phase: <strong style={{ color: '#e8eef8' }}>{humaniseIdentifier(duty.dutyPhase)}</strong></div>
        <div>
          Requested duty: <strong style={{ color: '#e8eef8' }}>{formatDutyMode(duty.requestedDuty)}</strong>
          {duty.requestedDuty !== duty.effectiveDuty && ` (currently ${formatDutyMode(duty.effectiveDuty)})`}
        </div>
        {duty.reason && <div>Status: <strong style={{ color: '#f2d08a' }}>{duty.reason}</strong></div>}
        {Number.isFinite(Number(duty.minimumEndAt)) && (
          <div>PTO minimum ends at {formatGameTime(duty.minimumEndAt)} ({duty.minimumEndAt}s)</div>
        )}
        {Number.isFinite(Number(duty.activityEndsAt)) && (
          <div>Activity ends at {formatGameTime(duty.activityEndsAt)} ({duty.activityEndsAt}s)</div>
        )}
      </div>

      <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 16 }}>
        Carry capacity: <strong style={{ color: '#fff' }}>{getStaffCarryCapacity(staff)}</strong>
      </div>

      <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
        Daily salary: <strong style={{ color: '#f0a500' }}>
          {Number.isFinite(staff.salary) && staff.salary >= 0 ? `$${staff.salary}` : 'Unavailable'}
        </strong>
      </div>
      <div style={{ ...TYPOGRAPHY.secondary, color: '#8fa4c8', marginBottom: 16 }}>
        Paid at midnight.
      </div>

      <div
        id={`bonus-preview-${staff.id}`}
        style={{ ...TYPOGRAPHY.secondary, marginBottom: 8 }}
      >
        {bonus && <div>{`After bonus: morale ${Math.round(bonus.morale)}%.`}</div>}
        <div>One-time payment. Daily salary stays unchanged.</div>
        {reason && <div style={{ color: '#f2d08a' }}>{reason}</div>}
      </div>
      <button
        type="button"
        aria-describedby={`bonus-preview-${staff.id}`}
        disabled={!bonus || !!reason}
        onClick={() => dispatch({ type: 'GIVE_BONUS', id: staff.id })}
        style={{
          ...actionButton, width: '100%', background: bonus && !reason ? '#f0a500' : '#333',
          color: bonus && !reason ? '#111' : '#777',
        }}
      >
        {`Give bonus ($${STAFF_BONUS_COST})`}
      </button>

      <button
        type="button"
        onClick={() => onMove?.(staff.id)}
        style={{ ...actionButton, width: '100%', marginTop: 12, background: '#253b59', color: '#dbe9ff' }}
      >
        Move
      </button>

      <StaffFireButton
        worker={staff}
        onConfirm={(id) => {
          dispatch({ type: 'FIRE_STAFF', id });
          onClose();
        }}
        style={{ ...actionButton, width: '100%', marginTop: 12, background: '#3b2025', color: '#f08080', borderColor: '#844' }}
      >
        Fire employee
      </StaffFireButton>
    </aside>
  );
}
