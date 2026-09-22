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

export default function CookbookPanel({ onClose, readOnly = false }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const [confirmation, setConfirmation] = useState(null);
  const blocked = readOnly || state.careerRun?.needsDecision === true;
  // Legacy/partial callers can browse without mutating state; parent initialisation owns adoption.
  const viewState = state.cookbook ? state : { ...state, ...normaliseCookbookState(state, {
    legacy: true, lastPaidVisitSequence: state.paidVisitSequence ?? 0,
  }) };

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', paddingRight: 40 }}>
        <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: 0 }}>Cookbook</h3>
        <button onClick={onClose} style={buttonStyle}>Back to menu</button>
      </div>
      <p style={detailStyle}>Discover recipes, add them for free, then serve paid portions to choose a signature.</p>
      <p style={detailStyle}>Speed changes base cooking work, not the complete wait time. Custom recipes remain unrestricted.</p>
      {blocked && <p role="status" style={{ ...detailStyle, color: '#f0a500' }}>Career decision pending — menu changes are unavailable. You can still browse.</p>}

      {COOKBOOK_RECIPES.map(recipe => {
        const status = getCookbookEntryStatus(viewState, recipe.id);
        const settings = viewState.cookbook.entries[recipe.id].menuSettings;
        const pendingPerk = confirmation?.cookbookId === recipe.id ? confirmation.perk : null;
        const previewPerk = pendingPerk || status.perk;
        const prep = previewPerk === 'speed' ? Math.max(1, Math.round(recipe.prepTime * 0.85)) : recipe.prepTime;
        const popularity = previewPerk === 'appeal' ? Math.min(100, recipe.popularity + 10) : recipe.popularity;
        const additionReason = status.activeDishId ? 'On menu' : !status.discovered ? 'Locked — meet the discovery requirements below'
          : !status.equipmentOwned ? 'Equipment needed' : 'Ready to add';
        return (
          <article key={recipe.id} aria-label={`${recipe.name} recipe`} style={{ background: '#1a1a2e',
            border: '1px solid #0f3460', borderRadius: 8, padding: 12, marginTop: 12 }}>
            <h4 style={{ ...TYPOGRAPHY.subheading, margin: '0 0 4px', color: '#f0a500' }}>{recipe.name}</h4>
            {status.discovered && <p style={detailStyle}>Discovered</p>}
            <p style={detailStyle}>{additionReason}</p>
            <p style={detailStyle}>Equipment: {equipmentName(recipe.requiredEquipmentId)} · {recipe.base} / {recipe.method}</p>
            <p style={detailStyle}>Base cook work: {recipe.prepTime} seconds · Base popularity: {recipe.popularity}</p>
            <p style={detailStyle}>{settings.name} · ${settings.price} · Quality {settings.quality}</p>
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
            {!status.equipmentOwned && status.discovered && <p style={detailStyle}>Own {equipmentName(recipe.requiredEquipmentId)} before adding this recipe.</p>}
            {status.discovered && !status.stationAvailable && <p style={detailStyle}>No matching kitchen station — place a compatible station before serving.</p>}
            <button style={buttonStyle} disabled={blocked || !status.canAdd}
              onClick={() => { if (!blocked && status.canAdd) dispatch({ type: 'ADD_COOKBOOK_DISH', cookbookId: recipe.id }); }}>
              Add {recipe.name} to menu
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
