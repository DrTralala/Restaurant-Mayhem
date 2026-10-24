import { useId } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { getEquipmentLevelMultipliers, getEquipmentUpgradeQuote } from '../data/equipment';
import { getGlobalUpgradeQuote } from '../data/upgrades';
import { PLACEABLES } from '../data/placeables';
import { MAX_EXPANSION_LEVEL, getExpansionPreview } from '../simulation/expansion';
import { TYPOGRAPHY } from '../typography';

function formatShortfallAmount(amount) {
  return Number.isInteger(amount) ? `${amount}` : amount.toFixed(2);
}

function getCashShortfall(quote, funds) {
  if (!quote) return null;
  if (!Number.isFinite(funds)) return 'Funds unavailable.';
  if (funds >= quote.cost) return null;
  return `Needs $${formatShortfallAmount(quote.cost - funds)} more.`;
}

export default function UpgradePanel({ onStartPlacement = () => {} }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const serviceTablePrice = PLACEABLES.serviceTable.price;
  const funds = state.restaurant.funds;
  const canBuyServiceTable = Number.isFinite(funds)
    && Number.isFinite(serviceTablePrice)
    && serviceTablePrice >= 0
    && funds >= serviceTablePrice;
  const expansion = getExpansionPreview(state.restaurant);
  const expansionHelpId = useId();
  const shortfallHelpId = useId();
  const expansionMaxed = expansion != null && expansion.nextLevel == null;
  const expansionDisabled = !expansion || expansionMaxed || !expansion.affordable;

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 12 }}>Upgrades</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {state.upgrades.map((u, index) => {
          const quote = getGlobalUpgradeQuote(u, state.restaurant.funds);
          const maxed = Array.isArray(u.costs) && u.costs.length > 0
            && Number.isInteger(u.level) && u.level === u.costs.length;
          const disabled = maxed || !quote?.affordable;
          const shortfall = getCashShortfall(quote, state.restaurant.funds);
          const shortfallId = shortfall ? `${shortfallHelpId}-global-${index}` : undefined;
          return (
            <div key={u.id} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
              <strong style={TYPOGRAPHY.subheading}>{u.name}</strong>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>{u.description}</p>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#f0a500' }}>
                {maxed
                  ? `Level ${u.level} (Max)`
                  : quote
                    ? `Level ${quote.level} → $${quote.cost}`
                    : 'Upgrade unavailable.'}
              </p>
              {shortfall && (
                <p id={shortfallId} style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                  {shortfall}
                </p>
              )}
              <button
                onClick={() => {
                  if (quote?.affordable) dispatch({ type: 'BUY_UPGRADE', id: u.id });
                }}
                disabled={disabled}
                aria-describedby={shortfallId}
                style={{
                  ...TYPOGRAPHY.control,
                  background: disabled ? '#333' : '#f0a500',
                  color: disabled ? '#666' : '#111',
                  border: 'none', padding: '6px 14px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
                  marginTop: 6,
                }}
              >
                {maxed ? 'Max' : quote ? 'Buy' : 'Unavailable'}
              </button>
            </div>
          );
        })}
      </div>

      <h4 style={{ ...TYPOGRAPHY.subheading, color: '#f0a500', marginTop: 20, marginBottom: 8 }}>Expansion</h4>
      <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
        <strong style={TYPOGRAPHY.subheading}>Expand floor</strong>
        <div id={expansionHelpId}>
          {!expansion && (
            <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>Expansion unavailable.</p>
          )}
          {expansion && (
            <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
              Level {expansion.level} / {MAX_EXPANSION_LEVEL}
            </p>
          )}
          {expansionMaxed && (
            <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>Maximum expansion reached.</p>
          )}
          {expansion && !expansionMaxed && (
            <>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                Floor: {expansion.currentFloor.width} × {expansion.currentFloor.height} → {expansion.nextFloor.width} × {expansion.nextFloor.height} grid tiles.
              </p>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                Adds 1 empty kitchen station at no extra cost. Equipment is purchased separately.
              </p>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                Station placement is checked on purchase. If no valid space is available, nothing is charged.
              </p>
              {expansion.affordable && (
                <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                  Funds after purchase: ${expansion.fundsAfterPurchase}.
                </p>
              )}
              {!expansion.affordable && Number.isFinite(state.restaurant.funds) && (
                <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                  Needs ${expansion.cost} in available funds.
                </p>
              )}
              {!expansion.affordable && !Number.isFinite(state.restaurant.funds) && (
                <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>Funds unavailable.</p>
              )}
            </>
          )}
        </div>
        <button
          onClick={() => dispatch({ type: 'EXPAND' })}
          disabled={expansionDisabled}
          aria-describedby={expansionHelpId}
          style={{
            ...TYPOGRAPHY.control,
            background: expansionDisabled ? '#333' : '#f0a500',
            color: expansionDisabled ? '#666' : '#111',
            border: 'none', padding: '6px 14px', borderRadius: 4,
            cursor: expansionDisabled ? 'not-allowed' : 'pointer',
            marginTop: 6,
          }}
        >
          {!expansion ? 'Unavailable' : expansionMaxed ? 'Max' : `Expand ($${expansion.cost})`}
        </button>
      </div>

      <h4 style={{ ...TYPOGRAPHY.subheading, color: '#f0a500', marginTop: 20, marginBottom: 8 }}>Service</h4>
      <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460', marginBottom: 12 }}>
        <strong style={TYPOGRAPHY.subheading}>Service counter</strong>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
          Long table where cooks place finished food and waiters pick it up. {state.serviceTables.length} installed.
        </p>
        <button
          onClick={() => {
            if (canBuyServiceTable) onStartPlacement('serviceTable');
          }}
          disabled={!canBuyServiceTable}
          style={{
            ...TYPOGRAPHY.control,
            background: canBuyServiceTable ? '#f0a500' : '#333',
            color: canBuyServiceTable ? '#111' : '#666',
            border: 'none', padding: '6px 14px', borderRadius: 4,
            cursor: canBuyServiceTable ? 'pointer' : 'not-allowed',
            marginTop: 6,
          }}
        >
          Buy (${serviceTablePrice})
        </button>
      </div>

      <h4 style={{ ...TYPOGRAPHY.subheading, color: '#f0a500', marginTop: 20, marginBottom: 8 }}>Equipment</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {state.equipment.map((eq, index) => {
          const owned = eq.owned;
          const quote = owned ? getEquipmentUpgradeQuote(eq, state.restaurant.funds) : null;
          const maxed = owned && Number.isInteger(eq.level) && eq.level === 10;
          const purchaseCost = eq.purchaseCost;
          const purchaseCostValid = !owned && Number.isFinite(purchaseCost) && purchaseCost >= 0;
          const purchaseDisabled = !purchaseCostValid
            || !Number.isFinite(state.restaurant.funds)
            || state.restaurant.funds < purchaseCost;
          const disabled = owned ? !quote?.affordable : purchaseDisabled;
          const shortfall = getCashShortfall(quote, state.restaurant.funds);
          const shortfallId = shortfall ? `${shortfallHelpId}-equipment-${index}` : undefined;
          const multipliers = Number.isInteger(eq.level) && eq.level >= 1
            ? getEquipmentLevelMultipliers(eq.level)
            : getEquipmentLevelMultipliers(1);
          const speedMultiplier = Number.isFinite(eq.speedMultiplier) ? eq.speedMultiplier : multipliers.speedMultiplier;
          const qualityBonus = Number.isFinite(eq.qualityBonus) ? eq.qualityBonus : multipliers.qualityBonus;
          return (
            <div key={eq.id} style={{ background: owned ? '#1a2e1a' : '#1a1a2e', borderRadius: 8, padding: 12, border: `1px solid ${owned ? '#2a5a2a' : '#0f3460'}` }}>
              <strong style={TYPOGRAPHY.subheading}>{eq.name}</strong>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>Speed: {(speedMultiplier * 100).toFixed(0)}% · Quality: +{(qualityBonus * 100).toFixed(0)}%</p>
              {quote && (
                <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                  After upgrade: Speed {(quote.speedMultiplier * 100).toFixed(0)}% · Quality +{(quote.qualityBonus * 100).toFixed(0)}%
                </p>
              )}
              <p style={{ ...TYPOGRAPHY.secondary, color: '#f0a500' }}>
                {owned
                  ? maxed
                    ? `Level ${eq.level} (Max)`
                    : quote
                      ? `Level ${quote.level} → $${quote.cost}`
                      : 'Upgrade unavailable.'
                  : purchaseCostValid
                    ? `Not owned → $${purchaseCost}`
                    : 'Not owned'}
              </p>
              {shortfall && (
                <p id={shortfallId} style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                  {shortfall}
                </p>
              )}
              {!owned && (
                <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                  Place the station to purchase. Charged only after valid placement; cancelling costs nothing.
                </p>
              )}
              <button
                onClick={() => {
                  if (owned) {
                    if (quote?.affordable) {
                      dispatch({ type: 'UPGRADE_EQUIPMENT', id: eq.id, cost: quote.cost });
                    }
                  } else if (!purchaseDisabled) {
                    onStartPlacement({ itemType: 'equipmentStation', equipmentId: eq.id });
                  }
                }}
                disabled={disabled}
                aria-describedby={shortfallId}
                style={{
                  ...TYPOGRAPHY.control,
                  background: disabled ? '#333' : '#f0a500',
                  color: disabled ? '#666' : '#111',
                  border: 'none', padding: '6px 14px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
                  marginTop: 6,
                }}
              >
                {owned
                  ? maxed
                    ? 'Max'
                    : quote
                      ? `Upgrade ($${quote.cost})`
                      : 'Unavailable'
                  : purchaseCostValid
                    ? `Buy ($${purchaseCost})`
                    : 'Unavailable'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
