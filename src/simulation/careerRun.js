import { getCareerScenario, OPENING_WEEK_SCENARIO } from '../data/careerScenarios';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' && value.trim().length > 0;
const isNullableId = value => value === null || isId(value);
const isCounter = value => Number.isSafeInteger(value) && value >= 0;
const isAmount = value => Number.isFinite(value) && value >= 0;
const isReputation = value => Number.isFinite(value) && value >= 1 && value <= 5;
const isIssue = value => ['invalid-career-data', 'unsupported-career-version'].includes(value);

export function createCareerRun({ scenarioId, runId, startedAt, paidVisitSequence = 0 }) {
  const scenario = getCareerScenario(scenarioId);
  if (!scenario || !isId(runId) || startedAt !== scenario.startAt || !isCounter(paidVisitSequence)) {
    throw new Error('Invalid Opening Week creation');
  }
  return {
    schemaVersion: 1, runId, scenarioId, scenarioRevision: scenario.revision,
    status: 'active', startedAt, deadlineAt: startedAt + scenario.durationSeconds,
    targets: scenario.targets, paidMeals: 0, lastPaidVisitSequence: paidVisitSequence,
    needsDecision: false, result: null, issue: null,
  };
}

// Validate the consumer boundary without importing another feature's catalogue.
// The shared producer additionally validates canonical cookbook/contract identities.
function isPaidVisit(outcome) {
  if (!isRecord(outcome) || outcome.schemaVersion !== 1
    || !isCounter(outcome.sequence) || outcome.sequence === 0
    || !isId(outcome.customerId) || !isId(outcome.partyId) || !isAmount(outcome.paidAt)
    || !['ordered', null].includes(outcome.menuOutcome)
    || !['delivered', 'cancelled', 'pending', 'none', 'unknown'].includes(outcome.foodOutcome)
    || !isNullableId(outcome.serviceContractId) || !isNullableId(outcome.serviceContractGuestId)
    || !isAmount(outcome.subtotal) || !isAmount(outcome.tip) || !isAmount(outcome.totalPaid)
    || outcome.totalPaid !== outcome.subtotal + outcome.tip) return false;
  const dish = outcome.dish;
  if (dish === null) return !['delivered', 'cancelled', 'pending'].includes(outcome.foodOutcome);
  if (!isRecord(dish) || !isNullableId(dish.serviceItemId) || !isId(dish.menuItemId)
    || !isNullableId(dish.cookbookId)
    || !(dish.priceAtOrder === null || isAmount(dish.priceAtOrder))
    || !isAmount(dish.chargedAmount) || dish.chargedAmount > outcome.subtotal
    || typeof dish.fulfilled !== 'boolean' || typeof dish.paid !== 'boolean'
    || (dish.fulfilled && outcome.foodOutcome !== 'delivered')
    || dish.paid !== (dish.fulfilled && dish.chargedAmount > 0)) return false;
  return outcome.foodOutcome !== 'cancelled'
    || (dish.chargedAmount === 0 && !dish.fulfilled && !dish.paid);
}

export function applyCareerPaidVisit(run, outcome) {
  if (!run || run.status !== 'active') return run;
  if (!isPaidVisit(outcome)) throw new Error('Invalid canonical paid visit');
  if (outcome.sequence <= run.lastPaidVisitSequence) return run;
  const qualifies = outcome.paidAt >= run.startedAt && outcome.paidAt <= run.deadlineAt
    && outcome.foodOutcome === 'delivered' && outcome.dish?.fulfilled === true
    && outcome.dish.paid === true && outcome.dish.chargedAmount > 0;
  const paidMeals = run.paidMeals + (qualifies ? 1 : 0);
  if (!isCounter(paidMeals)) throw new Error('Opening Week meal counter exhausted');
  return { ...run, paidMeals, lastPaidVisitSequence: outcome.sequence };
}

function getCriteria(run, reputation) {
  return [
    { id: 'paid-meals', actual: run.paidMeals, target: run.targets.paidMeals,
      passed: run.paidMeals >= run.targets.paidMeals },
    { id: 'reputation', actual: reputation, target: run.targets.reputation,
      passed: reputation >= run.targets.reputation },
  ];
}

function freezeResult(outcome, evaluatedAt, criteria) {
  return Object.freeze({ outcome, evaluatedAt,
    criteria: Object.freeze(criteria.map(criterion => Object.freeze({
      id: criterion.id, actual: criterion.actual, target: criterion.target, passed: criterion.passed,
    }))),
  });
}

export function evaluateCareerRun(run, { gameTime, reputation }) {
  if (!run || run.status !== 'active') return run;
  if (!isAmount(gameTime)) throw new Error('Invalid career evaluation time');
  if (gameTime < run.deadlineAt) return run;
  if (gameTime > run.deadlineAt) {
    return { ...run, status: 'invalid', result: null, needsDecision: true, issue: 'invalid-career-data' };
  }
  if (!isReputation(reputation)) throw new Error('Invalid career evaluation reputation');
  const criteria = getCriteria(run, reputation);
  const status = criteria.every(criterion => criterion.passed) ? 'won' : 'lost';
  return { ...run, status, needsDecision: true,
    result: freezeResult(status, gameTime, criteria),
  };
}

