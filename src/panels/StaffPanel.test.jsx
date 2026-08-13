import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import StaffPanel from './StaffPanel';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

import { useGameState, useDispatch } from '../state/GameContext';

afterEach(() => vi.restoreAllMocks());

function makeState(overrides = {}) {
  return {
    staff: [
      { id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 },
      { id: 's2', name: 'Anna', role: 'waiter', skill: 3, morale: 80, salary: 150 },
      { id: 's3', name: 'Luca', role: 'host', skill: 2, morale: 80, salary: 150 },
      { id: 's4', name: 'Mario', role: 'cook', skill: 4, morale: 80, salary: 200 },
    ],
    staffSlots: 3,
    restaurant: { funds: 500 },
    ...overrides,
  };
}

describe('StaffPanel', () => {
  it('shows + Hire button even when staff.length > staffSlots', () => {
    const state = makeState(); // 4 staff, 3 slots
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('+ Hire')).toBeInTheDocument();
    expect(screen.queryByText('Slots Full')).not.toBeInTheDocument();
  });

  it('shows header Staff (current) without slots', () => {
    const base = makeState();
    const state = makeState({ staff: [base.staff[0]], staffSlots: 3 });
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('Staff (1)')).toBeInTheDocument();
    expect(screen.queryByText(/Staff \(1\/3\)/)).not.toBeInTheDocument();
  });

  it('dispatches HIRE_STAFF when clicking a role hire button', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState());
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);

    const hireBtn = screen.getByText('+ Hire');
    fireEvent.click(hireBtn);

    const cookBtn = screen.getByText('Cook');
    act(() => {
      fireEvent.click(cookBtn);
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    const call = dispatch.mock.calls[0][0];
    expect(call.type).toBe('HIRE_STAFF');
    expect(call.staff).toBeDefined();
    expect(call.staff.role).toBe('cook');
    expect(call.staff.name).toBeDefined();
    expect(['male', 'female']).toContain(call.staff.gender);
    expect(call.staff.skill).toBeGreaterThanOrEqual(1);
    expect(call.staff.skill).toBeLessThanOrEqual(3);
    expect(typeof call.staff.salary).toBe('number');
  });

  it('chooses an unused name when hiring', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState());
    useDispatch.mockReturnValue(dispatch);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));
    fireEvent.click(screen.getByText('Cook'));

    const hiredName = dispatch.mock.calls[0][0].staff.name;
    expect(['Marco', 'Anna', 'Luca', 'Mario']).not.toContain(hiredName);
  });

  it('renames a staff member inline', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState());
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const marcoCard = screen.getByText('Marco').parentElement.parentElement;
    fireEvent.click(within(marcoCard).getByText('Rename'));
    fireEvent.change(within(marcoCard).getByRole('textbox'), { target: { value: '  Matteo  ' } });
    fireEvent.click(within(marcoCard).getByText('Save'));

    expect(dispatch).toHaveBeenCalledWith({ type: 'RENAME_STAFF', id: 's1', name: 'Matteo' });
  });

  it('shows staff list entries', () => {
    const state = makeState({
      staff: [
        { id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 },
      ],
    });
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('Marco')).toBeInTheDocument();
    expect(screen.getByText(/cook/)).toBeInTheDocument();
  });

  it('rounds morale to the nearest whole percentage', () => {
    const state = makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 79.6, salary: 200 }],
    });
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('Morale: 80%')).toBeInTheDocument();
  });
});
