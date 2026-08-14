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

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(screen.getByText('Dining Table')).toBeInTheDocument();
    expect(screen.getByText('Dining Chair')).toBeInTheDocument();
    expect(screen.getByText('Additional Door')).toBeInTheDocument();
    expect(screen.getByText('Cashier Table')).toBeInTheDocument();
  });

  it('starts chair placement without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy chair ($50)' }));

    expect(startPlacement).toHaveBeenCalledWith('chair');
  });

  it('starts additional-door placement without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy door ($400)' }));

    expect(startPlacement).toHaveBeenCalledWith('door');
  });
});
