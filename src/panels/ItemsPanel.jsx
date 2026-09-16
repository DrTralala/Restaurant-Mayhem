import { SHOP_ITEMS } from './itemCatalog';
import { useGameState } from '../state/GameContext';
import { TYPOGRAPHY } from '../typography';

export default function ItemsPanel({ onStartPlacement = () => {} }) {
  const state = useGameState();
  const funds = state.restaurant?.funds ?? 0;

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 4 }}>Items</h3>
      <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 0, marginBottom: 14 }}>
        Buy furniture and structural items for the restaurant.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {SHOP_ITEMS.map(item => {
          const cost = item.price;
          const disabled = funds < cost;
          return (
             <div key={item.type} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
               <strong style={TYPOGRAPHY.subheading}>{item.name}</strong>
               <p id={`item-description-${item.type}`} style={{ ...TYPOGRAPHY.secondary, color: '#888', minHeight: 32, margin: '5px 0' }}>{item.description}</p>
               <p style={{ ...TYPOGRAPHY.secondary, color: '#f0a500', margin: '4px 0' }}>${cost}</p>
               <button
                 aria-label={`Buy ${item.name} ($${cost})`}
                 aria-describedby={`item-description-${item.type}`}
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
    </div>
  );
}
