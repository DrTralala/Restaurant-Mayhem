import { useDispatch, useGameState } from '../state/GameContext';
import { formatOperatingHour } from '../simulation/clock';

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
    width: '100%',
    marginTop: 6,
    padding: '9px 10px',
    color: '#ddd',
    background: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 14,
  };

  return (
    <section style={{ color: '#ccc', fontFamily: 'monospace' }}>
      <h3 style={{ color: '#f0a500', margin: '0 0 6px' }}>Operating Hours</h3>
      <p style={{ color: '#888', fontSize: 12, margin: '0 0 14px' }}>
        Arrivals stop at closing time. Customers already inside finish their visit.
      </p>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
      }}>
        <label>
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

        <label>
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
        <span style={{ display: 'block', color: '#888', fontSize: 11, marginBottom: 4 }}>
          CURRENT SCHEDULE
        </span>
        <strong style={{ color: '#f0a500', fontSize: 16 }}>
          {scheduleSummary(openHour, closeHour)}
        </strong>
      </div>
    </section>
  );
}
