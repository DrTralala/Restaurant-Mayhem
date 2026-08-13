import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecipeCreator from './RecipeCreator';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

import { useDispatch, useGameState } from '../state/GameContext';

afterEach(() => vi.restoreAllMocks());

describe('RecipeCreator', () => {
  it('constrains creation prices to finite integers from $1 to $100', () => {
    useGameState.mockReturnValue({
      equipment: [{ id: 'eq2', name: 'Oven', owned: true }],
      dishes: [],
      recipeSlots: 1,
    });
    useDispatch.mockReturnValue(vi.fn());

    render(<RecipeCreator onClose={vi.fn()} />);

    const price = screen.getByRole('spinbutton', { name: 'Price: $' });
    expect(price).toHaveAttribute('min', '1');
    expect(price).toHaveAttribute('max', '100');

    fireEvent.change(screen.getByLabelText('Dish Name:'), { target: { value: 'Soup' } });
    fireEvent.change(price, { target: { value: '101' } });
    expect(screen.getByRole('button', { name: /Create/ })).toBeDisabled();

    fireEvent.change(price, { target: { value: '12.5' } });
    expect(screen.getByRole('button', { name: /Create/ })).toBeDisabled();
  });
});
