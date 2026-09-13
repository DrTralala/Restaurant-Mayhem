import { useGameState } from '../state/GameContext';
import { isRestaurantOpen, secondsToGameTime } from '../simulation/clock';
import { TYPOGRAPHY } from '../typography';
import AnalogClock from './AnalogClock';

export default function StatsBar() {
  const state = useGameState();
  const { restaurant } = state;
  const open = isRestaurantOpen(state);

  return (
    <div style={{
      ...TYPOGRAPHY.body,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
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
  );
}
