import { useGameState } from '../state/GameContext';
import { secondsToGameTime } from '../simulation/clock';

export default function StatsBar() {
  const state = useGameState();
  const { restaurant } = state;

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 16px', background: '#16213e', borderBottom: '1px solid #0f3460',
      fontSize: '14px', fontFamily: 'monospace',
    }}>
      <span style={{ color: '#f0a500' }}>${restaurant.funds.toFixed(0)}</span>
      <span>{'★'.repeat(Math.floor(restaurant.reputation))}{'☆'.repeat(5 - Math.floor(restaurant.reputation))} {restaurant.reputation.toFixed(1)}</span>
      <span>Day {restaurant.day}</span>
      <span>{restaurant.totalServed} served</span>
      <span>{secondsToGameTime(restaurant.gameTime)}</span>
    </div>
  );
}
