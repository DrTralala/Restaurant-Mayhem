import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/initialState';
import { validateSavedState } from '../state/saveValidation';
import { advanceClock } from './clock';
import { acceptServiceContract, advanceServiceContractArrivals, createServiceContractsState,
  getNextServiceContractBoundary, getServiceContractOffer, hydrateServiceContractsState,
  recordServiceContractPaidVisit, selectServiceContractView, settleServiceContracts,
  validateServiceContractsState, withdrawServiceContract } from './serviceContracts';

afterEach(() => vi.restoreAllMocks());
const accept = (state = createInitialState(), templateId = 'office-lunch') =>
  acceptServiceContract(state, { templateId });
const at = (state, time) => advanceClock(state, time - state.restaurant.gameTime);
// The scheduler's injected boundary, not a replacement production admission helper.
const admitParty = (state, booking) => ({ admitted: true, reason: null, state: {
  ...state, queue: [...state.queue, { partyId: booking.partyId, serviceContractId: booking.instanceId,
    members: booking.members.map(member => ({ ...member, partyId: booking.partyId,
      serviceContractId: booking.instanceId, serviceContractArrivalAt: booking.arrivalAt,
      queuePatience: 750, state: 'queued' })) }],
} });
const arrive = (state, index = 0) => {
  const time = state.serviceContracts.active.parties[index].arrivalAt;
  return advanceServiceContractArrivals(at(state, time), time, { admitParty });
};
const outcome = (state, index, changes = {}) => {
  const active = state.serviceContracts.active;
  const guest = active.guests[index];
  return { schemaVersion: 1, sequence: index + 1, customerId: guest.guestId,
    partyId: guest.partyId, paidAt: state.restaurant.gameTime,
    menuOutcome: 'ordered', foodOutcome: 'delivered', serviceContractId: active.instanceId,
    serviceContractGuestId: guest.guestId,
    dish: { serviceItemId: `dish-${index}`, menuItemId: 'starter-toast', cookbookId: null,
      priceAtOrder: 12, chargedAmount: 12, fulfilled: true, paid: true },
    subtotal: 12, tip: 2, totalPaid: 14, ...changes };
};
const paid = (state, index, changes) => {
  const fact = outcome(state, index, changes);
  const mark = actor => actor.id === fact.customerId ? { ...actor, paidVisitSequence: fact.sequence } : actor;
  return recordServiceContractPaidVisit({ ...state,
    queue: state.queue.map(party => ({ ...party, members: party.members.map(mark) })),
    customers: state.customers.map(mark),
    paidVisitSequence: Math.max(state.paidVisitSequence || 0, fact.sequence) }, fact);
};

