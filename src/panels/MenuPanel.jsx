import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { DRINKS, getResolvedDrink } from '../data/drinks';
import { estimateMenuItemDemand, getMenuAffordabilitySummary } from '../simulation/menuEconomy';
import { getResolvedDish } from '../simulation/cookbook';
import { TYPOGRAPHY } from '../typography';
import RecipeCreator from './RecipeCreator';
import CookbookPanel from './CookbookPanel';

function formatCoverage(share) {
  if (share === 0) return '0%';
  if (share === 1) return '100%';
  const rounded = (share * 100).toFixed(1);
  if (rounded === '0.0') return '<0.1%';
  if (rounded === '100.0') return '>99.9%';
  return `${rounded}%`;
}

export default function MenuPanel({ readOnly = false }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const [showCreator, setShowCreator] = useState(false);
  const [showCookbook, setShowCookbook] = useState(false);
  const unlockedDrinkIds = state.unlockedDrinkIds || [];
  const blocked = readOnly || state.careerRun?.needsDecision === true;
  const mutate = action => { if (!blocked) dispatch(action); };

  if (showCookbook) {
    return <CookbookPanel onClose={() => setShowCookbook(false)} readOnly={blocked} />;
  }
  if (showCreator && !blocked) {
    return <RecipeCreator onClose={() => setShowCreator(false)} />;
  }

  const affordability = getMenuAffordabilitySummary(state);

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingRight: 40 }}>
        <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: 0 }}>Menu</h3>
        <button onClick={() => setShowCookbook(true)} style={{ ...TYPOGRAPHY.control,
          background: '#333', color: '#ccc', border: '1px solid #555', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}>
          Cookbook
        </button>
        <button disabled={blocked} onClick={() => { if (!blocked) setShowCreator(true); }} style={{
          ...TYPOGRAPHY.control,
          background: '#f0a500', color: '#111', border: 'none',
          padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
        }}>
          + New dish
        </button>
      </div>
      {blocked && <p role="status" style={{ ...TYPOGRAPHY.secondary, color: '#f0a500' }}>Career decision pending — menu changes are unavailable. You can still browse.</p>}
      <p style={TYPOGRAPHY.secondary}>Cook seconds show base cooking work, not the complete wait time. Estimated demand is not a sales guarantee.</p>

      <section aria-label="Menu affordability">
        <h4 style={TYPOGRAPHY.subheading}>Menu affordability</h4>
        <p>Can afford an order containing a dish: {formatCoverage(affordability.dishShare)}</p>
        <p>Can afford any order, including drink-only: {formatCoverage(affordability.anyOrderShare)}</p>
        <p style={TYPOGRAPHY.secondary}>Price-only coverage for new walk-in guest budgets at current reputation, not existing guests or booked contracts. These overlapping percentages are not additive and do not predict purchases or service capacity. Item demand uses sampled budgets and preferences.</p>
      </section>

      {state.dishes.length === 0 && (
        <p style={{ ...TYPOGRAPHY.secondary, color: '#666' }}>No dishes yet. Create your first dish!</p>
      )}

      {state.dishes.map(dish => getResolvedDish(state, dish.id)).filter(Boolean).map(dish => (
        <article key={dish.id} aria-label={`${dish.name} menu item`} style={{
          background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 8,
          border: '1px solid #0f3460',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <strong style={TYPOGRAPHY.subheading}>{dish.name}</strong>
            <span style={{ color: '#f0a500' }}>${dish.price} · {dish.prepTime}s cook</span>
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
            {dish.cookbookId ? `Cookbook recipe · ${dish.masteryPerk
              ? `Signature: ${dish.masteryPerk === 'speed' ? 'Quick Service' : 'House Favourite'}`
              : 'No signature chosen'}` : 'Custom recipe'}
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
            <span>Quality: {'█'.repeat(dish.quality)}{'░'.repeat(10 - dish.quality)} Lv.{dish.quality}</span>
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
            <span>Estimated demand: {estimateMenuItemDemand(state, 'dish', dish.id)}%</span>
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 8 }}>
            <span>Popularity: {dish.popularity}%</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" value={dish.price} min={1} max={100} step={1}
              aria-label={`${dish.name} price`}
              disabled={blocked}
              onChange={e => mutate({ type: 'UPDATE_DISH', id: dish.id, changes: { price: Number(e.target.value) } })}
              style={{ ...TYPOGRAPHY.secondary, background: '#111', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, width: 80 }}
              title="Edit price"
            />
            <button
              aria-label={`Upgrade ${dish.name} quality ($50)`}
              onClick={() => mutate({ type: 'UPGRADE_DISH_QUALITY', id: dish.id })}
              disabled={blocked || dish.quality >= 10 || state.restaurant.funds < 50}
              style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
            >
              + Quality ($50)
            </button>
            <button
              disabled={blocked}
              onClick={() => mutate({ type: 'REMOVE_DISH', id: dish.id })}
              style={{ ...TYPOGRAPHY.control, background: '#633', color: '#d44', border: '1px solid #844', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
            >
              Remove
            </button>
          </div>
        </article>
      ))}

      <h4 style={{ ...TYPOGRAPHY.subheading, color: '#f0a500', margin: '16px 0 8px' }}>Drinks</h4>
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
                  <strong style={TYPOGRAPHY.subheading}>{resolvedDrink.name}</strong>
                  <span style={{ color: '#f0a500' }}>
                    ${resolvedDrink.price} · {resolvedDrink.prepTime}s prep
                  </span>
                </div>
                <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
                  <span>
                    Quality: {'█'.repeat(resolvedDrink.quality)}{'░'.repeat(10 - resolvedDrink.quality)} Lv.{resolvedDrink.quality}
                  </span>
                </div>
                <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
                  <span>Estimated demand: {estimateMenuItemDemand(state, 'drink', resolvedDrink.id)}%</span>
                </div>
                <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 8 }}>
                  <span>Popularity: {resolvedDrink.popularity}%</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number" value={resolvedDrink.price} min={1} max={100} step={1}
                    aria-label={`${resolvedDrink.name} price`}
                    disabled={blocked}
                    onChange={e => mutate({
                      type: 'UPDATE_DRINK', id: resolvedDrink.id,
                      changes: { price: Number(e.target.value) },
                    })}
                    style={{ ...TYPOGRAPHY.secondary, background: '#111', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, width: 80 }}
                  />
                  <button
                    aria-label={`Upgrade ${resolvedDrink.name} quality ($50)`}
                    onClick={() => mutate({ type: 'UPGRADE_DRINK_QUALITY', id: resolvedDrink.id })}
                    disabled={blocked || resolvedDrink.quality >= 10 || state.restaurant.funds < 50}
                    style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    + Quality ($50)
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={TYPOGRAPHY.subheading}>{drink.name}</strong>
                  <button
                    onClick={() => mutate({ type: 'UNLOCK_DRINK', id: drink.id })}
                    disabled={blocked || state.restaurant.funds < drink.unlockCost}
                    style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Unlock {drink.name} (${drink.unlockCost})
                  </button>
                </div>
                <div style={{ ...TYPOGRAPHY.secondary, marginTop: 4 }}>
                  Price: ${drink.price} · Base prep: {drink.prepTime}s · Popularity: {drink.popularity}%
                </div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
