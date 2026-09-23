import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/initialState';
import { OPENING_WEEK_SCENARIO } from '../data/careerScenarios';
import * as career from './careerRun';
import * as contracts from './serviceContracts';
import * as movement from './movement';
import * as customers from './customers';
import * as revenue from './revenue';
import { runTick } from './gameLoop';
import { advanceFixedStep } from './fixedStep';

afterEach(() => vi.restoreAllMocks());
const DEADLINE = 640800;
function careerState(time) {
  const initial = createInitialState();
  return { ...initial, restaurant: { ...initial.restaurant, gameTime: time, day: Math.floor(time / 86400) + 1 },
    paidVisitSequence: 0, serviceContracts: contracts.createServiceContractsState(),
    careerRun: career.createCareerRun({ scenarioId: OPENING_WEEK_SCENARIO.id, runId: 'test-opening-week', startedAt: 36000 }),
    staff: [], tables: [], chairs: [], doors: [], cashierStations: [], kitchenStations: [], washStations: [], serviceTables: [] };
}
function contractAt(time) {
  return contracts.acceptServiceContract(careerState(time), { templateId: 'office-lunch' });
}

describe('real career and contract scheduling composition', () => {
  it.each([1, 2, 4])('stops fixed-step catch-up at speed %s with only the clipped movement budget', speed => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const move = vi.spyOn(movement, 'advanceCharacterMovementBatch');
    const state = { ...careerState(DEADLINE - 1), speed };
    const frame = advanceFixedStep({ state, previousState: state, accumulator: 0, elapsedSeconds: 0.25 }, runTick);
    expect(frame.state.restaurant.gameTime).toBe(DEADLINE);
    expect(frame.state.careerRun.needsDecision).toBe(true);
    expect(frame.state.queue).toHaveLength(0);
    expect(move.mock.calls.reduce((sum, args) => sum + args[2], 0)).toBeCloseTo(1 / 60);
  });
  it('reaches the career cutoff even when its remaining representable time is below the ordinary tick epsilon', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const state = careerState(DEADLINE - 1e-10);
    const after = runTick(state, { gameDt: 1, movementDt: 0 });
    expect(after.restaurant.gameTime).toBe(DEADLINE);
    expect(after.careerRun.needsDecision).toBe(true);
    expect(after.queue).toHaveLength(0);
  });
  it('clips game time and proportional movement at the career deadline and suppresses ambient arrivals', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const move = vi.spyOn(movement, 'advanceCharacterMovementBatch'); // call-through
    const spawn = vi.spyOn(customers, 'spawnCustomers');
    const result = runTick(careerState(DEADLINE - 100), { gameDt: 200, movementDt: 20 });
    expect(result.restaurant.gameTime).toBe(DEADLINE);
    expect(move.mock.calls.reduce((sum, args) => sum + args[2], 0)).toBeCloseTo(10);
    expect(spawn).not.toHaveBeenCalled();
    expect(result.careerRun).toMatchObject({ status: 'lost', needsDecision: true, paidMeals: 0 });
    expect(result.careerRun.result.evaluatedAt).toBe(DEADLINE);
    expect(result.queue).toHaveLength(0);
    expect(runTick(result, { gameDt: 5000, movementDt: 10 })).toBe(result);
  });
  it.each([1, 2, 4])('clips legacy numeric timing at speed %s without overtime', speed => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const result = runTick({ ...careerState(DEADLINE - 30), speed }, 1);
    expect(result.restaurant.gameTime).toBe(DEADLINE);
    expect(result.careerRun.needsDecision).toBe(true);
  });
  it('retains a booked arrival at cutoff and admits it once at unchanged time after Continue', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = runTick(contractAt(DEADLINE - 900), { gameDt: 2000, movementDt: 0 });
    expect(state.restaurant.gameTime).toBe(DEADLINE);
    expect(state.serviceContracts.active.parties[0]).toMatchObject({ status: 'scheduled', arrivalAt: DEADLINE });
    expect(state.queue).toHaveLength(0);
    expect(runTick(state, { gameDt: 10000, movementDt: 0 })).toBe(state);
    state = { ...state, careerRun: career.continueCareerAsSandbox(state.careerRun) };
    state = runTick(state, { gameDt: 0, movementDt: 0 });
    expect(state.restaurant.gameTime).toBe(DEADLINE);
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0].members.map(m => m.queuePatience)).toEqual([750, 750]);
    expect(state.serviceContracts.active.parties[0]).toMatchObject({ status: 'admitted', admittedAt: DEADLINE });
    expect(runTick(state, { gameDt: 0, movementDt: 0 }).queue).toHaveLength(1);
  });
  it.each(['closed', 'queue_full'])('tests %s at the retained wave’s actual Continue attempt', reason => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = contractAt(DEADLINE - 900);
    if (reason === 'closed') state = { ...state, restaurant: { ...state.restaurant, openHour: 11, closeHour: 12 } };
    else state.queue = Array.from({ length: 8 }, (_, i) => ({ partyId: `p${i}`, members: [{
      id: `c${i}`, partyId: `p${i}`, state: 'queued', partySize: 1, archetype: 'regular',
      patience: 9000, patienceMax: 9000, queuePatience: 9000, queuePatienceMax: 9000,
    }] }));
    state = runTick(state, { gameDt: 900, movementDt: 0 });
    expect(state.serviceContracts.active.parties[0].status).toBe('scheduled');
    state = { ...state, careerRun: career.continueCareerAsSandbox(state.careerRun) };
    state = runTick(state, { gameDt: 0, movementDt: 0 });
    expect(state.serviceContracts.active.parties[0]).toMatchObject({ status: 'missed', missedReason: `missed_${reason}` });
  });
  it('settles a contract at the shared deadline after revenue and before career evaluation', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const settle = vi.spyOn(contracts, 'settleServiceContracts');
    const evaluate = vi.spyOn(career, 'evaluateCareerRun');
    const payments = vi.spyOn(revenue, 'calculateRevenue');
    const state = runTick(contractAt(DEADLINE - 5100), { gameDt: 5600, movementDt: 0 });
    expect(state.restaurant.gameTime).toBe(DEADLINE);
    expect(state.serviceContracts.active).toBe(null);
    expect(state.serviceContracts.results[0]).toMatchObject({ settledAt: DEADLINE, status: 'failed', bonusPaid: 0 });
    expect(state.careerRun.result.evaluatedAt).toBe(DEADLINE);
    expect(payments.mock.invocationCallOrder.at(-1)).toBeLessThan(settle.mock.invocationCallOrder.at(-1));
    expect(settle.mock.invocationCallOrder.at(-1)).toBeLessThan(evaluate.mock.invocationCallOrder.at(-1));
  });
  it('exact-deadline load drains only existing receipts and due ledger results, without service or progression replay', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('No service on career load finalisation'); });
    const prepare = vi.spyOn(customers, 'prepareCustomersForMovement');
    const initial = contractAt(DEADLINE - 5100);
    const state = { ...initial, restaurant: { ...initial.restaurant, gameTime: DEADLINE },
      completedCustomers: [{ customerId: 'legacy-receipt', revenue: 17 }] };
    const after = runTick(state, { gameDt: 200, movementDt: 1 });
    expect(after.restaurant.gameTime).toBe(DEADLINE);
    expect(after.restaurant.funds).toBe(617);
    expect(after.completedCustomers).toEqual([]);
    expect(after.serviceContracts.results[0].fulfilledCount).toBe(0);
    expect(after.careerRun).toMatchObject({ status: 'lost', needsDecision: true, paidMeals: 0, lastPaidVisitSequence: 0 });
    expect(after.paidVisitSequence).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
    expect(after.customers).toBe(state.customers);
    expect(runTick(after, { gameDt: 1, movementDt: 0 })).toBe(after);
  });
  it('overdue career data becomes a non-scoring decision before contract repairs or receipt draining', () => {
    const initial = contractAt(DEADLINE - 5100);
    const state = { ...initial, restaurant: { ...initial.restaurant, gameTime: DEADLINE + 1 },
      completedCustomers: [{ customerId: 'legacy-receipt', revenue: 17 }] };
    const after = runTick(state, { gameDt: 100, movementDt: 0 });
    expect(after.restaurant).toBe(state.restaurant);
    expect(after.careerRun).toMatchObject({ status: 'invalid', needsDecision: true, result: null });
    expect(after.serviceContracts).toBe(state.serviceContracts);
    expect(after.completedCustomers).toBe(state.completedCustomers);
    expect(runTick(after, { gameDt: 100, movementDt: 0 })).toBe(after);
  });
  it.each([{ paused: true }, { navigationFault: { issues: [] } }])('Continue does not bypass %j at due entry', guard => {
    let state = careerState(DEADLINE);
    state.careerRun = career.continueCareerAsSandbox(career.evaluateCareerRun(state.careerRun, state.restaurant));
    state = { ...state, ...guard };
    expect(runTick(state, { gameDt: 1, movementDt: 0 })).toBe(state);
  });
});
