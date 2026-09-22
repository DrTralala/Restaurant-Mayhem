import { createInitialState, createCareerInitialState } from '../state/initialState';
import { gameReducer } from '../state/GameContext';
import { runTick } from './gameLoop';
import { hydrateState, saveState, loadState } from '../state/persistence';
import { validateSavedState } from '../state/saveValidation';

// Test-local randomness only; no production seed, actor injection, direct
// progress/reputation changes, movement shortcut or replacement service phase.
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function serviceTrace(state) {
  return {
    gameTime: state.restaurant.gameTime, funds: state.restaurant.funds, reputation: state.restaurant.reputation,
    served: state.restaurant.totalServed, sequence: state.paidVisitSequence, careerMeals: state.careerRun?.paidMeals,
    queue: state.queue.map(p => ({ partyId: p.partyId, members: p.members.map(m => ({
      id: m.id, patience: m.queuePatience, contract: m.serviceContractId,
    })) })),
    customers: state.customers.map(c => ({ id: c.id, partyId: c.partyId, state: c.state, x: c.x, y: c.y,
      foodOutcome: c.foodOutcome, foodDeadlineAt: c.foodDeadlineAt, paidVisitSequence: c.paidVisitSequence,
      menuOutcome: c.menuOutcome, dishId: c.dishId, dishPriceAtOrder: c.dishPriceAtOrder,
      drinkId: c.drinkId, drinkPriceAtOrder: c.drinkPriceAtOrder, orderSubtotal: c.orderSubtotal,
      foodCancelledAt: c.foodCancelledAt, orderedServiceItemIds: c.orderedServiceItemIds,
      cancelledServiceItemIds: c.cancelledServiceItemIds, consumedServiceItemIds: c.consumedServiceItemIds,
      dishOrderSnapshot: c.dishOrderSnapshot })),
    staff: state.staff.map(s => ({ id: s.id, x: s.x, y: s.y, morale: s.morale,
      task: s.task, duty: s.effectiveDuty, phase: s.dutyPhase })),
    serviceItems: state.serviceItems.map(i => ({ id: i.id, customerId: i.customerId, menuItemId: i.menuItemId, state: i.state,
      kind: i.kind, assignedStaffId: i.assignedStaffId, dishOrderSnapshot: i.dishOrderSnapshot })),
  };
}

function applyAction(state, action, actions) {
  const after = gameReducer(state, action);
  actions.push({ at: state.restaurant.gameTime, action, applied: after !== state,
    fundsBefore: state.restaurant.funds, fundsAfter: after.restaurant.funds });
  if (after === state) throw new Error(`Preparation action rejected: ${action.type}`);
  return after;
}

export function createServiceFixture({ mode = 'contract', templateId = 'office-lunch', seed = 1, strategy = 'starter', speed = 4 } = {}) {
  let state = mode === 'career'
    ? createCareerInitialState({ scenarioId: 'opening-week', runId: `real-week-${seed}` }) : createInitialState();
  const actions = [];
  state = applyAction(state, { type: 'SET_SPEED', speed }, actions);
  if (strategy === 'career-day-service') {
    state = applyAction(state, { type: 'SET_OPERATING_HOURS', openHour: 10, closeHour: 20 }, actions);
    state = applyAction(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 6 } }, actions);
    state = applyAction(state, { type: 'UPGRADE_EQUIPMENT', id: 'eq1' }, actions);
    const schedule = Array.from({ length: 48 }, (_, slot) => slot >= 18 && slot < 44 ? 'work' : 'pto');
    for (const worker of state.staff) state = applyAction(state, { type: 'SET_STAFF_SCHEDULE', id: worker.id, schedule }, actions);
  }
  if (strategy === 'closed') {
    // Open only 09:00–09:30; a contract accepted at 10:00 has no open arrivals.
    state = applyAction(state, { type: 'SET_OPERATING_HOURS', openHour: 9, closeHour: 9.5 }, actions);
    if (mode === 'career') {
      for (const worker of [...state.staff]) state = applyAction(state, { type: 'FIRE_STAFF', id: worker.id }, actions);
    }
  }
  if (mode === 'contract') state = applyAction(state, { type: 'ACCEPT_SERVICE_CONTRACT', templateId }, actions);
  return { state, actions };
}

