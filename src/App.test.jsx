import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { hydrateState, loadState, saveState } from './state/persistence';
import { loadLatestRepositoryState, saveRepositoryState } from './state/repositorySaves';

const dispatch = vi.fn();
const gameState = { version: 1, paused: true, notifications: [] };

vi.mock('./state/GameContext', () => ({
  GameProvider: ({ children }) => children,
  useGameState: () => gameState,
  useDispatch: () => dispatch,
  useGameGeneration: () => 0,
}));
vi.mock('./state/persistence', () => ({
  hydrateState: vi.fn(),
  loadState: vi.fn(),
  saveState: vi.fn(),
}));
vi.mock('./state/repositorySaves', () => ({
  loadLatestRepositoryState: vi.fn(),
  saveRepositoryState: vi.fn(),
}));
vi.mock('./state/initialState', () => ({
  createInitialState: () => ({ version: 1, paused: false }),
}));
vi.mock('./canvas/RestaurantCanvas', () => ({
  default: ({ onEmptySpaceClick }) => <button onClick={onEmptySpaceClick}>Empty canvas</button>,
}));
vi.mock('./components/StatsBar', () => ({ default: () => null }));
vi.mock('./components/BookIcon', () => ({
  default: ({ onClick }) => <button onClick={onClick}>Management</button>,
}));
vi.mock('./components/MenuIcon', () => ({
  default: ({ onClick }) => <button onClick={onClick}>Menu</button>,
}));
vi.mock('./components/Toast', () => ({ default: () => null }));
vi.mock('./panels/ManagementModal', () => ({
  default: ({ isOpen }) => isOpen ? <div>Management panel</div> : null,
}));
vi.mock('./panels/MenuModal', () => ({
  default: ({ isOpen }) => isOpen ? <div>Menu panel</div> : null,
}));

describe('settings menu', () => {
  beforeEach(() => {
    localStorage.clear();
    dispatch.mockClear();
    loadState.mockReset();
    saveState.mockReset();
    hydrateState.mockReset();
    loadLatestRepositoryState.mockReset();
    saveRepositoryState.mockReset();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('opens from a cogwheel beside the management button', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('button', { name: 'Save Game' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load Game' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Game' })).toBeInTheDocument();
  });

  it('saves the current game to the repository on demand', async () => {
    saveRepositoryState.mockResolvedValue({ filename: '2026-08-13 2.36pm.json' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Game' }));

    expect(saveRepositoryState).toHaveBeenCalledWith(gameState);
    expect(await screen.findByText('Saved as 2026-08-13 2.36pm.json')).toBeInTheDocument();
  });

  it('loads and hydrates the latest compatible repository save', async () => {
    const saved = { version: 1, restaurant: { funds: 900 } };
    const hydrated = { ...gameState, restaurant: { funds: 900 } };
    loadLatestRepositoryState.mockResolvedValue({ state: saved, filename: '2026-08-13 2.36pm.json' });
    hydrateState.mockReturnValue(hydrated);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load Game' }));

    expect(await screen.findByText('Loaded 2026-08-13 2.36pm.json')).toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledWith({ type: 'LOAD_STATE', state: hydrated });
  });

  it('starts a fresh game after confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem('restaurant-sim-save', '{}');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'LOAD_STATE', state: { version: 1, paused: false },
    });
    expect(localStorage.getItem('restaurant-sim-save')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Game' })).not.toBeInTheDocument();
  });

  it('closes Settings when empty canvas space is clicked', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    fireEvent.click(screen.getByRole('button', { name: 'Empty canvas' }));

    expect(screen.queryByRole('button', { name: 'Save Game' })).not.toBeInTheDocument();
  });

  it('closes Management when empty canvas space is clicked', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Management' }));
    expect(screen.getByText('Management panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Empty canvas' }));

    expect(screen.queryByText('Management panel')).not.toBeInTheDocument();
  });

  it('keeps Menu, Management, and Settings mutually exclusive', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByText('Menu panel')).toBeInTheDocument();
    expect(screen.queryByText('Management panel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Game' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Management' }));
    expect(screen.queryByText('Menu panel')).not.toBeInTheDocument();
    expect(screen.getByText('Management panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Game' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.queryByText('Menu panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Management panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Game' })).toBeInTheDocument();
  });

  it('closes Menu when empty canvas space is clicked', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByText('Menu panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Empty canvas' }));

    expect(screen.queryByText('Menu panel')).not.toBeInTheDocument();
  });

  it('mounts the Space shortcut owner exactly once so a keypress toggles a single time', () => {
    render(<App />);

    expect(screen.getAllByRole('button', { name: 'Resume game' })).toHaveLength(1);

    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent.keyDown(window, { key: ' ', code: 'Space', repeat: true });

    expect(dispatch.mock.calls).toEqual([[{ type: 'TOGGLE_PAUSE' }]]);
  });

  it('dispatches one pause toggle when the pause button is clicked', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Resume game' }));

    expect(dispatch.mock.calls).toEqual([[{ type: 'TOGGLE_PAUSE' }]]);
  });
});
