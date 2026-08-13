import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import RecipeCreator from './RecipeCreator';

export default function MenuPanel() {
  const state = useGameState();
  const dispatch = useDispatch();
  const [showCreator, setShowCreator] = useState(false);

  if (showCreator) {
    return <RecipeCreator onClose={() => setShowCreator(false)} />;
  }

  return (
    <div style={{ color: '#ccc', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ color: '#f0a500', margin: 0 }}>Menu ({state.dishes.length}/{state.recipeSlots} slots)</h3>
        <button onClick={() => setShowCreator(true)} style={{
          background: '#f0a500', color: '#111', border: 'none',
          padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: '13px',
        }}>
          + New Dish
        </button>
      </div>

      {state.dishes.length === 0 && (
        <p style={{ color: '#666' }}>No dishes yet. Create your first dish!</p>
      )}

      {state.dishes.map(dish => (
        <div key={dish.id} style={{
          background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 8,
          border: '1px solid #0f3460',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <strong>{dish.name}</strong>
            <span style={{ color: '#f0a500' }}>${dish.price} · {dish.prepTime}s cook</span>
          </div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            <span>Quality: {'█'.repeat(dish.quality)}{'░'.repeat(10 - dish.quality)} Lv.{dish.quality}</span>
          </div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            <span>Popularity: {dish.popularity}%</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" value={dish.price} min={1} max={100}
              onChange={e => dispatch({ type: 'UPDATE_DISH', id: dish.id, changes: { price: Number(e.target.value) } })}
              style={{ background: '#111', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, width: 80 }}
              title="Edit price"
            />
            <button
              onClick={() => dispatch({ type: 'UPGRADE_DISH_QUALITY', id: dish.id })}
              disabled={dish.quality >= 10 || state.restaurant.funds < 50}
              style={{ background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
            >
              + Quality ($50)
            </button>
            <button
              onClick={() => dispatch({ type: 'REMOVE_DISH', id: dish.id })}
              style={{ background: '#633', color: '#d44', border: '1px solid #844', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
