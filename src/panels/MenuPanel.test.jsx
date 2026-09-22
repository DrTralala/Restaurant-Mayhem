import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MenuPanel from './MenuPanel';
import { useDispatch, useGameState } from '../state/GameContext';
import { createInitialState } from '../state/initialState';
import { normaliseCookbookState } from '../simulation/cookbook';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

describe('MenuPanel drinks', () => {
  beforeEach(() => {
    useGameState.mockReturnValue({
      dishes: [{
        id: 'toast', name: 'Toast', price: 12, prepTime: 60,
        quality: 2, popularity: 45,
      }],
      recipeSlots: 1,
      equipment: [{ id: 'eq1', name: 'Toaster', owned: true }],
      unlockedDrinkIds: ['water'],
      drinkOverrides: { water: { price: 8, quality: 3 } },
      upgrades: [],
      restaurant: { funds: 200, reputation: 3 },
    });
    useDispatch.mockReturnValue(vi.fn());
  });

  it('shows unlocked Water with resolved menu controls and demand', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    const waterCard = screen.getByRole('article', { name: 'Water menu item' });
    expect(within(waterCard).getByLabelText('Water price')).toHaveValue(8);
    expect(within(waterCard).getByText(/Estimated demand: \d+%/)).toBeInTheDocument();
    expect(within(waterCard).getByText(/Quality: .* Lv\.3/)).toBeInTheDocument();
    expect(within(waterCard).getByText('Popularity: 50%')).toBeInTheDocument();
    expect(within(waterCard).getByText('$8 · 120s prep')).toBeInTheDocument();
    expect(within(waterCard).getByRole('button', { name: 'Upgrade Water quality ($50)' })).toBeEnabled();
    expect(screen.getByText('Menu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlock Water/ })).not.toBeInTheDocument();

    fireEvent.change(within(waterCard).getByLabelText('Water price'), { target: { value: '9' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_DRINK', id: 'water', changes: { price: 9 },
    });
    fireEvent.click(within(waterCard).getByRole('button', { name: 'Upgrade Water quality ($50)' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPGRADE_DRINK_QUALITY', id: 'water' });
  });

  it('keeps dish pricing dispatch behavior and adds demand', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    const dishCard = screen.getByRole('article', { name: 'Toast menu item' });
    expect(within(dishCard).getByText(/Estimated demand: \d+%/)).toBeInTheDocument();
    fireEvent.change(within(dishCard).getByLabelText('Toast price'), { target: { value: '14' } });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_DISH', id: 'toast', changes: { price: 14 },
    });
  });

  it('keeps locked Tea limited to its unlock action', () => {
    render(<MenuPanel />);

    const teaCard = screen.getByRole('article', { name: 'Tea menu item' });
    expect(within(teaCard).getByRole('button', { name: 'Unlock Tea ($150)' })).toBeInTheDocument();
    expect(within(teaCard).queryByLabelText('Tea price')).not.toBeInTheDocument();
    expect(within(teaCard).queryByRole('button', { name: 'Upgrade Tea quality ($50)' })).not.toBeInTheDocument();
    expect(within(teaCard).queryByText(/Estimated demand:/)).not.toBeInTheDocument();
  });

  it('dispatches a canonical Tea unlock', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Unlock Tea ($150)' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'UNLOCK_DRINK', id: 'tea' });
  });

  it('disables unaffordable drinks', () => {
    useGameState.mockReturnValue({
      dishes: [], recipeSlots: 1, unlockedDrinkIds: ['water'], drinkOverrides: {},
      upgrades: [], restaurant: { funds: 149, reputation: 3 },
    });
    render(<MenuPanel />);

    expect(screen.getByRole('button', { name: 'Unlock Tea ($150)' })).toBeDisabled();
  });

  it('reserves room beside New dish for the modal close button', () => {
    render(<MenuPanel />);

    const headingRow = screen.getByRole('heading', { name: 'Menu' }).parentElement;
    expect(headingRow).toHaveStyle({ paddingRight: '40px' });
    expect(within(headingRow).getByRole('button', { name: '+ New dish' }))
      .toBeInTheDocument();
  });

  it('browses the cookbook child and returns without losing creator or drink controls', () => {
    render(<MenuPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));
    expect(screen.getByRole('heading', { name: 'Cookbook' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Back to menu' }));
    expect(screen.getByRole('button', { name: '+ New dish' })).toBeEnabled();
    expect(screen.getByLabelText('Water price')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));
    expect(screen.getByRole('heading', { name: 'Create new dish' })).toBeInTheDocument();
  });

  it('shows authored effective seconds, popularity and mastery separately from custom dishes', () => {
    let state = createInitialState();
    state = { ...state, ...normaliseCookbookState(state, { legacy: true }) };
    Object.assign(state.cookbook.entries.toast, { paidPortions: 15, perk: 'speed' });
    state.dishes.push({ ...state.dishes[0], cookbookId: null, id: 'custom', name: 'Custom Toast', prepTime: 180 });
    useGameState.mockReturnValue(state);
    render(<MenuPanel />);
    const toast = within(screen.getByRole('article', { name: 'Toasted Bread menu item' }));
    expect(toast.getByText('$12 · 51s cook')).toBeInTheDocument();
    expect(toast.getByText('Popularity: 50%')).toBeInTheDocument();
    expect(toast.getByText('Cookbook recipe · Signature: Quick Service')).toBeInTheDocument();
    expect(screen.getByText('Custom recipe')).toBeInTheDocument();
    expect(screen.getByText(/base cooking work, not the complete wait time/)).toBeInTheDocument();
  });

  it('career decision blocks dish, drink and creator mutations while allowing cookbook browsing', () => {
    const state = useGameState();
    useGameState.mockReturnValue({ ...state, careerRun: { needsDecision: true } });
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);
    expect(screen.getByText(/Career decision pending/)).toBeInTheDocument();
    for (const name of ['+ New dish', 'Upgrade Toast quality ($50)', 'Remove', 'Upgrade Water quality ($50)', 'Unlock Tea ($150)']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByLabelText('Toast price')).toBeDisabled();
    expect(screen.getByLabelText('Water price')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Toast price'), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText('Water price'), { target: { value: '99' } });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));
    expect(screen.getByRole('button', { name: 'Back to menu' })).toBeEnabled();
  });

  it('suppresses an already-open custom creator when the parent gate becomes read-only', () => {
    const view = render(<MenuPanel />);
    fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));
    view.rerender(<MenuPanel readOnly />);
    expect(screen.queryByRole('heading', { name: 'Create new dish' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New dish' })).toBeDisabled();
  });
});