describe('offers and immutable acceptance', () => {
  it('defaults absent features without mutation, RNG, bookings or rewards', () => {
    const state = createInitialState();
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('RNG'); });
    expect(createServiceContractsState()).toEqual({ version: 1, nextInstanceSerial: 1,
      lastAcceptedDayByTemplate: {}, active: null, results: [] });
    expect(selectServiceContractView(state)).toMatchObject({ active: null, latestResult: null, results: [] });
    expect(getNextServiceContractBoundary(state, 0, 1e6)).toBe(null);
    expect(advanceServiceContractArrivals(state, 36000, { admitParty })).toBe(state);
    expect(settleServiceContracts(state, 36000)).toBe(state);
    expect(state.serviceContracts).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });
  it('snapshots all Office profiles and IDs, without funds or physical actor changes', () => {
    const before = createInitialState();
    const state = accept(before);
    const active = state.serviceContracts.active;
    expect(active).toMatchObject({ instanceId: 'sc-1', templateId: 'office-lunch', rulesVersion: 1,
      acceptedDay: 1, acceptedAt: 36000, serviceStartAt: 36900, deadlineAt: 40500,
      phase: 'preparing', target: 4, reward: 90 });
    expect(active.parties).toEqual([0, 720, 1440].map((arrivalOffset, i) => ({
      partyId: `sc-1-p${i + 1}`, partyType: 'couple', size: 2, arrivalOffset,
      arrivalAt: 36900 + arrivalOffset, guestIds: [`sc-1-g${i * 2 + 1}`, `sc-1-g${i * 2 + 2}`],
      status: 'scheduled', admittedAt: null, missedReason: null,
    })));
    expect(active.guests).toEqual(Array.from({ length: 6 }, (_, i) => ({
      guestId: `sc-1-g${i + 1}`, partyId: `sc-1-p${Math.floor(i / 2) + 1}`,
      label: `Office guest ${i + 1}`, archetype: 'rusher', gender: i % 2 ? 'male' : 'female',
      spendingTier: 'value', spendingBudget: 24, status: 'scheduled', reason: null,
      paidVisitSequence: null, resolvedAt: null,
    })));
    expect(state.restaurant).toBe(before.restaurant);
    expect(state.queue).toBe(before.queue);
    expect(before.serviceContracts).toBeUndefined();
    expect(hydrateServiceContractsState(state.serviceContracts)).toEqual(state.serviceContracts);
    expect(hydrateServiceContractsState(state.serviceContracts).active.guests).not.toBe(active.guests);
  });
  it('guards repeated and stale actions, daily attempts, and uses authoritative current time', () => {
    const original = createInitialState();
    getServiceContractOffer(original, 'office-lunch');
    const state = accept(at(original, 36100));
    expect(state.serviceContracts.active.acceptedAt).toBe(36100);
    expect(accept(state)).toBe(state);
    expect(accept(state, 'family-service')).toBe(state);
    expect(withdrawServiceContract(state, { instanceId: 'sc-9' })).toBe(state);
    const withdrawn = withdrawServiceContract(state, { instanceId: 'sc-1' });
    expect(accept(withdrawn)).toBe(withdrawn);
    expect(getServiceContractOffer(withdrawn, 'office-lunch').blockedReason).toBe('used_today');
    expect(accept(withdrawn, 'family-service').serviceContracts.active.instanceId).toBe('sc-2');
    expect(accept(at(withdrawn, 86400)).serviceContracts.active.instanceId).toBe('sc-2');
  });
  it.each([
    ['unknown_template', s => s, 'unknown'],
    ['invalid_clock', s => ({ ...s, restaurant: { ...s.restaurant, gameTime: NaN } })],
    ['invalid_clock', s => ({ ...s, restaurant: { ...s.restaurant, day: 0 } })],
    ['serial_exhausted', s => ({ ...s, serviceContracts: { ...createServiceContractsState(), nextInstanceSerial: Number.MAX_SAFE_INTEGER } })],
    ['navigation_fault', s => ({ ...s, navigationFault: {} })],
    ['career_decision', s => ({ ...s, careerRun: { needsDecision: true } })],
  ])('rejects %s without allocating an instance', (reason, change, id = 'office-lunch') => {
    const state = change(createInitialState());
    expect(getServiceContractOffer(state, id).blockedReason).toBe(reason);
    expect(accept(state, id)).toBe(state);
  });
  it('reports advisory readiness, exact previews, and accepts a negative balance', () => {
    const initial = createInitialState();
    const state = { ...initial, restaurant: { ...initial.restaurant, funds: -500, openHour: 12, closeHour: 13 },
      queue: Array.from({ length: 8 }, (_, i) => ({ id: `q${i}` })), dishes: [], tables: [], staff: [] };
    const offer = getServiceContractOffer(state, 'family-service');
    expect(offer.canAccept).toBe(true);
    expect(offer.preview).toMatchObject({ acceptedAt: 36000, serviceStartAt: 36900, deadlineAt: 41400,
      partyArrivals: [36900, 38100] });
    expect(offer.warnings).toEqual(expect.arrayContaining(['closed_at_arrival', 'queue_full',
      'no_affordable_dish', 'no_suitable_table', 'no_cook', 'no_waiter', 'no_staffed_checkout']));
    expect(accept(state, 'family-service').restaurant.funds).toBe(-500);
  });
});

