import { describe, expect, it } from 'vitest';
import evidence from '../data/serviceContractsV6Evidence.json';
import { evaluateV6FidelityGate } from './contractBalanceFidelity.testSupport';

const officeSelection = evidence.selectedOffers.find(selection => selection.templateId === 'office-lunch');

function recordedRuns(phase = 'development', selection = officeSelection) {
  const exactReasonCounts = selection[phase].aggregate.candidate.outcomes.exactReasonCounts;
  const catalogueValues = Object.fromEntries(['title', 'guestLabel', 'profile', 'parties',
    'serviceDuration', 'target', 'reward'].map(key => [key, selection.v6Offer[key]]));
  return selection[phase].rows.map(([seed, [success, fulfilled, target, payments]], index) => ({
    templateId: selection.templateId,
    candidateId: 'v6-metadata-id-is-not-a-v5-outcome',
    seed,
    rulesVersion: 6,
    status: 'completed',
    success,
    fulfilled,
    target,
    payments: [...payments],
    catalogueValues,
    preparation: {
      id: selection.preparation.id,
      startingFunds: selection.preparation.startingFunds,
      fundsBeforeAcceptance: selection.preparation.fundsBeforeAcceptance,
      cost: selection.preparation.cost,
      actionLog: structuredClone(selection.preparation.actionLog),
    },
    reasonCounts: index === 0 ? { ...exactReasonCounts } : {},
    navigationFault: null,
    runtimeFault: null,
    safetyFaults: [],
    snapshotMismatch: null,
    gameTime: 42150,
    endAt: 42150,
    wallMs: 1,
    metadata: { tier: 'v6-only' },
  }));
}

describe('frozen v5-candidate to actual-v6 fidelity gate', () => {
  it('accepts exact selected outcomes, payments and preparation with only v6 identities differing', () => {
    const runs = recordedRuns();
    runs[0].candidateId = 'another-uncompared-run-identity';
    runs[0].wallMs = 999999;
    runs[0].metadata.tier = 'changed-non-evidence-metadata';
    expect(evaluateV6FidelityGate({ phase: 'development', templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', runs })).toMatchObject({ passed: true,
      expectedCount: 20, completedCount: 20, successes: 17, minimum: 16, failures: [] });
  });

  it('uses the frozen fixed minimum for each selected tier in development and holdout', () => {
    for (const selection of evidence.selectedOffers) {
      for (const phase of ['development', 'holdout']) {
        const result = evaluateV6FidelityGate({ phase, templateId: selection.templateId,
          candidateId: selection.candidateId, runs: recordedRuns(phase, selection) });
        expect(result).toMatchObject({ passed: true, expectedCount: 20, completedCount: 20,
          minimum: selection.tier.minimum, failures: [] });
      }
    }
  });

  it('rejects a missing run, changed outcome/payment, or changed preparation evidence', () => {
    const missing = recordedRuns();
    missing.pop();
    expect(evaluateV6FidelityGate({ phase: 'development', templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', runs: missing }).failures.join(' ')).toMatch(/count|seed/i);

    const changedOutcome = recordedRuns();
    changedOutcome[0].fulfilled++;
    expect(evaluateV6FidelityGate({ phase: 'development', templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', runs: changedOutcome }).failures.join(' ')).toMatch(/outcome/i);

    const changedPayment = recordedRuns();
    changedPayment[0].payments[2]++;
    expect(evaluateV6FidelityGate({ phase: 'development', templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', runs: changedPayment }).failures.join(' ')).toMatch(/outcome|payment/i);

    const changedPreparation = recordedRuns();
    changedPreparation[0].preparation.actionLog.push({ type: 'UNRECORDED_SETUP' });
    expect(evaluateV6FidelityGate({ phase: 'development', templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', runs: changedPreparation }).failures.join(' ')).toMatch(/preparation/i);

    const faulted = recordedRuns();
    faulted[0].navigationFault = { reason: 'blocked' };
    expect(evaluateV6FidelityGate({ phase: 'development', templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', runs: faulted }).failures.join(' ')).toMatch(/fault/i);
  });

  it('rejects unknown phases, templates and frozen candidate identifiers', () => {
    const runs = recordedRuns();
    expect(() => evaluateV6FidelityGate({ phase: 'screening', templateId: 'office-lunch',
      candidateId: 'office-lunch-candidate-1', runs })).toThrow(/phase/i);
    expect(() => evaluateV6FidelityGate({ phase: 'development', templateId: 'unknown',
      candidateId: 'office-lunch-candidate-1', runs })).toThrow(/template/i);
    expect(() => evaluateV6FidelityGate({ phase: 'holdout', templateId: 'office-lunch',
      candidateId: 'unknown-candidate', runs })).toThrow(/candidate/i);
  });
});
