import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { getNameGender } from '../canvas/characterAppearance';

const ROLES = ['cook', 'waiter'];
const NAMES = ['Marco', 'Anna', 'Luca', 'Sofia', 'Giovanni', 'Isabella', 'Mario', 'Elena'];

const smallBtn = {
  background: '#333', color: '#ccc', border: '1px solid #555',
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
};

export default function StaffPanel() {
  const state = useGameState();
  const dispatch = useDispatch();
  const [showHire, setShowHire] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const staffFull = state.staff.length >= state.staffSlots;
  const canAffordAnyRole = state.restaurant.funds >= 150;

  const handleHire = (role) => {
    const usedNames = new Set(state.staff.map(staff => staff.name.toLowerCase()));
    const availableNames = NAMES.filter(name => !usedNames.has(name.toLowerCase()));
    const namePool = availableNames.length > 0 ? availableNames : NAMES;
    const name = namePool[Math.floor(Math.random() * namePool.length)];
    const skill = 1 + Math.floor(Math.random() * 3);
    const salary = role === 'cook' ? 200 : 150;
    if (staffFull || state.restaurant.funds < salary) return;
    dispatch({
      type: 'HIRE_STAFF',
      staff: {
        id: `staff-${Date.now()}`,
        name,
        gender: getNameGender(name),
        role,
        skill,
        morale: 80,
        salary,
      },
    });
    setShowHire(false);
  };

  const startRename = (staff) => {
    setEditingId(staff.id);
    setEditingName(staff.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveRename = (id) => {
    const name = editingName.trim();
    if (!name) return;
    dispatch({ type: 'RENAME_STAFF', id, name });
    cancelRename();
  };

  return (
    <div style={{ color: '#ccc', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ color: '#f0a500', margin: 0 }}>Staff ({state.staff.length}/{state.staffSlots})</h3>
        <button onClick={() => setShowHire(!showHire)} disabled={staffFull || !canAffordAnyRole} style={{
          background: '#f0a500', color: '#111', border: 'none',
          padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
        }}>
          + Hire
        </button>
      </div>

      {showHire && (
        <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <h4 style={{ marginBottom: 8 }}>Hire Staff</h4>
          {ROLES.map(role => (
            <button key={role} onClick={() => handleHire(role)}
              disabled={staffFull || state.restaurant.funds < (role === 'cook' ? 200 : 150)} style={{
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
            {editingId === s.id ? (
              <input
                aria-label={`Rename ${s.name}`}
                value={editingName}
                onChange={event => setEditingName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') saveRename(s.id);
                  if (event.key === 'Escape') cancelRename();
                }}
                autoFocus
                style={{ background: '#111', color: '#ccc', border: '1px solid #555', borderRadius: 4, padding: '3px 6px' }}
              />
            ) : (
              <strong>{s.name}</strong>
            )}
            <span style={{ color: '#888' }}>{s.role} · ${s.salary}/day</span>
          </div>
          <div style={{ fontSize: 12, margin: '4px 0' }}>
            Skill: {'█'.repeat(s.skill)}{'░'.repeat(10 - s.skill)}
            <span style={{ marginLeft: 16 }}>Morale: {Math.round(s.morale)}%</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {editingId === s.id ? (
              <>
                <button onClick={() => saveRename(s.id)} disabled={!editingName.trim()} style={{ ...smallBtn, opacity: editingName.trim() ? 1 : 0.5 }}>
                  Save
                </button>
                <button onClick={cancelRename} style={smallBtn}>Cancel</button>
              </>
            ) : (
              <button onClick={() => startRename(s)} style={smallBtn}>Rename</button>
            )}
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
