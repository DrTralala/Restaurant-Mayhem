import { describe, expect, it } from 'vitest';
import { getServiceContractTemplate } from '../data/serviceContracts';
import serviceContractEvidence from '../data/serviceContractsV6Evidence.json';
import {
  CONTRACT_BALANCE_STUDY,
  applyContractBalanceCandidate,
  assertFrozenContractBalanceSelection,
  createContractBalanceStudyRegistry,
  evaluateContractBalanceScreen as evaluateScreen,
  evaluateContractBalanceTierGate as evaluateTierGate,
  expectedContractBalanceSeeds,
  freezeContractBalanceSelection,
  getRecordedContractBalanceCase,
  getRecordedContractBalanceSelection,
  validateContractBalanceCandidate,
} from './contractBalanceStudy.testSupport';

const unitPreparation = Object.freeze({ id: 'unit-preparation', actions: Object.freeze([]) });
const developmentEvidenceSeeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const frozenSelectionCases = [
  { templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1', preparationId: 'office-starter',
    candidate: { id: 'office-lunch-candidate-1', templateId: 'office-lunch', dimension: 'meal-target', change: 2 },
    target: 2, reward: 90, serviceDuration: 5250, tier: { tier: 'introductory', minimum: 16 },
    successes: 17, controlSuccesses: 9, preparationCost: 0, fundsBeforeAcceptance: 600,
    preparationActionTypes: [] },
  { templateId: 'family-service', candidateId: 'baseline', preparationId: 'family-layout',
    candidate: { id: 'baseline', templateId: 'family-service', dimension: null, change: null },
    target: 4, reward: 120, serviceDuration: 7500, tier: { tier: 'standard', minimum: 15 },
    successes: 16, controlSuccesses: 16, preparationCost: 0, fundsBeforeAcceptance: 600,
    preparationActionTypes: [] },
  { templateId: 'tasting-service', candidateId: 'tasting-service-candidate-1', preparationId: 'tasting-layout',
    candidate: { id: 'tasting-service-candidate-1', templateId: 'tasting-service', dimension: 'meal-target', change: 2 },
    target: 2, reward: 100, serviceDuration: 5250, tier: { tier: 'advanced', minimum: 15 },
    successes: 16, controlSuccesses: 10, preparationCost: 0, fundsBeforeAcceptance: 600,
    preparationActionTypes: ['MOVE_FIXTURES'] },
  { templateId: 'party-rush', candidateId: 'party-rush-candidate-1', preparationId: 'rush-combined',
    candidate: { id: 'party-rush-candidate-1', templateId: 'party-rush', dimension: 'meal-target', change: 3 },
    target: 3, reward: 180, serviceDuration: 7500, tier: { tier: 'expert', minimum: 14 },
    successes: 17, controlSuccesses: 9, preparationCost: 300, fundsBeforeAcceptance: 300,
    preparationActionTypes: ['PLACE_ITEM', 'PLACE_ITEM', 'PLACE_ITEM', 'PLACE_ITEM', 'UPGRADE_EQUIPMENT'] },
];

function candidateRow(dimension, change, id = 'office-lunch-candidate-1') {
  return { id, templateId: 'office-lunch', dimension, change };
}

function candidateTargetFor(templateId) {
  return { 'office-lunch': 5, 'family-service': 5, 'tasting-service': 4, 'party-rush': 7 }[templateId];
}

function recordedCaseFor(templateId, candidateId = `${templateId}-candidate-1`, preparation = unitPreparation) {
  const registry = createContractBalanceStudyRegistry();
  const candidate = candidateId === 'baseline'
    ? registry.registerBaseline({ templateId })
    : registry.registerCandidate({ templateId, dimension: 'meal-target', change: candidateTargetFor(templateId) });
  if (candidate.id !== candidateId) throw new Error(`Unexpected test fixture candidate id: ${candidate.id}`);
  return registry.registerPreparation({ templateId, candidateId, preparation });
}

function catalogueValues(template) {
  return { title: template.title, guestLabel: template.guestLabel, profile: template.profile,
    parties: template.parties, serviceDuration: template.serviceDuration, target: template.target, reward: template.reward };
}

function preparationReport(preparation) {
  return {
    id: preparation.id,
    startingFunds: 600,
    fundsBeforeAcceptance: 600,
    cost: 0,
    actionLog: [
      { at: 36000, action: { type: 'SET_SPEED', speed: 4 }, applied: true, fundsBefore: 600, fundsAfter: 600 },
      ...preparation.actions.map(action => ({ at: 36000, action, applied: true, fundsBefore: 600, fundsAfter: 600 })),
    ],
  };
}

