import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useGameState, useDispatch, useGameGeneration } from '../state/GameContext';
import StaffFireButton from '../components/StaffFireButton';
import { getNameGender } from '../canvas/characterAppearance';
import { getStaffBonusPreview, getStaffTrainingCost, STAFF_BONUS_COST, STAFF_SALARIES } from '../simulation/staffProgression';
import { humaniseIdentifier, TYPOGRAPHY } from '../typography';
import { isCareerDecisionPending } from '../simulation/careerRun';
import StaffScheduleEditor, {
  formatDutyMode,
  formatGameTime,
  getStaffDutyPresentation,
  getStaffSchedule,
} from './StaffScheduleEditor';
import { getStaffHirePreview } from './staffHirePreview';
import { getStaffTaskLabel } from './staffTaskLabel';
import { getStaffTrainingPreview } from './staffTrainingPreview';

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

const formatFunds = value => (Number.isFinite(value)
  ? `$${Number.isInteger(value) ? value : value.toFixed(2)}`
  : 'Unavailable');

export default function StaffPanel({ onLocateStaff, locateDisabled = false, locateMessage = '' }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const generation = useGameGeneration();
  const decisionPending = isCareerDecisionPending(state);
  const locateHandler = typeof onLocateStaff === 'function' ? onLocateStaff : null;
  const bonusExplanationId = useId();
  const hireButtonRef = useRef(null);
  const [showHire, setShowHire] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingIdentity, setEditingIdentity] = useState(null);
  const [roleFilter, setRoleFilter] = useState('all');
  const [scheduleDrafts, setScheduleDrafts] = useState({});
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const rawFunds = state.restaurant?.funds;
  const staff = Array.isArray(state.staff) ? state.staff : [];

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
  const renameIdentityRef = useRef(null);
  const staffRef = useRef(staff);
  const roleFilterRef = useRef(roleFilter);
  const generationRef = useRef(generation);
  const decisionRef = useRef(decisionPending);

  // Latest committed values for the synchronous rename guard; layout effects
  // run before the browser processes the next interaction.
  useLayoutEffect(() => {
    staffRef.current = staff;
    roleFilterRef.current = roleFilter;
    generationRef.current = generation;
    decisionRef.current = decisionPending;
  });

  const clearRenameDraft = () => {
    renameIdentityRef.current = null;
    setEditingId(null);
    setEditingName('');
    setEditingIdentity(null);
  };

  useEffect(() => {
    if (!editingIdentity) return;
    const worker = staff.find(candidate => candidate.id === editingIdentity.id);
    if (!worker
      || worker.name !== editingIdentity.name
      || worker.role !== editingIdentity.role
      || generation !== editingIdentity.generation) {
      clearRenameDraft();
    }
  }, [editingIdentity, staff, generation]);

  useEffect(() => {
    if (decisionPending) setEditingScheduleId(null);
  }, [decisionPending]);

  const handleRoleFilter = (nextFilter) => {
    const identity = renameIdentityRef.current;
    if (identity) {
      const worker = staffRef.current.find(candidate => candidate.id === identity.id);
      const included = worker != null
        && (nextFilter === 'all' || worker.role === nextFilter);
      if (!included) clearRenameDraft();
    }
    setRoleFilter(nextFilter);
  };

  const handleHire = (role) => {
    if (decisionRef.current) return;
    const preview = getStaffHirePreview({ funds: rawFunds, staff }, role);
    if (!preview || !preview.canHire) return;
    const usedNames = new Set(staff.map(worker => worker.name.toLowerCase()));
    const availableNames = NAMES.filter(name => !usedNames.has(name.toLowerCase()));
    const namePool = availableNames.length > 0 ? availableNames : NAMES;
    const name = namePool[Math.floor(Math.random() * namePool.length)];
    const skill = 1 + Math.floor(Math.random() * 3);
    const salary = STAFF_SALARIES[role];
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

  const startRename = (worker) => {
    if (decisionRef.current) return;
    const identity = {
      id: worker.id,
      name: worker.name,
      role: worker.role,
      generation,
    };
    renameIdentityRef.current = identity;
    setEditingIdentity(identity);
    setEditingId(worker.id);
    setEditingName(worker.name);
  };

  const cancelRename = () => {
    clearRenameDraft();
  };

  const saveRename = (id) => {
    if (decisionRef.current) {
      cancelRename();
      return;
    }
    const identity = renameIdentityRef.current;
    const worker = staffRef.current.find(candidate => candidate.id === id);
    const displayed = roleFilterRef.current === 'all'
      ? worker != null
      : worker != null && worker.role === roleFilterRef.current;
    if (!identity
      || identity.id !== id
      || !worker
      || worker.name !== identity.name
      || worker.role !== identity.role
      || generationRef.current !== identity.generation
      || !displayed
      || decisionRef.current) {
      cancelRename();
      return;
    }
    const name = editingName.trim();
    if (!name) return;
    dispatch({ type: 'RENAME_STAFF', id, name });
    cancelRename();
  };

  const startScheduleEdit = (worker) => {
    if (decisionRef.current) return;
    setScheduleDrafts(current => Object.prototype.hasOwnProperty.call(current, worker.id)
      ? current
      : { ...current, [worker.id]: getStaffSchedule(worker) });
    cancelRename();
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
    if (decisionRef.current) return;
    dispatch({ type: 'SET_STAFF_SCHEDULE', id, schedule });
    setScheduleDrafts(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setEditingScheduleId(current => current === id ? null : current);
  };

  const handleTrain = (id, cost) => {
    if (decisionRef.current) return;
    if (cost == null || !Number.isFinite(cost) || cost < 0) return;
    if (!Number.isFinite(rawFunds) || rawFunds < cost) return;
    dispatch({ type: 'TRAIN_STAFF', id, cost });
  };

  const handleBonus = (id) => {
    if (decisionRef.current) return;
    dispatch({ type: 'GIVE_BONUS', id });
  };

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: 0 }}>Staff ({staff.length})</h3>
        <button ref={hireButtonRef} type="button" disabled={decisionPending}
          onClick={() => {
            if (decisionRef.current) return;
            setShowHire(!showHire);
          }} style={{
            ...TYPOGRAPHY.control,
            background: '#f0a500', color: '#111', border: 'none',
            padding: '6px 14px', borderRadius: 4,
            cursor: decisionPending ? 'not-allowed' : 'pointer',
            opacity: decisionPending ? 0.5 : 1,
          }}>
          + Hire
        </button>
      </div>

      {decisionPending && (
        <p style={{ ...TYPOGRAPHY.secondary, color: '#f2d08a', margin: '0 0 10px' }}>
          Resolve the career decision before changing staff.
        </p>
      )}

      <div role="group" aria-label="Filter staff by role" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {ROLE_FILTERS.map(filter => {
          const selected = roleFilter === filter.value;
          return (
            <button
              type="button"
              key={filter.value}
              aria-pressed={selected}
              onClick={() => handleRoleFilter(filter.value)}
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

      {locateMessage && (
        <p style={{ ...TYPOGRAPHY.secondary, color: '#f2d08a', margin: '0 0 10px' }}>{locateMessage}</p>
      )}

      {showHire && (
        <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Hire staff</h4>
          <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '0 0 8px' }}>
            Hiring is charged immediately. Daily salaries are paid at midnight.
          </p>
          <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '0 0 8px' }}>
            Assumes unchanged staff and salaries. Full payroll is charged at the next midnight without proration. Excludes all other receipts and spending.
          </p>
          <div data-testid="hire-role-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ROLES.map(role => {
              const salary = STAFF_SALARIES[role];
              const preview = getStaffHirePreview({ funds: rawFunds, staff }, role);
              const projectionDescriptionId = `${bonusExplanationId}-hire-${role}`;
              const negativeAfterPayroll = Number.isFinite(preview?.fundsAfterPayroll)
                && preview.fundsAfterPayroll < 0;
              return (
                <div key={role} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: '1 1 180px', minWidth: 0 }}>
                  <button type="button" onClick={() => handleHire(role)}
                    disabled={decisionPending || !preview?.canHire}
                    aria-describedby={`hire-cost-${role} ${projectionDescriptionId}`} style={{
                    ...TYPOGRAPHY.control,
                    background: '#333', color: '#ccc', border: '1px solid #555',
                    padding: '8px 14px', borderRadius: 4,
                    cursor: decisionPending || !preview?.canHire ? 'not-allowed' : 'pointer',
                    opacity: decisionPending ? 0.5 : 1,
                  }}>
                    {humaniseIdentifier(role)}
                  </button>
                  <p id={`hire-cost-${role}`} style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0 0' }}>
                    {`$${salary} to hire · $${salary}/day`}
                  </p>
                  <div id={projectionDescriptionId} style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0 0' }}>
                    <div>{`Funds after hiring: ${formatFunds(preview?.fundsAfterHire)}`}</div>
                    <div>{`Daily payroll after hiring: ${formatFunds(preview?.dailyPayrollAfterHire)}`}</div>
                    <div>{`Balance after that payroll only: ${formatFunds(preview?.fundsAfterPayroll)}`}</div>
                    {negativeAfterPayroll && (
                      <div style={{ color: '#f2d08a' }}>This hire would leave current funds short of the next payroll.</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {displayedStaff.map((s, index) => {
        const trainingCost = getStaffTrainingCost(s);
        const trainingReason = decisionPending
          ? 'Resolve the career decision before training.'
          : Number.isFinite(s.skill) && s.skill >= 10
            ? 'Maximum skill reached.'
            : trainingCost == null || !Number.isFinite(trainingCost) || trainingCost < 0
              ? 'Training unavailable.'
              : !Number.isFinite(rawFunds)
                ? 'Funds unavailable.'
                : rawFunds < trainingCost
                  ? `Needs $${trainingCost} in available funds.`
                  : null;
        const trainingDisabled = Boolean(trainingReason);
        const trainingPreview = getStaffTrainingPreview(s);
        const duty = getStaffDutyPresentation(s, gameTime);
        const skill = Number.isFinite(Number(s.skill)) ? Number(s.skill) : 0;
        const scheduleDraft = scheduleDrafts[s.id];
        const bonus = getStaffBonusPreview(s);
        const bonusReason = !Number.isFinite(s.morale) ? 'Morale unavailable.'
          : s.morale >= 100 ? 'Morale is already full.'
            : !Number.isFinite(rawFunds) ? 'Funds unavailable.'
              : rawFunds < STAFF_BONUS_COST ? `Needs $${STAFF_BONUS_COST} in available funds.` : null;
        const bonusDisabled = decisionPending || !bonus || !Number.isFinite(rawFunds) || rawFunds < STAFF_BONUS_COST;
        const bonusDescriptionId = `${bonusExplanationId}-bonus-${index}`;
        const trainingDescriptionId = `${bonusExplanationId}-training-${index}`;
        const locateUnavailable = !locateHandler || locateDisabled || decisionPending
          || !Number.isFinite(s.x) || !Number.isFinite(s.y);
        const scheduleEditorOpen = editingScheduleId === s.id && !decisionPending;
        return (
        <div key={s.id} data-testid="staff-card" data-staff-id={s.id} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 8, border: '1px solid #0f3460' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {editingId === s.id ? (
              <input
                aria-label={`Rename ${s.name}`}
                value={editingName}
                disabled={decisionPending}
                onChange={event => setEditingName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') saveRename(s.id);
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelRename();
                  }
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
            <span style={{ marginLeft: 16 }}>Morale: {Number.isFinite(s.morale) ? `${Math.round(s.morale)}%` : 'Unavailable'}</span>
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, margin: '4px 0', overflowWrap: 'anywhere' }}>
            Current task: {getStaffTaskLabel(s, state.cashierStations)}
          </div>
          {trainingPreview && (
            <div style={{ ...TYPOGRAPHY.secondary, margin: '4px 0' }}>
              <div>{`After training: Skill ${trainingPreview.skill}/10 · Morale ${Math.round(trainingPreview.morale)}%`}</div>
              <div>{`Carry capacity: ${trainingPreview.carryBefore} → ${trainingPreview.carryAfter} items`}</div>
              <div>{`${trainingPreview.rateLabel}: ${trainingPreview.rateBefore.toFixed(2)}× → ${trainingPreview.rateAfter.toFixed(2)}×`}</div>
              {trainingPreview.unlocks.length > 0 && (
                <ul aria-label="Skill unlocks" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {trainingPreview.unlocks.map(unlock => <li key={unlock}>{unlock}</li>)}
                </ul>
              )}
            </div>
          )}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {editingId === s.id ? (
              <>
                <button type="button" onClick={() => saveRename(s.id)} disabled={decisionPending || !editingName.trim()}
                  style={{ ...smallBtn, opacity: decisionPending || !editingName.trim() ? 0.5 : 1 }}>
                  Save
                </button>
                <button type="button" onClick={cancelRename} style={smallBtn}>Cancel</button>
              </>
            ) : (
              <button type="button" onClick={() => startRename(s)} disabled={decisionPending}
                style={{ ...smallBtn, opacity: decisionPending ? 0.5 : 1 }}>Rename</button>
            )}
            <button type="button" onClick={() => handleTrain(s.id, trainingCost)} disabled={trainingDisabled}
              aria-describedby={trainingReason ? trainingDescriptionId : undefined}
              style={{ ...smallBtn, opacity: trainingDisabled ? 0.5 : 1 }}>
              Train ({trainingCost == null ? 'Unavailable' : `$${trainingCost}`})
            </button>
            <button type="button" onClick={() => handleBonus(s.id)} disabled={bonusDisabled}
              aria-describedby={bonusDescriptionId}
              style={{ ...smallBtn, opacity: bonusDisabled ? 0.5 : 1 }}>
              {`Bonus ($${STAFF_BONUS_COST})`}
            </button>
            <StaffFireButton worker={s} onConfirm={id => {
              dispatch({ type: 'FIRE_STAFF', id });
              // The fired row unmounts; keep focus on the stable Hire control.
              hireButtonRef.current?.focus();
            }}
              style={{ ...smallBtn, background: '#633', borderColor: '#844', color: '#d44' }}>
              Fire
            </StaffFireButton>
            <button
              type="button"
              onClick={() => locateHandler?.(s.id)}
              disabled={locateUnavailable}
              aria-label={`Locate ${s.name}`}
              style={{ ...smallBtn, opacity: locateUnavailable ? 0.5 : 1 }}
            >
              Locate
            </button>
          </div>
          {trainingReason && (
            <p id={trainingDescriptionId} style={{ ...TYPOGRAPHY.secondary, color: '#f2d08a', margin: '4px 0 0', overflowWrap: 'anywhere' }}>
              {trainingReason}
            </p>
          )}
          <div id={bonusDescriptionId} style={{ ...TYPOGRAPHY.secondary, color: '#8fa4c8', marginTop: 4 }}>
            {bonus && <div>{`After bonus: morale ${Math.round(bonus.morale)}%.`}</div>}
            <div>One-time payment. Daily salary stays unchanged.</div>
            {bonusReason && <div style={{ color: '#f2d08a' }}>{bonusReason}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              aria-label={`${scheduleEditorOpen ? 'Hide' : 'Edit'} schedule for ${s.name}`}
              aria-expanded={scheduleEditorOpen}
              disabled={decisionPending}
              onClick={() => {
                if (decisionRef.current) return;
                if (scheduleEditorOpen) cancelSchedule(s.id);
                else startScheduleEdit(s);
              }}
              style={{
                ...smallBtn, background: '#253b59', color: '#dbe9ff',
                cursor: decisionPending ? 'not-allowed' : 'pointer',
                opacity: decisionPending ? 0.5 : 1,
              }}
            >
              {scheduleEditorOpen ? 'Hide schedule' : 'Edit schedule'}
            </button>
          </div>
          {scheduleEditorOpen && (
            <StaffScheduleEditor
              staff={s}
              staffList={staff}
              schedule={scheduleDraft || getStaffSchedule(s)}
              openHour={state.restaurant?.openHour}
              closeHour={state.restaurant?.closeHour}
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
