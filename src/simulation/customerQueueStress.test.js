import { describe, expect, it } from 'vitest';
import {
  buildCustomerQueueStressState,
  runCustomerQueueStressScenario,
} from './customerQueueStress';

describe('party customer queue stress', () => {
  it('keeps waiting members out of planning while eight-party throughput continues', () => {
    const initial = buildCustomerQueueStressState();
    expect(initial.queue).toHaveLength(8);
    expect(initial.queue.flatMap(party => party.members)).toHaveLength(32);
    const result = runCustomerQueueStressScenario({ cycles: 8, movementDt: 0.1 });
    expect(result.completedPartyIds).toHaveLength(8);
    expect(result.maximumGateOwners).toBe(1);
    expect(result.queuedMemberMovementEntries).toBe(0);
    expect(result.arrivalsResumed).toBe(true);
    expect(result.minimumSpacing).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(result.allCoordinatesFinite).toBe(true);
  });
});
