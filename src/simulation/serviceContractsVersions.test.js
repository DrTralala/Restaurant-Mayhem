import { beforeEach, describe, expect, it } from 'vitest';
import { createCareerInitialState, createInitialState } from '../state/initialState';
import { hydrateState, loadState, saveState } from '../state/persistence';
import { validateSavedState } from '../state/saveValidation';
import { getServiceContractTerms } from './serviceContractFinance';
import { acceptServiceContract, getNextServiceContractBoundary, hydrateServiceContractsState,
  advanceServiceContractArrivals, getServiceContractOffer, recordServiceContractPaidVisit,
  settleServiceContracts, validateServiceContractsState, withdrawServiceContract } from './serviceContracts';

beforeEach(() => localStorage.clear());

// Historical v1–v5 save fixtures, built from literal old content rather than the
// current catalogue/acceptance helper. No service-success claim is made here.
function legacyState(templateId = 'office-lunch', rulesVersion = 1) {
  const state = createInitialState();
  const [partyType, size, offsets, archetype, spendingTier, spendingBudget, label, duration, target, reward] = {
    'office-lunch': ['couple', 2, [0, 720, 1440], 'rusher', 'value', 24, 'Office guest', 3600, 4, 90],
    'family-service': ['family', 4, [0, 1200], 'regular', 'budget', 18, 'Family guest', 4500, 6, 120],
    'tasting-service': ['solo', 1, [0, 600, 1200, 1800], 'foodie', 'premium', 45, 'Tasting guest', 4200, 3, 100],
    'party-rush': ['couple', 2, [0, 0, 120, 120, 240, 240], 'regular', 'value', 30, 'Party guest', 6000, 6, 180],
  }[templateId];
  const guests = [];
  const isV5 = rulesVersion === 5;
  const currentOffsets = isV5 && templateId === 'party-rush' ? [0, 120, 240, 360, 480, 600] : offsets;
  const currentTarget = isV5 && templateId === 'family-service' ? 4 : target;
  const parties = currentOffsets.map((arrivalOffset, partyIndex) => {
    const partyId = `sc-1-p${partyIndex + 1}`;
    const guestIds = Array.from({ length: size }, () => {
      const index = guests.length;
      const guestId = `sc-1-g${index + 1}`;
      guests.push({ guestId, partyId, label: `${label} ${index + 1}`, archetype,
        gender: index % 2 ? 'male' : 'female', spendingTier, spendingBudget,
        status: 'scheduled', reason: null, paidVisitSequence: null, resolvedAt: null });
      return guestId;
    });
    return { partyId, partyType, size, arrivalOffset, arrivalAt: 36900 + arrivalOffset, guestIds,
      status: 'scheduled', admittedAt: null, missedReason: null };
  });
  const deposit = rulesVersion >= 3 ? reward / 4 : 0;
  const v2Duration = ['family-service', 'party-rush'].includes(templateId) ? 6000 : 4200;
  const serviceDuration = rulesVersion === 1 ? duration : rulesVersion >= 4 ? v2Duration * 1.25 : v2Duration;
  return { ...state, restaurant: { ...state.restaurant, funds: 600 + deposit, dailyRevenue: deposit },
    serviceContracts: { version: 1, nextInstanceSerial: 2,
    lastAcceptedDayByTemplate: { [templateId]: 1 }, results: [], active: {
      instanceId: 'sc-1', templateId, rulesVersion, acceptedDay: 1, acceptedAt: 36000,
      serviceStartAt: 36900, deadlineAt: 36900 + serviceDuration,
      phase: 'preparing', target: currentTarget, reward, parties, guests,
      ...(rulesVersion >= 3 ? { depositPaid: deposit } : {}),
    } } };
}

function historicalResultState() {
  const state = legacyState();
  const active = state.serviceContracts.active;
  const { instanceId, templateId, acceptedDay, acceptedAt, serviceStartAt, deadlineAt, target, reward } = active;
  return { ...state, restaurant: { ...state.restaurant, gameTime: 40500 },
    serviceContracts: { ...state.serviceContracts, active: null, results: [{
      instanceId, templateId, acceptedDay, acceptedAt, serviceStartAt, deadlineAt,
      settledAt: 40500, status: 'failed', target, reward, bonusPaid: 0, fulfilledCount: 0,
      guestResults: active.guests.map(guest => ({ guestId: guest.guestId, partyId: guest.partyId,
        status: 'missed', reason: 'missed_closed', paidVisitSequence: null,
        resolvedAt: active.parties.find(party => party.partyId === guest.partyId).arrivalAt })),
    }] } };
}

