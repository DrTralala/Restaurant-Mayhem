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

function expectUniqueOptionLabels(select) {
  const labels = within(select).getAllByRole('option').map(option =>
    option.textContent.replace(/\s+/g, ' ').trim());
  expect(new Set(labels).size).toBe(labels.length);
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

  it('distinguishes same-name waiters by typed ID and preserves ID types on Apply', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 1, name: 'Alex', role: 'waiter', task: null },
        { id: '1', name: 'Alex', role: 'waiter', task: null },
        { id: 2, name: 'Bea', role: 'waiter', task: null },
      ],
      cashierStations: [{ id: 2, x: 800, y: 120, w: 40, h: 40 }],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<CashierAssignments />);

    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const numericAlex = screen.getByRole('option', { name: 'Alex (number:1)' });
    const stringAlex = screen.getByRole('option', { name: 'Alex (string:1)' });
    expect(screen.getByRole('option', { name: 'Bea' })).toBeInTheDocument();
    expect(numericAlex.value).not.toBe(stringAlex.value);

    fireEvent.change(select, { target: { value: numericAlex.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply station 2 assignment' }));
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'ASSIGN_CASHIER', stationId: 2, staffId: 1,
    });

    fireEvent.change(select, { target: { value: stringAlex.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply station 2 assignment' }));
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'ASSIGN_CASHIER', stationId: 2, staffId: '1',
    });
  });

  it('uses safe fallback labels for unnamed waiters and unavailable current owners', () => {
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 'owner', name: '   ', role: 'waiter', task: null, effectiveDuty: 'pto' },
        { id: 42, role: 'waiter', task: null },
      ],
      cashierStations: [{ id: 2, x: 800, y: 120, w: 40, h: 40, assignedStaffId: 'owner' }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<CashierAssignments />);

    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const currentOwner = screen.getByRole('option', {
      name: 'owner (currently assigned, unavailable)',
    });
    const unnamedWaiter = screen.getByRole('option', { name: '42' });
    expect(currentOwner).toBeDisabled();

    fireEvent.change(select, { target: { value: unnamedWaiter.value } });

    expect(screen.getByRole('option', {
      name: 'owner (currently assigned, unavailable)',
    })).toBeDisabled();
  });

  it('keeps unavailable-owner status labels distinct from literal staff names', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 'owner', name: 'Alex', role: 'waiter', task: null, effectiveDuty: 'pto' },
        {
          id: 'candidate', name: 'Alex (currently assigned, unavailable)',
          role: 'waiter', task: null,
        },
      ],
      cashierStations: [{ id: 2, x: 800, y: 120, w: 40, h: 40, assignedStaffId: 'owner' }],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<CashierAssignments />);

    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const ownerOption = within(select).getAllByRole('option')
      .find(option => option.value === 'waiter:string:owner');
    const candidateOption = within(select).getAllByRole('option')
      .find(option => option.value === 'waiter:string:candidate');
    expect(ownerOption).toBeDefined();
    expect(candidateOption).toBeDefined();
    expectUniqueOptionLabels(select);

    fireEvent.change(select, { target: { value: candidateOption.value } });
    expectUniqueOptionLabels(select);
    fireEvent.click(screen.getByRole('button', { name: 'Apply station 2 assignment' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ASSIGN_CASHIER', stationId: 2, staffId: 'candidate',
    });
  });

  it('keeps generated typed suffixes distinct from literal staff names', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 1, name: 'Alex', role: 'waiter', task: null },
        { id: '1', name: 'Alex', role: 'waiter', task: null },
        { id: 'literal', name: 'Alex (number:1)', role: 'waiter', task: null },
        { id: 7, name: 'Bea', role: 'waiter', task: null },
      ],
      cashierStations: [{ id: 2, x: 800, y: 120, w: 40, h: 40 }],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<CashierAssignments />);

    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const numericAlex = within(select).getAllByRole('option')
      .find(option => option.value === 'waiter:number:1');
    expectUniqueOptionLabels(select);
    expect(numericAlex.value).toBe('waiter:number:1');
    expect(screen.getByRole('option', { name: 'Bea' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: numericAlex.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply station 2 assignment' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ASSIGN_CASHIER', stationId: 2, staffId: 1,
    });
  });

  it('keeps the Unassigned option distinct from a waiter named Unassigned', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [{ id: 'worker', name: 'Unassigned', role: 'waiter', task: null }],
      cashierStations: [{ id: 2, x: 800, y: 120, w: 40, h: 40 }],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<CashierAssignments />);

    const select = screen.getByRole('combobox', { name: 'Cashier assignment for station 2' });
    const workerOption = within(select).getAllByRole('option')
      .find(option => option.value === 'waiter:string:worker');
    expectUniqueOptionLabels(select);
    expect(workerOption.value).toBe('waiter:string:worker');

    fireEvent.change(select, { target: { value: workerOption.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply station 2 assignment' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ASSIGN_CASHIER', stationId: 2, staffId: 'worker',
    });
  });

  it('rerenders staff labels when a waiter is renamed', () => {
    let state = makeState();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<CashierAssignments />);

    expect(screen.getByRole('option', { name: 'Ada' })).toBeInTheDocument();
    state = {
      ...state,
      staff: state.staff.map(worker => worker.id === 'w1'
        ? { ...worker, name: 'Ada Renamed' }
        : worker),
    };
    rerender(<CashierAssignments />);

    expect(screen.queryByRole('option', { name: 'Ada' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ada Renamed' })).toBeInTheDocument();
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
