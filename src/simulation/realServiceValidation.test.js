import { afterEach, describe, expect, it, vi } from 'vitest';
import { getResolvedDrink } from '../data/drinks';
import { getServiceContractTemplate as getOriginalServiceContractTemplate } from '../data/serviceContracts';
import { createServiceFixture, REFERENCE_SERVICE_PREPARATIONS, runRealService, seededRandom } from './realServiceHarness.testSupport';
import { evaluateV6FidelityGate, getV6FidelitySelection } from './contractBalanceFidelity.testSupport';
import {
  CONTRACT_BALANCE_STUDY,
  createCandidateCatalogueOverlay,
  createContractBalanceEvidenceRow,
  createServiceContractCataloguePin,
  describeContractBalanceStudyRun,
  expectedContractBalanceSeeds,
  getRecordedContractBalanceCase,
  getRecordedContractBalanceSelection,
  assertFrozenContractBalanceSelection,
} from './contractBalanceStudy.testSupport';

afterEach(() => vi.restoreAllMocks());
const mode = process.env.REAL_SERVICE_CASE;
const requestedStrategy = process.env.REAL_SERVICE_STRATEGY;
const careerWallMs = Number(process.env.REAL_SERVICE_WALL_MS || 400000);
if (mode?.startsWith('contract-fidelity-')) {
  throw new Error(`Unknown REAL_SERVICE_CASE ${mode}; use contract-fidelity with REAL_SERVICE_PHASE=development|holdout`);
}
const starterPreparation = Object.freeze({ id: 'starter', actions: Object.freeze([]) });
const contractBaselineProfiles = Object.freeze([
  { fixtureId: 'office-starter', templateId: 'office-lunch', preparation: REFERENCE_SERVICE_PREPARATIONS.officeStarter },
  { fixtureId: 'family-starter', templateId: 'family-service', preparation: starterPreparation },
  { fixtureId: 'family-layout', templateId: 'family-service', preparation: REFERENCE_SERVICE_PREPARATIONS.familyLayout },
  { fixtureId: 'tasting-starter', templateId: 'tasting-service', preparation: starterPreparation },
  { fixtureId: 'tasting-layout', templateId: 'tasting-service', preparation: REFERENCE_SERVICE_PREPARATIONS.tastingLayout },
  { fixtureId: 'tasting-upgrade', templateId: 'tasting-service', preparation: REFERENCE_SERVICE_PREPARATIONS.tastingUpgrade },
  { fixtureId: 'tasting-combined', templateId: 'tasting-service', preparation: REFERENCE_SERVICE_PREPARATIONS.tastingCombined },
  { fixtureId: 'rush-starter', templateId: 'party-rush', preparation: starterPreparation },
  { fixtureId: 'rush-combined', templateId: 'party-rush', preparation: REFERENCE_SERVICE_PREPARATIONS.rushCombined },
]);
const contractBaselineSeeds = Object.freeze(Array.from({ length: 20 }, (_, index) => index + 1));

async function execute(options, { candidate = null, candidateId = 'baseline', inspectCatalogue = false,
  rulesVersion = 5 } = {}) {
  // Reset module-local visitor counters as well as the test-local RNG, so a
  // reported seed is reproducible independently of earlier study runs.
  vi.resetModules();
  localStorage.clear();
  let catalogueMocked = false;
  try {
    if (rulesVersion === 6 && candidate) {
      throw new Error('V6 fidelity runs use the actual selected offer; workload candidate overlays are not permitted');
    }
    if (rulesVersion !== 6) {
      vi.doMock('../data/serviceContracts', async () => {
        const actualCatalogue = await vi.importActual('../data/serviceContracts');
        const pinnedCatalogue = createServiceContractCataloguePin(actualCatalogue, rulesVersion);
        return candidate ? createCandidateCatalogueOverlay(pinnedCatalogue, candidate) : pinnedCatalogue;
      });
      catalogueMocked = true;
    }
    const harness = await import('./realServiceHarness.testSupport');
    vi.spyOn(Math, 'random').mockImplementation(harness.seededRandom(options.seed));
    const run = harness.runRealService(options);
    const runCatalogue = await import('../data/serviceContracts');
    const catalogueTemplate = run.report.templateId
      ? runCatalogue.getServiceContractTemplate(run.report.templateId, rulesVersion) : null;
    const catalogueProbe = inspectCatalogue ? await (async () => {
      const catalogue = await import('../data/serviceContracts');
      const serviceContracts = await import('./serviceContracts');
      const view = serviceContracts.selectServiceContractView(run.state);
      const offer = view.offers.find(entry => entry.template.id === options.templateId);
      return {
        rulesVersion: catalogue.SERVICE_CONTRACT_RULES_VERSION,
        v1ToV4: [1, 2, 3, 4].map(version => catalogue.getServiceContractTemplate(options.templateId, version)),
        v5Target: catalogue.getServiceContractTemplate(options.templateId, 5)?.target ?? null,
        catalogueListTarget: catalogue.SERVICE_CONTRACTS.find(template => template.id === options.templateId)?.target ?? null,
        offerTarget: offer?.template.target ?? null,
        v6Template: catalogue.getServiceContractTemplate(options.templateId, 6),
      };
    })() : null;
    return {
      ...run,
      catalogueTemplate,
      report: { ...run.report, candidateId },
      ...(catalogueProbe ? { catalogueProbe } : {}),
    };
  } finally {
    vi.restoreAllMocks();
    // Explicitly remove a module mock: restoring spies does not remove vi.doMock.
    if (catalogueMocked) vi.doUnmock('../data/serviceContracts');
    vi.resetModules();
  }
}

