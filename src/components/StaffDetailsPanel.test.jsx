import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReducer } from 'react';
import StaffDetailsPanel from './StaffDetailsPanel';
import { gameReducer } from '../state/GameContext';
import { createInitialState } from '../state/initialState';
import { advanceClock } from '../simulation/clock';
import { getStaffTaskProgress } from '../simulation/staffPerformance';

const { mockGameState, mockGameGeneration } = vi.hoisted(() => ({
  mockGameState: { current: null },
  mockGameGeneration: { current: 0 },
}));

// Retain the real reducer and module exports; only the context reads are
// synthetic so component integration never boots the save-enabled provider.
vi.mock('../state/GameContext', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    useGameState: () => mockGameState.current,
    useGameGeneration: () => mockGameGeneration.current,
  };
});

const staff = {
  id: 's1', name: 'Sofia', role: 'waiter', morale: 79.6, salary: 150,
  skill: 3, task: { type: 'take_order' },
};

const allWork = () => Array.from({ length: 48 }, () => 'work');

const takeOrderStaff = {
  ...staff,
  x: 0,
  y: 0,
  task: {
    type: 'take_order', startedAt: 0, accumulatedWork: 30, lastProgressAt: 30,
  },
};

const janitorStaff = {
  id: 'janitor1', name: 'Nina', role: 'janitor', morale: 50, salary: 120,
  skill: 5, x: 200, y: 200, navigationGoal: null,
  task: { type: 'clean_table', tableId: 'table-1' },
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function BonusHarness({ initial, latest }) {
  const [state, dispatch] = useReducer(gameReducer, initial);
  mockGameState.current = state;
  latest.current = { state, dispatch };
  return (
    <StaffDetailsPanel
      staff={state.staff.find(candidate => candidate.id === 'starter-waiter')}
      gameTime={state.restaurant.gameTime}
      dispatch={dispatch}
      onMove={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe('StaffDetailsPanel', () => {
  beforeEach(() => {
    mockGameState.current = null;
    mockGameGeneration.current = 0;
  });

  it('shows effective and requested duty, handoff status, and authoritative timers', () => {
    const schedule = allWork();
    schedule[20] = 'rest';
    render(
      <StaffDetailsPanel
        staff={{
          ...staff,
          schedule,
          effectiveDuty: 'work',
          dutyPhase: 'finishing_task',
          task: { type: 'deliver_service_item' },
          ptoSession: { minimumEndAt: 50_400 },
          amenityUse: { activityEndsAt: 39_600 },
        }}
        gameTime={36_000}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const status = screen.getByTestId('staff-detail-status-s1');
    expect(status).toHaveTextContent(/Effective duty: Work/);
    expect(status).toHaveTextContent(/Requested duty: Rest/);
    expect(status).toHaveTextContent(/finishing delivery/i);
    expect(status).toHaveTextContent(/PTO minimum ends at 14:00/);
    expect(status).toHaveTextContent(/Activity ends at 11:00/);
  });

  it('shows rounded morale and staff details', () => {
    render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Sofia' })).toBeInTheDocument();
    expect(screen.getByText('Waiter')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Taking order')).toBeInTheDocument();
  });

  it('labels the details aside with the staff heading and focuses that heading on open', () => {
    render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onClose={vi.fn()} />);

    const heading = screen.getByRole('heading', { name: 'Sofia' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
    expect(screen.getByRole('complementary', { name: 'Sofia' })).toContainElement(heading);
  });

  it('retains focus on Close across same-id simulation ticks and name updates', () => {
    const { rerender } = render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close staff details' });
    close.focus();

    rerender(
      <StaffDetailsPanel
        staff={{
          ...staff, name: 'Sofia Updated', morale: 42, task: { type: 'clean_table' }, x: 10, y: 20,
        }}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(close).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Sofia Updated' })).not.toHaveFocus();
  });

  it('does not steal focus from an open fire confirmation across same-id ticks', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();

    rerender(
      <StaffDetailsPanel
        staff={{ ...staff, morale: 22, task: { type: 'clean_table' }, x: 10, y: 20 }}
        dispatch={dispatch}
        onClose={onClose}
      />,
    );

    expect(cancel).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Fire Sofia?' })).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('moves focus to the new staff heading when the selected ID changes', () => {
    const { rerender } = render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onClose={vi.fn()} />);

    rerender(
      <StaffDetailsPanel
        staff={{ ...staff, id: 's2', name: 'Marco', morale: 40 }}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Marco' })).toHaveFocus();
    expect(screen.getByRole('complementary', { name: 'Marco' })).toBeInTheDocument();
  });

  it.each([
    ['clean_floor', 'Cleaning floor'],
    ['collect_dirty_item', 'Collecting dirty item'],
    ['deliver_dirty_item', 'Delivering dirty item'],
    ['wash_item', 'Washing item'],
    ['prepare_dish', 'Preparing dish'],
    ['prepare_drink', 'Preparing drink'],
    ['pickup_service_item', 'Collecting order'],
    ['deliver_service_item', 'Delivering order'],
    ['transfer_dirty_item', 'Transferring dirty item'],
  ])('labels %s tasks', (type, label) => {
    render(<StaffDetailsPanel staff={{ ...staff, task: { type } }} dispatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows a cashier assignment for an idle waiter', () => {
    render(
      <StaffDetailsPanel
        staff={{ ...staff, task: null }}
        cashierStations={[{ id: 'cashier1', assignedStaffId: staff.id }]}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Staffing cashier').parentElement)
      .toHaveTextContent('Current task: Staffing cashier');
  });

  it('does not show a cashier assignment for a non-waiter', () => {
    render(
      <StaffDetailsPanel
        staff={{ ...staff, name: 'Marco', role: 'cook', task: null }}
        cashierStations={[{ id: 'cashier1', assignedStaffId: staff.id }]}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Available').some(element => element.parentElement?.textContent === 'Current task: Available'))
      .toBe(true);
    expect(screen.getByTestId('staff-detail-status-s1')).toHaveTextContent('Effective duty: Work');
    expect(screen.queryByText('Staffing cashier')).not.toBeInTheDocument();
  });

  it('keeps an active cleaning task authoritative over a cashier assignment', () => {
    render(
      <StaffDetailsPanel
        staff={{ ...staff, task: { type: 'clean_table' } }}
        cashierStations={[{ id: 'cashier1', assignedStaffId: staff.id }]}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Cleaning table').parentElement)
      .toHaveTextContent('Current task: Cleaning table');
  });

  it('dispatches one bonus, still moves, and fires only after the shared confirmation', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onMove={onMove} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Give bonus ($50)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'GIVE_BONUS', id: 's1' });
    expect(onMove).toHaveBeenCalledWith('s1');
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'FIRE_STAFF', id: 's1' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm fire Sofia' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'FIRE_STAFF', id: 's1' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('places Move directly above the Fire employee trigger', () => {
    const onMove = vi.fn();
    render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onMove={onMove} onClose={vi.fn()} />);

    const move = screen.getByRole('button', { name: 'Move' });
    const fire = screen.getByRole('button', { name: 'Fire Sofia' });
    expect(move.nextElementSibling).toContainElement(fire);
  });

  it('shows the destructive confirmation copy and keeps the panel open until confirmed', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    const onClose = vi.fn();
    render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    const region = screen.getByRole('region', { name: 'Fire Sofia?' });
    expect(region).toHaveTextContent(
      "Fire Sofia (Waiter)? This removes the employee and releases their assigned work. Hiring again does not restore this employee's training.",
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels the confirmation without firing or closing and returns focus', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    const onClose = vi.fn();
    render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Fire Sofia' });
    fireEvent.click(trigger);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);

    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Fire Sofia?' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('cancels the confirmation with Escape without firing or closing', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    const onClose = vi.fn();
    render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Fire Sofia?' })).not.toBeInTheDocument();
  });

  it('keeps the confirmation when a tick replaces the worker object with the same identity', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    rerender(
      <StaffDetailsPanel
        staff={{ ...staff, morale: 22, task: { type: 'clean_table' }, x: 10, y: 20 }}
        dispatch={dispatch}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('region', { name: 'Fire Sofia?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm fire Sofia' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'FIRE_STAFF', id: 's1' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drops an open confirmation when the game generation changes', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    mockGameGeneration.current = 1;
    rerender(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={onClose} />);

    expect(screen.queryByRole('region', { name: 'Fire Sofia?' })).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('blocks firing while a career decision is pending', () => {
    mockGameState.current = { restaurant: { funds: 100 }, careerRun: { needsDecision: true } };
    const dispatch = vi.fn();
    render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Fire Sofia' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);

    expect(screen.queryByRole('region', { name: 'Fire Sofia?' })).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('cannot fire or close once the panel unmounts with a confirmation open', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    unmount();

    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('bounds the panel height and scrolls when the confirmation extends the viewport', () => {
    render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onClose={vi.fn()} />);

    const panel = screen.getByRole('complementary');
    expect(panel.style.overflowY).toBe('auto');
    expect(panel.style.maxHeight).toBe('calc(100vh - 80px)');
  });

  it('shows a read-only salary, midnight cost and bonus preview', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const dispatch = vi.fn();
    render(<StaffDetailsPanel staff={{ ...staff, morale: 80 }} dispatch={dispatch} onClose={vi.fn()} />);

    expect(screen.queryByRole('slider', { name: 'Daily salary for Sofia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply raise' })).not.toBeInTheDocument();
    expect(screen.getByText('Daily salary:')).toHaveTextContent('Daily salary: $150');
    expect(screen.getByText('Paid at midnight.')).toBeInTheDocument();
    expect(screen.getByText('After bonus: morale 100%.')).toBeInTheDocument();
    expect(screen.getByText('One-time payment. Daily salary stays unchanged.')).toBeInTheDocument();

    const bonus = screen.getByRole('button', { name: 'Give bonus ($50)' });
    expect(bonus).toBeEnabled();
    expect(bonus).toHaveAttribute('aria-describedby', 'bonus-preview-s1');

    fireEvent.click(bonus);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'GIVE_BONUS', id: 's1' });
  });

  it('shows Unavailable for an invalid salary without offering adjustment', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    render(<StaffDetailsPanel staff={{ ...staff, salary: -1 }} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Daily salary:')).toHaveTextContent('Daily salary: Unavailable');
    expect(screen.queryByRole('slider', { name: 'Daily salary for Sofia' })).not.toBeInTheDocument();
  });

  it('disables the bonus with a funds reason below the exact cost', () => {
    mockGameState.current = { restaurant: { funds: 49 } };
    render(<StaffDetailsPanel staff={{ ...staff, morale: 80 }} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Give bonus ($50)' })).toBeDisabled();
    expect(screen.getByText('Needs $50 in available funds.')).toBeInTheDocument();
    expect(screen.getByText('After bonus: morale 100%.')).toBeInTheDocument();
  });

  it('enables the bonus at the exact $50 funds boundary', () => {
    mockGameState.current = { restaurant: { funds: 50 } };
    render(<StaffDetailsPanel staff={{ ...staff, morale: 80 }} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Give bonus ($50)' })).toBeEnabled();
    expect(screen.queryByText('Needs $50 in available funds.')).not.toBeInTheDocument();
    expect(screen.queryByText('Funds unavailable.')).not.toBeInTheDocument();
  });

  it.each([
    ['missing funds', { restaurant: {} }],
    ['NaN funds', { restaurant: { funds: Number.NaN } }],
    ['infinite funds', { restaurant: { funds: Number.POSITIVE_INFINITY } }],
    ['no context', null],
  ])('disables the bonus when %s are unavailable', (_label, context) => {
    mockGameState.current = context;
    render(<StaffDetailsPanel staff={{ ...staff, morale: 80 }} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Give bonus ($50)' })).toBeDisabled();
    expect(screen.getByText('Funds unavailable.')).toBeInTheDocument();
  });

  it.each([
    ['full', 100, 'Morale is already full.'],
    ['nonfinite', Number.NaN, 'Morale unavailable.'],
  ])('disables the bonus for %s morale', (_label, morale, reason) => {
    mockGameState.current = { restaurant: { funds: 100 } };
    render(<StaffDetailsPanel staff={{ ...staff, morale }} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Give bonus ($50)' })).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('disables the bonus when morale is missing', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const { morale: _ignored, ...moraleMissing } = staff;
    render(<StaffDetailsPanel staff={moraleMissing} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Give bonus ($50)' })).toBeDisabled();
    expect(screen.getByText('Morale unavailable.')).toBeInTheDocument();
  });

  it('prefers the morale reason over an unavailable funds reason', () => {
    mockGameState.current = null;
    render(<StaffDetailsPanel staff={{ ...staff, morale: Number.NaN }} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Morale unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Funds unavailable.')).not.toBeInTheDocument();
  });

  it('rerenders for the selected staff member, external funds and fractional morale', () => {
    mockGameState.current = { restaurant: { funds: 100 } };
    const { rerender } = render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('After bonus: morale 100%.')).toBeInTheDocument();

    const marco = { ...staff, id: 's2', name: 'Marco', morale: 40 };
    rerender(<StaffDetailsPanel staff={marco} dispatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('After bonus: morale 60%.')).toBeInTheDocument();
    expect(screen.queryByText('After bonus: morale 100%.')).not.toBeInTheDocument();

    mockGameState.current = { restaurant: { funds: 20 } };
    rerender(<StaffDetailsPanel staff={marco} dispatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Needs $50 in available funds.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Give bonus ($50)' })).toBeDisabled();

    mockGameState.current = { restaurant: { funds: 100 } };
    rerender(<StaffDetailsPanel staff={{ ...staff, morale: 79.6 }} dispatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('After bonus: morale 100%.')).toBeInTheDocument();

    rerender(<StaffDetailsPanel staff={{ ...staff, morale: 79.4 }} dispatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('After bonus: morale 99%.')).toBeInTheDocument();
  });

  it('buys one real bonus, caps morale and rejects a repeat at full morale', () => {
    const initial = createInitialState();
    const latest = { current: null };
    render(<BonusHarness initial={initial} latest={latest} />);

    const bonus = screen.getByRole('button', { name: 'Give bonus ($50)' });
    expect(bonus).toBeEnabled();
    fireEvent.click(bonus);

    const afterPurchase = latest.current.state;
    expect(afterPurchase.restaurant.funds).toBe(550);
    expect(afterPurchase.staff.find(worker => worker.id === 'starter-waiter'))
      .toMatchObject({ morale: 100, salary: 150 });
    expect(afterPurchase.staff.find(worker => worker.id === 'starter-cook'))
      .toBe(initial.staff.find(worker => worker.id === 'starter-cook'));

    expect(screen.getByRole('button', { name: 'Give bonus ($50)' })).toBeDisabled();
    expect(screen.getByText('Morale is already full.')).toBeInTheDocument();
    expect(screen.queryByText(/After bonus/)).not.toBeInTheDocument();

    act(() => latest.current.dispatch({ type: 'GIVE_BONUS', id: 'starter-waiter' }));
    expect(latest.current.state).toBe(afterPurchase);
    expect(latest.current.state.restaurant.funds).toBe(550);
  });

  it('rejects a repeat bonus once funds are exhausted through the real reducer', () => {
    const initial = createInitialState();
    const poor = {
      ...initial,
      restaurant: { ...initial.restaurant, funds: 50 },
      staff: initial.staff.map(worker => worker.id === 'starter-waiter'
        ? { ...worker, morale: 79.6 }
        : worker),
    };
    const latest = { current: null };
    render(<BonusHarness initial={poor} latest={latest} />);

    fireEvent.click(screen.getByRole('button', { name: 'Give bonus ($50)' }));

    const afterPurchase = latest.current.state;
    expect(afterPurchase.restaurant.funds).toBe(0);
    expect(afterPurchase.staff.find(worker => worker.id === 'starter-waiter').morale).toBe(99.6);
    expect(screen.getByText('Needs $50 in available funds.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Give bonus ($50)' })).toBeDisabled();

    act(() => latest.current.dispatch({ type: 'GIVE_BONUS', id: 'starter-waiter' }));
    expect(latest.current.state).toBe(afterPurchase);
    expect(latest.current.state.restaurant.funds).toBe(0);
  });

  it('leaves the next midnight payroll unchanged after a bonus', () => {
    const initial = createInitialState();
    const payrollBefore = initial.staff.reduce((total, worker) => total + worker.salary, 0);
    const latest = { current: null };
    render(<BonusHarness initial={initial} latest={latest} />);

    fireEvent.click(screen.getByRole('button', { name: 'Give bonus ($50)' }));
    const afterPurchase = latest.current.state;
    const secondsToMidnight = 86400 - (afterPurchase.restaurant.gameTime % 86400);
    const settled = advanceClock(afterPurchase, secondsToMidnight + 1);

    expect(settled.restaurant.funds).toBe(afterPurchase.restaurant.funds - payrollBefore);
    expect(settled.dailyHistory.at(-1).payroll).toBe(payrollBefore);
    expect(settled.staff.find(worker => worker.id === 'starter-waiter').salary).toBe(150);
  });

  it('shows real take-order work progress from a valid supplied-time snapshot', () => {
    mockGameState.current = {
      restaurant: { gameTime: 40 },
      staff: [{ ...takeOrderStaff }],
    };
    render(
      <StaffDetailsPanel
        staff={takeOrderStaff}
        gameTime={40}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Task work progress' });
    expect(section).toHaveTextContent('Work completed: 72%.');
    expect(section).toHaveTextContent('Work progress only; excludes travel and later service steps.');
    const progress = screen.getByRole('progressbar', { name: 'Task work completed' });
    expect(progress).toHaveAttribute('max', '1');
    expect(Number(progress.getAttribute('value'))).toBeCloseTo(0.716, 10);
  });

  it('uses the real prepare-dish service-item ledger for work progress', () => {
    const cook = {
      ...staff,
      id: 'cook1', name: 'Marco', role: 'cook', x: 100, y: 100,
      task: { type: 'prepare_dish', serviceItemId: 'dish-1' },
    };
    mockGameState.current = {
      restaurant: { gameTime: 40 },
      dishes: [{ id: 'toast', prepTime: 60 }],
      serviceItems: [{
        id: 'dish-1', kind: 'dish', menuItemId: 'toast',
        preparationStartedAt: 0, accumulatedWork: 30, lastProgressAt: 30,
      }],
    };
    render(
      <StaffDetailsPanel
        staff={cook}
        gameTime={40}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Task work progress' });
    expect(section).toHaveTextContent('Work completed: 72%.');
    const progress = screen.getByRole('progressbar', { name: 'Task work completed' });
    expect(Number(progress.getAttribute('value'))).toBeCloseTo(0.716, 10);
  });

  it('uses the real clean-table ledger for work progress', () => {
    mockGameState.current = {
      restaurant: { gameTime: 40 },
      tables: [{
        id: 'table-1',
        status: 'dirty',
        cleaningAction: {
          staffId: 'janitor1', startedAt: 10, accumulatedWork: 20, lastProgressAt: 20,
        },
      }],
    };
    render(
      <StaffDetailsPanel
        staff={janitorStaff}
        gameTime={40}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Task work progress' });
    expect(section).toHaveTextContent('Work completed: 42%.');
    const progress = screen.getByRole('progressbar', { name: 'Task work completed' });
    expect(Number(progress.getAttribute('value'))).toBeCloseTo(50 / 120, 10);
  });

  it('uses the real manual-wash ledger for work progress', () => {
    const washer = {
      ...janitorStaff,
      task: { type: 'wash_item', serviceItemId: 'dish-wash', washStationId: 'sink' },
    };
    mockGameState.current = {
      restaurant: { gameTime: 100 },
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [{
        id: 'dish-wash', kind: 'dish', state: 'washing', washStationId: 'sink',
        washStartedAt: 0, accumulatedWork: 60, lastProgressAt: 60,
      }],
    };
    render(
      <StaffDetailsPanel
        staff={washer}
        gameTime={100}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Task work progress' });
    expect(section).toHaveTextContent('Work completed: 40%.');
    const progress = screen.getByRole('progressbar', { name: 'Task work completed' });
    expect(Number(progress.getAttribute('value'))).toBeCloseTo(0.4, 10);
  });

  it('omits the work section for idle staff with no task', () => {
    mockGameState.current = { restaurant: { gameTime: 40 } };
    const { rerender } = render(
      <StaffDetailsPanel staff={{ ...staff, task: null }} dispatch={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.queryByRole('region', { name: 'Task work progress' })).not.toBeInTheDocument();
    expect(screen.queryByText('Work progress only; excludes travel and later service steps.'))
      .not.toBeInTheDocument();

    rerender(<StaffDetailsPanel staff={{ ...staff, task: undefined }} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole('region', { name: 'Task work progress' })).not.toBeInTheDocument();
  });

  it('shows an unavailable message for an unsupported task without estimating a remaining time', () => {
    mockGameState.current = { restaurant: { gameTime: 40 } };
    render(
      <StaffDetailsPanel
        staff={{ ...staff, task: { type: 'deliver_service_item' } }}
        gameTime={40}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Task work progress' });
    expect(section).toHaveTextContent('Work progress unavailable for this task.');
    expect(section).toHaveTextContent('Work progress only; excludes travel and later service steps.');
    expect(screen.queryByRole('progressbar', { name: 'Task work completed' })).not.toBeInTheDocument();
    expect(section).not.toHaveTextContent(/remaining|ETA/i);
  });

  it('suppresses progress while an unreached navigation goal remains, even when the helper has progress', () => {
    const travelling = {
      ...takeOrderStaff,
      navigationGoal: { x: 200, y: 200 },
    };
    const state = { restaurant: { gameTime: 40 }, staff: [] };
    mockGameState.current = state;
    expect(getStaffTaskProgress(state, travelling)?.progress).toBeGreaterThan(0);

    render(
      <StaffDetailsPanel
        staff={travelling}
        gameTime={40}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Task work progress' });
    expect(section).toHaveTextContent('Travelling or waiting to reach the task.');
    expect(section).toHaveTextContent('Work progress only; excludes travel and later service steps.');
    expect(section).not.toHaveTextContent('Work completed:');
    expect(screen.queryByRole('progressbar', { name: 'Task work completed' })).not.toBeInTheDocument();
    expect(section).not.toHaveTextContent(/remaining|ETA/i);
  });

  it('reveals progress once the worker reaches the task navigation goal', () => {
    const arrived = {
      ...takeOrderStaff,
      x: 200,
      y: 200,
      navigationGoal: { x: 200, y: 200 },
    };
    mockGameState.current = { restaurant: { gameTime: 40 }, staff: [] };
    render(
      <StaffDetailsPanel
        staff={arrived}
        gameTime={40}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Task work progress' });
    expect(section).toHaveTextContent('Work completed: 72%.');
    expect(screen.getByRole('progressbar', { name: 'Task work completed' })).toBeInTheDocument();
  });

  it('falls back to the state game time when no supplied time is available', () => {
    mockGameState.current = { restaurant: { gameTime: 40 }, staff: [] };
    render(<StaffDetailsPanel staff={takeOrderStaff} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Task work progress' }))
      .toHaveTextContent('Work completed: 72%.');
  });

  it('keeps supplied paused time, immutable inputs and deterministic rerenders without RNG', () => {
    const frozenStaff = deepFreeze({ ...takeOrderStaff });
    const frozenState = deepFreeze({
      restaurant: { gameTime: 100 },
      staff: [deepFreeze({ ...takeOrderStaff })],
    });
    mockGameState.current = frozenState;
    const random = vi.spyOn(Math, 'random');

    try {
      const { rerender } = render(
        <StaffDetailsPanel
          staff={frozenStaff}
          gameTime={40}
          dispatch={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByRole('region', { name: 'Task work progress' }))
        .toHaveTextContent('Work completed: 72%.');

      mockGameState.current = deepFreeze({ restaurant: { gameTime: 200 }, staff: [] });
      rerender(
        <StaffDetailsPanel
          staff={frozenStaff}
          gameTime={40}
          dispatch={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByRole('region', { name: 'Task work progress' }))
        .toHaveTextContent('Work completed: 72%.');

      rerender(
        <StaffDetailsPanel
          staff={frozenStaff}
          gameTime={50}
          dispatch={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByRole('region', { name: 'Task work progress' }))
        .toHaveTextContent('Work completed: 93%.');
      const progress = screen.getByRole('progressbar', { name: 'Task work completed' });
      expect(Number(progress.getAttribute('value'))).toBeCloseTo(0.932, 10);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});
