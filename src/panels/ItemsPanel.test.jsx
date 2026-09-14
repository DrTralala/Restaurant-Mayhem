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

  it('offers the automatic dishwasher at $2000 with its level and capacity description', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 1000 } });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(screen.getByText('Automatic dishwasher')).toBeInTheDocument();
    expect(screen.getByText('$2000')).toBeInTheDocument();
    expect(screen.getByText(/10 levels.*300 seconds.*12 items/i))
      .toBeInTheDocument();
  });

  it('offers the couch, arcade, and bed with their staff wellbeing policies', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 3000 } });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(screen.getByText('Couch')).toBeInTheDocument();
    expect(screen.getByText(/Two staff seats.*15 minutes.*\+6 morale per hour/i)).toBeInTheDocument();
    expect(screen.getByText('Arcade')).toBeInTheDocument();
    expect(screen.getByText(/One staff seat.*10 minutes.*\+8 morale per hour/i)).toBeInTheDocument();
    expect(screen.getByText('Bed')).toBeInTheDocument();
    expect(screen.getByText(/minimum 7 in-game hours.*full morale.*24 hours of reduced drain/i))
      .toBeInTheDocument();
  });

  it('starts placement for each staff amenity without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 3000 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy Couch ($400)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Arcade ($800)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Bed ($500)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Automatic dishwasher ($2000)' }));

    expect(startPlacement.mock.calls).toEqual([
      ['couch'],
      ['arcade'],
      ['bed'],
      ['automaticDishwasher'],
    ]);
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
