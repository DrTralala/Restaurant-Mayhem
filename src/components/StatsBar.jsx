import { useGameState } from '../state/GameContext';
import { isRestaurantOpen, secondsToGameTime } from '../simulation/clock';
import { TYPOGRAPHY } from '../typography';
import AnalogClock from './AnalogClock';
import { getCareerSummary } from '../simulation/careerRun';

function formatFunds(value) {
  return Number.isFinite(value) ? '$'+(Number.isInteger(value)?value:value.toFixed(2)) : 'Unavailable';
}

function careerCriterionText(criterion) {
  const reputation = criterion.id === 'reputation';
  if (reputation && !Number.isFinite(criterion.actual)) {
    return `Reputation: Unavailable / ${criterion.target.toFixed(2)} — unavailable`;
  }
  const rounded = reputation ? criterion.actual.toFixed(2) : criterion.actual;
  const actual = reputation && !criterion.passed && Number(rounded) >= criterion.target
    ? criterion.actual : rounded;
  return `${reputation ? 'Reputation' : 'Paid meals'}: ${actual} / ${reputation
    ? criterion.target.toFixed(2) : criterion.target} — ${criterion.passed ? 'met' : 'below target'}`;
}

export default function StatsBar({ onOpenCareer }) {
  const state = useGameState();
  const { restaurant } = state;
  const funds = formatFunds(restaurant.funds);
  const rating = restaurant.reputation;
  const filledStars = Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.floor(rating))) : null;
  const ratingText = filledStars === null ? 'Reputation unavailable'
    : `${'★'.repeat(filledStars)}${'☆'.repeat(5 - filledStars)} ${rating.toFixed(1)}`;
  const open = isRestaurantOpen(state);
  const career = getCareerSummary(state.careerRun, restaurant);
  const minutes = career ? Math.ceil(career.remainingSeconds / 60) : 0;
  const countdown = !minutes ? 'Deadline reached' : career.remainingSeconds < 60 ? 'Under 1 minute'
    : `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h ${minutes % 60}m`;

  return (
    <><div style={{
      ...TYPOGRAPHY.body,
      display: 'flex', flexWrap: 'wrap', gap: '6px 12px', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 16px', background: '#16213e', borderBottom: '1px solid #0f3460',
    }}>
      <span role="group" aria-label={`Funds: ${funds}`} style={{ color: '#f0a500' }}>{funds}</span>
      <span>{ratingText}</span>
      <span>Day {restaurant.day}</span>
      <span>{restaurant.totalServed} served</span>
      <span style={{ ...TYPOGRAPHY.control, color: open ? '#67c587' : '#d57878' }}>
        {open ? 'Open' : 'Closed'}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <AnalogClock gameTime={restaurant.gameTime} />
        <span>{secondsToGameTime(restaurant.gameTime)}</span>
      </span>
    </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: '#16213e', minWidth: 0 }}>
        {career && career.status !== 'continued' && <button type="button" aria-label="Opening Week progress"
          onClick={onOpenCareer} style={{ ...TYPOGRAPHY.secondary, flex: '1 1 260px', textAlign: 'left',
            whiteSpace: 'normal', overflowWrap: 'anywhere', padding: '6px 12px', border: '1px solid #0f3460',
            background: '#16213e', color: '#ddd', cursor: 'pointer' }}>
          Opening Week · {career.criteria ? career.criteria.map(careerCriterionText).join(' · ')
            : 'Progress cannot be verified'}
          {' · '}{career.needsDecision ? 'Decision required' : `${countdown} remaining (provisional)`}
          {' · '}Deadline: Day 8, 10:00 AM
        </button>}
      </div>
    </>
  );
}
