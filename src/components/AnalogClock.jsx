import { getClockHandAngles, secondsToGameTime } from '../simulation/clock';

export default function AnalogClock({ gameTime }) {
  const { hourDegrees, minuteDegrees } = getClockHandAngles(gameTime);

  return (
    <span
      role="img"
      aria-label={secondsToGameTime(gameTime)}
      style={{
        position: 'relative', display: 'inline-block', width: '30px', height: '30px',
        border: '2px solid currentColor', borderRadius: '50%', boxSizing: 'border-box',
      }}
    >
      <span
        data-testid="hour-hand"
        style={{
          position: 'absolute', left: '50%', bottom: '50%', width: '2px', height: '9px',
          background: 'currentColor', transformOrigin: '50% 100%', transform: `rotate(${hourDegrees}deg)`,
        }}
      />
      <span
        data-testid="minute-hand"
        style={{
          position: 'absolute', left: '50%', bottom: '50%', width: '1px', height: '12px',
          background: 'currentColor', transformOrigin: '50% 100%', transform: `rotate(${minuteDegrees}deg)`,
        }}
      />
    </span>
  );
}
