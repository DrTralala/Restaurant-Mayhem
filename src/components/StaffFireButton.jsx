import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { humaniseIdentifier, TYPOGRAPHY } from '../typography';
import { useGameGeneration, useGameState } from '../state/GameContext';
import { isCareerDecisionPending } from '../simulation/careerRun';

// Consent is bound to the raw worker id plus the visible identity (name, role)
// and the game generation. Ordinary tick-driven object replacement keeps the
// confirmation open; a changed identity, a new generation, a pending career
// decision, or a missing worker closes it. A replacement that re-issues the
// same id with the same visible identity and no new generation is not
// distinguishable without a new domain identity, so it is not claimed here.
const sameOpenedIdentity = (opened, worker) => worker != null
  && worker.id === opened.id
  && worker.name === opened.name
  && worker.role === opened.role;

export default function StaffFireButton({ worker, onConfirm, style, children }) {
  const state = useGameState();
  const generation = useGameGeneration();
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(null);
  const triggerRef = useRef(null);
  const workerRef = useRef(worker);
  const generationRef = useRef(generation);
  const decisionRef = useRef(false);

  const decisionPending = isCareerDecisionPending(state);

  // Latest committed values for the synchronous confirm guard; layout effects
  // run before the browser processes the next interaction.
  useLayoutEffect(() => {
    workerRef.current = worker;
    generationRef.current = generation;
    decisionRef.current = decisionPending;
  });

  useEffect(() => {
    if (!pending) return;
    const current = workerRef.current;
    if (!sameOpenedIdentity(pending, current)
      || generation !== pending.generation
      || decisionPending) {
      pendingRef.current = null;
      setPending(null);
    }
  }, [pending, worker, generation, decisionPending]);

  if (!worker) return null;

  const role = humaniseIdentifier(worker.role);

  const focusTrigger = () => {
    if (triggerRef.current?.isConnected) triggerRef.current.focus();
  };

  const closePending = () => {
    pendingRef.current = null;
    setPending(null);
    focusTrigger();
  };

  const openConfirmation = () => {
    if (pendingRef.current || decisionRef.current) return;
    const opened = {
      id: worker.id,
      name: worker.name,
      role: worker.role,
      generation,
    };
    pendingRef.current = opened;
    setPending(opened);
  };

  const handleConfirm = () => {
    const opened = pendingRef.current;
    if (!opened) return;
    // Clear before invoking the callback so a re-entrant activation cannot
    // confirm this consent twice.
    pendingRef.current = null;
    setPending(null);
    const current = workerRef.current;
    if (!sameOpenedIdentity(opened, current)
      || generationRef.current !== opened.generation
      || decisionRef.current) {
      focusTrigger();
      return;
    }
    // Success focus belongs to the caller: the removal it triggers may unmount
    // this trigger, so pulling focus back here would strand it on the way out.
    onConfirm?.(current.id);
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closePending();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Fire ${worker.name}`}
        disabled={decisionPending}
        onClick={openConfirmation}
        style={style}
      >
        {children}
      </button>
      {pending && (
        <section
          role="region"
          aria-label={`Fire ${worker.name}?`}
          onKeyDown={handleKeyDown}
          style={{
            ...TYPOGRAPHY.secondary,
            display: 'flex', flexDirection: 'column', gap: 6,
            maxWidth: '100%', padding: '8px 10px', borderRadius: 5,
            background: '#3b2025', border: '1px solid #844', color: '#f0b0b0',
          }}
        >
          <p style={{ margin: 0 }}>
            {`Fire ${worker.name} (${role})? This removes the employee and releases their assigned work. Hiring again does not restore this employee's training.`}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" autoFocus onClick={closePending} style={cancelButton}>
              Cancel
            </button>
            <button type="button" onClick={handleConfirm} style={confirmButton}>
              {`Confirm fire ${worker.name}`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

const cancelButton = {
  ...TYPOGRAPHY.control,
  background: '#333', color: '#ccc', border: '1px solid #555',
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
};

const confirmButton = {
  ...TYPOGRAPHY.control,
  background: '#633', color: '#f0b0b0', border: '1px solid #844',
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
};
