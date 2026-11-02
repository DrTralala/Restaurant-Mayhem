import { useEffect, useId, useState } from 'react';
import { TYPOGRAPHY } from '../typography';

export function parseMenuSalesThresholdDraft(draft) {
  if (typeof draft !== 'string' || !/^\d+$/.test(draft)) return null;
  const value = Number(draft);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export default function MenuSalesThresholdInput({
  name, threshold, reached = false, disabled = false, onApply, onClear,
}) {
  const inputId = useId();
  const errorId = useId();
  const savedDraft = threshold == null ? '' : String(threshold);
  const [draft, setDraft] = useState(savedDraft);
  const [edited, setEdited] = useState(false);
  const parsedDraft = parseMenuSalesThresholdDraft(draft);
  const invalid = edited && parsedDraft === null;

  useEffect(() => {
    setDraft(savedDraft);
    setEdited(false);
  }, [savedDraft]);

  const apply = () => {
    if (disabled || parsedDraft === null) return;
    onApply?.(parsedDraft);
    setDraft(String(parsedDraft));
    setEdited(false);
  };

  const clear = () => {
    if (disabled) return;
    onClear?.();
    setDraft('');
    setEdited(false);
  };

  return (
    <div role="group" aria-label={`${name} paid-sales threshold controls`} style={{ marginTop: 8 }}>
      <label htmlFor={inputId} style={{ ...TYPOGRAPHY.secondary, display: 'block', marginBottom: 4 }}>
        Daily paid-sales threshold
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={draft}
          aria-label={`Daily paid-sales threshold for ${name}`}
          aria-invalid={invalid}
          {...(invalid ? { 'aria-describedby': errorId } : {})}
          disabled={disabled}
          onChange={event => {
            setDraft(event.target.value);
            setEdited(true);
          }}
          style={{ ...TYPOGRAPHY.secondary, background: '#111', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, width: 100 }}
        />
        <button
          type="button"
          aria-label={`Apply ${name} daily paid-sales threshold`}
          disabled={disabled || parsedDraft === null}
          onClick={apply}
          style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
        >
          Apply threshold
        </button>
        <button
          type="button"
          aria-label={`Clear ${name} daily paid-sales threshold`}
          disabled={disabled}
          onClick={clear}
          style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
        >
          Clear threshold
        </button>
      </div>
      {invalid && (
        <div id={errorId} role="alert" style={{ ...TYPOGRAPHY.secondary, color: '#f0a500', marginTop: 4 }}>
          Enter a positive whole number of paid sales.
        </div>
      )}
      {reached && (
        <div role="status" style={{ ...TYPOGRAPHY.secondary, color: '#f0a500', marginTop: 4 }}>
          Paid-sales threshold reached for walk-ins
        </div>
      )}
    </div>
  );
}
