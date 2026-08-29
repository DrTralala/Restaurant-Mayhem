import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatsBar from './StatsBar';

const state = {
  restaurant: {
    funds: 600, reputation: 2, day: 1, totalServed: 0,
    gameTime: 3 * 3600 + 30 * 60, openHour: 10, closeHour: 22,
  },
};

vi.mock('../state/GameContext', () => ({ useGameState: () => state }));

beforeEach(() => {
  state.restaurant.gameTime = 3 * 3600 + 30 * 60;
  state.restaurant.openHour = 10;
  state.restaurant.closeHour = 22;
});

it('renders the analogue clock beside the text time', () => {
  render(<StatsBar />);

  expect(screen.getByLabelText('3:30 AM')).toBeInTheDocument();
  expect(screen.getByText('3:30 AM')).toBeInTheDocument();
  expect(screen.getByText('Closed')).toBeInTheDocument();
});

it('shows Open at opening and Closed at the exclusive closing boundary', () => {
  state.restaurant.gameTime = 10 * 3600;
  const { rerender } = render(<StatsBar />);
  expect(screen.getByText('Open')).toBeInTheDocument();

  state.restaurant.gameTime = 22 * 3600;
  rerender(<StatsBar />);
  expect(screen.getByText('Closed')).toBeInTheDocument();
});
