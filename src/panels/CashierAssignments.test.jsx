import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CashierAssignments from './CashierAssignments';

vi.mock('../state/GameContext', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    useGameState: vi.fn(),
    useDispatch: vi.fn(),
  };
});

import { useGameState, useDispatch } from '../state/GameContext';

function makeState(overrides = {}) {
  return {
    restaurant: { gameTime: 0 },
    staff: [
      { id: 'w1', name: 'Ada', role: 'waiter', task: null },
      { id: 42, name: 'Bea', role: 'waiter', task: null },
    ],
    cashierStations: [{ id: 2, x: 800, y: 120, w: 40, h: 40, assignedStaffId: 'w1' }],
    customers: [],
    ...overrides,
  };
}

describe('CashierAssignments', () => {
  beforeEach(() => {
    useGameState.mockReset();
    useDispatch.mockReset();
  });

  it('maps the selected DOM option to the record ID and dispatches only on Apply', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState());
    useDispatch.mockReturnValue(dispatch);

    render(<CashierAssignments />);

    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const bea = screen.getByRole('option', { name: 'Bea' });
    fireEvent.change(select, { target: { value: bea.value } });

    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply station 2 assignment' }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'ASSIGN_CASHIER', stationId: 2, staffId: 42,
    });
  });

  it('dispatches an explicit null when clearing a safe station', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState());
    useDispatch.mockReturnValue(dispatch);

    render(<CashierAssignments />);
    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const unassigned = screen.getByRole('option', { name: 'Unassigned' });
    fireEvent.change(select, { target: { value: unassigned.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply station 2 assignment' }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'ASSIGN_CASHIER', stationId: 2, staffId: null,
    });
  });

  it('disables all changes and explains an active target checkout', () => {
    useGameState.mockReturnValue(makeState({
      cashierStations: [{ id: 2, x: 800, y: 120, w: 40, h: 40 }],
      customers: [{ id: 'c1', state: 'checkout_moving', cashierStationId: 2 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<CashierAssignments />);

    expect(screen.getByRole('option', { name: 'Ada' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Bea' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply station 2 assignment' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/checkout.*wait/i);
  });

  it('disables a waiter whose source cashier is still handling a checkout', () => {
    useGameState.mockReturnValue(makeState({
      cashierStations: [
        { id: 'source', assignedStaffId: 'w1' },
        { id: 'target' },
      ],
      customers: [{ id: 'c1', state: 'checkout_processing', cashierStationId: 'source' }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<CashierAssignments />);

    const target = screen.getByRole('combobox', { name: 'Cashier assignment for station target' });
    expect(within(target).getByRole('option', { name: 'Ada' })).toBeDisabled();
    expect(within(target).getByRole('option', { name: 'Bea' })).toBeEnabled();
  });

  it('shows the current ineligible owner without offering that waiter as a candidate', () => {
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 'w1', name: 'Ada', role: 'waiter', task: null, effectiveDuty: 'pto' },
        { id: 42, name: 'Bea', role: 'waiter', task: null },
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<CashierAssignments />);

    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const currentOwner = screen.getByRole('option', { name: /Ada.*currently assigned.*unavailable/i });
    const bea = screen.getByRole('option', { name: 'Bea' });
    expect(currentOwner).toBeDisabled();
    expect(bea).toBeEnabled();

    fireEvent.change(select, { target: { value: bea.value } });

    expect(select).toHaveValue(bea.value);
    expect(within(select).getByRole('option', {
      name: /Ada.*currently assigned.*unavailable/i,
    })).toBeDisabled();
  });

  it('disables assignment controls while a career decision is pending', () => {
    useGameState.mockReturnValue(makeState({ careerRun: { needsDecision: true } }));
    useDispatch.mockReturnValue(vi.fn());

    render(<CashierAssignments />);

    expect(screen.getByRole('combobox', { name: 'Cashier assignment for station 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply station 2 assignment' })).toBeDisabled();
    expect(screen.getByText(/resolve the career decision/i)).toBeInTheDocument();
  });

  it('rechecks waiter eligibility on rerender and disables a stale selection', () => {
    const dispatch = vi.fn();
    let state = makeState({ cashierStations: [{ id: 2, x: 800, y: 120, w: 40, h: 40 }] });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<CashierAssignments />);
    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const bea = screen.getByRole('option', { name: 'Bea' });
    fireEvent.change(select, { target: { value: bea.value } });
    expect(screen.getByRole('button', { name: 'Apply station 2 assignment' })).toBeEnabled();

    state = {
      ...state,
      staff: state.staff.map(worker => worker.id === 42
        ? { ...worker, task: { type: 'clean_table' } }
        : worker),
    };
    rerender(<CashierAssignments />);

    expect(screen.getByRole('option', { name: /Bea.*unavailable/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply station 2 assignment' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/waiter.*eligible/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no cashier stations', () => {
    useGameState.mockReturnValue(makeState({ cashierStations: [] }));
    useDispatch.mockReturnValue(vi.fn());

    const { container } = render(<CashierAssignments />);

    expect(container).toBeEmptyDOMElement();
  });
});
