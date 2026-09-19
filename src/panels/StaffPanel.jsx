import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { getNameGender } from '../canvas/characterAppearance';
import { getStaffTrainingCost, STAFF_SALARIES } from '../simulation/staffProgression';
import { humaniseIdentifier, TYPOGRAPHY } from '../typography';
import StaffScheduleEditor, {
  formatDutyMode,
  formatGameTime,
  getStaffDutyPresentation,
  getStaffSchedule,
} from './StaffScheduleEditor';

const ROLES = Object.keys(STAFF_SALARIES);
const NAMES = ['Marco', 'Anna', 'Luca', 'Sofia', 'Giovanni', 'Isabella', 'Mario', 'Elena'];
const ROLE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'cook', label: 'Cooks' },
  { value: 'waiter', label: 'Waiters' },
  { value: 'janitor', label: 'Janitors' },
];

const smallBtn = {
  ...TYPOGRAPHY.control,
  background: '#333', color: '#ccc', border: '1px solid #555',
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
};

export default function StaffPanel() {
  const state = useGameState();
  const dispatch = useDispatch();
  const [showHire, setShowHire] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [scheduleDrafts, setScheduleDrafts] = useState({});
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const funds = state.restaurant?.funds ?? 0;
  const staff = Array.isArray(state.staff) ? state.staff : [];
  const canAffordAnyRole = Object.values(STAFF_SALARIES).some(salary => funds >= salary);

  const sortedStaff = [...staff].sort((left, right) => {
    const leftSkill = Number.isFinite(Number(left.skill)) ? Number(left.skill) : Number.NEGATIVE_INFINITY;
    const rightSkill = Number.isFinite(Number(right.skill)) ? Number(right.skill) : Number.NEGATIVE_INFINITY;
    if (rightSkill !== leftSkill) return rightSkill - leftSkill;
    const leftId = String(left.id ?? '');
    const rightId = String(right.id ?? '');
    if (leftId < rightId) return -1;
    if (leftId > rightId) return 1;
    return 0;
  });
  const displayedStaff = roleFilter === 'all'
    ? sortedStaff
    : sortedStaff.filter(worker => worker.role === roleFilter);
  const gameTime = state.restaurant?.gameTime ?? 0;

  const handleHire = (role) => {
    const usedNames = new Set(staff.map(worker => worker.name.toLowerCase()));
    const availableNames = NAMES.filter(name => !usedNames.has(name.toLowerCase()));
    const namePool = availableNames.length > 0 ? availableNames : NAMES;
    const name = namePool[Math.floor(Math.random() * namePool.length)];
    const skill = 1 + Math.floor(Math.random() * 3);
    const salary = STAFF_SALARIES[role];
    if (funds < salary) return;
    dispatch({
      type: 'HIRE_STAFF',
      staff: {
        id: `staff-${Date.now()}`,
        name,
        gender: getNameGender(name),
        role,
        skill,
        morale: 80,
        salary,
      },
    });
    setShowHire(false);
  };

  const startRename = (staff) => {
    setEditingId(staff.id);
    setEditingName(staff.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveRename = (id) => {
    const name = editingName.trim();
    if (!name) return;
    dispatch({ type: 'RENAME_STAFF', id, name });
    cancelRename();
  };

  const startScheduleEdit = (worker) => {
    setScheduleDrafts(current => Object.prototype.hasOwnProperty.call(current, worker.id)
      ? current
      : { ...current, [worker.id]: getStaffSchedule(worker) });
    setEditingId(null);
    setEditingScheduleId(worker.id);
  };

  const cancelSchedule = (id) => {
    setScheduleDrafts(current => {
      if (!Object.prototype.hasOwnProperty.call(current, id)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setEditingScheduleId(current => current === id ? null : current);
  };

  const applySchedule = (id, schedule) => {
    dispatch({ type: 'SET_STAFF_SCHEDULE', id, schedule });
    setScheduleDrafts(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setEditingScheduleId(current => current === id ? null : current);
  };

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: 0 }}>Staff ({staff.length})</h3>
        <button type="button" onClick={() => setShowHire(!showHire)} disabled={!canAffordAnyRole} style={{
          ...TYPOGRAPHY.control,
          background: '#f0a500', color: '#111', border: 'none',
          padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
        }}>
          + Hire
        </button>
      </div>

      <div role="group" aria-label="Filter staff by role" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {ROLE_FILTERS.map(filter => {
          const selected = roleFilter === filter.value;
          return (
            <button
              type="button"
              key={filter.value}
              aria-pressed={selected}
              onClick={() => setRoleFilter(filter.value)}
              style={{
                ...TYPOGRAPHY.control,
                background: selected ? '#f0a500' : '#333', color: selected ? '#111' : '#ccc',
                border: `1px solid ${selected ? '#f0a500' : '#555'}`,
                borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
              }}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {showHire && (
        <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Hire staff</h4>
           {ROLES.map(role => (
             <button type="button" key={role} onClick={() => handleHire(role)}
               disabled={funds < STAFF_SALARIES[role]} style={{
              ...TYPOGRAPHY.control,
              background: '#333', color: '#ccc', border: '1px solid #555',
              padding: '8px 14px', borderRadius: 4, cursor: 'pointer', marginRight: 8, marginBottom: 4,
            }}>
              {humaniseIdentifier(role)}
            </button>
          ))}
        </div>
      )}

      {displayedStaff.map(s => {
        const trainingCost = getStaffTrainingCost(s);
        const trainingDisabled = trainingCost == null || s.skill >= 10
          || funds < trainingCost;
        const duty = getStaffDutyPresentation(s, gameTime);
        const skill = Number.isFinite(Number(s.skill)) ? Number(s.skill) : 0;
        const scheduleDraft = scheduleDrafts[s.id];
        return (
        <div key={s.id} data-testid="staff-card" data-staff-id={s.id} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 8, border: '1px solid #0f3460' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {editingId === s.id ? (
              <input
                aria-label={`Rename ${s.name}`}
                value={editingName}
                onChange={event => setEditingName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') saveRename(s.id);
                  if (event.key === 'Escape') cancelRename();
                }}
                autoFocus
                style={{ ...TYPOGRAPHY.body, background: '#111', color: '#ccc', border: '1px solid #555', borderRadius: 4, padding: '3px 6px' }}
              />
            ) : (
              <strong>{s.name}</strong>
            )}
              <span style={{ ...TYPOGRAPHY.secondary, color: '#888' }}>{humaniseIdentifier(s.role)} · ${s.salary}/day</span>
            </div>
          <div style={{ ...TYPOGRAPHY.secondary, margin: '4px 0' }}>
            Skill: {skill}/10
            <span style={{ marginLeft: 16 }}>Morale: {Math.round(s.morale)}%</span>
          </div>
          <div
            data-testid={`staff-status-${s.id}`}
            style={{ ...TYPOGRAPHY.secondary, color: '#aab8cf', background: '#121c35', borderRadius: 4, padding: '6px 8px', marginTop: 7 }}
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
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {editingId === s.id ? (
              <>
                <button type="button" onClick={() => saveRename(s.id)} disabled={!editingName.trim()} style={{ ...smallBtn, opacity: editingName.trim() ? 1 : 0.5 }}>
                  Save
                </button>
                <button type="button" onClick={cancelRename} style={smallBtn}>Cancel</button>
              </>
            ) : (
              <button type="button" onClick={() => startRename(s)} style={smallBtn}>Rename</button>
            )}
            <button type="button" onClick={() => dispatch({ type: 'TRAIN_STAFF', id: s.id, cost: trainingCost })} disabled={trainingDisabled}
              style={{ ...smallBtn, opacity: trainingDisabled ? 0.5 : 1 }}>
              Train ({trainingCost == null ? 'Unavailable' : `$${trainingCost}`})
            </button>
            <button type="button" onClick={() => dispatch({ type: 'GIVE_BONUS', id: s.id, cost: 50 })} disabled={funds < 50}
              style={{ ...smallBtn, opacity: funds < 50 ? 0.5 : 1 }}>
              Bonus ($50)
            </button>
            <button type="button" onClick={() => dispatch({ type: 'FIRE_STAFF', id: s.id })}
              style={{ ...smallBtn, background: '#633', borderColor: '#844', color: '#d44' }}>
              Fire
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              aria-label={`${editingScheduleId === s.id ? 'Hide' : 'Edit'} schedule for ${s.name}`}
              aria-expanded={editingScheduleId === s.id}
              onClick={() => editingScheduleId === s.id ? cancelSchedule(s.id) : startScheduleEdit(s)}
              style={{ ...smallBtn, background: '#253b59', color: '#dbe9ff' }}
            >
              {editingScheduleId === s.id ? 'Hide schedule' : 'Edit schedule'}
            </button>
          </div>
          {editingScheduleId === s.id && (
            <StaffScheduleEditor
              staff={s}
              staffList={staff}
              schedule={scheduleDraft || getStaffSchedule(s)}
              onChange={nextSchedule => setScheduleDrafts(current => ({ ...current, [s.id]: nextSchedule }))}
              onApply={nextSchedule => applySchedule(s.id, nextSchedule)}
              onCancel={() => cancelSchedule(s.id)}
            />
          )}
        </div>
        );
      })}

      {staff.length === 0 && (
        <p style={{ ...TYPOGRAPHY.secondary, color: '#666' }}>No staff yet. Hire your first employee!</p>
      )}
      {staff.length > 0 && displayedStaff.length === 0 && (
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888' }}>No staff match this role.</p>
      )}
    </div>
  );
}