describe('absolute boundaries and injected admissions', () => {
  it('attempts exactly due parties once, using the complete logical booking without coordinates', () => {
    let state = accept();
    const inject = vi.fn(admitParty);
    expect(getNextServiceContractBoundary(state, 36000, 36899)).toBe(null);
    expect(getNextServiceContractBoundary(state, 36000, 36900)).toBe(36900);
    expect(advanceServiceContractArrivals(state, 36899, { admitParty: inject })).toBe(state);
    state = at(state, 36900);
    state = advanceServiceContractArrivals(state, 36900, { admitParty: inject });
    expect(inject).toHaveBeenCalledTimes(1);
    expect(inject.mock.calls[0][1]).toEqual({ instanceId: 'sc-1', partyId: 'sc-1-p1', partyType: 'couple',
      arrivalAt: 36900, members: [0, 1].map(i => ({ id: `sc-1-g${i + 1}`,
        serviceContractGuestId: `sc-1-g${i + 1}`, archetype: 'rusher', gender: i ? 'male' : 'female',
        spendingTier: 'value', spendingBudget: 24 })) });
    expect(state.serviceContracts.active.phase).toBe('service');
    expect(state.serviceContracts.active.guests.map(g => g.status)).toEqual(['pending', 'pending', 'scheduled', 'scheduled', 'scheduled', 'scheduled']);
    expect(advanceServiceContractArrivals(state, 36900, { admitParty: inject })).toBe(state);
    expect(getNextServiceContractBoundary(state, 36900, 40500)).toBe(37620);
  });
  it.each(['closed', 'queue_full', 'identity_conflict'])('records a whole-party %s miss once', reason => {
    let state = at(accept(), 36900);
    const inject = vi.fn(s => ({ state: s, admitted: false, reason }));
    state = advanceServiceContractArrivals(state, 36900, { admitParty: inject });
    expect(state.queue).toHaveLength(0);
    expect(state.serviceContracts.active.guests.slice(0, 2).map(g => [g.status, g.reason, g.resolvedAt]))
      .toEqual(Array(2).fill(['missed', `missed_${reason}`, 36900]));
    expect(advanceServiceContractArrivals(state, 36900, { admitParty })).toBe(state);
    expect(inject).toHaveBeenCalledTimes(1);
  });
  it('repairs past waves without retroactive admissions, retaining their scheduled resolution time', () => {
    const state = at(accept(), 37620);
    const after = advanceServiceContractArrivals(state, 37620, { admitParty });
    expect(after.queue).toHaveLength(1);
    expect(after.queue[0].partyId).toBe('sc-1-p2');
    expect(after.serviceContracts.active.guests[0]).toMatchObject({ status: 'missed', reason: 'missed_resume', resolvedAt: 36900 });
    expect(advanceServiceContractArrivals(after, 37620, { admitParty })).toBe(after);
  });
  it('settles an overdue saved ledger before any new admission and never backdates observed failure', () => {
    let state = arrive(accept());
    state = { ...state, queue: [] };
    const inject = vi.fn(admitParty);
    const after = advanceServiceContractArrivals(at(state, 41000), 41000, { admitParty: inject });
    expect(inject).not.toHaveBeenCalled();
    expect(after.serviceContracts.active).toBe(null);
    expect(after.serviceContracts.results[0].guestResults[0]).toMatchObject({ status: 'unfinished', resolvedAt: 40500 });
    expect(after.serviceContracts.results[0].guestResults[2]).toMatchObject({ status: 'missed', reason: 'missed_resume', resolvedAt: 37620 });
    expect(settleServiceContracts(after, 41000)).toBe(after);
  });
  it('consumes a large interval by exact boundary calls through every wave and deadline', () => {
    let state = accept();
    const inject = vi.fn(admitParty);
    let boundary;
    while ((boundary = getNextServiceContractBoundary(state, state.restaurant.gameTime, 41000)) !== null) {
      state = at(state, boundary);
      state = advanceServiceContractArrivals(state, boundary, { admitParty: inject });
      state = settleServiceContracts(state, boundary);
    }
    expect(inject.mock.calls.map(([, booking]) => booking.arrivalAt)).toEqual([36900, 37620, 38340]);
    expect(state.serviceContracts.results[0].guestResults).toHaveLength(6);
    expect(state.serviceContracts.results[0].status).toBe('failed');
  });
  it('retains a career-terminal due wave for one entry attempt after the gate clears', () => {
    const state = { ...at(accept(), 36900), careerRun: { needsDecision: true } };
    expect(advanceServiceContractArrivals(state, 36900, { admitParty })).toBe(state);
    const continued = { ...state, careerRun: { needsDecision: false } };
    const after = advanceServiceContractArrivals(continued, 36900, { admitParty });
    expect(after.queue).toHaveLength(1);
    expect(after.serviceContracts.active.parties[0]).toMatchObject({ status: 'admitted', admittedAt: 36900 });
    expect(advanceServiceContractArrivals(after, 36900, { admitParty })).toBe(after);
  });
});