export function continueCareerAsSandbox(run) {
  if (!run || !['won', 'lost', 'invalid'].includes(run.status)) return run;
  return { ...run, status: 'continued', needsDecision: false };
}

function invalidRun(issue, paidVisitSequence) {
  return {
    ...createCareerRun({ scenarioId: OPENING_WEEK_SCENARIO.id, runId: 'invalid-career',
      startedAt: OPENING_WEEK_SCENARIO.startAt,
      paidVisitSequence: isCounter(paidVisitSequence) ? paidVisitSequence : 0 }),
    status: 'invalid', needsDecision: true, issue,
  };
}

function validResult(run) {
  const result = run.result;
  if (!isRecord(result) || !['won', 'lost'].includes(result.outcome)
    || result.evaluatedAt !== run.deadlineAt
    || !Array.isArray(result.criteria) || result.criteria.length !== 2) return false;
  const [meals, reputation] = result.criteria;
  if (!isRecord(meals) || !isRecord(reputation) || !isReputation(reputation.actual)) return false;
  const expected = getCriteria(run, reputation.actual);
  return result.criteria.every((criterion, index) => {
    const target = expected[index];
    return criterion.id === target.id && criterion.actual === target.actual
      && criterion.target === target.target && criterion.passed === target.passed;
  }) && result.outcome === (expected.every(criterion => criterion.passed) ? 'won' : 'lost');
}

function validRun(raw, { gameTime, paidVisitSequence }) {
  const scenario = getCareerScenario(raw.scenarioId, raw.scenarioRevision);
  if (!scenario || raw.scenarioRevision !== scenario.revision
    || !isId(raw.runId) || raw.startedAt !== scenario.startAt
    || raw.deadlineAt !== scenario.startAt + scenario.durationSeconds
    || !isRecord(raw.targets) || raw.targets.paidMeals !== scenario.targets.paidMeals
    || raw.targets.reputation !== scenario.targets.reputation
    || !isCounter(raw.paidMeals) || !isCounter(raw.lastPaidVisitSequence)
    || !isCounter(paidVisitSequence) || raw.lastPaidVisitSequence > paidVisitSequence
    || raw.paidMeals > raw.lastPaidVisitSequence || !isAmount(gameTime)) return false;
  if (raw.status === 'active') {
    return raw.result === null && raw.issue === null && raw.needsDecision === false
      && gameTime >= raw.startedAt && gameTime <= raw.deadlineAt;
  }
  if (raw.status === 'invalid' || (raw.status === 'continued' && raw.result === null)) {
    return raw.result === null && isIssue(raw.issue)
      && raw.needsDecision === (raw.status === 'invalid');
  }
  if (['won', 'lost', 'continued'].includes(raw.status)) {
    return raw.issue === null && validResult(raw)
      && raw.needsDecision === (raw.status !== 'continued')
      && (raw.status === 'continued' ? gameTime >= raw.deadlineAt
        : gameTime === raw.deadlineAt && raw.status === raw.result.outcome);
  }
  return false;
}

export function normaliseCareerRun(raw, { gameTime, paidVisitSequence }) {
  if (raw == null) return { run: null, warning: null };
  const unsupported = isRecord(raw) && ((raw.schemaVersion !== undefined && raw.schemaVersion !== 1)
    || (raw.scenarioRevision !== undefined && raw.scenarioRevision !== 1));
  if (unsupported || !isRecord(raw) || raw.schemaVersion !== 1
    || !validRun(raw, { gameTime, paidVisitSequence })) {
    const warning = unsupported ? 'unsupported-career-version' : 'invalid-career-data';
    return { run: invalidRun(warning, paidVisitSequence), warning };
  }
  // Copy only the bounded durable schema: never retain checkpoint/event-history extras.
  const run = {
    schemaVersion: 1, runId: raw.runId, scenarioId: raw.scenarioId,
    scenarioRevision: raw.scenarioRevision, status: raw.status,
    startedAt: raw.startedAt, deadlineAt: raw.deadlineAt,
    targets: OPENING_WEEK_SCENARIO.targets, paidMeals: raw.paidMeals,
    lastPaidVisitSequence: raw.lastPaidVisitSequence, needsDecision: raw.needsDecision,
    result: raw.result === null ? null
      : freezeResult(raw.result.outcome, raw.result.evaluatedAt, raw.result.criteria),
    issue: raw.issue,
  };
  return { run, warning: run.issue };
}

export function getCareerSummary(run, { gameTime, reputation }) {
  if (!run) return null;
  return {
    title: OPENING_WEEK_SCENARIO.title, status: run.status, deadlineAt: run.deadlineAt,
    remainingSeconds: Math.max(0, run.deadlineAt - gameTime),
    criteria: run.status === 'active'
      ? getCriteria(run, reputation).map(criterion => ({ ...criterion, provisional: true }))
      : run.result?.criteria ?? null,
    needsDecision: run.needsDecision, issue: run.issue,
  };
}

export function isCareerDecisionPending(state) {
  return state?.careerRun?.needsDecision === true;
}