function selectedContractStudyCase(phase) {
  const templateId = process.env.REAL_SERVICE_TEMPLATE?.trim();
  const candidateId = process.env.REAL_SERVICE_CANDIDATE?.trim();
  const preparationId = process.env.REAL_SERVICE_PREPARATION?.trim();
  if (!templateId || !candidateId || !preparationId) {
    throw new Error('Contract study needs REAL_SERVICE_TEMPLATE, REAL_SERVICE_CANDIDATE and REAL_SERVICE_PREPARATION');
  }
  const recordedCase = getRecordedContractBalanceCase({ templateId, candidateId, preparationId });
  if (phase !== 'screen' && recordedCase.screening?.rejected) {
    throw new Error(`Candidate was rejected during screening: ${recordedCase.screening.reason}`);
  }
  let selectionArtifact = null;
  if (phase === 'holdout') {
    selectionArtifact = getRecordedContractBalanceSelection({ templateId, candidateId, preparationId });
    assertFrozenContractBalanceSelection(selectionArtifact, recordedCase);
  }
  return { recordedCase, selectionArtifact };
}

function contractStudyTimeout(phase) {
  return expectedContractBalanceSeeds(phase).length * 2 * CONTRACT_BALANCE_STUDY.maximumStreamWallMs + 60000;
}

async function runContractBalanceStudy(phase) {
  const { recordedCase, selectionArtifact } = selectedContractStudyCase(phase);
  const candidate = recordedCase.candidate.id === 'baseline' ? null : recordedCase.candidate;
  const seeds = expectedContractBalanceSeeds(phase);
  const rows = [];
  for (const seed of seeds) {
    const options = { seed, templateId: recordedCase.candidate.templateId,
      preparation: recordedCase.preparation, gameStep: CONTRACT_BALANCE_STUDY.gameStep,
      maxWallMs: CONTRACT_BALANCE_STUDY.maximumStreamWallMs };
    let candidateRun;
    let controlRun;
    try {
      candidateRun = await execute(options, { candidate, candidateId: recordedCase.candidate.id });
    } catch (error) {
      candidateRun = { error };
    }
    try {
      controlRun = await execute(options, { candidateId: 'baseline' });
    } catch (error) {
      controlRun = { error };
    }
    const row = createContractBalanceEvidenceRow({ recordedCase, seed, candidateRun, controlRun });
    rows.push(row);
    // Preserve each paired record, including faulted or rejected evidence.
    console.info('CONTRACT_BALANCE_STUDY', JSON.stringify(row));
  }
  const result = describeContractBalanceStudyRun(phase, recordedCase, rows, selectionArtifact);
  console.info('CONTRACT_BALANCE_STUDY_GATE', JSON.stringify(result));
  if (phase === 'screen') {
    expect(result.valid, JSON.stringify(result)).toBe(true);
  } else {
    expect(result.passed, JSON.stringify(result)).toBe(true);
  }
}

function compact(report) {
  const { actions, samples, paid, diagnostic, firstSnapshotMismatch, finalTrace, ...summary } = report;
  return { ...summary, contractPayments: paid.filter(visit => visit.contractId !== null),
    firstSnapshotMismatchAt: firstSnapshotMismatch?.at ?? null,
    error: diagnostic ? { message: diagnostic.message, at: diagnostic.at,
    nextGameDt: diagnostic.nextGameDt,
    payingCustomers: diagnostic.trace.staff.filter(s => s.task?.type === 'take_payment').map(s => s.task.customerId) } : null };
}

function contractBaselineRow(run, fixtureId) {
  const { report, state } = run;
  const resultRecord = state.serviceContracts.results.at(-1) || null;
  return {
    rulesVersion: report.rulesVersion,
    fixtureId,
    preparationId: report.preparation.id,
    templateId: report.templateId,
    seed: report.seed,
    gameStep: report.gameStep,
    actionList: report.preparation.actions
      .filter(entry => entry.action.type !== 'SET_SPEED').map(entry => entry.action),
    preparation: {
      startingFunds: report.preparation.startingFunds,
      fundsBeforeAcceptance: report.preparation.fundsBeforeAcceptance,
      cost: report.preparation.cost,
      actionLog: report.preparation.actions,
    },
    status: report.status,
    result: {
      contractStatus: report.contractStatus,
      fulfilled: report.fulfilled,
      target: report.target,
      bonus: report.bonus,
      record: resultRecord,
    },
    payments: {
      paidVisits: report.paid,
      ordinaryRevenue: report.ordinaryRevenue,
      contractCash: report.contractCash,
      funds: report.funds,
      paidVisitSequence: report.sequence,
    },
    reasonCounts: report.contractDiagnostics.reasonCounts,
    categoryCounts: report.contractDiagnostics.categoryCounts,
    outcomes: report.contractDiagnostics.outcomes,
    stageDiagnostics: {
      stagesByGuest: report.contractDiagnostics.stagesByGuest,
      unavailableStages: report.contractDiagnostics.unavailableStages,
    },
    breakdown: report.breakdown,
    ticks: report.ticks,
    wallMs: report.wallMs,
    queuePeak: report.queuePeak,
    navigationFault: report.navigationFault,
    firstSnapshotMismatch: report.firstSnapshotMismatch,
    diagnostic: report.diagnostic,
  };
}

function fidelityCatalogueValues(template) {
  if (!template) return null;
  return { title: template.title, guestLabel: template.guestLabel, profile: template.profile,
    parties: template.parties, serviceDuration: template.serviceDuration,
    target: template.target, reward: template.reward };
}

