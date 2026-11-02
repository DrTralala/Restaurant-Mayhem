import v6Evidence from '../data/serviceContractsV6Evidence.json';

const acceptedPhases = ['development', 'holdout'];
const comparableCatalogueFields = ['title', 'guestLabel', 'profile', 'parties', 'serviceDuration', 'target', 'reward'];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function addFailure(failures, detail) {
  failures.push(`v6 fidelity ${detail}`);
}

function expectedPreparation(selection) {
  const { id, startingFunds, fundsBeforeAcceptance, cost, actionLog } = selection.preparation;
  return { id, startingFunds, fundsBeforeAcceptance, cost, actionLog };
}

function expectedCatalogueValues(selection) {
  return Object.fromEntries(comparableCatalogueFields.map(key => [key, selection.v6Offer[key]]));
}

export function getV6FidelitySelection({ phase, templateId, candidateId } = {}) {
  if (!acceptedPhases.includes(phase)) {
    throw new Error(`Unknown v6 fidelity phase: ${phase ?? '(missing)'}`);
  }
  if (v6Evidence.schemaVersion !== 1 || v6Evidence.sourceRulesVersion !== 5
    || !Array.isArray(v6Evidence.selectedOffers)) {
    throw new Error('The frozen v6 fidelity evidence has an unsupported shape or source revision');
  }
  const selectedForTemplate = v6Evidence.selectedOffers.filter(selection => selection.templateId === templateId);
  if (selectedForTemplate.length !== 1) {
    throw new Error(`Unknown v6 fidelity template: ${templateId ?? '(missing)'}`);
  }
  const selection = selectedForTemplate[0];
  if (selection.candidateId !== candidateId) {
    throw new Error(`Unknown frozen v6 fidelity candidate for ${templateId}: ${candidateId ?? '(missing)'}`);
  }
  if (!selection[phase]?.gate || !Array.isArray(selection[phase]?.rows)
    || !selection.preparation || !selection.v6Offer) {
    throw new Error(`Frozen v6 fidelity selection is incomplete for ${templateId}/${phase}`);
  }
  return selection;
}

