import { useDispatch, useGameState } from '../state/GameContext';
import { formatOperatingHour } from '../simulation/clock';
import { getRushSchedulePreview } from './rushSchedulePreview';
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
  const paused = state.restaurant.walkInsPaused === true;
  const rushPreview = getRushSchedulePreview(state.restaurant);
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

      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: '20px 0 6px' }}>Walk-in arrivals</h3>
      <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '0 0 10px' }}>
        {paused ? 'Paused' : 'Accepting walk-ins during opening hours'}
      </p>
      <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '0 0 12px' }}>
        {'Only new walk-ins are paused. Queued and seated guests continue service; booked contract guests still arrive during opening hours.'}
      </p>
      <button
        type="button"
        aria-pressed={paused}
        onClick={() => dispatch({ type: 'SET_WALK_INS_PAUSED', paused: !paused })}
        style={{
          ...TYPOGRAPHY.control,
          padding: '9px 14px',
          color: '#ddd',
          background: '#16213e',
          border: '1px solid #0f3460',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {paused ? 'Resume walk-ins' : 'Pause walk-ins'}
      </button>

      <section aria-label="Rush periods">
        <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: '20px 0 6px' }}>Rush periods</h3>
        <ul
          aria-label="Rush-period coverage"
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}
        >
          {rushPreview.map(period => {
            const duration = period.endHour - period.startHour;
            const coverage = period.openHours === 0
              ? 'Closed throughout'
              : period.openHours === duration ? 'Open throughout' : 'Partly open';
            return (
              <li key={period.name} style={{
                padding: '10px 12px',
                background: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ ...TYPOGRAPHY.subheading, color: '#f0a500' }}>
                    {period.name}
                  </strong>
                  <span style={{ ...TYPOGRAPHY.secondary, color: '#888' }}>
                    {`${formatOperatingHour(period.startHour)}–${formatOperatingHour(period.endHour)}`}
                  </span>
                </div>
                <span style={{ ...TYPOGRAPHY.secondary, display: 'block', color: '#888', marginTop: 4 }}>
                  {`Full-window peak: ${period.peakMultiplier}× at ${formatOperatingHour(period.peakHour)}.`}
                </span>
                <span style={{ ...TYPOGRAPHY.secondary, display: 'block', color: '#888', marginTop: 4 }}>
                  {`Open for ${period.openHours} of ${duration} hours.`}
                </span>
                <span style={{ ...TYPOGRAPHY.secondary, display: 'block', color: '#ddd', marginTop: 4 }}>
                  {coverage}
                </span>
              </li>
            );
          })}
        </ul>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '10px 0 0' }}>
          These multipliers affect random walk-in arrival rates, not guaranteed guests or sales. Full-window peaks may fall outside your opening hours. Booked contract arrivals follow their own schedule.
        </p>
        {paused && (
          <p style={{ ...TYPOGRAPHY.secondary, color: '#888', margin: '8px 0 0' }}>
            Walk-ins are paused; this opening-hours preview does not resume them.
          </p>
        )}
      </section>
    </section>
  );
}
