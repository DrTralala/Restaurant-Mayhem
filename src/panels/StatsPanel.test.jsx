import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsPanel from './StatsPanel';

const { mockUseGameState } = vi.hoisted(() => ({ mockUseGameState: vi.fn() }));
vi.mock('../state/GameContext', () => ({ useGameState: () => mockUseGameState() }));

const baseState = {
  dailyHistory: [],
  restaurant: { totalServed: 0, day: 1, funds: 600, reputation: 3 },
  staff: [],
  dishes: [],
  partyReviewHistory: [],
};

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
  mockUseGameState.mockReturnValue(baseState);
});

it('shows empty party review aggregates', () => {
  render(<StatsPanel />);
  expect(screen.getByText('Average party review: —')).toBeInTheDocument();
  expect(screen.getByText('Completed reviews: 0')).toBeInTheDocument();
});

it('shows aggregates and only the latest ten reviews newest first', () => {
  const scores = [-50, -5, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const partyReviewHistory = scores.map((score, index) => {
    const unaffordableCount = index % 3 === 0 ? 1 : 0;
    return {
      partyId: `p${index + 1}`,
      day: index + 1,
      score,
      memberCount: 2,
      paidCount: 2 - unaffordableCount,
      unaffordableCount,
      reputationDelta: score * 2 / 5000,
    };
  });
  mockUseGameState.mockReturnValue({
    ...baseState,
    partyReviewHistory,
  });
  render(<StatsPanel />);

  expect(screen.getByText('Average party review: 32.9')).toBeInTheDocument();
  expect(screen.getByText('Completed reviews: 12')).toBeInTheDocument();
  expect(screen.getByText('Reviews with unaffordable members: 4 (33%)')).toBeInTheDocument();
  const rows = screen.getAllByTestId('party-review-row');
  expect(rows).toHaveLength(10);
  expect(rows[0]).toHaveTextContent('Day 12 · p12');
  expect(rows[0]).toHaveTextContent('Score: 90.0');
  expect(rows[0]).toHaveTextContent('Party: 2 · Paid: 2 · Unaffordable: 0');
  expect(rows[0]).toHaveTextContent('Reputation: +0.036');
  expect(rows.at(-1)).toHaveTextContent('Day 3 · p3');
  expect(screen.queryByText(/p1$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/p2$/)).not.toBeInTheDocument();
});
