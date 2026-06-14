import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';

const ROLES = ['cook', 'waiter', 'host'];
const NAMES = ['Marco', 'Anna', 'Luca', 'Sofia', 'Giovanni', 'Isabella', 'Mario', 'Elena'];

const smallBtn = {
  background: '#333', color: '#ccc', border: '1px solid #555',
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
};

export default function StaffPanel() {
  const state = useGameState();
  const dispatch = useDispatch();
  const [showHire, setShowHire] = useState(false);

  const canHire = state.staff.length < state.staffSlots;

  const handleHire = (role) => {
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const skill = 1 + Math.floor(Math.random() * 3);
    const salary = role === 'cook' ? 200 : 150;
    dispatch({
      type: 'HIRE_STAFF',
      staff: {
        id: `staff-${Date.now()}`,
        name,
        role,
        skill,
        morale: 80,
        salary,
      },
    });
    setShowHire(false);
  };

  return (
    <div style={{ color: '#ccc', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ color: '#f0a500', margin: 0 }}>Staff ({state.staff.length}/{state.staffSlots})</h3>
        {canHire && (
          <button onClick={() => setShowHire(!showHire)} style={{
            background: '#f0a500', color: '#111', border: 'none',
            padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
          }}>
            + Hire
          </button>
        )}
      </div>

      {showHire && (
        <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <h4 style={{ marginBottom: 8 }}>Hire Staff</h4>
          {ROLES.map(role => (
            <button key={role} onClick={() => handleHire(role)} style={{
              background: '#333', color: '#ccc', border: '1px solid #555',
              padding: '8px 14px', borderRadius: 4, cursor: 'pointer', marginRight: 8, marginBottom: 4,
            }}>
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </button>
          ))}
        </div>
      )}

      {state.staff.map(s => (
        <div key={s.id} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 8, border: '1px solid #0f3460' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{s.name}</strong>
            <span style={{ color: '#888' }}>{s.role} · ${s.salary}/day</span>
          </div>
          <div style={{ fontSize: 12, margin: '4px 0' }}>
            Skill: {'█'.repeat(s.skill)}{'░'.repeat(10 - s.skill)}
            <span style={{ marginLeft: 16 }}>Morale: {s.morale}%</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={() => dispatch({ type: 'TRAIN_STAFF', id: s.id, cost: 100 })} disabled={s.skill >= 10 || state.restaurant.funds < 100}
              style={{ ...smallBtn, opacity: (s.skill >= 10 || state.restaurant.funds < 100) ? 0.5 : 1 }}>
              Train ($100)
            </button>
            <button onClick={() => dispatch({ type: 'GIVE_BONUS', id: s.id, cost: 50 })} disabled={state.restaurant.funds < 50}
              style={{ ...smallBtn, opacity: state.restaurant.funds < 50 ? 0.5 : 1 }}>
              Bonus ($50)
            </button>
            <button onClick={() => dispatch({ type: 'FIRE_STAFF', id: s.id })}
              style={{ ...smallBtn, background: '#633', borderColor: '#844', color: '#d44' }}>
              Fire
            </button>
          </div>
        </div>
      ))}

      {state.staff.length === 0 && (
        <p style={{ color: '#666' }}>No staff yet. Hire your first employee!</p>
      )}
    </div>
  );
}
