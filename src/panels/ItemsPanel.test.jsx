import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ItemsPanel from './ItemsPanel';
import { useDispatch, useGameState } from '../state/GameContext';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

describe('ItemsPanel', () => {
  it('offers physical tables and chairs as items', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel />);

    expect(screen.getByText('Dining Table')).toBeInTheDocument();
    expect(screen.getByText('Dining Chair')).toBeInTheDocument();
    expect(screen.getByText('Additional Door')).toBeInTheDocument();
  });

  it('purchases a chair through one atomic action', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(dispatch);
    render(<ItemsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy chair ($50)' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'BUY_CHAIR', cost: 50 });
  });

  it('purchases an additional door through one atomic action', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(dispatch);
    render(<ItemsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy door ($400)' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'BUY_DOOR', cost: 400 });
  });
});
