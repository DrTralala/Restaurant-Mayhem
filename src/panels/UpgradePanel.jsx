import { useGameState, useDispatch } from '../state/GameContext';

export default function UpgradePanel() {
  const state = useGameState();
  const dispatch = useDispatch();

  return (
    <div style={{ color: '#ccc', fontFamily: 'monospace' }}>
      <h3 style={{ color: '#f0a500', marginBottom: 12 }}>Upgrades</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {state.upgrades.map(u => {
          const nextCost = u.costs[u.level] || 0;
          const maxed = u.level >= u.costs.length;
          return (
            <div key={u.id} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
              <strong>{u.name}</strong>
              <p style={{ fontSize: 12, color: '#888', margin: '4px 0' }}>{u.description}</p>
              <p style={{ fontSize: 12, color: '#f0a500' }}>Lv.{u.level} {maxed ? '(MAX)' : `→ $${nextCost}`}</p>
              <button
                onClick={() => {
                  dispatch({ type: 'BUY_UPGRADE', id: u.id, cost: nextCost });
                  if (u.effects?.type === 'table') {
                    dispatch({ type: 'ADD_TABLE' });
                  }
                }}
                disabled={maxed || state.restaurant.funds < nextCost}
                style={{
                  background: (maxed || state.restaurant.funds < nextCost) ? '#333' : '#f0a500',
                  color: (maxed || state.restaurant.funds < nextCost) ? '#666' : '#111',
                  border: 'none', padding: '6px 14px', borderRadius: 4, cursor: (maxed || state.restaurant.funds < nextCost) ? 'not-allowed' : 'pointer',
                  fontSize: 12, marginTop: 6,
                }}
              >
                {maxed ? 'MAX' : 'Buy'}
              </button>
            </div>
          );
        })}
      </div>

      <h4 style={{ color: '#f0a500', marginTop: 20, marginBottom: 8 }}>Equipment</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {state.equipment.map(eq => {
          const owned = eq.owned;
          const nextCost = owned ? (eq.upgradeCosts[eq.level - 1] || 0) : eq.purchaseCost;
          const maxed = owned && eq.level >= 10;
          return (
            <div key={eq.id} style={{ background: owned ? '#1a2e1a' : '#1a1a2e', borderRadius: 8, padding: 12, border: `1px solid ${owned ? '#2a5a2a' : '#0f3460'}` }}>
              <strong>{eq.name}</strong>
              <p style={{ fontSize: 12, color: '#888', margin: '4px 0' }}>Speed: {(eq.speedMultiplier * 100).toFixed(0)}% · Quality: +{(eq.qualityBonus * 100).toFixed(0)}%</p>
              <p style={{ fontSize: 12, color: '#f0a500' }}>{owned ? `Lv.${eq.level}` : 'Not owned'} {maxed ? '(MAX)' : `→ $${nextCost}`}</p>
              <button
                onClick={() => {
                  if (!owned) {
                    dispatch({ type: 'BUY_EQUIPMENT', id: eq.id, cost: eq.purchaseCost });
                  } else if (!maxed) {
                    dispatch({ type: 'UPGRADE_EQUIPMENT', id: eq.id, cost: nextCost });
                  }
                }}
                disabled={maxed || state.restaurant.funds < (owned ? nextCost : eq.purchaseCost)}
                style={{
                  background: (maxed || state.restaurant.funds < (owned ? nextCost : eq.purchaseCost)) ? '#333' : '#f0a500',
                  color: (maxed || state.restaurant.funds < (owned ? nextCost : eq.purchaseCost)) ? '#666' : '#111',
                  border: 'none', padding: '6px 14px', borderRadius: 4, cursor: (maxed || state.restaurant.funds < (owned ? nextCost : eq.purchaseCost)) ? 'not-allowed' : 'pointer',
                  fontSize: 12, marginTop: 6,
                }}
              >
                {maxed ? 'MAX' : owned ? `Upgrade ($${nextCost})` : `Buy ($${eq.purchaseCost})`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