function validStudyRows({ templateId = 'office-lunch', candidateId = `${templateId}-candidate-1`,
  recordedCase = null, seeds = [...CONTRACT_BALANCE_STUDY.developmentSeeds], successes = 16 } = {}) {
  const selectedCase = recordedCase || recordedCaseFor(templateId, candidateId);
  const base = getServiceContractTemplate(templateId, 5);
  const candidateTemplate = selectedCase.candidate.id === 'baseline' ? base
    : applyContractBalanceCandidate(base, selectedCase.candidate);
  const candidateGuestCount = candidateTemplate.parties.reduce((sum, party) => sum + party.size, 0);
  const candidateTarget = candidateTemplate.target;
  const controlGuestCount = base.parties.reduce((sum, party) => sum + party.size, 0);
  const controlTarget = base.target;
  const endAt = 36900 + base.serviceDuration;
  const candidatePrep = preparationReport(selectedCase.preparation);
  const controlPrep = preparationReport(selectedCase.preparation);
  const candidateActions = [{ type: 'SET_SPEED', speed: 4 }, ...selectedCase.preparation.actions];
  const rows = seeds.map((seed, index) => {
    const success = index < successes;
    const fulfilled = success ? candidateTarget : Math.max(0, candidateTarget - 1);
    return {
      fixtureId: `${templateId}:${selectedCase.preparation.id}`,
      templateId,
      candidateId,
      dimension: selectedCase.candidate.dimension,
      preparationId: selectedCase.preparation.id,
      preparation: selectedCase.preparation,
      actionLog: candidatePrep.actionLog,
      actionCost: candidatePrep.cost,
      seed,
      gameStep: 8,
      rulesVersion: 5,
      candidate: {
        candidateId,
        reportCandidateId: candidateId,
        templateId,
        seed,
        catalogueValues: catalogueValues(candidateTemplate),
        rulesVersion: 5,
        gameStep: 8,
        status: 'completed',
        contractStatus: success ? 'succeeded' : 'failed',
        success,
        fulfilled,
        target: candidateTarget,
        gameTime: endAt,
        endAt,
        ordinaryRevenue: 100,
        contractCash: 90,
        paidVisits: [],
        reasonCounts: success ? {} : { deadline: 1 },
        stageDiagnostics: { unavailableStages: ['seatedAt', 'deliveredAt'] },
        navigationFault: null,
        runtimeFault: null,
        safetyFaults: [],
        snapshotMismatch: null,
        preparation: candidatePrep,
      },
      control: {
        candidateId: 'baseline',
        reportCandidateId: 'baseline',
        templateId,
        seed,
        catalogueValues: catalogueValues(base),
        rulesVersion: 5,
        gameStep: 8,
        status: 'completed',
        contractStatus: 'failed',
        success: false,
        fulfilled: Math.max(0, controlTarget - 1),
        target: controlTarget,
        gameTime: endAt,
        endAt,
        ordinaryRevenue: 100,
        contractCash: 0,
        paidVisits: [],
        reasonCounts: { deadline: 1 },
        stageDiagnostics: { unavailableStages: ['seatedAt', 'deliveredAt'] },
        navigationFault: null,
        runtimeFault: null,
        safetyFaults: [],
        snapshotMismatch: null,
        preparation: controlPrep,
      },
    };
  });
  Object.defineProperty(rows, 'recordedCase', { value: selectedCase });
  return rows;
}

function evaluateContractBalanceTierGate(options) {
  return evaluateTierGate({ ...options, recordedCase: options.recordedCase || options.rows?.recordedCase });
}

function evaluateContractBalanceScreen(options) {
  return evaluateScreen({ ...options, recordedCase: options.recordedCase || options.rows?.recordedCase });
}

