import { useEffect } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { TYPOGRAPHY } from '../typography';
import { isCareerDecisionPending } from '../simulation/careerRun';

const speeds = [1, 2, 4];

const btnStyle = {
  ...TYPOGRAPHY.control,
  background: '#333', border: '1px solid #555', borderRadius: 4,
  color: '#ccc', padding: '4px 12px', cursor: 'pointer',
};

export default function SpeedControls({ onFit }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const decisionPending = isCareerDecisionPending(state);

  useEffect(() => {
    const onKeyDown = event => {
      if (decisionPending) return;
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (event.defaultPrevented || event.repeat || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target?.isContentEditable || target?.closest?.(
        'input, textarea, select, button, a[href], [role="button"], '
        + '[role="textbox"], [role="combobox"], [role="slider"], [contenteditable]:not([contenteditable="false"])',
      )) return;
      event.preventDefault();
      dispatch({ type: 'TOGGLE_PAUSE' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, decisionPending]);

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 16px', background: '#000000',
      borderTop: '1px solid #0f3460', justifyContent: 'center', alignItems: 'center',
    }}>
      <button
        disabled={decisionPending}
        onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })}
        aria-label={state.paused ? 'Resume game' : 'Pause game'}
        aria-keyshortcuts="Space"
        title="Toggle pause (Space)"
        style={btnStyle}
      >
        {state.paused ? '▶' : '⏸'}
      </button>
      {speeds.map(s => (
        <button
          key={s}
          disabled={decisionPending}
          onClick={() => dispatch({ type: 'SET_SPEED', speed: s })}
          style={{ ...btnStyle, background: state.speed === s ? '#f0a500' : '#333', color: state.speed === s ? '#111' : '#ccc' }}
        >
          {s}x
        </button>
      ))}
      <button onClick={onFit} style={btnStyle}>Fit</button>
      {decisionPending && <span style={TYPOGRAPHY.secondary}>Paused for Opening Week decision</span>}
    </div>
  );
}
