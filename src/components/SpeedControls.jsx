import { useGameState, useDispatch } from '../state/GameContext';

const speeds = [1, 2, 4];

const btnStyle = {
  background: '#333', border: '1px solid #555', borderRadius: 4,
  color: '#ccc', padding: '4px 12px', cursor: 'pointer', fontSize: '13px',
};

export default function SpeedControls({ onFit }) {
  const state = useGameState();
  const dispatch = useDispatch();

  return (
    <div style={{
      display: 'flex', gap: 4, padding: '4px 16px', background: '#000000',
      borderTop: '1px solid #0f3460', justifyContent: 'center', alignItems: 'center',
    }}>
      <button
        onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })}
        style={btnStyle}
      >
        {state.paused ? '▶' : '⏸'}
      </button>
      {speeds.map(s => (
        <button
          key={s}
          onClick={() => dispatch({ type: 'SET_SPEED', speed: s })}
          style={{ ...btnStyle, background: state.speed === s ? '#f0a500' : '#333', color: state.speed === s ? '#111' : '#ccc' }}
        >
          {s}x
        </button>
      ))}
      <button onClick={onFit} style={btnStyle}>Fit</button>
    </div>
  );
}