describe('fixed contract-balance study protocol', () => {
  it('pins the approved screening, development, holdout and tier minimums', () => {
    expect(CONTRACT_BALANCE_STUDY.screeningSeeds).toEqual([1, 6, 9, 12, 16]);
    expect(CONTRACT_BALANCE_STUDY.developmentSeeds).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(CONTRACT_BALANCE_STUDY.holdoutSeeds).toEqual(Array.from({ length: 20 }, (_, index) => index + 21));
    expect(CONTRACT_BALANCE_STUDY.maximumCandidatesPerTier).toBe(3);
    expect(CONTRACT_BALANCE_STUDY.gameStep).toBe(8);
    expect(CONTRACT_BALANCE_STUDY.maximumStreamWallMs).toBe(30000);
    expect(CONTRACT_BALANCE_STUDY.tiers).toEqual({
      'office-lunch': { tier: 'introductory', minimum: 16 },
      'family-service': { tier: 'standard', minimum: 15 },
      'tasting-service': { tier: 'advanced', minimum: 15 },
      'party-rush': { tier: 'expert', minimum: 14 },
    });
    expect(expectedContractBalanceSeeds('screen')).toEqual([1, 6, 9, 12, 16]);
    expect(expectedContractBalanceSeeds('development')).toEqual(CONTRACT_BALANCE_STUDY.developmentSeeds);
    expect(expectedContractBalanceSeeds('holdout')).toEqual(CONTRACT_BALANCE_STUDY.holdoutSeeds);
  });
});

