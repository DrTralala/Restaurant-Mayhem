import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCareerInitialState, createInitialState } from './initialState';
import { GameProvider, gameReducer, useDispatch, useGameGeneration, useGameState } from './GameContext';
import { evaluateCareerRun, normaliseCareerRun } from '../simulation/careerRun';
import { createDishOrderSnapshot, getResolvedDish, validateCookbookState } from '../simulation/cookbook';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const start = { type: 'START_CAREER', scenarioId: 'opening-week', runId: 'run-a', confirmedReplace: true };
function terminal() {
  const state = createCareerInitialState({ scenarioId: 'opening-week', runId: 'run-a' });
  return { ...state, restaurant: { ...state.restaurant, gameTime: 640800, day: 8 },
    careerRun: evaluateCareerRun(state.careerRun, { gameTime: 640800, reputation: 1 }) };
}

describe('shared feature defaults and actions', () => {
  it('initialises v10 sandbox branches and tagged starter atomically', () => {
    const state = createInitialState();
    expect(state).toMatchObject({ version: 10, paidVisitSequence: 0, careerRun: null,
      cookbook: { schemaVersion: 1, lastAppliedPaidVisitSequence: 0,
        entries: { toast: { discovered: true, paidPortions: 0, perk: null } } },
      serviceContracts: { version: 1, active: null, results: [] },
    });
    expect(state.dishes[0]).toMatchObject({ id: 'starter-toast', cookbookId: 'toast', prepTime: 60, popularity: 50 });
    expect(() => validateCookbookState(state)).not.toThrow();
  });
  it('creates a fresh career through the ordinary factory without copied checkpoints', () => {
    const one = createCareerInitialState({ scenarioId: 'opening-week', runId: 'one' });
    const two = createCareerInitialState({ scenarioId: 'opening-week', runId: 'two' });
    expect(one).toMatchObject({ paidVisitSequence: 0, paused: false, speed: 1,
      restaurant: { funds: 600, reputation: 1, gameTime: 36000 },
      careerRun: { runId: 'one', paidMeals: 0, deadlineAt: 640800 } });
    expect(one.tables).not.toBe(two.tables);
    expect(one.cookbook).not.toBe(two.cookbook);
  });
  it.each([{ confirmedReplace: false }, { confirmedReplace: undefined }, { scenarioId: 'unknown' },
    { runId: '' }, { runId: ' ' }])('rejects invalid START %j without replacement', override => {
    const state = createInitialState();
    expect(gameReducer(state, { ...start, ...override })).toBe(state);
  });
  it('starts only a fresh named attempt and rejects the same attempt identity', () => {
    const state = gameReducer(createInitialState(), start);
    expect(state.careerRun).toMatchObject({ runId: 'run-a', status: 'active' });
    expect(gameReducer(state, start)).toBe(state);
  });
  it('requires matching terminal identity and replacement confirmation for Retry', () => {
    const state = terminal();
    const retry = { type: 'RETRY_CAREER', expectedRunId: 'run-a', runId: 'run-b', confirmedReplace: true };
    for (const patch of [{ expectedRunId: 'stale' }, { confirmedReplace: false }, { runId: 'run-a' }]) {
      expect(gameReducer(state, { ...retry, ...patch })).toBe(state);
    }
    expect(gameReducer(state, retry)).toMatchObject({ restaurant: { gameTime: 36000, funds: 600 },
      careerRun: { runId: 'run-b', paidMeals: 0, status: 'active' } });
    expect(gameReducer(gameReducer(createInitialState(), start), retry).careerRun.runId).toBe('run-a');
  });
  it.each([undefined, 2])('does not retry an unsupported saved scenario revision %s', scenarioRevision => {
    const state = terminal();
    state.careerRun = { ...state.careerRun, scenarioRevision };
    expect(gameReducer(state, { type: 'RETRY_CAREER', expectedRunId: 'run-a', runId: 'new', confirmedReplace: true })).toBe(state);
  });
  it('Continue changes only the branch and preserves pause, speed and technical faults', () => {
    const state = { ...terminal(), paused: true, speed: 4, navigationFault: { issues: [] } };
    const action = { type: 'CONTINUE_CAREER_AS_SANDBOX', expectedRunId: 'run-a' };
    expect(gameReducer(state, { ...action, expectedRunId: 'stale' })).toBe(state);
    const next = gameReducer(state, action);
    expect(next).toEqual({ ...state, careerRun: { ...state.careerRun, status: 'continued', needsDecision: false } });
    expect(next.restaurant).toBe(state.restaurant);
    expect(next.navigationFault).toBe(state.navigationFault);
  });
  it.each(['TICK', 'TOGGLE_PAUSE', 'SET_SPEED', 'ADD_TABLE', 'ADD_DISH', 'UPDATE_DISH',
    'REMOVE_DISH', 'CHOOSE_DISH_MASTERY', 'ADD_COOKBOOK_DISH', 'ACCEPT_SERVICE_CONTRACT',
    'WITHDRAW_SERVICE_CONTRACT', 'HIRE_STAFF', 'FIRE_STAFF', 'MOVE_STAFF', 'PLACE_ITEM',
    'SELL_ITEMS', 'SET_OPERATING_HOURS', 'UNLOCK_DRINK', 'RENAME_STAFF'])('pending decision blocks %s', type => {
    const state = terminal();
    expect(gameReducer(state, { type, nextState: createInitialState(), speed: 4,
      id: 'starter-toast', changes: { price: 1 }, templateId: 'office-lunch', name: 'Changed' })).toBe(state);
  });
  it('invalid careers can Continue or Start, never Retry; explicit LOAD remains recovery', () => {
    const state = createInitialState();
    state.careerRun = normaliseCareerRun({}, { gameTime: 36000, paidVisitSequence: 0 }).run;
    expect(gameReducer(state, { type: 'RETRY_CAREER', expectedRunId: 'invalid-career', runId: 'x', confirmedReplace: true })).toBe(state);
    expect(gameReducer(state, { type: 'CONTINUE_CAREER_AS_SANDBOX', expectedRunId: 'invalid-career' }).careerRun.status).toBe('continued');
    const fresh = createInitialState();
    expect(gameReducer(state, { type: 'LOAD_STATE', state: fresh })).toBe(fresh);
    expect(gameReducer(state, start).careerRun.status).toBe('active');
  });
  it('routes authored price/quality/removal/mastery through the cookbook helper', () => {
    let state = createInitialState();
    state = gameReducer(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 15, prepTime: 1 } });
    expect(state.cookbook.entries.toast.menuSettings.price).toBe(15);
    expect(state.dishes[0].prepTime).toBe(60);
    state = gameReducer(state, { type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' });
    expect(state.cookbook.entries.toast.menuSettings.quality).toBe(2);
    expect(state.restaurant.funds).toBe(550);
    state = { ...state, cookbook: { ...state.cookbook, entries: { ...state.cookbook.entries,
      toast: { ...state.cookbook.entries.toast, paidPortions: 15 } } } };
    state = gameReducer(state, { type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'speed' });
    expect(getResolvedDish(state, 'starter-toast').prepTime).toBe(51);
    state = gameReducer(state, { type: 'REMOVE_DISH', id: 'starter-toast' });
    state = gameReducer(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' });
    expect(state.dishes[0]).toMatchObject({ price: 15, quality: 2, cookbookId: 'toast' });
  });
  it('keeps custom recipes free, unlimited and q1 while stripping authored metadata', () => {
    let state = createInitialState();
    for (let index = 0; index < 8; index += 1) state = gameReducer(state, { type: 'ADD_DISH', dish: {
      ...state.dishes[0], id: `custom-${index}`, cookbookId: 'toast', masteryPerk: 'speed', quality: 10,
    } });
    expect(state.dishes).toHaveLength(9);
    expect(state.dishes[8]).not.toHaveProperty('cookbookId');
    expect(state.dishes[8]).not.toHaveProperty('masteryPerk');
    expect(state.dishes[8].quality).toBe(1);
    expect(state.restaurant.funds).toBe(600);
    state = gameReducer(state, { type: 'UPDATE_DISH', id: 'custom-7', changes: {
      id: 'starter-toast', cookbookId: 'toast', masteryPerk: 'appeal', price: 17, quality: 10,
    } });
    expect(state.dishes[8]).toMatchObject({ id: 'custom-7', price: 17, quality: 1 });
    expect(state.dishes[8]).not.toHaveProperty('cookbookId');
  });
  it('rejects menu ID collisions with live dishes and retained snapshots', () => {
    const state = createInitialState();
    const add = id => ({ type: 'ADD_DISH', dish: { ...state.dishes[0], id } });
    expect(gameReducer(state, add('starter-toast'))).toBe(state);
    const snapshot = createDishOrderSnapshot({ ...state.dishes[0], id: 'old-menu', cookbookId: null, masteryPerk: null },
      { serviceItemId: 'old-item', orderedAt: 36000 });
    for (const key of ['customers', 'serviceItems']) {
      const reserved = { ...state, [key]: [{ dishOrderSnapshot: snapshot }] };
      expect(gameReducer(reserved, add('old-menu'))).toBe(reserved);
    }
  });
  it('reconciles discoveries on successful equipment changes', () => {
    const state = createInitialState();
    state.restaurant.funds = 100000;
    state.cookbook.entries.toast.paidPortions = 5;
    const next = gameReducer(state, { type: 'PLACE_ITEM', itemType: 'equipmentStation', equipmentId: 'eq2', x: 480, y: 120 });
    expect(next.equipment.find(e => e.id === 'eq2').owned).toBe(true);
    expect(Object.values(next.cookbook.entries).filter(e => e.discovered).length).toBeGreaterThan(1);
  });
  it('accepts and withdraws contracts using the exact flat actions', () => {
    const state = createInitialState();
    const next = gameReducer(state, { type: 'ACCEPT_SERVICE_CONTRACT', templateId: 'office-lunch' });
    expect(next.serviceContracts.active).not.toBeNull();
    const ended = gameReducer(next, { type: 'WITHDRAW_SERVICE_CONTRACT', instanceId: next.serviceContracts.active.instanceId });
    expect(ended.serviceContracts.active).toBeNull();
    expect(ended.serviceContracts.results[0].status).toBe('withdrawn');
  });
});

describe('career session generation', () => {
  it('increments only accepted START/RETRY or LOAD, never Continue or stale actions', () => {
    let current;
    function Harness() { current = { state: useGameState(), dispatch: useDispatch(), generation: useGameGeneration() }; return null; }
    render(<GameProvider><Harness /></GameProvider>);
    act(() => current.dispatch(start));
    expect(current.generation).toBe(1);
    act(() => current.dispatch(start));
    expect(current.generation).toBe(1);
    act(() => current.dispatch({ type: 'TICK', nextState: terminal() }));
    act(() => current.dispatch({ type: 'CONTINUE_CAREER_AS_SANDBOX', expectedRunId: 'run-a' }));
    expect(current.generation).toBe(1);
    act(() => current.dispatch({ type: 'LOAD_STATE', state: terminal() }));
    expect(current.generation).toBe(2);
    act(() => current.dispatch({ type: 'RETRY_CAREER', expectedRunId: 'run-a', runId: 'run-b', confirmedReplace: true }));
    expect(current.generation).toBe(3);
  });
  it('saves accepted career transitions immediately but not repeated progress renders', () => {
    let current;
    function Harness() { current = { state: useGameState(), dispatch: useDispatch() }; return null; }
    const save = vi.spyOn(localStorage, 'setItem');
    render(<GameProvider><Harness /></GameProvider>);
    act(() => current.dispatch(start));
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('restaurant-sim-save')).careerRun.status).toBe('active');
    act(() => current.dispatch({ type: 'SET_SPEED', speed: 2 }));
    expect(save).toHaveBeenCalledTimes(1);
    act(() => current.dispatch({ type: 'TICK', nextState: terminal() }));
    expect(save).toHaveBeenCalledTimes(2);
    act(() => current.dispatch({ type: 'CONTINUE_CAREER_AS_SANDBOX', expectedRunId: 'run-a' }));
    expect(save).toHaveBeenCalledTimes(3);
    expect(JSON.parse(localStorage.getItem('restaurant-sim-save')).careerRun.status).toBe('continued');
  });
  it('shows non-fault storage failure and quarantine feedback without discarding the result', () => {
    let current;
    function Harness() { current = { state: useGameState(), dispatch: useDispatch() }; return null; }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full'); });
    render(<GameProvider><Harness /></GameProvider>);
    act(() => current.dispatch(start));
    expect(screen.getByRole('status')).toHaveTextContent('Progress could not be saved');
    expect(current.state.careerRun.status).toBe('active');
    expect(current.state.navigationFault).toBeUndefined();
    act(() => current.dispatch({ type: 'LOAD_STATE', state: { ...terminal(), navigationFault: { issues: [] } } }));
    expect(screen.getByRole('status')).toHaveTextContent(/saving is disabled/i);
    expect(current.state.careerRun.status).toBe('lost');
  });
});
