import { useId, useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { BASES, METHODS, BASE_EQUIPMENT_MAP, CUSTOM_RECIPE_STATS } from '../data/recipes';
import { TYPOGRAPHY } from '../typography';

const selectStyle = { ...TYPOGRAPHY.control, background: '#1a1a2e', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, marginLeft: 8 };
const inputStyle = { ...TYPOGRAPHY.body, background: '#1a1a2e', color: '#ccc', border: '1px solid #333', padding: '6px 8px', borderRadius: 4, width: '100%', marginTop: 4 };
const btnStyle = { ...TYPOGRAPHY.control, background: '#f0a500', color: '#111', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' };
const messageStyle = { ...TYPOGRAPHY.secondary, color: '#d44', marginTop: 4 };

export default function RecipeCreator({ onClose }) {
  const idPrefix = useId();
  const state = useGameState();
  const dispatch = useDispatch();
  const [base, setBase] = useState(BASES[0]);
  const [method, setMethod] = useState(METHODS[0]);
  const [dishName, setDishName] = useState('');
  const [price, setPrice] = useState(5);

  const baseId = `${idPrefix}-base`;
  const methodId = `${idPrefix}-method`;
  const equipmentGuidanceId = `${idPrefix}-equipment-guidance`;
  const nameId = `${idPrefix}-name`;
  const nameErrorId = `${idPrefix}-name-error`;
  const priceId = `${idPrefix}-price`;
  const priceErrorId = `${idPrefix}-price-error`;
  const customStatsDescriptionId = `${idPrefix}-custom-stats`;

  const requiredEquipmentId = BASE_EQUIPMENT_MAP[method];
  const equipment = requiredEquipmentId
    ? state.equipment.find(e => e.id === requiredEquipmentId)
    : null;

  const numericPrice = Number(price);
  const validPrice = Number.isInteger(numericPrice) && numericPrice >= 1 && numericPrice <= 100;
  const nameError = !dishName.trim();
  const canCreate = equipment?.owned && dishName.trim() && validPrice;

  const handleCreate = () => {
    if (!canCreate) return;

    const dish = {
      id: `dish-${Date.now()}`,
      name: dishName.trim(),
      base,
      method,
      price: numericPrice,
      prepTime: CUSTOM_RECIPE_STATS.prepTime.min + Math.floor(Math.random() * (CUSTOM_RECIPE_STATS.prepTime.max - CUSTOM_RECIPE_STATS.prepTime.min + 1)),
      quality: 1,
      popularity: CUSTOM_RECIPE_STATS.popularity.min + Math.floor(Math.random() * (CUSTOM_RECIPE_STATS.popularity.max - CUSTOM_RECIPE_STATS.popularity.min + 1)),
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

      <div style={{ marginBottom: 8 }}>
        <label htmlFor={baseId} style={TYPOGRAPHY.secondary}>Base ingredient:</label>
        <select id={baseId} value={base} onChange={e => setBase(e.target.value)} style={selectStyle}>
          {BASES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor={methodId} style={TYPOGRAPHY.secondary}>Cooking method:</label>
        <select
          id={methodId}
          value={method}
          onChange={e => setMethod(e.target.value)}
          style={selectStyle}
          aria-describedby={equipmentGuidanceId}
          aria-invalid={!equipment?.owned}
        >
          {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <p id={equipmentGuidanceId} style={{ ...TYPOGRAPHY.secondary, marginTop: 4, color: equipment?.owned ? '#4a7' : '#d44' }}>
          {equipment?.owned
            ? `Requires: ${equipment.name} (owned)`
            : `You need to own ${equipment?.name || 'the required equipment'} first.`}
        </p>
      </div>

      <div style={{ marginBottom: 8 }}>
         <label htmlFor={nameId} style={TYPOGRAPHY.secondary}>Dish name:</label>
        <input
          id={nameId}
          value={dishName}
          onChange={e => setDishName(e.target.value)}
          placeholder="Enter a dish name"
          required
          style={inputStyle}
          aria-invalid={nameError}
          aria-describedby={nameError ? nameErrorId : undefined}
        />
        {nameError && <p id={nameErrorId} style={messageStyle}>Enter a dish name.</p>}
      </div>

      <div style={{ marginBottom: 12 }}>
         <label htmlFor={priceId} style={TYPOGRAPHY.secondary}>Price: $</label>
        <input
          id={priceId}
          type="number" value={price} min={1} max={100} step={1}
          onChange={e => setPrice(e.target.value)}
          style={{ ...inputStyle, width: 80, marginLeft: 4 }}
          aria-invalid={!validPrice}
          aria-describedby={!validPrice ? priceErrorId : undefined}
        />
        {!validPrice && (
          <p id={priceErrorId} style={messageStyle}>Price must be a whole number from $1 to $100.</p>
        )}
      </div>

      <p id={customStatsDescriptionId} style={{ ...TYPOGRAPHY.secondary, marginBottom: 8 }}>
        {`Creation randomly assigns base prep work from ${CUSTOM_RECIPE_STATS.prepTime.min} to ${CUSTOM_RECIPE_STATS.prepTime.max} game seconds and base popularity from ${CUSTOM_RECIPE_STATS.popularity.min} to ${CUSTOM_RECIPE_STATS.popularity.max}. Actual preparation time and order demand depend on other factors.`}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleCreate} disabled={!canCreate} aria-describedby={customStatsDescriptionId} style={{
          ...btnStyle, opacity: canCreate ? 1 : 0.5,
        }}>
          Create
        </button>
        <button onClick={onClose} style={{ ...btnStyle, background: '#444' }}>Cancel</button>
      </div>
    </div>
  );
}
