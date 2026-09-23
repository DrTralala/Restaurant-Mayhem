import { useState } from 'react';
import { useGameState, useDispatch } from '../state/GameContext';
import { SERVICE_CONTRACT_PREP_SECONDS } from '../data/serviceContracts';
import { selectServiceContractView } from '../simulation/serviceContracts';
import { secondsToGameTime } from '../simulation/clock';
import { TYPOGRAPHY } from '../typography';

const cardStyle = { background: '#1a1a2e', border: '1px solid #0f3460', borderRadius: 8,
  padding: 12, marginBottom: 12 };
const buttonStyle = { ...TYPOGRAPHY.control, background: '#f0a500', color: '#1a1a2e',
  border: '1px solid #f0a500', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' };
const secondaryStyle = { ...TYPOGRAPHY.secondary, color: '#bbb' };
const controlsStyle = { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 };
const summaryStyle = { ...TYPOGRAPHY.control, cursor: 'pointer', padding: '8px 0', color: '#ddd' };
const descriptions = {
  'office-lunch': 'A timed lunch for guests in a hurry.',
  'family-service': 'Two family groups looking for affordable meals.',
  'tasting-service': 'Individual visits from food-loving guests.',
  'party-rush': 'Twelve guests arrive in a four-minute burst. Prepare for a busy queue.',
};
const money = value => `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
const blockedLabels = {
  unknown_template: 'Unknown contract', active_contract: 'Finish or withdraw the active contract first',
  used_today: 'Available next day', invalid_clock: 'The game clock cannot start a contract',
  serial_exhausted: 'Contract instance limit reached — no further contracts can be accepted in this save',
  navigation_fault: 'Resolve the navigation fault before accepting',
  career_decision: 'Choose Continue in Opening Week before accepting',
};
const warningLabels = {
  closed_at_arrival: 'Your current opening hours are closed for one or more arrivals.',
  queue_full: 'The queue is already full.', no_affordable_dish: 'No current dish is affordable for these guests.',
  no_suitable_table: 'No placed table has enough associated chairs for the largest party.',
  no_cook: 'No cook is employed.', no_waiter: 'No waiter is employed.',
  no_staffed_checkout: 'No checkout has an assigned waiter.',
};
const statusLabels = { scheduled: 'Scheduled', pending: 'Awaiting meal and payment',
  fulfilled_paid: 'Fulfilled and paid', not_fulfilled: 'Not fulfilled', failed: 'Failed',
  missed: 'Missed', unfinished: 'Unfinished', withdrawn: 'Withdrawn', succeeded: 'Succeeded' };
const reasonLabels = { drink_only: 'Drink-only visit', food_cancelled: 'Food cancelled',
  unverified_food: 'No verified paid food', menu_unaffordable: 'No affordable order', abandoned: 'Left the queue',
  closed: 'Restaurant closed', left_unpaid: 'Left without payment', missing_guest: 'Guest no longer present',
  missed_closed: 'Closed at arrival', missed_queue_full: 'Queue full at arrival',
  missed_identity_conflict: 'Booking identity conflict', missed_resume: 'Arrival passed before resume',
  deadline: 'Payment not completed by the deadline', withdrawn: 'Contract withdrawn' };

function timeLabel(state, time) {
  const day = state.restaurant.day + Math.floor(time / 86400) - Math.floor(state.restaurant.gameTime / 86400);
  return `Day ${day}, ${secondsToGameTime(time)}`;
}

function ActionButton({ children, disabled, ...props }) {
  return <button type="button" {...props} disabled={disabled}
    style={{ ...buttonStyle, ...(disabled ? { opacity: 0.55, cursor: 'not-allowed' } : {}) }}>{children}</button>;
}

function GuestOutcome({ guest, label }) {
  return <li style={{ margin: '4px 0' }}>
    {label} — {statusLabels[guest.status]}{guest.reason ? `: ${reasonLabels[guest.reason]}` : ''}
  </li>;
}

function MealRule({ id }) {
  return <p id={id} style={secondaryStyle}>A fulfilled meal needs delivered food and completed checkout with a positive
    dish charge by the deadline. Drinks, cancelled food and unpaid meals do not count. Guests choose affordable
    menu options and may order only drinks. Meal takings and normal guest reactions are separate from contract terms.</p>;
}

function ContractLiability({ terms }) {
  return terms.deposit === 0
    ? <p style={secondaryStyle}>Original terms: no deposit or contract penalty. Failure or withdrawal forfeits the reward.</p>
    : <p style={{ color: '#f3b1b6' }}>Failure or withdrawal: repay {money(terms.deposit)} + {money(terms.compensation)} compensation
      {' = '}{money(terms.deposit + terms.compensation)} deducted, plus −{terms.reputationPenalty} reputation (minimum 1).
      Applies including during preparation, even if funds go negative.</p>;
}

export default function ServiceContractsPanel() {
  const state = useGameState();
  const dispatch = useDispatch();
  const [reviewing, setReviewing] = useState(null);
  const [withdrawing, setWithdrawing] = useState(null);
  const { active, offers } = selectServiceContractView(state);
  const decisionPending = state.careerRun?.needsDecision === true;
  const deadlineReached = active && state.restaurant.gameTime >= active.deadlineAt;
  // This live region changes only for phases and party admission, not
  // every game-second countdown or individual progress update.
  const announcement = active
    ? `${active.title}: ${active.phase === 'preparing' ? 'Preparing' : 'Service'}. ${active.parties.map((party, index) =>
      `Party ${index + 1}: ${party.status}`).join('. ')}.`
    : '';

  return <div style={{ ...TYPOGRAPHY.body, background: '#16213e', color: '#ddd', minWidth: 0, overflowWrap: 'anywhere' }}>
    <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: '0 0 12px' }}>Service contracts</h3>
    <p style={secondaryStyle}>Book extra guests for a reward. One contract at a time, one attempt per offer each day.
      Walk-ins continue; tables and staff are not reserved.</p>
    {decisionPending && <p style={{ color: '#f0a500' }}>Contract paused — choose Continue in Opening Week to resume</p>}
    <div role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1,
      overflow: 'hidden', clipPath: 'inset(50%)' }}>{announcement}</div>

    {active && <section aria-label="Active contract" style={{ ...cardStyle, borderColor: '#f0a500', marginTop: 12 }}>
      <h4 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: '0 0 8px' }}>Active: {active.title}</h4>
      <p>{active.phase === 'preparing' ? `Preparing — ${Math.ceil(active.preparationSeconds / 60)} game minutes until service`
        : `Service — ${Math.ceil(active.remainingSeconds / 60)} game minutes remaining`}</p>
      <p>Next arrival: {active.nextArrivalAt === null ? 'All bookings attempted' : timeLabel(state, active.nextArrivalAt)}</p>
      <p>Deadline: {timeLabel(state, active.deadlineAt)}</p>
      {deadlineReached && <p>Deadline reached — resume the simulation to settle this contract.</p>}
      <p>{active.fulfilledCount}/{active.target} fulfilled meals</p>
      <progress aria-label="Fulfilled meals" aria-describedby="contract-meal-rule"
        value={active.fulfilledCount} max={active.target} style={{ width: '100%', accentColor: '#f0a500' }} />
      <p style={secondaryStyle}>{active.admittedCount}/{active.totalGuests} admitted · {active.unresolvedCount} unresolved
        {' · '}{active.failedCount} failed · {active.missedCount} missed</p>
      <p style={secondaryStyle}>{active.terms.deposit > 0
        ? `Deposit received: ${money(active.terms.deposit)} · Success balance: ${money(active.terms.balance)}`
        : `Reward on success: ${money(active.terms.balance)} · Original no-deposit terms`}</p>
      {active.targetMet && <p style={{ color: '#8cba9d' }}>Target met — {money(active.terms.balance)} balance settles at {timeLabel(state, active.deadlineAt)}.</p>}
      <details style={{ marginBottom: 8 }}><summary style={summaryStyle}>Guest details</summary>
      <MealRule id="contract-meal-rule" />
      {active.parties.map((party, index) => <div key={party.partyId} style={{ borderTop: '1px solid #0f3460', paddingTop: 8 }}>
        <strong>Party {index + 1}: {party.partyType}, {party.size} guests — {timeLabel(state, party.arrivalAt)}</strong>
        <ul style={{ paddingLeft: 20 }}>{active.guests.filter(guest => guest.partyId === party.partyId)
          .map(guest => <GuestOutcome key={guest.guestId} guest={guest} label={guest.label} />)}</ul>
      </div>)}
      </details>
      {withdrawing === active.instanceId ? <div role="group" aria-label="Confirm contract withdrawal">
        <ContractLiability terms={active.terms} />
        <p>Withdraw this contract? Existing guests remain, and their service continues.
          This uses today’s attempt.</p>
        <div style={controlsStyle}>
          <ActionButton disabled={decisionPending || deadlineReached} onClick={() => {
            if (!decisionPending && !deadlineReached) dispatch({ type: 'WITHDRAW_SERVICE_CONTRACT', instanceId: active.instanceId });
            setWithdrawing(null);
          }}>Confirm withdrawal</ActionButton>
          <ActionButton onClick={() => setWithdrawing(null)}>Keep contract</ActionButton>
        </div>
      </div> : <ActionButton disabled={decisionPending || deadlineReached} onClick={() => setWithdrawing(active.instanceId)}>Withdraw contract</ActionButton>}
    </section>}

    <h4 style={{ ...TYPOGRAPHY.control, color: '#bbb', margin: '16px 0 10px' }}>Contract offers</h4>
    {offers.map(({ template, preview, terms, canAccept, blockedReason, warnings }) => <section key={template.id}
      aria-label={`${template.title} offer`} style={cardStyle}>
      <h4 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', margin: '0 0 8px' }}>{template.title}</h4>
      <p style={{ ...secondaryStyle, margin: '4px 0 8px' }}>{descriptions[template.id]}</p>
      <p style={{ margin: '8px 0' }}>{template.parties.reduce((n, party) => n + party.size, 0)} guests · {template.target} paid meals needed</p>
      <p style={{ ...secondaryStyle, margin: '8px 0' }}>{SERVICE_CONTRACT_PREP_SECONDS / 60} game minutes to prepare · {template.serviceDuration / 60} game minutes of service</p>
      <p style={{ color: '#f0a500', margin: '8px 0', fontWeight: 600 }}>{money(template.reward)} total reward · {money(terms.deposit)} deposit upfront</p>
      <p style={{ ...secondaryStyle, color: '#f3b1b6', margin: '8px 0' }}>Failure / withdrawal: {money(terms.deposit + terms.compensation)} deducted · −{terms.reputationPenalty} reputation</p>
      <details><summary style={summaryStyle}>Details</summary>
      <p style={secondaryStyle}>{template.profile.archetype} · {template.profile.spendingTier} · {money(template.profile.spendingBudget)} budget per guest</p>
      <ol style={{ paddingLeft: 20 }}>{template.parties.map((party, index) => <li key={index} style={{ marginBottom: 6 }}>
        Arrival {index + 1}: {party.partyType}, {party.size} {party.size === 1 ? 'guest' : 'guests'} · {party.arrivalOffset / 60} game minutes after service starts
        {preview && <span style={{ ...secondaryStyle, display: 'block' }}>{timeLabel(state, preview.partyArrivals[index])}</span>}
      </li>)}</ol>
      {preview && <p style={secondaryStyle}>Projected start: {timeLabel(state, preview.serviceStartAt)}.
        {' '}Deadline: {timeLabel(state, preview.deadlineAt)}.</p>}
      <MealRule />
      <ContractLiability terms={terms} />
      </details>
      {warnings.length > 0 && <div style={{ ...secondaryStyle, borderLeft: '2px solid #f0a500', paddingLeft: 10 }}><strong>Check before accepting:</strong>
        <ul style={{ paddingLeft: 20 }}>{warnings.map(warning => <li key={warning}>{warningLabels[warning]}</li>)}</ul>
        <p>Advisory only — acceptance is still allowed.</p>
      </div>}
      {blockedReason && <p>{blockedLabels[blockedReason]}</p>}
      {reviewing === template.id ? <div role="group" aria-label={`Confirm ${template.title}`}>
        <p>Receive {money(terms.deposit)} now and {money(terms.balance)} on success at the deadline.</p>
        <ContractLiability terms={terms} />
        <p>Start preparation now? Arrival and deadline times are calculated again when you accept.</p>
        <div style={controlsStyle}>
          <ActionButton disabled={!canAccept} onClick={() => {
            if (canAccept) dispatch({ type: 'ACCEPT_SERVICE_CONTRACT', templateId: template.id });
            setReviewing(null);
          }}>Accept and start preparation</ActionButton>
          <ActionButton onClick={() => setReviewing(null)}>Cancel acceptance</ActionButton>
        </div>
      </div> : <ActionButton disabled={!canAccept} onClick={() => setReviewing(template.id)}>Review {template.title}</ActionButton>}
    </section>)}
  </div>;
}

export function ServiceContractTracker({ onOpen }) {
  const state = useGameState();
  const { active } = selectServiceContractView(state);
  if (!active) return null;
  return <aside aria-label="Service contract tracker" style={{ ...TYPOGRAPHY.secondary, background: '#16213e',
    color: '#ddd', border: '1px solid #f0a500', borderRadius: 8, padding: 8,
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
    <span>{active.title} · {active.decisionPending ? 'Paused for Opening Week' : active.phase === 'preparing'
      ? 'Preparing' : `${Math.ceil(active.remainingSeconds / 60)} game minutes remaining`}
      {' · '}{active.fulfilledCount}/{active.target} fulfilled</span>
    <ActionButton onClick={onOpen}>View contracts</ActionButton>
  </aside>;
}