export function evaluateV6FidelityGate({ phase, templateId, candidateId, runs } = {}) {
  const selection = getV6FidelitySelection({ phase, templateId, candidateId });
  const phaseEvidence = selection[phase];
  const expectedSeeds = v6Evidence.seedSets?.[phase];
  const minimum = selection.tier?.minimum;
  const failures = [];

  if (!Array.isArray(expectedSeeds) || !Number.isSafeInteger(minimum) || minimum <= 0
    || v6Evidence.tierMinimums?.[templateId] !== minimum
    || phaseEvidence.gate.minimum !== minimum || phaseEvidence.gate.expectedCount !== expectedSeeds.length
    || phaseEvidence.gate.passed !== true
    || phaseEvidence.gate.successes !== phaseEvidence.aggregate?.candidate?.successes) {
    addFailure(failures, `${templateId}/${phase}: frozen gate or seed metadata is inconsistent`);
  }
  if (!Array.isArray(runs)) {
    addFailure(failures, `${templateId}/${phase}: runs must be an array`);
    runs = [];
  }
  if (runs.length !== expectedSeeds?.length) {
    addFailure(failures, `${templateId}/${phase}: expected ${expectedSeeds?.length ?? 0} rows, received ${runs.length}`);
  }

  const expectedBySeed = new Map(phaseEvidence.rows.map(([seed, candidateOutcome]) => [seed, candidateOutcome]));
  const actualBySeed = new Map();
  for (const run of runs) {
    if (!run || !Number.isSafeInteger(run.seed)) {
      addFailure(failures, `${templateId}/${phase}: a run is missing its integer seed`);
      continue;
    }
    actualBySeed.set(run.seed, [...(actualBySeed.get(run.seed) || []), run]);
  }

  const completed = [];
  const expectedCatalogue = expectedCatalogueValues(selection);
  const expectedPreparationValue = expectedPreparation(selection);
  for (const seed of expectedSeeds || []) {
    const matching = actualBySeed.get(seed) || [];
    if (matching.length !== 1) {
      addFailure(failures, `seed ${seed}: expected exactly one row, received ${matching.length}`);
      continue;
    }
    const run = matching[0];
    if (run.templateId !== templateId) addFailure(failures, `seed ${seed}: template identity changed`);
    if (run.rulesVersion !== 6) addFailure(failures, `seed ${seed}: runtime must use rules version 6`);
    if (run.status !== 'completed') addFailure(failures, `seed ${seed}: run status is ${run.status ?? '(missing)'}`);
    if (run.navigationFault != null || run.runtimeFault != null
      || !Array.isArray(run.safetyFaults) || run.safetyFaults.length > 0 || run.snapshotMismatch != null) {
      addFailure(failures, `seed ${seed}: runtime, navigation, safety, or snapshot fault`);
    }
    if (!Number.isFinite(run.gameTime) || !Number.isFinite(run.endAt) || run.gameTime !== run.endAt) {
      addFailure(failures, `seed ${seed}: the simulation did not reach its complete end time`);
    }
    if (!sameValue(run.catalogueValues, expectedCatalogue)) {
      addFailure(failures, `seed ${seed}: actual v6 contract terms differ from the selected v6 offer`);
    }
    if (!sameValue(run.preparation, expectedPreparationValue)) {
      addFailure(failures, `seed ${seed}: preparation actions, cost, or funds differ from frozen evidence`);
    }

    // Cross-revision equality is limited to the frozen outcome/payment tuple.
    // Candidate/run identity, v5-v6 rulesVersion equality, v6-only offer metadata,
    // and wallMs are intentionally excluded; the runtime is separately required to be v6.
    const expectedOutcome = expectedBySeed.get(seed);
    const actualOutcome = [run.success, run.fulfilled, run.target, run.payments];
    if (!sameValue(actualOutcome, expectedOutcome)) {
      addFailure(failures, `seed ${seed}: outcome/payment tuple differs from frozen v5-candidate evidence`);
    }
    if (run.status === 'completed') completed.push(run);
  }

  for (const seed of actualBySeed.keys()) {
    if (!expectedSeeds?.includes(seed)) addFailure(failures, `unexpected seed ${seed}`);
  }

  const successes = completed.filter(run => run.success === true).length;
  if (successes < minimum) {
    addFailure(failures, `${phase} successes ${successes} are below the fixed minimum ${minimum}`);
  }
  if (phaseEvidence.gate.completedCount !== expectedSeeds?.length) {
    addFailure(failures, `${phase}: frozen evidence does not contain a complete seed gate`);
  }

  const candidateAggregate = phaseEvidence.aggregate?.candidate;
  if (candidateAggregate) {
    const paymentTotals = completed.reduce((totals, run) => {
      const [paidVisitCount, contractPaidVisitCount, ordinaryRevenue, contractCash, bonus] = run.payments || [];
      totals.paidVisitCount += paidVisitCount || 0;
      totals.contractPaidVisitCount += contractPaidVisitCount || 0;
      totals.totalOrdinaryRevenue += ordinaryRevenue || 0;
      totals.totalContractCash += contractCash || 0;
      totals.totalBonus += bonus || 0;
      totals.fulfilledTotal += run.fulfilled || 0;
      return totals;
    }, { paidVisitCount: 0, contractPaidVisitCount: 0, totalOrdinaryRevenue: 0,
      totalContractCash: 0, totalBonus: 0, fulfilledTotal: 0 });
    const expectedPaymentTotals = candidateAggregate.payments;
    if (candidateAggregate.runs !== expectedSeeds?.length || candidateAggregate.successes !== successes
      || candidateAggregate.fulfilledTotal !== paymentTotals.fulfilledTotal
      || !sameValue({ totalBonus: paymentTotals.totalBonus,
        totalOrdinaryRevenue: paymentTotals.totalOrdinaryRevenue,
        totalContractCash: paymentTotals.totalContractCash,
        contractPaidVisitCount: paymentTotals.contractPaidVisitCount,
        paidVisitCount: paymentTotals.paidVisitCount }, expectedPaymentTotals)) {
      addFailure(failures, `${phase}: aggregate candidate outcomes or payments differ from frozen evidence`);
    }

    const reasonTotals = {};
    for (const run of completed) {
      if (!object(run.reasonCounts)) {
        addFailure(failures, `seed ${run.seed}: reason-count evidence is missing`);
        continue;
      }
      for (const [reason, count] of Object.entries(run.reasonCounts)) {
        reasonTotals[reason] = (reasonTotals[reason] || 0) + count;
      }
    }
    for (const reason of Object.keys(reasonTotals)) {
      if (reasonTotals[reason] === 0) delete reasonTotals[reason];
    }
    if (!sameValue(reasonTotals, candidateAggregate.outcomes?.exactReasonCounts || {})) {
      addFailure(failures, `${phase}: aggregate outcome reason counts differ from frozen evidence`);
    }
  } else {
    addFailure(failures, `${phase}: frozen aggregate candidate evidence is missing`);
  }

  return { phase, templateId, candidateId, expectedCount: expectedSeeds?.length ?? 0,
    completedCount: completed.length, successes, minimum, passed: failures.length === 0, failures };
}
