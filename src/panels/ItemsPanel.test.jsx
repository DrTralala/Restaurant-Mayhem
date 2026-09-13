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

    expect(screen.getByText('Dining table')).toBeInTheDocument();
    expect(screen.getByText('Dining chair')).toBeInTheDocument();
    expect(screen.getByText('Additional door')).toBeInTheDocument();
    expect(screen.getByText('Cashier')).toBeInTheDocument();
  });

  it('offers the automatic dishwasher at $600 with its catalogue description', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 1000 } });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(screen.getByText('Automatic dishwasher')).toBeInTheDocument();
    expect(screen.getByText('$600')).toBeInTheDocument();
    expect(screen.getByText('Washes queued dishes automatically in three in-game minutes.'))
      .toBeInTheDocument();
  });

  it('starts chair placement without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy Dining chair ($50)' }));

    expect(startPlacement).toHaveBeenCalledWith('chair');
  });

  it('starts additional-door placement without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy Additional door ($400)' }));

    expect(startPlacement).toHaveBeenCalledWith('door');
  });
});
