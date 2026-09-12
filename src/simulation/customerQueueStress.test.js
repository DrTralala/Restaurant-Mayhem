import { describe, expect, it } from 'vitest';
import {
  buildCustomerQueueStressState,
  buildCustomerQueueNonTimingProjection,
  getValidatedGateOwnerPartyIds,
  runCustomerQueueStressScenario,
} from './customerQueueStress';
import { resolveStaffAfterMovement } from './staff';
import { minimumTrajectoryDistance } from './movement/trajectory';
import { getCustomerMovementEntries } from './customers';
import { getQueueVisibleMembers, reconcileQueueSlots } from './customerQueue';

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
    expect(result.maximumMovementActors).toBe(5);
    expect(result.summary.batches).toBe(result.ticks);
    expect(result.maxExpansionsPerTick).toBeLessThanOrEqual(2048);
    expect(result.maximumActorQuantum).toBeLessThanOrEqual(256);
    expect(result.allMovementScheduled).toBe(true);
    expect(result.allWithinSpeedBudget).toBe(true);
    expect(result.maximumGateOwners).toBe(1);
    expect(result.gateOwnerPartyIds).toEqual(result.completedPartyIds);
    expect(result.queuedMemberMovementEntries).toBe(0);
    expect(result.arrivalsResumed).toBe(true);
    expect(result.replacementPartyIds).toHaveLength(8);
    expect(new Set(result.replacementPartyIds).size).toBe(8);
    expect(result.minimumSpacing).toBeGreaterThanOrEqual(16);
    expect(result.allCoordinatesFinite).toBe(true);
    for (const tick of result.tickRecords) {
      expect(tick.expansionsThisTick).toBeLessThanOrEqual(2048);
      expect(tick.actorQuanta.every(value => value <= 256)).toBe(true);
      for (const actor of tick.actors) {
        expect(Number.isFinite(actor.end.x) && Number.isFinite(actor.end.y)).toBe(true);
        const distance = actor.trajectory.reduce((sum, segment) => sum + Math.hypot(
          segment.end.x - segment.start.x, segment.end.y - segment.start.y,
        ), 0);
        expect(actor.trajectory[0].startTime).toBe(0);
        expect(actor.trajectory.at(-1).endTime).toBe(1);
        expect(distance).toBeLessThanOrEqual(actor.speed * tick.dt + 1e-6);
        if (distance > 0) expect(actor.executedInstalledSchedule).toBe(true);
        if (actor.goal && actor.end.x === actor.goal.x && actor.end.y === actor.goal.y) {
          expect(actor.status.plan).toBe('arrived');
        }
      }
      for (let left = 0; left < tick.actors.length; left += 1) {
        const actor = tick.actors[left];
        for (const right of tick.actors.slice(left + 1)) {
          if (actor.ignoredIds.includes(right.id) || right.ignoredIds.includes(actor.id)) continue;
          expect(minimumTrajectoryDistance(actor.occupiedTrajectory, right.occupiedTrajectory))
            .toBeGreaterThanOrEqual(16);
          if (actor.occupiesEnd && right.occupiesEnd) {
            expect(Math.hypot(actor.end.x - right.end.x, actor.end.y - right.end.y))
              .toBeGreaterThanOrEqual(16);
          }
        }
      }
    }
    const changedTiming = { ...result, timings: {}, summary: { ...result.summary, plannerMilliseconds: 1e9 } };
    expect(buildCustomerQueueNonTimingProjection(changedTiming)).toEqual(buildCustomerQueueNonTimingProjection(result));
  });

  it('replenishes every completed cycle and subsequently admits a replacement party', () => {
    const result = runCustomerQueueStressScenario({ cycles: 9, movementDt: 0.1 });

    expect(result.completedPartyIds).toHaveLength(9);
    expect(result.replacementPartyIds).toHaveLength(9);
    expect(result.completedPartyIds).toContain(result.replacementPartyIds[0]);
    expect(result.completedPartyIds[8]).toBe('stress-party-09');
  });

  it('counts an owner party after validating the exact gate shape including its door', () => {
    const admitted = buildOccupiedGateState();
    expect(admitted.queueAdmissionGate.doorId).toBe('queue-door');
    expect(getValidatedGateOwnerPartyIds(admitted))
      .toEqual(['stress-party-01']);

    expect(() => getValidatedGateOwnerPartyIds({
      ...admitted,
      queueAdmissionGate: { ...admitted.queueAdmissionGate, unexpected: true },
    })).toThrow('Customer queue stress gate must contain exactly partyId, customerIds, guideStaffId, tableId, and doorId');

    expect(() => getValidatedGateOwnerPartyIds({
      ...admitted,
      queueAdmissionGate: { ...admitted.queueAdmissionGate, doorId: null },
    })).toThrow('Customer queue stress gate must contain exactly partyId, customerIds, guideStaffId, tableId, and doorId');
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

  it('flags that the staff-only harness omits the production customer-phase queue blockers', () => {
    // The staff-only stress harness deliberately never feeds queue members into
    // planning, so its PASS cannot stand in for the merged production pipeline,
    // which reserves the visible queue band as stationary blockers. This
    // conformance check keeps that gap explicit.
    const initial = buildCustomerQueueStressState();
    // The production pipeline reconciles ownership before descriptor
    // collection, granting the FIFO visible leases; mirror that reconcile so
    // the blocker set is the canonical leased projection.
    const reconciled = { ...initial, queueSlots: reconcileQueueSlots(initial, initial.queueSlots || []) };
    const productionBlockers = getCustomerMovementEntries(reconciled)
      .filter(entry => entry.provenance === 'queue');
    const visibleMembers = getQueueVisibleMembers(reconciled, reconciled.queue);
    expect(productionBlockers).toHaveLength(visibleMembers.length);
    expect(productionBlockers.length).toBeGreaterThan(0);
    expect(new Set(productionBlockers.map(entry => entry.character.id)))
      .toEqual(new Set(visibleMembers.map(member => member.id)));
  });
});
