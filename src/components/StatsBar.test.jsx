import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatsBar from './StatsBar';

vi.mock('../state/GameContext', () => ({
  useGameState: () => ({
    restaurant: {
      funds: 600, reputation: 2, day: 1, totalServed: 0, gameTime: 3 * 3600 + 30 * 60,
    },
  }),
}));

it('renders the analogue clock beside the text time', () => {
  render(<StatsBar />);

  expect(screen.getByLabelText('3:30 AM')).toBeInTheDocument();
  expect(screen.getByText('3:30 AM')).toBeInTheDocument();
});