describe('canonical payments, reconciliation and settlement', () => {
  it.each([
    ['missing', null], ['cancelled', { foodOutcome: 'cancelled' }],
    ['departing', { state: 'leaving', departureReason: 'closed' }],
  ])('uses only persisted progress for a %s guest at deadline entry and overdue entry', (_, changes) => {
    let saved = paid(arrive(accept()), 1);
    const first = saved.queue[0].members[0];
    saved = { ...saved, queue: [], customers: changes ? [{ ...first, ...changes }] : [] };
    const ledger = structuredClone(saved.serviceContracts);
    for (const now of [40500, 40500.001]) {
      const state = at(saved, now);
      expect(() => validateServiceContractsState(state.serviceContracts, state)).not.toThrow();
      const after = settleServiceContracts(state, now, { entry: true });
      const result = after.serviceContracts.results[0];
      expect(result.guestResults[0]).toEqual({ guestId: 'sc-1-g1', partyId: 'sc-1-p1',
        status: 'unfinished', reason: 'deadline', paidVisitSequence: null, resolvedAt: 40500 });
      expect(result.guestResults[1]).toMatchObject({ status: 'fulfilled_paid', paidVisitSequence: 2, resolvedAt: 36900 });
      expect(result).toMatchObject({ fulfilledCount: 1, bonusPaid: 0, settledAt: now });
      expect(result.guestResults[2]).toMatchObject({ status: 'missed', reason: 'missed_resume', resolvedAt: 37620 });
      expect(after.customers).toBe(state.customers);
      expect(settleServiceContracts(after, now, { entry: true })).toBe(after);
      expect(() => validateServiceContractsState(after.serviceContracts, after)).not.toThrow();
      expect(state.serviceContracts).toEqual(ledger);
    }
  });
  it.each([
    ['missing', null, 'missing_guest'],
    ['cancelled', { foodOutcome: 'cancelled' }, 'food_cancelled'],
    ['departing', { state: 'leaving', departureReason: 'closed' }, 'closed'],
  ])('still reconciles a %s guest at the ordinary deadline endpoint', (_, changes, reason) => {
    let state = arrive(accept());
    const first = state.queue[0].members[0];
    state = at({ ...state, queue: [], customers: changes ? [{ ...first, ...changes }] : [] }, 40500);
    const after = settleServiceContracts(state, 40500);
    expect(after.serviceContracts.results[0].guestResults[0]).toMatchObject({ status: 'failed', reason, resolvedAt: 40500 });
  });
  it('pays exactly $90 only at the Office deadline for four valid guests; late and replayed facts are inert', () => {
    let state = arrive(accept());
    state = paid(paid(state, 0), 1);
    state = arrive(state, 1);
    state = paid(paid(state, 2), 3);
    expect(state.serviceContracts.active.guests).toHaveLength(6);
    expect(selectServiceContractView(state).active).toMatchObject({ fulfilledCount: 4, targetMet: true });
    const before = settleServiceContracts(state, 37620);
    expect(before.restaurant.funds).toBe(600);
    state = arrive(before, 2);
    const fact = outcome(state, 4);
    state = settleServiceContracts(at(state, 40500), 40500);
    expect(state.restaurant.funds - before.restaurant.funds).toBe(90);
    expect(state.restaurant.dailyRevenue).toBe(90);
    expect(state.restaurant.totalServed).toBe(0);
    expect(state.serviceContracts.results[0]).toMatchObject({ status: 'succeeded', fulfilledCount: 4, bonusPaid: 90 });
    expect(state.serviceContracts.results[0].guestResults.slice(4).map(g => g.status)).toEqual(['unfinished', 'unfinished']);
    expect(settleServiceContracts(state, 50000)).toBe(state);
    expect(recordServiceContractPaidVisit(state, fact)).toBe(state);
    const reloaded = { ...state, serviceContracts: hydrateServiceContractsState(state.serviceContracts) };
    expect(settleServiceContracts(reloaded, 50000)).toBe(reloaded);
    expect(state.queue).toHaveLength(3);
  });
  it.each([[-0.001, 'fulfilled_paid'], [0, 'fulfilled_paid'], [0.001, 'pending']])('payment deadline offset %s yields %s', (offset, status) => {
    const state = at(arrive(accept()), 40500 + offset);
    const after = paid(state, 0, { paidAt: 40500 + offset });
    expect(after.serviceContracts.active.guests[0].status).toBe(status);
  });
  it.each([
    ['drink_only', { dish: null, foodOutcome: 'none' }],
    ['food_cancelled', { dish: { serviceItemId: null, menuItemId: 'starter-toast', cookbookId: null,
      priceAtOrder: 12, chargedAmount: 0, fulfilled: false, paid: false }, foodOutcome: 'cancelled' }],
    ['unverified_food', { dish: { serviceItemId: null, menuItemId: 'starter-toast', cookbookId: null,
      priceAtOrder: null, chargedAmount: 0, fulfilled: false, paid: false }, foodOutcome: 'unknown' }],
  ])('terminal nonqualifying canonical outcome is %s', (reason, changes) => {
    const state = paid(arrive(accept()), 0, changes);
    expect(state.serviceContracts.active.guests[0]).toMatchObject({ status: 'not_fulfilled', reason, paidVisitSequence: null });
    expect(paid(state, 0, { sequence: 2 }).serviceContracts).toBe(state.serviceContracts);
  });
  it.each([
    { customerId: 'ordinary' }, { partyId: 'sc-1-p2' }, { serviceContractId: 'sc-2' },
    { serviceContractGuestId: 'sc-1-g2' }, { sequence: 0 }, { sequence: 1.5 }, { paidAt: 36899 },
    { schemaVersion: 2 }, { totalPaid: 99 }, { foodOutcome: 'cancelled' },
    { dish: { menuItemId: 'starter-toast', chargedAmount: 0, fulfilled: true, paid: true } },
  ])('rejects malformed or mismatched outcome %j', changes => {
    const state = { ...arrive(accept()), paidVisitSequence: 2 };
    expect(recordServiceContractPaidVisit(state, outcome(state, 0, changes))).toBe(state);
  });
  it('does not reuse a qualifying sequence for another guest or count unadmitted guests', () => {
    const state = paid(arrive(accept()), 0);
    expect(recordServiceContractPaidVisit(state, outcome(state, 1, { sequence: 1 }))).toBe(state);
    expect(recordServiceContractPaidVisit(state, outcome(state, 2))).toBe(state);
  });
  it('rejects future payment facts and sequences not yet committed by the shared producer', () => {
    const state = { ...arrive(accept()), paidVisitSequence: 1 };
    expect(recordServiceContractPaidVisit(state, outcome(state, 0, { paidAt: 36901 }))).toBe(state);
    expect(recordServiceContractPaidVisit(state, outcome(state, 0, { sequence: 2 }))).toBe(state);
  });
  it.each([
    [{ foodOutcome: 'cancelled' }, 'food_cancelled'],
    [{ menuOutcome: 'unaffordable' }, 'menu_unaffordable'],
    [{ state: 'leaving', departureReason: 'abandoned' }, 'abandoned'],
    [{ state: 'leaving', closedAt: 36900 }, 'closed'],
    [{ state: 'leaving', reputationApplied: true, queuePatience: 0 }, 'abandoned'],
    [{ state: 'leaving' }, 'left_unpaid'],
  ])('reconciles irreversible %j as %s, never reversing for subsequent payments', (changes, reason) => {
    let state = arrive(accept());
    state = { ...state, queue: state.queue.map(p => ({ ...p,
      members: p.members.map((m, i) => i ? m : { ...m, ...changes }) })) };
    state = settleServiceContracts(state, 36900);
    expect(state.serviceContracts.active.guests[0]).toMatchObject({ status: 'failed', reason });
    expect(paid(state, 0).serviceContracts).toBe(state.serviceContracts);
  });
  it('finds queue departures, detects missing guests and retains paid rows despite missing actors', () => {
    let state = paid(arrive(accept()), 0);
    const second = state.queue[0].members[1];
    state = { ...state, queue: [], queueDepartures: [{ ...second, departureReason: 'closed' }] };
    expect(settleServiceContracts(state, 36910).serviceContracts.active.guests[1].reason).toBe('closed');
    state = settleServiceContracts({ ...state, queueDepartures: [] }, 36910);
    expect(state.serviceContracts.active.guests[0].status).toBe('fulfilled_paid');
    expect(state.serviceContracts.active.guests[1].reason).toBe('missing_guest');
  });
  it('withdraws without touching guests or money; bounds results and contract notifications', () => {
    let state = createInitialState();
    state.notifications = [{ id: 'other', message: 'Keep me' }];
    for (let i = 0; i < 12; i++) {
      state = accept(at(state, 36000 + i * 86400));
      const active = state.serviceContracts.active;
      const before = state;
      state = withdrawServiceContract(state, { instanceId: active.instanceId });
      expect(state.restaurant).toBe(before.restaurant);
      expect(state.queue).toBe(before.queue);
      expect(withdrawServiceContract(state, { instanceId: active.instanceId })).toBe(state);
    }
    expect(state.serviceContracts.results).toHaveLength(10);
    expect(state.serviceContracts.results[0].instanceId).toBe('sc-3');
    expect(state.serviceContracts.results.at(-1).guestResults.every(g => g.status === 'withdrawn')).toBe(true);
    expect(state.notifications.filter(n => n.id.startsWith('service-contract-result:')).map(n => n.id))
      .toEqual(['service-contract-result:sc-12']);
    expect(state.notifications[0].id).toBe('other');
    expect(state.notifications.filter(n => n.id.startsWith('daily-summary-'))).toHaveLength(11);
    expect(state.notifications.at(-1).time).toBe(state.restaurant.gameTime);
    expect(state.serviceContracts.lastAcceptedDayByTemplate).toEqual({ 'office-lunch': 12 });
  });
  it('freezes every mutation behind a pending career decision without importing career', () => {
    const state = { ...arrive(accept()), careerRun: { needsDecision: true }, paidVisitSequence: 1 };
    expect(advanceServiceContractArrivals(state, 37620, { admitParty })).toBe(state);
    expect(recordServiceContractPaidVisit(state, outcome(state, 0))).toBe(state);
    expect(settleServiceContracts(state, 40500)).toBe(state);
    expect(withdrawServiceContract(state, { instanceId: 'sc-1' })).toBe(state);
  });
  it('does not use a stale withdrawal to bypass guarded settlement of an expired paused save', () => {
    const state = { ...at(accept(), 41000), paused: true };
    expect(withdrawServiceContract(state, { instanceId: 'sc-1' })).toBe(state);
  });
  it('leaves exact-deadline endpoint settlement until after synchronous checkout', () => {
    let state = arrive(accept());
    state = paid(paid(state, 0), 1);
    state = arrive(state, 1);
    state = paid(state, 2);
    state = at(state, 40500);
    state = advanceServiceContractArrivals(state, 40500, { admitParty });
    expect(state.serviceContracts.active).not.toBe(null);
    state = paid(state, 3);
    state = settleServiceContracts(state, 40500);
    expect(state.serviceContracts.results[0]).toMatchObject({ status: 'succeeded', bonusPaid: 90 });
  });
  it('adds a midnight bonus to the new day after ordinary payroll, even with negative funds', () => {
    let state = arrive(accept(at(createInitialState(), 81900)));
    state = paid(paid(state, 0), 1);
    state = arrive(state, 1);
    state = paid(paid(state, 2), 3);
    state = at(state, 86400);
    expect(state.restaurant.funds).toBe(-170);
    state = settleServiceContracts(state, 86400);
    expect(state.restaurant).toMatchObject({ day: 2, funds: -80, dailyRevenue: 90 });
    expect(state.dailyHistory).toEqual([{ day: 1, revenue: 0, payroll: 770, profit: -770 }]);
  });
});

