import { useRef, useEffect, useLayoutEffect, useId } from 'react';
import { useDispatch, useGameState } from '../state/GameContext';
import { requestNewSandbox } from '../state/newSandbox';
import { getCanvasFont, TYPOGRAPHY } from '../typography';
import { getServiceSummary } from './serviceSummary';
import { getCleanupSummary } from './cleanupSummary';
import { getQueuePatienceSummary } from './queuePatienceSummary';
import { getFoodDeadlineSummary, getFoodServiceTriage } from './foodDeadlineSummary';
import { getKitchenBlockerSummary } from './kitchenBlockerSummary';
import { getDailyPayroll, isRestaurantOpen } from '../simulation/clock';
import { DIRT_REPUTATION_THRESHOLD, getDirtReputationLossPerMinute } from '../simulation/dirt';
import { getQueuePartyCount, QUEUE_PARTY_CAPACITY } from '../simulation/customerQueue';
import { getRevenueChart } from './revenueChart';
import { getRecentFinanceSummary } from './recentFinanceSummary';
import { isCareerDecisionPending } from '../simulation/careerRun';
import TableSeatingHolds from './TableSeatingHolds';
import { getTableLocatePoint } from '../canvas/tableLocatePoint';

const statBox = { ...TYPOGRAPHY.secondary, background: '#1a1a2e', borderRadius: 6, padding: 10, border: '1px solid #0f3460' };
const REVENUE_CHART_MAX_BARS = 7;
const FOOD_SERVICE_STAGE_LABELS = {
  ordered: 'Awaiting preparation',
  preparing: 'In preparation',
  ready: 'Ready for collection',
  on_service: 'On service counter',
  carried: 'Being carried',
};

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

function formatFoodTarget(target) {
  const identifiers = [
    target?.customerId != null ? `Guest ${target.customerId}` : null,
    target?.dishId != null ? `Dish ${target.dishId}` : null,
    target?.tableId != null ? `Table ${target.tableId}` : null,
  ].filter(Boolean);
  return identifiers.length ? identifiers.join(' · ') : 'Unavailable';
}

function formatPatienceEstimate(party, restaurantOpen) {
  if (!restaurantOpen) return 'Patience time estimate unavailable while closed.';
  if (!Number.isFinite(party.exhaustionSeconds)) return 'Patience time estimate unavailable.';
  return `Estimated time until patience runs out: ${formatExhaustionSeconds(party.exhaustionSeconds)} (game time).`;
}

function formatFunds(value) {
  return Number.isFinite(value) ? `$${Number.isInteger(value) ? value : value.toFixed(2)}` : 'Unavailable';
}

function getRevenueChartHistoryKey(history) {
  const entries = Array.isArray(history) ? history.slice(-REVENUE_CHART_MAX_BARS) : [];
  return JSON.stringify(entries.map(entry => ([
    Number.isFinite(entry?.day) ? entry.day : null,
    Number.isFinite(entry?.revenue) ? entry.revenue : null,
  ])));
}

