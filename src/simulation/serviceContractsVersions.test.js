import { beforeEach, describe, expect, it } from 'vitest';
import { createCareerInitialState, createInitialState } from '../state/initialState';
import { hydrateState, loadState, saveState } from '../state/persistence';
import { validateSavedState } from '../state/saveValidation';
import { acceptServiceContract, getNextServiceContractBoundary, hydrateServiceContractsState,
  settleServiceContracts, validateServiceContractsState, withdrawServiceContract } from './serviceContracts';

beforeEach(() => localStorage.clear());

// Historical v1 save fixtures, built from literal old content rather than the
// current catalogue/acceptance helper. No service-success claim is made here.
function legacyState(templateId = 'office-lunch', rulesVersion = 1) {
  const state = createInitialState();
  const [partyType, size, offsets, archetype, spendingTier, spendingBudget, label, duration, target, reward] = {
    'office-lunch': ['couple', 2, [0, 720, 1440], 'rusher', 'value', 24, 'Office guest', 3600, 4, 90],
    'family-service': ['family', 4, [0, 1200], 'regular', 'budget', 18, 'Family guest', 4500, 6, 120],
    'tasting-service': ['solo', 1, [0, 600, 1200, 1800], 'foodie', 'premium', 45, 'Tasting guest', 4200, 3, 100],
  }[templateId];
  const guests = [];
  const parties = offsets.map((arrivalOffset, partyIndex) => {
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
  return { ...state, serviceContracts: { version: 1, nextInstanceSerial: 2,
    lastAcceptedDayByTemplate: { [templateId]: 1 }, results: [], active: {
      instanceId: 'sc-1', templateId, rulesVersion, acceptedDay: 1, acceptedAt: 36000,
      serviceStartAt: 36900, deadlineAt: 36900 + (rulesVersion === 1 ? duration
        : templateId === 'family-service' ? 6000 : 4200), phase: 'preparing', target, reward, parties, guests,
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

function roundTrip(state) {
  expect(() => validateSavedState(state)).not.toThrow();
  expect(saveState(state)).toBe(true);
  const saved = loadState();
  expect(saved).not.toBe(null);
  return hydrateState(saved, createInitialState());
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

  it('keeps unversioned historical results frozen while accepting and saving a new v3 attempt', () => {
    const raw = historicalResultState();
    const oldResult = JSON.stringify(raw.serviceContracts.results[0]);
    const loaded = roundTrip(raw);
    expect(JSON.stringify(loaded.serviceContracts.results[0])).toBe(oldResult);
    expect(loaded.serviceContracts.results[0]).not.toHaveProperty('rulesVersion');
    const accepted = acceptServiceContract(loaded, { templateId: 'family-service', rulesVersion: 1 });
    expect(accepted.serviceContracts.active).toMatchObject({ instanceId: 'sc-2', rulesVersion: 3, deadlineAt: 47400, depositPaid: 30 });
    const withdrawn = withdrawServiceContract(accepted, { instanceId: 'sc-2' });
    const mixed = roundTrip(withdrawn);
    expect(JSON.stringify(mixed.serviceContracts.results[0])).toBe(oldResult);
    expect(mixed.serviceContracts.results[1]).toMatchObject({ rulesVersion: 3, status: 'withdrawn' });
    expect(mixed.restaurant.funds).toBe(540);
  });

  it('pays a frozen v2 success in full once, then retains it beside v3 settlement evidence', () => {
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
    expect(mixed.serviceContracts.results[1]).toMatchObject({ rulesVersion: 3, compensationPaid: 90 });
    expect(mixed.restaurant.funds).toBe(600);
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

  it.each([0, 4, 999, null, '2', undefined])('strictly rejects an explicitly invalid rules revision %s', rulesVersion => {
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
  it('rejects missing active revisions and stripped v2 result revisions rather than guessing', () => {
    const active = legacyState();
    delete active.serviceContracts.active.rulesVersion;
    expect(() => validateServiceContractsState(active.serviceContracts, active)).toThrow();
    const current = acceptServiceContract(createInitialState(), { templateId: 'office-lunch' });
    const settled = settleServiceContracts({ ...current, restaurant: { ...current.restaurant, gameTime: 41100 } }, 41100, { entry: true });
    delete settled.serviceContracts.results[0].rulesVersion;
    expect(() => validateServiceContractsState(settled.serviceContracts, settled)).toThrow();
  });
});
