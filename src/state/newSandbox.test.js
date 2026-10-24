import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from './initialState';
import { NEW_SANDBOX_CONFIRMATION, requestNewSandbox } from './newSandbox';

const SAVE_KEY = 'restaurant-sim-save';
const OTHER_KEY = 'restaurant-sim-synthetic-other';
const EXACT_CONFIRMATION = 'Start a new sandbox? This replaces your current restaurant, any career and its local autosave. No backup is created. Cancel keeps this restaurant.';

describe('requestNewSandbox', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('exports the exact confirmed-replacement warning', () => {
    expect(NEW_SANDBOX_CONFIRMATION).toBe(EXACT_CONFIRMATION);
  });

  it('cancels without touching storage or dispatching', () => {
    const dispatch = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const removeItem = vi.spyOn(localStorage, 'removeItem');

    expect(requestNewSandbox(dispatch)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(EXACT_CONFIRMATION);
    expect(removeItem).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('removes only the autosave and dispatches one fresh initial state after confirmation', () => {
    const dispatch = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const removeItem = vi.spyOn(localStorage, 'removeItem');
    localStorage.setItem(SAVE_KEY, JSON.stringify({ synthetic: true }));
    localStorage.setItem(OTHER_KEY, 'keep');

    expect(requestNewSandbox(dispatch)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(EXACT_CONFIRMATION);
    expect(removeItem).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledWith(SAVE_KEY);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(localStorage.getItem(OTHER_KEY)).toBe('keep');
    expect(dispatch).toHaveBeenCalledTimes(1);

    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe('LOAD_STATE');
    expect(action.state.careerRun).toBeNull();
    expect(action.state.restaurant).toMatchObject({ funds: 600, day: 1, totalServed: 0 });
    expect(action.state.version).toBe(createInitialState().version);
  });

  it('creates a distinct fresh state for every confirmed request', () => {
    const dispatch = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {});

    requestNewSandbox(dispatch);
    requestNewSandbox(dispatch);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][0].state).not.toBe(dispatch.mock.calls[1][0].state);
    expect(dispatch.mock.calls[0][0].state.careerRun).toBeNull();
    expect(dispatch.mock.calls[1][0].state.careerRun).toBeNull();
  });

  it('propagates storage removal failure before dispatching or reporting success', () => {
    const dispatch = vi.fn();
    const failure = new Error('synthetic storage failure');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw failure; });

    expect(() => requestNewSandbox(dispatch)).toThrow(failure);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
