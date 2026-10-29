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

function staffBaseLabel(worker) {
  return typeof worker?.name === 'string' && worker.name.trim().length > 0
    ? worker.name : String(worker?.id);
}

function staffDisplayLabels(staff) {
  const baseLabels = staff.map(staffBaseLabel);
  const baseLabelCounts = new Map();
  baseLabels.forEach(label => {
    baseLabelCounts.set(label, (baseLabelCounts.get(label) ?? 0) + 1);
  });

  return new Map(staff.map((worker, index) => {
    const baseLabel = baseLabels[index];
    const label = baseLabelCounts.get(baseLabel) > 1
      ? `${baseLabel} (${identityToken(worker?.id)})`
      : baseLabel;
    return [worker, label];
  }));
}

function normalizeOptionLabel(label) {
  return label.replace(/\s+/g, ' ').trim();
}

function uniqueOptionLabels(options) {
  const labelCounts = new Map();
  options.forEach(option => {
    const label = normalizeOptionLabel(option.label);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  });

  const reservedLabels = new Set(labelCounts.keys());
  const usedLabels = new Set();
  return options.map(option => {
    let label = option.label;
    if (labelCounts.get(normalizeOptionLabel(label)) > 1
      || usedLabels.has(normalizeOptionLabel(label))) {
      let attempt = 0;
      do {
        const suffix = attempt === 0
          ? option.disambiguator : `${option.disambiguator}; ${attempt}`;
        label = `${option.label} (${suffix})`;
        attempt += 1;
      } while (reservedLabels.has(normalizeOptionLabel(label))
        || usedLabels.has(normalizeOptionLabel(label)));
    }

    usedLabels.add(normalizeOptionLabel(label));
    return { ...option, label };
  });
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
  const displayLabels = staffDisplayLabels(staff);
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
          const staleWorkerLabel = displayLabels.get(staleWorker) ?? String(selectedStaffId);
          const currentWorkerLabel = displayLabels.get(currentWorker) ?? String(currentStaffId);
          const clearResult = prepareCashierAssignment(state, station.id, null);
          const assignmentResult = prepareCashierAssignment(state, station.id, selectedStaffId);
          const changed = selectedStaffId !== currentStaffId;
          const stationLabel = `station ${String(station.id ?? index + 1)}`;
          const selectId = `${sectionId}-select-${index}`;
          const message = !assignmentResult.ok
            ? reasonMessage(assignmentResult.reason) : '';
          const optionEntries = [{
            key: UNASSIGNED_VALUE,
            value: UNASSIGNED_VALUE,
            label: 'Unassigned',
            disabled: decisionPending || !clearResult.ok,
            disambiguator: 'unassigned',
          }];

          if (selectedStaffId !== null && !hasSelectedOption) {
            optionEntries.push({
              key: selectedToken,
              value: selectedToken,
              label: `${staleWorkerLabel}${selectedStaffId === currentStaffId
                ? ' (currently assigned, unavailable)' : ' (currently unavailable)'}`,
              disabled: true,
              disambiguator: identityToken(selectedStaffId),
            });
          }

          eligibleWaiters.forEach(worker => {
            const token = `waiter:${identityToken(worker.id)}`;
            const result = prepareCashierAssignment(state, station.id, worker.id);
            optionEntries.push({
              key: token,
              value: token,
              label: displayLabels.get(worker),
              disabled: decisionPending || !result.ok,
              disambiguator: identityToken(worker.id),
            });
          });

          if (currentStaffId !== null && selectedStaffId !== currentStaffId
            && !currentWorkerEligible) {
            optionEntries.push({
              key: currentStaffToken,
              value: currentStaffToken,
              label: `${currentWorkerLabel} (currently assigned, unavailable)`,
              disabled: true,
              disambiguator: identityToken(currentStaffId),
            });
          }

          const renderedOptions = uniqueOptionLabels(optionEntries);

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
                  {renderedOptions.map(option => (
                    <option key={option.key} value={option.value} disabled={option.disabled}>
                      {option.label}
                    </option>
                  ))}
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
