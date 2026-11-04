import { getMenuAnalysis } from '../simulation/menuEconomy';
import { getResolvedDish } from '../simulation/cookbook';
import { getDishPricing } from '../simulation/dishPricing';
import { TYPOGRAPHY } from '../typography';

const DESCRIPTION = 'Expected whole-menu gross per 100 hypothetical walk-in guests.';
const CAVEAT = 'Expected gross is not profit. Excludes service capacity and booked contracts; actual purchases are not guaranteed.';
const CURRENT_LABEL = 'Current expected whole-menu gross per 100 hypothetical walk-in guests';
const DRAFT_LABEL = 'Draft expected whole-menu gross per 100 hypothetical walk-in guests';
const TIER_LABELS = Object.freeze({ budget: 'Budget', value: 'Value', premium: 'Premium' });
const AFFORDABILITY_HEADING = 'Affordable integer-budget-point shares by tier (current → draft).';
const AFFORDABILITY_CAVEAT = 'These shares describe budget fit only, not predicted purchases.';
const ABOVE_REFERENCE_CAVEAT = 'Above-reference dish prices reduce expected walk-in demand because some guests decline them even when their budget can afford the dish.';
const formatGross = value => `$${Number(value).toFixed(2)}`;

function formatCoverage(share) {
  if (share === 0) return '0%';
  if (share === 1) return '100%';
  const rounded = (share * 100).toFixed(1);
  if (rounded === '0.0') return '<0.1%';
  if (rounded === '100.0') return '>99.9%';
  return `${rounded}%`;
}

export function createMenuPricePreviewPresentation({
  state, kind, id, name, price, currentGrossPer100, currentAffordabilityByTier,
}) {
  const draftAnalysis = getMenuAnalysis(state, { kind, id, price });
  const currentTiers = currentAffordabilityByTier ?? getMenuAnalysis(state).affordabilityByTier;
  const dish = kind === 'dish' ? getResolvedDish(state, id) : null;
  const pricing = dish ? getDishPricing(dish.cookbookId, dish.quality) : null;
  const affordabilityRows = Object.entries(TIER_LABELS).map(([tier, label]) => ({
    tier: label,
    dishCurrent: formatCoverage(currentTiers[tier].dishShare),
    dishDraft: formatCoverage(draftAnalysis.affordabilityByTier[tier].dishShare),
    anyOrderCurrent: formatCoverage(currentTiers[tier].anyOrderShare),
    anyOrderDraft: formatCoverage(draftAnalysis.affordabilityByTier[tier].anyOrderShare),
  }));
  return {
    accessibleName: `Price preview for ${name}`,
    itemLine: `${name} · Draft price: $${price}`,
    description: DESCRIPTION,
    currentLabel: CURRENT_LABEL,
    currentAmount: formatGross(currentGrossPer100),
    draftLabel: DRAFT_LABEL,
    draftAmount: formatGross(draftAnalysis.expectedGrossPer100),
    pricingLine: pricing
      ? `Reference value ${formatGross(pricing.referenceValue)} · Allowed price $${pricing.minPrice}–$${pricing.maxPrice}`
      : null,
    pricingCaveat: pricing ? ABOVE_REFERENCE_CAVEAT : null,
    affordabilityHeading: AFFORDABILITY_HEADING,
    affordabilityRows,
    affordabilityCaveat: AFFORDABILITY_CAVEAT,
    caveat: CAVEAT,
  };
}

export default function MenuPricePreview({ presentation, inactive = false }) {
  return (
    <section
      role={inactive ? undefined : 'group'}
      aria-label={inactive ? undefined : presentation.accessibleName}
      aria-hidden={inactive ? 'true' : undefined}
      inert={inactive ? 'true' : undefined}
      style={{
        ...TYPOGRAPHY.secondary,
        boxSizing: 'border-box',
        width: 'fit-content',
        maxWidth: '100%',
        padding: '6px 8px',
        border: '1px solid #333',
        borderLeft: '3px solid #555',
        borderRadius: 4,
        background: '#15151c',
        color: '#ccc',
        textAlign: 'left',
        overflowWrap: 'anywhere',
        visibility: inactive ? 'hidden' : undefined,
        pointerEvents: inactive ? 'none' : undefined,
        userSelect: inactive ? 'none' : undefined,
      }}
    >
      <p style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}>
        {presentation.itemLine}
      </p>
      {presentation.pricingLine && (
        <p style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}>
          {presentation.pricingLine}
        </p>
      )}
      {presentation.pricingCaveat && (
        <p style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}>
          {presentation.pricingCaveat}
        </p>
      )}
      <p style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}>
        {presentation.description}
      </p>
      <p style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}>
        Current:{' '}
        <output aria-label={presentation.currentLabel}>{presentation.currentAmount}</output>
      </p>
      <p style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}>
        Draft:{' '}
        <output aria-label={presentation.draftLabel}>{presentation.draftAmount}</output>
      </p>
      <p style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}>
        {presentation.affordabilityHeading}
      </p>
      {presentation.affordabilityRows.map(row => (
        <p
          key={row.tier}
          aria-label={`${row.tier} tier affordability`}
          style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}
        >
          {row.tier}: dish-containing orders {row.dishCurrent} → {row.dishDraft}; any orders {row.anyOrderCurrent} → {row.anyOrderDraft}
        </p>
      ))}
      <p style={{ ...TYPOGRAPHY.secondary, margin: '0 0 2px' }}>
        {presentation.affordabilityCaveat}
      </p>
      <p style={{ ...TYPOGRAPHY.secondary, margin: 0 }}>
        {presentation.caveat}
      </p>
    </section>
  );
}
