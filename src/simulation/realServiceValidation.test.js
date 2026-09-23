import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceFixture, seededRandom } from './realServiceHarness.testSupport';

afterEach(() => vi.restoreAllMocks());
const mode = process.env.REAL_SERVICE_CASE;
const requestedStrategy = process.env.REAL_SERVICE_STRATEGY;
const careerWallMs = Number(process.env.REAL_SERVICE_WALL_MS || 400000);

async function execute(options) {
  // Reset module-local visitor counters as well as the test-local RNG, so a
  // reported seed is reproducible independently of earlier study runs.
  vi.resetModules();
  const harness = await import('./realServiceHarness.testSupport');
  localStorage.clear();
  vi.spyOn(Math, 'random').mockImplementation(harness.seededRandom(options.seed));
  try { return harness.runRealService(options); }
  finally { vi.restoreAllMocks(); }
}

function compact(report) {
  const { actions, samples, paid, diagnostic, firstSnapshotMismatch, finalTrace, ...summary } = report;
  return { ...summary, contractPayments: paid.filter(visit => visit.contractId !== null),
    firstSnapshotMismatchAt: firstSnapshotMismatch?.at ?? null,
    error: diagnostic ? { message: diagnostic.message, at: diagnostic.at,
    nextGameDt: diagnostic.nextGameDt,
    payingCustomers: diagnostic.trace.staff.filter(s => s.task?.type === 'take_payment').map(s => s.task.customerId) } : null };
}

