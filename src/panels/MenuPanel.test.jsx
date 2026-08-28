import { fireEvent, render, screen } from '@testing-library/react';
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
      dishes: [], recipeSlots: 1, unlockedDrinkIds: ['water'],
      restaurant: { funds: 200 },
    });
    useDispatch.mockReturnValue(vi.fn());
  });

  it('shows paid Water as unlocked without consuming a recipe slot', () => {
    render(<MenuPanel />);

    expect(screen.getByText('Water')).toBeInTheDocument();
    expect(screen.getByText('$2')).toBeInTheDocument();
    expect(screen.getByText('Menu (0/1 slots)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlock Water/ })).not.toBeInTheDocument();
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
      dishes: [], recipeSlots: 1, unlockedDrinkIds: ['water'],
      restaurant: { funds: 149 },
    });
    render(<MenuPanel />);

    expect(screen.getByRole('button', { name: 'Unlock Tea ($150)' })).toBeDisabled();
  });
});