function v6FidelityRunRow(run) {
  const { report, state, catalogueTemplate } = run;
  return {
    templateId: report.templateId,
    candidateId: report.candidateId,
    seed: report.seed,
    rulesVersion: report.rulesVersion,
    status: report.status,
    success: report.contractStatus === 'succeeded',
    fulfilled: report.fulfilled,
    target: report.target,
    payments: [report.paid.length, report.paid.filter(visit => visit.contractId !== null).length,
      report.ordinaryRevenue, report.contractCash, report.bonus, report.funds, report.sequence],
    catalogueValues: fidelityCatalogueValues(catalogueTemplate),
    preparation: report.preparation ? {
      id: report.preparation.id,
      startingFunds: report.preparation.startingFunds,
      fundsBeforeAcceptance: report.preparation.fundsBeforeAcceptance,
      cost: report.preparation.cost,
      actionLog: report.preparation.actions,
    } : null,
    reasonCounts: report.contractDiagnostics?.reasonCounts || null,
    navigationFault: report.navigationFault,
    runtimeFault: report.diagnostic?.message ?? null,
    safetyFaults: [...(state.navigationFault ? ['navigationFault'] : []),
      ...(report.firstSnapshotMismatch ? ['orderSnapshotMismatch'] : [])],
    snapshotMismatch: report.firstSnapshotMismatch,
    gameTime: report.gameTime,
    endAt: report.endAt,
    wallMs: report.wallMs,
  };
}

function v6FidelityFailureRow(templateId, seed, error) {
  return { templateId, candidateId: 'baseline', seed, rulesVersion: 6, status: 'runtime_error',
    success: false, fulfilled: null, target: null, payments: null, catalogueValues: null,
    preparation: null, reasonCounts: null, navigationFault: null,
    runtimeFault: error?.message || 'V6 fidelity execution failed', safetyFaults: [],
    snapshotMismatch: null, gameTime: null, endAt: null, wallMs: null };
}

async function runV6FidelityGate() {
  const phase = process.env.REAL_SERVICE_PHASE?.trim();
  const templateId = process.env.REAL_SERVICE_TEMPLATE?.trim();
  const candidateId = process.env.REAL_SERVICE_CANDIDATE?.trim();
  const selection = getV6FidelitySelection({ phase, templateId, candidateId });
  const runs = [];
  for (const [seed] of selection[phase].rows) {
    let row;
    try {
      const run = await execute({ seed, templateId, preparation: {
        id: selection.preparation.id, actions: selection.preparation.actions,
      }, gameStep: CONTRACT_BALANCE_STUDY.gameStep,
      maxWallMs: CONTRACT_BALANCE_STUDY.maximumStreamWallMs }, { rulesVersion: 6 });
      row = v6FidelityRunRow(run);
    } catch (error) {
      row = v6FidelityFailureRow(templateId, seed, error);
    }
    runs.push(row);
    console.info('CONTRACT_V6_FIDELITY_RUN', JSON.stringify(row));
  }
  const result = evaluateV6FidelityGate({ phase, templateId, candidateId, runs });
  console.info('CONTRACT_V6_FIDELITY_GATE', JSON.stringify(result));
  expect(result.failures, JSON.stringify(result)).toEqual([]);
  expect(result.passed).toBe(true);
}

function v6FidelityTimeout() {
  return 20 * CONTRACT_BALANCE_STUDY.maximumStreamWallMs + 60000;
}

