import { useRef, useEffect, useId } from 'react';
import { useGameState } from '../state/GameContext';
import { getCanvasFont, TYPOGRAPHY } from '../typography';
import { getServiceSummary } from './serviceSummary';
import { getQueuePatienceSummary } from './queuePatienceSummary';
import { getFoodDeadlineSummary } from './foodDeadlineSummary';
import { getDailyPayroll, isRestaurantOpen } from '../simulation/clock';
import { DIRT_REPUTATION_THRESHOLD, getDirtReputationLossPerMinute } from '../simulation/dirt';

const statBox = { ...TYPOGRAPHY.secondary, background: '#1a1a2e', borderRadius: 6, padding: 10, border: '1px solid #0f3460' };

function formatPatience(party) {
  if (party.status === 'unknown') return 'Patience unknown';
  if (party.status === 'exhausted') return 'Patience exhausted';
  const percent = party.fraction * 100;
  const text = percent < 1 ? '<1' : percent < 100 && Math.round(percent) === 100
    ? '>99' : String(Math.round(percent));
  return `Lowest-remaining guest: ${text}% patience`;
}

function formatExhaustionSeconds(seconds) {
  if (seconds <= 0) return '0s';
  if (seconds < 1) return '<1s';
  const whole = Math.ceil(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
}

function formatPatienceEstimate(party, restaurantOpen) {
  if (!restaurantOpen) return 'Patience time estimate unavailable while closed.';
  if (!Number.isFinite(party.exhaustionSeconds)) return 'Patience time estimate unavailable.';
  return `Estimated time until patience runs out: ${formatExhaustionSeconds(party.exhaustionSeconds)} (game time).`;
}

function formatFunds(value) {
  return Number.isFinite(value) ? `$${Number.isInteger(value) ? value : value.toFixed(2)}` : 'Unavailable';
}

export default function StatsPanel() {
  const state = useGameState();
  const canvasRef = useRef(null);
  const completedFinancesId = useId();
  const partyReviewHistory = Array.isArray(state.partyReviewHistory)
    ? state.partyReviewHistory
    : [];
  const finiteScores = partyReviewHistory
    .map(review => review.score)
    .filter(Number.isFinite);
  const averagePartyReview = finiteScores.length
    ? (finiteScores.reduce((sum, score) => sum + score, 0) / finiteScores.length).toFixed(1)
    : '—';
  const unaffordableReviewCount = partyReviewHistory
    .filter(review => review.unaffordableCount > 0).length;
  const unaffordableReviewPercentage = partyReviewHistory.length
    ? Math.round(unaffordableReviewCount / partyReviewHistory.length * 100)
    : 0;
  const latestPartyReviews = partyReviewHistory.slice(-10).reverse();
  const recentFinances = (Array.isArray(state.dailyHistory) ? state.dailyHistory : [])
    .slice(-7).reverse();
  const service = getServiceSummary(state);
  const queuePatience = getQueuePatienceSummary(state);
  const foodDeadline = getFoodDeadlineSummary(state);
  const restaurantOpen = isRestaurantOpen(state);
  const dailyPayroll = getDailyPayroll(state.staff || []);
  const revenue = state.restaurant.dailyRevenue;
  const revenueAfterPayroll = Number.isFinite(revenue) && Number.isFinite(dailyPayroll) ? revenue - dailyPayroll : NaN;
  const funds = state.restaurant.funds;
  const projectedBalance = Number.isFinite(funds) ? funds - dailyPayroll : Number.NaN;
  const payrollExceedsFunds = Number.isFinite(funds) && dailyPayroll > funds;
  const floorMesses = Array.isArray(state.floorDirt) ? state.floorDirt.length : 0;
  const dirtReputationLossPerMinute = getDirtReputationLossPerMinute(floorMesses);
  const dirtPressureText = dirtReputationLossPerMinute === 0
    ? '0'
    : `-${dirtReputationLossPerMinute.toFixed(3)}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const data = state.dailyHistory.slice(-7);
    if (data.length === 0) return;

    const maxRev = Math.max(...data.map(d => d.revenue), 1);
    const barWidth = canvas.width / data.length - 4;

    data.forEach((d, i) => {
      const h = (d.revenue / maxRev) * (canvas.height - 20);
      ctx.fillStyle = '#f0a500';
      ctx.fillRect(i * (barWidth + 4) + 2, canvas.height - h, barWidth, h);
      ctx.fillStyle = '#888';
      ctx.font = getCanvasFont('compact');
      ctx.fillText(`D${d.day}`, i * (barWidth + 4) + 2, canvas.height - 2);
    });
  }, [state.dailyHistory]);

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 12 }}>Statistics</h3>

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 4 }}>Daily revenue</h4>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={recentFinances.length === 0
            ? 'Daily revenue — no recorded days'
            : 'Daily revenue for the last seven recorded days'}
          aria-describedby={completedFinancesId}
          style={{ width: '100%', height: 120, background: '#111', borderRadius: 8 }}
        >
          Revenue values are listed in Completed-day finances.
        </canvas>
      </div>

      <section aria-label="Current-day finances" style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Current-day finances</h4>
        <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
          <div style={statBox}>Revenue so far: <strong>{formatFunds(revenue)}</strong></div>
          <div style={statBox}>Current daily payroll: <strong>{formatFunds(dailyPayroll)}</strong></div>
          <div style={statBox}>
            Revenue so far minus current payroll: <strong>{formatFunds(revenueAfterPayroll)}</strong>
          </div>
        </div>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          In progress. This compares revenue received so far with the current full daily payroll. It is not cash balance or a forecast; future sales, staffing changes and other receipts or spending are excluded.
        </p>
      </section>

      <section id={completedFinancesId} aria-label="Completed-day finances" style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Completed-day finances</h4>
        {recentFinances.length === 0 ? (
          <p style={TYPOGRAPHY.secondary}>No completed-day finances yet.</p>
        ) : (
          <ol
            aria-label="Recent daily finances"
            style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
          >
            {recentFinances.map((record, index) => (
              <li key={`completed-day-${index}`} style={statBox}>
                <div>{Number.isFinite(record?.day) ? `Day ${record.day}` : 'Day unavailable'}</div>
                <div>Revenue: {formatFunds(record?.revenue)}</div>
                <div>Payroll: {formatFunds(record?.payroll)}</div>
                <div>Profit: {formatFunds(record?.profit)}</div>
              </li>
            ))}
          </ol>
        )}
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Last seven recorded days. Profit is revenue minus payroll, not total cash movement; other receipts and spending are excluded.
        </p>
      </section>

      <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={statBox}>Total served: <strong>{state.restaurant.totalServed}</strong></div>
        <div style={statBox}>Current day: <strong>{state.restaurant.day}</strong></div>
        <div style={statBox}>Funds: <strong>{formatFunds(funds)}</strong></div>
        <div style={statBox}>Reputation: <strong>{state.restaurant.reputation.toFixed(1)} ★</strong></div>
        <div style={statBox}>Staff: <strong>{state.staff.length}</strong></div>
        <div style={statBox}>Dishes: <strong>{state.dishes.length}</strong></div>
      </div>

      <section aria-label="Cleanliness" style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Cleanliness</h4>
        <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
          <div style={statBox}>Floor messes: {floorMesses}</div>
          <div style={statBox}>
            Dirt-only reputation pressure: {dirtPressureText} per game minute.
          </div>
        </div>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Reputation pressure starts above {DIRT_REPUTATION_THRESHOLD} floor messes. Nearby dirt can lower guest happiness even below this threshold. This is the dirt-only rate before the minimum rating and other reputation changes, not a net forecast.
        </p>
      </section>

      <section aria-label="Midnight payroll" style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Midnight payroll</h4>
        <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
          <div style={statBox}>Daily payroll: <strong>{formatFunds(dailyPayroll)}</strong></div>
          <div style={statBox}>
            Balance after payroll at current funds: <strong>{formatFunds(projectedBalance)}</strong>
          </div>
        </div>
        {payrollExceedsFunds && (
          <p style={{ ...TYPOGRAPHY.secondary, color: '#d44', marginTop: 8 }}>
            Current funds do not cover the next payroll.
          </p>
        )}
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          All employed staff are paid at midnight, including during Rest and PTO. This estimate excludes future sales and spending.
        </p>
      </section>

      <section aria-label="Service now" style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Service now</h4>
        <div style={statBox}>
          Entry queue: {service.queueParties} parties · {service.queueGuests} guests
        </div>
        <h5 style={{ ...TYPOGRAPHY.secondary, margin: '10px 0 8px' }}>Queue patience</h5>
        {queuePatience.length === 0 ? <p style={TYPOGRAPHY.secondary}>No parties waiting.</p> : (
          <ul aria-label="Queue patience" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {queuePatience.map((party, index) => (
              <li key={party.partyId} style={statBox}>
                <div>Party {index + 1}: {party.guestCount} {party.guestCount === 1 ? 'guest' : 'guests'}</div>
                <div>{formatPatience(party)}</div>
                <div>{formatPatienceEstimate(party, restaurantOpen)}</div>
              </li>
            ))}
          </ul>
        )}
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          All queued parties are included, even those not shown outside. A party leaves when any guest runs out of queue patience. Percentages show the lowest-remaining guest's share of their own maximum. At current queue pressure, assuming no seating, arrivals or closing. This is game time until patience runs out, not a seating wait estimate. Pausing the simulation stops the countdown.
        </p>
        <h5 style={{ ...TYPOGRAPHY.secondary, margin: '10px 0 8px' }}>
          Pending service items (dishes + drinks)
        </h5>
        <div style={{ display: 'grid', gap: 8 }}>
          {[
            ['ordered', 'Awaiting preparation'], ['preparing', 'In preparation'],
            ['ready', 'Ready for collection'], ['on_service', 'On service counter'],
            ['carried', 'Being carried'],
          ].map(([key, label]) => <div key={key} style={statBox}>{label}: {service.pending[key]}</div>)}
        </div>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Current counts, not totals. One guest may order multiple items. Queue includes guests not shown outside. Delivered items and cleanup are excluded.
        </p>
      </section>

      <section aria-label="Pending-food timing" style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Pending-food timing</h4>
        {foodDeadline.pendingCount === 0 ? (
          <p style={TYPOGRAPHY.secondary}>No recorded pending food orders.</p>
        ) : (
          <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
            <div style={statBox}>
              Known timers: {foodDeadline.knownCount}. Unknown timers: {foodDeadline.unknownCount}.
            </div>
            {foodDeadline.knownCount === 0 || !Number.isFinite(foodDeadline.remainingSeconds) ? (
              <div style={statBox}>Food timing unavailable.</div>
            ) : (
              <>
                <div style={statBox}>
                  Earliest known food deadline: {formatExhaustionSeconds(foodDeadline.remainingSeconds)} (game time remaining).
                </div>
                {foodDeadline.remainingSeconds === 0 && (
                  <div style={statBox}>Deadline reached.</div>
                )}
              </>
            )}
            {foodDeadline.unknownCount > 0 && (
              <div style={statBox}>Other pending deadlines are unknown.</div>
            )}
          </div>
        )}
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Based on recorded customer timers, not a delivery ETA. Delivered or cancelled outcomes are excluded; service-item reconciliation occurs in the simulation.
        </p>
      </section>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Party reviews</h4>
        <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
          <div style={statBox}>Average party review: {averagePartyReview}</div>
          <div style={statBox}>Completed reviews: {partyReviewHistory.length}</div>
          <div style={statBox}>
            Reviews with unaffordable members: {unaffordableReviewCount} ({unaffordableReviewPercentage}%)
          </div>
          {latestPartyReviews.map(review => {
            const formattedDelta = review.reputationDelta.toFixed(3);
            const signedDelta = review.reputationDelta > 0
              ? `+${formattedDelta}`
              : formattedDelta;
            return (
              <div
                key={`${review.day}-${review.partyId}`}
                data-testid="party-review-row"
                style={statBox}
              >
                <div style={{ color: '#f0a500', marginBottom: 4 }}>
                  Day {review.day} · {review.partyId}
                </div>
                <div>Score: {review.score.toFixed(1)}</div>
                <div>
                  Party: {review.memberCount} · Paid: {review.paidCount} · Unaffordable: {review.unaffordableCount}
                </div>
                <div>Reputation: {signedDelta}</div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => {
          if (window.confirm('Start a new game? All progress will be lost.')) {
            localStorage.removeItem('restaurant-sim-save');
            window.location.reload();
          }
        }}
        style={{
          ...TYPOGRAPHY.control,
          marginTop: 16, width: '100%',
          background: '#633', color: '#d44', border: '1px solid #844',
          padding: '8px 16px', borderRadius: 4, cursor: 'pointer',
        }}
      >
        New game
      </button>
    </div>
  );
}
