import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { createDishOrderSnapshot, getResolvedDish, normaliseCookbookState } from './cookbook';
import { createCareerRun } from './careerRun';
import { acceptServiceContract } from './serviceContracts';
import { commitPaidVisit } from './paidVisits';
import { calculateRevenue } from './revenue';

function fixture() {
  let state = createInitialState();
  state = { ...state, paidVisitSequence: 0, ...normaliseCookbookState(state, { legacy: true }) };
  state.careerRun = createCareerRun({ scenarioId: 'opening-week', runId: 'run-1', startedAt: 36000 });
  const snapshot = createDishOrderSnapshot(getResolvedDish(state, 'starter-toast'), { serviceItemId: 'service-item-1', orderedAt: 36000 });
  const customer = { id: 'c1', partyId: 'p1', state: 'checkout_processing', menuOutcome: 'ordered',
    foodOutcome: 'delivered', dishId: 'starter-toast', drinkId: null, dishPriceAtOrder: 12,
    drinkPriceAtOrder: null, orderSubtotal: 12, dishOrderSnapshot: snapshot,
    orderedServiceItemIds: ['service-item-1'], cancelledServiceItemIds: [] };
  state.customers = [customer];
  state.serviceItems = [{ id: 'service-item-1', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1',
    state: 'delivered', dishOrderSnapshot: { ...snapshot } }];
  return state;
}

