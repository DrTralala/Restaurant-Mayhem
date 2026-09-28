import { useGameState } from '../state/GameContext';
import { MILESTONES } from '../data/milestones';
import { getMilestoneProgress } from '../simulation/milestones';
import { humaniseIdentifier, sentenceCase, TYPOGRAPHY } from '../typography';

const BUILT_IN_MILESTONE_IDS = new Set(MILESTONES.map(milestone => milestone.id));
const SUPPORTED_CONDITIONS = new Set([
  'servedTotal', 'cashReserve', 'revenue', 'reputation', 'day', 'equipmentLevel',
]);

function isUsableMilestone(milestone) {
  return milestone !== null
    && typeof milestone === 'object'
    && !Array.isArray(milestone)
    && typeof milestone.description === 'string'
    && milestone.description.trim() !== ''
    && milestone.condition !== null
    && typeof milestone.condition === 'object'
    && !Array.isArray(milestone.condition)
    && SUPPORTED_CONDITIONS.has(milestone.condition.type)
    && Number.isFinite(milestone.condition.threshold)
    && milestone.condition.threshold > 0;
}

function formatReward(reward, milestone) {
  if (!reward?.type || reward.type === 'none') return 'No reward';
  if (reward.type === 'cashBonus') {
    if (!BUILT_IN_MILESTONE_IDS.has(milestone.id)
      || !Number.isSafeInteger(reward.amount) || reward.amount <= 0) return 'No reward';
    return `Cash bonus $${reward.amount}`;
  }
  return humaniseIdentifier(reward.type);
}

export default function MilestonePanel() {
  const state = useGameState();
  const milestones = Array.isArray(state?.milestones) ? state.milestones : [];

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 12 }}>Milestones</h3>
      {milestones.map((m, index) => {
        if (!isUsableMilestone(m)) return null;
        const rawProgress = m.achieved ? 100 : getMilestoneProgress(m, state);
        const progress = Number.isFinite(rawProgress)
          ? Math.min(100, Math.max(0, rawProgress))
          : 0;
        return (
          <div key={`${m.id ?? 'milestone'}-${index}`} style={{
            background: m.achieved ? '#1a2e1a' : '#1a1a2e', borderRadius: 8,
            padding: 12, marginBottom: 6, border: `1px solid ${m.achieved ? '#2a5a2a' : '#0f3460'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span>{m.achieved ? '✅' : '🔒'}</span>
              <span>{sentenceCase(m.description)}</span>
            </div>
            <div
              role="progressbar"
              aria-label={sentenceCase(m.description)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              style={{ background: '#111', borderRadius: 4, height: 6, overflow: 'hidden' }}
            >
              <div style={{ background: m.achieved ? '#4a7' : '#f0a500', height: '100%', width: `${progress}%`, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '4px 0 0' }}>
              {m.achieved ? 'Completed' : `Reward: ${formatReward(m.reward, m)}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