function legacyV5State(templateId = 'office-lunch') {
  const state = legacyState(templateId, 5);
  if (['office-lunch', 'tasting-service'].includes(templateId)) {
    state.serviceContracts.active.guests = state.serviceContracts.active.guests.map(guest => ({
      ...guest, patienceMultiplier: 1.5,
    }));
  }
  return state;
}

function roundTrip(state) {
  expect(() => validateSavedState(state)).not.toThrow();
  expect(saveState(state)).toBe(true);
  const saved = loadState();
  expect(saved).not.toBe(null);
  return hydrateState(saved, createInitialState());
}

function admitParty(state, booking) {
  return { admitted: true, reason: null, state: { ...state,
    queue: [...state.queue, { partyId: booking.partyId, serviceContractId: booking.instanceId,
      members: booking.members.map(member => ({ ...member, partyId: booking.partyId,
        serviceContractId: booking.instanceId, serviceContractArrivalAt: booking.arrivalAt,
        queuePatience: 750, state: 'queued' })) }] } };
}

function contractPaidFact(state, index, sequence) {
  const active = state.serviceContracts.active;
  const guest = active.guests[index];
  return { schemaVersion: 1, sequence, customerId: guest.guestId, partyId: guest.partyId,
    paidAt: state.restaurant.gameTime, menuOutcome: 'ordered', foodOutcome: 'delivered',
    serviceContractId: active.instanceId, serviceContractGuestId: guest.guestId,
    dish: { serviceItemId: `dish-${index}`, menuItemId: 'starter-toast', cookbookId: null,
      priceAtOrder: 12, chargedAmount: 12, fulfilled: true, paid: true },
    subtotal: 12, tip: 2, totalPaid: 14 };
}

function commitContractPaidFact(state, fact) {
  const mark = actor => actor.id === fact.customerId
    ? { ...actor, paidVisitSequence: fact.sequence } : actor;
  const withMarker = { ...state, queue: state.queue.map(party => ({ ...party,
    members: party.members.map(mark) })), customers: state.customers.map(mark),
  paidVisitSequence: fact.sequence };
  return recordServiceContractPaidVisit(withMarker, fact);
}

