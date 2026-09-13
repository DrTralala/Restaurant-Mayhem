import { useGameState } from '../state/GameContext';
import { humaniseIdentifier, sentenceCase, TYPOGRAPHY } from '../typography';

function formatReward(reward) {
  if (!reward?.type || reward.type === 'none') return 'No reward';
  return humaniseIdentifier(reward.type);
}

export default function MilestonePanel() {
  const state = useGameState();

  const getProgress = (m) => {
    switch (m.condition.type) {
      case 'servedTotal': return Math.min(100, (state.restaurant.totalServed / m.condition.threshold) * 100);
      case 'revenue': return Math.min(100, (state.restaurant.funds / m.condition.threshold) * 100);
      case 'reputation': return Math.min(100, (state.restaurant.reputation / m.condition.threshold) * 100);
      case 'day': return Math.min(100, (state.restaurant.day / m.condition.threshold) * 100);
      case 'equipmentLevel': {
        const maxLevel = Math.max(0, ...state.equipment.filter(e => e.owned).map(e => e.level));
        return Math.min(100, (maxLevel / m.condition.threshold) * 100);
      }
      default: return 0;
    }
  };

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 12 }}>Milestones</h3>
      {state.milestones.map(m => {
        const progress = m.achieved ? 100 : getProgress(m);
        return (
          <div key={m.id} style={{
            background: m.achieved ? '#1a2e1a' : '#1a1a2e', borderRadius: 8,
            padding: 12, marginBottom: 6, border: `1px solid ${m.achieved ? '#2a5a2a' : '#0f3460'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span>{m.achieved ? '✅' : '🔒'}</span>
              <span>{sentenceCase(m.description)}</span>
            </div>
            <div style={{ background: '#111', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ background: m.achieved ? '#4a7' : '#f0a500', height: '100%', width: `${progress}%`, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0 0' }}>
              Reward: {formatReward(m.reward)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
