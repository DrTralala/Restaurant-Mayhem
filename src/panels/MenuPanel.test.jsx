import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MenuPanel from './MenuPanel';
import { useDispatch, useGameState } from '../state/GameContext';

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
});