describe('durable recorded development cases', () => {
  it('reconstructs the approved baseline and candidate cases by CLI selectors', () => {
    const office = getRecordedContractBalanceCase({ templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', preparationId: 'office-starter' });
    const family = getRecordedContractBalanceCase({ templateId: 'family-service',
      candidateId: 'baseline', preparationId: 'family-layout' });
    const tasting = getRecordedContractBalanceCase({ templateId: 'tasting-service',
      candidateId: 'tasting-service-candidate-1', preparationId: 'tasting-layout' });
    const rush = getRecordedContractBalanceCase({ templateId: 'party-rush',
      candidateId: 'party-rush-candidate-1', preparationId: 'rush-combined' });

    expect(office.candidate).toMatchObject({ id: 'office-lunch-candidate-1', dimension: 'meal-target', change: 2 });
    expect(family.candidate).toEqual({ id: 'baseline', templateId: 'family-service', dimension: null, change: null });
    expect(tasting.candidate).toMatchObject({ id: 'tasting-service-candidate-1', dimension: 'meal-target', change: 2 });
    expect(rush.candidate).toMatchObject({ id: 'party-rush-candidate-1', dimension: 'meal-target', change: 3 });
    expect([office, family, tasting, rush].every(record => typeof record.rationale === 'string'
      && record.rationale.length > 0)).toBe(true);
  });

  it.each(frozenSelectionCases.map(expected => [expected.templateId, expected]))(
    'loads the tracked %s selection with its recorded case and evidence without an ignored local report',
    (_templateId, expected) => {
      const selector = { templateId: expected.templateId, candidateId: expected.candidateId,
        preparationId: expected.preparationId };
      const recordedCase = getRecordedContractBalanceCase(selector);
      const selection = getRecordedContractBalanceSelection(selector);
      const evidenceOffer = serviceContractEvidence.selectedOffers.find(offer => offer.templateId === expected.templateId);
      const evidenceRows = selection.development.evidenceRows;
      const catalogueKeys = ['title', 'guestLabel', 'profile', 'parties', 'serviceDuration', 'target', 'reward'];

      expect(evidenceOffer).toBeDefined();
      expect(recordedCase.candidate).toEqual(expected.candidate);
      expect(recordedCase.preparation).toEqual({ id: expected.preparationId,
        actions: evidenceOffer.preparation.actions });
      expect(recordedCase.rationale).toBe(evidenceOffer.rationale);
      expect(recordedCase.tier).toEqual(expected.tier);
      expect(recordedCase.screening).toBeNull();
      expect(selection).toMatchObject({ schemaVersion: 1, rulesVersion: 5,
        templateId: expected.templateId, candidateId: expected.candidateId,
        dimension: expected.candidate.dimension, change: expected.candidate.change,
        development: { expectedSeeds: developmentEvidenceSeeds, passed: true,
          successes: expected.successes, minimum: expected.tier.minimum } });
      expect(selection.rationale).toBe(evidenceOffer.rationale);
      expect(selection.preparation).toEqual(evidenceOffer.preparation);
      expect(selection.preparation).toMatchObject({ id: expected.preparationId,
        cost: expected.preparationCost, startingFunds: 600,
        fundsBeforeAcceptance: expected.fundsBeforeAcceptance });
      expect(selection.preparation.actions.map(action => action.type)).toEqual(expected.preparationActionTypes);
      expect(selection.selectedCatalogueValues).toEqual(Object.fromEntries(
        catalogueKeys.map(key => [key, evidenceOffer.v6Offer[key]])));
      expect(selection.tier).toEqual(expected.tier);
      expect(selection.declaredTierMinimums).toEqual({ office: 16, family: 15, tasting: 15, rush: 14 });
      expect(evidenceOffer.development.gate).toMatchObject({ successes: expected.successes,
        minimum: expected.tier.minimum, passed: true });
      expect(evidenceRows).toHaveLength(20);
      expect(evidenceRows.map(row => row.seed)).toEqual(developmentEvidenceSeeds);
      expect(evidenceRows.every(row => row.fixtureId === `${expected.templateId}:${expected.preparationId}`
        && row.templateId === expected.templateId && row.candidateId === expected.candidateId
        && row.preparationId === expected.preparationId && row.dimension === expected.candidate.dimension
        && row.rulesVersion === 5 && row.gameStep === 8
        && row.candidate.reportCandidateId === expected.candidateId
        && row.control.reportCandidateId === 'baseline')).toBe(true);
      expect(evidenceRows.filter(row => row.candidate.success)).toHaveLength(expected.successes);
      expect(evidenceRows.filter(row => row.control.success)).toHaveLength(expected.controlSuccesses);
      expect(evidenceRows.map(row => [row.seed,
        [row.candidate.success, row.candidate.fulfilled, row.candidate.target],
        [row.control.success, row.control.fulfilled, row.control.target]])).toEqual(
        evidenceOffer.development.rows.map(([seed, candidate, control]) => [seed,
          candidate.slice(0, 3), control.slice(0, 3)]));
      expect(evidenceRows.map(row => [row.seed,
        serviceContractEvidence.rowSchema.paymentColumns.map(column => row.candidate.paymentTotals[column]),
        serviceContractEvidence.rowSchema.paymentColumns.map(column => row.control.paymentTotals[column])]))
        .toEqual(evidenceOffer.development.rows.map(([seed, candidate, control]) => [
          seed, candidate[3], control[3],
        ]));
    },
  );
});

describe('one-dimension v5 candidate validation', () => {
  it('changes arrival offsets only and preserves all other template values', () => {
    const base = getServiceContractTemplate('office-lunch', 5);
    const candidate = candidateRow('arrival-spacing', [0, 721, 1440]);
    const patched = applyContractBalanceCandidate(base, candidate);

    expect(patched.parties.map(({ arrivalOffset }) => arrivalOffset)).toEqual([0, 721, 1440]);
    expect(patched.parties.map(({ partyType, size }) => ({ partyType, size })))
      .toEqual(base.parties.map(({ partyType, size }) => ({ partyType, size })));
    expect(patched).toMatchObject({ id: base.id, title: base.title, guestLabel: base.guestLabel,
      profile: base.profile, serviceDuration: base.serviceDuration, target: base.target, reward: base.reward });
  });

  it('changes party type and size only while preserving party count and total guests', () => {
    const base = getServiceContractTemplate('office-lunch', 5);
    const candidate = candidateRow('party-composition', { parties: [
      { partyType: 'family', size: 4 },
      { partyType: 'solo', size: 1 },
      { partyType: 'solo', size: 1 },
    ] });
    const patched = applyContractBalanceCandidate(base, candidate);

    expect(patched.parties.map(({ partyType, size }) => ({ partyType, size }))).toEqual([
      { partyType: 'family', size: 4 }, { partyType: 'solo', size: 1 }, { partyType: 'solo', size: 1 },
    ]);
    expect(patched.parties.map(({ arrivalOffset }) => arrivalOffset))
      .toEqual(base.parties.map(({ arrivalOffset }) => arrivalOffset));
    expect(patched.parties).toHaveLength(base.parties.length);
    expect(patched.parties.reduce((sum, party) => sum + party.size, 0))
      .toBe(base.parties.reduce((sum, party) => sum + party.size, 0));
    expect(patched).toMatchObject({ id: base.id, title: base.title, guestLabel: base.guestLabel,
      profile: base.profile, serviceDuration: base.serviceDuration, target: base.target, reward: base.reward });
  });

  it('changes the meal target only', () => {
    const base = getServiceContractTemplate('office-lunch', 5);
    const candidate = candidateRow('meal-target', 5);
    const patched = applyContractBalanceCandidate(base, candidate);

    expect(patched.target).toBe(5);
    expect(patched).toMatchObject({ id: base.id, title: base.title, guestLabel: base.guestLabel,
      profile: base.profile, parties: base.parties, serviceDuration: base.serviceDuration, reward: base.reward });
  });

  it('rejects a candidate based on a modified or historical catalogue entry', () => {
    const v5Template = getServiceContractTemplate('office-lunch', 5);
    const candidate = candidateRow('meal-target', 5);
    expect(() => validateContractBalanceCandidate(candidate, { ...v5Template, reward: 999 })).toThrow(/original v5/i);
    expect(() => validateContractBalanceCandidate(candidate, getServiceContractTemplate('office-lunch', 4)))
      .toThrow(/original v5/i);
  });

  it.each([
    ['wrong arrival count', candidateRow('arrival-spacing', [0, 600])],
    ['non-finite arrival', candidateRow('arrival-spacing', [0, NaN, 1440])],
    ['wrong party count', candidateRow('party-composition', { parties: [{ partyType: 'family', size: 6 }] })],
    ['changed guest workload', candidateRow('party-composition', { parties: [
      { partyType: 'couple', size: 2 }, { partyType: 'couple', size: 2 }, { partyType: 'couple', size: 1 },
    ] })],
    ['extra profile change', { ...candidateRow('meal-target', 5), change: { target: 5, reward: 999 } }],
    ['invalid target', candidateRow('meal-target', 0)],
    ['target above the guest workload', candidateRow('meal-target', 7)],
  ])('rejects %s rather than changing another contract dimension', (_name, candidate) => {
    expect(() => validateContractBalanceCandidate(candidate, getServiceContractTemplate('office-lunch', 5)))
      .toThrow();
  });
});

describe('recorded candidate cases and selection artefacts', () => {
  it('assigns unique deterministic ids and retains a screened rejection against the tier cap', () => {
    const registry = createContractBalanceStudyRegistry();
    const candidate1 = registry.registerCandidate({ templateId: 'office-lunch', dimension: 'meal-target', change: 5 });
    const candidate1Case = registry.registerPreparation({ templateId: 'office-lunch', candidateId: candidate1.id,
      preparation: unitPreparation });
    expect(() => registry.registerCandidate({ id: candidate1.id, templateId: 'office-lunch',
      dimension: 'meal-target', change: 6 })).toThrow(/candidate-2|cannot be reused/i);
    const screeningEvidence = validStudyRows({ recordedCase: candidate1Case, seeds: [1, 6, 9, 12, 16], successes: 0 });
    const rejected = registry.recordScreeningResult({ templateId: 'office-lunch', candidateId: candidate1.id,
      preparationId: unitPreparation.id, rejected: true,
      reason: 'The paired screening rows show fewer fulfilled guests on every screening seed.',
      evidence: screeningEvidence });
    expect(() => freezeContractBalanceSelection({ recordedCase: rejected,
      developmentRows: validStudyRows({ recordedCase: rejected }) }))
      .toThrow(/rejected|screening/i);
    const candidate2 = registry.registerCandidate({ templateId: 'office-lunch', dimension: 'arrival-spacing',
      change: [0, 721, 1440] });
    const candidate3 = registry.registerCandidate({ templateId: 'office-lunch', dimension: 'party-composition',
      change: { parties: [{ partyType: 'family', size: 4 }, { partyType: 'solo', size: 1 }, { partyType: 'solo', size: 1 }] } });

    expect([candidate1.id, candidate2.id, candidate3.id]).toEqual([
      'office-lunch-candidate-1', 'office-lunch-candidate-2', 'office-lunch-candidate-3',
    ]);
    expect(new Set([candidate1.id, candidate2.id, candidate3.id]).size).toBe(3);
    expect(rejected.screening).toMatchObject({ rejected: true,
      reason: 'The paired screening rows show fewer fulfilled guests on every screening seed.' });
    expect(rejected.screening.evidence).toEqual(screeningEvidence);
    expect(() => registry.registerCandidate({ templateId: 'office-lunch', dimension: 'meal-target', change: 6 }))
      .toThrow(/maximum.*3|three/i);
  });

  it('requires an exact previously recorded candidate and preparation pair', () => {
    const registry = createContractBalanceStudyRegistry();
    const candidate = registry.registerCandidate({ templateId: 'office-lunch', dimension: 'meal-target', change: 5 });
    registry.registerPreparation({ templateId: 'office-lunch', candidateId: candidate.id, preparation: unitPreparation });

    expect(registry.getRecordedCase({ templateId: 'office-lunch', candidateId: candidate.id,
      preparationId: unitPreparation.id }).candidate).toEqual(candidate);
    expect(() => registry.getRecordedCase({ templateId: 'office-lunch', candidateId: candidate.id,
      preparationId: 'unknown-preparation' })).toThrow(/not recorded/i);
    expect(() => registry.registerPreparation({ templateId: 'office-lunch', candidateId: candidate.id,
      preparation: unitPreparation })).toThrow(/already recorded|duplicate/i);
  });

  it('freezes a passing development selection with the patch, setup evidence, catalogue and all tier minima', () => {
    const registry = createContractBalanceStudyRegistry();
    const candidate = registry.registerCandidate({ templateId: 'office-lunch', dimension: 'meal-target', change: 5 });
    const recordedCase = registry.registerPreparation({ templateId: 'office-lunch', candidateId: candidate.id,
      preparation: unitPreparation });
    const rows = validStudyRows({ recordedCase });
    const artifact = freezeContractBalanceSelection({ recordedCase, developmentRows: rows });

    expect(artifact).toMatchObject({ schemaVersion: 1, rulesVersion: 5, templateId: 'office-lunch',
      candidateId: candidate.id, dimension: 'meal-target', change: 5,
      preparation: { id: 'unit-preparation', cost: 0 },
      selectedCatalogueValues: { target: 5, reward: 90, serviceDuration: 5250 },
      tier: { tier: 'introductory', minimum: 16 },
      declaredTierMinimums: { office: 16, family: 15, tasting: 15, rush: 14 },
      development: { expectedSeeds: CONTRACT_BALANCE_STUDY.developmentSeeds, successes: 16, minimum: 16, passed: true },
    });
    expect(artifact.development.evidenceRows).toHaveLength(20);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.preparation.actions)).toBe(true);
    expect(Object.isFrozen(artifact.selectedCatalogueValues.parties)).toBe(true);
    expect(assertFrozenContractBalanceSelection(artifact, recordedCase)).toBe(true);
    const storedSelection = registry.registerSelection(artifact);
    expect(registry.getSelection({ templateId: 'office-lunch', candidateId: candidate.id,
      preparationId: unitPreparation.id })).toEqual(storedSelection);
    const otherCandidate = registry.registerCandidate({ templateId: 'office-lunch',
      dimension: 'arrival-spacing', change: [0, 721, 1440] });
    const otherCase = registry.registerPreparation({ templateId: 'office-lunch', candidateId: otherCandidate.id,
      preparation: unitPreparation });
    const otherArtifact = freezeContractBalanceSelection({ recordedCase: otherCase,
      developmentRows: validStudyRows({ recordedCase: otherCase, candidateId: otherCandidate.id }) });
    expect(() => registry.registerSelection(otherArtifact)).toThrow(/one configuration.*tier|tier.*already selected/i);
    expect(() => freezeContractBalanceSelection({ recordedCase,
      developmentRows: validStudyRows({ recordedCase, successes: 15 }) })).toThrow(/minimum|gate|qualif/i);
    expect(() => assertFrozenContractBalanceSelection({ ...artifact, change: 4 }, recordedCase))
      .toThrow(/does not match|changed|frozen/i);
    expect(() => assertFrozenContractBalanceSelection({ ...artifact,
      development: { ...artifact.development, successes: undefined } }, recordedCase)).toThrow(/development/i);
    expect(() => assertFrozenContractBalanceSelection({ ...artifact,
      development: { ...artifact.development, successes: 20 } }, recordedCase)).toThrow(/development/i);
    expect(() => assertFrozenContractBalanceSelection({ ...artifact,
      preparation: { ...artifact.preparation, cost: 100, fundsBeforeAcceptance: 500 } }, recordedCase))
      .toThrow(/preparation|setup cost/i);
    const forgedSelection = { ...artifact, development: { ...artifact.development, evidenceRows: undefined } };
    expect(() => assertFrozenContractBalanceSelection(forgedSelection, recordedCase)).toThrow(/development evidence/i);
    const freshRegistry = createContractBalanceStudyRegistry();
    const freshCandidate = freshRegistry.registerCandidate({ templateId: 'office-lunch', dimension: 'meal-target', change: 5 });
    freshRegistry.registerPreparation({ templateId: 'office-lunch', candidateId: freshCandidate.id,
      preparation: unitPreparation });
    expect(() => freshRegistry.registerSelection(forgedSelection)).toThrow(/development evidence/i);
    const relabelledEvidence = artifact.development.evidenceRows.map((row, index) => index === 0
      ? { ...row, seed: 99 } : row);
    expect(() => assertFrozenContractBalanceSelection({ ...artifact,
      development: { ...artifact.development, evidenceRows: relabelledEvidence } }, recordedCase))
      .toThrow(/development evidence|seed/i);
    const changedSetupEvidence = artifact.development.evidenceRows.map(row => row.seed === 2 ? {
      ...row,
      actionCost: 100,
      candidate: { ...row.candidate, preparation: { ...row.candidate.preparation,
        cost: 100, fundsBeforeAcceptance: 500 } },
      control: { ...row.control, preparation: { ...row.control.preparation,
        cost: 100, fundsBeforeAcceptance: 500 } },
    } : row);
    expect(() => assertFrozenContractBalanceSelection({ ...artifact,
      development: { ...artifact.development, evidenceRows: changedSetupEvidence } }, recordedCase))
      .toThrow(/preparation|setup cost/i);

    const holdoutRows = validStudyRows({ recordedCase, seeds: [...CONTRACT_BALANCE_STUDY.holdoutSeeds], successes: 16 });
    expect(evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: candidate.id,
      phase: 'holdout', rows: holdoutRows, selectionArtifact: storedSelection }).passed).toBe(true);
    expect(evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: candidate.id,
      phase: 'holdout', rows: holdoutRows }).passed).toBe(false);
    const weakenedSelection = { ...storedSelection, tier: { tier: 'introductory', minimum: 1 },
      development: { ...storedSelection.development, minimum: 1 } };
    expect(evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: candidate.id,
      phase: 'holdout', rows: holdoutRows, selectionArtifact: weakenedSelection }).passed).toBe(false);
  });

  it('allows a recorded unchanged v5 baseline to be frozen without a workload patch', () => {
    const registry = createContractBalanceStudyRegistry();
    const candidate = registry.registerBaseline({ templateId: 'family-service' });
    const recordedCase = registry.registerPreparation({ templateId: 'family-service', candidateId: 'baseline',
      preparation: unitPreparation });
    const rows = validStudyRows({ recordedCase, templateId: 'family-service', candidateId: 'baseline',
      seeds: [...CONTRACT_BALANCE_STUDY.developmentSeeds], successes: 15 });
    for (const row of rows) {
      row.dimension = null;
      row.candidate.target = 4;
    }
    const artifact = freezeContractBalanceSelection({ recordedCase, developmentRows: rows });

    expect(candidate).toEqual({ id: 'baseline', templateId: 'family-service', dimension: null, change: null });
    expect(artifact).toMatchObject({ candidateId: 'baseline', dimension: null, change: null,
      selectedCatalogueValues: { target: 4 }, tier: { tier: 'standard', minimum: 15 } });
    expect(assertFrozenContractBalanceSelection(artifact, recordedCase)).toBe(true);
  });
});

