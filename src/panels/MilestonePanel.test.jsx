import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MilestonePanel from './MilestonePanel';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
}));

import { useGameState } from '../state/GameContext';

afterEach(() => vi.restoreAllMocks());

describe('MilestonePanel', () => {
  it('displays a retired milestone reward as no reward', () => {
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

    expect(screen.getByText('Reward: No reward')).toBeInTheDocument();
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
});
