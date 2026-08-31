import { describe, expect, it } from 'vitest';
import {
  buildCustomerQueueStressState,
  getValidatedGateOwnerPartyIds,
  runCustomerQueueStressScenario,
} from './customerQueueStress';
import { resolveStaffAfterMovement } from './staff';

function buildOccupiedGateState() {
  return resolveStaffAfterMovement(buildCustomerQueueStressState(), 0);
}

describe('party customer queue stress', () => {
  it('keeps waiting members out of planning while eight-party throughput continues', () => {
    const initial = buildCustomerQueueStressState();
    expect(initial.queue).toHaveLength(8);
    expect(initial.queue.flatMap(party => party.members)).toHaveLength(32);
    const result = runCustomerQueueStressScenario({ cycles: 8, movementDt: 0.1 });
    expect(result.completedPartyIds).toHaveLength(8);
    expect(result.minimumSpacing).toBe(20);
    expect(result.maximumGateOwners).toBe(1);
    expect(result.gateOwnerPartyIds).toEqual(result.completedPartyIds);
    expect(result.queuedMemberMovementEntries).toBe(0);
    expect(result.arrivalsResumed).toBe(true);
    expect(result.replacementPartyIds).toHaveLength(8);
    expect(new Set(result.replacementPartyIds).size).toBe(8);
    expect(result.minimumSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(result.allCoordinatesFinite).toBe(true);
  });

  it('replenishes every completed cycle and subsequently admits a replacement party', () => {
    const result = runCustomerQueueStressScenario({ cycles: 9, movementDt: 0.1 });

    expect(result.completedPartyIds).toHaveLength(9);
    expect(result.replacementPartyIds).toHaveLength(9);
    expect(result.completedPartyIds).toContain(result.replacementPartyIds[0]);
    expect(result.completedPartyIds[8]).toBe('stress-party-09');
  });

  it('counts an owner party only after validating the exact four-field gate shape', () => {
    const admitted = buildOccupiedGateState();
    expect(getValidatedGateOwnerPartyIds(admitted))
      .toEqual(['stress-party-01']);

    expect(() => getValidatedGateOwnerPartyIds({
      ...admitted,
      queueAdmissionGate: { ...admitted.queueAdmissionGate, unexpected: true },
    })).toThrow('Customer queue stress gate must contain exactly partyId, customerIds, guideStaffId, and tableId');
  });

  it('rejects gate identity that differs from its party, customers, or guide task', () => {
    const admitted = buildOccupiedGateState();
    const mismatchedGuide = {
      ...admitted,
      staff: admitted.staff.map(worker => worker.id === admitted.queueAdmissionGate.guideStaffId
        ? { ...worker, task: { ...worker.task, partyId: 'different-party' } }
        : worker),
    };
    expect(() => getValidatedGateOwnerPartyIds(mismatchedGuide))
      .toThrow('Customer queue stress gate identity does not match its guide task');

    const mismatchedCustomer = {
      ...admitted,
      customers: admitted.customers.map((customer, index) => index === 0
        ? { ...customer, partyId: 'different-party' }
        : customer),
    };
    expect(() => getValidatedGateOwnerPartyIds(mismatchedCustomer))
      .toThrow('Customer queue stress gate identity does not match its materialised customers');
  });
});
