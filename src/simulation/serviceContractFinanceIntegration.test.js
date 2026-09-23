import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { hydrateState, loadState, saveState } from '../state/persistence';
import { validateSavedState } from '../state/saveValidation';
import { advanceClock } from './clock';
import { runTick } from './gameLoop';
import { acceptServiceContract, settleServiceContracts, withdrawServiceContract } from './serviceContracts';

beforeEach(() => localStorage.clear());
function initial() {
  const state = createInitialState();
  state.restaurant.reputation = 3;
  return state;
}
function reload(state) {
  expect(() => validateSavedState(state)).not.toThrow();
  expect(saveState(state)).toBe(true);
  return hydrateState(loadState(), createInitialState());
}
const accept = state => acceptServiceContract(state, { templateId: 'party-rush' });

describe('one-time contract cash flows', () => {
  it('credits an advance once, and charges refund plus compensation on immediate withdrawal', () => {
    const before = initial();
    const state = accept(before);
    expect(state.restaurant).toMatchObject({ funds: 645, dailyRevenue: 45, reputation: 3 });
    expect(before.restaurant.funds).toBe(600);
    expect(state.serviceContracts.active.depositPaid).toBe(45);
    expect(accept(state)).toBe(state);
    const loaded = reload(state);
    expect(loaded.restaurant.funds).toBe(645);
    const withdrawn = withdrawServiceContract(loaded, { instanceId: 'sc-1' });
    expect(withdrawn.restaurant).toMatchObject({ funds: 510, dailyRevenue: -90, reputation: 2.75 });
    expect(withdrawn.serviceContracts.results[0]).toMatchObject({ bonusPaid: 0, depositPaid: 45,
      depositRefunded: 45, compensationPaid: 90, reputationPenalty: 0.25 });
    expect(withdrawServiceContract(withdrawn, { instanceId: 'sc-1' })).toBe(withdrawn);
    expect(accept(withdrawn)).toBe(withdrawn);
    expect(reload(withdrawn).restaurant).toMatchObject({ funds: 510, reputation: 2.75 });
  });
  it('charges overdue failures once through actual save/load and repeated settlement', () => {
    const state = accept(initial());
    state.restaurant.gameTime = state.serviceContracts.active.deadlineAt;
    const saved = reload(state);
    expect(saved.restaurant.funds).toBe(645); // Ordinary saves settle on guarded tick entry.
    const loaded = runTick(saved, { gameDt: 0, movementDt: 0 });
    expect(loaded.restaurant).toMatchObject({ funds: 510, dailyRevenue: -90, reputation: 2.75 });
    expect(loaded.serviceContracts.results[0].status).toBe('failed');
    expect(settleServiceContracts(loaded, state.restaurant.gameTime)).toBe(loaded);
    expect(reload(loaded).restaurant).toMatchObject({ funds: 510, reputation: 2.75 });
  });
  it('allows debt and clamps only the reputation penalty', () => {
    const state = initial();
    state.restaurant.funds = -50;
    state.restaurant.reputation = 1.1;
    const accepted = accept(state);
    expect(accepted.restaurant.funds).toBe(-5);
    const result = withdrawServiceContract(accepted, { instanceId: 'sc-1' });
    expect(result.restaurant).toMatchObject({ funds: -140, reputation: 1 });
  });
  it('records cash on each side of midnight without double-counting the deposit', () => {
    const before = initial();
    before.staff = [];
    before.restaurant.gameTime = 86300;
    const accepted = accept(before);
    const atDeadline = advanceClock(accepted, accepted.serviceContracts.active.deadlineAt - 86300);
    const settled = settleServiceContracts(atDeadline, atDeadline.restaurant.gameTime, { entry: true });
    expect(settled.dailyHistory[0]).toMatchObject({ day: 1, revenue: 45, payroll: 0, profit: 45 });
    expect(settled.restaurant).toMatchObject({ day: 2, funds: 510, dailyRevenue: -135, reputation: 2.75 });
    expect(reload(settled).restaurant.funds).toBe(510);
  });
  it('round-trips all four daily attempt markers', () => {
    let state = initial();
    for (const templateId of ['office-lunch', 'family-service', 'tasting-service', 'party-rush']) {
      state = acceptServiceContract(state, { templateId });
      state = withdrawServiceContract(state, { instanceId: state.serviceContracts.active.instanceId });
    }
    expect(Object.keys(reload(state).serviceContracts.lastAcceptedDayByTemplate)).toHaveLength(4);
    expect(state.restaurant.funds).toBe(355);
  });
  it.each(['depositPaid', 'depositRefunded', 'compensationPaid', 'reputationPenalty'])('rejects tampered or omitted result %s', key => {
    const state = withdrawServiceContract(accept(initial()), { instanceId: 'sc-1' });
    state.serviceContracts.results[0][key] += 1;
    expect(() => validateSavedState(state)).toThrow();
    delete state.serviceContracts.results[0][key];
    expect(() => validateSavedState(state)).toThrow();
  });
  it('rejects an unpaid or omitted advance marker rather than crediting it on load', () => {
    const state = accept(initial());
    state.serviceContracts.active.depositPaid = 0;
    expect(() => validateSavedState(state)).toThrow();
    delete state.serviceContracts.active.depositPaid;
    expect(() => validateSavedState(state)).toThrow();
  });
});