describe('real service release harness', () => {
  it('prepares compact capacity through accepted affordable actions without awarding progress', () => {
    const { state, actions } = createServiceFixture({ strategy: 'compact-capacity', templateId: 'family-service' });
    expect(actions.every(action => action.applied)).toBe(true);
    expect(state.restaurant.funds).toBe(80);
    expect(state.restaurant.gameTime).toBe(36000);
    expect(state.restaurant.reputation).toBe(1);
    expect(state.paidVisitSequence).toBe(0);
    expect(state.dishes[0].price).toBe(6);
    expect(state.drinkOverrides.water.price).toBe(100);
    expect(state.staff.map(worker => worker.morale)).toEqual([100, 100, 100, 100, 100]);
    expect(state.tables.map(table => state.chairs.filter(chair => chair.tableId === table.id).length)).toEqual([4, 4, 4, 4]);
    expect(state.serviceContracts.active).toMatchObject({ rulesVersion: 3, acceptedAt: 36000, deadlineAt: 42900, target: 6, reward: 120, depositPaid: 30 });
    expect(state.serviceContracts.active.guests.every(guest => guest.status === 'scheduled')).toBe(true);
  });
  it('has repeatable independent random streams without changing production randomness', () => {
    const left = seededRandom(1);
    const right = seededRandom(1);
    const other = seededRandom(2);
    const a = Array.from({ length: 20 }, left);
    expect(a).toEqual(Array.from({ length: 20 }, right));
    expect(a).not.toEqual(Array.from({ length: 20 }, other));
    expect(a.every(n => n >= 0 && n < 1)).toBe(true);
  });
  it('excludes the acceptance advance from ordinary service revenue', async () => {
    const { report } = await execute({ seed: 1, templateId: 'party-rush', duration: 0 });
    expect(report.ordinaryRevenue).toBe(0);
    expect(report.contractCash).toBe(45);
  });
  it.skipIf(mode !== 'profile')('profiles one native fixed-step starter service before long studies', async () => {
    const { report } = await execute({ seed: Number(process.env.REAL_SERVICE_SEED || 1),
      templateId: process.env.REAL_SERVICE_TEMPLATE || 'office-lunch',
      strategy: requestedStrategy || 'starter', gameStep: Number(process.env.REAL_SERVICE_STEP || 8), maxWallMs: 30000 });
    console.info('REAL_SERVICE_PROFILE', JSON.stringify(report));
    expect(report.status).toBe('completed');
    expect(report.gameTime).toBe(report.endAt);
  }, 40000);
  it.skipIf(process.env.PARTY_RUSH_BALANCE !== '1')('balances Party rush over five prepared and five starter real-service streams', async () => {
    const reports = [];
    for (const strategy of ['compact-service', 'starter']) {
      for (let seed = 1; seed <= 5; seed++) {
        const { report } = await execute({ seed, templateId: 'party-rush', strategy, maxWallMs: 30000 });
        reports.push(report);
        console.info('PARTY_RUSH_BALANCE', JSON.stringify(compact(report)));
        expect(report.status).toBe('completed');
        expect(report.rulesVersion).toBe(3);
        expect(report.firstSnapshotMismatch).toBeNull();
        expect(report.ordinaryRevenue).toBeGreaterThanOrEqual(0);
        expect(report.contractCash).toBe(report.contractStatus === 'succeeded' ? 180 : -90);
      }
    }
    expect(reports.filter(r => r.strategy === 'compact-service' && r.contractStatus === 'succeeded').length).toBeGreaterThanOrEqual(4);
    expect(reports.filter(r => r.strategy === 'starter' && r.contractStatus === 'failed').length).toBeGreaterThanOrEqual(3);
  }, 330000);
  it.skipIf(!['career-profile', 'career-stream'].includes(mode))('profiles a complete seven-day legal career strategy', async () => {
    const { report } = await execute({ mode: 'career', seed: Number(process.env.REAL_SERVICE_SEED || 1),
      strategy: requestedStrategy || 'compact-capacity', maxWallMs: careerWallMs });
    console.info('REAL_CAREER_FULL_WEEK', JSON.stringify(compact(report)));
    console.info('REAL_CAREER_FINAL_STAFF', JSON.stringify(report.finalTrace.staff));
    expect(report.status).toBe('completed');
    expect(report.gameTime).toBe(640800);
    expect(['won', 'lost']).toContain(report.careerStatus);
  }, careerWallMs + 15000);
  it.skipIf(mode !== 'contracts').each(['office-lunch', 'family-service', 'tasting-service'])('release gate: twenty native 4x normal streams for %s', async templateId => {
    const reports = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { report } = await execute({ seed, templateId, strategy: requestedStrategy || 'starter', maxWallMs: 30000 });
      reports.push(report);
      console.info('CONTRACT_STREAM', JSON.stringify(compact(report)));
    }
    const summary = { templateId, attempted: reports.length,
      completed: reports.filter(r => r.status === 'completed').length,
      succeeded: reports.filter(r => r.contractStatus === 'succeeded').length,
      failed: reports.filter(r => r.contractStatus === 'failed').length,
      runtimeErrors: reports.filter(r => r.status === 'runtime_error').length,
      wallBudgetStops: reports.filter(r => r.status === 'wall_budget').length };
    console.info('CONTRACT_RELEASE_SUMMARY', JSON.stringify(summary));
    expect(summary.completed, JSON.stringify(summary)).toBe(20);
    expect(summary.succeeded, JSON.stringify(summary)).toBeGreaterThanOrEqual(14);
  }, 660000);
  it.skipIf(mode !== 'career')('release gate: ten real seven-day career streams with the recorded affordable strategy', async () => {
    const reports = [];
    for (let seed = 1; seed <= 10; seed++) {
      const { report } = await execute({ mode: 'career', seed, strategy: requestedStrategy || 'compact-capacity', maxWallMs: careerWallMs });
      reports.push(report);
      console.info('CAREER_STREAM', JSON.stringify(compact(report)));
    }
    const summary = { attempted: reports.length, completed: reports.filter(r => r.status === 'completed').length,
      won: reports.filter(r => r.careerStatus === 'won').length,
      lost: reports.filter(r => r.careerStatus === 'lost').length,
      runtimeErrors: reports.filter(r => r.status === 'runtime_error').length,
      wallBudgetStops: reports.filter(r => r.status === 'wall_budget').length };
    console.info('CAREER_RELEASE_SUMMARY', JSON.stringify(summary));
    expect(summary.completed, JSON.stringify(summary)).toBe(10);
    expect(summary.won, JSON.stringify(summary)).toBeGreaterThanOrEqual(8);
  }, careerWallMs * 10 + 100000);
  it.skipIf(mode !== 'failure')('runs a purposeful no-staff career failure through seven full days without editing objectives', async () => {
    const { state, report } = await execute({ mode: 'career', seed: 1, strategy: 'closed', maxWallMs: 120000, acceptAtCareerEnd: true });
    console.info('CAREER_PURPOSEFUL_FAILURE', JSON.stringify(compact(report)));
    expect(report.status).toBe('completed');
    expect(report.gameTime).toBe(640800);
    expect(report.careerStatus).toBe('lost');
    expect(report.careerMeals).toBe(0);
    expect(state.serviceContracts.active.parties[0]).toMatchObject({ status: 'scheduled', arrivalAt: 640800 });
    const { saveState, loadState, hydrateState } = await import('../state/persistence');
    const { createInitialState } = await import('../state/initialState');
    const { gameReducer } = await import('../state/GameContext');
    const { runTick } = await import('./gameLoop');
    expect(saveState(state)).toBe(true);
    const loaded = hydrateState(loadState(), createInitialState());
    expect(loaded.careerRun.needsDecision).toBe(true);
    expect(loaded.serviceContracts.active.parties[0].status).toBe('scheduled');
    expect(runTick(loaded, { gameDt: 8, movementDt: 8 / 60 })).toBe(loaded);
    let continued = gameReducer(loaded, { type: 'CONTINUE_CAREER_AS_SANDBOX', expectedRunId: loaded.careerRun.runId });
    continued = gameReducer(continued, { type: 'SET_OPERATING_HOURS', openHour: 0, closeHour: 0 });
    continued = runTick(continued, { gameDt: 0, movementDt: 0 });
    expect(continued.restaurant.gameTime).toBe(640800);
    expect(continued.serviceContracts.active.parties[0]).toMatchObject({ status: 'admitted', admittedAt: 640800 });
    const again = runTick(continued, { gameDt: 0, movementDt: 0 });
    expect(again.queue.filter(p => p.partyId === 'sc-1-p1')).toHaveLength(1);
  }, 130000);
  it.skipIf(mode && mode !== 'reload')('round-trips real in-flight contract service without replaying progress', async () => {
    const { report } = await execute({ seed: 1, reloadAt: 3300, duration: 3500, maxWallMs: 30000 });
    console.info('REAL_SERVICE_RELOAD', JSON.stringify(compact(report)));
    expect(report.status).toBe('completed');
    expect(report.reloaded).toBe(true);
    expect(report.reloadFacts).toMatchObject({ sequenceBefore: 2, sequenceAfter: 2,
      contractLedgerEqual: true, cookbookEqual: true });
  }, 40000);
  it.skipIf(mode && mode !== 'boundary')('finishes a genuinely served booked meal at the deadline and settles its bonus once', async () => {
    const { state, report } = await execute({ seed: 3, templateId: 'tasting-service', finishPaidAtDeadline: true });
    console.info('REAL_DEADLINE_PAYMENT', JSON.stringify(report));
    expect(report.status).toBe('completed');
    expect(report.boundaryPaymentStep).not.toBe(null);
    expect(report.paid).toContainEqual(expect.objectContaining({ id: report.boundaryPaymentStep.customerId, at: 41100,
      contractId: 'sc-1', foodOutcome: 'delivered', snapshot: true }));
    expect(report.contractStatus).toBe('succeeded');
    expect(report.fulfilled).toBe(3);
    expect(report.bonus).toBe(100);
    const { saveState, loadState, hydrateState } = await import('../state/persistence');
    const { createInitialState } = await import('../state/initialState');
    const { runTick } = await import('./gameLoop');
    expect(saveState(state)).toBe(true);
    const loaded = hydrateState(loadState(), createInitialState());
    expect(loaded.serviceContracts.results).toEqual(state.serviceContracts.results);
    expect(loaded.restaurant.funds).toBe(state.restaurant.funds);
    expect(runTick(loaded, { gameDt: 0, movementDt: 0 }).restaurant.funds).toBe(state.restaurant.funds);
  }, 40000);
  it.skipIf(mode && mode !== 'office-success')('serves four real Office meals at native 1x and earns exactly the advertised bonus', async () => {
    const { report } = await execute({ seed: 1, gameStep: 2, maxWallMs: 30000 });
    console.info('REAL_OFFICE_SUCCESS', JSON.stringify(compact(report)));
    expect(report.status).toBe('completed');
    expect(report.contractStatus).toBe('succeeded');
    expect(report.fulfilled).toBe(4);
    expect(report.bonus).toBe(90);
    expect(report.funds).toBeCloseTo(748.9);
    expect(report.paid.filter(p => p.contractId === 'sc-1' && p.foodOutcome === 'delivered' && p.dishPrice === 12)).toHaveLength(4);
  }, 40000);
});