export default function StatsPanel({ onLocateTable, locateDisabled = false, locateMessage = '' }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const canvasRef = useRef(null);
  const chartHistoryRef = useRef(state.dailyHistory);
  const drawChartRef = useRef(null);
  const chartHistoryKey = getRevenueChartHistoryKey(state.dailyHistory);
  const previousChartHistoryKeyRef = useRef(chartHistoryKey);
  const completedFinancesId = useId();
  const queuePriorityHelpId = useId();
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
  const recentFinanceSummary = getRecentFinanceSummary(state.dailyHistory);
  const service = getServiceSummary(state);
  const cleanup = getCleanupSummary(state);
  const queuePartyCount = getQueuePartyCount(state.queue);
  const remainingPartySlots = Math.max(0, QUEUE_PARTY_CAPACITY - queuePartyCount);
  const queuePatience = getQueuePatienceSummary(state);
  const foodDeadline = getFoodDeadlineSummary(state);
  const foodTriage = getFoodServiceTriage(state);
  const foodTableId = foodDeadline.target?.tableId;
  const tableLocateDisabled = locateDisabled || isCareerDecisionPending(state)
    || typeof onLocateTable !== 'function' || !getTableLocatePoint(state.tables, foodTableId);
  const canLocateFoodOrder = order => !locateDisabled && !isCareerDecisionPending(state)
    && typeof onLocateTable === 'function'
    && Boolean(getTableLocatePoint(state.tables, order.tableId));
  const kitchenBlockers = getKitchenBlockerSummary(state);
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
  const careerDecisionPending = isCareerDecisionPending(state);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drawChart = () => {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      const pixelRatio = Number.isFinite(window.devicePixelRatio)
        && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      canvas.width = Math.round(cssWidth * pixelRatio);
      canvas.height = Math.round(cssHeight * pixelRatio);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Resizing the backing store resets the context state on every redraw.
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const chart = getRevenueChart(chartHistoryRef.current, cssWidth, cssHeight);
      if (!chart || chart.bars.length === 0) return;

      ctx.fillStyle = '#888';
      ctx.fillRect(0, chart.baselineY, cssWidth, 1);

      chart.bars.forEach(bar => {
        if (bar.value !== null && bar.value !== 0 && bar.height > 0) {
          ctx.fillStyle = '#f0a500';
          ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
        }
        ctx.fillStyle = '#888';
        ctx.font = getCanvasFont('compact');
        ctx.fillText(bar.dayLabel, bar.x, cssHeight - 2);
      });
    };

    drawChartRef.current = drawChart;
    drawChart();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(drawChart);
    resizeObserver?.observe(canvas);
    window.addEventListener('resize', drawChart);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', drawChart);
      drawChartRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    chartHistoryRef.current = state.dailyHistory;
  }, [state.dailyHistory]);

  useEffect(() => {
    if (previousChartHistoryKeyRef.current === chartHistoryKey) return;
    previousChartHistoryKeyRef.current = chartHistoryKey;
    drawChartRef.current?.();
  }, [chartHistoryKey]);

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 12 }}>Statistics</h3>

      <TableSeatingHolds />

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
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Bars above zero show positive revenue; bars below zero show negative revenue.
          Unavailable values are omitted.
        </p>
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
        {recentFinanceSummary.recordCount > 0 && (
          <section aria-label="Recent finance summary" style={{ marginTop: 12 }}>
            <h5 style={{ ...TYPOGRAPHY.secondary, margin: '10px 0 8px' }}>
              Recent finance summary
            </h5>
            <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
              <div style={statBox}>
                Revenue total: {formatFunds(recentFinanceSummary.revenue.total)}
                {' '}({recentFinanceSummary.revenue.count} of {recentFinanceSummary.recordCount} records)
              </div>
              <div style={statBox}>
                Payroll total: {formatFunds(recentFinanceSummary.payroll.total)}
                {' '}({recentFinanceSummary.payroll.count} of {recentFinanceSummary.recordCount} records)
              </div>
              <div style={statBox}>
                Revenue minus payroll total: {formatFunds(recentFinanceSummary.profit.total)}
                {' '}({recentFinanceSummary.profit.count} of {recentFinanceSummary.recordCount} records)
              </div>
              <div style={statBox}>
                Average recorded revenue minus payroll: {formatFunds(recentFinanceSummary.profit.average)}
                {' '}({recentFinanceSummary.profit.count} of {recentFinanceSummary.recordCount} records)
              </div>
              <div style={statBox}>
                Positive revenue-minus-payroll records: {recentFinanceSummary.profit.count === 0
                  ? 'Unavailable (0 of 0 recorded profit values)'
                  : `${recentFinanceSummary.profit.positiveCount} of ${recentFinanceSummary.profit.count}`}
              </div>
            </div>
            <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
              Only finite stored values are included; missing or invalid values are excluded,
              not treated as zero. Profit and its average use stored profit values only.
            </p>
          </section>
        )}
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Last seven recorded entries; day labels may be duplicated or non-consecutive. Stored profit is revenue minus payroll, not total cash movement; other receipts and spending are excluded.
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
        <div style={{ ...statBox, marginTop: 8 }}>
          <div>Queue admission slots: {queuePartyCount} / {QUEUE_PARTY_CAPACITY} parties</div>
          <div>Remaining party slots: {remainingPartySlots}</div>
          {queuePartyCount >= QUEUE_PARTY_CAPACITY && (
            <div>Queue admission capacity reached.</div>
          )}
        </div>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          The limit counts parties, not guests. A full queue blocks new walk-ins and scheduled party admission; free slots do not guarantee an arrival or a seat.
        </p>
        <h5 style={{ ...TYPOGRAPHY.secondary, margin: '10px 0 8px' }}>Queue patience</h5>
        {queuePatience.length === 0 ? <p style={TYPOGRAPHY.secondary}>No parties waiting.</p> : (
          <ul aria-label="Queue patience" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {queuePatience.map((party, index) => (
              <li key={party.partyId} style={statBox}>
                <div>Party {index + 1}: {party.guestCount} {party.guestCount === 1 ? 'guest' : 'guests'}</div>
                <div>{formatPatience(party)}</div>
                <div>{formatPatienceEstimate(party, restaurantOpen)}</div>
                <button
                  type="button"
                  disabled={index === 0 || careerDecisionPending}
                  aria-describedby={queuePriorityHelpId}
                  onClick={() => {
                    if (index === 0 || careerDecisionPending) return;
                    dispatch({ type: 'PRIORITISE_QUEUE_PARTY', partyId: party.partyId });
                  }}
                  style={{
                    ...TYPOGRAPHY.control,
                    marginTop: 8,
                    padding: '6px 8px',
                    cursor: index === 0 || careerDecisionPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  Prioritise party {party.partyId}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p id={queuePriorityHelpId} style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Priority changes consideration order only; it does not seat a party immediately or move anyone physically in line, and may delay older parties.
        </p>
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

      <section aria-label="Ordered-dish blockers" style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Ordered-dish blockers</h4>
        <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
          <div style={statBox}>
            Eligible ordered dishes with no employed cook: {kitchenBlockers.noCook}
          </div>
          <div style={statBox}>
            Eligible ordered dishes with no compatible station: {kitchenBlockers.noCompatibleStation}
          </div>
        </div>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Counts include uncancelled ordered dishes belonging to active customers that are
          unassigned and unbatched. These are structural prerequisites only, not wait-time or
          ETA estimates or guarantees of order arrival or preparation; counts may overlap for
          the same dish.
        </p>
        {kitchenBlockers.byDish.length > 0 && (
          <ul aria-label="Blocked dishes" style={TYPOGRAPHY.secondary}>
            {kitchenBlockers.byDish.map(dish => (
              <li key={JSON.stringify([dish.menuItemId, dish.name])}>
                {dish.name} ({dish.menuItemId}): no employed cook: {dish.noCook}; no compatible station: {dish.noCompatibleStation}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Cleanup backlog" style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Cleanup backlog</h4>
        <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
          <div style={statBox}>Dirty tables awaiting cleaning: {cleanup.dirtyTables}</div>
          <div style={statBox}>Dirty items awaiting collection: {cleanup.dirtyAtTable}</div>
          <div style={statBox}>Carried dirty items: {cleanup.carriedDirty}</div>
          <div style={statBox}>Queued for washing: {cleanup.queuedForWash}</div>
          <div style={statBox}>Being washed: {cleanup.washing}</div>
        </div>
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Current counts, not clearance estimates. Dirty tables are not all unavailable tables. Floor messes and discarded food waste are excluded.
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
            {foodDeadline.knownCount > 0 && (
              <div style={statBox}>
                Earliest known food target: {formatFoodTarget(foodDeadline.target)}.
              </div>
            )}
            {foodTableId != null && (
              <button type="button" disabled={tableLocateDisabled}
                onClick={() => { if (!tableLocateDisabled) onLocateTable(foodTableId); }}
                style={{ ...TYPOGRAPHY.control, justifySelf: 'start' }}>
                Locate table
              </button>
            )}
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
            <ul
              aria-label="Pending food orders"
              style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
            >
              {foodTriage.orders.map((order, index) => {
                const locateDisabledForOrder = !canLocateFoodOrder(order);
                const customerLabel = order.customerId == null
                  ? 'food order'
                  : `guest ${order.customerId}`;
                return (
                  <li
                    key={JSON.stringify([
                      order.customerId, order.dishId, order.tableId, order.deadlineAt, index,
                    ])}
                    style={{ ...statBox, overflowWrap: 'anywhere', minWidth: 0 }}
                  >
                    <div>{formatFoodTarget(order)}</div>
                    <div>
                      {Number.isFinite(order.remainingSeconds)
                        ? `${formatExhaustionSeconds(order.remainingSeconds)} (game time remaining)`
                        : 'Timing unavailable'}
                    </div>
                    <div>
                      {order.stage === null
                        ? 'Food-service stage unavailable'
                        : `Food-service stage: ${FOOD_SERVICE_STAGE_LABELS[order.stage]}`}
                    </div>
                    {order.tableId != null && (
                      <button
                        type="button"
                        aria-label={`Locate table for ${customerLabel} at table ${order.tableId}`}
                        disabled={locateDisabledForOrder}
                        onClick={() => {
                          if (canLocateFoodOrder(order)) onLocateTable(order.tableId);
                        }}
                        style={{
                          ...TYPOGRAPHY.control,
                          marginTop: 8,
                          padding: '6px 8px',
                          maxWidth: '100%',
                          whiteSpace: 'normal',
                          overflowWrap: 'anywhere',
                          cursor: locateDisabledForOrder ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Locate {order.customerId == null ? 'table' : `guest ${order.customerId}`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {foodTriage.omittedCount > 0 && (
              <div style={statBox}>{foodTriage.omittedCount} pending food orders omitted.</div>
            )}
            <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
              Known deadlines are listed first; an unknown deadline is not a lower-urgency claim.
              Food-service stages are food-only and are not a delivery ETA.
            </p>
          </div>
        )}
        <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
          Based on recorded customer timers, not a delivery ETA. Delivered or cancelled outcomes are excluded; service-item reconciliation occurs in the simulation.
        </p>
        {locateMessage && <p role="status" style={TYPOGRAPHY.secondary}>{locateMessage}</p>}
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
        onClick={() => requestNewSandbox(dispatch)}
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