describe('executable fixed-seed evidence gates', () => {
  it('requires the recorded case instead of trusting row labels alone', () => {
    const rows = validStudyRows();
    const gate = evaluateTierGate({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      phase: 'development', rows });

    expect(gate.passed).toBe(false);
    expect(gate.failures.join(' ')).toMatch(/recorded case|recorded candidate/i);
  });

  it('accepts a complete 16-of-20 development sample and rejects missing or below-minimum streams', () => {
    const gate = evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      phase: 'development', rows: validStudyRows() });
    expect(gate).toMatchObject({ passed: true, expectedCount: 20, completedCount: 20, successes: 16, minimum: 16 });

    const missing = evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      phase: 'development', rows: validStudyRows({ seeds: CONTRACT_BALANCE_STUDY.developmentSeeds.slice(1) }) });
    expect(missing.passed).toBe(false);
    expect(missing.failures.join(' ')).toMatch(/seed|complete|count/i);

    const belowMinimum = evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      phase: 'development', rows: validStudyRows({ successes: 15 }) });
    expect(belowMinimum).toMatchObject({ passed: false, successes: 15, minimum: 16 });
  });

  it('rejects any candidate or control runtime, navigation, snapshot or safety fault', () => {
    const rows = validStudyRows();
    rows[0].candidate.navigationFault = { reason: 'blocked' };
    rows[1].control.runtimeFault = { message: 'tick exception' };
    rows[2].candidate.snapshotMismatch = { customerId: 'guest-1' };
    rows[3].control.safetyFaults = ['invalid identity'];
    const gate = evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      phase: 'development', rows });

    expect(gate.passed).toBe(false);
    expect(gate.failures.join(' ')).toMatch(/navigation|runtime|snapshot|safety/i);
  });

  it('rejects completed partial simulations that never settled their contract', () => {
    const rows = validStudyRows();
    rows[0].candidate.contractStatus = null;
    rows[1].control.gameTime = 40000;
    const gate = evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      phase: 'development', rows });

    expect(gate.passed).toBe(false);
    expect(gate.failures.join(' ')).toMatch(/settle|complete|deadline/i);
  });

  it('rejects a reported success when fulfilled guests do not meet the target', () => {
    const rows = validStudyRows();
    rows[0].candidate.fulfilled = 4;
    const gate = evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      phase: 'development', rows });

    expect(gate.passed).toBe(false);
    expect(gate.failures.join(' ')).toMatch(/fulfilled|target|success/i);
  });

  it('rejects invalid target and fulfilment bounds before counting results', () => {
    const invalidFields = [
      ['zero target', row => { row.candidate.target = 0; }],
      ['target above roster', row => { row.candidate.target = 7; }],
      ['negative fulfilment', row => { row.candidate.fulfilled = -1; }],
      ['fulfilment above roster', row => { row.candidate.fulfilled = 7; }],
    ];
    for (const [label, mutate] of invalidFields) {
      const rows = validStudyRows();
      mutate(rows[0]);
      const gate = evaluateContractBalanceTierGate({ templateId: 'office-lunch',
        candidateId: 'office-lunch-candidate-1', phase: 'development', rows });
      expect(gate.passed, label).toBe(false);
    }
  });

  it('rejects relabelled execution seeds, fixture setup and candidate catalogue values', () => {
    const corruptions = [
      ['execution seed', rows => { rows[0].candidate.seed = 20; }],
      ['report candidate id', rows => { rows[0].candidate.reportCandidateId = 'baseline'; }],
      ['fixture identity', rows => { rows[0].fixtureId = 'family-service:unit-preparation'; }],
      ['registered setup', rows => {
        const wrongAction = [{ at: 36000, action: { type: 'UPGRADE_EQUIPMENT', id: 'eq1' }, applied: true }];
        rows[0].candidate.preparation.actionLog = wrongAction;
        rows[0].control.preparation.actionLog = wrongAction;
      }],
      ['candidate catalogue', rows => { rows[0].candidate.catalogueValues = rows[0].control.catalogueValues; }],
      ['execution template', rows => { rows[0].candidate.templateId = 'family-service'; }],
    ];
    for (const [label, corrupt] of corruptions) {
      const rows = validStudyRows();
      corrupt(rows);
      const gate = evaluateContractBalanceTierGate({ templateId: 'office-lunch',
        candidateId: 'office-lunch-candidate-1', phase: 'development', rows });
      expect(gate.passed, label).toBe(false);
    }
  });

  it('rejects altered run steps, candidate identity and unpaired preparation actions', () => {
    const rows = validStudyRows();
    rows[0].candidate.gameStep = 2;
    rows[1].candidate.candidateId = 'baseline';
    rows[2].control.preparation.actionLog.push({ at: 36000, action: { type: 'UPGRADE_EQUIPMENT', id: 'eq1' }, applied: true });
    const gate = evaluateContractBalanceTierGate({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      phase: 'development', rows });

    expect(gate.passed).toBe(false);
    expect(gate.failures.join(' ')).toMatch(/step|candidate|preparation|action/i);
  });

  it('uses only the five fixed screening seeds and rejects incomplete screening pairs', () => {
    const rows = validStudyRows({ seeds: [1, 6, 9, 12, 16], successes: 5 });
    const result = evaluateContractBalanceScreen({ templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', rows });
    expect(result).toMatchObject({ valid: true, expectedCount: 5, completedCount: 5 });
    expect(evaluateContractBalanceScreen({ templateId: 'office-lunch', candidateId: 'office-lunch-candidate-1',
      recordedCase: rows.recordedCase, rows: rows.slice(0, 4) }).valid).toBe(false);
  });

  it.each([
    ['office-lunch', 'introductory', 16],
    ['family-service', 'standard', 15],
    ['tasting-service', 'advanced', 15],
    ['party-rush', 'expert', 14],
  ])('applies the declared %s (%s) threshold of %i successes', (templateId, _tier, minimum) => {
    const candidateId = `${templateId}-candidate-1`;
    const rows = successes => validStudyRows({ templateId, candidateId, successes });
    expect(evaluateContractBalanceTierGate({ templateId, candidateId, phase: 'development',
      rows: rows(minimum) })).toMatchObject({ passed: true, successes: minimum, minimum });
    expect(evaluateContractBalanceTierGate({ templateId, candidateId, phase: 'development',
      rows: rows(minimum - 1) })).toMatchObject({ passed: false, successes: minimum - 1, minimum });
  });
});
