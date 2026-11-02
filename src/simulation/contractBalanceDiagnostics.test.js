import { afterEach, describe, expect, it, vi } from 'vitest';
import { summariseContractDiagnostics } from './contractBalanceDiagnostics.testSupport';

afterEach(() => vi.restoreAllMocks());

const ledgerRows = [
  ['g-closed', 'missed', 'missed_closed'],
  ['g-queue', 'missed', 'missed_queue_full'],
  ['g-identity', 'missed', 'missed_identity_conflict'],
  ['g-resume', 'missed', 'missed_resume'],
  ['g-cancelled', 'failed', 'food_cancelled'],
  ['g-cancelled-paid', 'not_fulfilled', 'food_cancelled'],
  ['g-unaffordable', 'failed', 'menu_unaffordable'],
  ['g-abandoned', 'failed', 'abandoned'],
  ['g-closed-fail', 'failed', 'closed'],
  ['g-unpaid', 'failed', 'left_unpaid'],
  ['g-missing', 'failed', 'missing_guest'],
  ['g-drink', 'not_fulfilled', 'drink_only'],
  ['g-unverified', 'not_fulfilled', 'unverified_food'],
  ['g-deadline', 'unfinished', 'deadline'],
].map(([guestId, status, reason], index) => ({
  guestId,
  partyId: `p-${index + 1}`,
  status,
  reason,
  paidVisitSequence: null,
  resolvedAt: 1000 + index,
}));

