import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { BASES, METHODS, BASE_EQUIPMENT_MAP } from '../data/recipes';
import { TYPOGRAPHY } from '../typography';

const selectStyle = { ...TYPOGRAPHY.control, background: '#1a1a2e', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, marginLeft: 8 };
const inputStyle = { ...TYPOGRAPHY.body, background: '#1a1a2e', color: '#ccc', border: '1px solid #333', padding: '6px 8px', borderRadius: 4, width: '100%', marginTop: 4 };
const btnStyle = { ...TYPOGRAPHY.control, background: '#f0a500', color: '#111', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' };

export default function RecipeCreator({ onClose }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const [base, setBase] = useState(BASES[0]);
  const [method, setMethod] = useState(METHODS[0]);
  const [dishName, setDishName] = useState('');
  const [price, setPrice] = useState(5);
  const [error, setError] = useState('');

  const requiredEquipmentId = BASE_EQUIPMENT_MAP[method];
  const equipment = requiredEquipmentId
    ? state.equipment.find(e => e.id === requiredEquipmentId)
    : null;

  const numericPrice = Number(price);
  const validPrice = Number.isInteger(numericPrice) && numericPrice >= 1 && numericPrice <= 100;
  const canCreate = equipment?.owned && dishName.trim() && validPrice;

  const handleCreate = () => {
    if (!canCreate) {
      if (!equipment?.owned) setError(`You need to own a ${equipment?.name || 'required equipment'} first.`);
      else if (!validPrice) setError('Price must be a whole number from $1 to $100.');
      return;
    }

    const dish = {
      id: `dish-${Date.now()}`,
      name: dishName.trim() || `${method} ${base}`,
      base,
      method,
      price: numericPrice,
      prepTime: 120 + Math.floor(Math.random() * 120),
      quality: 1,
      popularity: 30 + Math.floor(Math.random() * 30),
      cuisine: 'generic',
      requiredEquipmentId,
      unlocked: true,
    };

    dispatch({ type: 'ADD_DISH', dish });
    onClose();
  };

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, marginBottom: 12, color: '#f0a500' }}>Create new dish</h3>

      {error && <p style={{ ...TYPOGRAPHY.secondary, color: '#d44', marginBottom: 8 }}>{error}</p>}

      <div style={{ marginBottom: 8 }}>
         <label style={TYPOGRAPHY.secondary}>Base ingredient:</label>
        <select value={base} onChange={e => setBase(e.target.value)} style={selectStyle}>
          {BASES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 8 }}>
         <label style={TYPOGRAPHY.secondary}>Cooking method:</label>
        <select value={method} onChange={e => setMethod(e.target.value)} style={selectStyle}>
          {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {equipment && (
           <span style={{ ...TYPOGRAPHY.secondary, marginLeft: 8, color: equipment.owned ? '#4a7' : '#d44' }}>
            Requires: {equipment.name} {equipment.owned ? '✓' : '✗'}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
         <label htmlFor="dish-name" style={TYPOGRAPHY.secondary}>Dish name:</label>
        <input
          id="dish-name"
          value={dishName}
          onChange={e => setDishName(e.target.value)}
          placeholder={`${method} ${base}`}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
         <label htmlFor="dish-price" style={TYPOGRAPHY.secondary}>Price: $</label>
        <input
          id="dish-price"
          type="number" value={price} min={1} max={100} step={1}
          onChange={e => setPrice(e.target.value)}
          style={{ ...inputStyle, width: 80, marginLeft: 4 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleCreate} disabled={!canCreate} style={{
          ...btnStyle, opacity: canCreate ? 1 : 0.5,
        }}>
          Create
        </button>
        <button onClick={onClose} style={{ ...btnStyle, background: '#444' }}>Cancel</button>
      </div>
    </div>
  );
}
