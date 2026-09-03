import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { DRINKS, getResolvedDrink } from '../data/drinks';
import { estimateMenuItemDemand } from '../simulation/menuEconomy';
import RecipeCreator from './RecipeCreator';

export default function MenuPanel() {
  const state = useGameState();
  const dispatch = useDispatch();
  const [showCreator, setShowCreator] = useState(false);
  const unlockedDrinkIds = state.unlockedDrinkIds || [];

  if (showCreator) {
    return <RecipeCreator onClose={() => setShowCreator(false)} />;
  }

  return (
    <div style={{ color: '#ccc', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingRight: 40 }}>
        <h3 style={{ color: '#f0a500', margin: 0 }}>Menu</h3>
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
        <article key={dish.id} aria-label={`${dish.name} menu item`} style={{
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
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            <span>Estimated demand: {estimateMenuItemDemand(state, 'dish', dish.id)}%</span>
          </div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            <span>Popularity: {dish.popularity}%</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" value={dish.price} min={1} max={100} step={1}
              aria-label={`${dish.name} price`}
              onChange={e => dispatch({ type: 'UPDATE_DISH', id: dish.id, changes: { price: Number(e.target.value) } })}
              style={{ background: '#111', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, width: 80 }}
              title="Edit price"
            />
            <button
              aria-label={`Upgrade ${dish.name} quality ($50)`}
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
        </article>
      ))}

      <h4 style={{ color: '#f0a500', margin: '16px 0 8px' }}>Drinks</h4>
      {DRINKS.map(drink => {
        const unlocked = unlockedDrinkIds.includes(drink.id);
        const resolvedDrink = unlocked ? getResolvedDrink(state, drink.id) : null;

        return (
          <article key={drink.id} aria-label={`${drink.name} menu item`} style={{
            background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 8,
            border: '1px solid #0f3460',
          }}>
            {resolvedDrink ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>{resolvedDrink.name}</strong>
                  <span style={{ color: '#f0a500' }}>
                    ${resolvedDrink.price} · {resolvedDrink.prepTime}s prep
                  </span>
                </div>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  <span>
                    Quality: {'█'.repeat(resolvedDrink.quality)}{'░'.repeat(10 - resolvedDrink.quality)} Lv.{resolvedDrink.quality}
                  </span>
                </div>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  <span>Estimated demand: {estimateMenuItemDemand(state, 'drink', resolvedDrink.id)}%</span>
                </div>
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  <span>Popularity: {resolvedDrink.popularity}%</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number" value={resolvedDrink.price} min={1} max={100} step={1}
                    aria-label={`${resolvedDrink.name} price`}
                    onChange={e => dispatch({
                      type: 'UPDATE_DRINK', id: resolvedDrink.id,
                      changes: { price: Number(e.target.value) },
                    })}
                    style={{ background: '#111', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, width: 80 }}
                  />
                  <button
                    aria-label={`Upgrade ${resolvedDrink.name} quality ($50)`}
                    onClick={() => dispatch({ type: 'UPGRADE_DRINK_QUALITY', id: resolvedDrink.id })}
                    disabled={resolvedDrink.quality >= 10 || state.restaurant.funds < 50}
                    style={{ background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                  >
                    + Quality ($50)
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{drink.name}</strong>
                <button
                  onClick={() => dispatch({ type: 'UNLOCK_DRINK', id: drink.id })}
                  disabled={state.restaurant.funds < drink.unlockCost}
                  style={{ background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                >
                  Unlock {drink.name} (${drink.unlockCost})
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
