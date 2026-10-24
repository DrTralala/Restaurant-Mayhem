import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatsBar from './StatsBar';
import { createCareerRun } from '../simulation/careerRun';
import { createServiceContractsState } from '../simulation/serviceContracts';
import { SERVICE_CONTRACT_RULES_VERSION } from '../data/serviceContracts';

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
  state.restaurant.funds = 600;
  delete state.careerRun;
  delete state.serviceContracts;
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

it.each([
  [622.5, '$622.50'],
  [600, '$600'],
  [-12.5, '$-12.50'],
  [0, '$0'],
  [Number.NaN, 'Unavailable'],
  [undefined, 'Unavailable'],
])('formats funds %s as %s with a named funds value', (funds, formatted) => {
  state.restaurant.funds = funds;

  render(<StatsBar />);

  const fundsValue = screen.getByRole('group', { name: `Funds: ${formatted}` });
  expect(fundsValue).toBe(screen.getByLabelText(`Funds: ${formatted}`));
  expect(fundsValue).toHaveTextContent(formatted);
  expect(fundsValue).toHaveStyle({ color: '#f0a500' });
});

it('rerenders fractional funds without changing career or contract tracking', () => {
  state.careerRun = createCareerRun({ scenarioId: 'opening-week', runId: 'hud', startedAt: 36000 });
  state.restaurant.gameTime = 640799.9;
  state.restaurant.reputation = 1.999;
  state.restaurant.funds = 622.5;
  state.serviceContracts = createServiceContractsState();
  state.serviceContracts.active = {
    instanceId: 'sc-1', templateId: 'office-lunch', acceptedDay: 1, acceptedAt: 36000,
    serviceStartAt: 36900, deadlineAt: 41100, target: 4, reward: 90,
    rulesVersion: SERVICE_CONTRACT_RULES_VERSION, parties: [], guests: [],
  };

  const { rerender } = render(<StatsBar />);
  const initialFunds = screen.getByRole('group', { name: 'Funds: $622.50' });
  expect(initialFunds).toBe(screen.getByLabelText('Funds: $622.50'));
  expect(screen.getByRole('button', { name: 'Opening Week progress' }))
    .toHaveTextContent('Reputation: 1.999 / 2.00 — below target');
  expect(screen.getByLabelText('Service contract tracker')).toHaveTextContent('Office lunch');

  state.restaurant.funds = 600;
  rerender(<StatsBar />);

  const updatedFunds = screen.getByRole('group', { name: 'Funds: $600' });
  expect(updatedFunds).toBe(screen.getByLabelText('Funds: $600'));
  expect(updatedFunds).toHaveTextContent('$600');
  expect(screen.queryByRole('group', { name: 'Funds: $622.50' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Funds: $622.50')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Opening Week progress' }))
    .toHaveTextContent('Reputation: 1.999 / 2.00 — below target');
  expect(screen.getByLabelText('Service contract tracker')).toHaveTextContent('Office lunch');
});
