import { describe, expect, it } from 'vitest';
import { getCareerScenario, OPENING_WEEK_SCENARIO } from '../data/careerScenarios';
import {
  applyCareerPaidVisit, continueCareerAsSandbox, createCareerRun,
  evaluateCareerRun, getCareerSummary, isCareerDecisionPending, normaliseCareerRun,
} from './careerRun';

const fresh = (overrides = {}) => createCareerRun({
  scenarioId: 'opening-week', runId: 'attempt-1', startedAt: 36000, ...overrides,
});
const visit = (overrides = {}) => ({
  schemaVersion: 1, sequence: 1, customerId: 'guest-1', partyId: 'party-1', paidAt: 36001,
  menuOutcome: 'ordered', foodOutcome: 'delivered', serviceContractId: null,
  serviceContractGuestId: null,
  dish: { serviceItemId: 'dish-1', menuItemId: 'custom-toast', cookbookId: null,
    priceAtOrder: 5, chargedAmount: 5, fulfilled: true, paid: true },
  subtotal: 7, tip: 1, totalPaid: 8, ...overrides,
});
// Synthetic predicate fixtures, not attainability/balance evidence.
const scored = (paidMeals = 80, reputation = 2) => evaluateCareerRun({
  ...fresh(), paidMeals, lastPaidVisitSequence: 100,
}, { gameTime: 640800, reputation });
const normalise = (run, options = {}) => normaliseCareerRun(run, {
  gameTime: 640800, paidVisitSequence: 100, ...options,
});

