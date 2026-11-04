import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCareerInitialState, createInitialState } from './initialState';
import { SAVE_VERSION } from './saveVersion';
import { GameProvider, gameReducer, useDispatch, useGameGeneration, useGameState } from './GameContext';
import { evaluateCareerRun, normaliseCareerRun } from '../simulation/careerRun';
import { createDishOrderSnapshot, getCookbookEntryStatus, getResolvedDish,
  reconcileCookbookDiscoveries, validateCookbookState } from '../simulation/cookbook';
import { buildAffordableBaskets } from '../simulation/menuEconomy';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const start = { type: 'START_CAREER', scenarioId: 'opening-week', runId: 'run-a', confirmedReplace: true };
function terminal() {
  const state = createCareerInitialState({ scenarioId: 'opening-week', runId: 'run-a' });
  return { ...state, restaurant: { ...state.restaurant, gameTime: 640800, day: 8 },
    careerRun: evaluateCareerRun(state.careerRun, { gameTime: 640800, reputation: 1 }) };
}

describe('shared feature defaults and actions', () => {
  it('initialises v11 sandbox branches and tagged starter atomically', () => {
    const state = createInitialState();
    expect(state).toMatchObject({ version: SAVE_VERSION, paidVisitSequence: 0, careerRun: null,
      cookbook: { schemaVersion: 3, lastAppliedPaidVisitSequence: 0,
        entries: { toast: { discovered: true, owned: true, paidPortions: 0, perk: null } } },
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
  it.each(['TICK', 'TOGGLE_PAUSE', 'SET_SPEED', 'ADD_DISH', 'UPDATE_DISH',
    'REMOVE_DISH', 'CHOOSE_DISH_MASTERY', 'ADD_COOKBOOK_DISH', 'ACCEPT_SERVICE_CONTRACT',
    'BUY_COOKBOOK_RECIPE', 'WITHDRAW_SERVICE_CONTRACT', 'HIRE_STAFF', 'FIRE_STAFF', 'MOVE_STAFF', 'PLACE_ITEM',
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
  it('buys a discovered recipe once before separately adding it for free at the exact funds boundary', () => {
    let state = createInitialState();
    state.cookbook.entries.toast.paidPortions = 3;
    state.cookbook = reconcileCookbookDiscoveries(state);
    state.restaurant.funds = 75;

    expect(getCookbookEntryStatus(state, 'cheese-toast')).toMatchObject({
      discovered: true, owned: false, purchaseCost: 75, canAfford: true, canBuy: true, canAdd: false,
    });
    const bought = gameReducer(state, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'cheese-toast' });
    expect(bought.restaurant.funds).toBe(0);
    expect(bought.cookbook.entries['cheese-toast'].owned).toBe(true);
    expect(bought.dishes).toHaveLength(1);
    expect(gameReducer(bought, { type: 'BUY_COOKBOOK_RECIPE', cookbookId: 'cheese-toast' })).toBe(bought);

    const added = gameReducer(bought, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'cheese-toast' });
    expect(added.restaurant.funds).toBe(0);
    expect(added.dishes).toHaveLength(2);
    expect(gameReducer(added, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'cheese-toast' })).toBe(added);

    const withoutEquipment = { ...bought, equipment: bought.equipment.map(item =>
      item.id === 'eq1' ? { ...item, owned: false } : item) };
    expect(getCookbookEntryStatus(withoutEquipment, 'cheese-toast')).toMatchObject({
      owned: true, equipmentOwned: false, canAdd: false,
    });
    expect(gameReducer(withoutEquipment, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'cheese-toast' }))
      .toBe(withoutEquipment);
  });
  it('updates only the active dish name and retains it when that recipe is removed and re-added', () => {
    const initial = createInitialState();
    const renamed = gameReducer(initial, {
      type: 'UPDATE_DISH', id: 'starter-toast', changes: { name: '  House Toast  ' },
    });
    expect(renamed.dishes[0]).toMatchObject({ id: 'starter-toast', name: 'House Toast',
      cookbookId: 'toast', base: 'Bread', method: 'Toasted', requiredEquipmentId: 'eq1' });
    expect(renamed.cookbook.entries.toast.menuSettings.name).toBe('House Toast');

    const removed = gameReducer(renamed, { type: 'REMOVE_DISH', id: 'starter-toast' });
    const readded = gameReducer(removed, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' });
    expect(readded.dishes[0]).toMatchObject({ name: 'House Toast', cookbookId: 'toast',
      base: 'Bread', method: 'Toasted', requiredEquipmentId: 'eq1' });
  });
  it('clears a removed cookbook dish suspension so same-ID re-addition returns to walk-in baskets', () => {
    let state = gameReducer(createInitialState(), { type: 'REMOVE_DISH', id: 'starter-toast' });
    state = gameReducer(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' });
    const dishId = state.dishes[0].id;
    expect(dishId).toBe('cookbook:toast');
    state = {
      ...state,
      restaurant: { ...state.restaurant, suspendedDishIds: ['unrelated-dish', dishId] },
    };
    expect(buildAffordableBaskets(state, { spendingBudget: 100 })
      .some(basket => basket.kind === 'dish' && basket.dish.id === dishId)).toBe(false);

    const customers = state.customers;
    state = gameReducer(state, { type: 'REMOVE_DISH', id: dishId });

    expect(state.dishes).toEqual([]);
    expect(state.restaurant.suspendedDishIds).toEqual(['unrelated-dish']);
    expect(state.customers).toBe(customers);

    state = gameReducer(state, { type: 'ADD_COOKBOOK_DISH', cookbookId: 'toast' });

    expect(state.dishes[0].id).toBe(dishId);
    expect(state.restaurant.suspendedDishIds).toEqual(['unrelated-dish']);
    expect(buildAffordableBaskets(state, { spendingBudget: 100 })
      .some(basket => basket.kind === 'dish' && basket.dish.id === dishId)).toBe(true);
  });
  it('rejects free custom creation and ignores forged authored identity changes', () => {
    const state = createInitialState();
    const custom = { ...state.dishes[0], id: 'custom-0', cookbookId: null, masteryPerk: 'speed', quality: 10 };
    expect(gameReducer(state, { type: 'ADD_DISH', dish: custom })).toBe(state);

    const forged = gameReducer(state, { type: 'UPDATE_DISH', id: 'starter-toast', changes: {
      id: 'fake-id', cookbookId: 'fries', masteryPerk: 'appeal', base: 'Gold', method: 'Fried',
      requiredEquipmentId: 'eq3', quality: 10, name: 'Forged Toast', price: 15,
    } });
    expect(forged.dishes[0]).toMatchObject({ id: 'starter-toast', cookbookId: 'toast',
      base: 'Bread', method: 'Toasted', requiredEquipmentId: 'eq1', quality: 1,
      name: 'Forged Toast', price: 15 });
    expect(forged.dishes[0]).not.toHaveProperty('masteryPerk', 'appeal');
  });
  it('rejects menu ID collisions with live dishes and retained snapshots', () => {
    const state = createInitialState();
    const add = id => ({ type: 'ADD_DISH', dish: { ...state.dishes[0], id } });
    expect(gameReducer(state, add('starter-toast'))).toBe(state);
    const snapshot = createDishOrderSnapshot({ ...state.dishes[0], id: 'old-menu', cookbookId: 'toast', masteryPerk: null },
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
