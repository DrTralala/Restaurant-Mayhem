import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/initialState';
import * as customers from './customers';
import * as clock from './clock';
import * as movement from './movement';
import { runTick } from './gameLoop';
import { advanceFixedStep } from './fixedStep';
import { acceptServiceContract, createServiceContractsState, validateServiceContractsState } from './serviceContracts';

afterEach(() => vi.restoreAllMocks());
// Real simulation without service resources: these are scheduling/failure
// fixtures, not demonstrations of checkout, navigability or contract balance.
function schedulingState(time = 36000) {
  const initial = createInitialState();
  return { ...initial, restaurant: { ...initial.restaurant, gameTime: time },
    serviceContracts: createServiceContractsState(), paidVisitSequence: 0,
    staff: [], tables: [], chairs: [], doors: [], cashierStations: [],
    kitchenStations: [], washStations: [], serviceTables: [] };
}
function accepted(templateId = 'office-lunch', state = schedulingState()) {
  return acceptServiceContract(state, { templateId });
}
function bookingFor(state, index = 0) {
  const active = state.serviceContracts.active;
  const party = active.parties[index];
  return { instanceId: active.instanceId, partyId: party.partyId, partyType: party.partyType,
    arrivalAt: party.arrivalAt, members: active.guests.filter(g => g.partyId === party.partyId).map(g => ({
      id: g.guestId, serviceContractGuestId: g.guestId, archetype: g.archetype,
      gender: g.gender, spendingTier: g.spendingTier, spendingBudget: g.spendingBudget,
    })) };
}
function waitingParties(count, patience = 9000) {
  return Array.from({ length: count }, (_, i) => ({ partyId: `ordinary-${i}`, members: [{
    id: `ordinary-guest-${i}`, partyId: `ordinary-${i}`, state: 'queued', archetype: 'regular',
    partySize: 1, patience: 900, patienceMax: 900, queuePatience: patience, queuePatienceMax: patience,
  }] }));
}

