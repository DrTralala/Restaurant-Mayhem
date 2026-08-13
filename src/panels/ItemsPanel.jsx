import { ITEM_PRICES } from '../data/items';
import { useDispatch, useGameState } from '../state/GameContext';

const ITEMS = [
  {
    type: 'table',
    name: 'Dining Table',
    description: 'A four-seat table. Add chairs separately before seating guests.',
    action: 'BUY_TABLE',
  },
  {
    type: 'chair',
    name: 'Dining Chair',
    description: 'Adds one seat to the newest table with an open chair position.',
    action: 'BUY_CHAIR',
  },
  {
    type: 'door',
    name: 'Additional Door',
    description: 'Adds another entrance and exit lane so guests can pass through faster.',
    action: 'BUY_DOOR',
  },
];

export default function ItemsPanel() {
  const state = useGameState();
  const dispatch = useDispatch();

  return (
    <div style={{ color: '#ccc', fontFamily: 'monospace' }}>
      <h3 style={{ color: '#f0a500', marginBottom: 4 }}>Items</h3>
      <p style={{ color: '#888', fontSize: 12, marginTop: 0, marginBottom: 14 }}>
        Buy furniture and structural items for the restaurant.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {ITEMS.map(item => {
          const cost = ITEM_PRICES[item.type];
          const disabled = state.restaurant.funds < cost;
          return (
            <div key={item.type} style={{ background: '#1a1a2e', borderRadius: 8, padding: 12, border: '1px solid #0f3460' }}>
              <strong>{item.name}</strong>
              <p style={{ fontSize: 12, color: '#888', minHeight: 32, margin: '5px 0' }}>{item.description}</p>
              <p style={{ color: '#f0a500', fontSize: 12, margin: '4px 0' }}>${cost}</p>
              <button
                aria-label={`Buy ${item.type} ($${cost})`}
                disabled={disabled}
                onClick={() => dispatch({ type: item.action, cost })}
                style={{
                  background: disabled ? '#333' : '#f0a500',
                  color: disabled ? '#666' : '#111',
                  border: 'none', padding: '6px 14px', borderRadius: 4,
                  cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12,
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
