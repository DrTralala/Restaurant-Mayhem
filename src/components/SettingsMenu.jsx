import { useState } from 'react';
import { useDispatch, useGameState } from '../state/GameContext';
import { createInitialState } from '../state/initialState';
import { hydrateState } from '../state/persistence';
import { loadLatestRepositoryState, saveRepositoryState } from '../state/repositorySaves';

const buttonStyle = {
  width: '100%', background: '#16213e', border: '1px solid #0f3460',
  borderRadius: 4, color: '#ccc', padding: '8px 12px', cursor: 'pointer',
  fontFamily: 'monospace', textAlign: 'left',
};

export default function SettingsMenu({ isOpen, onToggle, onClose }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const [message, setMessage] = useState('');

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
      if (saved.version !== fresh.version) {
        setMessage('Saved game is incompatible');
        return;
      }
      dispatch({ type: 'LOAD_STATE', state: hydrateState(saved, fresh) });
      setMessage(`Loaded ${filename}`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handleNewGame = () => {
    if (!window.confirm('Start a new game? All progress will be lost.')) return;
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
          position: 'fixed', top: 48, right: 68, zIndex: 100,
          background: isOpen ? '#f0a500' : '#16213e',
          border: '1px solid #0f3460', borderRadius: 8,
          color: isOpen ? '#111' : '#ccc', fontSize: 22,
          width: 44, height: 44, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ⚙
      </button>
      {isOpen && (
        <div style={{
          position: 'fixed', top: 100, right: 16, zIndex: 110,
          width: 180, padding: 10, display: 'grid', gap: 8,
          background: '#0d1528', border: '1px solid #0f3460', borderRadius: 8,
          boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
        }}>
          <button type="button" onClick={handleSave} style={buttonStyle}>Save Game</button>
          <button type="button" onClick={handleLoad} style={buttonStyle}>Load Game</button>
          <button
            type="button"
            onClick={handleNewGame}
            style={{ ...buttonStyle, color: '#e77', borderColor: '#844' }}
          >
            New Game
          </button>
          {message && (
            <div role="status" style={{ color: '#f0a500', font: '11px monospace' }}>
              {message}
            </div>
          )}
        </div>
      )}
    </>
  );
}