const receipt = (customerId = 'c1', subtotal = 12, tip = 2) => ({ customerId, revenue: subtotal + tip, totalPaid: subtotal + tip, tip, reviewScore: 100 });
const commit = (state, payment = receipt()) => commitPaidVisit(state, { customer: { id: payment.customerId }, payment, paidAt: state.restaurant.gameTime });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe('atomic paid visit producer', () => {
  it('projects the exact canonical event, marks the authoritative customer and does not append/credit money itself', () => {
    const state = fixture();
    const { state: next, outcome } = commit(freeze(state));
    expect(outcome).toEqual({ schemaVersion: 1, sequence: 1, customerId: 'c1', partyId: 'p1', paidAt: 36000,
      menuOutcome: 'ordered', foodOutcome: 'delivered', serviceContractId: null, serviceContractGuestId: null,
      dish: { serviceItemId: 'service-item-1', menuItemId: 'starter-toast', cookbookId: 'toast',
        priceAtOrder: 12, chargedAmount: 12, fulfilled: true, paid: true }, subtotal: 12, tip: 2, totalPaid: 14 });
    expect(next.customers[0].paidVisitSequence).toBe(1);
    expect(next.paidVisitSequence).toBe(1);
    expect(next.cookbook.entries.toast.paidPortions).toBe(1);
    expect(next.careerRun.paidMeals).toBe(1);
    expect(next.completedCustomers).toEqual([]);
    expect(next.restaurant).toBe(state.restaurant);
  });

  it('fans the same sequence and qualifying dish facts out to all three real consumers', () => {
    let state = acceptServiceContract(fixture(), { templateId: 'office-lunch' });
    const active = state.serviceContracts.active;
    const row = active.guests[0];
    state = { ...state, restaurant: { ...state.restaurant, gameTime: 36900 },
      serviceContracts: { ...state.serviceContracts, active: { ...active,
        guests: active.guests.map((guest, i) => i === 0 ? { ...guest, status: 'pending' } : guest),
        parties: active.parties.map((party, i) => i === 0 ? { ...party, status: 'admitted', admittedAt: 36900 } : party) } },
      customers: [{ ...state.customers[0], id: row.guestId, partyId: row.partyId,
        serviceContractId: active.instanceId, serviceContractGuestId: row.guestId }],
      serviceItems: state.serviceItems.map(item => ({ ...item, customerId: row.guestId })) };
    const { state: next, outcome } = commit(state, receipt(row.guestId));
    expect(outcome.serviceContractId).toBe('sc-1');
    expect(next.serviceContracts.active.guests[0]).toMatchObject({ status: 'fulfilled_paid', paidVisitSequence: 1 });
    expect(next.cookbook.lastAppliedPaidVisitSequence).toBe(1);
    expect(next.cookbook.entries.toast.paidPortions).toBe(1);
    expect(next.careerRun).toMatchObject({ paidMeals: 1, lastPaidVisitSequence: 1 });
  });

  it('starterCookbookProgress: three then fifteen distinct commits discover and ready toast without historical receipts', () => {
    let state = fixture();
    for (let i = 1; i <= 15; i += 1) {
      state = { ...state, customers: [{ ...state.customers[0], paidVisitSequence: null }] };
      state = commit(state).state;
      if (i === 2) expect(state.cookbook.entries['cheese-toast'].discovered).toBe(false);
      if (i === 3) expect(state.cookbook.entries['cheese-toast'].discovered).toBe(true);
    }
    expect(state.cookbook.entries.toast.paidPortions).toBe(15);
    expect(state.careerRun.paidMeals).toBe(15);
    expect(state.restaurant.funds).toBe(600);
    expect(state.recipeSlots).toBe(1);
  });

  it('uses live markers rather than a stale argument and keeps idempotency after revenue drain/serialisation', () => {
    const before = fixture();
    const paid = commit(before).state;
    const drained = calculateRevenue({ ...paid, completedCustomers: [receipt()] });
    const restored = JSON.parse(JSON.stringify(drained));
    const result = commitPaidVisit(restored, { customer: before.customers[0], payment: receipt(), paidAt: 36000 });
    expect(result).toEqual({ state: restored, outcome: null });
    expect(result.state).toBe(restored);
    expect(result.state.cookbook.entries.toast.paidPortions).toBe(1);
    // A genuinely new, unmarked live visit may reuse an old textual customer ID.
    const replacement = { ...restored, customers: [{ ...before.customers[0] }] };
    expect(commit(replacement).outcome.sequence).toBe(2);
  });

  it('keeps legacy pending receipts monetary-only without sequence or feature replay', () => {
    const state = { ...fixture(), completedCustomers: [receipt()] };
    expect(commit(state)).toEqual({ state, outcome: null });
    expect(calculateRevenue(state).cookbook.entries.toast.paidPortions).toBe(0);
  });

  it('retains valid credit after menu removal and physical plate cleanup', () => {
    const state = { ...fixture(), dishes: [], serviceItems: [] };
    expect(commit(state).state.cookbook.entries.toast.paidPortions).toBe(1);
  });

  it('cancelled food retains identity but the paid drink cannot charge or fulfil the historical food line', () => {
    const state = fixture();
    Object.assign(state.customers[0], { foodOutcome: 'cancelled', dishId: null, dishPriceAtOrder: null,
      drinkId: 'water', drinkPriceAtOrder: 5, orderSubtotal: 5, cancelledServiceItemIds: ['service-item-1'] });
    state.serviceItems = [];
    const { state: next, outcome } = commit(state, receipt('c1', 5, 1));
    expect(outcome).toMatchObject({ foodOutcome: 'cancelled', subtotal: 5, tip: 1, totalPaid: 6,
      dish: { cookbookId: 'toast', priceAtOrder: 12, chargedAmount: 0, fulfilled: false, paid: false } });
    expect(next.cookbook.entries.toast.paidPortions).toBe(0);
    expect(next.careerRun.paidMeals).toBe(0);
    expect(next.cookbook.lastAppliedPaidVisitSequence).toBe(1);
  });

  it('projects drink-only none, custom paid food, and conservative unknown legacy food', () => {
    const drink = fixture();
    delete drink.customers[0].dishOrderSnapshot;
    Object.assign(drink.customers[0], { foodOutcome: null, dishId: null, dishPriceAtOrder: null,
      drinkId: 'water', drinkPriceAtOrder: 5, orderSubtotal: 5 });
    drink.serviceItems = [];
    expect(commit(drink, receipt('c1', 5, 1)).outcome).toMatchObject({ foodOutcome: 'none', dish: null });
    const custom = fixture();
    custom.customers[0].dishOrderSnapshot.cookbookId = null;
    custom.serviceItems = [];
    expect(commit(custom).state.cookbook.entries.toast.paidPortions).toBe(0);
    expect(commit(custom).state.careerRun.paidMeals).toBe(1);
    const legacy = fixture();
    delete legacy.customers[0].dishOrderSnapshot;
    delete legacy.serviceItems[0].dishOrderSnapshot;
    const result = commit(legacy);
    expect(result.outcome).toMatchObject({ foodOutcome: 'unknown', dish: { cookbookId: null, fulfilled: false, paid: false } });
    expect(result.state.careerRun.paidMeals).toBe(0);
  });

  it('projects a null live food outcome conservatively even when a complete order snapshot exists', () => {
    const state = fixture();
    state.customers[0].foodOutcome = null;
    const result = commit(state);
    expect(result.outcome).toMatchObject({ foodOutcome: 'unknown', dish: { fulfilled: false, paid: false, chargedAmount: 12 } });
    expect(result.state.cookbook.entries.toast.paidPortions).toBe(0);
    expect(result.state.careerRun.paidMeals).toBe(0);
  });

  it.each([
    state => { state.customers[0].dishOrderSnapshot.prepTime = 1; },
    state => { state.serviceItems[0].dishOrderSnapshot.price = 99; },
    state => { state.serviceItems[0].customerId = 'wrong-owner'; },
    state => { state.customers[0].dishPriceAtOrder = 99; state.customers[0].orderSubtotal = 99; },
    state => { state.customers[0].orderSubtotal = 99; },
    state => { state.customers[0].cancelledServiceItemIds = ['service-item-1']; },
    state => { state.customers[0].orderedServiceItemIds = ['different-item']; },
    state => { state.customers[0].foodOutcome = 'fake'; },
    state => { state.customers[0].menuOutcome = 'unaffordable'; },
    state => { state.customers[0].serviceContractId = ''; },
    state => { state.customers[0].paidVisitSequence = 2; },
    state => { state.paidVisitSequence = -1; },
    state => { state.paidVisitSequence = null; },
  ])('diagnoses contradictory trusted facts before any feature change %#', corrupt => {
    const state = fixture();
    corrupt(state);
    const cookbook = JSON.stringify(state.cookbook);
    expect(() => commit(state)).toThrow(/paid visit/i);
    expect(JSON.stringify(state.cookbook)).toBe(cookbook);
    expect(state.careerRun.paidMeals).toBe(0);
  });

  it('fails closed with a diagnostic on sequence exhaustion, missing live owner or contradictory payment', () => {
    const state = fixture();
    expect(() => commit({ ...state, paidVisitSequence: Number.MAX_SAFE_INTEGER })).toThrow(/exhaust/i);
    expect(() => commit(state, receipt('missing'))).toThrow(/paid visit/i);
    expect(() => commit(state, { ...receipt(), totalPaid: 100 })).toThrow(/paid visit/i);
    expect(state.customers[0].paidVisitSequence).toBeUndefined();
  });

  it.each([{ dishId: 'another-dish' }, { drinkId: 'water' }])('rejects a contradictory receipt line identity %j before awards', changes => {
    const state = fixture();
    expect(() => commit(state, { ...receipt(), ...changes })).toThrow(/paid visit/i);
    expect(state.cookbook.entries.toast.paidPortions).toBe(0);
    expect(state.careerRun.paidMeals).toBe(0);
  });

  it('rejects malformed legacy enumerations rather than laundering them into an unknown paid event', () => {
    const state = fixture();
    delete state.customers[0].dishOrderSnapshot;
    delete state.serviceItems[0].dishOrderSnapshot;
    state.customers[0].foodOutcome = 'made-up';
    expect(() => commit(state)).toThrow(/paid visit/i);
    state.customers[0].foodOutcome = null;
    state.customers[0].menuOutcome = 'unaffordable';
    expect(() => commit(state)).toThrow(/paid visit/i);
  });

  it('does not commit while a career decision is pending', () => {
    const state = fixture();
    state.careerRun = { ...state.careerRun, needsDecision: true };
    expect(commit(state)).toEqual({ state, outcome: null });
  });

  it('commits without installing absent optional feature branches', () => {
    const state = fixture();
    delete state.cookbook;
    delete state.careerRun;
    delete state.serviceContracts;
    const result = commit(state);
    expect(result.state.paidVisitSequence).toBe(1);
    expect(result.state).not.toHaveProperty('cookbook');
    expect(result.state).not.toHaveProperty('careerRun');
    expect(result.state).not.toHaveProperty('serviceContracts');
  });
});