describe('service contract v1/v2 save compatibility', () => {
  it.each([['office-lunch', 40500], ['family-service', 41400], ['tasting-service', 41100]])(
    'preserves the original %s active snapshot and deadline through real save/load', (templateId, deadline) => {
      const raw = legacyState(templateId);
      const before = JSON.stringify(raw.serviceContracts);
      const loaded = roundTrip(raw);
      expect(JSON.stringify(loaded.serviceContracts)).toBe(before);
      expect(loaded.serviceContracts.active).toMatchObject({ rulesVersion: 1, deadlineAt: deadline });
      expect(loaded.restaurant.funds).toBe(600);
      expect(getNextServiceContractBoundary(loaded, deadline - 1, deadline)).toBe(deadline);
      const settled = settleServiceContracts({ ...loaded, restaurant: { ...loaded.restaurant, gameTime: deadline } }, deadline, { entry: true });
      expect(settled.serviceContracts.results[0]).toMatchObject({ rulesVersion: 1, deadlineAt: deadline, settledAt: deadline });
      expect(roundTrip(settled).serviceContracts).toEqual(settled.serviceContracts);
    });

  it('pays persisted qualifying v1 progress once at 40500, never extending it to 41100', () => {
    const raw = legacyState();
    raw.restaurant.gameTime = 38000;
    raw.paidVisitSequence = 4;
    raw.serviceContracts.active.phase = 'service';
    raw.serviceContracts.active.parties.slice(0, 2).forEach(party => {
      party.status = 'admitted'; party.admittedAt = party.arrivalAt;
    });
    raw.serviceContracts.active.guests.slice(0, 4).forEach((guest, index) => {
      guest.status = 'fulfilled_paid'; guest.paidVisitSequence = index + 1;
      guest.resolvedAt = raw.serviceContracts.active.parties[Math.floor(index / 2)].arrivalAt + 100;
    });
    const loaded = roundTrip(raw);
    expect(loaded.serviceContracts).toEqual(raw.serviceContracts);
    expect(settleServiceContracts(loaded, 40499.999).restaurant.funds).toBe(600);
    const atDeadline = { ...loaded, restaurant: { ...loaded.restaurant, gameTime: 40500 } };
    const settled = settleServiceContracts(atDeadline, 40500, { entry: true });
    expect(settled.restaurant.funds).toBe(690);
    expect(settled.serviceContracts.results[0]).toMatchObject({ rulesVersion: 1, status: 'succeeded',
      deadlineAt: 40500, settledAt: 40500, fulfilledCount: 4, bonusPaid: 90 });
    const reloaded = roundTrip(settled);
    expect(settleServiceContracts(reloaded, 41100)).toBe(reloaded);
    expect(reloaded.restaurant.funds).toBe(690);
    // Old releases stored this same frozen paid result without a revision.
    const historical = { ...settled, serviceContracts: { ...settled.serviceContracts,
      results: settled.serviceContracts.results.map(({ rulesVersion, ...result }) => result) } };
    const oldReloaded = roundTrip(historical);
    expect(oldReloaded.serviceContracts).toEqual(historical.serviceContracts);
    expect(oldReloaded.serviceContracts.results[0]).not.toHaveProperty('rulesVersion');
    expect(settleServiceContracts(oldReloaded, 41100)).toBe(oldReloaded);
    expect(oldReloaded.restaurant.funds).toBe(690);
  });

  it('keeps unversioned historical results frozen while accepting and saving a new v6 attempt', () => {
    const raw = historicalResultState();
    const oldResult = JSON.stringify(raw.serviceContracts.results[0]);
    const loaded = roundTrip(raw);
    expect(JSON.stringify(loaded.serviceContracts.results[0])).toBe(oldResult);
    expect(loaded.serviceContracts.results[0]).not.toHaveProperty('rulesVersion');
    const accepted = acceptServiceContract(loaded, { templateId: 'family-service', rulesVersion: 1 });
    expect(accepted.serviceContracts.active).toMatchObject({ instanceId: 'sc-2', rulesVersion: 6,
      deadlineAt: 48900, target: 4, reward: 120, depositPaid: 30 });
    const withdrawn = withdrawServiceContract(accepted, { instanceId: 'sc-2' });
    const mixed = roundTrip(withdrawn);
    expect(JSON.stringify(mixed.serviceContracts.results[0])).toBe(oldResult);
    expect(mixed.serviceContracts.results[1]).toMatchObject({ rulesVersion: 6, status: 'withdrawn',
      compensationPaid: 0, reputationPenalty: 0 });
    expect(mixed.restaurant.funds).toBe(600);
  });

  it('pays a frozen v2 success in full once, then retains it beside v6 settlement evidence', () => {
    const raw = legacyState('office-lunch', 2);
    raw.restaurant.gameTime = 38000;
    raw.paidVisitSequence = 4;
    raw.serviceContracts.active.phase = 'service';
    raw.serviceContracts.active.parties.slice(0, 2).forEach(party => {
      party.status = 'admitted'; party.admittedAt = party.arrivalAt;
    });
    raw.serviceContracts.active.guests.slice(0, 4).forEach((guest, index) => {
      guest.status = 'fulfilled_paid'; guest.paidVisitSequence = index + 1;
      guest.resolvedAt = index < 2 ? 37000 : 37720;
    });
    const loaded = roundTrip(raw);
    loaded.restaurant.gameTime = 41100;
    const settled = settleServiceContracts(loaded, 41100, { entry: true });
    expect(settled.restaurant.funds).toBe(690);
    expect(settled.serviceContracts.results[0]).toMatchObject({ rulesVersion: 2, bonusPaid: 90, status: 'succeeded' });
    expect(settled.serviceContracts.results[0]).not.toHaveProperty('depositPaid');
    const reloaded = roundTrip(settled);
    expect(settleServiceContracts(reloaded, 41100)).toBe(reloaded);
    const current = acceptServiceContract(reloaded, { templateId: 'party-rush' });
    const mixed = roundTrip(withdrawServiceContract(current, { instanceId: 'sc-2' }));
    expect(mixed.serviceContracts.results[0]).toEqual(settled.serviceContracts.results[0]);
    expect(mixed.serviceContracts.results[1]).toMatchObject({ rulesVersion: 6,
      compensationPaid: 0, reputationPenalty: 0 });
    expect(mixed.restaurant.funds).toBe(690);
  });

  it('finalises a saved v1 contract at the old shared career cutoff without granting the v2 extension', () => {
    const raw = createCareerInitialState({ scenarioId: 'opening-week', runId: 'legacy-cutoff' });
    raw.restaurant = { ...raw.restaurant, day: 8, gameTime: 640800 };
    raw.serviceContracts = legacyState().serviceContracts;
    const active = raw.serviceContracts.active;
    Object.assign(active, { acceptedDay: 8, acceptedAt: 636300, serviceStartAt: 637200, deadlineAt: 640800 });
    active.parties = active.parties.map(party => ({ ...party, arrivalAt: 637200 + party.arrivalOffset }));
    raw.serviceContracts.lastAcceptedDayByTemplate['office-lunch'] = 8;
    raw.completedCustomers = [{ customerId: 'legacy-receipt', revenue: 25 }];
    raw.paused = true;
    const loaded = roundTrip(raw);
    expect(loaded.serviceContracts.active).toBe(null);
    expect(loaded.serviceContracts.results[0]).toMatchObject({ rulesVersion: 1, deadlineAt: 640800, settledAt: 640800 });
    expect(loaded.careerRun).toMatchObject({ status: 'lost', paidMeals: 0, needsDecision: true });
    expect(loaded.restaurant).toMatchObject({ gameTime: 640800, funds: 625 });
    expect(loaded.paused).toBe(true);
    expect(roundTrip(loaded).restaurant.funds).toBe(625);
  });

  it.each([['office-lunch', 41100, 4, 90], ['family-service', 42900, 6, 120], ['tasting-service', 41100, 3, 100]])(
    'round-trips historical %s acceptance and explicit-v2 result without rewriting terms', (templateId, deadline, target, reward) => {
      const accepted = legacyState(templateId, 2);
      expect(accepted.serviceContracts.active).toMatchObject({ rulesVersion: 2, serviceStartAt: 36900,
        deadlineAt: deadline, target, reward });
      const loaded = roundTrip(accepted);
      expect(loaded.serviceContracts).toEqual(accepted.serviceContracts);
      const settled = settleServiceContracts({ ...loaded, restaurant: { ...loaded.restaurant, gameTime: deadline } }, deadline, { entry: true });
      expect(settled.serviceContracts.results[0]).toMatchObject({ rulesVersion: 2, deadlineAt: deadline });
      expect(settled.restaurant.funds).toBe(600);
      expect(settled.serviceContracts.results[0]).not.toHaveProperty('depositPaid');
      expect(withdrawServiceContract(loaded, { instanceId: 'sc-1' }).restaurant).toBe(loaded.restaurant);
      expect(roundTrip(settled).serviceContracts).toEqual(settled.serviceContracts);
    });

  it.each([0, 7, 999, null, '2', undefined])('strictly rejects an explicitly invalid rules revision %s', rulesVersion => {
    const active = legacyState();
    active.serviceContracts.active.rulesVersion = rulesVersion;
    expect(() => validateServiceContractsState(active.serviceContracts, active)).toThrow();
    expect(() => hydrateServiceContractsState(active.serviceContracts)).toThrow();
    const result = historicalResultState();
    result.serviceContracts.results[0].rulesVersion = rulesVersion;
    expect(() => validateServiceContractsState(result.serviceContracts, result)).toThrow();
    expect(() => hydrateServiceContractsState(result.serviceContracts)).toThrow();
  });

  it('does not infer v2 from a tampered unversioned historical result or relabelled active attempt', () => {
    const historical = historicalResultState();
    historical.restaurant.gameTime = 41100;
    Object.assign(historical.serviceContracts.results[0], { deadlineAt: 41100, settledAt: 41100 });
    expect(() => validateServiceContractsState(historical.serviceContracts, historical)).toThrow();
    const current = acceptServiceContract(createInitialState(), { templateId: 'office-lunch' });
    current.serviceContracts.active.rulesVersion = 1;
    expect(() => validateServiceContractsState(current.serviceContracts, current)).toThrow();
    const old = legacyState();
    old.serviceContracts.active.rulesVersion = 2;
    expect(() => validateServiceContractsState(old.serviceContracts, old)).toThrow();
  });
  it('rejects missing active revisions and stripped current result revisions rather than guessing', () => {
    const active = legacyState();
    delete active.serviceContracts.active.rulesVersion;
    expect(() => validateServiceContractsState(active.serviceContracts, active)).toThrow();
    const current = acceptServiceContract(createInitialState(), { templateId: 'office-lunch' });
    const deadline = current.serviceContracts.active.deadlineAt;
    const settled = settleServiceContracts({ ...current, restaurant: { ...current.restaurant, gameTime: deadline } }, deadline, { entry: true });
    delete settled.serviceContracts.results[0].rulesVersion;
    expect(() => validateServiceContractsState(settled.serviceContracts, settled)).toThrow();
  });
});

