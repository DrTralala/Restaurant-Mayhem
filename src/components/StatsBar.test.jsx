import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatsBar from './StatsBar';
import { createCareerRun } from '../simulation/careerRun';

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
  state.restaurant.reputation = 2;
  delete state.careerRun;
});

it.each([[640739, '0d 0h 2m'], [640740, '0d 0h 1m'], [640799.9, 'Under 1 minute']])(
  'shows precise provisional goals and rounds countdown up at %s', (gameTime, remaining) => {
    state.careerRun = createCareerRun({ scenarioId: 'opening-week', runId: 'hud', startedAt: 36000 });
    state.restaurant.gameTime = gameTime;
    state.restaurant.reputation = 1.999;
    render(<StatsBar />);
    const tracker = screen.getByRole('button', { name: 'Opening Week progress' });
    expect(tracker).toHaveTextContent('Reputation: 1.999 / 2.00 — below target');
    expect(tracker).toHaveTextContent(remaining);
    expect(tracker).toHaveTextContent('(provisional)');
    expect(tracker).toHaveTextContent('Deadline: Day 8, 10:00 AM');
  },
);

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