describe('real scheduled logical admission', () => {
  it.each([
    ['office-lunch', 2, 750], ['family-service', 4, 1575], ['tasting-service', 1, 1200],
  ])('initialises %s through ordinary logical defaults without RNG or coordinates', (templateId, size, patience) => {
    let state = accepted(templateId);
    const booking = bookingFor(state);
    state = { ...state, restaurant: { ...state.restaurant, gameTime: booking.arrivalAt },
      upgrades: [{ level: 2, effects: { type: 'happiness', value: 5 } }] };
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected booking RNG'); });
    const result = customers.admitScheduledServiceParty(state, booking);
    expect(result).toMatchObject({ admitted: true, reason: null });
    expect(result.state.queue).toHaveLength(1);
    expect(result.state.queue[0]).toMatchObject({ partyId: 'sc-1-p1', serviceContractId: 'sc-1' });
    expect(result.state.queue[0].members).toHaveLength(size);
    for (const [index, member] of result.state.queue[0].members.entries()) {
      expect(member).toMatchObject({ ...booking.members[index], partyId: booking.partyId, partySize: size,
        partyType: booking.partyType, serviceContractId: 'sc-1', serviceContractArrivalAt: booking.arrivalAt,
        patience, patienceMax: patience, queuePatience: patience, queuePatienceMax: patience,
        happiness: 90, state: 'queued', dishId: null, drinkId: null, foodOutcome: null, tableId: null, chairId: null });
      expect(member).not.toHaveProperty('x');
      expect(member).not.toHaveProperty('y');
      expect(member).not.toHaveProperty('navigationGoal');
    }
    expect(result.state.customers).toBe(state.customers);
    expect(result.state.queueSlots).toBe(state.queueSlots);
    expect(state.queue).toHaveLength(0);
    expect(random).not.toHaveBeenCalled();
  });
  it('adds a whole four-member family behind seven parties, but not behind eight', () => {
    const initial = accepted('family-service');
    const booking = bookingFor(initial);
    for (const count of [7, 8]) {
      const state = { ...initial, queue: waitingParties(count),
        restaurant: { ...initial.restaurant, gameTime: booking.arrivalAt } };
      const result = customers.admitScheduledServiceParty(state, booking);
      expect(result.admitted).toBe(count === 7);
      expect(result.reason).toBe(count === 7 ? null : 'queue_full');
      expect(result.state.queue).toHaveLength(8);
      expect(result.state.queue.slice(0, count)).toEqual(state.queue);
      if (count === 7) expect(result.state.queue[7].members).toHaveLength(4);
      else expect(result.state).toBe(state);
    }
  });
  it('uses actual opening hours and refuses the whole booking without normalisation side effects', () => {
    const original = accepted();
    const state = { ...original, restaurant: { ...original.restaurant, gameTime: 36900, openHour: 12, closeHour: 13 } };
    expect(customers.admitScheduledServiceParty(state, bookingFor(state))).toEqual({ state, admitted: false, reason: 'closed' });
  });
  it.each([
    ['customers', [{ id: 'sc-1-g1', partyId: 'old' }]],
    ['staff', [{ id: 'sc-1-g1', role: 'waiter' }]],
    ['queueDepartures', [{ id: 'sc-1-g1', partyId: 'old' }]],
    ['completedCustomers', [{ customerId: 'sc-1-g1', revenue: 12 }]],
    ['serviceItems', [{ customerId: 'sc-1-g1' }]],
    ['partyReviewHistory', [{ partyId: 'sc-1-p1' }]],
    ['queue', [{ partyId: 'sc-1-p1', members: [{ id: 'ordinary', partyId: 'sc-1-p1' }] }]],
  ])('protects existing identities in %s without overwrite or regeneration', (key, entries) => {
    const state = { ...accepted(), [key]: entries };
    const result = customers.admitScheduledServiceParty(state, bookingFor(state));
    expect(result).toEqual({ state, admitted: false, reason: 'identity_conflict' });
    expect(result.state).toBe(state);
  });
  it('clamps only booked members to their actual queued age, including after a contract ends', () => {
    let state = accepted();
    const booking = bookingFor(state);
    state = { ...state, restaurant: { ...state.restaurant, gameTime: 36900 } };
    state = customers.admitScheduledServiceParty(state, booking).state;
    state = customers.prepareCustomersForMovement(state, 900);
    expect(state.queue[0].members.map(m => m.queuePatience)).toEqual([750, 750]);
    expect(state.queue[0].serviceContractId).toBe('sc-1');
    state = { ...state, serviceContracts: createServiceContractsState(),
      restaurant: { ...state.restaurant, gameTime: 36910 } };
    state = customers.prepareCustomersForMovement(state, 10);
    expect(state.queue[0].members.map(m => m.queuePatience)).toEqual([740, 740]);
    const ordinary = { ...schedulingState(36900), queue: waitingParties(1, 750) };
    expect(customers.prepareCustomersForMovement(ordinary, 100).queue[0].members[0].queuePatience).toBe(650);
  });
});

