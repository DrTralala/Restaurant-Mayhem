import { getServiceContractTemplate } from '../data/serviceContracts';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { REFERENCE_SERVICE_PREPARATIONS } from './realServiceHarness.testSupport';
import durableStudyCases from './contractBalanceStudyCases.testSupport.json';
import durableStudySelections from './contractBalanceStudySelections.testSupport.json';

const tierMinimums = {
  'office-lunch': Object.freeze({ tier: 'introductory', minimum: 16 }),
  'family-service': Object.freeze({ tier: 'standard', minimum: 15 }),
  'tasting-service': Object.freeze({ tier: 'advanced', minimum: 15 }),
  'party-rush': Object.freeze({ tier: 'expert', minimum: 14 }),
};

export const CONTRACT_BALANCE_STUDY = Object.freeze({
  screeningSeeds: Object.freeze([1, 6, 9, 12, 16]),
  developmentSeeds: Object.freeze(Array.from({ length: 20 }, (_, index) => index + 1)),
  holdoutSeeds: Object.freeze(Array.from({ length: 20 }, (_, index) => index + 21)),
  maximumCandidatesPerTier: 3,
  gameStep: 8,
  maximumStreamWallMs: 30000,
  tiers: Object.freeze(tierMinimums),
});

const declaredTierMinimums = Object.freeze({ office: 16, family: 15, tasting: 15, rush: 14 });
const candidateDimensions = new Set(['arrival-spacing', 'party-composition', 'meal-target']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function getTier(templateId) {
  if (!Object.hasOwn(CONTRACT_BALANCE_STUDY.tiers, templateId)) {
    throw new Error(`No contract-balance tier is declared for template: ${templateId}`);
  }
  const tier = CONTRACT_BALANCE_STUDY.tiers[templateId];
  return tier;
}

function templateFor(candidate) {
  const template = getServiceContractTemplate(candidate?.templateId, 5);
  if (!template) throw new Error(`Unknown v5 service-contract template: ${candidate?.templateId}`);
  return template;
}

function expectedCandidateId(templateId, ordinal) {
  return `${templateId}-candidate-${ordinal}`;
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateContractBalanceCandidate(candidate, template = templateFor(candidate)) {
  if (!exactKeys(candidate, ['id', 'templateId', 'dimension', 'change'])) {
    throw new Error('Candidate must contain exactly id, templateId, dimension and change');
  }
  const originalTemplate = nonEmptyText(candidate.templateId)
    ? getServiceContractTemplate(candidate.templateId, 5) : null;
  if (!nonEmptyText(candidate.templateId) || !getTier(candidate.templateId)
    || !originalTemplate || template?.id !== candidate.templateId || !sameValue(template, originalTemplate)) {
    throw new Error('Candidate must be based on the original v5 catalogue entry');
  }
  if (!nonEmptyText(candidate.id)
    || !new RegExp(`^${candidate.templateId}-candidate-[1-${CONTRACT_BALANCE_STUDY.maximumCandidatesPerTier}]$`)
      .test(candidate.id)) {
    throw new Error(`Candidate id must be ${candidate.templateId}-candidate-1 through -3`);
  }
  if (!candidateDimensions.has(candidate.dimension)) {
    throw new Error('Candidate must change exactly one approved workload dimension');
  }

  if (candidate.dimension === 'arrival-spacing') {
    if (!Array.isArray(candidate.change) || candidate.change.length !== template.parties.length
      || candidate.change.some(offset => !Number.isFinite(offset) || offset < 0)) {
      throw new Error('arrival-spacing change must be non-negative finite offsets matching the base party count');
    }
    if (candidate.change.every((offset, index) => offset === template.parties[index].arrivalOffset)) {
      throw new Error('Candidate workload patch must change the v5 template');
    }
  }

  if (candidate.dimension === 'party-composition') {
    if (!exactKeys(candidate.change, ['parties']) || !Array.isArray(candidate.change.parties)
      || candidate.change.parties.length !== template.parties.length) {
      throw new Error('party-composition change must contain one party row per base party');
    }
    for (const party of candidate.change.parties) {
      if (!exactKeys(party, ['partyType', 'size']) || !nonEmptyText(party.partyType)
        || !Number.isSafeInteger(party.size) || party.size <= 0) {
        throw new Error('party-composition rows may contain only a non-empty partyType and positive integer size');
      }
    }
    const baseGuests = template.parties.reduce((sum, party) => sum + party.size, 0);
    const candidateGuests = candidate.change.parties.reduce((sum, party) => sum + party.size, 0);
    if (candidateGuests !== baseGuests) {
      throw new Error(`party-composition must preserve total guest workload (${baseGuests})`);
    }
    if (candidate.change.parties.every((party, index) => party.partyType === template.parties[index].partyType
      && party.size === template.parties[index].size)) {
      throw new Error('Candidate workload patch must change the v5 template');
    }
  }

  if (candidate.dimension === 'meal-target') {
    if (!Number.isSafeInteger(candidate.change) || candidate.change <= 0) {
      throw new Error('meal-target change must be a positive integer');
    }
    const guestCount = template.parties.reduce((sum, party) => sum + party.size, 0);
    if (candidate.change > guestCount) {
      throw new Error(`meal-target change cannot exceed the template guest workload (${guestCount})`);
    }
    if (candidate.change === template.target) throw new Error('Candidate workload patch must change the v5 template');
  }

  return candidate;
}

export function applyContractBalanceCandidate(template, candidate) {
  validateContractBalanceCandidate(candidate, template);
  const patched = clone(template);
  if (candidate.dimension === 'arrival-spacing') {
    patched.parties = patched.parties.map((party, index) => ({
      ...party, arrivalOffset: candidate.change[index],
    }));
  } else if (candidate.dimension === 'party-composition') {
    patched.parties = patched.parties.map((party, index) => ({
      ...party,
      partyType: candidate.change.parties[index].partyType,
      size: candidate.change.parties[index].size,
    }));
  } else {
    patched.target = candidate.change;
  }
  return deepFreeze(patched);
}

export function createServiceContractCataloguePin(actualCatalogue, rulesVersion) {
  if (!actualCatalogue || ![5, 6].includes(rulesVersion)
    || typeof actualCatalogue.getServiceContractTemplate !== 'function'
    || !Array.isArray(actualCatalogue.SERVICE_CONTRACTS)) {
    throw new Error('Service-contract catalogue pin requires a supported catalogue module and rules version');
  }
  const catalogue = Object.freeze(actualCatalogue.SERVICE_CONTRACTS.map(template =>
    actualCatalogue.getServiceContractTemplate(template.id, rulesVersion)));
  return {
    ...actualCatalogue,
    SERVICE_CONTRACT_RULES_VERSION: rulesVersion,
    SERVICE_CONTRACTS: catalogue,
    getServiceContractTemplate(templateId, selectedVersion = rulesVersion) {
      if (selectedVersion === rulesVersion) return catalogue.find(template => template.id === templateId) || null;
      return actualCatalogue.getServiceContractTemplate(templateId, selectedVersion);
    },
  };
}

export function createCandidateCatalogueOverlay(actualCatalogue, candidate) {
  if (!actualCatalogue || actualCatalogue.SERVICE_CONTRACT_RULES_VERSION !== 5
    || typeof actualCatalogue.getServiceContractTemplate !== 'function'
    || !Array.isArray(actualCatalogue.SERVICE_CONTRACTS)) {
    throw new Error('Candidate overlay requires a v5-pinned catalogue module');
  }
  const originalTemplate = actualCatalogue.getServiceContractTemplate(candidate?.templateId, 5);
  if (!originalTemplate) throw new Error(`Unknown v5 service-contract template: ${candidate?.templateId}`);
  const replacement = applyContractBalanceCandidate(originalTemplate, candidate);
  const catalogue = Object.freeze(actualCatalogue.SERVICE_CONTRACTS.map(template =>
    template.id === candidate.templateId ? replacement : template));
  return {
    ...actualCatalogue,
    SERVICE_CONTRACTS: catalogue,
    getServiceContractTemplate(templateId, rulesVersion = actualCatalogue.SERVICE_CONTRACT_RULES_VERSION) {
      if (rulesVersion === 5) return catalogue.find(template => template.id === templateId) || null;
      return actualCatalogue.getServiceContractTemplate(templateId, rulesVersion);
    },
  };
}

export function expectedContractBalanceSeeds(phase) {
  const seeds = phase === 'screen' ? CONTRACT_BALANCE_STUDY.screeningSeeds
    : phase === 'development' ? CONTRACT_BALANCE_STUDY.developmentSeeds
      : phase === 'holdout' ? CONTRACT_BALANCE_STUDY.holdoutSeeds : null;
  if (!seeds) throw new Error(`Unknown contract-balance study phase: ${phase}`);
  return [...seeds];
}

function candidateKey(templateId, candidateId) {
  return `${templateId}\u0000${candidateId}`;
}

function caseKey(templateId, candidateId, preparationId) {
  return `${candidateKey(templateId, candidateId)}\u0000${preparationId}`;
}

function selectionKey(selection) {
  return caseKey(selection.templateId, selection.candidateId, selection.preparation.id);
}

function candidateTemplate(recordedCase) {
  const template = templateFor(recordedCase.candidate);
  return recordedCase.candidate.id === 'baseline' ? template
    : applyContractBalanceCandidate(template, recordedCase.candidate);
}

export function createContractBalanceStudyRegistry() {
  const candidates = new Map();
  const recordedCases = new Map();
  const selections = new Map();

  function getCandidateRecord(templateId, candidateId) {
    const record = candidates.get(candidateKey(templateId, candidateId));
    if (!record) throw new Error(`Candidate is not recorded: ${templateId}/${candidateId}`);
    return record;
  }

  function getRecordedCase({ templateId, candidateId, preparationId }) {
    const record = recordedCases.get(caseKey(templateId, candidateId, preparationId));
    if (!record) throw new Error(`Study case is not recorded: ${templateId}/${candidateId}/${preparationId}`);
    return record;
  }

  return Object.freeze({
    registerCandidate(input) {
      if (!isObject(input) || Object.keys(input).some(key =>
        !['templateId', 'dimension', 'change', 'id', 'rationale'].includes(key))) {
        throw new Error('Candidate registration accepts only id, templateId, dimension, change and rationale');
      }
      if (input.rationale !== undefined && !nonEmptyText(input.rationale)) {
        throw new Error('Recorded candidate rationale must be non-empty');
      }
      const { templateId, dimension, change } = input;
      const tier = getTier(templateId);
      const tierCandidates = [...candidates.values()].filter(record => record.tier.tier === tier.tier
        && record.candidate.id !== 'baseline');
      if (tierCandidates.length >= CONTRACT_BALANCE_STUDY.maximumCandidatesPerTier) {
        throw new Error(`Maximum of ${CONTRACT_BALANCE_STUDY.maximumCandidatesPerTier} candidates reached for ${tier.tier} tier`);
      }
      const templateCandidates = tierCandidates.filter(record => record.candidate.templateId === templateId);
      const id = input.id ?? expectedCandidateId(templateId, templateCandidates.length + 1);
      const expectedId = expectedCandidateId(templateId, templateCandidates.length + 1);
      if (id !== expectedId || candidates.has(candidateKey(templateId, id))) {
        throw new Error(`Candidate id must be the next unused id ${expectedId}; candidate ids cannot be reused for a changed patch`);
      }
      const candidate = deepFreeze({ id, templateId, dimension, change: clone(change) });
      validateContractBalanceCandidate(candidate);
      const record = deepFreeze({ candidate, tier, rationale: input.rationale?.trim() ?? null });
      candidates.set(candidateKey(templateId, id), record);
      return candidate;
    },

    registerBaseline({ templateId, rationale = null }) {
      const tier = getTier(templateId);
      if (rationale !== null && !nonEmptyText(rationale)) throw new Error('Baseline rationale must be non-empty');
      if (!templateFor({ templateId }) || candidates.has(candidateKey(templateId, 'baseline'))) {
        throw new Error(`Baseline is already recorded or template is unknown: ${templateId}`);
      }
      const candidate = deepFreeze({ id: 'baseline', templateId, dimension: null, change: null });
      const record = deepFreeze({ candidate, tier, rationale: rationale?.trim() ?? null });
      candidates.set(candidateKey(templateId, 'baseline'), record);
      return candidate;
    },

    registerPreparation({ templateId, candidateId, preparation }) {
      const candidateRecord = getCandidateRecord(templateId, candidateId);
      if (!exactKeys(preparation, ['id', 'actions']) || !nonEmptyText(preparation.id)
        || !Array.isArray(preparation.actions)) {
        throw new Error('Recorded preparation must contain only a non-empty id and an actions array');
      }
      const key = caseKey(templateId, candidateId, preparation.id);
      if (recordedCases.has(key)) throw new Error(`Study case is already recorded: ${templateId}/${candidateId}/${preparation.id}`);
      const record = deepFreeze({ candidate: candidateRecord.candidate,
        preparation: clone(preparation), tier: candidateRecord.tier,
        rationale: candidateRecord.rationale, screening: null });
      recordedCases.set(key, record);
      return record;
    },

    recordScreeningResult({ templateId, candidateId, preparationId, rejected, reason = null, evidence }) {
      const current = getRecordedCase({ templateId, candidateId, preparationId });
      if (current.screening) throw new Error('Screening result is already recorded for this case');
      if (typeof rejected !== 'boolean' || !Array.isArray(evidence) || evidence.length === 0) {
        throw new Error('Screening result needs a boolean decision and non-empty seed evidence');
      }
      const screeningGate = evaluateContractBalanceScreen({ recordedCase: current, templateId, candidateId, rows: evidence });
      if (!screeningGate.valid) throw new Error('Screening evidence must contain all valid paired screening seeds');
      if (rejected && !nonEmptyText(reason)) {
        throw new Error('Rejected candidates require a stated evidence-based reason');
      }
      const record = deepFreeze({ ...current, screening: {
        rejected, reason: rejected ? reason.trim() : null, evidence: clone(evidence),
      } });
      recordedCases.set(caseKey(templateId, candidateId, preparationId), record);
      return record;
    },

    getRecordedCase,

    registerSelection(selection) {
      const record = getRecordedCase({ templateId: selection?.templateId,
        candidateId: selection?.candidateId, preparationId: selection?.preparation?.id });
      if (record.screening?.rejected) {
        throw new Error(`Rejected candidate cannot be selected: ${record.screening.reason}`);
      }
      assertFrozenContractBalanceSelection(selection, record);
      const key = selectionKey(selection);
      if (selections.has(key)) throw new Error('A frozen selection is already recorded for this study case');
      if ([...selections.values()].some(existing => existing.tier.tier === record.tier.tier)) {
        throw new Error(`Only one configuration may be selected for the ${record.tier.tier} tier`);
      }
      const frozen = deepFreeze(clone(selection));
      selections.set(key, frozen);
      return frozen;
    },

    getSelection({ templateId, candidateId, preparationId }) {
      const selection = selections.get(caseKey(templateId, candidateId, preparationId));
      if (!selection) throw new Error(`Frozen selection is not recorded: ${templateId}/${candidateId}/${preparationId}`);
      return selection;
    },
  });
}

export const CONTRACT_BALANCE_STUDY_REGISTRY = createContractBalanceStudyRegistry();

function registerDurableStudyCases() {
  if (durableStudyCases.schemaVersion !== 1 || !Array.isArray(durableStudyCases.candidateHistory)
    || !Array.isArray(durableStudyCases.baselineCases)) {
    throw new Error('Durable contract-balance case manifest has an unsupported shape');
  }
  const preparationsByKey = {
    ...REFERENCE_SERVICE_PREPARATIONS,
    starter: Object.freeze({ id: 'starter', actions: Object.freeze([]) }),
  };
  const registeredIds = new Set();
  for (const history of durableStudyCases.candidateHistory) {
    if (registeredIds.has(history.id)) throw new Error(`Duplicate durable candidate history id: ${history.id}`);
    registeredIds.add(history.id);
    const { preparationKey, rationale, ...candidateInput } = history;
    const candidate = CONTRACT_BALANCE_STUDY_REGISTRY.registerCandidate({ ...candidateInput, rationale });
    const preparation = preparationsByKey[preparationKey];
    if (!preparation) throw new Error(`Unknown durable preparation key: ${preparationKey}`);
    CONTRACT_BALANCE_STUDY_REGISTRY.registerPreparation({ templateId: candidate.templateId,
      candidateId: candidate.id, preparation });
  }
  for (const baseline of durableStudyCases.baselineCases) {
    if (registeredIds.has(`${baseline.templateId}:${baseline.candidateId}`)) {
      throw new Error(`Duplicate durable baseline case: ${baseline.templateId}`);
    }
    const candidate = CONTRACT_BALANCE_STUDY_REGISTRY.registerBaseline({ templateId: baseline.templateId,
      rationale: baseline.rationale });
    const preparation = preparationsByKey[baseline.preparationKey];
    if (!preparation) throw new Error(`Unknown durable preparation key: ${baseline.preparationKey}`);
    CONTRACT_BALANCE_STUDY_REGISTRY.registerPreparation({ templateId: baseline.templateId,
      candidateId: candidate.id, preparation });
  }
}

registerDurableStudyCases();

function registerDurableStudySelections() {
  const { provenance, selectionGzipBase64Chunks, schemaVersion } = durableStudySelections;
  if (schemaVersion !== 1 || !Array.isArray(selectionGzipBase64Chunks)
    || typeof provenance?.selectionArraySha256 !== 'string'
    || !Number.isSafeInteger(provenance?.selectionCount)) {
    throw new Error('Durable contract-balance selection fixture has an unsupported shape');
  }
  const selectionBytes = gunzipSync(Buffer.from(selectionGzipBase64Chunks.join(''), 'base64'));
  const fingerprint = createHash('sha256').update(selectionBytes).digest('hex');
  if (fingerprint !== provenance.selectionArraySha256) {
    throw new Error('Durable contract-balance selection fixture failed its integrity check');
  }
  const selections = JSON.parse(selectionBytes.toString('utf8'));
  if (!Array.isArray(selections) || selections.length !== provenance.selectionCount) {
    throw new Error('Durable contract-balance selection count differs from its provenance');
  }
  for (const selection of selections) {
    CONTRACT_BALANCE_STUDY_REGISTRY.registerSelection(selection);
  }
}

registerDurableStudySelections();

export function registerContractBalanceCandidate(candidate) {
  return CONTRACT_BALANCE_STUDY_REGISTRY.registerCandidate(candidate);
}

export function registerContractBalanceBaseline({ templateId, rationale = null }) {
  return CONTRACT_BALANCE_STUDY_REGISTRY.registerBaseline({ templateId, rationale });
}

export function registerContractBalancePreparation(record) {
  return CONTRACT_BALANCE_STUDY_REGISTRY.registerPreparation(record);
}

export function registerContractBalanceScreeningResult(record) {
  return CONTRACT_BALANCE_STUDY_REGISTRY.recordScreeningResult(record);
}

export function getRecordedContractBalanceCase(selection) {
  return CONTRACT_BALANCE_STUDY_REGISTRY.getRecordedCase(selection);
}

export function registerContractBalanceSelection(selection) {
  return CONTRACT_BALANCE_STUDY_REGISTRY.registerSelection(selection);
}

export function getRecordedContractBalanceSelection(selection) {
  return CONTRACT_BALANCE_STUDY_REGISTRY.getSelection(selection);
}

function preparationMatchesCase(preparationReport, recordedPreparation) {
  if (!preparationReport || preparationReport.id !== recordedPreparation.id
    || !Array.isArray(preparationReport.actionLog)) return false;
  const expectedActions = [{ type: 'SET_SPEED', speed: CONTRACT_BALANCE_STUDY.gameStep / 2 },
    ...recordedPreparation.actions];
  if (!sameValue(preparationReport.actionLog.map(entry => entry.action), expectedActions)
    || preparationReport.actionLog.some(entry => entry.applied !== true
      || !Number.isFinite(entry.fundsBefore) || !Number.isFinite(entry.fundsAfter)
      || entry.fundsBefore < 0 || entry.fundsBefore > 600 || entry.fundsAfter < 0 || entry.fundsAfter > 600)) return false;
  const balancesChain = preparationReport.actionLog.every((entry, index, entries) => index === 0
    ? entry.fundsBefore === 600 : entries[index - 1].fundsAfter === entry.fundsBefore);
  return balancesChain && preparationReport.startingFunds === 600
    && Number.isFinite(preparationReport.fundsBeforeAcceptance)
    && preparationReport.fundsBeforeAcceptance >= 0 && preparationReport.fundsBeforeAcceptance <= 600
    && Number.isFinite(preparationReport.cost) && preparationReport.cost >= 0 && preparationReport.cost <= 600
    && preparationReport.cost === preparationReport.startingFunds - preparationReport.fundsBeforeAcceptance
    && preparationReport.actionLog.at(-1).fundsAfter === preparationReport.fundsBeforeAcceptance;
}

function runFaults(run, label, seed, templateId, expectedCandidateId, expectedCatalogue) {
  const faults = [];
  if (!run || typeof run !== 'object') return [`${label} seed ${seed}: no run record`];
  if (run.reportCandidateId !== expectedCandidateId) {
    faults.push(`${label} seed ${seed}: report candidate id does not match the selected case`);
  }
  if (run.seed !== seed) faults.push(`${label} seed ${seed}: execution report seed is ${run.seed ?? 'missing'}`);
  if (run.templateId !== templateId) faults.push(`${label} seed ${seed}: execution report template is ${run.templateId ?? 'missing'}`);
  if (run.rulesVersion !== 5) faults.push(`${label} seed ${seed}: rulesVersion must remain 5`);
  if (run.gameStep !== CONTRACT_BALANCE_STUDY.gameStep) {
    faults.push(`${label} seed ${seed}: gameStep must be the native fixed step ${CONTRACT_BALANCE_STUDY.gameStep}`);
  }
  if (run.status !== 'completed') faults.push(`${label} seed ${seed}: status is ${run.status || 'missing'}`);
  if (run.navigationFault != null) faults.push(`${label} seed ${seed}: navigation fault reported`);
  if (run.runtimeFault != null) faults.push(`${label} seed ${seed}: runtime fault reported`);
  if (run.snapshotMismatch != null) faults.push(`${label} seed ${seed}: order snapshot mismatch reported`);
  if (!Array.isArray(run.safetyFaults) || run.safetyFaults.length > 0) {
    faults.push(`${label} seed ${seed}: safety fault reported`);
  }
  if (!['succeeded', 'failed'].includes(run.contractStatus)) {
    faults.push(`${label} seed ${seed}: contract did not settle at the end of the complete run`);
  }
  if (!Number.isFinite(run.gameTime) || !Number.isFinite(run.endAt) || run.gameTime !== run.endAt) {
    faults.push(`${label} seed ${seed}: simulation did not reach its complete end time`);
  }
  if (typeof run.success !== 'boolean' || !Number.isFinite(run.fulfilled) || !Number.isFinite(run.target)) {
    faults.push(`${label} seed ${seed}: completion outcome evidence is incomplete`);
  }
  if (run.success !== (run.contractStatus === 'succeeded')) {
    faults.push(`${label} seed ${seed}: success flag does not match the settled contract result`);
  }
  if (!Number.isSafeInteger(run.target) || run.target <= 0
    || !Number.isSafeInteger(run.fulfilled) || run.fulfilled < 0) {
    faults.push(`${label} seed ${seed}: target and fulfilled count must be positive/in-range integers`);
  } else {
    const guestCount = expectedCatalogue.parties.reduce((sum, party) => sum + party.size, 0);
    if (run.target > guestCount || run.fulfilled > guestCount) {
      faults.push(`${label} seed ${seed}: target or fulfilled count exceeds the recorded roster`);
    }
    if (run.target !== expectedCatalogue.target) {
      faults.push(`${label} seed ${seed}: report target differs from the recorded catalogue target`);
    }
    if ((run.contractStatus === 'succeeded') !== (run.fulfilled >= run.target)) {
      faults.push(`${label} seed ${seed}: fulfilled count contradicts the settled target/status`);
    }
  }
  if (!sameValue(run.catalogueValues, expectedCatalogue)) {
    faults.push(`${label} seed ${seed}: executed catalogue values differ from the recorded case`);
  }
  if (!isObject(run.reasonCounts) || !isObject(run.stageDiagnostics)) {
    faults.push(`${label} seed ${seed}: contract outcome or stage diagnostics are missing`);
  }
  if (!run.preparation || !nonEmptyText(run.preparation.id) || !Array.isArray(run.preparation.actionLog)
    || !Number.isFinite(run.preparation.cost)) {
    faults.push(`${label} seed ${seed}: preparation action or cost evidence is missing`);
  }
  return faults;
}

function validatePairedRows({ recordedCase, templateId, candidateId, phase, rows }) {
  const expectedSeeds = expectedContractBalanceSeeds(phase);
  const failures = [];
  if (!recordedCase?.candidate || !recordedCase?.preparation) {
    return { expectedSeeds, failures: ['A recorded candidate/preparation case is required'], completedCount: 0 };
  }
  const recordedCandidate = recordedCase.candidate;
  const recordedPreparation = recordedCase.preparation;
  if (recordedCandidate.templateId !== templateId || recordedCandidate.id !== candidateId) {
    failures.push('Selected template/candidate does not match the recorded case');
  }
  const fixtureId = `${templateId}:${recordedPreparation.id}`;
  const expectedCandidateCatalogue = selectedCatalogueValues(candidateTemplate(recordedCase));
  const expectedControlCatalogue = selectedCatalogueValues(getServiceContractTemplate(templateId, 5));
  if (!Array.isArray(rows)) return { expectedSeeds, failures: ['Study rows must be an array'], completedCount: 0 };
  const seedCounts = new Map();
  for (const row of rows) {
    if (!row || typeof row.seed !== 'number') {
      failures.push('A study row has no numeric seed');
      continue;
    }
    seedCounts.set(row.seed, (seedCounts.get(row.seed) || 0) + 1);
    if (row.templateId !== templateId || row.candidateId !== candidateId) {
      failures.push(`Seed ${row.seed}: row does not match the selected template and candidate`);
    }
    if (row.fixtureId !== fixtureId || row.preparationId !== recordedPreparation.id
      || !sameValue(row.preparation, recordedPreparation)
      || row.dimension !== recordedCandidate.dimension) {
      failures.push(`Seed ${row.seed}: fixture/preparation/candidate dimension differs from the recorded case`);
    }
    if (row.rulesVersion !== 5) failures.push(`Seed ${row.seed}: evidence row rulesVersion must remain 5`);
    if (row.gameStep !== CONTRACT_BALANCE_STUDY.gameStep) {
      failures.push(`Seed ${row.seed}: gameStep must be the native fixed step ${CONTRACT_BALANCE_STUDY.gameStep}`);
    }
    if (row.candidate?.candidateId !== candidateId) {
      failures.push(`Seed ${row.seed}: candidate run identity does not match the selected candidate`);
    }
    failures.push(...runFaults(row.candidate, 'candidate', row.seed, templateId, candidateId, expectedCandidateCatalogue));
    failures.push(...runFaults(row.control, 'control', row.seed, templateId, 'baseline', expectedControlCatalogue));
    if (row.control?.candidateId !== 'baseline') {
      failures.push(`Seed ${row.seed}: paired control must be the unmodified v5 baseline`);
    }
    if (!preparationMatchesCase(row.candidate?.preparation, recordedPreparation)
      || !preparationMatchesCase(row.control?.preparation, recordedPreparation)
      || row.candidate?.preparation?.id !== row.preparationId
      || !sameValue(row.candidate?.preparation, row.control?.preparation)) {
      failures.push(`Seed ${row.seed}: candidate and control preparation actions/costs do not match`);
    }
    if (row.actionCost !== row.candidate?.preparation?.cost
      || !sameValue(row.actionLog, row.candidate?.preparation?.actionLog)) {
      failures.push(`Seed ${row.seed}: row action log/cost differs from the candidate run report`);
    }
  }
  const actualSeeds = [...seedCounts.keys()].sort((left, right) => left - right);
  if (!sameValue(actualSeeds, expectedSeeds)) failures.push(`${phase} seed set must be exactly ${expectedSeeds.join(',')}`);
  for (const [seed, count] of seedCounts) {
    if (count !== 1) failures.push(`Seed ${seed}: duplicate evidence rows`);
  }
  const completedCount = expectedSeeds.filter(seed => seedCounts.get(seed) === 1
    && rows.find(row => row.seed === seed)?.candidate?.status === 'completed'
    && rows.find(row => row.seed === seed)?.control?.status === 'completed').length;
  return { expectedSeeds, failures, completedCount };
}

export function evaluateContractBalanceScreen({ recordedCase, templateId, candidateId, rows }) {
  const validated = validatePairedRows({ recordedCase, templateId, candidateId, phase: 'screen', rows });
  return deepFreeze({ phase: 'screen', templateId, candidateId, expectedCount: validated.expectedSeeds.length,
    completedCount: validated.completedCount, valid: validated.failures.length === 0,
    failures: validated.failures });
}

export function evaluateContractBalanceTierGate({ recordedCase, templateId, candidateId, phase, rows, selectionArtifact = null }) {
  if (!['development', 'holdout'].includes(phase)) {
    throw new Error('Tier gate phase must be development or holdout');
  }
  const tier = getTier(templateId);
  const validated = validatePairedRows({ recordedCase, templateId, candidateId, phase, rows });
  if (phase === 'holdout') {
    if (!selectionArtifact) validated.failures.push('Holdout requires a frozen, qualified selection artifact');
    else {
      try {
        assertFrozenContractBalanceSelection(selectionArtifact, recordedCase);
      } catch (error) {
        validated.failures.push(`Holdout selection artifact is not verified: ${error.message}`);
      }
      for (const row of Array.isArray(rows) ? rows : []) {
        for (const [label, run] of [['candidate', row?.candidate], ['control', row?.control]]) {
          if (run?.preparation?.id !== selectionArtifact.preparation?.id
            || run?.preparation?.cost !== selectionArtifact.preparation?.cost
            || !sameValue(run?.preparation?.actionLog, selectionArtifact.preparation?.actionLog)) {
            validated.failures.push(`Seed ${row?.seed}: ${label} preparation differs from the frozen selection`);
          }
        }
      }
    }
  }
  const successes = Array.isArray(rows) ? rows.filter(row => row?.candidate?.success === true).length : 0;
  if (validated.failures.length === 0 && successes < tier.minimum) {
    validated.failures.push(`${phase} success count ${successes} is below the declared minimum ${tier.minimum}`);
  }
  return deepFreeze({ phase, templateId, candidateId, expectedCount: validated.expectedSeeds.length,
    completedCount: validated.completedCount, successes, minimum: tier.minimum,
    passed: validated.failures.length === 0, failures: validated.failures });
}

function selectedCatalogueValues(template) {
  return {
    title: template.title,
    guestLabel: template.guestLabel,
    profile: clone(template.profile),
    parties: clone(template.parties),
    serviceDuration: template.serviceDuration,
    target: template.target,
    reward: template.reward,
  };
}

function consistentPreparationEvidence(rows, preparationId) {
  const reports = rows.map(row => row.candidate?.preparation);
  const first = reports[0];
  if (!first || first.id !== preparationId || !Number.isFinite(first.cost)
    || !Number.isFinite(first.startingFunds) || !Number.isFinite(first.fundsBeforeAcceptance)) {
    throw new Error('Development rows must contain the recorded setup cost and accepted preparation report');
  }
  if (first.startingFunds !== 600 || first.cost < 0 || first.cost > 600
    || first.fundsBeforeAcceptance < 0 || first.fundsBeforeAcceptance > 600
    || first.cost !== first.startingFunds - first.fundsBeforeAcceptance) {
    throw new Error('Frozen preparation must use the starter $600 budget and disclose its affordable setup cost');
  }
  for (const report of reports) {
    if (!sameValue(report, first)) throw new Error('Development preparation actions and setup cost must be identical for every seed');
  }
  const controlReports = rows.map(row => row.control?.preparation);
  if (controlReports.some(report => !sameValue(report, first))) {
    throw new Error('Candidate and control preparation actions and setup costs must match');
  }
  return first;
}

export function freezeContractBalanceSelection({ recordedCase, developmentRows }) {
  if (!recordedCase?.candidate || !recordedCase?.preparation) {
    throw new Error('A recorded candidate/preparation case is required to freeze a selection');
  }
  if (recordedCase.screening?.rejected) {
    throw new Error(`Cannot freeze a screened rejection: ${recordedCase.screening.reason}`);
  }
  const candidate = recordedCase.candidate;
  const gate = evaluateContractBalanceTierGate({ recordedCase, templateId: candidate.templateId, candidateId: candidate.id,
    phase: 'development', rows: developmentRows });
  if (!gate.passed) throw new Error(`Cannot freeze selection: development gate failed (${gate.failures.join('; ')})`);
  const preparationReport = consistentPreparationEvidence(developmentRows, recordedCase.preparation.id);
  const template = candidateTemplate(recordedCase);
  const artifact = {
    schemaVersion: 1,
    rulesVersion: 5,
    templateId: candidate.templateId,
    candidateId: candidate.id,
    dimension: candidate.dimension,
    change: clone(candidate.change),
    rationale: recordedCase.rationale ?? null,
    preparation: {
      id: recordedCase.preparation.id,
      actions: clone(recordedCase.preparation.actions),
      cost: preparationReport.cost,
      startingFunds: preparationReport.startingFunds,
      fundsBeforeAcceptance: preparationReport.fundsBeforeAcceptance,
      actionLog: clone(preparationReport.actionLog),
    },
    selectedCatalogueValues: selectedCatalogueValues(template),
    tier: clone(getTier(candidate.templateId)),
    declaredTierMinimums: clone(declaredTierMinimums),
    development: {
      expectedSeeds: [...CONTRACT_BALANCE_STUDY.developmentSeeds],
      successes: gate.successes,
      minimum: gate.minimum,
      passed: gate.passed,
      evidenceRows: clone(developmentRows),
    },
  };
  return deepFreeze(artifact);
}

export function assertFrozenContractBalanceSelection(selection, recordedCase) {
  if (!isObject(selection) || !recordedCase?.candidate || !recordedCase?.preparation) {
    throw new Error('Frozen selection and recorded study case are required');
  }
  const candidate = recordedCase.candidate;
  if (recordedCase.screening?.rejected) {
    throw new Error(`A screened rejection cannot authorize holdout: ${recordedCase.screening.reason}`);
  }
  const template = candidateTemplate(recordedCase);
  if (selection.schemaVersion !== 1 || selection.rulesVersion !== 5
    || selection.templateId !== candidate.templateId || selection.candidateId !== candidate.id
    || selection.dimension !== candidate.dimension || !sameValue(selection.change, candidate.change)
    || (selection.rationale ?? null) !== (recordedCase.rationale ?? null)) {
    throw new Error('Frozen selection does not match the recorded v5 candidate patch');
  }
  if (selection.preparation?.id !== recordedCase.preparation.id
    || !sameValue(selection.preparation.actions, recordedCase.preparation.actions)
    || !Number.isFinite(selection.preparation.cost) || selection.preparation.cost < 0
    || !Number.isFinite(selection.preparation.startingFunds)
    || !Number.isFinite(selection.preparation.fundsBeforeAcceptance)
    || selection.preparation.startingFunds !== 600
    || selection.preparation.cost > 600
    || selection.preparation.fundsBeforeAcceptance < 0
    || selection.preparation.fundsBeforeAcceptance > 600
    || selection.preparation.cost !== selection.preparation.startingFunds - selection.preparation.fundsBeforeAcceptance
    || !Array.isArray(selection.preparation.actionLog)) {
    throw new Error('Frozen selection preparation actions or setup cost changed');
  }
  const evidencePreparation = selection.development?.evidenceRows?.[0]?.candidate?.preparation;
  if (!evidencePreparation || evidencePreparation.id !== selection.preparation.id
    || evidencePreparation.cost !== selection.preparation.cost
    || evidencePreparation.startingFunds !== selection.preparation.startingFunds
    || evidencePreparation.fundsBeforeAcceptance !== selection.preparation.fundsBeforeAcceptance
    || !sameValue(evidencePreparation.actionLog, selection.preparation.actionLog)) {
    throw new Error('Frozen preparation setup cost/action log differs from retained development evidence');
  }
  if (!sameValue(selection.selectedCatalogueValues, selectedCatalogueValues(template))
    || !sameValue(selection.tier, getTier(candidate.templateId))
    || !sameValue(selection.declaredTierMinimums, declaredTierMinimums)) {
    throw new Error('Frozen selection catalogue values or declared tier minima changed');
  }
  const minimum = getTier(candidate.templateId).minimum;
  if (!Array.isArray(selection.development?.evidenceRows)) {
    throw new Error('Frozen selection is missing retained development evidence rows');
  }
  const verifiedDevelopment = evaluateContractBalanceTierGate({ recordedCase, templateId: candidate.templateId,
    candidateId: candidate.id, phase: 'development', rows: selection.development.evidenceRows });
  const frozenPreparationMatchesRows = selection.development.evidenceRows.every(row =>
    [row?.candidate?.preparation, row?.control?.preparation].every(preparation =>
      preparation?.id === selection.preparation.id
      && preparation.cost === selection.preparation.cost
      && preparation.startingFunds === selection.preparation.startingFunds
      && preparation.fundsBeforeAcceptance === selection.preparation.fundsBeforeAcceptance
      && sameValue(preparation.actionLog, selection.preparation.actionLog)));
  if (!frozenPreparationMatchesRows) {
    throw new Error('Frozen preparation setup cost/action log differs across retained development evidence');
  }
  if (!sameValue(selection.development?.expectedSeeds, CONTRACT_BALANCE_STUDY.developmentSeeds)
    || selection.development?.minimum !== minimum || selection.development?.passed !== true
    || !Number.isSafeInteger(selection.development?.successes)
    || selection.development.successes < minimum
    || selection.development.successes > CONTRACT_BALANCE_STUDY.developmentSeeds.length
    || !verifiedDevelopment.passed || verifiedDevelopment.successes !== selection.development.successes) {
    throw new Error(`Frozen selection does not contain a passing fixed-seed development gate${verifiedDevelopment.failures.length
      ? `: ${verifiedDevelopment.failures.join('; ')}` : ''}`);
  }
  return true;
}

function compactRuntimeFault(report) {
  if (!report?.diagnostic) return null;
  return { message: report.diagnostic.message || 'Runtime diagnostic', at: report.diagnostic.at ?? null,
    nextGameDt: report.diagnostic.nextGameDt ?? null };
}

function compactStudyRun(run, candidateId) {
  if (!run || !run.report) {
    return { candidateId, reportCandidateId: null, templateId: null, seed: null, catalogueValues: null,
      rulesVersion: null, gameStep: null, status: 'runtime_error', success: false, fulfilled: null, target: null,
      contractStatus: null, gameTime: null, endAt: null,
      ordinaryRevenue: null, contractCash: null, bonus: null, paidVisits: [],
      paymentTotals: { paidVisitCount: null, contractPaidVisitCount: null, ordinaryRevenue: null,
        contractCash: null, bonus: null, funds: null, paidVisitSequence: null },
      reasonCounts: {}, outcomes: [], stageDiagnostics: null,
      navigationFault: null, runtimeFault: { message: run?.error?.message || 'Study run did not return a report' },
      safetyFaults: [], snapshotMismatch: null, preparation: null };
  }
  const { report, state } = run;
  const safetyFaults = [];
  if (state?.navigationFault) safetyFaults.push('navigationFault');
  if (report.firstSnapshotMismatch) safetyFaults.push('orderSnapshotMismatch');
  return {
    candidateId,
    reportCandidateId: report.candidateId ?? null,
    templateId: report.templateId,
    seed: report.seed,
    catalogueValues: run.catalogueTemplate ? selectedCatalogueValues(run.catalogueTemplate) : null,
    rulesVersion: report.rulesVersion,
    gameStep: report.gameStep,
    status: report.status,
    success: report.contractStatus === 'succeeded',
    contractStatus: report.contractStatus,
    gameTime: report.gameTime,
    endAt: report.endAt,
    fulfilled: report.fulfilled,
    target: report.target,
    bonus: report.bonus,
    ordinaryRevenue: report.ordinaryRevenue,
    contractCash: report.contractCash,
    funds: report.funds,
    paymentTotals: {
      paidVisitCount: report.paid.length,
      contractPaidVisitCount: report.paid.filter(visit => visit.contractId !== null).length,
      ordinaryRevenue: report.ordinaryRevenue,
      contractCash: report.contractCash,
      bonus: report.bonus,
      funds: report.funds,
      paidVisitSequence: report.sequence,
    },
    paidVisits: report.paid.map(visit => ({ ...visit })),
    reasonCounts: clone(report.contractDiagnostics?.reasonCounts || {}),
    outcomes: clone(report.contractDiagnostics?.outcomes || []),
    stageDiagnostics: report.contractDiagnostics ? {
      stagesByGuest: clone(report.contractDiagnostics.stagesByGuest),
      unavailableStages: [...report.contractDiagnostics.unavailableStages],
    } : null,
    navigationFault: report.navigationFault ?? null,
    runtimeFault: compactRuntimeFault(report),
    safetyFaults,
    snapshotMismatch: report.firstSnapshotMismatch ? clone(report.firstSnapshotMismatch) : null,
    preparation: report.preparation ? {
      id: report.preparation.id,
      startingFunds: report.preparation.startingFunds,
      fundsBeforeAcceptance: report.preparation.fundsBeforeAcceptance,
      cost: report.preparation.cost,
      actionLog: clone(report.preparation.actions),
    } : null,
  };
}

export function createContractBalanceEvidenceRow({ recordedCase, seed, candidateRun, controlRun }) {
  const candidate = recordedCase.candidate;
  const candidateEvidence = compactStudyRun(candidateRun, candidate.id);
  const controlEvidence = compactStudyRun(controlRun, 'baseline');
  return {
    fixtureId: `${candidate.templateId}:${recordedCase.preparation.id}`,
    templateId: candidate.templateId,
    preparationId: recordedCase.preparation.id,
    candidateId: candidate.id,
    dimension: candidate.dimension,
    rationale: recordedCase.rationale ?? null,
    seed,
    gameStep: candidateEvidence.gameStep,
    rulesVersion: candidateEvidence.rulesVersion,
    preparation: { id: recordedCase.preparation.id, actions: clone(recordedCase.preparation.actions) },
    actionLog: clone(candidateEvidence.preparation?.actionLog ?? controlEvidence.preparation?.actionLog ?? null),
    actionCost: candidateEvidence.preparation?.cost ?? controlEvidence.preparation?.cost ?? null,
    candidate: candidateEvidence,
    control: controlEvidence,
  };
}

export function describeContractBalanceStudyRun(phase, recordedCase, rows, selectionArtifact = null) {
  if (phase === 'screen') {
    return evaluateContractBalanceScreen({ recordedCase, templateId: recordedCase.candidate.templateId,
      candidateId: recordedCase.candidate.id, rows });
  }
  return evaluateContractBalanceTierGate({ recordedCase, templateId: recordedCase.candidate.templateId,
    candidateId: recordedCase.candidate.id, phase, rows, selectionArtifact });
}
