import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CareerPanel from './CareerPanel';
import { useGameState } from '../state/GameContext';
import { continueCareerAsSandbox, createCareerRun, evaluateCareerRun, normaliseCareerRun } from '../simulation/careerRun';

vi.mock('../state/GameContext', () => ({ useGameState: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const fresh = () => createCareerRun({ scenarioId: 'opening-week', runId: 'run-1', startedAt: 36000 });
function state(careerRun = null, gameTime = 36000, reputation = 1) {
  useGameState.mockReturnValue({ careerRun, restaurant: { gameTime, reputation } });
}

describe('CareerPanel', () => {
  it('briefs sandbox players on goals, seven full days, normal starter conditions and replacement', () => {
    state();
    const onStartRequested = vi.fn();
    render(<CareerPanel onStartRequested={onStartRequested} />);
    expect(screen.getByRole('heading', { name: 'Opening Week' })).toBeInTheDocument();
    expect(screen.getByText(/80 fulfilled, paid meals/)).toBeInTheDocument();
    expect(screen.getByText(/2.00 reputation/)).toBeInTheDocument();
    expect(screen.getByText(/Seven full days: Day 1, 10:00 AM → Day 8, 10:00 AM/)).toBeInTheDocument();
    expect(screen.getByText(/\$600/)).toHaveTextContent(/one star/);
    expect(screen.getByText(/Debt and profit are not scored/)).toBeInTheDocument();
    expect(screen.getByText(/No early victory/)).toBeInTheDocument();
    expect(screen.getByText(/No backup is created/)).toBeInTheDocument();
    expect(screen.getByText(/development server/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start Opening Week' }));
    expect(onStartRequested).toHaveBeenCalledTimes(1);
    expect(onStartRequested).toHaveBeenCalledWith();
  });
  it('requests the controlled start route without replacing state or touching storage on cancellation', () => {
    state();
    const current = useGameState();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    // The parent owns Start confirmation. A cancelled request performs no transition.
    render(<CareerPanel onStartRequested={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Opening Week' }));
    expect(useGameState()).toBe(current);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it.each([
    [36000, '7 days 0 hours 0 minutes'],
    [640739, '0 days 0 hours 2 minutes'],
    [640740, '0 days 0 hours 1 minute'],
    [640799.5, 'Under 1 minute'],
    [640800, 'Deadline reached'],
  ])('renders game-clock countdown at %s as %s', (gameTime, remaining) => {
    state({ ...fresh(), paidMeals: 80 }, gameTime, 1.999);
    render(<CareerPanel />);
    expect(screen.getByText(`Remaining: ${remaining}`)).toBeInTheDocument();
    expect(screen.getByText(/Deadline: Day 8, 10:00 AM/)).toBeInTheDocument();
    expect(screen.getByText(/Paid meals: 80 \/ 80/)).toHaveTextContent(/provisional/i);
    expect(screen.getByText(/Reputation: 1.999/)).toHaveTextContent(/below target/i);
    expect(screen.getByText(/Reputation is checked at the end/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Opening Week' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('explains meal eligibility rather than counting tips, cancelled food or paid drinks', () => {
    state(fresh());
    render(<CareerPanel />);
    expect(screen.getByText(/delivered, not cancelled/)).toHaveTextContent(/positive dish charge/);
    expect(screen.getByText(/Drinks, free dishes, tips and bonuses do not count/)).toBeInTheDocument();
    expect(screen.getByText(/Closing this panel does not pause/)).toBeInTheDocument();
    expect(screen.getByText(/Closing the restaurant does not pause the deadline/)).toBeInTheDocument();
  });
  it('shows a frozen result and requests the parent result presentation', () => {
    const terminal = evaluateCareerRun({ ...fresh(), paidMeals: 79 }, { gameTime: 640800, reputation: 2.13 });
    state(terminal, 640800, 1);
    const onShowResult = vi.fn();
    render(<CareerPanel onShowResult={onShowResult} />);
    expect(screen.getByText(/Reputation: 2.13 \/ 2.00/)).toHaveTextContent(/met/);
    expect(screen.getByText(/Paid meals: 79 \/ 80/)).toHaveTextContent(/not met/);
    fireEvent.click(screen.getByRole('button', { name: 'Show result' }));
    expect(onShowResult).toHaveBeenCalledWith();
  });
  it('archives the score after Continue and offers a newly confirmed run without a countdown', () => {
    const terminal = evaluateCareerRun({ ...fresh(), paidMeals: 80 }, { gameTime: 640800, reputation: 2.13 });
    state(continueCareerAsSandbox(terminal), 700000, 1);
    render(<CareerPanel onStartRequested={() => {}} />);
    expect(screen.getByText('Playing as sandbox')).toBeInTheDocument();
    expect(screen.getByText(/Reputation: 2.13/)).toBeInTheDocument();
    expect(screen.queryByText(/Remaining:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show result' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Opening Week' })).toBeInTheDocument();
  });
  it('shows non-scoring recovery for invalid progress instead of fabricated goals', () => {
    const { run } = normaliseCareerRun({}, { gameTime: 50000, paidVisitSequence: 0 });
    state(run, 50000);
    render(<CareerPanel onShowResult={() => {}} />);
    expect(screen.getByText(/progress cannot be verified/)).toHaveTextContent(/not a win or loss/);
    expect(screen.queryByText(/Paid meals: 0 \/ 80/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show recovery options' })).toBeInTheDocument();
  });
});