describe('Opening Week creation', () => {
  it('creates the seven-full-day scenario with independent attempt identity and zero progress', () => {
    expect(fresh({ paidVisitSequence: 12 })).toEqual({
      schemaVersion: 1, runId: 'attempt-1', scenarioId: 'opening-week', scenarioRevision: 1,
      status: 'active', startedAt: 36000, deadlineAt: 640800,
      targets: { paidMeals: 80, reputation: 2 }, paidMeals: 0,
      lastPaidVisitSequence: 12, needsDecision: false, result: null, issue: null,
    });
    expect(fresh({ runId: 'attempt-2' }).runId).toBe('attempt-2');
  });
  it('exposes only the supported deeply immutable serialisable scenario', () => {
    expect(getCareerScenario('opening-week')).toBe(OPENING_WEEK_SCENARIO);
    expect(getCareerScenario('opening-week', 2)).toBeNull();
    expect(getCareerScenario('unknown')).toBeNull();
    expect(Object.isFrozen(OPENING_WEEK_SCENARIO)).toBe(true);
    expect(Object.isFrozen(OPENING_WEEK_SCENARIO.targets)).toBe(true);
    expect(JSON.parse(JSON.stringify(OPENING_WEEK_SCENARIO))).toEqual({
      id: 'opening-week', revision: 1, title: 'Opening Week', startAt: 36000,
      durationSeconds: 604800, targets: { paidMeals: 80, reputation: 2 },
    });
  });
  it.each([
    { scenarioId: 'unknown' }, { runId: '' }, { runId: ' ' }, { startedAt: 0 },
    { startedAt: 36001 }, { paidVisitSequence: -1 }, { paidVisitSequence: 1.5 },
    { paidVisitSequence: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid creation %j', overrides => expect(() => fresh(overrides)).toThrow());
});

describe('single canonical paid visits', () => {
  it('counts custom and authored dishes per member, without mutating input', () => {
    const run = Object.freeze(fresh());
    const first = applyCareerPaidVisit(run, Object.freeze(visit()));
    const second = applyCareerPaidVisit(first, visit({ sequence: 2, customerId: 'guest-2',
      dish: { ...visit().dish, cookbookId: 'toast' },
    }));
    expect(run.paidMeals).toBe(0);
    expect(second).toMatchObject({ paidMeals: 2, lastPaidVisitSequence: 2, status: 'active' });
  });
  it.each([
    [35999.999, 0], [36000, 1], [640800, 1], [640800.001, 0],
  ])('checkout at %s yields %s meals', (paidAt, count) => {
    expect(applyCareerPaidVisit(fresh(), visit({ paidAt })).paidMeals).toBe(count);
  });
  it.each([
    ['drinks only', { dish: null, foodOutcome: 'none' }],
    ['cancelled food', { foodOutcome: 'cancelled', dish: { ...visit().dish,
      chargedAmount: 0, fulfilled: false, paid: false } }],
    ['free dish', { dish: { ...visit().dish, chargedAmount: 0, paid: false } }],
    ['unknown legacy facts', { foodOutcome: 'unknown', dish: { ...visit().dish,
      serviceItemId: null, priceAtOrder: null, fulfilled: false, paid: false } }],
    ['pending food', { foodOutcome: 'pending', dish: { ...visit().dish,
      fulfilled: false, paid: false } }],
    ['no order', { menuOutcome: null, foodOutcome: 'none', dish: null,
      subtotal: 0, tip: 0, totalPaid: 0 }],
  ])('%s does not count but advances the watermark', (_, overrides) => {
    expect(applyCareerPaidVisit(fresh(), visit(overrides))).toMatchObject({
      paidMeals: 0, lastPaidVisitSequence: 1,
    });
  });
  it('ignores repeats/stale events, accepts gaps, and advances over ineligible visits', () => {
    const first = applyCareerPaidVisit(fresh(), visit({ sequence: 3, dish: null, foodOutcome: 'none' }));
    expect(applyCareerPaidVisit(first, visit({ sequence: 3 }))).toBe(first);
    expect(applyCareerPaidVisit(first, visit({ sequence: 2 }))).toBe(first);
    expect(applyCareerPaidVisit(first, visit({ sequence: 7 }))).toMatchObject({
      paidMeals: 1, lastPaidVisitSequence: 7,
    });
  });
  it.each([
    null, {}, { ...visit(), schemaVersion: 2 }, { ...visit(), sequence: 0 },
    { ...visit(), sequence: 1.5 }, { ...visit(), customerId: '' },
    { ...visit(), partyId: '' }, { ...visit(), paidAt: Infinity },
    { ...visit(), menuOutcome: 'unaffordable' }, { ...visit(), foodOutcome: 'invalid' },
    { ...visit(), serviceContractId: '' }, { ...visit(), serviceContractGuestId: undefined },
    { ...visit(), subtotal: -1 }, { ...visit(), tip: NaN }, { ...visit(), totalPaid: 9 },
    { ...visit(), dish: { ...visit().dish, chargedAmount: 8 } },
    { ...visit(), dish: { ...visit().dish, chargedAmount: -1 } },
    { ...visit(), dish: { ...visit().dish, priceAtOrder: -1 } },
    { ...visit(), dish: { ...visit().dish, fulfilled: 'yes' } },
    { ...visit(), dish: { ...visit().dish, menuItemId: '' } },
    { ...visit(), dish: { ...visit().dish, cookbookId: '' } },
    { ...visit(), dish: { ...visit().dish, serviceItemId: undefined } },
    { ...visit(), dish: { ...visit().dish, fulfilled: false, paid: true } },
    { ...visit(), foodOutcome: 'cancelled' },
    { ...visit(), foodOutcome: 'unknown' },
  ])('rejects malformed/contradictory canonical input %# without partial credit', outcome => {
    const run = fresh();
    expect(() => applyCareerPaidVisit(run, outcome)).toThrow();
    expect(run).toMatchObject({ paidMeals: 0, lastPaidVisitSequence: 0 });
  });
  it('never credits or rewrites null, completed or continued runs', () => {
    expect(applyCareerPaidVisit(null, visit())).toBeNull();
    const terminal = scored();
    expect(applyCareerPaidVisit(terminal, visit({ sequence: 101 }))).toBe(terminal);
    const continued = continueCareerAsSandbox(terminal);
    expect(applyCareerPaidVisit(continued, visit({ sequence: 101 }))).toBe(continued);
  });
});

describe('deadline and continuation', () => {
  it.each([
    [80, 2, 'won', true, true], [79, 2, 'lost', false, true],
    [80, 1.999, 'lost', true, false], [79, 1.99, 'lost', false, false],
  ])('at deadline %s meals / %s reputation is %s', (count, reputation, outcome, mealsPass, repPass) => {
    expect(scored(count, reputation)).toMatchObject({
      status: outcome, needsDecision: true, issue: null,
      result: { outcome, evaluatedAt: 640800, criteria: [
        { id: 'paid-meals', actual: count, target: 80, passed: mealsPass },
        { id: 'reputation', actual: reputation, target: 2, passed: repPass },
      ] },
    });
  });
  it.each([[80, 5], [0, 1]])('has no early win, low-star or debt loss (%s/%s)', (paidMeals, reputation) => {
    const run = { ...fresh(), paidMeals, lastPaidVisitSequence: 80 };
    expect(evaluateCareerRun(run, { gameTime: 640799.999, reputation, funds: -10000 })).toBe(run);
  });
  it('does not invent historical reputation for an overdue run', () => {
    expect(evaluateCareerRun(fresh(), { gameTime: 640801, reputation: 5 })).toMatchObject({
      status: 'invalid', result: null, needsDecision: true, issue: 'invalid-career-data',
    });
  });
  it('freezes both criteria and never reevaluates terminal/continued snapshots', () => {
    const terminal = scored(79, 2.13);
    expect(Object.isFrozen(terminal.result)).toBe(true);
    expect(Object.isFrozen(terminal.result.criteria)).toBe(true);
    expect(Object.isFrozen(terminal.result.criteria[0])).toBe(true);
    expect(evaluateCareerRun(terminal, { gameTime: 700000, reputation: 5 })).toBe(terminal);
    const continued = continueCareerAsSandbox(terminal);
    expect(continued).toEqual({ ...terminal, status: 'continued', needsDecision: false });
    expect(continued.result).toBe(terminal.result);
    expect(evaluateCareerRun(continued, { gameTime: 800000, reputation: 1 })).toBe(continued);
    expect(continueCareerAsSandbox(continued)).toBe(continued);
    expect(isCareerDecisionPending({ careerRun: terminal })).toBe(true);
    expect(isCareerDecisionPending({ careerRun: continued, paused: true, navigationFault: {} })).toBe(false);
    expect(isCareerDecisionPending({})).toBe(false);
  });
  it('does not continue an active run or create one from sandbox', () => {
    const run = fresh();
    expect(continueCareerAsSandbox(run)).toBe(run);
    expect(continueCareerAsSandbox(null)).toBeNull();
    expect(evaluateCareerRun(null, { gameTime: 640800, reputation: 2 })).toBeNull();
  });
  it.each([NaN, Infinity, 0, 5.01])('rejects unsupported reputation at evaluation: %s', reputation => {
    expect(() => evaluateCareerRun(fresh(), { gameTime: 640800, reputation })).toThrow();
  });
});

describe('saved career branch normalisation', () => {
  it.each([undefined, null])('leaves absent career %s as sandbox', raw => {
    expect(normalise(raw)).toEqual({ run: null, warning: null });
  });
  it.each([36000, 50000, 640800])('retains valid active progress at %s without evaluation or replay', gameTime => {
    const raw = { ...fresh(), paidMeals: 3, lastPaidVisitSequence: 4 };
    expect(normalise(raw, { gameTime })).toEqual({ run: raw, warning: null });
  });
  it('does not silently default a missing saved scenario revision to v1', () => {
    const raw = fresh();
    delete raw.scenarioRevision;
    expect(normalise(raw)).toMatchObject({
      run: { status: 'invalid', result: null, issue: 'invalid-career-data' },
      warning: 'invalid-career-data',
    });
  });
  it.each([
    { schemaVersion: 2 }, { schemaVersion: '1' }, { scenarioRevision: 2 },
  ])('unsupported version/revision %j becomes bounded non-scoring invalid data', overrides => {
    const { run, warning } = normalise({ ...fresh(), ...overrides });
    expect(warning).toBe('unsupported-career-version');
    expect(run).toMatchObject({ status: 'invalid', runId: 'invalid-career', result: null,
      needsDecision: true, issue: 'unsupported-career-version', paidMeals: 0,
      lastPaidVisitSequence: 100, startedAt: 36000, deadlineAt: 640800,
    });
    expect(normalise(run)).toEqual({ run, warning });
  });
  it.each([
    42, [], {}, { ...fresh(), runId: '' }, { ...fresh(), scenarioId: 'other' },
    { ...fresh(), startedAt: 0 }, { ...fresh(), deadlineAt: 640801 },
    { ...fresh(), targets: { paidMeals: 1, reputation: 2 } },
    { ...fresh(), paidMeals: -1 }, { ...fresh(), paidMeals: 1.5 },
    { ...fresh(), paidMeals: Number.MAX_SAFE_INTEGER + 1 },
    { ...fresh(), paidMeals: 2, lastPaidVisitSequence: 1 },
    { ...fresh(), lastPaidVisitSequence: 101 },
    { ...fresh(), lastPaidVisitSequence: -1 }, { ...fresh(), needsDecision: true },
    { ...fresh(), status: 'won' }, { ...fresh(), issue: 'invalid-career-data' },
    { ...fresh(), result: { outcome: 'won' } },
  ])('corruption %# never awards a result or throws away the restaurant', raw => {
    const { run, warning } = normalise(raw);
    expect(warning).toBe('invalid-career-data');
    expect(run).toEqual({
      schemaVersion: 1, runId: 'invalid-career', scenarioId: 'opening-week', scenarioRevision: 1,
      status: 'invalid', startedAt: 36000, deadlineAt: 640800,
      targets: { paidMeals: 80, reputation: 2 }, paidMeals: 0, lastPaidVisitSequence: 100,
      needsDecision: true, result: null, issue: 'invalid-career-data',
    });
    expect(normalise(run)).toEqual({ run, warning });
  });
  it.each([35999, 640801, NaN])('invalid active clock %s cannot repair or extend the run', gameTime => {
    expect(normalise(fresh(), { gameTime }).run.status).toBe('invalid');
  });
  it.each([-1, 0.5, Infinity])('rejects invalid root sequence %s gracefully in this optional branch', paidVisitSequence => {
    expect(normalise(fresh(), { paidVisitSequence }).run).toMatchObject({
      status: 'invalid', lastPaidVisitSequence: 0,
    });
  });
  it.each(['won', 'lost'])('retains a %s result through JSON and Continue without a live reputation', status => {
    const terminal = scored(status === 'won' ? 80 : 79, 2.13);
    const raw = JSON.parse(JSON.stringify(terminal));
    expect(normalise(raw)).toEqual({ run: terminal, warning: null });
    const continued = continueCareerAsSandbox(raw);
    expect(normalise(continued, { gameTime: 800000 })).toEqual({ run: continued, warning: null });
  });
  it.each([
    run => ({ ...run, needsDecision: false }),
    run => ({ ...run, status: 'lost' }),
    run => ({ ...run, paidMeals: 79 }),
    run => ({ ...run, result: { ...run.result, evaluatedAt: 640799 } }),
    run => ({ ...run, result: { ...run.result, criteria: run.result.criteria.slice(1) } }),
    run => ({ ...run, result: { ...run.result, criteria: [run.result.criteria[0],
      { id: 'reputation', actual: 1.999, target: 2, passed: true }] } }),
    run => ({ ...run, result: { ...run.result, criteria: [run.result.criteria[0],
      { id: 'reputation', actual: 6, target: 2, passed: true }] } }),
  ])('rejects contradictory frozen score %# rather than fixing thresholds', corrupt => {
    expect(normalise(corrupt(scored())).run.status).toBe('invalid');
  });
  it('keeps invalid continuation non-scoring, bounded and no longer gated', () => {
    const invalid = normalise({ checkpoint: { world: 'must not survive' } }).run;
    const continued = continueCareerAsSandbox(invalid);
    expect(continued).toEqual({ ...invalid, status: 'continued', needsDecision: false });
    expect(normalise(continued, { gameTime: 36000 })).toEqual({
      run: continued, warning: 'invalid-career-data',
    });
  });
  it('discards unrecognised nested data instead of retaining checkpoints', () => {
    const raw = { ...fresh(), checkpoint: { huge: 'world' }, eventHistory: [visit()] };
    expect(normalise(raw).run).toEqual(fresh());
  });
});

describe('summary selector', () => {
  it('returns null for sandbox and provisional live values before deadline', () => {
    expect(getCareerSummary(null, { gameTime: 36000, reputation: 1 })).toBeNull();
    expect(getCareerSummary({ ...fresh(), paidMeals: 80 }, { gameTime: 640799.5, reputation: 1.999 })).toEqual({
      title: 'Opening Week', status: 'active', deadlineAt: 640800, remainingSeconds: 0.5,
      criteria: [
        { id: 'paid-meals', actual: 80, target: 80, passed: true, provisional: true },
        { id: 'reputation', actual: 1.999, target: 2, passed: false, provisional: true },
      ], needsDecision: false, issue: null,
    });
  });
  it('uses frozen actuals for terminal/continued summaries, never current reputation', () => {
    const run = continueCareerAsSandbox(scored(79, 2.13));
    const summary = getCareerSummary(run, { gameTime: 800000, reputation: 1 });
    expect(summary).toMatchObject({ status: 'continued', remainingSeconds: 0, needsDecision: false,
      criteria: [{ id: 'paid-meals', actual: 79, passed: false },
        { id: 'reputation', actual: 2.13, passed: true }],
    });
  });
  it('never fabricates criteria for invalid data or its continuation', () => {
    const invalid = normalise({}).run;
    for (const run of [invalid, continueCareerAsSandbox(invalid)]) {
      expect(getCareerSummary(run, { gameTime: 900000, reputation: 5 }).criteria).toBeNull();
    }
  });
});
