import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { COOKBOOK_RECIPES, getCookbookRecipe, MASTERY_PORTION_THRESHOLD } from '../data/cookbook';
import { EQUIPMENT } from '../data/equipment';
import { getCookbookEntryStatus, normaliseCookbookState } from '../simulation/cookbook';
import { TYPOGRAPHY } from '../typography';

const buttonStyle = { ...TYPOGRAPHY.control, background: '#333', color: '#ccc', border: '1px solid #555',
  padding: '6px 10px', borderRadius: 4, cursor: 'pointer' };
const detailStyle = { ...TYPOGRAPHY.secondary, margin: '4px 0' };
const perkNames = { speed: 'Quick Service', appeal: 'House Favourite' };
const equipmentName = id => EQUIPMENT.find(equipment => equipment.id === id)?.name || id;
const cookbookEquipmentIds = [...new Set(COOKBOOK_RECIPES.map(recipe => recipe.requiredEquipmentId))];

export default function CookbookPanel({ onClose, readOnly = false }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const [confirmation, setConfirmation] = useState(null);
  const [filter, setFilter] = useState('all');
  const [equipmentFilter, setEquipmentFilter] = useState('all');
  const blocked = readOnly || state.careerRun?.needsDecision === true;
  // Legacy/partial callers can browse without mutating state; parent initialisation owns adoption.
  const viewState = state.cookbook ? state : { ...state, ...normaliseCookbookState(state, {
    legacy: true, lastPaidVisitSequence: state.paidVisitSequence ?? 0,
  }) };
  const entries = COOKBOOK_RECIPES.map(recipe => ({
    recipe,
    status: getCookbookEntryStatus(viewState, recipe.id),
  }));
  const equipmentEntries = equipmentFilter === 'all' ? entries
    : entries.filter(({ recipe }) => recipe.requiredEquipmentId === equipmentFilter);
  const readyEntries = equipmentEntries.filter(({ status }) =>
    status.canBuy || status.canAdd || status.canChoosePerk);
  const readyIds = new Set(readyEntries.map(({ recipe }) => recipe.id));
  const filteredEntries = filter === 'ready'
    ? equipmentEntries.filter(({ recipe }) => readyIds.has(recipe.id))
    : equipmentEntries;
  const pinnedId = confirmation && !filteredEntries.some(({ recipe }) => recipe.id === confirmation.cookbookId)
    ? confirmation.cookbookId : null;
  const visibleIds = new Set(filteredEntries.map(({ recipe }) => recipe.id));
  if (pinnedId) visibleIds.add(pinnedId);
  const visibleEntries = entries.filter(({ recipe }) => visibleIds.has(recipe.id));

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', paddingRight: 40 }}>
        <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: 0 }}>Cookbook</h3>
        <button autoFocus onClick={onClose} style={buttonStyle}>Back to menu</button>
      </div>
      <p style={detailStyle}>Discover recipes, buy each recipe once, then add owned recipes to your menu for free.</p>
      <p style={detailStyle}>Recipe purchase costs are separate from the menu price charged per paid dish. Speed changes base cooking work, not the complete wait time.</p>
      {blocked && <p role="status" style={{ ...detailStyle, color: '#f0a500' }}>Career decision pending — menu changes are unavailable. You can still browse.</p>}
      <div role="group" aria-label="Cookbook view" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <button style={buttonStyle} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        <button style={buttonStyle} aria-pressed={filter === 'ready'} onClick={() => setFilter('ready')}>Ready actions</button>
        <select aria-label="Recipe equipment" value={equipmentFilter} onChange={event => setEquipmentFilter(event.target.value)} style={buttonStyle}>
          <option value="all">All equipment</option>
          {cookbookEquipmentIds.map(equipmentId => <option key={equipmentId} value={equipmentId}>{equipmentName(equipmentId)}</option>)}
        </select>
        <p style={{ ...detailStyle, margin: 0 }}>{readyEntries.length} recipes have ready actions.</p>
      </div>
      {filteredEntries.length === 0 && <p style={detailStyle}>{filter === 'ready'
        ? equipmentFilter === 'all' ? 'No recipes have ready actions.' : `No ${equipmentName(equipmentFilter)} recipes have ready actions.`
        : `No ${equipmentName(equipmentFilter)} recipes found.`}</p>}

      {visibleEntries.map(({ recipe, status }) => {
        const settings = viewState.cookbook.entries[recipe.id].menuSettings;
        const displayName = status.owned ? settings.name : recipe.name;
        const pinned = recipe.id === pinnedId;
        const pendingPerk = confirmation?.cookbookId === recipe.id ? confirmation.perk : null;
        const previewPerk = pendingPerk || status.perk;
        const prep = previewPerk === 'speed' ? Math.max(1, Math.round(recipe.prepTime * 0.85)) : recipe.prepTime;
        const popularity = previewPerk === 'appeal' ? Math.min(100, recipe.popularity + 10) : recipe.popularity;
        return (
          <article key={recipe.id} aria-label={`${displayName} recipe`} style={{ background: '#1a1a2e',
            border: '1px solid #0f3460', borderRadius: 8, padding: 12, marginTop: 12 }}>
            <h4 style={{ ...TYPOGRAPHY.subheading, margin: '0 0 4px', color: '#f0a500' }}>{displayName}</h4>
            {pinned && <p style={detailStyle}>Shown while its signature choice is open.</p>}
            {status.discovered ? <p style={detailStyle}>Discovered</p>
              : <p style={detailStyle}>Locked — meet the discovery requirements below</p>}
            {status.discovered && <p style={detailStyle}>{status.owned
              ? status.activeDishId ? 'On menu' : 'Owned'
              : 'Not owned'}</p>}
            <p style={detailStyle}>Equipment: {equipmentName(recipe.requiredEquipmentId)} · {recipe.base} / {recipe.method}</p>
            <p style={detailStyle}>Base cook work: {recipe.prepTime} seconds · Base popularity: {recipe.popularity}</p>
            <p style={detailStyle}>One-time recipe purchase: ${status.purchaseCost} · Menu price: ${settings.price} per paid dish · Quality {settings.quality}</p>
            {status.requirements.length > 0 && (
              <ul style={{ ...TYPOGRAPHY.secondary, paddingLeft: 20, margin: '8px 0' }}>
                {status.requirements.map(requirement => (
                  <li key={`${requirement.type}:${requirement.id}`}>
                    {requirement.type === 'equipment' ? `Own ${equipmentName(requirement.id)}`
                      : `${getCookbookRecipe(requirement.id).name} paid portions`}: {requirement.current}/{requirement.required}
                  </li>
                ))}
              </ul>
            )}
            {!status.equipmentOwned && status.discovered && <p style={detailStyle}>
              {status.owned
                ? status.activeDishId
                  ? `Equipment needed: Own ${equipmentName(recipe.requiredEquipmentId)} before serving this on-menu recipe.`
                  : `Equipment needed: Own ${equipmentName(recipe.requiredEquipmentId)} before adding this owned recipe to the menu.`
                : `Equipment needed: Own ${equipmentName(recipe.requiredEquipmentId)} before buying this recipe.`}
            </p>}
            {status.discovered && !status.owned && !status.canAfford
              && <p style={detailStyle}>Need ${status.purchaseCost} to buy this recipe.</p>}
            {status.discovered && !status.owned && (
              <button style={buttonStyle} disabled={blocked || !status.canBuy}
                onClick={() => { if (!blocked && status.canBuy) dispatch({
                  type: 'BUY_COOKBOOK_RECIPE', cookbookId: recipe.id,
                }); }}>
                Buy recipe — ${status.purchaseCost}
              </button>
            )}
            {status.discovered && !status.stationAvailable && <p style={detailStyle}>No matching kitchen station — place a compatible station before serving.</p>}
            <button style={{ ...buttonStyle, marginLeft: status.discovered && !status.owned ? 8 : 0 }}
              disabled={blocked || !status.canAdd}
              onClick={() => { if (!blocked && status.canAdd) dispatch({ type: 'ADD_COOKBOOK_DISH', cookbookId: recipe.id }); }}>
              Add {displayName} to menu
            </button>

            {status.discovered && (
              <div style={{ borderTop: '1px solid #0f3460', marginTop: 12, paddingTop: 8 }}>
                <p style={detailStyle}>Paid portions: {status.paidPortions}/{MASTERY_PORTION_THRESHOLD}</p>
                <p style={detailStyle}>Quick Service: 15% less base cook work. House Favourite: +10 popularity (up to 100).</p>
                {status.perk ? <p style={{ ...detailStyle, color: '#f0a500' }}>Signature: {perkNames[status.perk]}</p>
                  : status.canChoosePerk ? <p style={{ ...detailStyle, color: '#f0a500' }}>Signature choice available</p>
                    : <p style={detailStyle}>15 paid portions to choose a signature.</p>}
                {previewPerk && <>
                  <p style={detailStyle}>{recipe.prepTime} → {prep} seconds base cook work</p>
                  <p style={detailStyle}>{recipe.popularity} → {popularity} popularity</p>
                  <p style={detailStyle}>Permanent for this recipe; applies to new orders only</p>
                </>}
                {pendingPerk && !status.perk ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    <button style={buttonStyle} disabled={blocked || !status.canChoosePerk} onClick={() => {
                      if (blocked || !status.canChoosePerk) return;
                      dispatch({ type: 'CHOOSE_DISH_MASTERY', cookbookId: recipe.id, perk: pendingPerk });
                      setConfirmation(null);
                    }}>Confirm {perkNames[pendingPerk]}</button>
                    <button style={buttonStyle} onClick={() => setConfirmation(null)}>Cancel</button>
                  </div>
                ) : !status.perk && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {Object.entries(perkNames).map(([perk, name]) => <button key={perk} style={buttonStyle}
                      disabled={blocked || !status.canChoosePerk} onClick={() => {
                        if (!blocked && status.canChoosePerk) setConfirmation({ cookbookId: recipe.id, perk });
                      }}>Choose {name}</button>)}
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