describe('real service release harness', () => {
  it.skipIf(mode !== 'contract-study-baseline')('records paired honest v5 reference runs for seeds 1–20', async () => {
    const requestedFixtures = process.env.REAL_SERVICE_BASELINE_FIXTURES
      ? process.env.REAL_SERVICE_BASELINE_FIXTURES.split(',').map(value => value.trim()).filter(Boolean)
      : contractBaselineProfiles.map(profile => profile.fixtureId);
    const requestedSeeds = process.env.REAL_SERVICE_BASELINE_SEEDS
      ? process.env.REAL_SERVICE_BASELINE_SEEDS.split(',').map(value => Number(value.trim()))
      : [...contractBaselineSeeds];
    const profilesById = new Map(contractBaselineProfiles.map(profile => [profile.fixtureId, profile]));
    if (new Set(requestedFixtures).size !== requestedFixtures.length
      || requestedFixtures.some(fixtureId => !profilesById.has(fixtureId))) {
      throw new Error(`Invalid REAL_SERVICE_BASELINE_FIXTURES selection: ${requestedFixtures.join(',')}`);
    }
    if (new Set(requestedSeeds).size !== requestedSeeds.length
      || requestedSeeds.some(seed => !contractBaselineSeeds.includes(seed))) {
      throw new Error(`REAL_SERVICE_BASELINE_SEEDS must be unique values from 1–20: ${requestedSeeds.join(',')}`);
    }

    const gameStep = Number(process.env.REAL_SERVICE_STEP || 8);
    const maxWallMs = Number(process.env.REAL_SERVICE_WALL_MS || 30000);
    if (!(Number.isFinite(gameStep) && gameStep > 0 && Number.isFinite(maxWallMs) && maxWallMs > 0)) {
      throw new Error('Baseline game step and per-stream wall budget must be positive numbers');
    }

    const selectedProfiles = requestedFixtures.map(fixtureId => profilesById.get(fixtureId));
    const rows = [];
    for (const profile of selectedProfiles) {
      for (const seed of requestedSeeds) {
        const run = await execute({ seed, templateId: profile.templateId,
          preparation: profile.preparation, gameStep, maxWallMs });
        const row = contractBaselineRow(run, profile.fixtureId);
        rows.push(row);
        // Emit the complete row before assertions, including any failed run's
        // diagnostic trace; a faulty stream must never disappear from evidence.
        console.info('CONTRACT_STUDY_BASELINE', JSON.stringify(row));
        expect(row.rulesVersion, `${profile.fixtureId} seed ${seed} rules version`).toBe(5);
        expect(row.status, `${profile.fixtureId} seed ${seed} run status`).toBe('completed');
        expect(row.navigationFault, `${profile.fixtureId} seed ${seed} navigation fault`).toBeNull();
        expect(row.firstSnapshotMismatch, `${profile.fixtureId} seed ${seed} order snapshot mismatch`).toBeNull();
      }
    }

    const keys = rows.map(row => `${row.fixtureId}:${row.seed}`);
    expect(rows).toHaveLength(selectedProfiles.length * requestedSeeds.length);
    expect(new Set(keys).size).toBe(rows.length);
  }, 7200000);

  it('defines affordable reference layouts and upgrade comparisons without moving staff', () => {
    const profiles = [
      { templateId: 'office-lunch', preparation: REFERENCE_SERVICE_PREPARATIONS.officeStarter, cost: 0, deposit: 22.5 },
      { templateId: 'family-service', preparation: REFERENCE_SERVICE_PREPARATIONS.familyLayout, cost: 0, deposit: 30 },
      { templateId: 'tasting-service', preparation: REFERENCE_SERVICE_PREPARATIONS.tastingLayout, cost: 0, deposit: 25 },
      { templateId: 'tasting-service', preparation: REFERENCE_SERVICE_PREPARATIONS.tastingUpgrade, cost: 100, deposit: 25 },
      { templateId: 'tasting-service', preparation: REFERENCE_SERVICE_PREPARATIONS.tastingCombined, cost: 100, deposit: 25 },
      { templateId: 'party-rush', preparation: REFERENCE_SERVICE_PREPARATIONS.rushCombined, cost: 300, deposit: 45 },
    ];
    const starters = new Map(['office-lunch', 'family-service', 'tasting-service', 'party-rush']
      .map(templateId => [templateId, createServiceFixture({ templateId }).state]));
    const prepared = new Map();

    for (const { templateId, preparation, cost, deposit } of profiles) {
      const fixture = createServiceFixture({ templateId, preparation });
      prepared.set(preparation.id, fixture.state);
      expect(fixture.preparation).toMatchObject({
        id: preparation.id, startingFunds: 600, fundsBeforeAcceptance: 600 - cost, cost,
      });
      expect(fixture.preparation.actions.map(entry => entry.action)).toEqual([
        { type: 'SET_SPEED', speed: 4 }, ...preparation.actions,
      ]);
      expect(fixture.preparation.actions.every(entry => entry.applied)).toBe(true);
      expect(fixture.preparation.actions.some(entry => entry.action.type === 'MOVE_STAFF')).toBe(false);
      expect(fixture.state.restaurant.funds).toBe(600 - cost + deposit);
      expect(fixture.state.serviceContracts.active).toMatchObject({ rulesVersion: 6, depositPaid: deposit });

      const starter = starters.get(templateId);
      expect(fixture.state.staff.map(({ id, role, x, y, skill, morale }) => ({ id, role, x, y, skill, morale })))
        .toEqual(starter.staff.map(({ id, role, x, y, skill, morale }) => ({ id, role, x, y, skill, morale })));
      expect(fixture.state.dishes.map(({ id, price }) => ({ id, price })))
        .toEqual(starter.dishes.map(({ id, price }) => ({ id, price })));
      expect(fixture.state.drinkOverrides).toEqual(starter.drinkOverrides);
      expect(getResolvedDrink(fixture.state, 'water').price).toBe(getResolvedDrink(starter, 'water').price);
      expect(fixture.state.restaurant.openHour).toBe(starter.restaurant.openHour);
      expect(fixture.state.restaurant.closeHour).toBe(starter.restaurant.closeHour);
      expect(fixture.state.restaurant.walkInsPaused ?? false).toBe(starter.restaurant.walkInsPaused ?? false);
      expect(fixture.state.restaurant.suspendedDishIds ?? []).toEqual([]);
      expect(fixture.state.restaurant.suspendedDrinkIds ?? []).toEqual([]);
      expect(fixture.state.restaurant.reputation).toBe(starter.restaurant.reputation);
      expect(fixture.state.paidVisitSequence).toBe(starter.paidVisitSequence);
    }

    const family = prepared.get('family-layout');
    const tastingLayout = prepared.get('tasting-layout');
    const tastingUpgrade = prepared.get('tasting-upgrade');
    const tastingCombined = prepared.get('tasting-combined');
    const rushCombined = prepared.get('rush-combined');
    expect(family.tables).toEqual(starters.get('family-service').tables);
    expect(family.chairs).toEqual(starters.get('family-service').chairs);
    for (const [tableId, expectedX] of [['t3', 200], ['t4', 360]]) {
      expect(family.tables.find(table => table.id === tableId)).toMatchObject({ x: expectedX, y: 360 });
      expect(family.chairs.filter(chair => chair.tableId === tableId)).toHaveLength(4);
      for (const state of [tastingLayout, tastingCombined]) {
        expect(state.tables.find(table => table.id === tableId)).toMatchObject({ x: expectedX, y: 300 });
        expect(state.chairs.filter(chair => chair.tableId === tableId)).toHaveLength(4);
      }
    }
    expect(rushCombined.chairs).toHaveLength(starters.get('party-rush').chairs.length + 4);
    for (const tableId of ['t1', 't2']) {
      expect(rushCombined.chairs.filter(chair => chair.tableId === tableId)).toHaveLength(4);
    }
    expect(tastingUpgrade.tables).toEqual(starters.get('tasting-service').tables);
    expect(tastingUpgrade.chairs).toEqual(starters.get('tasting-service').chairs);
    for (const state of [tastingUpgrade, tastingCombined, rushCombined]) {
      expect(state.equipment.find(equipment => equipment.id === 'eq1')).toMatchObject({ level: 2 });
    }
    expect(tastingLayout.equipment.find(equipment => equipment.id === 'eq1')).toMatchObject({ level: 1 });
    expect(family.equipment.find(equipment => equipment.id === 'eq1')).toMatchObject({ level: 1 });
  });

  it('applies a test-only v5 overlay to offer and acceptance, then restores the original control', async () => {
    const candidate = { id: 'office-lunch-candidate-1', templateId: 'office-lunch',
      dimension: 'meal-target', change: 5 };
    const options = { seed: 1, templateId: 'office-lunch', preparation: { id: 'candidate-control-unit', actions: [] },
      gameStep: 8, duration: 0 };

    const candidateRun = await execute(options, { candidate, candidateId: candidate.id, inspectCatalogue: true });
    expect(candidateRun.report).toMatchObject({ rulesVersion: 5, candidateId: candidate.id, gameStep: 8 });
    expect(candidateRun.state.serviceContracts.active).toMatchObject({ rulesVersion: 5, target: 5, reward: 90,
      depositPaid: 22.5, deadlineAt: 42150 });
    expect(candidateRun.catalogueProbe).toMatchObject({ rulesVersion: 5, v5Target: 5, catalogueListTarget: 5,
      offerTarget: 5, v6Template: { target: 2 } });
    expect(candidateRun.catalogueProbe.v1ToV4).toEqual([1, 2, 3, 4]
      .map(version => getOriginalServiceContractTemplate('office-lunch', version)));
    expect(candidateRun.state.serviceContracts.active.guests).toHaveLength(6);
    expect(candidateRun.state.serviceContracts.active.guests[0]).toMatchObject({
      archetype: 'rusher', spendingTier: 'value', spendingBudget: 24,
    });

    const controlRun = await execute(options, { candidateId: 'baseline' });
    expect(controlRun.report).toMatchObject({ rulesVersion: 5, candidateId: 'baseline', gameStep: 8 });
    expect(controlRun.state.serviceContracts.active).toMatchObject({ rulesVersion: 5, target: 4, reward: 90,
      depositPaid: 22.5, deadlineAt: 42150 });
    expect(controlRun.state.serviceContracts.active.parties.map(party => party.arrivalOffset)).toEqual([0, 720, 1440]);
    expect(controlRun.state.serviceContracts.active.guests[0]).toMatchObject({
      archetype: 'rusher', spendingTier: 'value', spendingBudget: 24,
    });
    const random = vi.spyOn(Math, 'random');
    const evidence = createContractBalanceEvidenceRow({ recordedCase: { candidate, preparation: options.preparation },
      seed: 1, candidateRun, controlRun });
    expect(random).not.toHaveBeenCalled();
    expect(evidence).toMatchObject({ fixtureId: 'office-lunch:candidate-control-unit',
      candidateId: candidate.id, dimension: 'meal-target', seed: 1, gameStep: 8, rulesVersion: 5,
      preparation: { id: options.preparation.id, actions: [] }, actionCost: 0,
      candidate: { candidateId: candidate.id, templateId: 'office-lunch', seed: 1,
        catalogueValues: { target: 5, reward: 90, serviceDuration: 5250 },
        rulesVersion: 5, gameStep: 8, status: 'completed',
        paymentTotals: { ordinaryRevenue: expect.any(Number), contractCash: expect.any(Number) },
        reasonCounts: expect.any(Object), outcomes: expect.any(Array), stageDiagnostics: expect.any(Object),
        preparation: { id: options.preparation.id, cost: 0, actionLog: expect.any(Array) } },
      control: { candidateId: 'baseline', rulesVersion: 5, gameStep: 8, status: 'completed',
        preparation: { id: options.preparation.id, cost: 0, actionLog: expect.any(Array) } },
    });
    const relabelledRun = { ...candidateRun, report: { ...candidateRun.report, seed: 7 } };
    const relabelledEvidence = createContractBalanceEvidenceRow({ recordedCase: { candidate,
      preparation: options.preparation }, seed: 1, candidateRun: relabelledRun, controlRun });
    expect(relabelledEvidence.candidate.seed).toBe(7);
  });

  it('runs a zero-duration v6 fidelity check separately from the v5-pinned study', async () => {
    const { report, state, catalogueProbe } = await execute({ seed: 1, templateId: 'office-lunch',
      preparation: { id: 'v6-fidelity', actions: [] }, gameStep: 8, duration: 0 },
    { rulesVersion: 6, inspectCatalogue: true });

    expect(report).toMatchObject({ rulesVersion: 6, status: 'completed', gameTime: 36000, endAt: 36000 });
    expect(state.serviceContracts.active).toMatchObject({ rulesVersion: 6, target: 2, reward: 90,
      serviceStartAt: 36900, deadlineAt: 42150, depositPaid: 22.5 });
    expect(catalogueProbe).toMatchObject({ rulesVersion: 6, v5Target: 4, catalogueListTarget: 2,
      offerTarget: 2, v6Template: { target: 2, reward: 90 } });
    expect(catalogueProbe.v1ToV4).toEqual([1, 2, 3, 4]
      .map(version => getOriginalServiceContractTemplate('office-lunch', version)));
  });

  it.skipIf(mode !== 'contract-fidelity')('runs the artifact-gated actual-v6 fidelity phase for one selected tier', async () => {
    await runV6FidelityGate();
  }, v6FidelityTimeout());

  it.skipIf(mode !== 'contract-study-screen')('records the five paired screening seeds for a registered case', async () => {
    await runContractBalanceStudy('screen');
  }, contractStudyTimeout('screen'));

  it.skipIf(mode !== 'contract-study-development')('enforces the tier minimum on all twenty paired development seeds', async () => {
    await runContractBalanceStudy('development');
  }, contractStudyTimeout('development'));

  it.skipIf(mode !== 'contract-study-holdout')('enforces a frozen tier selection on all twenty holdout seeds', async () => {
    await runContractBalanceStudy('holdout');
  }, contractStudyTimeout('holdout'));

  it('records affordable reducer-action preparation before the family contract advance', () => {
    const preparation = {
      id: 'fixture-action-check',
      actions: [
        { type: 'MOVE_STAFF', id: 'starter-cook', x: 390, y: 100 },
        { type: 'MOVE_STAFF', id: 'starter-waiter', x: 460, y: 480 },
        { type: 'MOVE_STAFF', id: 'starter-host', x: 500, y: 480 },
        { type: 'MOVE_STAFF', id: 'starter-janitor', x: 540, y: 480 },
        { type: 'MOVE_FIXTURES', items: [
          { type: 'table', id: 't1', x: 500, y: 200 },
          { type: 'table', id: 't2', x: 660, y: 200 },
          { type: 'table', id: 't3', x: 500, y: 360 },
          { type: 'table', id: 't4', x: 660, y: 360 },
          { type: 'chair', id: 'ch1', x: 510, y: 180, rotation: 2 },
          { type: 'chair', id: 'ch2', x: 510, y: 240, rotation: 0 },
          { type: 'chair', id: 'ch3', x: 670, y: 180, rotation: 2 },
          { type: 'chair', id: 'ch4', x: 670, y: 240, rotation: 0 },
          { type: 'chair', id: 'ch5', x: 510, y: 340, rotation: 2 },
          { type: 'chair', id: 'ch6', x: 510, y: 400, rotation: 0 },
          { type: 'chair', id: 'ch7', x: 480, y: 370, rotation: 1 },
          { type: 'chair', id: 'ch8', x: 540, y: 370, rotation: 3 },
          { type: 'chair', id: 'ch9', x: 670, y: 340, rotation: 2 },
          { type: 'chair', id: 'ch10', x: 670, y: 400, rotation: 0 },
          { type: 'chair', id: 'ch11', x: 640, y: 370, rotation: 1 },
          { type: 'chair', id: 'ch12', x: 700, y: 370, rotation: 3 },
          { type: 'kitchenStation', id: 'k1', x: 400, y: 120 },
          { type: 'serviceTable', id: 'st1', x: 440, y: 120 },
          { type: 'washStation', id: 'wash1', x: 600, y: 120 },
        ] },
        { type: 'PLACE_ITEM', itemType: 'chair', x: 480, y: 210, rotation: 1 },
        { type: 'UPGRADE_EQUIPMENT', id: 'eq1' },
      ],
    };
    const baseline = createServiceFixture({ templateId: 'family-service' });
    const { state, actions, preparation: recorded } = createServiceFixture({
      templateId: 'family-service', preparation,
    });
    const acceptanceIndex = actions.findIndex(entry => entry.action.type === 'ACCEPT_SERVICE_CONTRACT');

    expect(recorded).toMatchObject({ id: preparation.id, startingFunds: 600,
      fundsBeforeAcceptance: 450, cost: 150 });
    expect(recorded.fundsBeforeAcceptance).toBeGreaterThanOrEqual(0);
    expect(recorded.fundsBeforeAcceptance).toBeLessThanOrEqual(600);
    expect(recorded.cost).toBe(recorded.startingFunds - recorded.fundsBeforeAcceptance);
    expect(recorded.actions).toEqual(actions.slice(0, acceptanceIndex));
    expect(recorded.actions.every(entry => entry.applied)).toBe(true);
    expect(recorded.actions.map(entry => entry.action)).toEqual([
      { type: 'SET_SPEED', speed: 4 }, ...preparation.actions,
    ]);
    expect(actions[acceptanceIndex]).toMatchObject({ action: { type: 'ACCEPT_SERVICE_CONTRACT' }, applied: true,
      fundsBefore: recorded.fundsBeforeAcceptance, fundsAfter: recorded.fundsBeforeAcceptance + 30 });
    expect(state.serviceContracts.active).toMatchObject({ rulesVersion: 6, depositPaid: 30 });
    expect(state.restaurant.funds).toBe(recorded.fundsBeforeAcceptance + 30);

    const familyParty = state.serviceContracts.active.parties.find(party => party.size === 4);
    expect(state.tables.some(table => state.chairs.filter(chair => chair.tableId === table.id).length >= familyParty.size)).toBe(true);
    expect(state.staff.map(({ id, role, x, y }) => ({ id, role, x, y })))
      .not.toEqual(baseline.state.staff.map(({ id, role, x, y }) => ({ id, role, x, y })));
    expect(state.staff.map(({ id, role }) => ({ id, role })))
      .toEqual(baseline.state.staff.map(({ id, role }) => ({ id, role })));
    expect(state.staff.find(worker => worker.id === 'starter-cook')).toMatchObject({ x: 390, y: 100 });
    expect(state.staff.find(worker => worker.id === 'starter-waiter')).toMatchObject({ x: 460, y: 480 });
    expect(state.staff.find(worker => worker.id === 'starter-host')).toMatchObject({ x: 500, y: 480 });
    expect(state.staff.find(worker => worker.id === 'starter-janitor')).toMatchObject({ x: 540, y: 480 });
    expect(state.equipment.map(({ id, owned }) => ({ id, owned })))
      .toEqual(baseline.state.equipment.map(({ id, owned }) => ({ id, owned })));
    expect(state.equipment.find(equipment => equipment.id === 'eq1').level).toBe(2);

    expect(state.dishes.map(({ id, price }) => ({ id, price })))
      .toEqual(baseline.state.dishes.map(({ id, price }) => ({ id, price })));
    expect(state.dishes.find(dish => dish.id === 'starter-toast').price).toBe(12);
    expect(state.drinkOverrides).toEqual(baseline.state.drinkOverrides);
    expect(getResolvedDrink(state, 'water').price).toBe(getResolvedDrink(baseline.state, 'water').price);
    expect(getResolvedDrink(state, 'water').price).toBe(2);
    expect(state.restaurant.openHour).toBe(baseline.state.restaurant.openHour);
    expect(state.restaurant.closeHour).toBe(baseline.state.restaurant.closeHour);
    expect(state.restaurant.walkInsPaused ?? false).toBe(baseline.state.restaurant.walkInsPaused ?? false);
    expect(state.restaurant.suspendedDishIds ?? []).toEqual([]);
    expect(state.restaurant.suspendedDrinkIds ?? []).toEqual([]);
    expect(state.paidVisitSequence).toBe(baseline.state.paidVisitSequence);
    expect(state.restaurant.reputation).toBe(baseline.state.restaurant.reputation);
    expect(state.serviceContracts.active).toEqual(baseline.state.serviceContracts.active);
    expect(state.serviceContracts.results).toEqual(baseline.state.serviceContracts.results);

    const { report } = runRealService({ templateId: 'family-service', preparation, duration: 0 });
    expect(report.preparation).toEqual(recorded);
    expect(report.actions.slice(0, report.actions.findIndex(entry => entry.action.type === 'ACCEPT_SERVICE_CONTRACT')))
      .toEqual(report.preparation.actions);
    expect(report.actions[report.preparation.actions.length].action.type).toBe('ACCEPT_SERVICE_CONTRACT');
    expect(report.contractDiagnostics.rulesVersion).toBe(6);
  });

  it('rejects invalid and unaffordable reducer actions in preparation', () => {
    expect(() => createServiceFixture({ preparation: {
      id: 'invalid-action', actions: [{ type: 'MOVE_STAFF', id: 'missing-staff', x: 200, y: 200 }],
    } })).toThrow('Preparation action rejected: MOVE_STAFF');
    expect(() => createServiceFixture({ preparation: {
      id: 'unaffordable-upgrades',
      actions: [1, 2, 3].map(() => ({ type: 'UPGRADE_EQUIPMENT', id: 'eq1' })),
    } })).toThrow('Preparation action rejected: UPGRADE_EQUIPMENT');
  });

  it.each([['TICK', 'nextState'], ['LOAD_STATE', 'state']])(
    'rejects %s before reading a state-replacement payload', (type, payloadKey) => {
      let payloadRead = false;
      const action = { type };
      Object.defineProperty(action, payloadKey, {
        get() {
          payloadRead = true;
          return {};
        },
      });

      expect(() => createServiceFixture({ preparation: {
        id: 'state-replacement-attempt', actions: [action],
      } })).toThrow(`Preparation action type not permitted: ${type}`);
      expect(payloadRead).toBe(false);
    },
  );

  it.each([
    ['SET_SPEED', { type: 'SET_SPEED', speed: 1 }],
    ['SET_OPERATING_HOURS', { type: 'SET_OPERATING_HOURS', openHour: 0, closeHour: 0 }],
    ['SET_WALK_INS_PAUSED', { type: 'SET_WALK_INS_PAUSED', paused: true }],
    ['UPDATE_DISH', { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 1 } }],
    ['UPDATE_DRINK', { type: 'UPDATE_DRINK', id: 'water', changes: { price: 100 } }],
    ['SET_MENU_ITEM_SUSPENDED', { type: 'SET_MENU_ITEM_SUSPENDED', kind: 'dish', id: 'starter-toast', suspended: true }],
    ['GIVE_BONUS', { type: 'GIVE_BONUS', id: 'starter-cook' }],
    ['TRAIN_STAFF', { type: 'TRAIN_STAFF', id: 'starter-cook' }],
    ['ACCEPT_SERVICE_CONTRACT', { type: 'ACCEPT_SERVICE_CONTRACT', templateId: 'family-service' }],
    ['WITHDRAW_SERVICE_CONTRACT', { type: 'WITHDRAW_SERVICE_CONTRACT', instanceId: 'sc-1' }],
    ['START_CAREER', { type: 'START_CAREER', confirmedReplace: true, runId: 'replacement' }],
    ['RETRY_CAREER', { type: 'RETRY_CAREER', confirmedReplace: true }],
    ['PLACE_ITEM(table)', { type: 'PLACE_ITEM', itemType: 'table', x: 600, y: 300 }],
  ])('rejects out-of-scope preparation action %s', (type, action) => {
    expect(() => createServiceFixture({ preparation: {
      id: 'out-of-scope', actions: [action],
    } })).toThrow(`Preparation action type not permitted: ${action.type}`);
  });

  it('does not combine explicit reference preparation with legacy strategies', () => {
    const incompatible = { id: 'family-reference', actions: [] };
    const legacy = createServiceFixture({ strategy: 'compact-service' });
    expect(legacy.actions.every(entry => entry.applied)).toBe(true);
    expect(legacy.state.dishes.find(dish => dish.id === 'starter-toast').price).toBe(6);
    expect(legacy.state.drinkOverrides.water.price).toBe(100);
    expect(() => createServiceFixture({ strategy: 'compact-service', preparation: incompatible }))
      .toThrow(/cannot be combined/i);
    expect(() => runRealService({ strategy: 'compact-capacity', preparation: incompatible, duration: 0 }))
      .toThrow(/cannot be combined/i);
  });

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
    expect(state.serviceContracts.active).toMatchObject({ rulesVersion: 6, acceptedAt: 36000, deadlineAt: 44400, target: 4, reward: 120, depositPaid: 30 });
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
  it.skipIf(process.env.PARTY_RUSH_BALANCE !== '1')('historical compact-service probe: five prepared and five starter Rush streams', async () => {
    const reports = [];
    for (const strategy of ['compact-service', 'starter']) {
      for (let seed = 1; seed <= 5; seed++) {
        const { report } = await execute({ seed, templateId: 'party-rush', strategy, maxWallMs: 30000 });
        reports.push(report);
        console.info('PARTY_RUSH_BALANCE', JSON.stringify(compact(report)));
        expect(report.status).toBe('completed');
        expect(report.rulesVersion).toBe(5);
        expect(report.firstSnapshotMismatch).toBeNull();
        expect(report.ordinaryRevenue).toBeGreaterThanOrEqual(0);
        expect(report.contractCash).toBe(report.contractStatus === 'succeeded' ? 180 : -45);
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
  it.skipIf(mode !== 'contracts').each(['office-lunch', 'family-service', 'tasting-service'])('historical v5 uniform starter gate: twenty native 4x streams for %s', async templateId => {
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
    expect(report.paid).toContainEqual(expect.objectContaining({ id: report.boundaryPaymentStep.customerId, at: 42150,
      contractId: 'sc-1', foodOutcome: 'delivered', snapshot: true }));
    expect(report.contractStatus).toBe('succeeded');
    expect(report.fulfilled).toBe(3);
    expect(report.bonus).toBe(100);
    expect(report.breakdown).toEqual({ fulfilled_paid: 3, deadline: 1 });
    expect(report.contractDiagnostics.rulesVersion).toBe(5);
    expect(report.contractDiagnostics.outcomes).toEqual(state.serviceContracts.results.at(-1).guestResults.map(
      ({ guestId, partyId, status, reason, paidVisitSequence, resolvedAt }) => ({
        guestId, partyId, status, reason, paidVisitSequence, resolvedAt,
      }),
    ));
    const qualifyingVisits = new Set(report.paid.filter(visit => visit.contractId === 'sc-1'
      && visit.foodOutcome === 'delivered' && visit.dishPrice > 0).map(visit => visit.sequence));
    const qualifyingOutcomes = report.contractDiagnostics.outcomes.filter(outcome => outcome.status === 'fulfilled_paid');
    expect(qualifyingOutcomes).toHaveLength(qualifyingVisits.size);
    expect(qualifyingVisits.size).toBe(3);
    expect(report.paid.map(visit => visit.sequence)).toEqual([1, 2, 3, 4]);
    expect(report.sequence).toBe(4);
    expect(state.paidVisitSequence).toBe(report.sequence);
    expect(report.funds).toBeCloseTo(757.96);
    expect(state.serviceContracts.results.at(-1)).toMatchObject({ status: report.contractStatus,
      fulfilledCount: report.fulfilled, bonusPaid: report.bonus });
    expect(qualifyingOutcomes.every(outcome => Number.isFinite(report.contractDiagnostics.stagesByGuest
      .find(stage => stage.guestId === outcome.guestId)?.paidAt))).toBe(true);
    expect(report.contractDiagnostics.stagesByGuest.every(stage => stage.seatedAt === null && stage.deliveredAt === null)).toBe(true);
    const { saveState, loadState, hydrateState } = await import('../state/persistence');
    const { createInitialState } = await import('../state/initialState');
    const { runTick } = await import('./gameLoop');
    expect(saveState(state)).toBe(true);
    const loaded = hydrateState(loadState(), createInitialState());
    expect(loaded.serviceContracts.results).toEqual(state.serviceContracts.results);
    expect(loaded.restaurant.funds).toBe(state.restaurant.funds);
    expect(runTick(loaded, { gameDt: 0, movementDt: 0 }).restaurant.funds).toBe(state.restaurant.funds);
  }, 40000);
  it.skipIf(mode && mode !== 'office-success')('serves six real Office meals at native 1x using the extended window and earns the same bonus', async () => {
    const { report } = await execute({ seed: 1, gameStep: 2, maxWallMs: 30000 });
    console.info('REAL_OFFICE_SUCCESS', JSON.stringify(compact(report)));
    expect(report.status).toBe('completed');
    expect(report.contractStatus).toBe('succeeded');
    expect(report.fulfilled).toBe(6);
    expect(report.bonus).toBe(90);
    expect(report.funds).toBeCloseTo(600 + report.ordinaryRevenue + report.bonus);
    const bookedMeals = report.paid.filter(p => p.contractId === 'sc-1' && p.foodOutcome === 'delivered' && p.dishPrice === 12);
    expect(bookedMeals).toHaveLength(6);
    expect(bookedMeals.filter(p => p.at > 41100 && p.at <= 42150)).toHaveLength(2);
  }, 40000);
});
