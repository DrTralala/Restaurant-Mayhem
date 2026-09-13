import { PLACEABLES } from '../data/placeables';
import { useGameState } from '../state/GameContext';
import { TYPOGRAPHY } from '../typography';

const ITEM_DESCRIPTIONS = {
  table: 'A four-seat table. Add chairs separately before seating guests.',
  chair: 'Adds one seat to the newest table with an open chair position.',
  door: 'Adds another entrance and exit lane so guests can pass through faster.',
  cashierTable: 'A dedicated station permanently staffed by an available waiter.',
  automaticDishwasher: 'Washes queued dishes automatically in three in-game minutes.',
};

const ITEMS = ['table', 'chair', 'door', 'cashierTable', 'automaticDishwasher'].map(type => ({
  ...PLACEABLES[type],
  name: PLACEABLES[type].label,
  description: ITEM_DESCRIPTIONS[type],
}));

export default function ItemsPanel({ onStartPlacement = () => {} }) {
  const state = useGameState();

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 4 }}>Items</h3>
      <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 0, marginBottom: 14 }}>
        Buy furniture and structural items for the restaurant.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {ITEMS.map(item => {
          const cost = item.price;
          const disabled = state.restaurant.funds < cost;
          return (
            <div key={item.type} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
              <strong style={TYPOGRAPHY.subheading}>{item.name}</strong>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#888', minHeight: 32, margin: '5px 0' }}>{item.description}</p>
              <p style={{ ...TYPOGRAPHY.secondary, color: '#f0a500', margin: '4px 0' }}>${cost}</p>
              <button
                aria-label={`Buy ${item.name} ($${cost})`}
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
