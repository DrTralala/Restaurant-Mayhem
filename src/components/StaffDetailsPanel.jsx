import { useEffect, useState } from 'react';
import { getStaffCarryCapacity } from '../simulation/staffInventory';
import { humaniseIdentifier, TYPOGRAPHY } from '../typography';
import { useGameState } from '../state/GameContext';
import {
  formatDutyMode,
  formatGameTime,
  getStaffDutyPresentation,
} from '../panels/StaffScheduleEditor';

const taskLabels = {
  clean_table: 'Cleaning table',
  take_order: 'Taking order',
  take_payment: 'Taking payment',
  prepare_dish: 'Preparing dish',
  prepare_drink: 'Preparing drink',
  pickup_service_item: 'Collecting order',
  deliver_service_item: 'Delivering order',
  deliver_food_item: 'Delivering order',
  clean_service_item: 'Clearing service item',
  clean_floor: 'Cleaning floor',
  collect_dirty_item: 'Collecting dirty item',
  deliver_dirty_item: 'Delivering dirty item',
  wash_item: 'Washing item',
};

const actionButton = {
  ...TYPOGRAPHY.control,
  border: '1px solid #0f3460', borderRadius: 5, padding: '8px 12px',
  cursor: 'pointer',
};

export default function StaffDetailsPanel({ staff, cashierStations, dispatch, onMove, onClose, gameTime }) {
  const [salary, setSalary] = useState(staff.salary);
  const state = useGameState();

  useEffect(() => setSalary(staff.salary), [staff.id, staff.salary]);

  const role = humaniseIdentifier(staff.role);
  const assignedStation = cashierStations?.find(station => station.assignedStaffId === staff.id);
  const task = taskLabels[staff.task?.type]
    || (staff.role === 'waiter' && assignedStation ? 'Staffing cashier' : 'Available');
  const currentGameTime = Number.isFinite(Number(gameTime))
    ? Number(gameTime)
    : state?.restaurant?.gameTime ?? 0;
  const duty = getStaffDutyPresentation(staff, currentGameTime);

  return (
    <aside style={{
      ...TYPOGRAPHY.body,
      position: 'absolute', top: 64, right: 16, zIndex: 250, width: 250,
      background: '#0d1528', border: '1px solid #0f3460', borderRadius: 8,
      color: '#ccc', padding: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: 0 }}>{staff.name}</h3>
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
          <strong style={{ color: '#fff' }}>{Math.round(staff.morale)}%</strong>
        </div>
        <div style={{ background: '#16213e', borderRadius: 5, padding: 9 }}>
          <div style={{ ...TYPOGRAPHY.secondary, color: '#7788a8' }}>Skill</div>
          <strong style={{ color: '#fff' }}>{staff.skill}/10</strong>
        </div>
      </div>

      <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 16 }}>
        Current task: <strong style={{ color: '#fff' }}>{task}</strong>
      </div>

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

      <label htmlFor={`salary-${staff.id}`} style={{ ...TYPOGRAPHY.secondary, display: 'block' }}>
        Daily salary: <strong style={{ color: '#f0a500' }}>${salary}</strong>
      </label>
      <input
        id={`salary-${staff.id}`}
        aria-label={`Daily salary for ${staff.name}`}
        type="range"
        min={staff.salary}
        max={staff.salary + 500}
        step="10"
        value={salary}
        onChange={event => setSalary(Number(event.target.value))}
        style={{ width: '100%', accentColor: '#f0a500', margin: '8px 0' }}
      />
      <button
        type="button"
        onClick={() => dispatch({ type: 'SET_STAFF_SALARY', id: staff.id, salary })}
        disabled={salary <= staff.salary}
        style={{
          ...actionButton, width: '100%', background: salary > staff.salary ? '#f0a500' : '#333',
          color: salary > staff.salary ? '#111' : '#777',
        }}
      >
        Apply raise
      </button>

      <button
        type="button"
        onClick={() => onMove?.(staff.id)}
        style={{ ...actionButton, width: '100%', marginTop: 12, background: '#253b59', color: '#dbe9ff' }}
      >
        Move
      </button>

      <button
        type="button"
        aria-label={`Fire ${staff.name}`}
        onClick={() => {
          dispatch({ type: 'FIRE_STAFF', id: staff.id });
          onClose();
        }}
        style={{ ...actionButton, width: '100%', marginTop: 12, background: '#3b2025', color: '#f08080', borderColor: '#844' }}
      >
        Fire employee
      </button>
    </aside>
  );
}
