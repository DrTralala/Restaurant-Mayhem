import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInitialState } from './initialState';
import { hydrateState, loadState, saveState } from './persistence';
import { advanceCharacterMovementBatch } from '../simulation/movement';
import { GameProvider, useGameState } from './GameContext';
import SettingsMenu from '../components/SettingsMenu';
import { loadLatestRepositoryState } from './repositorySaves';

vi.mock('./repositorySaves', () => ({ loadLatestRepositoryState: vi.fn(), saveRepositoryState: vi.fn() }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('replacement navigation save boundary', () => {
  it('starts new games with save version seven', () => {
    expect(createInitialState().version).toBe(7);
  });

  it.each([1, 5, 6, 8, undefined])('ignores unsupported autosave version %s without trying to hydrate it', version => {
    localStorage.setItem('restaurant-sim-save', JSON.stringify({ ...createInitialState(), version }));
    expect(loadState()).toBeNull();
  });

  it('rejects explicit older versions at hydration rather than silently migrating movement state', () => {
    const fresh = createInitialState();
    expect(() => hydrateState({ ...fresh, version: 6 }, fresh)).toThrow(/incompatible/i);
  });

  it('round-trips gameplay intent while rebuilding empty replacement runtime state', () => {
    const fresh = createInitialState();
    let state = { ...fresh, staff: [{ ...fresh.staff[1], x: 400, y: 400, navigationGoal: { x: 460, y: 400 } }] };
    const batch = advanceCharacterMovementBatch(state, [{ character: state.staff[0], speed: 60 }], 1 / 30);
    state = { ...state, staff: [batch.moved.get(state.staff[0].id)], movementCoordinator: batch.coordinator };
    saveState(state);
    const stored = loadState();
    expect(stored.version).toBe(7);
    expect(stored.movementCoordinator).toBeUndefined();
    const restored = hydrateState(stored, fresh);
    expect(restored.movementCoordinator).toMatchObject({ version: 1, tick: 0 });
    expect(restored.movementCoordinator.records.size).toBe(0);
    const resumed = advanceCharacterMovementBatch(restored, [{ character: restored.staff[0], speed: 60 }], 1 / 30);
    expect(resumed.moved.get(restored.staff[0].id).x).toBeGreaterThan(state.staff[0].x);
  });

  it('leaves the current game intact when Settings loads an incompatible saved game', async () => {
    loadLatestRepositoryState.mockResolvedValue({ filename: 'old.json', state: {
      ...createInitialState(), version: 6, restaurant: { ...createInitialState().restaurant, funds: 9999 },
    } });
    function CurrentFunds() { return <output data-testid="funds">{useGameState().restaurant.funds}</output>; }
    render(<GameProvider><CurrentFunds /><SettingsMenu isOpen onToggle={() => {}} /></GameProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Load Game' }));
    expect(await screen.findByText(/incompatible/i)).toBeInTheDocument();
    expect(screen.getByTestId('funds')).toHaveTextContent('600');
  });
});
