import { useId } from 'react';
import { SHOP_ITEMS } from './itemCatalog';
import { getPlaceable, getPlaceableDimensions } from '../data/placeables';
import { getStaffAmenityDefinition } from '../data/staffAmenities';
import { getAmenityUsageSummary } from './amenityUsageSummary';
import { useGameState } from '../state/GameContext';
import { TYPOGRAPHY } from '../typography';

const PLACEMENT_COPY = 'Buy starts placement. Charged only after valid placement; cancelling costs nothing. Footprints exclude access space and do not guarantee a valid position.';

export default function ItemsPanel({ onStartPlacement = () => {} }) {
  const state = useGameState();
  const uid = useId();
  const funds = state.restaurant?.funds;
  const amenities = Array.isArray(state.staffAmenities) ? state.staffAmenities : [];
  const placementCopyId = `${uid}-placement-copy`;

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 4 }}>Items</h3>
      <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 0, marginBottom: 14 }}>
        Buy furniture and structural items for the restaurant.
      </p>
      <p id={placementCopyId} style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 0, marginBottom: 14 }}>
        {PLACEMENT_COPY}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', gap: 10 }}>
        {SHOP_ITEMS.map(item => {
          const cost = item.price;
          const placeable = getPlaceable(item.type);
          const defaultFootprint = getPlaceableDimensions(item.type, 0);
          const quarterFootprint = getPlaceableDimensions(item.type, 1);
          const rotatable = placeable?.rotatable === true;
          const fundsValid = Number.isFinite(funds) && funds >= 0;
          const costValid = Number.isFinite(cost) && cost >= 0;
          const disabled = !fundsValid || !costValid || funds < cost;
          const descriptionId = `${uid}-item-${item.type}-description`;
          const footprintId = `${uid}-item-${item.type}-footprint`;
          const quarterFootprintId = `${uid}-item-${item.type}-quarter-footprint`;
          return (
             <div key={item.type} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
               <strong style={TYPOGRAPHY.subheading}>{item.name}</strong>
               <p id={descriptionId} style={{ ...TYPOGRAPHY.secondary, color: '#888', minHeight: 32, margin: '5px 0' }}>{item.description}</p>
               <p style={{ ...TYPOGRAPHY.secondary, color: '#f0a500', margin: '4px 0' }}>${cost}</p>
               <p id={footprintId} style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                 {`Default footprint: ${defaultFootprint.width} × ${defaultFootprint.height} world units.`}
               </p>
               {rotatable && (
                 <p id={quarterFootprintId} style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0' }}>
                   {`Quarter-turn footprint: ${quarterFootprint.width} × ${quarterFootprint.height} world units.`}
                 </p>
               )}
               <button
                 aria-label={`Buy ${item.name} ($${cost})`}
                 aria-describedby={rotatable
                   ? `${placementCopyId} ${descriptionId} ${footprintId} ${quarterFootprintId}`
                   : `${placementCopyId} ${descriptionId} ${footprintId}`}
                 disabled={disabled}
                 onClick={() => onStartPlacement(item.type)}
                 style={{
                   ...TYPOGRAPHY.control,
                   background: disabled ? '#333' : '#f0a500',
                   color: disabled ? '#666' : '#111',
                   border: 'none', padding: '6px 14px', borderRadius: 4,
                   cursor: disabled ? 'not-allowed' : 'pointer',
                 }}
               >
                 Buy
               </button>
             </div>
           );
        })}
      </div>
      <section aria-label="Staff amenity usage" style={{ marginTop: 20 }}>
        <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: '0 0 6px' }}>Staff amenity usage</h3>
        {amenities.length === 0 ? (
          <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: 0 }}>
            No staff amenities installed.
          </p>
        ) : (
          <ul
            aria-label="Installed staff amenities"
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}
          >
            {amenities.map((amenity, index) => {
              const summary = getAmenityUsageSummary(amenity);
              const label = getStaffAmenityDefinition(amenity?.type)?.label ?? 'Unknown amenity';
              return (
                <li
                  key={amenity?.id ?? `amenity-${index}`}
                  style={{
                    background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ ...TYPOGRAPHY.subheading, color: '#f0a500' }}>{label}</strong>
                    <span style={{ ...TYPOGRAPHY.secondary, color: '#888' }}>{amenity?.id ?? ''}</span>
                  </div>
                  {summary ? (
                    <span style={{ ...TYPOGRAPHY.secondary, display: 'block', color: '#ddd', marginTop: 4 }}>
                      {`Occupied ${summary.occupied} · Reserved ${summary.reserved} · Unclaimed ${summary.unclaimed} · Capacity ${summary.capacity}`}
                    </span>
                  ) : (
                    <span style={{ ...TYPOGRAPHY.secondary, display: 'block', color: '#888', marginTop: 4 }}>
                      Usage unavailable.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '10px 0 0' }}>
          Current slot ownership only. Reserved slots are not yet occupied; unclaimed slots do not guarantee access or immediate use.
        </p>
      </section>
    </div>
  );
}
