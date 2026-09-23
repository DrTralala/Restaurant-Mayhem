import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useDispatch, useGameState } from './state/GameContext';
import { evaluateCareerRun } from './simulation/careerRun';
import { createInitialState } from './state/initialState';

vi.mock('./state/SimulationRuntime', () => ({ default: ({ children }) => children,
  useRuntimeFault: () => ({ fault: null }) }));
vi.mock('./canvas/RestaurantCanvas', () => ({ default: function Canvas({ managementOpen, placementRequest }) {
  const state = useGameState();
  const dispatch = useDispatch();
  return <div data-testid="canvas" data-management-open={String(managementOpen)} data-placement={String(placementRequest)}>
    <button onClick={() => dispatch({ type: 'TICK', nextState: { ...state,
      restaurant: { ...state.restaurant, gameTime: 640800, day: 8 },
      careerRun: evaluateCareerRun(state.careerRun, { gameTime: 640800, reputation: 1 }),
    } })}>Complete synthetic career</button>
    <output data-testid="run-status">{state.careerRun?.status ?? 'sandbox'}</output>
  </div>;
} }));

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
function startCareer() {
  fireEvent.click(screen.getByRole('button', { name: 'Management' }));
  fireEvent.click(screen.getByRole('button', { name: 'Opening Week', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Start Opening Week', exact: true }));
}

describe('shared feature UI routes', () => {
  it('loads invalid career-only progress visibly and cancels a new run without losing the restaurant', () => {
    const state = createInitialState();
    state.restaurant.funds = 432;
    state.careerRun = { schemaVersion: 999 };
    localStorage.setItem('restaurant-sim-save', JSON.stringify(state));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    expect(screen.getByRole('dialog', { name: 'Opening Week progress cannot be verified' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start new Opening Week' }));
    expect(screen.getByTestId('run-status')).toHaveTextContent('invalid');
    expect(JSON.parse(localStorage.getItem('restaurant-sim-save')).restaurant.funds).toBe(432);
    fireEvent.click(screen.getByRole('button', { name: 'Continue as sandbox' }));
    expect(screen.getByTestId('run-status')).toHaveTextContent('continued');
  });
  it('registers Contracts and Opening Week without changing an unconfirmed sandbox', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    startCareer();
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/No backup is created/));
    expect(screen.getByTestId('run-status')).toHaveTextContent('sandbox');
    expect(screen.getByRole('button', { name: 'Contracts', exact: true })).toBeInTheDocument();
    expect(localStorage.getItem('restaurant-sim-save')).toBeNull();
  });
  it('starts after confirmation, closes management, shows goals/countdown and a contract tracker', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    startCareer();
    expect(screen.getByTestId('run-status')).toHaveTextContent('active');
    expect(screen.queryByRole('button', { name: 'Start Opening Week' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Opening Week progress/ })).toHaveTextContent(/0 \/ 80/);
    expect(screen.getByRole('button', { name: /Opening Week progress/ })).toHaveTextContent(/Day 8, 10:00 AM/);
    fireEvent.click(screen.getByRole('button', { name: 'Management' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contracts', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept and start preparation' }));
    expect(screen.getByRole('button', { name: 'View contracts' })).toBeInTheDocument();
  });
  it.each(['Escape', 'Settings toggle'])('keeps one Settings focus owner and restores the pending result via %s', closeRoute => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    startCareer();
    fireEvent.click(screen.getByRole('button', { name: 'Complete synthetic career' }));
    let dialog = screen.getByRole('dialog', { name: 'Opening Week target missed' });
    expect(screen.getByTestId('canvas').parentElement).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Pause game' })).toBeDisabled();
    const terminalSave = localStorage.getItem('restaurant-sim-save');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('dialog', { name: 'Opening Week target missed' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Load game' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save game' })).toHaveFocus();
    expect(screen.getByTestId('run-status')).toHaveTextContent('lost');
    expect(screen.getByTestId('canvas').parentElement).toHaveAttribute('inert');
    screen.getByRole('button', { name: 'New game' }).focus();
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Save game' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'New game' })).toHaveFocus();
    if (closeRoute === 'Escape') fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Opening Week target missed');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByRole('heading')).toHaveFocus();
    expect(localStorage.getItem('restaurant-sim-save')).toBe(terminalSave);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue as sandbox' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-status')).toHaveTextContent('continued');
    expect(screen.getByRole('button', { name: 'Management' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Opening Week progress/ })).not.toBeInTheDocument();
  });
  it('Retry confirms once, preserves Cancel and creates a different fresh attempt on acceptance', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    startCareer();
    const first = JSON.parse(localStorage.getItem('restaurant-sim-save')).careerRun.runId;
    fireEvent.click(screen.getByRole('button', { name: 'Complete synthetic career' }));
    confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Opening Week' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Opening Week' }));
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const next = JSON.parse(localStorage.getItem('restaurant-sim-save'));
    expect(next.careerRun.runId).not.toBe(first);
    expect(next.careerRun.paidMeals).toBe(0);
    expect(next.restaurant.gameTime).toBe(36000);
  });
  it('existing New game is explicitly confirmed sandbox replacement, including during a career', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    startCareer();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByTestId('run-status')).toHaveTextContent('active');
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByTestId('run-status')).toHaveTextContent('sandbox');
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/sandbox.*replaces.*career/i));
  });
});
