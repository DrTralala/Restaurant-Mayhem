import { useEffect, useId, useRef } from 'react';
import { TYPOGRAPHY } from '../typography';

const buttonStyle = {
  ...TYPOGRAPHY.control, background: '#16213e', color: '#ccc', border: '1px solid #0f3460',
  borderRadius: 4, padding: '8px 12px', cursor: 'pointer',
};

function criterionText(criterion) {
  if (criterion.id === 'paid-meals') {
    const missing = criterion.target - criterion.actual;
    return `Paid meals: ${criterion.actual} / ${criterion.target} — ${criterion.passed
      ? 'met' : `${missing} more ${missing === 1 ? 'was' : 'were'} needed`}`;
  }
  const rounded = criterion.actual.toFixed(2);
  const actual = !criterion.passed && Number(rounded) >= criterion.target
    ? String(criterion.actual) : rounded;
  return `Reputation: ${actual} / ${criterion.target.toFixed(2)} — ${criterion.passed
    ? 'met' : 'below target at the deadline'}`;
}

export default function CareerResultDialog({
  summary, onRetry, onStartNew, onContinue, onOpenSettings, blockedReason,
}) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const titleId = useId();
  const explanationId = useId();
  const open = summary?.needsDecision === true;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    headingRef.current?.focus();
    const containFocus = event => {
      if (!dialog.contains(event.target)) headingRef.current?.focus();
    };
    const onKeyDown = event => {
      // Keep game shortcuts out of the modal without preventing button activation.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !buttons.includes(current))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (current === last || !buttons.includes(current))) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('focusin', containFocus);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('focusin', containFocus);
      document.removeEventListener('keydown', onKeyDown);
      // Do not steal focus from Settings or a new session already focused by the parent.
      if (previousFocus?.isConnected
        && (dialog.contains(document.activeElement) || document.activeElement === document.body)) {
        previousFocus.focus();
      }
    };
  }, [open]);

  if (!open) return null;
  const invalid = summary.status === 'invalid';
  const title = invalid ? 'Opening Week progress cannot be verified'
    : summary.status === 'won' ? 'Opening Week complete' : 'Opening Week target missed';
  const retry = event => {
    const button = event.currentTarget;
    if (!window.confirm('Retry Opening Week? This replaces your current restaurant and its local autosave. '
      + 'No backup is created. Repository Save game is available only on the development server; '
      + 'if available, cancel and save first to keep a separate copy. '
      + 'This starts a fresh restaurant with zero career meals, unpaused at 1×. '
      + 'Arrivals and tips will differ. Cancel keeps this restaurant and result.')) {
      button.focus();
      return;
    }
    onRetry?.();
  };

  return (
    <div onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 180,
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, boxSizing: 'border-box' }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={explanationId} style={{
          ...TYPOGRAPHY.body, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto',
          overflowWrap: 'anywhere', background: '#16213e', border: '1px solid #0f3460',
          color: '#ccc', borderRadius: 12, padding: 20, boxSizing: 'border-box',
        }}>
        {blockedReason && <p style={{ color: '#f0a500', marginTop: 0 }}>
          After Continue, play is still stopped: {blockedReason}
        </p>}
        <h2 id={titleId} ref={headingRef} tabIndex={-1}
          style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginTop: 0 }}>{title}</h2>
        {invalid ? <p>
          This is not a win or loss. Continue this restaurant as sandbox, or start a new run.
        </p> : <>
          <p>{summary.status === 'won' ? 'Both targets were met at the deadline.'
            : 'One or both targets were not met at the deadline.'}</p>
          <ul aria-label="Opening Week results" style={{ paddingLeft: 20 }}>
            {summary.criteria.map(criterion => <li key={criterion.id}>{criterionText(criterion)}</li>)}
          </ul>
          <p>Evaluated: Day 8, 10:00 AM. Seven full days after Day 1, 10:00 AM.</p>
          <p>Debt and profit were not scored.</p>
        </>}
        <p>Continue keeps this restaurant and its frozen progress. It does not grant reward cash
          or clear another pause or technical stop.</p>
        <p id={explanationId}>An explicit choice is required. Escape or clicking outside will not resume play.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {invalid
            ? <button type="button" style={buttonStyle} onClick={() => onStartNew?.()}>Start new Opening Week</button>
            : <button type="button" style={buttonStyle} onClick={retry}>Retry Opening Week</button>}
          <button type="button" style={{ ...buttonStyle, background: '#f0a500', color: '#111' }}
            onClick={() => onContinue?.()}>Continue as sandbox</button>
          <button type="button" style={buttonStyle} onClick={() => onOpenSettings?.()}>Settings</button>
        </div>
      </section>
    </div>
  );
}
