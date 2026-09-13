import { useGameState, useDispatch } from '../state/GameContext';
import { getEquipmentLevelMultipliers } from '../data/equipment';
import { PLACEABLES } from '../data/placeables';
import { TYPOGRAPHY } from '../typography';

export default function UpgradePanel({ onStartPlacement = () => {} }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const serviceTablePrice = PLACEABLES.serviceTable.price;

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 12 }}>Upgrades</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {state.upgrades.map(u => {
          const nextCost = u.costs[u.level] || 0;
          const maxed = u.level >= u.costs.length;
          return (
            <div key={u.id} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
              <strong style={TYPOGRAPHY.subheading}>{u.name}</strong>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>{u.description}</p>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#f0a500' }}>Level {u.level} {maxed ? '(Max)' : `→ $${nextCost}`}</p>
              <button
                onClick={() => {
                  dispatch({ type: 'BUY_UPGRADE', id: u.id, cost: nextCost });
                }}
                disabled={maxed || state.restaurant.funds < nextCost}
                style={{
                  ...TYPOGRAPHY.control,
                  background: (maxed || state.restaurant.funds < nextCost) ? '#333' : '#f0a500',
                  color: (maxed || state.restaurant.funds < nextCost) ? '#666' : '#111',
                  border: 'none', padding: '6px 14px', borderRadius: 4, cursor: (maxed || state.restaurant.funds < nextCost) ? 'not-allowed' : 'pointer',
                  marginTop: 6,
                }}
              >
                {maxed ? 'Max' : 'Buy'}
              </button>
            </div>
          );
        })}
      </div>

      <h4 style={{ ...TYPOGRAPHY.subheading, color: '#f0a500', marginTop: 20, marginBottom: 8 }}>Expansion</h4>
      <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
        <strong style={TYPOGRAPHY.subheading}>Expand floor</strong>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
          Level {state.restaurant.expansionLevel || 1} / 4 — More space for tables and kitchen stations
        </p>
        {(() => {
          const costs = [0, 1000, 3000, 6000];
          const lvl = state.restaurant.expansionLevel || 1;
          const cost = lvl < 4 ? costs[lvl] : null;
          const maxed = lvl >= 4;
          return (
            <button
              onClick={() => dispatch({ type: 'EXPAND' })}
              disabled={maxed || state.restaurant.funds < (cost || 0)}
              style={{
                ...TYPOGRAPHY.control,
                background: (maxed || state.restaurant.funds < (cost || 0)) ? '#333' : '#f0a500',
                color: (maxed || state.restaurant.funds < (cost || 0)) ? '#666' : '#111',
                border: 'none', padding: '6px 14px', borderRadius: 4,
                cursor: (maxed || state.restaurant.funds < (cost || 0)) ? 'not-allowed' : 'pointer',
                marginTop: 6,
              }}
            >
              {maxed ? 'Max' : `Expand ($${cost})`}
            </button>
          );
        })()}
      </div>

      <h4 style={{ ...TYPOGRAPHY.subheading, color: '#f0a500', marginTop: 20, marginBottom: 8 }}>Service</h4>
      <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460', marginBottom: 12 }}>
        <strong style={TYPOGRAPHY.subheading}>Service counter</strong>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
          Long table where cooks place finished food and waiters pick it up. {state.serviceTables.length} installed.
        </p>
        <button
          onClick={() => onStartPlacement('serviceTable')}
          disabled={state.restaurant.funds < serviceTablePrice}
          style={{
            ...TYPOGRAPHY.control,
            background: state.restaurant.funds < serviceTablePrice ? '#333' : '#f0a500',
            color: state.restaurant.funds < serviceTablePrice ? '#666' : '#111',
            border: 'none', padding: '6px 14px', borderRadius: 4,
            cursor: state.restaurant.funds < serviceTablePrice ? 'not-allowed' : 'pointer',
            marginTop: 6,
          }}
        >
          Buy (${serviceTablePrice})
        </button>
      </div>

      <h4 style={{ ...TYPOGRAPHY.subheading, color: '#f0a500', marginTop: 20, marginBottom: 8 }}>Equipment</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {state.equipment.map(eq => {
          const owned = eq.owned;
          const multipliers = Number.isInteger(eq.level) && eq.level >= 1
            ? getEquipmentLevelMultipliers(eq.level)
            : getEquipmentLevelMultipliers(1);
          const speedMultiplier = Number.isFinite(eq.speedMultiplier) ? eq.speedMultiplier : multipliers.speedMultiplier;
          const qualityBonus = Number.isFinite(eq.qualityBonus) ? eq.qualityBonus : multipliers.qualityBonus;
          const nextCost = owned ? (eq.upgradeCosts[eq.level - 1] || 0) : eq.purchaseCost;
          const maxed = owned && eq.level >= 10;
          return (
            <div key={eq.id} style={{ background: owned ? '#1a2e1a' : '#1a1a2e', borderRadius: 8, padding: 12, border: `1px solid ${owned ? '#2a5a2a' : '#0f3460'}` }}>
              <strong style={TYPOGRAPHY.subheading}>{eq.name}</strong>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>Speed: {(speedMultiplier * 100).toFixed(0)}% · Quality: +{(qualityBonus * 100).toFixed(0)}%</p>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#f0a500' }}>{owned ? `Level ${eq.level}` : 'Not owned'} {maxed ? '(Max)' : `→ $${nextCost}`}</p>
              <button
                onClick={() => {
                  if (!owned) {
                    onStartPlacement({ itemType: 'equipmentStation', equipmentId: eq.id });
                  } else if (!maxed) {
                    dispatch({ type: 'UPGRADE_EQUIPMENT', id: eq.id, cost: nextCost });
                  }
                }}
                disabled={maxed || state.restaurant.funds < (owned ? nextCost : eq.purchaseCost)}
                style={{
                  ...TYPOGRAPHY.control,
                  background: (maxed || state.restaurant.funds < (owned ? nextCost : eq.purchaseCost)) ? '#333' : '#f0a500',
                  color: (maxed || state.restaurant.funds < (owned ? nextCost : eq.purchaseCost)) ? '#666' : '#111',
                  border: 'none', padding: '6px 14px', borderRadius: 4, cursor: (maxed || state.restaurant.funds < (owned ? nextCost : eq.purchaseCost)) ? 'not-allowed' : 'pointer',
                  marginTop: 6,
                }}
              >
                {maxed ? 'Max' : owned ? `Upgrade ($${nextCost})` : `Buy ($${eq.purchaseCost})`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