describe('service contract v3/v4/v5/v6 save compatibility', () => {
  const cases = [
    ['office-lunch', 41100, 42150, 22.5, 45, 22.5], ['family-service', 42900, 44400, 30, 60, 30],
    ['tasting-service', 41100, 42150, 25, 50, 25], ['party-rush', 42900, 44400, 45, 90, 45],
  ];
  it.each(cases)('keeps historical v3 %s deadlines and financial evidence through save/load',
    (templateId, oldDeadline, newDeadline, deposit, v3Compensation) => {
      const raw = legacyState(templateId, 3);
      const loaded = roundTrip(raw);
      expect(loaded.serviceContracts).toEqual(raw.serviceContracts);
      expect(loaded.serviceContracts.active).toMatchObject({ rulesVersion: 3, deadlineAt: oldDeadline, depositPaid: deposit });
      loaded.restaurant.gameTime = oldDeadline;
      const settled = settleServiceContracts(loaded, oldDeadline, { entry: true });
      expect(settled.serviceContracts.active).toBeNull();
      expect(settled.serviceContracts.results[0]).toMatchObject({ rulesVersion: 3, deadlineAt: oldDeadline,
        settledAt: oldDeadline, status: 'failed', depositPaid: deposit, depositRefunded: deposit,
        compensationPaid: v3Compensation, reputationPenalty: 0.25 });
      expect(settled.restaurant.funds).toBe(600 - v3Compensation);
      const reloaded = roundTrip(settled);
      expect(reloaded.serviceContracts).toEqual(settled.serviceContracts);
      expect(settleServiceContracts(reloaded, newDeadline)).toBe(reloaded);
    });

  it.each(cases)('keeps historical v4 %s terms through save/load',
    (templateId, _oldDeadline, newDeadline, deposit, v3Compensation) => {
      const raw = legacyState(templateId, 4);
      const loaded = roundTrip(raw);
      expect(loaded.serviceContracts.active).toMatchObject({ rulesVersion: 4,
        deadlineAt: newDeadline, depositPaid: deposit });
      loaded.restaurant.gameTime = newDeadline;
      const settled = settleServiceContracts(loaded, newDeadline, { entry: true });
      expect(settled.serviceContracts.results[0]).toMatchObject({ rulesVersion: 4, deadlineAt: newDeadline,
        depositPaid: deposit, depositRefunded: deposit, compensationPaid: v3Compensation,
        reputationPenalty: 0.25 });
      expect(settled.restaurant.funds).toBe(600 - v3Compensation);
      expect(roundTrip(settled).serviceContracts).toEqual(settled.serviceContracts);
    });

  it.each(cases)('settles new v6 %s only at the unchanged service deadline after save/load',
    (templateId, oldDeadline, newDeadline, deposit, _v3Compensation, v5Compensation) => {
      const accepted = acceptServiceContract(createInitialState(), { templateId });
      expect(accepted.serviceContracts.active).toMatchObject({ rulesVersion: 6, serviceStartAt: 36900,
        deadlineAt: newDeadline, depositPaid: deposit });
      expect(accepted.serviceContracts.active.target).toBe({
        'office-lunch': 2, 'family-service': 4, 'tasting-service': 2, 'party-rush': 3,
      }[templateId]);
      if (templateId === 'party-rush') expect(accepted.serviceContracts.active.parties.map(party => party.arrivalOffset))
        .toEqual([0, 120, 240, 360, 480, 600]);
      const loaded = roundTrip(accepted);
      expect(loaded.serviceContracts).toEqual(accepted.serviceContracts);
      loaded.restaurant.gameTime = oldDeadline;
      const stillActive = settleServiceContracts(loaded, oldDeadline, { entry: true });
      expect(stillActive.serviceContracts.active).not.toBeNull();
      expect(stillActive.serviceContracts.results).toEqual([]);
      expect(getNextServiceContractBoundary(stillActive, newDeadline - 1, newDeadline)).toBe(newDeadline);
      expect(settleServiceContracts(stillActive, newDeadline - 0.001).serviceContracts.active).not.toBeNull();
      stillActive.restaurant.gameTime = newDeadline;
      const settled = settleServiceContracts(stillActive, newDeadline, { entry: true });
      expect(settled.serviceContracts.results[0]).toMatchObject({ rulesVersion: 6, deadlineAt: newDeadline,
        settledAt: newDeadline, status: 'failed', depositPaid: deposit, depositRefunded: deposit,
        compensationPaid: v5Compensation, reputationPenalty: 0.25 });
      expect(settled.restaurant.funds).toBe(600 - v5Compensation);
      const reloaded = roundTrip(settled);
      expect(reloaded.serviceContracts).toEqual(settled.serviceContracts);
      expect(settleServiceContracts(reloaded, newDeadline + 1)).toBe(reloaded);
    });

  it('rejects relabelled v3/v4/v5 snapshots and missing or altered v6 financial evidence', () => {
    const historical = legacyState('party-rush', 3);
    historical.serviceContracts.active.rulesVersion = 4;
    expect(() => validateSavedState(historical)).toThrow();
    const current = acceptServiceContract(createInitialState(), { templateId: 'party-rush' });
    current.serviceContracts.active.rulesVersion = 3;
    expect(() => validateSavedState(current)).toThrow();
    current.serviceContracts.active.rulesVersion = 4;
    expect(() => validateSavedState(current)).toThrow();
    current.serviceContracts.active.rulesVersion = 5;
    expect(() => validateSavedState(current)).toThrow();
    current.serviceContracts.active.rulesVersion = 6;
    delete current.serviceContracts.active.depositPaid;
    expect(() => validateSavedState(current)).toThrow();
    current.serviceContracts.active.depositPaid = 45;
    const afterStart = { ...current, restaurant: { ...current.restaurant,
      gameTime: current.serviceContracts.active.serviceStartAt } };
    const withdrawn = withdrawServiceContract(afterStart, { instanceId: 'sc-1' });
    expect(() => validateSavedState(withdrawn)).not.toThrow();
    withdrawn.serviceContracts.results[0].compensationPaid = 0;
    expect(() => validateSavedState(withdrawn)).toThrow();
  });

  it('round-trips a v6 preparation withdrawal and derives its terms from settledAt', () => {
    const accepted = acceptServiceContract(createInitialState(), { templateId: 'party-rush' });
    accepted.serviceContracts.active.phase = 'service'; // stale phase; clock is still before serviceStartAt
    const withdrawn = withdrawServiceContract(accepted, { instanceId: 'sc-1' });
    expect(withdrawn.serviceContracts.results[0]).toMatchObject({ rulesVersion: 6, settledAt: 36000,
      depositRefunded: 45, compensationPaid: 0, reputationPenalty: 0 });
    expect(roundTrip(withdrawn).serviceContracts.results[0]).toEqual(withdrawn.serviceContracts.results[0]);
  });

  it('round-trips v5 active and result snapshots while new offers resolve from v6', () => {
    const historicalV5 = legacyV5State('office-lunch');
    const loadedV5 = roundTrip(historicalV5);
    expect(loadedV5.serviceContracts.active).toMatchObject({ rulesVersion: 5, target: 4,
      deadlineAt: 42150, depositPaid: 22.5 });
    expect(getServiceContractOffer(loadedV5, 'office-lunch')).toMatchObject({
      template: { target: 2, reward: 90 }, terms: getServiceContractTerms('office-lunch', 6),
    });

    const beforeService = { ...loadedV5, restaurant: { ...loadedV5.restaurant, gameTime: 36899.999 } };
    const withdrawnV5 = withdrawServiceContract(beforeService, { instanceId: 'sc-1' });
    const loadedResult = roundTrip(withdrawnV5);
    expect(loadedResult.serviceContracts.results[0]).toMatchObject({ rulesVersion: 5, status: 'withdrawn',
      settledAt: 36899.999, depositRefunded: 22.5, compensationPaid: 0, reputationPenalty: 0 });
    expect(getServiceContractOffer(loadedResult, 'office-lunch')).toMatchObject({
      template: { target: 2, reward: 90 }, terms: getServiceContractTerms('office-lunch', 6),
    });
    expect(roundTrip(loadedResult).serviceContracts.results[0])
      .toEqual(loadedResult.serviceContracts.results[0]);
  });

  it('saves and hydrates a v6 active snapshot, admits and pays once, then settles success once', () => {
    const accepted = acceptServiceContract(createInitialState(), { templateId: 'office-lunch' });
    expect(accepted.serviceContracts.active).toMatchObject({ rulesVersion: 6, target: 2, reward: 90,
      serviceStartAt: 36900, deadlineAt: 42150, depositPaid: 22.5 });
    const loaded = roundTrip(accepted);
    expect(loaded.serviceContracts).toEqual(accepted.serviceContracts);

    const arrivalAt = loaded.serviceContracts.active.parties[0].arrivalAt;
    const atArrival = { ...loaded, restaurant: { ...loaded.restaurant, gameTime: arrivalAt } };
    const arrived = advanceServiceContractArrivals(atArrival, arrivalAt, { admitParty });
    expect(arrived.queue).toHaveLength(1);
    expect(advanceServiceContractArrivals(arrived, arrivalAt, { admitParty })).toBe(arrived);

    const firstFact = contractPaidFact(arrived, 0, 1);
    const firstPaid = commitContractPaidFact(arrived, firstFact);
    const secondFact = contractPaidFact(firstPaid, 1, 2);
    const paid = commitContractPaidFact(firstPaid, secondFact);
    const loadedPaid = roundTrip(paid);
    expect(loadedPaid.serviceContracts.active.guests.slice(0, 2).map(guest => guest.status))
      .toEqual(['fulfilled_paid', 'fulfilled_paid']);
    expect(recordServiceContractPaidVisit(loadedPaid, firstFact)).toBe(loadedPaid);
    expect(advanceServiceContractArrivals(loadedPaid, arrivalAt, { admitParty })).toBe(loadedPaid);

    const deadline = loadedPaid.serviceContracts.active.deadlineAt;
    const atDeadline = { ...loadedPaid, restaurant: { ...loadedPaid.restaurant, gameTime: deadline } };
    const settled = settleServiceContracts(atDeadline, deadline, { entry: true });
    expect(settled.serviceContracts.results[0]).toMatchObject({ rulesVersion: 6, status: 'succeeded',
      target: 2, fulfilledCount: 2, bonusPaid: 90, depositPaid: 22.5, depositRefunded: 0,
      compensationPaid: 0, reputationPenalty: 0 });
    expect(settled.restaurant.funds).toBe(690);
    expect(settleServiceContracts(settled, deadline, { entry: true })).toBe(settled);
    expect(roundTrip(settled).serviceContracts).toEqual(settled.serviceContracts);
  });

  it('rejects v6 financial-evidence omissions and tampered offer snapshots on save/load', () => {
    const accepted = acceptServiceContract(createInitialState(), { templateId: 'party-rush' });
    const missingAdvance = structuredClone(accepted);
    delete missingAdvance.serviceContracts.active.depositPaid;
    expect(() => validateSavedState(missingAdvance)).toThrow();
    const alteredTarget = structuredClone(accepted);
    alteredTarget.serviceContracts.active.target++;
    expect(() => validateSavedState(alteredTarget)).toThrow();
    const alteredParty = structuredClone(accepted);
    alteredParty.serviceContracts.active.parties[0].arrivalAt++;
    expect(() => validateSavedState(alteredParty)).toThrow();

    const atStart = { ...accepted, restaurant: { ...accepted.restaurant,
      gameTime: accepted.serviceContracts.active.serviceStartAt } };
    const withdrawn = withdrawServiceContract(atStart, { instanceId: 'sc-1' });
    const missingEvidence = structuredClone(withdrawn);
    delete missingEvidence.serviceContracts.results[0].compensationPaid;
    expect(() => validateSavedState(missingEvidence)).toThrow();
    const alteredEvidence = structuredClone(withdrawn);
    alteredEvidence.serviceContracts.results[0].reputationPenalty = 0;
    expect(() => validateSavedState(alteredEvidence)).toThrow();
  });
});
