import { useGameState } from '../state/GameContext';
import { isRestaurantOpen, secondsToGameTime } from '../simulation/clock';
import { TYPOGRAPHY } from '../typography';
import AnalogClock from './AnalogClock';
import { getCareerSummary } from '../simulation/careerRun';
import { ServiceContractTracker } from '../panels/ServiceContractsPanel';

function careerCriterionText(criterion) {
  const reputation = criterion.id === 'reputation';
  const rounded = reputation ? criterion.actual.toFixed(2) : criterion.actual;
  const actual = reputation && !criterion.passed && Number(rounded) >= criterion.target
    ? criterion.actual : rounded;
  return `${reputation ? 'Reputation' : 'Paid meals'}: ${actual} / ${reputation
    ? criterion.target.toFixed(2) : criterion.target} — ${criterion.passed ? 'met' : 'below target'}`;
}

export default function StatsBar({ onOpenCareer, onOpenContracts }) {
  const state = useGameState();
  const { restaurant } = state;
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
      <span style={{ color: '#f0a500' }}>${restaurant.funds.toFixed(0)}</span>
      <span>{'★'.repeat(Math.floor(restaurant.reputation))}{'☆'.repeat(5 - Math.floor(restaurant.reputation))} {restaurant.reputation.toFixed(1)}</span>
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
        <ServiceContractTracker onOpen={onOpenContracts} />
      </div>
    </>
  );
}
