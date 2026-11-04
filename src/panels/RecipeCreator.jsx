import { useEffect, useId, useRef, useState } from 'react';
import { TYPOGRAPHY } from '../typography';

const inputStyle = { ...TYPOGRAPHY.body, background: '#1a1a2e', color: '#ccc', border: '1px solid #333',
  padding: '6px 8px', borderRadius: 4, width: '100%', marginTop: 4 };
const btnStyle = { ...TYPOGRAPHY.control, background: '#444', color: '#ccc', border: '1px solid #555',
  padding: '8px 16px', borderRadius: 4, cursor: 'pointer' };
const messageStyle = { ...TYPOGRAPHY.secondary, color: '#d44', marginTop: 4 };

function dishSnapshot(dish) {
  return JSON.stringify([
    dish?.id, dish?.cookbookId, dish?.name, dish?.base, dish?.method, dish?.cuisine,
    dish?.requiredEquipmentId, dish?.prepTime, dish?.popularity,
  ]);
}

export default function RecipeCreator({ dish, disabled = false, onCommit, onCancel }) {
  const id = useId();
  const inputId = `${id}-name`;
  const errorId = `${id}-name-error`;
  const authoritativeName = typeof dish?.name === 'string' ? dish.name : '';
  const snapshot = dishSnapshot(dish);
  const [draft, setDraft] = useState(authoritativeName);
  const dirty = useRef(false);
  const baseSnapshot = useRef(snapshot);
  const baseName = useRef(authoritativeName);
  const baseDisabled = useRef(disabled);
  const invalidName = draft.trim().length === 0;

  useEffect(() => {
    baseSnapshot.current = snapshot;
    baseName.current = authoritativeName;
    baseDisabled.current = disabled;
    dirty.current = false;
    setDraft(authoritativeName);
  }, [snapshot, authoritativeName, disabled]);

  const commit = () => {
    if (disabled || !dish || !dirty.current) return;
    if (baseSnapshot.current !== snapshot || baseName.current !== authoritativeName
      || baseDisabled.current !== disabled) {
      dirty.current = false;
      setDraft(authoritativeName);
      return;
    }
    const name = draft.trim();
    if (!name) return;
    dirty.current = false;
    setDraft(name);
    if (name !== authoritativeName) onCommit(name);
  };

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, marginBottom: 12, color: '#f0a500' }}>Edit recipe name</h3>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor={inputId} style={TYPOGRAPHY.secondary}>Dish name</label>
        <input
          autoFocus
          id={inputId}
          value={draft}
          onChange={event => {
            dirty.current = true;
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              dirty.current = false;
              setDraft(authoritativeName);
            }
          }}
          required
          disabled={disabled}
          style={inputStyle}
          aria-invalid={invalidName}
          aria-describedby={invalidName ? errorId : undefined}
        />
        {invalidName && <p id={errorId} style={messageStyle}>Enter a dish name.</p>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={onCancel} style={btnStyle}>
          Cancel
        </button>
      </div>
    </div>
  );
}
