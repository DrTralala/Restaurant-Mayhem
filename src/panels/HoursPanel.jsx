import { useDispatch, useGameState } from '../state/GameContext';
import { formatOperatingHour } from '../simulation/clock';
import { TYPOGRAPHY } from '../typography';

const HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => index / 2);

function scheduleSummary(openHour, closeHour) {
  if (openHour === closeHour) return 'Open 24 hours';
  const summary = `${formatOperatingHour(openHour)}–${formatOperatingHour(closeHour)}`;
  return openHour > closeHour ? `${summary} (next day)` : summary;
}

export default function HoursPanel() {
  const state = useGameState();
  const dispatch = useDispatch();
  const { openHour, closeHour } = state.restaurant;
  const selectStyle = {
    ...TYPOGRAPHY.control,
    width: '100%',
    marginTop: 6,
    padding: '9px 10px',
    color: '#ddd',
    background: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: 4,
  };

  return (
    <section style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: '0 0 6px' }}>Operating hours</h3>
      <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '0 0 14px' }}>
        Arrivals stop at closing time. Customers already inside finish their visit.
      </p>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
      }}>
        <label style={TYPOGRAPHY.secondary}>
          Opening time
          <select
            aria-label="Opening time"
            value={openHour}
            onChange={event => dispatch({
              type: 'SET_OPERATING_HOURS',
              openHour: Number(event.target.value),
              closeHour,
            })}
            style={selectStyle}
          >
            {HOUR_OPTIONS.map(hour => (
              <option key={hour} value={hour}>{formatOperatingHour(hour)}</option>
            ))}
          </select>
        </label>

        <label style={TYPOGRAPHY.secondary}>
          Closing time
          <select
            aria-label="Closing time"
            value={closeHour}
            onChange={event => dispatch({
              type: 'SET_OPERATING_HOURS',
              openHour,
              closeHour: Number(event.target.value),
            })}
            style={selectStyle}
          >
            {HOUR_OPTIONS.map(hour => (
              <option key={hour} value={hour}>{formatOperatingHour(hour)}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{
        marginTop: 16,
        padding: '14px 16px',
        background: '#1a1a2e',
        border: '1px solid #0f3460',
        borderLeft: '4px solid #f0a500',
        borderRadius: 6,
      }}>
         <span style={{ ...TYPOGRAPHY.secondary, display: 'block', color: '#888', marginBottom: 4 }}>
           Current schedule
         </span>
         <strong style={{ ...TYPOGRAPHY.subheading, color: '#f0a500' }}>
          {scheduleSummary(openHour, closeHour)}
        </strong>
      </div>
    </section>
  );
}
