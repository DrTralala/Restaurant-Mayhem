import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MilestonePanel from './MilestonePanel';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
}));

import { useGameState } from '../state/GameContext';

afterEach(() => vi.restoreAllMocks());

describe('MilestonePanel', () => {
  it('labels a completed retired milestone without implying a cash payout', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 50, funds: 0, reputation: 2, day: 1 },
      equipment: [],
      milestones: [{
        id: 'm2',
        description: 'Serve 50 customers',
        condition: { type: 'servedTotal', threshold: 50 },
        reward: { type: 'none' },
        achieved: true,
      }],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText('Reward: No reward')).not.toBeInTheDocument();
  });

  it('preserves VIP capitalization in reward labels', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 0, funds: 0, reputation: 0, day: 1 },
      equipment: [],
      milestones: [{
        id: 'm10',
        description: 'Upgrade any equipment to Level 10',
        condition: { type: 'equipmentLevel', threshold: 10 },
        reward: { type: 'unlockVIP' },
        achieved: false,
      }],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Reward: Unlock VIP')).toBeInTheDocument();
    expect(screen.queryByText('Reward: Unlock vip')).not.toBeInTheDocument();
  });

  it('shows the exact cash bonus for a canonical built-in milestone', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 0, funds: 0, reputation: 0, day: 1 },
      equipment: [],
      milestones: [{
        id: 'm1',
        description: 'Serve 10 customers',
        condition: { type: 'servedTotal', threshold: 10 },
        reward: { type: 'cashBonus', amount: 50 },
        achieved: false,
      }],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Reward: Cash bonus $50')).toBeInTheDocument();
  });

  it('labels previously achieved built-in cash milestones as completed', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 10, funds: 0, reputation: 0, day: 1 },
      equipment: [],
      milestones: [{
        id: 'm1',
        description: 'Serve 10 customers',
        condition: { type: 'servedTotal', threshold: 10 },
        reward: { type: 'cashBonus', amount: 50 },
        achieved: true,
      }],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText('Reward: Cash bonus $50')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Serve 10 customers' }))
      .toHaveAttribute('aria-valuenow', '100');
  });

  it.each([NaN, Infinity, -1])('renders invalid numerical progress %s as zero with an accessible progressbar', totalServed => {
    useGameState.mockReturnValue({
      restaurant: { totalServed, funds: 0, reputation: 0, day: 1 },
      equipment: [],
      milestones: [{
        id: 'served-goal',
        description: 'Serve 10 customers',
        condition: { type: 'servedTotal', threshold: 10 },
        reward: { type: 'none' },
        achieved: false,
      }],
    });

    render(<MilestonePanel />);

    expect(screen.getByRole('progressbar', { name: 'Serve 10 customers' })).toHaveAttribute('aria-valuemin', '0');
    expect(screen.getByRole('progressbar', { name: 'Serve 10 customers' })).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByRole('progressbar', { name: 'Serve 10 customers' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('uses shared cash-reserve progress and skips malformed milestone rows', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 0, funds: 500, reputation: 0, day: 1 },
      equipment: [],
      milestones: [
        null,
        'not a milestone',
        { id: 'missing-condition', description: 'Missing condition', reward: { type: 'none' } },
        { id: 'unknown-condition', description: 'Unknown condition', condition: { type: 'unknown', threshold: 1 }, reward: { type: 'none' } },
        { id: 'invalid-threshold', description: 'Invalid threshold', condition: { type: 'servedTotal', threshold: 0 }, reward: { type: 'none' } },
        {
          id: 'm3',
          description: 'Hold $1,000 cash reserve',
          condition: { type: 'cashReserve', threshold: 1000 },
          reward: { type: 'cashBonus', amount: 100 },
          achieved: false,
        },
      ],
    });

    render(<MilestonePanel />);

    expect(screen.queryByText('Missing condition')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown condition')).not.toBeInTheDocument();
    expect(screen.queryByText('Invalid threshold')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Hold $1,000 cash reserve' }))
      .toHaveAttribute('aria-valuenow', '50');
  });

  it('does not advertise cash semantics for a custom milestone reward', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 0, funds: 0, reputation: 0, day: 1 },
      equipment: [],
      milestones: [{
        id: 'custom-cash',
        description: 'Custom goal',
        condition: { type: 'servedTotal', threshold: 1 },
        reward: { type: 'cashBonus', amount: 999 },
        achieved: false,
      }],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Reward: No reward')).toBeInTheDocument();
    expect(screen.queryByText('Reward: Cash bonus $999')).not.toBeInTheDocument();
  });
});
