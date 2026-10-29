import { useId, useState } from 'react';
import { useDispatch, useGameState } from '../state/GameContext';
import { isCareerDecisionPending } from '../simulation/careerRun';
import { isServiceEligible } from '../simulation/cashiers';
import { prepareCashierAssignment } from '../simulation/cashierAssignment';
import { TYPOGRAPHY } from '../typography';

const UNASSIGNED_VALUE = 'unassigned';

function validIdentity(value) {
  return (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value));
}

function identityToken(value) {
  return `${typeof value}:${String(value)}`;
}

function reasonMessage(reason) {
  switch (reason) {
    case 'station-busy':
      return 'A checkout is using this cashier; wait until it finishes before changing the assignment.';
    case 'waiter-unavailable':
      return 'This waiter is not currently eligible for cashier duty.';
    case 'duplicate-staff-id':
      return 'This waiter has an ambiguous identity and cannot be assigned.';
    case 'staff-not-found':
      return 'This waiter is no longer available.';
    case 'station-not-found':
    case 'invalid-station-id':
      return 'This cashier station is no longer available.';
    case 'invalid-station-identities':
      return 'Cashier station identities are invalid.';
    default:
      return 'This cashier assignment is unavailable.';
  }
}

export default function CashierAssignments() {
  const state = useGameState();
  const dispatch = useDispatch();
  const sectionId = useId();
  const [drafts, setDrafts] = useState({});
  const decisionPending = isCareerDecisionPending(state);
  const stations = Array.isArray(state.cashierStations) ? state.cashierStations : [];
  const staff = Array.isArray(state.staff) ? state.staff : [];
  const now = Number.isFinite(state.restaurant?.gameTime) ? state.restaurant.gameTime : 0;
  const eligibleWaiters = staff.filter(worker => validIdentity(worker?.id)
    && staff.filter(candidate => candidate?.id === worker.id).length === 1
    && isServiceEligible(worker, now));

  if (stations.length === 0) return null;

  return (
    <section aria-labelledby={`${sectionId}-heading`} style={{
      background: '#1a1a2e', borderRadius: 8, padding: 12, margin: '12px 0',
      border: '1px solid #0f3460',
    }}>
      <h4 id={`${sectionId}-heading`} style={{ ...TYPOGRAPHY.subheading, margin: '0 0 6px' }}>
        Cashier assignments
      </h4>
      <p style={{ ...TYPOGRAPHY.secondary, color: '#8fa4c8', margin: '0 0 10px' }}>
        These are temporary duty assignments, not staff preferences. They may clear when a waiter
        becomes unavailable; changing an assignment never interrupts an active payment.
      </p>
      {decisionPending && (
        <p role="status" style={{ ...TYPOGRAPHY.secondary, color: '#f2d08a', margin: '0 0 10px' }}>
          Resolve the career decision before changing cashier assignments.
        </p>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {stations.map((station, index) => {
          const stationIdentity = validIdentity(station?.id)
            ? identityToken(station.id) : `invalid:${index}`;
          const draftKey = `${stationIdentity}:${index}`;
          const currentStaffId = station?.assignedStaffId ?? null;
          const draft = drafts[draftKey];
          const draftIsCurrent = draft?.baseStaffId === currentStaffId;
          const selectedStaffId = draftIsCurrent ? draft.staffId : currentStaffId;
          const selectedToken = selectedStaffId === null
            ? UNASSIGNED_VALUE : `waiter:${identityToken(selectedStaffId)}`;
          const currentStaffToken = currentStaffId === null
            ? null : `waiter:${identityToken(currentStaffId)}`;
          const currentWorker = currentStaffId === null
            ? null : staff.find(worker => worker?.id === currentStaffId);
          const currentWorkerEligible = currentWorker != null
            && staff.filter(worker => worker?.id === currentStaffId).length === 1
            && isServiceEligible(currentWorker, now);
          const eligibleTokens = new Set(eligibleWaiters.map(worker =>
            `waiter:${identityToken(worker.id)}`));
          const hasSelectedOption = selectedStaffId === null || eligibleTokens.has(selectedToken);
          const staleWorker = selectedStaffId !== null
            ? staff.find(worker => worker?.id === selectedStaffId) : null;
          const clearResult = prepareCashierAssignment(state, station.id, null);
          const assignmentResult = prepareCashierAssignment(state, station.id, selectedStaffId);
          const changed = selectedStaffId !== currentStaffId;
          const stationLabel = `station ${String(station.id ?? index + 1)}`;
          const selectId = `${sectionId}-select-${index}`;
          const message = !assignmentResult.ok
            ? reasonMessage(assignmentResult.reason) : '';

          const handleChange = event => {
            const value = event.target.value;
            const nextStaffId = value === UNASSIGNED_VALUE
              ? null
              : eligibleWaiters.find(worker => `waiter:${identityToken(worker.id)}` === value)?.id;
            if (nextStaffId === undefined) return;
            setDrafts(current => ({
              ...current,
              [draftKey]: { baseStaffId: currentStaffId, staffId: nextStaffId },
            }));
          };

          const apply = () => {
            const prepared = prepareCashierAssignment(state, station.id, selectedStaffId);
            if (!prepared.ok) return;
            dispatch({ type: 'ASSIGN_CASHIER', stationId: station.id, staffId: selectedStaffId });
            setDrafts(current => {
              const next = { ...current };
              delete next[draftKey];
              return next;
            });
          };

          return (
            <div key={draftKey} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'end' }}>
              <div>
                <label htmlFor={selectId} style={{ ...TYPOGRAPHY.secondary, display: 'block', marginBottom: 4 }}>
                  {`Cashier ${stationLabel}`}
                </label>
                <select
                  id={selectId}
                  aria-label={`Cashier assignment for ${stationLabel}`}
                  value={selectedToken}
                  onChange={handleChange}
                  disabled={decisionPending}
                  style={{ ...TYPOGRAPHY.control, width: '100%', minHeight: 32, background: '#111', color: '#eee' }}
                >
                  <option value={UNASSIGNED_VALUE} disabled={decisionPending || !clearResult.ok}>
                    Unassigned
                  </option>
                  {selectedStaffId !== null && !hasSelectedOption && (
                    <option value={selectedToken} disabled>
                      {`${staleWorker?.name || String(selectedStaffId)}${selectedStaffId === currentStaffId
                        ? ' (currently assigned, unavailable)' : ' (currently unavailable)'}`}
                    </option>
                  )}
                  {eligibleWaiters.map(worker => {
                    const token = `waiter:${identityToken(worker.id)}`;
                    const result = prepareCashierAssignment(state, station.id, worker.id);
                    const label = worker.name || String(worker.id);
                    return (
                      <option key={token} value={token} disabled={decisionPending || !result.ok}>
                        {label}
                      </option>
                    );
                  })}
                  {currentStaffId !== null && selectedStaffId !== currentStaffId
                    && !currentWorkerEligible && (
                    <option value={currentStaffToken} disabled>
                      {`${currentWorker?.name || String(currentStaffId)} (currently assigned, unavailable)`}
                    </option>
                  )}
                </select>
                {message && (
                  <p role="alert" style={{ ...TYPOGRAPHY.secondary, color: '#f2d08a', margin: '4px 0 0' }}>
                    {message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={apply}
                disabled={decisionPending || !assignmentResult.ok || !changed}
                style={{
                  ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555',
                  padding: '5px 10px', borderRadius: 4,
                  cursor: decisionPending || !assignmentResult.ok || !changed ? 'not-allowed' : 'pointer',
                  opacity: decisionPending || !assignmentResult.ok || !changed ? 0.5 : 1,
                }}
              >
                {`Apply ${stationLabel} assignment`}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
