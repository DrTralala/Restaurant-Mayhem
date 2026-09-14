import { PLACEABLES } from '../data/placeables';
import { useGameState } from '../state/GameContext';
import { TYPOGRAPHY } from '../typography';

const ITEM_DESCRIPTIONS = {
  table: 'A four-seat table. Add chairs separately before seating guests.',
  chair: 'Adds one seat to the newest table with an open chair position.',
  door: 'Adds another entrance and exit lane so guests can pass through faster.',
  cashierTable: 'A dedicated station permanently staffed by an available waiter.',
  automaticDishwasher: '10 levels; level 1 washes items serially every 300 seconds and holds 12 items.',
  couch: 'Two staff seats for 15 minutes; restores +6 morale per hour while occupied.',
  arcade: 'One staff seat for 10 minutes; restores +8 morale per hour while occupied.',
  bed: 'One staff bed: minimum 7 in-game hours, full morale, then 24 hours of reduced drain.',
};

const ITEMS = [
  'table',
  'chair',
  'door',
  'cashierTable',
  'automaticDishwasher',
  'couch',
  'arcade',
  'bed',
].map(type => ({
  ...PLACEABLES[type],
  name: PLACEABLES[type].label,
  price: type === 'automaticDishwasher' ? 2000 : PLACEABLES[type].price,
  description: ITEM_DESCRIPTIONS[type],
}));

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
        {ITEMS.map(item => {
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
