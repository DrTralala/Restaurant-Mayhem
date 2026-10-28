import { useEffect, useRef, useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { DRINKS, getResolvedDrink } from '../data/drinks';
import { MENU_QUALITY_COST } from '../data/menuPricing';
import { estimateMenuDemand, getMenuAffordabilitySummary, hasAvailableWalkInMenu, isMenuItemSuspended } from '../simulation/menuEconomy';
import { getMenuSalesCount } from '../simulation/menuSales';
import { getResolvedDish } from '../simulation/cookbook';
import { TYPOGRAPHY } from '../typography';
import RecipeCreator from './RecipeCreator';
import CookbookPanel from './CookbookPanel';
import MenuPriceInput from './MenuPriceInput';

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
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const cookbookButtonRef = useRef(null);
  const unlockedDrinkIds = state.unlockedDrinkIds || [];
  const blocked = readOnly || state.careerRun?.needsDecision === true;
  const mutate = action => { if (!blocked) dispatch(action); };
  const canPay = cost => Number.isFinite(state.restaurant.funds)
    && Number.isFinite(cost) && cost >= 0 && state.restaurant.funds >= cost;

  useEffect(() => {
    if (!pendingRemoval) return;
    const current = (state.dishes || []).find(dish => dish.id === pendingRemoval.id);
    if (blocked || !current || current !== pendingRemoval.dish) setPendingRemoval(null);
  }, [state.dishes, blocked, pendingRemoval]);

  const cancelRemoval = () => {
    const trigger = pendingRemoval?.trigger;
    setPendingRemoval(null);
    if (trigger && trigger.isConnected) trigger.focus();
  };

  const confirmRemoval = () => {
    const pending = pendingRemoval;
    setPendingRemoval(null);
    if (!pending || blocked) return;
    const current = (state.dishes || []).find(dish => dish.id === pending.id);
    if (!current || current !== pending.dish) return;
    mutate({ type: 'REMOVE_DISH', id: pending.id });
    cookbookButtonRef.current?.focus();
  };

  const handleRemovalKeyDown = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancelRemoval();
  };

  if (showCookbook) {
    return <CookbookPanel onClose={() => setShowCookbook(false)} readOnly={blocked} />;
  }
  if (showCreator && !blocked) {
    return <RecipeCreator onClose={() => setShowCreator(false)} />;
  }

  const affordability = getMenuAffordabilitySummary(state);
  const demand = estimateMenuDemand(state);
  const hasWalkInMenu = hasAvailableWalkInMenu(state);

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingRight: 40 }}>
        <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: 0 }}>Menu</h3>
        <button ref={cookbookButtonRef} onClick={() => { setPendingRemoval(null); setShowCookbook(true); }} style={{ ...TYPOGRAPHY.control,
          background: '#333', color: '#ccc', border: '1px solid #555', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}>
          Cookbook
        </button>
        <button disabled={blocked} onClick={() => { if (!blocked) { setPendingRemoval(null); setShowCreator(true); } }} style={{
          ...TYPOGRAPHY.control,
          background: '#f0a500', color: '#111', border: 'none',
          padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
        }}>
          + New dish
        </button>
      </div>
      {blocked && <p role="status" style={{ ...TYPOGRAPHY.secondary, color: '#f0a500' }}>Career decision pending — menu changes are unavailable. You can still browse.</p>}
      <p style={TYPOGRAPHY.secondary}>Cook seconds show base cooking work, not the complete wait time. Estimated demand is not a sales guarantee.</p>
      <p style={TYPOGRAPHY.secondary}>Suspension affects new walk-in orders only. Booked contract guests can still order these items; orders already taken continue unchanged.</p>
      <p style={TYPOGRAPHY.secondary}>Paid today counts charged units from successful checkouts, including booked guests; free or cancelled lines do not count. It is not a demand percentage. Sales from before this feature, including older saves, are not tracked, and removing a dish clears its paid count.</p>
      {!hasWalkInMenu && (
        <p style={{ ...TYPOGRAPHY.secondary, color: '#f0a500' }}>
          No items are available for new walk-in orders. Guests without an order may leave unhappy.
        </p>
      )}

      <section aria-label="Menu affordability">
        <h4 style={TYPOGRAPHY.subheading}>Menu affordability</h4>
        <p>Can afford an order containing a dish: {formatCoverage(affordability.dishShare)}</p>
        <p>Can afford any order, including drink-only: {formatCoverage(affordability.anyOrderShare)}</p>
        <p style={TYPOGRAPHY.secondary}>Price-only coverage for new walk-in guest budgets at current reputation, not existing guests or booked contracts. These overlapping percentages are not additive and do not predict purchases or service capacity. Item demand weights every possible budget and guest preference; item percentages overlap and are not additive.</p>
      </section>

      {state.dishes.length === 0 && (
        <p style={{ ...TYPOGRAPHY.secondary, color: '#666' }}>No dishes yet. Create your first dish!</p>
      )}

      {state.dishes.map(rawDish => ({ rawDish, dish: getResolvedDish(state, rawDish.id) }))
        .filter(entry => entry.dish)
        .map(({ rawDish, dish }) => {
        const suspended = isMenuItemSuspended(state, 'dish', dish.id);
        const removalPending = pendingRemoval !== null && pendingRemoval.id === dish.id
          && pendingRemoval.dish === rawDish && !blocked;
        return (
        <article key={dish.id} aria-label={`${dish.name} menu item`} style={{
          background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 8,
          border: '1px solid #0f3460',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'space-between', marginBottom: 4 }}>
              <strong style={TYPOGRAPHY.subheading}>{dish.name}</strong>
            <span style={{ color: '#f0a500' }}>${dish.price} · {dish.prepTime}s cook</span>
          </div>
          {suspended && (
            <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4, color: '#f0a500' }}>
              Suspended for walk-ins
            </div>
          )}
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
            {dish.cookbookId ? `Cookbook recipe · ${dish.masteryPerk
              ? `Signature: ${dish.masteryPerk === 'speed' ? 'Quick Service' : 'House Favourite'}`
              : 'No signature chosen'}` : 'Custom recipe'}
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
            <span>Quality: {'█'.repeat(dish.quality)}{'░'.repeat(10 - dish.quality)} Lv.{dish.quality}</span>
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
            <span>Estimated demand: {demand.dishes.get(dish.id) ?? 0}%</span>
            {' · '}
            <span>Paid today: {getMenuSalesCount(state, 'dish', dish.id)}</span>
          </div>
          <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 8 }}>
            <span>Popularity: {dish.popularity}%</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <MenuPriceInput
              price={dish.price}
              label={`${dish.name} price`}
              disabled={blocked}
              onCommit={price => mutate({ type: 'UPDATE_DISH', id: dish.id, changes: { price } })}
            />
            <button
              aria-label={`Upgrade ${dish.name} quality ($${MENU_QUALITY_COST})`}
              onClick={() => mutate({ type: 'UPGRADE_DISH_QUALITY', id: dish.id })}
              disabled={blocked || dish.quality >= 10 || !canPay(MENU_QUALITY_COST)}
              style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
            >
              + Quality (${MENU_QUALITY_COST})
            </button>
            <button
              aria-label={`${suspended ? 'Resume' : 'Suspend'} ${dish.name} for walk-ins`}
              aria-pressed={suspended}
              disabled={blocked}
              onClick={() => mutate({ type: 'SET_MENU_ITEM_SUSPENDED', kind: 'dish', id: dish.id, suspended: !suspended })}
              style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
            >
              {suspended ? 'Resume' : 'Suspend'}
            </button>
            <button
              aria-label={`Remove ${dish.name} from menu`}
              disabled={blocked}
              onClick={event => {
                if (blocked) return;
                if (dish.cookbookId == null) {
                  setPendingRemoval({ id: dish.id, dish: rawDish, trigger: event.currentTarget });
                } else {
                  mutate({ type: 'REMOVE_DISH', id: dish.id });
                }
              }}
              style={{ ...TYPOGRAPHY.control, background: '#633', color: '#d44', border: '1px solid #844', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
            >
              Remove
            </button>
            {removalPending && (
              <div
                role="region"
                aria-label={`Remove ${dish.name}? This permanently deletes its recipe.`}
                onKeyDown={handleRemovalKeyDown}
                style={{ ...TYPOGRAPHY.secondary, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, width: '100%', border: '1px solid #844', borderRadius: 4, padding: '6px 8px' }}
              >
                <p style={{ margin: 0, flex: '1 1 240px' }}>
                  Removing this custom dish permanently deletes its recipe. Suspend it instead to stop new walk-in orders without deleting it.
                </p>
                <button
                  autoFocus
                  onClick={cancelRemoval}
                  style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRemoval}
                  style={{ ...TYPOGRAPHY.control, background: '#633', color: '#d44', border: '1px solid #844', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
                >
                  Confirm remove {dish.name}
                </button>
              </div>
            )}
          </div>
        </article>
        );
      })}

      <h4 style={{ ...TYPOGRAPHY.subheading, color: '#f0a500', margin: '16px 0 8px' }}>Drinks</h4>
      {DRINKS.map(drink => {
        const unlocked = unlockedDrinkIds.includes(drink.id);
        const resolvedDrink = unlocked ? getResolvedDrink(state, drink.id) : null;
        const suspended = resolvedDrink ? isMenuItemSuspended(state, 'drink', resolvedDrink.id) : false;

        return (
          <article key={drink.id} aria-label={`${drink.name} menu item`} style={{
            background: '#1a1a2e', borderRadius: 8, padding: 12, marginBottom: 8,
            border: '1px solid #0f3460',
          }}>
            {resolvedDrink ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong style={TYPOGRAPHY.subheading}>{resolvedDrink.name}</strong>
                  <span style={{ color: '#f0a500' }}>
                    ${resolvedDrink.price} · {resolvedDrink.prepTime}s prep
                  </span>
                </div>
                {suspended && (
                  <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4, color: '#f0a500' }}>
                    Suspended for walk-ins
                  </div>
                )}
                <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
                  <span>
                    Quality: {'█'.repeat(resolvedDrink.quality)}{'░'.repeat(10 - resolvedDrink.quality)} Lv.{resolvedDrink.quality}
                  </span>
                </div>
                <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 4 }}>
                  <span>Estimated demand: {demand.drinks.get(resolvedDrink.id) ?? 0}%</span>
                  {' · '}
                  <span>Paid today: {getMenuSalesCount(state, 'drink', resolvedDrink.id)}</span>
                </div>
                <div style={{ ...TYPOGRAPHY.secondary, marginBottom: 8 }}>
                  <span>Popularity: {resolvedDrink.popularity}%</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <MenuPriceInput
                    price={resolvedDrink.price}
                    label={`${resolvedDrink.name} price`}
                    disabled={blocked}
                    onCommit={price => mutate({
                      type: 'UPDATE_DRINK', id: resolvedDrink.id,
                      changes: { price },
                    })}
                  />
                  <button
                    aria-label={`Upgrade ${resolvedDrink.name} quality ($${MENU_QUALITY_COST})`}
                    onClick={() => mutate({ type: 'UPGRADE_DRINK_QUALITY', id: resolvedDrink.id })}
                    disabled={blocked || resolvedDrink.quality >= 10 || !canPay(MENU_QUALITY_COST)}
                    style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    + Quality (${MENU_QUALITY_COST})
                  </button>
                  <button
                    aria-label={`${suspended ? 'Resume' : 'Suspend'} ${resolvedDrink.name} for walk-ins`}
                    aria-pressed={suspended}
                    disabled={blocked}
                    onClick={() => mutate({
                      type: 'SET_MENU_ITEM_SUSPENDED', kind: 'drink',
                      id: resolvedDrink.id, suspended: !suspended,
                    })}
                    style={{ ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    {suspended ? 'Resume' : 'Suspend'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={TYPOGRAPHY.subheading}>{drink.name}</strong>
                  <button
                    onClick={() => mutate({ type: 'UNLOCK_DRINK', id: drink.id })}
                    disabled={blocked || !canPay(drink.unlockCost)}
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