describe('contract balance diagnostics', () => {
  it('counts exact ledger reasons and overlapping unique-guest categories without treating identity conflict as seating loss', () => {
    const result = { rulesVersion: 5, guestResults: ledgerRows };
    const diagnostics = summariseContractDiagnostics({
      active: null,
      result,
      orderFacts: [
        { guestId: 'g-cancelled', affordableFood: false },
        { guestId: 'g-drink', affordableFood: false, drinkOnly: true },
        { guestId: 'g-unverified', affordableFood: true },
      ],
      stageFacts: new Map(),
      paidVisits: [],
      parties: [],
      serviceItems: [],
    });

    expect(diagnostics.rulesVersion).toBe(5);
    expect(diagnostics.reasonCounts).toEqual({
      missed_closed: 1,
      missed_queue_full: 1,
      missed_identity_conflict: 1,
      missed_resume: 1,
      food_cancelled: 2,
      menu_unaffordable: 1,
      abandoned: 1,
      closed: 1,
      left_unpaid: 1,
      missing_guest: 1,
      drink_only: 1,
      unverified_food: 1,
      deadline: 1,
    });
    expect(diagnostics.categoryCounts).toEqual({
      missedArrival: 4,
      queueSeatingLoss: 2,
      identityConflict: 1,
      drinkOnlyChoice: 1,
      unaffordableFood: 2,
      cancelledFood: 2,
      unpaidDeparture: 1,
      unresolvedAtDeadline: 1,
    });
    expect(diagnostics.outcomes).toEqual(ledgerRows.map(({ guestId, partyId, status, reason,
      paidVisitSequence, resolvedAt }) => ({ guestId, partyId, status, reason, paidVisitSequence, resolvedAt })));
  });

  it('uses retained finite timestamp evidence and leaves unmodelled or unavailable stages null', () => {
    const result = { rulesVersion: 5, guestResults: [
      { guestId: 'g-retained', partyId: 'p-retained', status: 'fulfilled_paid', reason: null,
        paidVisitSequence: 7, resolvedAt: 900 },
      { guestId: 'g-missed', partyId: 'p-missed', status: 'missed', reason: 'missed_resume',
        paidVisitSequence: null, resolvedAt: 500 },
    ] };
    const stageFacts = new Map([
      ['g-retained', { arrivalAt: 100, admittedAt: 120, orderedAt: 200, foodOrderedAt: 201,
        foodDeadlineAt: 501, foodCancelledAt: null, preparationStartedAt: 230, readyAt: 280,
        paidAt: 900 }],
      ['g-missed', { arrivalAt: 500, admittedAt: null, orderedAt: Infinity,
        foodOrderedAt: undefined, foodDeadlineAt: NaN, foodCancelledAt: null,
        preparationStartedAt: null, readyAt: null, paidAt: null }],
    ]);
    const diagnostics = summariseContractDiagnostics({
      active: null,
      result,
      orderFacts: [],
      stageFacts,
      paidVisits: [],
      parties: [],
      serviceItems: [{ customerId: 'g-retained', kind: 'dish', state: 'delivered' }],
    });

    expect(diagnostics.stagesByGuest).toEqual([
      { guestId: 'g-retained', arrivalAt: 100, admittedAt: 120, seatedAt: null, orderedAt: 200,
        foodOrderedAt: 201, foodDeadlineAt: 501, foodCancelledAt: null, preparationStartedAt: 230,
        readyAt: 280, deliveredAt: null, paidAt: 900 },
      { guestId: 'g-missed', arrivalAt: 500, admittedAt: null, seatedAt: null, orderedAt: null,
        foodOrderedAt: null, foodDeadlineAt: null, foodCancelledAt: null, preparationStartedAt: null,
        readyAt: null, deliveredAt: null, paidAt: null },
    ]);
    expect(diagnostics.unavailableStages).toContain('seatedAt');
    expect(diagnostics.unavailableStages).toContain('deliveredAt');
    for (const stages of diagnostics.stagesByGuest) {
      for (const [key, value] of Object.entries(stages)) {
        if (key !== 'guestId') expect(value === null || Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('uses only explicit party, service-item, paid-visit, and qualifying-ledger timestamp evidence', () => {
    const result = { rulesVersion: 5, guestResults: [
      { guestId: 'g-qualified', partyId: 'p-one', status: 'fulfilled_paid', reason: null,
        paidVisitSequence: 3, resolvedAt: 330 },
      { guestId: 'g-drink', partyId: 'p-two', status: 'not_fulfilled', reason: 'drink_only',
        paidVisitSequence: null, resolvedAt: 440 },
    ] };
    const diagnostics = summariseContractDiagnostics({
      active: null,
      result,
      orderFacts: [],
      stageFacts: new Map([['g-qualified', {}], ['g-drink', {}]]),
      paidVisits: [{ id: 'g-drink', at: 450, contractId: 'sc-1' }],
      parties: [
        { partyId: 'p-one', arrivalAt: 100, admittedAt: 110 },
        { partyId: 'p-two', arrivalAt: 200, admittedAt: null },
      ],
      serviceItems: [
        { customerId: 'g-qualified', kind: 'dish', preparationStartedAt: 250, readyAt: 290 },
        { customerId: 'g-qualified', kind: 'drink', preparationStartedAt: 240, readyAt: 270 },
      ],
    });

    expect(diagnostics.stagesByGuest).toEqual([
      { guestId: 'g-qualified', arrivalAt: 100, admittedAt: 110, seatedAt: null, orderedAt: null,
        foodOrderedAt: null, foodDeadlineAt: null, foodCancelledAt: null, preparationStartedAt: 240,
        readyAt: 270, deliveredAt: null, paidAt: 330 },
      { guestId: 'g-drink', arrivalAt: 200, admittedAt: null, seatedAt: null, orderedAt: null,
        foodOrderedAt: null, foodDeadlineAt: null, foodCancelledAt: null, preparationStartedAt: null,
        readyAt: null, deliveredAt: null, paidAt: 450 },
    ]);
  });

  it('projects an active partial ledger and does not mutate evidence or consume randomness', () => {
    const active = Object.freeze({ rulesVersion: 5, guests: Object.freeze([
      Object.freeze({ guestId: 'g-partial', partyId: 'p-partial', status: 'pending', reason: null,
        paidVisitSequence: null, resolvedAt: null }),
    ]) });
    const stageRow = Object.freeze({ arrivalAt: 100, admittedAt: 100, orderedAt: null,
      foodOrderedAt: null, foodDeadlineAt: null, foodCancelledAt: null,
      preparationStartedAt: null, readyAt: null, paidAt: null });
    const stageFacts = new Map([['g-partial', stageRow]]);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Diagnostics used randomness'); });

    const diagnostics = summariseContractDiagnostics({ active, result: null,
      orderFacts: [{ guestId: 'g-partial', menuOutcome: 'ordered', dishId: null, drinkId: 'water', affordableFood: true }], stageFacts,
      paidVisits: [], parties: [], serviceItems: [] });

    expect(diagnostics.outcomes).toEqual([{ guestId: 'g-partial', partyId: 'p-partial', status: 'pending',
      reason: null, paidVisitSequence: null, resolvedAt: null }]);
    expect(diagnostics.categoryCounts.drinkOnlyChoice).toBe(1);
    expect(stageFacts.get('g-partial')).toBe(stageRow);
    expect(random).not.toHaveBeenCalled();
  });
});
