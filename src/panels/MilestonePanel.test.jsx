import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MilestonePanel from './MilestonePanel';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
}));

import { useGameState } from '../state/GameContext';

afterEach(() => vi.restoreAllMocks());

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

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

  it('labels an unsupported unlock VIP reward as no reward', () => {
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

    expect(screen.getByText('Reward: No reward')).toBeInTheDocument();
    expect(screen.queryByText('Reward: Unlock VIP')).not.toBeInTheDocument();
  });

  it.each(['unlockVIP', 'newStaffSlot', 'unknownCustomReward'])(
    'labels an unsupported %s reward on a custom milestone as no reward',
    rewardType => {
      useGameState.mockReturnValue({
        restaurant: { totalServed: 0, funds: 0, reputation: 0, day: 1 },
        equipment: [],
        milestones: [{
          id: `custom-${rewardType}`,
          description: 'A custom goal',
          condition: { type: 'servedTotal', threshold: 1 },
          reward: { type: rewardType },
          achieved: false,
        }],
      });

      render(<MilestonePanel />);

      expect(screen.getByText('Reward: No reward')).toBeInTheDocument();
    },
  );

  it('retains the New dish slot label for an explicit custom newDishSlot reward', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 0, funds: 0, reputation: 0, day: 1 },
      equipment: [],
      milestones: [{
        id: 'custom-dish-slot',
        description: 'A custom dish goal',
        condition: { type: 'servedTotal', threshold: 1 },
        reward: { type: 'newDishSlot' },
        achieved: false,
      }],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Reward: New dish slot')).toBeInTheDocument();
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

  it('shows current metric and target for every supported condition type', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 7, funds: 500, reputation: 2.5, day: 4 },
      equipment: [
        { owned: false, level: 20 },
        { owned: true, level: 4 },
        { owned: true, level: 9 },
      ],
      milestones: [
        {
          id: 'served-goal',
          description: 'Serve ten customers',
          condition: { type: 'servedTotal', threshold: 10 },
          reward: { type: 'none' },
          achieved: false,
        },
        {
          id: 'cash-goal',
          description: 'Hold cash',
          condition: { type: 'cashReserve', threshold: 1000 },
          reward: { type: 'none' },
          achieved: false,
        },
        {
          id: 'legacy-revenue-goal',
          description: 'Legacy revenue goal',
          condition: { type: 'revenue', threshold: 750 },
          reward: { type: 'none' },
          achieved: false,
        },
        {
          id: 'reputation-goal',
          description: 'Reach reputation',
          condition: { type: 'reputation', threshold: 3 },
          reward: { type: 'none' },
          achieved: false,
        },
        {
          id: 'day-goal',
          description: 'Reach day',
          condition: { type: 'day', threshold: 10 },
          reward: { type: 'none' },
          achieved: false,
        },
        {
          id: 'equipment-goal',
          description: 'Upgrade equipment',
          condition: { type: 'equipmentLevel', threshold: 10 },
          reward: { type: 'none' },
          achieved: false,
        },
      ],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Current metric: 7 / 10')).toBeInTheDocument();
    expect(screen.getByText('Current metric: $500 / $1000')).toBeInTheDocument();
    expect(screen.getByText('Current metric: $500 / $750')).toBeInTheDocument();
    expect(screen.getByText('Current metric: 2.5 / 3')).toBeInTheDocument();
    expect(screen.getByText('Current metric: 4 / 10')).toBeInTheDocument();
    expect(screen.getByText('Current metric: 9 / 10')).toBeInTheDocument();
    expect(screen.getByText('Cash reserve (legacy revenue condition)')).toBeInTheDocument();
    expect(screen.queryByText(/lifetime sales/i)).not.toBeInTheDocument();
    expect(screen.getByText('Current values can change after a milestone is completed.')).toBeInTheDocument();
  });

  it('formats zero, negative and fractional current metrics without hiding finite values', () => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: -5, funds: 250.5, reputation: 0, day: 0 },
      equipment: [],
      milestones: [
        {
          id: 'negative-served',
          description: 'Serve customers',
          condition: { type: 'servedTotal', threshold: 10 },
          reward: { type: 'none' },
          achieved: false,
        },
        {
          id: 'fractional-cash',
          description: 'Hold fractional cash',
          condition: { type: 'cashReserve', threshold: 1000 },
          reward: { type: 'none' },
          achieved: false,
        },
        {
          id: 'zero-day',
          description: 'Reach a day',
          condition: { type: 'day', threshold: 10 },
          reward: { type: 'none' },
          achieved: false,
        },
      ],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Current metric: -5 / 10')).toBeInTheDocument();
    expect(screen.getByText('Current metric: $250.50 / $1000')).toBeInTheDocument();
    expect(screen.getByText('Current metric: 0 / 10')).toBeInTheDocument();
  });

  it.each([NaN, Infinity])('labels a nonfinite current metric as unavailable for %s', value => {
    useGameState.mockReturnValue({
      restaurant: { totalServed: 0, funds: value, reputation: 0, day: 1 },
      equipment: [],
      milestones: [{
        id: 'cash-goal',
        description: 'Hold cash',
        condition: { type: 'cashReserve', threshold: 1000 },
        reward: { type: 'none' },
        achieved: false,
      }],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Current metric: Unavailable / $1000')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Hold cash' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('labels missing metrics and equipment with no owned level as unavailable', () => {
    useGameState.mockReturnValue({
      restaurant: { funds: 0, reputation: 0, day: 1 },
      equipment: [{ owned: false, level: 10 }],
      milestones: [
        {
          id: 'missing-served',
          description: 'Serve customers',
          condition: { type: 'servedTotal', threshold: 10 },
          reward: { type: 'none' },
          achieved: false,
        },
        {
          id: 'no-owned-equipment',
          description: 'Upgrade equipment',
          condition: { type: 'equipmentLevel', threshold: 5 },
          reward: { type: 'none' },
          achieved: false,
        },
      ],
    });

    render(<MilestonePanel />);

    expect(screen.getByText('Current metric: Unavailable / 10')).toBeInTheDocument();
    expect(screen.getByText('Current metric: Unavailable / 5')).toBeInTheDocument();
  });

  it('keeps a completed bar at 100 when its metric later falls', () => {
    const completedMilestone = {
      id: 'm3',
      description: 'Hold cash reserve',
      condition: { type: 'cashReserve', threshold: 1000 },
      reward: { type: 'none' },
      achieved: true,
    };
    useGameState.mockReturnValue({
      restaurant: { totalServed: 0, funds: 1500, reputation: 0, day: 1 },
      equipment: [],
      milestones: [completedMilestone],
    });

    const { rerender } = render(<MilestonePanel />);

    expect(screen.getByText('Current metric: $1500 / $1000')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Hold cash reserve' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar', { name: 'Hold cash reserve' }).firstElementChild)
      .toHaveStyle({ width: '100%' });

    useGameState.mockReturnValue({
      restaurant: { totalServed: 0, funds: 500, reputation: 0, day: 1 },
      equipment: [],
      milestones: [completedMilestone],
    });
    rerender(<MilestonePanel />);

    expect(screen.getByText('Current metric: $500 / $1000')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Current values can change after a milestone is completed.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Hold cash reserve' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar', { name: 'Hold cash reserve' }).firstElementChild)
      .toHaveStyle({ width: '100%' });
  });

  it('reads frozen state without mutation or randomness', () => {
    const state = deepFreeze({
      restaurant: { totalServed: 7, funds: 500, reputation: 0, day: 1 },
      equipment: [],
      milestones: [{
        id: 'served-goal',
        description: 'Serve customers',
        condition: { type: 'servedTotal', threshold: 10 },
        reward: { type: 'none' },
        achieved: false,
      }],
    });
    useGameState.mockReturnValue(state);
    const before = JSON.stringify(state);
    const random = vi.spyOn(Math, 'random');

    render(<MilestonePanel />);

    expect(screen.getByText('Current metric: 7 / 10')).toBeInTheDocument();
    expect(JSON.stringify(state)).toBe(before);
    expect(random).not.toHaveBeenCalled();
  });
});