describe('strict save branch validation', () => {
  it.each(['acceptance', 'identity-conflict miss'])('preserves a valid unrelated ID collision after %s', phase => {
    const customer = { id: 'sc-1-g1', partyId: 'ordinary-party' };
    const before = { ...createInitialState(), customers: [customer] };
    expect(() => validateSavedState(before)).not.toThrow();
    expect(() => validateServiceContractsState(createServiceContractsState(), before)).not.toThrow();
    let state = accept(before);
    if (phase === 'identity-conflict miss') {
      state = at(state, 36900);
      const inject = vi.fn(s => ({ state: s, admitted: false, reason: 'identity_conflict' }));
      state = advanceServiceContractArrivals(state, 36900, { admitParty: inject });
      expect(state.serviceContracts.active.guests.slice(0, 2).map(g => [g.status, g.reason]))
        .toEqual([['missed', 'missed_identity_conflict'], ['missed', 'missed_identity_conflict']]);
      expect(advanceServiceContractArrivals(state, 36900, { admitParty: inject })).toBe(state);
      expect(inject).toHaveBeenCalledTimes(1);
    }
    expect(() => validateServiceContractsState(state.serviceContracts, state)).not.toThrow();
    expect(state.customers).toBe(before.customers);
    expect(state.customers[0]).toBe(customer);
    expect(customer).toEqual({ id: 'sc-1-g1', partyId: 'ordinary-party' });
  });
  it.each([
    { serviceContractId: 'sc-1', serviceContractGuestId: 'sc-1-g1' },
    { serviceContractId: 'sc-1', serviceContractGuestId: 'wrong-guest' },
    { serviceContractGuestId: 'sc-1-g1' },
    { id: 'foreign-id', serviceContractGuestId: 'sc-1-g1' },
  ])('does not treat contradictory tagged ownership as an unrelated collision: %j', tags => {
    const state = accept({ ...createInitialState(), customers: [{ id: 'sc-1-g1', partyId: 'ordinary-party', ...tags }] });
    expect(() => validateServiceContractsState(state.serviceContracts, state)).toThrow(/service contract/i);
  });
  it.each([
    { serviceContractId: null, serviceContractGuestId: null },
    { serviceContractId: 'sc-9' }, { serviceContractGuestId: 'sc-1-g2' },
    { spendingBudget: 99 }, { archetype: 'regular' }, { paidVisitSequence: 999 },
  ])('still rejects an admitted guest with corrupted identity, profile or payment marker: %j', changes => {
    const state = paid(arrive(accept()), 0);
    const queue = state.queue.map(party => ({ ...party,
      members: party.members.map((member, i) => i === 0 ? { ...member, ...changes } : member) }));
    expect(() => validateServiceContractsState(state.serviceContracts, { ...state, queue })).toThrow(/service contract/i);
  });
  it('still rejects duplicate live admitted guest IDs', () => {
    const state = arrive(accept());
    const customers = [{ ...state.queue[0].members[0] }];
    expect(() => validateServiceContractsState(state.serviceContracts, { ...state, customers })).toThrow(/duplicate live guest/);
  });
  it('accepts absence and valid snapshots at every lifecycle stage without hydrating progress', () => {
    expect(() => validateServiceContractsState(undefined, createInitialState())).not.toThrow();
    expect(hydrateServiceContractsState(undefined)).toEqual(createServiceContractsState());
    let state = accept();
    for (const transition of [s => s, arrive, s => paid(s, 0), s => settleServiceContracts(at(s, 40500), 40500)]) {
      state = transition(state);
      expect(() => validateServiceContractsState(state.serviceContracts, state)).not.toThrow();
      expect(hydrateServiceContractsState(state.serviceContracts)).toEqual(state.serviceContracts);
    }
  });
  it.each([
    s => { s.version = 2; }, s => { s.nextInstanceSerial = 1; },
    s => { s.lastAcceptedDayByTemplate.fake = 1; }, s => { s.lastAcceptedDayByTemplate['office-lunch'] = 2; },
    s => { s.active.templateId = 'fake'; }, s => { s.active.rulesVersion = 2; },
    s => { s.active.target = 1; }, s => { s.active.reward = 999; },
    s => { s.active.deadlineAt++; }, s => { s.active.serviceStartAt++; },
    s => { s.active.acceptedAt = Infinity; }, s => { s.active.acceptedDay = 2; },
    s => { s.active.phase = 'won'; }, s => { s.active.guests.push({ ...s.active.guests[0] }); },
    s => { s.active.guests[0].gender = 'male'; }, s => { s.active.guests[0].spendingBudget = 100; },
    s => { s.active.guests[0].guestId = s.active.guests[1].guestId; },
    s => { s.active.parties[0].arrivalOffset = 1; }, s => { s.active.parties[0].guestIds = ['other']; },
    s => { s.active.parties[0].status = 'admitted'; },
    s => { s.active.guests[0].status = 'fulfilled_paid'; },
  ])('rejects corrupted active field %#', corrupt => {
    const state = accept();
    const branch = structuredClone(state.serviceContracts);
    corrupt(branch);
    expect(() => validateServiceContractsState(branch, state)).toThrow(/service contract/i);
  });
  it('rejects contradictory paid sequences, live identities, result counts and bonuses', () => {
    let state = paid(paid(arrive(accept()), 0), 1);
    const duplicate = structuredClone(state.serviceContracts);
    duplicate.active.guests[1].paidVisitSequence = 1;
    expect(() => validateServiceContractsState(duplicate, state)).toThrow();
    expect(() => validateServiceContractsState(state.serviceContracts, { ...state, paidVisitSequence: 1 })).toThrow();
    const badActors = { ...state, queue: state.queue.map(p => ({ ...p, members: p.members.map(m => ({ ...m, spendingBudget: 999 })) })) };
    expect(() => validateServiceContractsState(state.serviceContracts, badActors)).toThrow();
    state = settleServiceContracts(at(state, 40500), 40500);
    for (const change of [{ fulfilledCount: 4 }, { bonusPaid: 90 }, { status: 'succeeded' }, { settledAt: 36900 }]) {
      const branch = structuredClone(state.serviceContracts);
      Object.assign(branch.results[0], change);
      expect(() => validateServiceContractsState(branch, state)).toThrow();
    }
  });
  it('requires a matching live checkout marker for a paid ledger row', () => {
    const state = paid(arrive(accept()), 0);
    const queue = state.queue.map(p => ({ ...p, members: p.members.map(m => ({ ...m, paidVisitSequence: undefined })) }));
    expect(() => validateServiceContractsState(state.serviceContracts, { ...state, queue })).toThrow();
  });
  it('rejects raw queued member identity conflicts before normalisation can hide them', () => {
    const state = arrive(accept());
    const queue = state.queue.map(p => ({ ...p, members: p.members.map(m => ({ ...m, partyId: 'foreign' })) }));
    expect(() => validateServiceContractsState(state.serviceContracts, { ...state, queue })).toThrow();
  });
  it('rejects repeated daily attempts and inconsistent active day markers', () => {
    let state = withdrawServiceContract(accept(), { instanceId: 'sc-1' });
    const branch = structuredClone(state.serviceContracts);
    branch.nextInstanceSerial = 3;
    const duplicate = { ...structuredClone(branch.results[0]), instanceId: 'sc-2',
      guestResults: branch.results[0].guestResults.map(row => ({ ...row,
        guestId: row.guestId.replace('sc-1', 'sc-2'), partyId: row.partyId.replace('sc-1', 'sc-2') })) };
    branch.results.push(duplicate);
    expect(() => validateServiceContractsState(branch, state)).toThrow();
    state = accept(state, 'family-service');
    const wrongDay = structuredClone(state.serviceContracts);
    wrongDay.lastAcceptedDayByTemplate['family-service'] = 2;
    expect(() => validateServiceContractsState(wrongDay, { ...state, restaurant: { ...state.restaurant, day: 2 } })).toThrow();
  });
  it('rejects malformed branches and oversized, foreign or contradictory records', () => {
    const state = accept();
    for (const value of [null, [], {}, { ...createServiceContractsState(), results: Array(11).fill({}) }]) {
      expect(() => validateServiceContractsState(value, state)).toThrow();
    }
    const bad = structuredClone(state.serviceContracts);
    bad.active.extra = true;
    expect(() => hydrateServiceContractsState(bad)).toThrow();
    const futureTag = { ...state, customers: [{ id: 'old', serviceContractId: 'sc-2' }] };
    expect(() => validateServiceContractsState(state.serviceContracts, futureTag)).toThrow();
  });
  it('rejects a schedule whose finite numbers are too large to represent the required intervals', () => {
    const state = accept();
    const branch = structuredClone(state.serviceContracts);
    Object.assign(branch.active, { acceptedAt: 1e300, serviceStartAt: 1e300, deadlineAt: 1e300 });
    branch.active.parties.forEach(p => { p.arrivalAt = 1e300; });
    expect(() => validateServiceContractsState(branch, { ...state,
      restaurant: { ...state.restaurant, gameTime: 1e300 } })).toThrow();
  });
});