export function runRealService({ mode = 'contract', templateId = 'office-lunch', seed = 1,
  strategy = 'starter', gameStep = 8, duration = null, maxWallMs = 120000, reloadAt = null,
  finishPaidAtDeadline = false, acceptAtCareerEnd = false } = {}) {
  let { state, actions } = createServiceFixture({ mode, templateId, seed, strategy, speed: gameStep / 2 });
  const startedAt = state.restaurant.gameTime;
  const deadlineAt = mode === 'career' ? state.careerRun.deadlineAt : state.serviceContracts.active.deadlineAt;
  const endAt = duration === null ? deadlineAt : Math.min(deadlineAt, startedAt + duration);
  const startedWall = performance.now();
  const paid = [];
  const seenSequences = new Set();
  const samples = [];
  let ticks = 0;
  let queuePeak = 0;
  let nextSample = startedAt;
  let reloaded = false;
  let reloadFacts = null;
  let boundaryPaymentStep = null;
  let lateBookingAccepted = false;
  let firstSnapshotMismatch = null;
  let status = 'completed';
  let diagnostic = null;
  while (state.restaurant.gameTime < endAt && !state.careerRun?.needsDecision) {
    if (performance.now() - startedWall > maxWallMs) { status = 'wall_budget'; break; }
    if (state.paused || state.navigationFault) { status = 'navigation_stop'; break; }
    const now = state.restaurant.gameTime;
    const nextAcceptance = mode === 'career' && acceptAtCareerEnd && !lateBookingAccepted ? deadlineAt - 900 : Infinity;
    if (now === nextAcceptance) {
      state = applyAction(state, { type: 'ACCEPT_SERVICE_CONTRACT', templateId: 'office-lunch' }, actions);
      lateBookingAccepted = true;
    }
    const nextReload = !reloaded && reloadAt !== null ? startedAt + reloadAt : Infinity;
    let gameDt = Math.min(gameStep, endAt - now, nextReload > now ? nextReload - now : gameStep,
      nextAcceptance > now ? nextAcceptance - now : gameStep);
    const active = state.serviceContracts.active;
    if (finishPaidAtDeadline && !boundaryPaymentStep && active
      && active.guests.filter(g => g.status === 'fulfilled_paid').length === active.target - 1) {
      const cashier = state.staff.find(worker => worker.task?.type === 'take_payment'
        && state.customers.some(customer => customer.id === worker.task.customerId
          && customer.serviceContractId === active.instanceId && customer.foodOutcome === 'delivered'
          && customer.dishPriceAtOrder > 0 && customer.state === 'checkout_processing'));
      if (cashier) {
        // Boundary test only: real prepared checkout, real remaining work and
        // real movement ratio in one authorised large final runTick. This is
        // not used in the native-fixed-step balance studies.
        gameDt = endAt - now;
        boundaryPaymentStep = { at: now, customerId: cashier.task.customerId, gameDt, movementDt: gameDt / 60 };
      }
    }
    try {
      const beforeTick = state;
      state = runTick(state, { gameDt, movementDt: gameDt / 60 });
      ticks++;
      if (!firstSnapshotMismatch) {
        const mismatch = state.customers.find(customer => customer.dishOrderSnapshot
          && customer.dishId !== customer.dishOrderSnapshot.menuItemId
          && !(customer.dishId == null && customer.foodOutcome === 'cancelled'));
        if (mismatch) firstSnapshotMismatch = { at: state.restaurant.gameTime, customerId: mismatch.id,
          before: serviceTrace(beforeTick).customers.find(customer => customer.id === mismatch.id),
          after: serviceTrace(state).customers.find(customer => customer.id === mismatch.id),
          beforeItems: serviceTrace(beforeTick).serviceItems.filter(item => item.customerId === mismatch.id),
          afterItems: serviceTrace(state).serviceItems.filter(item => item.customerId === mismatch.id) };
      }
      queuePeak = Math.max(queuePeak, state.queue.length);
      for (const customer of state.customers) {
        const sequence = customer.paidVisitSequence;
        if (!sequence || seenSequences.has(sequence)) continue;
        seenSequences.add(sequence);
        paid.push({ sequence, at: state.restaurant.gameTime, id: customer.id, contractId: customer.serviceContractId ?? null,
          foodOutcome: customer.foodOutcome, dishPrice: customer.dishPriceAtOrder,
          snapshot: Boolean(customer.dishOrderSnapshot) });
      }
      if (state.restaurant.gameTime >= nextSample) {
        samples.push({ at: state.restaurant.gameTime, meals: state.careerRun?.paidMeals ?? null,
          reputation: state.restaurant.reputation, funds: state.restaurant.funds,
          sequence: state.paidVisitSequence, queue: state.queue.length, customers: state.customers.length,
          morale: state.staff.map(s => Math.round(s.morale * 10) / 10) });
        nextSample += 3600;
      }
      if (!reloaded && state.restaurant.gameTime >= nextReload) {
        if (!saveState(state)) throw new Error('saveState refused the live state');
        const saved = loadState();
        if (!saved) throw new Error('loadState rejected the live save');
        validateSavedState(saved);
        const before = state;
        state = hydrateState(saved, createInitialState());
        if (!state) throw new Error('hydrateState returned no state');
        reloadFacts = { at: state.restaurant.gameTime, sequenceBefore: before.paidVisitSequence,
          sequenceAfter: state.paidVisitSequence, mealsBefore: before.careerRun?.paidMeals ?? null,
          mealsAfter: state.careerRun?.paidMeals ?? null,
          contractLedgerEqual: JSON.stringify(before.serviceContracts) === JSON.stringify(state.serviceContracts),
          cookbookEqual: JSON.stringify(before.cookbook) === JSON.stringify(state.cookbook) };
        reloaded = true;
      }
    } catch (error) {
      status = 'runtime_error';
      diagnostic = { message: error.message, stack: error.stack, at: state.restaurant.gameTime,
        nextGameDt: gameDt, trace: serviceTrace(state) };
      break;
    }
  }
  if (status === 'completed' && (state.paused || state.navigationFault)) status = 'navigation_stop';
  const result = state.serviceContracts.results.at(-1) || null;
  const breakdown = {};
  for (const guest of result?.guestResults || state.serviceContracts.active?.guests || []) {
    const key = guest.reason || guest.status;
    breakdown[key] = (breakdown[key] || 0) + 1;
  }
  const revenue = state.dailyHistory.reduce((sum, day) => sum + day.revenue, 0) + state.restaurant.dailyRevenue;
  return { state, report: {
    mode, templateId: mode === 'contract' ? templateId : null, seed, strategy, gameStep, movementRatio: 60,
    status, navigationFault: state.navigationFault ?? null, ticks, wallMs: Math.round(performance.now() - startedWall),
    startedAt, endAt, gameTime: state.restaurant.gameTime,
    contractStatus: result?.status ?? null, fulfilled: result?.fulfilledCount
      ?? state.serviceContracts.active?.guests.filter(g => g.status === 'fulfilled_paid').length ?? null,
    target: result?.target ?? state.serviceContracts.active?.target ?? null, bonus: result?.bonusPaid ?? 0, breakdown,
    careerStatus: state.careerRun?.status ?? null, careerMeals: state.careerRun?.paidMeals ?? null,
    reputation: state.restaurant.reputation, funds: state.restaurant.funds, sequence: state.paidVisitSequence,
    ordinaryRevenue: revenue - (result?.bonusPaid ?? 0), queuePeak, reloaded, reloadFacts, boundaryPaymentStep, actions, samples, paid,
    firstSnapshotMismatch, diagnostic,
  } };
}
