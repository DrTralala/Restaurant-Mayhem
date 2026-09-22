import { useGameState } from '../state/GameContext';
import { OPENING_WEEK_SCENARIO } from '../data/careerScenarios';
import { getCareerSummary } from '../simulation/careerRun';
import { TYPOGRAPHY } from '../typography';

const buttonStyle = {
  ...TYPOGRAPHY.control, background: '#f0a500', color: '#111',
  border: '1px solid #0f3460', borderRadius: 4, padding: '8px 12px', cursor: 'pointer',
};

function remainingTime(seconds) {
  if (seconds <= 0) return 'Deadline reached';
  if (seconds < 60) return 'Under 1 minute';
  const minutes = Math.ceil(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return `${days} ${days === 1 ? 'day' : 'days'} ${hours} ${hours === 1 ? 'hour' : 'hours'} ${rest} ${rest === 1 ? 'minute' : 'minutes'}`;
}

function criterionText(criterion) {
  const isReputation = criterion.id === 'reputation';
  // Do not round a just-below-target reputation up into apparent success.
  const actual = isReputation
    ? (!criterion.passed && Number(criterion.actual.toFixed(2)) >= criterion.target
      ? String(criterion.actual) : criterion.actual.toFixed(2)) : criterion.actual;
  const target = isReputation ? criterion.target.toFixed(2) : criterion.target;
  const label = isReputation ? 'Reputation' : 'Paid meals';
  const status = criterion.passed ? 'met' : isReputation ? 'below target' : 'not met';
  return `${label}: ${actual} / ${target} — ${status}${criterion.provisional ? ' (provisional)' : ''}`;
}

export default function CareerPanel({ onStartRequested, onShowResult }) {
  const state = useGameState();
  const summary = getCareerSummary(state.careerRun, state.restaurant);
  const active = summary?.status === 'active';
  const continued = summary?.status === 'continued';
  const canStart = !summary || continued;
  const targets = OPENING_WEEK_SCENARIO.targets;

  return (
    <section style={{ ...TYPOGRAPHY.body, color: '#ccc', overflowWrap: 'anywhere' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginTop: 0 }}>Opening Week</h3>
      {continued && <p>Playing as sandbox</p>}
      <p>Seven full days: Day 1, 10:00 AM → Day 8, 10:00 AM.</p>
      {!summary && <ul>
        <li>Serve at least {targets.paidMeals} fulfilled, paid meals.</li>
        <li>Finish with at least {targets.reputation.toFixed(2)} reputation.</li>
      </ul>}

      {summary?.criteria && <div style={{
        background: '#1a1a2e', border: '1px solid #0f3460', borderRadius: 8, padding: 12,
      }}>
        {!active && <p style={{ marginTop: 0 }}>Archived result: {summary.criteria.every(c => c.passed)
          ? 'both targets met' : 'target missed'}</p>}
        <ul aria-label={active ? 'Provisional Opening Week goals' : 'Archived Opening Week results'}
          style={{ margin: 0, paddingLeft: 20 }}>
          {summary.criteria.map(criterion => <li key={criterion.id}>{criterionText(criterion)}</li>)}
        </ul>
        {active && <p>Remaining: {remainingTime(summary.remainingSeconds)}</p>}
        <p style={{ marginBottom: 0 }}>{active ? 'Deadline' : 'Evaluated'}: Day 8, 10:00 AM</p>
      </div>}

      {summary?.issue && <p>
        Opening Week progress cannot be verified. This is not a win or loss.
        {!continued && ' Continue this restaurant as sandbox, or start a new run.'}
      </p>}

      <p>One meal counts per customer when a dish was delivered, not cancelled, and checked out
        with a positive dish charge by the deadline. Delivery alone is not payment.</p>
      <p>Drinks, free dishes, tips and bonuses do not count.</p>
      <p>Reputation is checked at the end using the game’s existing reputation score.
        No early victory: reaching either target early is provisional.</p>
      <p>Debt and profit are not scored. Negative funds or one star do not end the run.</p>
      {active && <p>Closing this panel does not pause. Your pause and speed controls remain available.
        Closing the restaurant does not pause the deadline.</p>}

      {summary?.needsDecision && <button type="button" style={buttonStyle}
        onClick={() => onShowResult?.()}>
        {summary.issue ? 'Show recovery options' : 'Show result'}
      </button>}

      {canStart && <>
        <p>Start with the normal restaurant: $600, one star, starter staff, fixtures, menu and equipment,
          open 24/7. Play starts immediately, unpaused at 1×.</p>
        <p style={TYPOGRAPHY.secondary}>
          Starting replaces your current restaurant and its local autosave. No backup is created.
          Repository Save game is available only on the development server; if available,
          cancel and save first to keep a separate copy. Cancel keeps this restaurant.
        </p>
        <button type="button" style={buttonStyle} onClick={() => onStartRequested?.()}>
          Start Opening Week
        </button>
      </>}
    </section>
  );
}