describe('real contract tick scheduling', () => {
  it.each([1, 2, 4])('keeps the exact wave timestamp during fixed-step catch-up at speed %s', speed => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const initial = accepted();
    const state = { ...initial, speed, restaurant: { ...initial.restaurant, gameTime: 36899 } };
    const frame = advanceFixedStep({ state, previousState: state, accumulator: 0, elapsedSeconds: 0.25 }, runTick);
    expect(frame.state.serviceContracts.active.parties[0]).toMatchObject({ status: 'admitted', admittedAt: 36900 });
    expect(frame.state.queue).toHaveLength(1);
    expect(frame.state.queue[0].members).toHaveLength(2);
  });
  it('honours a representable sub-epsilon wave boundary instead of repairing it as late', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const initial = accepted();
    const state = { ...initial, restaurant: { ...initial.restaurant, gameTime: 36900 - 1e-10 } };
    const after = runTick(state, { gameDt: 1, movementDt: 0 });
    expect(after.serviceContracts.active.parties[0]).toMatchObject({ status: 'admitted', admittedAt: 36900 });
  });
  it('keeps the requested movement budget proportional across every contract split', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const move = vi.spyOn(movement, 'advanceCharacterMovementBatch');
    runTick(accepted(), { gameDt: 5000, movementDt: 5 });
    expect(move.mock.calls).toHaveLength(5);
    [0.9, 0.72, 0.72, 2.16, 0.5].forEach((expected, index) => expect(move.mock.calls[index][2]).toBeCloseTo(expected));
    expect(move.mock.calls.reduce((sum, args) => sum + args[2], 0)).toBeCloseTo(5);
  });
  it('expires food before the arrival helper sees that endpoint', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const admit = vi.spyOn(customers, 'admitScheduledServiceParty');
    const state = { ...accepted(), customers: [{ id: 'food-waiter', state: 'waiting_for_items',
      dishId: 'starter-toast', foodOutcome: 'pending', foodOrderedAt: 36000,
      foodPatienceBudget: 900, foodDeadlineAt: 36900 }] };
    runTick(state, { gameDt: 900, movementDt: 0 });
    expect(admit).toHaveBeenCalledTimes(1);
    expect(admit.mock.calls[0][0].customers[0]).toMatchObject({ foodOutcome: 'cancelled', foodCancelledAt: 36900 });
  });
  it('produces the same booking failure ledger for one boundary-spanning tick and its exact segments', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const large = runTick(accepted(), { gameDt: 5000, movementDt: 0 });
    let segmented = accepted();
    for (const gameDt of [900, 720, 720, 2160, 500]) segmented = runTick(segmented, { gameDt, movementDt: 0 });
    expect(segmented.serviceContracts.results).toEqual(large.serviceContracts.results);
    expect(segmented.restaurant.gameTime).toBe(41000);
  });
  it('admits nothing during preparation, admits exactly once at the wave, and preserves fresh patience', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = runTick(accepted(), { gameDt: 899, movementDt: 0 });
    expect(state.queue).toHaveLength(0);
    state = runTick(state, { gameDt: 1, movementDt: 0 });
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0].members.map(m => m.queuePatience)).toEqual([750, 750]);
    expect(state.serviceContracts.active.parties[0]).toMatchObject({ status: 'admitted', admittedAt: 36900 });
    expect(state.queue[0].serviceContractId).toBe('sc-1');
    expect(() => validateServiceContractsState(state.serviceContracts, state)).not.toThrow();
    const repeated = runTick(state, { gameDt: 0, movementDt: 0 });
    expect(repeated.queue).toHaveLength(1);
    expect(repeated.queue[0].members.map(m => m.id)).toEqual(['sc-1-g1', 'sc-1-g2']);
  });
  it('takes a due-at-entry booking before advancement, not as missed resume after advancement', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = accepted();
    state = { ...state, restaurant: { ...state.restaurant, gameTime: 36900 } };
    state = runTick(state, { gameDt: 10, movementDt: 0 });
    expect(state.serviceContracts.active.parties[0]).toMatchObject({ status: 'admitted', admittedAt: 36900 });
    expect(state.queue[0].members.map(m => m.queuePatience)).toEqual([740, 740]);
  });
  it('processes all waves and deadline in a single large tick without retroactive misses or false success', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const ticks = vi.spyOn(clock, 'advanceClock'); // call-through: actual simulation runs
    const state = runTick(accepted(), { gameDt: 5000, movementDt: 0 });
    expect(ticks.mock.calls.map(([s, dt]) => s.restaurant.gameTime + dt)).toEqual([36900, 37620, 38340, 40500, 41000]);
    const result = state.serviceContracts.results[0];
    expect(result).toMatchObject({ status: 'failed', fulfilledCount: 0, bonusPaid: 0, settledAt: 40500 });
    expect(result.guestResults).toHaveLength(6);
    expect(result.guestResults.every(g => g.status === 'failed' && ['abandoned', 'left_unpaid'].includes(g.reason))).toBe(true);
    expect(state.restaurant.funds).toBe(600);
    expect(state.navigationFault).toBeUndefined();
    expect(() => validateServiceContractsState(state.serviceContracts, state)).not.toThrow();
  });
  it('gives the booking the last queue place before a guaranteed ambient arrival', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const original = accepted('family-service');
    const state = runTick({ ...original, queue: waitingParties(7) }, { gameDt: 900, movementDt: 0 });
    expect(state.serviceContracts.active.parties[0].status).toBe('admitted');
    expect(state.queue).toHaveLength(8);
    expect(state.queue[7].partyId).toBe('sc-1-p1');
    expect(state.queue[7].members).toHaveLength(4);
  });
  it('does not retry a queue-full wave when ordinary preparation frees the queue later at that endpoint', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = runTick({ ...accepted(), queue: waitingParties(8, 1) }, { gameDt: 900, movementDt: 0 });
    expect(state.serviceContracts.active.parties[0]).toMatchObject({ status: 'missed', missedReason: 'missed_queue_full' });
    expect(state.queue).toHaveLength(0);
    state = runTick(state, { gameDt: 1, movementDt: 0 });
    expect(state.queue).toHaveLength(0);
    expect(state.serviceContracts.active.guests[0].reason).toBe('missed_queue_full');
  });
  it('misses a closed wave once and later admits the next wave under then-current hours', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = accepted();
    state.restaurant = { ...state.restaurant, openHour: 12, closeHour: 13 };
    state = runTick(state, { gameDt: 900, movementDt: 0 });
    expect(state.serviceContracts.active.parties[0].missedReason).toBe('missed_closed');
    state = { ...state, restaurant: { ...state.restaurant, openHour: 0, closeHour: 0 } };
    state = runTick(state, { gameDt: 720, movementDt: 0 });
    expect(state.serviceContracts.active.parties.map(p => p.status)).toEqual(['missed', 'admitted', 'scheduled']);
    expect(state.queue[0].partyId).toBe('sc-1-p2');
  });
  it.each([40500, 40500.001])('repairs loaded due contracts at %s from the ledger before service', now => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = runTick(accepted(), { gameDt: 900, movementDt: 0 });
    state = { ...state, queue: [], queueSlots: [], restaurant: { ...state.restaurant, gameTime: now } };
    const after = runTick(state, { gameDt: 1, movementDt: 0 });
    expect(after.serviceContracts.results[0].guestResults[0]).toMatchObject({ status: 'unfinished', reason: 'deadline', resolvedAt: 40500 });
    expect(after.serviceContracts.results[0].guestResults[2]).toMatchObject({ status: 'missed', reason: 'missed_resume', resolvedAt: 37620 });
    expect(runTick(after, { gameDt: 1, movementDt: 0 }).serviceContracts.results).toHaveLength(1);
  });
  it('repairs past waves without spawning them while admitting an exactly current wave', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const initial = accepted();
    const state = runTick({ ...initial, restaurant: { ...initial.restaurant, gameTime: 37620 } }, { gameDt: 0, movementDt: 0 });
    expect(state.serviceContracts.active.parties.map(p => p.status)).toEqual(['missed', 'admitted', 'scheduled']);
    expect(state.serviceContracts.active.guests[0]).toMatchObject({ reason: 'missed_resume', resolvedAt: 36900 });
    expect(state.queue[0].partyId).toBe('sc-1-p2');
  });
  it.each([{ paused: true }, { navigationFault: { issues: [] } }, { careerRun: { needsDecision: true } }])('defers entry repairs behind %j', guard => {
    const initial = accepted();
    const state = { ...initial, ...guard, restaurant: { ...initial.restaurant, gameTime: 41000 } };
    expect(runTick(state, { gameDt: 100, movementDt: 1 })).toBe(state);
  });
});
