import { useEffect, useRef, useState } from 'react';
import { useDispatch, useGameState } from '../state/GameContext';
import { createInitialState } from '../state/initialState';
import { hydrateState } from '../state/persistence';
import { loadLatestRepositoryState, saveRepositoryState } from '../state/repositorySaves';
import { isSaveValidationError } from '../state/saveValidation';
import { TYPOGRAPHY } from '../typography';

const buttonStyle = {
  ...TYPOGRAPHY.control,
  width: '100%', background: '#16213e', border: '1px solid #0f3460',
  borderRadius: 4, color: '#ccc', padding: '8px 12px', cursor: 'pointer',
  textAlign: 'left',
};

function focusableActions(panel) {
  return [...panel.querySelectorAll('button:not(:disabled)')]
    .filter(button => button.tabIndex >= 0 && !button.closest('[hidden], [inert]'));
}

export default function SettingsMenu({ isOpen, onToggle, onClose, modal = false }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const [message, setMessage] = useState('');
  const panelRef = useRef(null);
  useEffect(() => {
    if (!isOpen) return undefined;
    const panel = panelRef.current;
    const focusFirst = () => (focusableActions(panel)[0] || panel).focus();
    focusFirst();
    if (!modal) return undefined;
    const containFocus = event => {
      if (!panel.contains(event.target)) focusFirst();
    };
    document.addEventListener('focusin', containFocus);
    // The parent restores the result's heading on close. Do not move focus
    // back to a stale trigger while that replacement dialog is mounting.
    return () => document.removeEventListener('focusin', containFocus);
  }, [isOpen, modal]);

  const handleKeyDown = event => {
    if (!modal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    // Read the enabled actions at the keypress, not when the panel opened.
    const actions = focusableActions(panel);
    const first = actions[0];
    const last = actions[actions.length - 1];
    const current = document.activeElement;
    if (!actions.includes(current) || (event.shiftKey ? current === first : current === last)) {
      event.preventDefault();
      (event.shiftKey ? last || panel : first || panel).focus();
    }
  };

  const handleSave = async () => {
    try {
      const { filename } = await saveRepositoryState(state);
      setMessage(`Saved as ${filename}`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handleLoad = async () => {
    const fresh = createInitialState();
    try {
      const { state: saved, filename } = await loadLatestRepositoryState();
      if (!saved || saved.version !== fresh.version) {
        setMessage('Saved game is incompatible');
        return;
      }
      dispatch({ type: 'LOAD_STATE', state: hydrateState(saved, fresh) });
      setMessage(`Loaded ${filename}`);
    } catch (error) {
      setMessage(isSaveValidationError(error) || error.message === 'Invalid saved navigation geometry'
        ? `Saved game is incompatible: ${error.message}`
        : error.message);
    }
  };

  const handleNewGame = () => {
    if (!window.confirm('Start a new sandbox? This replaces your current restaurant, any career and its local autosave. No backup is created. Cancel keeps this restaurant.')) return;
    localStorage.removeItem('restaurant-sim-save');
    dispatch({ type: 'LOAD_STATE', state: createInitialState() });
    onClose?.();
    setMessage('New game started');
  };

  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        onClick={onToggle}
        style={{
          ...TYPOGRAPHY.icon,
          position: 'fixed', top: 48, right: 16, zIndex: 100,
          background: isOpen ? '#f0a500' : '#16213e',
          border: '1px solid #0f3460', borderRadius: 8,
          color: isOpen ? '#111' : '#ccc',
          width: 44, height: 44, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ⚙
      </button>
      {isOpen && (
        <div ref={panelRef} role={modal ? 'dialog' : undefined}
          aria-modal={modal ? true : undefined} aria-label={modal ? 'Settings' : undefined}
          tabIndex={modal ? -1 : undefined} onKeyDown={handleKeyDown} style={{
          position: 'fixed', top: 100, right: 16, zIndex: 110,
          width: 180, padding: 10, display: 'grid', gap: 8,
          background: '#0d1528', border: '1px solid #0f3460', borderRadius: 8,
          boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
        }}>
          <button type="button" onClick={handleSave} style={buttonStyle}>Save game</button>
          <button type="button" onClick={handleLoad} style={buttonStyle}>Load game</button>
          <button
            type="button"
            onClick={handleNewGame}
            style={{ ...buttonStyle, color: '#e77', borderColor: '#844' }}
          >
            New game
          </button>
          {modal && <span style={TYPOGRAPHY.secondary}>Press Escape to return to the result.</span>}
          {message && (
            <div role="status" style={{ ...TYPOGRAPHY.secondary, color: '#f0a500' }}>
              {message}
            </div>
          )}
        </div>
      )}
    </>
  );
}
