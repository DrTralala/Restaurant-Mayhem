import { useEffect, useState } from 'react';

const taskLabels = {
  guide_customer: 'Guiding customer',
  clean_table: 'Cleaning table',
  take_order: 'Taking order',
  take_payment: 'Taking payment',
  prepare_dish: 'Preparing dish',
  prepare_drink: 'Preparing drink',
  pickup_service_item: 'Collecting order',
  deliver_service_item: 'Delivering order',
  clean_service_item: 'Clearing service item',
  clean_floor: 'Cleaning floor',
  collect_dirty_item: 'Collecting dirty item',
  deliver_dirty_item: 'Delivering dirty item',
  wash_item: 'Washing item',
};

const actionButton = {
  border: '1px solid #0f3460', borderRadius: 5, padding: '8px 12px',
  cursor: 'pointer', fontFamily: 'monospace', fontSize: 12,
};

export default function StaffDetailsPanel({ staff, cashierStations, dispatch, onClose }) {
  const [salary, setSalary] = useState(staff.salary);

  useEffect(() => setSalary(staff.salary), [staff.id, staff.salary]);

  const role = staff.role.charAt(0).toUpperCase() + staff.role.slice(1);
  const assignedStation = cashierStations?.find(station => station.assignedStaffId === staff.id);
  const task = taskLabels[staff.task?.type]
    || (staff.role === 'waiter' && assignedStation ? 'Staffing cashier' : 'Available');

  return (
    <aside style={{
      position: 'absolute', top: 64, right: 16, zIndex: 250, width: 250,
      background: '#0d1528', border: '1px solid #0f3460', borderRadius: 8,
      color: '#ccc', padding: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
      fontFamily: 'monospace',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <h3 style={{ color: '#f0a500', margin: 0, fontSize: 18 }}>{staff.name}</h3>
          <div style={{ color: '#8fa4c8', marginTop: 3 }}>{role}</div>
        </div>
        <button
          type="button"
          aria-label="Close staff details"
          onClick={onClose}
          style={{ background: 'transparent', border: 0, color: '#aaa', cursor: 'pointer', fontSize: 18 }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '16px 0' }}>
        <div style={{ background: '#16213e', borderRadius: 5, padding: 9 }}>
          <div style={{ color: '#7788a8', fontSize: 10 }}>MORALE</div>
          <strong style={{ color: '#fff' }}>{Math.round(staff.morale)}%</strong>
        </div>
        <div style={{ background: '#16213e', borderRadius: 5, padding: 9 }}>
          <div style={{ color: '#7788a8', fontSize: 10 }}>SKILL</div>
          <strong style={{ color: '#fff' }}>{staff.skill}/10</strong>
        </div>
      </div>

      <div style={{ fontSize: 12, marginBottom: 16 }}>
        Current task: <strong style={{ color: '#fff' }}>{task}</strong>
      </div>

      <label htmlFor={`salary-${staff.id}`} style={{ display: 'block', fontSize: 12 }}>
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
        Apply Raise
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
