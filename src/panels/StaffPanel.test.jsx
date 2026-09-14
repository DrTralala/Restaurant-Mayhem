import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import StaffPanel from './StaffPanel';
import { FONT_FAMILY } from '../typography';

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
      { id: 's3', name: 'Luca', role: 'waiter', skill: 2, morale: 80, salary: 150 },
      { id: 's4', name: 'Mario', role: 'cook', skill: 4, morale: 80, salary: 200 },
    ],
    staffSlots: 7,
    restaurant: { funds: 500 },
    ...overrides,
  };
}

function getStaffCard(id) {
  return screen.getAllByTestId('staff-card').find(card => card.dataset.staffId === id);
}

describe('StaffPanel', () => {
  it('renders four accessible role filters and sorts a copied list by skill then stable ID', () => {
    const staff = [
      { id: 'z-worker', name: 'Zed', role: 'cook', skill: 2, morale: 80, salary: 200 },
      { id: 'a-worker', name: 'Ada', role: 'waiter', skill: 10, morale: 80, salary: 150 },
      { id: 'm-worker', name: 'Mia', role: 'janitor', skill: 2, morale: 80, salary: 120 },
      { id: 'b-worker', name: 'Bea', role: 'waiter', skill: 1, morale: 80, salary: 150 },
    ];
    const sourceOrder = [...staff];
    useGameState.mockReturnValue(makeState({ staff }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getAllByRole('button', { name: /^(All|Cooks|Waiters|Janitors)$/ })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('staff-card').map(card => card.dataset.staffId))
      .toEqual(['a-worker', 'm-worker', 'z-worker', 'b-worker']);
    expect(staff).toEqual(sourceOrder);
    expect(staff).toEqual([
      expect.objectContaining({ id: 'z-worker', skill: 2 }),
      expect.objectContaining({ id: 'a-worker', skill: 10 }),
      expect.objectContaining({ id: 'm-worker', skill: 2 }),
      expect.objectContaining({ id: 'b-worker', skill: 1 }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Cooks' }));
    expect(screen.getByRole('button', { name: 'Cooks' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('staff-card').map(card => card.dataset.staffId)).toEqual(['z-worker']);

    fireEvent.click(screen.getByRole('button', { name: 'Waiters' }));
    expect(screen.getAllByTestId('staff-card').map(card => card.dataset.staffId))
      .toEqual(['a-worker', 'b-worker']);

    fireEvent.click(screen.getByRole('button', { name: 'Janitors' }));
    expect(screen.getAllByTestId('staff-card').map(card => card.dataset.staffId)).toEqual(['m-worker']);
  });

  it('preserves a worker schedule draft when another worker training changes card order', () => {
    let state = makeState({
      restaurant: { funds: 2000 },
      staff: [
        { id: 'z-worker', name: 'Draft', role: 'cook', skill: 4, morale: 80, salary: 200 },
        { id: 'a-worker', name: 'Trainer', role: 'waiter', skill: 3, morale: 80, salary: 150 },
      ],
    });
    const dispatch = vi.fn(action => {
      if (action.type !== 'TRAIN_STAFF') return;
      state = {
        ...state,
        staff: state.staff.map(worker => worker.id === action.id
          ? { ...worker, skill: worker.skill + 1 }
          : worker),
      };
    });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    const draftCard = getStaffCard('z-worker');
    fireEvent.click(within(draftCard).getByRole('button', { name: 'Edit schedule for Draft' }));
    fireEvent.change(within(draftCard).getByRole('combobox', { name: '00:00 to 00:30' }), {
      target: { value: 'rest' },
    });

    fireEvent.click(within(getStaffCard('a-worker')).getByRole('button', { name: /^Train/ }));
    rerender(<StaffPanel />);

    expect(screen.getAllByTestId('staff-card').map(card => card.dataset.staffId))
      .toEqual(['a-worker', 'z-worker']);
    expect(within(getStaffCard('z-worker'))
      .getByRole('combobox', { name: '00:00 to 00:30' })).toHaveValue('rest');
  });

  it('cancels a schedule draft and restores the source schedule on the next edit', () => {
    useGameState.mockReturnValue(makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.change(within(card).getByRole('combobox', { name: '00:00 to 00:30' }), {
      target: { value: 'rest' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel schedule' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));

    expect(within(card).getByRole('combobox', { name: '00:00 to 00:30' })).toHaveValue('work');
  });

  it('keeps invalid schedule drafts open with a readable reason and does not dispatch', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 }],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.change(within(card).getByRole('combobox', { name: '00:00 to 00:30' }), {
      target: { value: 'pto' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Apply schedule' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/14 half-hour slots|7 in-game hours/i);
  });

  it('does not disable hiring or show a legacy staff-slot denominator', () => {
    const state = makeState({
      staffSlots: 7,
      staff: Array.from({ length: 8 }, (_, index) => ({
        id: `s${index + 1}`, name: `Staff ${index + 1}`, role: 'waiter', skill: 1, morale: 80, salary: 150,
      })),
    });
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('+ Hire')).toBeEnabled();
    expect(screen.getByText('Staff (8)')).toBeInTheDocument();
    expect(screen.queryByText('Staff (8/7)')).not.toBeInTheDocument();
  });

  it('shows and dispatches the shared training price for the current skill', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 }],
      restaurant: { funds: 620 },
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);

    const train = screen.getByRole('button', { name: 'Train ($620)' });
    expect(train).toBeEnabled();
    fireEvent.click(train);

    expect(dispatch).toHaveBeenCalledWith({ type: 'TRAIN_STAFF', id: 's1', cost: 620 });
  });

  it('keeps hiring enabled when six staff members are already employed', () => {
    const base = makeState();
    const state = makeState({
      staffSlots: 6,
      staff: [
        ...base.staff,
        { id: 's5', name: 'Sofia', role: 'waiter', skill: 2, morale: 80, salary: 150 },
        { id: 's6', name: 'Elena', role: 'waiter', skill: 2, morale: 80, salary: 150 },
      ],
    });
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('+ Hire')).toBeEnabled();
  });

  it('shows the current staff count without a legacy slot denominator', () => {
    const base = makeState();
    const state = makeState({ staff: [base.staff[0]] });
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('Staff (1)')).toBeInTheDocument();
  });

  it('disables hire controls that are unaffordable', () => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 119 } }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    expect(screen.getByText('+ Hire')).toBeDisabled();
  });

  it('disables the primary hire control when no role is affordable', () => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 119 } }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('+ Hire')).toBeDisabled();
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

  it.each([
    [0, 1],
    [0.999999, 3],
  ])('keeps random hire skill at the %s boundary', (randomValue, expectedSkill) => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState());
    useDispatch.mockReturnValue(dispatch);
    vi.spyOn(Math, 'random').mockReturnValue(randomValue);

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));
    fireEvent.click(screen.getByText('Cook'));

    expect(dispatch.mock.calls[0][0].staff.skill).toBe(expectedSkill);
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

  it('dispatches a janitor hire with a $120 salary', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 500 } }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));
    fireEvent.click(screen.getByText('Janitor'));

    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'HIRE_STAFF',
      staff: { role: 'janitor', salary: 120 },
    });
  });

  it('renames a staff member inline', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState());
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const marcoCard = screen.getByText('Marco').parentElement.parentElement;
    fireEvent.click(within(marcoCard).getByText('Rename'));
    const renameInput = within(marcoCard).getByRole('textbox');
    expect(renameInput).toHaveStyle({ fontFamily: FONT_FAMILY, fontSize: '14px' });
    fireEvent.change(renameInput, { target: { value: '  Matteo  ' } });
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
    expect(within(getStaffCard('s1')).getByText(/Cook/)).toBeInTheDocument();
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
