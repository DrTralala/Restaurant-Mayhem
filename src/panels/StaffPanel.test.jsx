import { useLayoutEffect, useReducer } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import StaffPanel from './StaffPanel';
import ManagementModal from './ManagementModal';
import { FONT_FAMILY } from '../typography';
import { createInitialState } from '../state/initialState';

const trainingCostOverride = vi.hoisted(() => ({ value: undefined }));

vi.mock('../state/GameContext', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    useGameState: vi.fn(),
    useDispatch: vi.fn(),
    useGameGeneration: vi.fn(),
  };
});

vi.mock('../simulation/staffProgression', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    getStaffTrainingCost: worker => (trainingCostOverride.value === undefined
      ? actual.getStaffTrainingCost(worker)
      : trainingCostOverride.value),
  };
});

import { useGameState, useDispatch, useGameGeneration, gameReducer } from '../state/GameContext';

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  useGameGeneration.mockReturnValue(0);
  trainingCostOverride.value = undefined;
});

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

const panelHarness = { current: null };

function StatefulStaffPanel({ initial }) {
  const [state, dispatch] = useReducer(gameReducer, initial);
  panelHarness.current = { state, dispatch };
  return <StaffPanel />;
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
    fireEvent.change(within(draftCard).getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.change(within(draftCard).getByRole('combobox', { name: 'From' }), { target: { value: '0' } });
    fireEvent.change(within(draftCard).getByRole('combobox', { name: 'To' }), { target: { value: '2' } });
    fireEvent.click(within(draftCard).getByRole('button', { name: 'Set range' }));

    fireEvent.click(within(getStaffCard('a-worker')).getByRole('button', { name: /^Train/ }));
    rerender(<StaffPanel />);

    expect(screen.getAllByTestId('staff-card').map(card => card.dataset.staffId))
      .toEqual(['a-worker', 'z-worker']);
    expect(within(getStaffCard('z-worker'))
      .getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*1 hour/);
  });

  it('cancels a schedule draft and restores the source schedule on the next edit', () => {
    useGameState.mockReturnValue(makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.change(within(card).getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.change(within(card).getByRole('combobox', { name: 'From' }), { target: { value: '0' } });
    fireEvent.change(within(card).getByRole('combobox', { name: 'To' }), { target: { value: '2' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Set range' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel schedule' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));

    expect(within(card).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Work:\s*24 hours/);
    expect(within(card).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*0 hours/);
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
    fireEvent.change(within(card).getByRole('combobox', { name: 'Duty' }), { target: { value: 'pto' } });
    fireEvent.change(within(card).getByRole('combobox', { name: 'From' }), { target: { value: '0' } });
    fireEvent.change(within(card).getByRole('combobox', { name: 'To' }), { target: { value: '2' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Set range' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Apply schedule' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/14 half-hour slots|7 in-game hours/i);
  });

  it('copies another worker schedule into the open draft without dispatching immediately', () => {
    const copiedSchedule = Array.from({ length: 48 }, (_mode, index) => index === 44 ? 'rest' : 'work');
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 },
        { id: 's2', name: 'Anna', role: 'waiter', skill: 3, morale: 80, salary: 150, schedule: copiedSchedule },
      ],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));

    const copyFrom = within(card).getByRole('combobox', { name: 'Copy from' });
    expect(within(card).getByRole('option', { name: 'Anna' })).toBeInTheDocument();
    expect(within(card).queryByRole('option', { name: 'Marco' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Copy schedule' })).toBeDisabled();

    fireEvent.change(copyFrom, { target: { value: 's2' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Copy schedule' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(within(card).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*0\.5 hours/);
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

  it('keeps the + Hire toggle enabled when funds are below every role salary', () => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 119 } }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(screen.getByText('+ Hire')).toBeEnabled();
  });

  it('disables every unaffordable role purchase while funds are below all salaries', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 119 } }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));

    ['Cook', 'Waiter', 'Janitor'].forEach(roleName => {
      const roleButton = screen.getByRole('button', { name: roleName });
      expect(roleButton).toBeDisabled();
      fireEvent.click(roleButton);
    });
    expect(dispatch).not.toHaveBeenCalled();
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

  it.each([
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['string', '80'],
    ['null', null],
  ])('shows Unavailable for %s current morale', (_label, morale) => {
    const worker = { id: 's1', name: 'Marco', role: 'cook', skill: 3, salary: 200 };
    if (morale !== undefined) worker.morale = morale;
    useGameState.mockReturnValue(makeState({ staff: [worker] }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const value = within(getStaffCard('s1')).getByText(/^Morale:/);
    expect(value).toHaveTextContent('Morale: Unavailable');
    expect(value).not.toHaveTextContent(/NaN%|Infinity%/);
  });

  it.each([
    ['fractional', 79.6, 'Morale: 80%'],
    ['zero', 0, 'Morale: 0%'],
    ['negative', -12.4, 'Morale: -12%'],
  ])('keeps %s finite current morale as %s', (_label, morale, expected) => {
    useGameState.mockReturnValue(makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale, salary: 200 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(within(getStaffCard('s1')).getByText(/^Morale:/)).toHaveTextContent(expected);
  });

  it('recovers the current morale display when a rerender supplies a finite value', () => {
    let state = makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: Number.NaN, salary: 200 }],
    });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<StaffPanel />);
    expect(within(getStaffCard('s1')).getByText(/^Morale:/)).toHaveTextContent('Morale: Unavailable');

    state = { ...state, staff: [{ ...state.staff[0], morale: 79.6 }] };
    rerender(<StaffPanel />);

    expect(within(getStaffCard('s1')).getByText(/^Morale:/)).toHaveTextContent('Morale: 80%');
  });
});

describe('StaffPanel current task', () => {
  it('shows busy, idle, cashier and unassigned labels below the role and skill summary', () => {
    useGameState.mockReturnValue(makeState({
      cashierStations: [
        { id: 'cashier1', assignedStaffId: 's2' },
        { id: 'cashier2', assignedStaffId: 's3' },
      ],
      staff: [
        { id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 },
        { id: 's2', name: 'Anna', role: 'waiter', skill: 3, morale: 80, salary: 150, task: { type: 'take_order' } },
        { id: 's3', name: 'Luca', role: 'waiter', skill: 2, morale: 80, salary: 150, task: null },
        { id: 's4', name: 'Mia', role: 'waiter', skill: 1, morale: 80, salary: 150, task: null },
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const anna = getStaffCard('s2');
    const annaTask = within(anna).getByText('Current task: Taking order');
    const annaSummary = within(anna).getByText(/Skill: 3\/10/);
    expect(annaSummary.nextElementSibling).toBe(annaTask);
    expect(annaTask.tagName).toBe('DIV');
    expect(annaTask.closest('[aria-live], [role="timer"]')).toBeNull();

    expect(within(getStaffCard('s1')).getByText('Current task: Available')).toBeVisible();
    expect(within(getStaffCard('s3')).getByText('Current task: Staffing cashier')).toBeVisible();
    expect(within(getStaffCard('s4')).getByText('Current task: Available')).toBeVisible();

    const duty = within(anna).getByTestId('staff-status-s2');
    expect(duty).toHaveTextContent(/Effective duty: Work/);
    expect(duty).not.toHaveTextContent(/Current task/);
    expect(within(anna).getByRole('button', { name: 'Edit schedule for Anna' })).toBeEnabled();
  });

  it('shows the cook service-counter task label used by the details panel', () => {
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200, task: { type: 'place_dish_on_service' } },
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(within(getStaffCard('s1'))
      .getByText('Current task: Placing order on service counter')).toBeVisible();
  });

  it('updates the roster label on rerender without changing duty or controls', () => {
    let state = makeState({
      cashierStations: [{ id: 'cashier1', assignedStaffId: 's2' }],
      staff: [
        { id: 's2', name: 'Anna', role: 'waiter', skill: 3, morale: 80, salary: 150, task: { type: 'take_order' } },
      ],
    });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<StaffPanel />);
    const card = getStaffCard('s2');
    const dutyBefore = within(card).getByTestId('staff-status-s2').textContent;
    expect(within(card).getByText('Current task: Taking order')).toBeVisible();

    state = { ...state, staff: state.staff.map(worker => ({ ...worker, task: { type: 'mystery' } })) };
    rerender(<StaffPanel />);
    expect(within(getStaffCard('s2')).getByText('Current task: Task unavailable')).toBeVisible();

    state = { ...state, staff: state.staff.map(worker => ({ ...worker, task: null })) };
    rerender(<StaffPanel />);
    expect(within(getStaffCard('s2')).getByText('Current task: Staffing cashier')).toBeVisible();

    state = { ...state, cashierStations: [] };
    rerender(<StaffPanel />);
    expect(within(getStaffCard('s2')).getByText('Current task: Available')).toBeVisible();

    const updatedCard = getStaffCard('s2');
    expect(within(updatedCard).getByTestId('staff-status-s2').textContent).toBe(dutyBefore);
    expect(within(updatedCard).getByRole('button', { name: 'Edit schedule for Anna' })).toBeEnabled();
  });
});

describe('StaffPanel hiring costs', () => {
  it('shows canonical upfront and daily costs for every role, linked to its hire button', () => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 500 } }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));

    expect(screen.getByText('Hiring is charged immediately. Daily salaries are paid at midnight.')).toBeVisible();
    expect(screen.getByText('$200 to hire · $200/day')).toBeVisible();
    expect(screen.getByText('$150 to hire · $150/day')).toBeVisible();
    expect(screen.getByText('$120 to hire · $120/day')).toBeVisible();

    expect(screen.getByRole('button', { name: 'Cook' }).getAttribute('aria-describedby').split(/\s+/))
      .toContain('hire-cost-cook');
    expect(screen.getByRole('button', { name: 'Waiter' }).getAttribute('aria-describedby').split(/\s+/))
      .toContain('hire-cost-waiter');
    expect(screen.getByRole('button', { name: 'Janitor' }).getAttribute('aria-describedby').split(/\s+/))
      .toContain('hire-cost-janitor');

    expect(screen.getByRole('button', { name: 'Cook' }))
      .toHaveAccessibleDescription(/^\$200 to hire · \$200\/day/);
    expect(screen.getByRole('button', { name: 'Waiter' }))
      .toHaveAccessibleDescription(/^\$150 to hire · \$150\/day/);
    expect(screen.getByRole('button', { name: 'Janitor' }))
      .toHaveAccessibleDescription(/^\$120 to hire · \$120\/day/);
  });

  it.each([
    [119, []],
    [120, ['Janitor']],
    [150, ['Waiter', 'Janitor']],
    [200, ['Cook', 'Waiter', 'Janitor']],
  ])('at $%i funds enables only the affordable role purchases', (funds, affordableRoles) => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds } }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));

    ['Cook', 'Waiter', 'Janitor'].forEach(roleName => {
      const roleButton = screen.getByRole('button', { name: roleName });
      if (affordableRoles.includes(roleName)) {
        expect(roleButton).toBeEnabled();
      } else {
        expect(roleButton).toBeDisabled();
      }
    });
  });

  it('opens and closes the hire list without dispatching or consuming randomness', () => {
    const dispatch = vi.fn();
    const randomSpy = vi.spyOn(Math, 'random');
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 119 } }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));

    expect(screen.getByText('$120 to hire · $120/day')).toBeVisible();
    expect(dispatch).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('+ Hire'));

    expect(screen.queryByText('$120 to hire · $120/day')).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('dispatches the canonical role and salary, then closes the hire list', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 500 } }));
    useDispatch.mockReturnValue(dispatch);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));
    expect(screen.getByText('$120 to hire · $120/day')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Janitor' }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'HIRE_STAFF',
      staff: { role: 'janitor', salary: 120 },
    });
    expect(screen.queryByText('$120 to hire · $120/day')).not.toBeInTheDocument();
    expect(screen.queryByText('Hire staff')).not.toBeInTheDocument();
  });
});

describe('StaffPanel training preview', () => {
  it('shows the next training outcome beside each trainable staff card', () => {
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 },
        { id: 's2', name: 'Anna', role: 'waiter', skill: 4, morale: 80, salary: 150 },
        { id: 's3', name: 'Luca', role: 'janitor', skill: 9, morale: 80, salary: 120 },
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const cookCard = getStaffCard('s1');
    expect(within(cookCard).getByText('After training: Skill 4/10 · Morale 90%')).toBeVisible();
    expect(within(cookCard).getByText('Carry capacity: 1 → 1 items')).toBeVisible();
    expect(within(cookCard).getByText('Morale work multiplier: 1.30× → 1.40×')).toBeVisible();

    const waiterCard = getStaffCard('s2');
    expect(within(waiterCard).getByText('After training: Skill 5/10 · Morale 90%')).toBeVisible();
    expect(within(waiterCard).getByText('Carry capacity: 1 → 2 items')).toBeVisible();
    expect(within(waiterCard).getByText('Order-taking rate: 1.30× → 2.80×')).toBeVisible();

    const janitorCard = getStaffCard('s3');
    expect(within(janitorCard).getByText('After training: Skill 10/10 · Morale 90%')).toBeVisible();
    expect(within(janitorCard).getByText('Carry capacity: 2 → 3 items')).toBeVisible();
    expect(within(janitorCard).getByText('Cleaning/washing rate: 1.95× → 2.80×')).toBeVisible();
  });

  it('omits the preview for maxed, unknown-role or invalid-skill workers', () => {
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 's1', name: 'Marco', role: 'cook', skill: 10, morale: 80, salary: 200 },
        { id: 's2', name: 'Ghost', role: 'manager', skill: 3, morale: 80, salary: 0 },
        { id: 's3', name: 'Blank', role: 'waiter', skill: NaN, morale: 80, salary: 150 },
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    ['s1', 's2', 's3'].forEach(id => {
      const card = getStaffCard(id);
      expect(within(card).queryByText(/After training:/)).not.toBeInTheDocument();
      expect(within(card).queryByText(/Carry capacity:/)).not.toBeInTheDocument();
      expect(within(card).queryByText(/× → /)).not.toBeInTheDocument();
    });
  });

  it('keeps the preview visible when training is unaffordable', () => {
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 10 },
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const card = getStaffCard('s1');
    expect(within(card).getByText('After training: Skill 4/10 · Morale 90%')).toBeVisible();
    expect(within(card).getByText('Carry capacity: 1 → 1 items')).toBeVisible();
    expect(within(card).getByText('Morale work multiplier: 1.30× → 1.40×')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Train ($620)' })).toBeDisabled();
  });

  it('updates the preview when a worker changes on rerender', () => {
    let state = makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 }],
    });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<StaffPanel />);
    expect(within(getStaffCard('s1')).getByText('After training: Skill 4/10 · Morale 90%')).toBeVisible();

    state = {
      ...state,
      staff: [{ ...state.staff[0], skill: 4, morale: 90 }],
    };
    rerender(<StaffPanel />);

    expect(within(getStaffCard('s1')).getByText('After training: Skill 5/10 · Morale 100%')).toBeVisible();
  });

  it('rounds the previewed morale like the current morale line while keeping rates exact', () => {
    useGameState.mockReturnValue(makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 79.6, salary: 200 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const card = getStaffCard('s1');
    expect(within(card).getByText('Morale: 80%')).toBeVisible();
    expect(within(card).getByText('After training: Skill 4/10 · Morale 90%')).toBeVisible();
    expect(within(card).queryByText(/Morale 89\.6%/)).not.toBeInTheDocument();
    expect(within(card).getByText('Morale work multiplier: 1.30× → 1.40×')).toBeVisible();
  });

  it('shows the exact skill-10 unlock text on qualifying cards only', () => {
    useGameState.mockReturnValue(makeState({
      staff: [
        { id: 's1', name: 'Anna', role: 'waiter', skill: 9, morale: 80, salary: 150 },
        { id: 's2', name: 'Luca', role: 'janitor', skill: 9, morale: 80, salary: 120 },
        { id: 's3', name: 'Marco', role: 'cook', skill: 9, morale: 80, salary: 200 },
        { id: 's4', name: 'Bea', role: 'waiter', skill: 8, morale: 80, salary: 150 },
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const waiterUnlock = 'Can take orders for an eligible party together at one table.';
    const janitorUnlock = '10% chance to instantly finish a newly started table-cleaning, floor-cleaning or manual-washing action.';

    expect(within(getStaffCard('s1')).getByText(waiterUnlock)).toBeVisible();
    expect(within(getStaffCard('s2')).getByText(janitorUnlock)).toBeVisible();
    expect(within(getStaffCard('s3')).queryByText(waiterUnlock)).not.toBeInTheDocument();
    expect(within(getStaffCard('s3')).queryByText(janitorUnlock)).not.toBeInTheDocument();
    expect(within(getStaffCard('s4')).queryByText(waiterUnlock)).not.toBeInTheDocument();
    expect(within(getStaffCard('s4')).queryByText(janitorUnlock)).not.toBeInTheDocument();
  });

  it('keeps the training button, price and dispatch payload unchanged beside the preview', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 620 },
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 }],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);

    const card = getStaffCard('s1');
    expect(within(card).getByText('After training: Skill 4/10 · Morale 90%')).toBeVisible();
    const train = within(card).getByRole('button', { name: 'Train ($620)' });
    expect(train).toBeEnabled();
    fireEvent.click(train);

    expect(dispatch).toHaveBeenCalledWith({ type: 'TRAIN_STAFF', id: 's1', cost: 620 });
  });
});

describe('StaffPanel training blockers', () => {
  const trainingWorker = (overrides = {}) => ({
    id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200, ...overrides,
  });

  const trainingButton = (id = 's1') =>
    within(getStaffCard(id)).getByRole('button', { name: /^Train/ });

  const descriptionFor = button => {
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy);
    expect(description).not.toBeNull();
    expect(description.closest('[role="alert"], [aria-live]')).toBeNull();
    return description;
  };

  it('enables training without blocker text at the exact canonical cost and dispatches the existing action', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 620 },
      staff: [trainingWorker()],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const button = trainingButton();

    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Train ($620)');
    expect(button).not.toHaveAttribute('aria-describedby');
    [
      'Resolve the career decision before training.',
      'Maximum skill reached.',
      'Training unavailable.',
      'Funds unavailable.',
      'Needs $620 in available funds.',
    ].forEach(reason => {
      expect(within(card).queryByText(reason)).not.toBeInTheDocument();
    });

    fireEvent.click(button);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'TRAIN_STAFF', id: 's1', cost: 620 });
  });

  it('prefers the pending career decision over every other blocker', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      careerRun: { needsDecision: true },
      restaurant: {},
      staff: [trainingWorker({ skill: 10, morale: 100 })],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const button = trainingButton();

    expect(button).toBeDisabled();
    expect(within(card).getByText('Resolve the career decision before training.')).toBeVisible();
    expect(within(card).queryByText('Maximum skill reached.')).not.toBeInTheDocument();
    expect(within(card).queryByText('Funds unavailable.')).not.toBeInTheDocument();
    expect(descriptionFor(button)).toHaveTextContent('Resolve the career decision before training.');

    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    [9.999, false],
    [10, true],
  ])('applies the maximum-skill boundary at skill %s', (skill, maxed) => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 1_000_000_000 },
      staff: [trainingWorker({ skill })],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const button = trainingButton();

    if (maxed) {
      expect(button).toBeDisabled();
      expect(within(card).getByText('Maximum skill reached.')).toBeVisible();
      expect(within(card).queryByText('Funds unavailable.')).not.toBeInTheDocument();
      expect(descriptionFor(button)).toHaveTextContent('Maximum skill reached.');
      fireEvent.click(button);
      expect(dispatch).not.toHaveBeenCalled();
    } else {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-describedby');
      expect(within(card).queryByText('Maximum skill reached.')).not.toBeInTheDocument();
    }
  });

  it('prefers the maximum-skill blocker over invalid cost and nonfinite funds', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      restaurant: {},
      staff: [trainingWorker({ skill: 10, role: 'manager', morale: 100 })],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const button = trainingButton();

    expect(button).toBeDisabled();
    expect(descriptionFor(button)).toHaveTextContent('Maximum skill reached.');
    expect(within(card).queryByText('Training unavailable.')).not.toBeInTheDocument();
    expect(within(card).queryByText('Funds unavailable.')).not.toBeInTheDocument();
  });

  it.each([
    ['unknown role', { role: 'manager' }],
    ['missing skill', { skill: undefined }],
    ['NaN skill', { skill: Number.NaN }],
    ['infinite skill', { skill: Number.POSITIVE_INFINITY }],
    ['negative skill', { skill: -1 }],
  ])('reports training unavailable for %s even when funds are unavailable', (_label, overrides) => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      restaurant: {},
      staff: [trainingWorker({ morale: 100, ...overrides })],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const button = trainingButton();

    expect(button).toBeDisabled();
    expect(within(card).getByText('Training unavailable.')).toBeVisible();
    expect(within(card).queryByText('Funds unavailable.')).not.toBeInTheDocument();
    expect(descriptionFor(button)).toHaveTextContent('Training unavailable.');

    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative', -620],
  ])('reports training unavailable for a %s canonical cost and does not dispatch', (_label, cost) => {
    trainingCostOverride.value = cost;
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 5000 },
      staff: [trainingWorker()],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const button = trainingButton();

    expect(button).toBeDisabled();
    expect(within(card).getByText('Training unavailable.')).toBeVisible();
    expect(within(card).queryByText('Funds unavailable.')).not.toBeInTheDocument();
    expect(descriptionFor(button)).toHaveTextContent('Training unavailable.');

    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing restaurant', {}],
    ['NaN', { funds: Number.NaN }],
    ['positive infinity', { funds: Number.POSITIVE_INFINITY }],
    ['negative infinity', { funds: Number.NEGATIVE_INFINITY }],
  ])('reports funds unavailable when funds are %s and does not dispatch', (_label, restaurant) => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ restaurant, staff: [trainingWorker()] }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const button = trainingButton();

    expect(button).toBeDisabled();
    expect(within(card).queryByText('Needs $620 in available funds.')).not.toBeInTheDocument();
    expect(descriptionFor(button)).toHaveTextContent('Funds unavailable.');

    fireEvent.click(button);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reports the exact cost shortfall below the boundary and enables exactly at the boundary', () => {
    let state = makeState({ restaurant: { funds: 619.99 }, staff: [trainingWorker()] });
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    const card = getStaffCard('s1');
    expect(trainingButton()).toBeDisabled();
    expect(within(card).getByText('Needs $620 in available funds.')).toBeVisible();
    expect(descriptionFor(trainingButton())).toHaveTextContent('Needs $620 in available funds.');

    fireEvent.click(trainingButton());
    expect(dispatch).not.toHaveBeenCalled();

    state = { ...state, restaurant: { funds: 620 } };
    rerender(<StaffPanel />);

    expect(trainingButton()).toBeEnabled();
    expect(trainingButton()).not.toHaveAttribute('aria-describedby');
    expect(within(getStaffCard('s1')).queryByText('Needs $620 in available funds.')).not.toBeInTheDocument();
  });

  it('updates the blocker and description when funds and skill change on rerender', () => {
    let state = makeState({ restaurant: { funds: 620 }, staff: [trainingWorker()] });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<StaffPanel />);
    expect(trainingButton()).toBeEnabled();

    state = { ...state, restaurant: { funds: 619.99 } };
    rerender(<StaffPanel />);
    expect(trainingButton()).toBeDisabled();
    expect(descriptionFor(trainingButton())).toHaveTextContent('Needs $620 in available funds.');

    state = {
      ...state,
      restaurant: { funds: 620 },
      staff: [{ ...state.staff[0], skill: 10 }],
    };
    rerender(<StaffPanel />);
    expect(trainingButton()).toBeDisabled();
    expect(descriptionFor(trainingButton())).toHaveTextContent('Maximum skill reached.');
    expect(within(getStaffCard('s1')).queryByText('Needs $620 in available funds.')).not.toBeInTheDocument();

    state = { ...state, staff: [{ ...state.staff[0], skill: 3 }] };
    rerender(<StaffPanel />);
    expect(trainingButton()).toBeEnabled();
    expect(trainingButton()).not.toHaveAttribute('aria-describedby');
  });

  it('gives every blocked card in every panel a unique resolvable description', () => {
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 10 },
      staff: [
        trainingWorker({ id: 's1' }),
        trainingWorker({ id: 's2', name: 'Anna', role: 'waiter' }),
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<><StaffPanel /><StaffPanel /></>);

    const cards = screen.getAllByTestId('staff-card');
    expect(cards).toHaveLength(4);
    const descriptions = cards.map(card => {
      const button = within(card).getByRole('button', { name: /^Train/ });
      expect(button).toBeDisabled();
      const describedBy = button.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const description = document.getElementById(describedBy);
      expect(card).toContainElement(description);
      expect(description).toHaveTextContent('Needs $');
      return describedBy;
    });

    expect(new Set(descriptions).size).toBe(4);
  });
});

describe('StaffPanel team coverage preview', () => {
  const allWorkSchedule = () => Array.from({ length: 48 }, () => 'work');
  const teamStaff = () => [
    { id: 'cook-a', name: 'Marco', role: 'cook', skill: 4, morale: 80, salary: 200, schedule: allWorkSchedule() },
    { id: 'cook-b', name: 'Mario', role: 'cook', skill: 3, morale: 80, salary: 200, schedule: allWorkSchedule() },
    { id: 'waiter-a', name: 'Anna', role: 'waiter', skill: 2, morale: 80, salary: 150, schedule: allWorkSchedule() },
  ];

  const coverageRows = () => within(screen.getByRole('list', { name: 'Team coverage preview' }))
    .getAllByRole('listitem').map(item => item.textContent);

  it('keeps a retained draft out of another preview and preserves it on return', () => {
    let state = makeState({ restaurant: { funds: 1000 }, staff: teamStaff() });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    const marcoCard = getStaffCard('cook-a');
    fireEvent.click(within(marcoCard).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.change(within(marcoCard).getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(within(marcoCard).getByRole('button', { name: 'All day' }));

    const marioCard = getStaffCard('cook-b');
    fireEvent.click(within(marioCard).getByRole('button', { name: 'Edit schedule for Mario' }));
    expect(within(marioCard).getByRole('list', { name: 'Team coverage preview' }))
      .toHaveTextContent(/Cooks 2, Waiters 1, Janitors 0/);

    fireEvent.click(within(marcoCard).getByRole('button', { name: 'Edit schedule for Marco' }));
    expect(within(marcoCard).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*24 hours/);
    expect(within(marcoCard).getByRole('list', { name: 'Team coverage preview' }))
      .toHaveTextContent(/Cooks 1, Waiters 1, Janitors 0/);
  });

  it('restores the saved all-Work schedule after Cancel and on reopen', () => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 1000 }, staff: teamStaff() }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    const card = getStaffCard('cook-a');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.change(within(card).getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(within(card).getByRole('button', { name: 'All day' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel schedule' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));

    expect(within(card).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Work:\s*24 hours/);
    expect(within(card).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*0 hours/);
    expect(within(card).getByRole('list', { name: 'Team coverage preview' }))
      .toHaveTextContent(/Cooks 2, Waiters 1, Janitors 0/);
  });

  it('applies only the active worker and reopens with the same preview counts', () => {
    let state = makeState({ restaurant: { funds: 1000 }, staff: teamStaff() });
    const dispatch = vi.fn(action => {
      if (action.type !== 'SET_STAFF_SCHEDULE') return;
      state = {
        ...state,
        staff: state.staff.map(worker => worker.id === action.id
          ? { ...worker, schedule: action.schedule }
          : worker),
      };
    });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    const card = getStaffCard('cook-a');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.change(within(card).getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(within(card).getByRole('button', { name: 'All day' }));
    const before = within(card).getByRole('list', { name: 'Team coverage preview' }).textContent;

    fireEvent.click(within(card).getByRole('button', { name: 'Apply schedule' }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_STAFF_SCHEDULE', id: 'cook-a', schedule: Array(48).fill('rest'),
    });
    expect(state.staff.find(worker => worker.id === 'cook-a').schedule).toEqual(Array(48).fill('rest'));
    expect(state.staff.find(worker => worker.id === 'cook-b').schedule).toEqual(allWorkSchedule());
    expect(state.staff.find(worker => worker.id === 'waiter-a').schedule).toEqual(allWorkSchedule());

    rerender(<StaffPanel />);
    fireEvent.click(within(getStaffCard('cook-a')).getByRole('button', { name: 'Edit schedule for Marco' }));

    expect(within(getStaffCard('cook-a')).getByRole('list', { name: 'Team coverage preview' }).textContent)
      .toBe(before);
  });

  it('keeps unfiltered teammates in the preview when filtering by role', () => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 1000 }, staff: teamStaff() }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    const card = getStaffCard('cook-a');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cooks' }));

    expect(screen.getAllByTestId('staff-card')).toHaveLength(2);
    expect(within(getStaffCard('cook-a')).getByRole('list', { name: 'Team coverage preview' }))
      .toHaveTextContent(/Cooks 2, Waiters 1, Janitors 0/);
  });

  it('renders exact opening boundaries from restaurant hours and refreshes on rerender', () => {
    let state = makeState({
      restaurant: { funds: 1000, openHour: 8.5, closeHour: 9 },
      staff: teamStaff(),
    });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<StaffPanel />);
    fireEvent.click(within(getStaffCard('cook-a')).getByRole('button', { name: 'Edit schedule for Marco' }));

    expect(coverageRows()).toEqual([
      '00:00 to 08:30 · Closed · Cooks 2, Waiters 1, Janitors 0',
      '08:30 to 09:00 · Open · Cooks 2, Waiters 1, Janitors 0',
      '09:00 to 24:00 (midnight) · Closed · Cooks 2, Waiters 1, Janitors 0',
    ]);

    state = { ...state, restaurant: { ...state.restaurant, openHour: 22, closeHour: 2 } };
    rerender(<StaffPanel />);

    expect(coverageRows()).toEqual([
      '00:00 to 02:00 · Open · Cooks 2, Waiters 1, Janitors 0',
      '02:00 to 22:00 · Closed · Cooks 2, Waiters 1, Janitors 0',
      '22:00 to 24:00 (midnight) · Open · Cooks 2, Waiters 1, Janitors 0',
    ]);
  });

  it('copies a teammate saved schedule even when that teammate has a retained draft', () => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 1000 }, staff: teamStaff() }));
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const annaCard = getStaffCard('waiter-a');
    fireEvent.click(within(annaCard).getByRole('button', { name: 'Edit schedule for Anna' }));
    fireEvent.change(within(annaCard).getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(within(annaCard).getByRole('button', { name: 'All day' }));

    const marcoCard = getStaffCard('cook-a');
    fireEvent.click(within(marcoCard).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.change(within(marcoCard).getByRole('combobox', { name: 'Copy from' }), { target: { value: 'waiter-a' } });
    fireEvent.click(within(marcoCard).getByRole('button', { name: 'Copy schedule' }));

    expect(within(marcoCard).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Work:\s*24 hours/);
    expect(within(marcoCard).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*0 hours/);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('StaffPanel roster bonus', () => {
  const worker = (overrides = {}) => ({
    id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200, ...overrides,
  });

  const bonusButton = (id = 's1') =>
    within(getStaffCard(id)).getByRole('button', { name: 'Bonus ($50)' });

  it('disables a funded bonus at full morale and explains why', () => {
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 500 },
      staff: [worker({ morale: 100 })],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(bonusButton()).toBeDisabled();
    expect(within(getStaffCard('s1')).getByText('Morale is already full.')).toBeVisible();
    expect(within(getStaffCard('s1')).queryByText(/After bonus:/)).not.toBeInTheDocument();
  });

  it.each([
    ['missing', {}],
    ['NaN', { funds: Number.NaN }],
    ['infinite', { funds: Number.POSITIVE_INFINITY }],
  ])('disables the bonus when funds are %s', (_label, restaurant) => {
    useGameState.mockReturnValue(makeState({ restaurant, staff: [worker()] }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const button = bonusButton();
    expect(button).toBeDisabled();
    expect(document.getElementById(button.getAttribute('aria-describedby')))
      .toHaveTextContent('Funds unavailable.');
  });

  it.each([
    ['non-finite', Number.NaN],
    ['missing', undefined],
  ])('disables the bonus for %s morale', (_label, morale) => {
    const invalidWorker = worker();
    if (morale === undefined) delete invalidWorker.morale;
    else invalidWorker.morale = morale;
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 500 },
      staff: [invalidWorker],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(bonusButton()).toBeDisabled();
    expect(within(getStaffCard('s1')).getByText('Morale unavailable.')).toBeVisible();
  });

  it.each([
    ['invalid morale', { morale: Number.NaN }, 'Morale unavailable.'],
    ['full morale', { morale: 100 }, 'Morale is already full.'],
  ])('prefers the %s reason over unavailable funds', (_label, overrides, reason) => {
    useGameState.mockReturnValue(makeState({
      restaurant: {},
      staff: [worker(overrides)],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const button = bonusButton();
    expect(button).toBeDisabled();
    expect(within(getStaffCard('s1')).getByText(reason)).toBeVisible();
    const explanation = document.getElementById(button.getAttribute('aria-describedby'));
    expect(explanation).toHaveTextContent(reason);
    expect(explanation).not.toHaveTextContent('Funds unavailable.');
  });

  it.each([
    [49.99, false],
    [50, true],
  ])('at $%s funds treats the bonus as eligible=%s', (funds, eligible) => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds }, staff: [worker()] }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    if (eligible) {
      expect(bonusButton()).toBeEnabled();
      expect(within(getStaffCard('s1')).queryByText('Needs $50 in available funds.')).not.toBeInTheDocument();
    } else {
      expect(bonusButton()).toBeDisabled();
      expect(within(getStaffCard('s1')).getByText('Needs $50 in available funds.')).toBeVisible();
    }
    expect(within(getStaffCard('s1')).getByText('After bonus: morale 100%.')).toBeVisible();
  });

  it.each([
    [90, 'After bonus: morale 100%.'],
    [79.6, 'After bonus: morale 100%.'],
  ])('shows the rounded after-bonus morale for morale %s', (morale, preview) => {
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 500 }, staff: [worker({ morale })] }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(within(getStaffCard('s1')).getByText(preview)).toBeVisible();
  });

  it('dispatches the id-only canonical bonus action with a linked one-time explanation', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ restaurant: { funds: 500 }, staff: [worker()] }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);

    const card = getStaffCard('s1');
    const button = within(card).getByRole('button', { name: 'Bonus ($50)' });
    expect(button).toBeEnabled();
    expect(within(card).getByText('After bonus: morale 100%.')).toBeVisible();
    expect(within(card).getByText('One-time payment. Daily salary stays unchanged.')).toBeVisible();

    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(card).toContainElement(document.getElementById(describedBy));

    fireEvent.click(button);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'GIVE_BONUS', id: 's1' });
  });

  it('disables the bonus when a rerender reports full morale', () => {
    let state = makeState({ restaurant: { funds: 500 }, staff: [worker()] });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<StaffPanel />);
    expect(bonusButton()).toBeEnabled();

    state = { ...state, staff: [{ ...state.staff[0], morale: 100 }] };
    rerender(<StaffPanel />);

    expect(bonusButton()).toBeDisabled();
    expect(within(getStaffCard('s1')).getByText('Morale is already full.')).toBeVisible();
    expect(within(getStaffCard('s1')).queryByText(/After bonus:/)).not.toBeInTheDocument();
  });

  it('uses a unique describedby explanation per card', () => {
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 500 },
      staff: [
        worker(),
        { id: 's2', name: 'Anna', role: 'waiter', skill: 3, morale: 100, salary: 150 },
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const first = bonusButton('s1');
    const second = bonusButton('s2');
    const firstId = first.getAttribute('aria-describedby');
    const secondId = second.getAttribute('aria-describedby');

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
    expect(getStaffCard('s1')).toContainElement(document.getElementById(firstId));
    expect(getStaffCard('s2')).toContainElement(document.getElementById(secondId));
    expect(document.getElementById(firstId)).toHaveTextContent('After bonus: morale 100%.');
    expect(document.getElementById(secondId)).toHaveTextContent('Morale is already full.');
  });
});

describe('StaffPanel hire projection', () => {
  const hireRoles = [
    ['Cook', 'cook'],
    ['Waiter', 'waiter'],
    ['Janitor', 'janitor'],
  ];

  const projectionFor = (roleName, role) => {
    const button = screen.getByRole('button', { name: roleName });
    const describedBy = button.getAttribute('aria-describedby').split(/\s+/);
    expect(describedBy).toContain(`hire-cost-${role}`);
    expect(describedBy).toHaveLength(2);
    return document.getElementById(describedBy.find(id => id !== `hire-cost-${role}`));
  };

  it('shows the exact cash projection for every role beside its canonical hire costs', () => {
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 622.5 },
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 150.25 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));

    expect(screen.getByText('Hiring is charged immediately. Daily salaries are paid at midnight.')).toBeVisible();
    expect(screen.getByText('Assumes unchanged staff and salaries. Full payroll is charged at the next midnight without proration. Excludes all other receipts and spending.')).toBeVisible();

    expect(screen.getByText('$200 to hire · $200/day')).toBeVisible();
    expect(screen.getByText('$150 to hire · $150/day')).toBeVisible();
    expect(screen.getByText('$120 to hire · $120/day')).toBeVisible();

    const cookProjection = projectionFor('Cook', 'cook');
    expect(cookProjection).toHaveTextContent('Funds after hiring: $422.50');
    expect(cookProjection).toHaveTextContent('Daily payroll after hiring: $350.25');
    expect(cookProjection).toHaveTextContent('Balance after that payroll only: $72.25');

    const waiterProjection = projectionFor('Waiter', 'waiter');
    expect(waiterProjection).toHaveTextContent('Funds after hiring: $472.50');
    expect(waiterProjection).toHaveTextContent('Daily payroll after hiring: $300.25');
    expect(waiterProjection).toHaveTextContent('Balance after that payroll only: $172.25');

    const janitorProjection = projectionFor('Janitor', 'janitor');
    expect(janitorProjection).toHaveTextContent('Funds after hiring: $502.50');
    expect(janitorProjection).toHaveTextContent('Daily payroll after hiring: $270.25');
    expect(janitorProjection).toHaveTextContent('Balance after that payroll only: $232.25');
  });

  it.each([
    ['NaN', { funds: Number.NaN }],
    ['positive infinity', { funds: Number.POSITIVE_INFINITY }],
    ['missing', {}],
  ])('disables every hire and shows Unavailable cash when restaurant funds are %s', (_label, restaurant) => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      restaurant,
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 150.25 }],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));

    hireRoles.forEach(([roleName]) => {
      const button = screen.getByRole('button', { name: roleName });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    });
    expect(dispatch).not.toHaveBeenCalled();

    expect(screen.getAllByText('Funds after hiring: Unavailable')).toHaveLength(3);
    expect(screen.getAllByText('Balance after that payroll only: Unavailable')).toHaveLength(3);
    expect(screen.getAllByText(/^Daily payroll after hiring: \$/)).toHaveLength(3);
    expect(screen.queryByText(/This hire would leave current funds short of the next payroll\./)).not.toBeInTheDocument();
  });

  it('keeps an exactly affordable hire enabled with the shortfall advisory', () => {
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 150 },
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 150.25 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));

    expect(screen.getByRole('button', { name: 'Waiter' })).toBeEnabled();
    const waiterProjection = projectionFor('Waiter', 'waiter');
    expect(waiterProjection).toHaveTextContent('Funds after hiring: $0');
    expect(waiterProjection).toHaveTextContent('Daily payroll after hiring: $300.25');
    expect(waiterProjection).toHaveTextContent('Balance after that payroll only: $-300.25');
    expect(waiterProjection).toHaveTextContent('This hire would leave current funds short of the next payroll.');
  });

  it('dispatches the canonical role and salary after showing the projection', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      restaurant: { funds: 622.5 },
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 150.25 }],
    }));
    useDispatch.mockReturnValue(dispatch);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));
    expect(projectionFor('Waiter', 'waiter')).toHaveTextContent('Funds after hiring: $472.50');

    fireEvent.click(screen.getByRole('button', { name: 'Waiter' }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'HIRE_STAFF',
      staff: { role: 'waiter', salary: 150 },
    });
    expect(screen.queryByText('Hire staff')).not.toBeInTheDocument();
  });

  it('updates the projection when the payroll changes on rerender', () => {
    const worker = (id, salary) => ({ id, name: id, role: 'cook', skill: 3, morale: 80, salary });
    let state = makeState({
      restaurant: { funds: 622.5 },
      staff: [worker('s1', 150.25)],
    });
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));
    expect(projectionFor('Waiter', 'waiter')).toHaveTextContent('Daily payroll after hiring: $300.25');

    state = { ...state, staff: [worker('s1', 150.25), worker('s2', 99.75)] };
    rerender(<StaffPanel />);

    expect(projectionFor('Waiter', 'waiter')).toHaveTextContent('Daily payroll after hiring: $400');
    expect(projectionFor('Waiter', 'waiter')).not.toHaveTextContent('Daily payroll after hiring: $300.25');
  });

  it('lays out hire options in a wrapping container for narrow viewports', () => {
    useGameState.mockReturnValue(makeState());
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);
    fireEvent.click(screen.getByText('+ Hire'));

    expect(screen.getByTestId('hire-role-list')).toHaveStyle({ display: 'flex', flexWrap: 'wrap' });
  });
});

describe('StaffPanel action row wrapping', () => {
  it('wraps the worker action buttons on narrow viewports', () => {
    useGameState.mockReturnValue(makeState({
      staff: [{ id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 }],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    const bonusButton = within(getStaffCard('s1')).getByRole('button', { name: 'Bonus ($50)' });
    expect(bonusButton.parentElement).toHaveStyle({ display: 'flex', flexWrap: 'wrap' });
  });
});

describe('StaffPanel firing confirmation', () => {
  const fireWorker = (overrides = {}) => ({
    id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200, ...overrides,
  });

  it('arms the shared inline confirmation before dispatching exactly one fire', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ staff: [fireWorker()] }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Fire Marco' }));

    expect(dispatch).not.toHaveBeenCalled();
    const region = within(card).getByRole('region', { name: 'Fire Marco?' });
    expect(region).toHaveTextContent(
      "Fire Marco (Cook)? This removes the employee and releases their assigned work. Hiring again does not restore this employee's training.",
    );

    fireEvent.click(within(card).getByRole('button', { name: 'Confirm fire Marco' }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'FIRE_STAFF', id: 's1' });
  });

  it('passes the raw id value through without coercion', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ staff: [fireWorker({ id: 7, name: 'Nico' })] }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('7');
    fireEvent.click(within(card).getByRole('button', { name: 'Fire Nico' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm fire Nico' }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].type).toBe('FIRE_STAFF');
    expect(dispatch.mock.calls[0][0].id).toBe(7);
  });

  it('cancel keeps the employee, restores trigger focus and dispatches nothing', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ staff: [fireWorker()] }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const trigger = within(card).getByRole('button', { name: 'Fire Marco' });
    fireEvent.click(trigger);

    const cancel = within(card).getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);

    expect(dispatch).not.toHaveBeenCalled();
    expect(within(card).queryByRole('region')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('cancels the confirmation with Escape and stops the key from propagating', () => {
    const dispatch = vi.fn();
    const parentKeyDown = vi.fn();
    useGameState.mockReturnValue(makeState({ staff: [fireWorker()] }));
    useDispatch.mockReturnValue(dispatch);

    render(<div onKeyDown={parentKeyDown}><StaffPanel /></div>);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Fire Marco' }));

    const dispatchResult = fireEvent.keyDown(within(card).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });

    expect(dispatchResult).toBe(false);
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(within(card).queryByRole('region')).not.toBeInTheDocument();
  });

  it('keeps an armed confirmation when a tick replaces the worker object', () => {
    let state = makeState({ staff: [fireWorker()] });
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Fire Marco' }));

    state = { ...state, staff: state.staff.map(worker => ({ ...worker, morale: 55, task: { type: 'clean_table' } })) };
    rerender(<StaffPanel />);

    expect(within(card).getByRole('region', { name: 'Fire Marco?' })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm fire Marco' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'FIRE_STAFF', id: 's1' });
  });

  it('drops an armed confirmation when the game generation changes', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({ staff: [fireWorker()] }));
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Fire Marco' }));

    useGameGeneration.mockReturnValue(1);
    rerender(<StaffPanel />);

    expect(within(card).queryByRole('region')).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('clears local confirmation when the roster filter unmounts the row', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [fireWorker(), fireWorker({ id: 's2', name: 'Anna', role: 'waiter' })],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    fireEvent.click(within(getStaffCard('s2')).getByRole('button', { name: 'Fire Anna' }));
    expect(screen.getByRole('region', { name: 'Fire Anna?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cooks' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('blocks firing while a career decision is pending', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [fireWorker()],
      careerRun: { needsDecision: true },
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const card = getStaffCard('s1');
    const trigger = within(card).getByRole('button', { name: 'Fire Marco' });
    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);

    expect(within(card).queryByRole('region')).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps focus on the Hire toggle after a confirmed fire removes the row', () => {
    useGameState.mockImplementation(() => panelHarness.current.state);
    useDispatch.mockImplementation(() => panelHarness.current.dispatch);

    render(<StatefulStaffPanel initial={createInitialState()} />);
    const card = getStaffCard('starter-waiter');
    fireEvent.click(within(card).getByRole('button', { name: 'Fire Sofia' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm fire Sofia' }));

    expect(screen.queryAllByTestId('staff-card').some(entry => entry.dataset.staffId === 'starter-waiter'))
      .toBe(false);
    expect(screen.getByRole('button', { name: '+ Hire' })).toHaveFocus();
  });
});

describe('StaffPanel locate', () => {
  const locatedWorker = (overrides = {}) => ({
    id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200,
    x: 120, y: 80, ...overrides,
  });

  it('shows Locate with a contextual name and forwards the raw id without dispatching', () => {
    const dispatch = vi.fn();
    const onLocateStaff = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [locatedWorker({ id: 7, name: 'Nico' })],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel onLocateStaff={onLocateStaff} />);

    const button = within(getStaffCard('7')).getByRole('button', { name: 'Locate Nico' });
    expect(button).toHaveTextContent('Locate');
    expect(button).toBeEnabled();

    fireEvent.click(button);

    expect(onLocateStaff).toHaveBeenCalledTimes(1);
    expect(onLocateStaff).toHaveBeenCalledWith(7);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('renders Locate disabled when the parent supplies no callback', () => {
    useGameState.mockReturnValue(makeState({ staff: [locatedWorker()] }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel />);

    expect(within(getStaffCard('s1')).getByRole('button', { name: 'Locate Marco' })).toBeDisabled();
  });

  it('disables Locate and shows the parent placement message when blocked', () => {
    const onLocateStaff = vi.fn();
    useGameState.mockReturnValue(makeState({ staff: [locatedWorker()] }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel
      onLocateStaff={onLocateStaff}
      locateDisabled
      locateMessage="Finish or cancel placement before locating staff."
    />);

    expect(screen.getByText('Finish or cancel placement before locating staff.')).toBeInTheDocument();
    const button = within(getStaffCard('s1')).getByRole('button', { name: 'Locate Marco' });
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onLocateStaff).not.toHaveBeenCalled();
  });

  it('disables Locate while a career decision is pending', () => {
    const onLocateStaff = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [locatedWorker()],
      careerRun: { needsDecision: true },
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel onLocateStaff={onLocateStaff} />);

    const button = within(getStaffCard('s1')).getByRole('button', { name: 'Locate Marco' });
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onLocateStaff).not.toHaveBeenCalled();
  });

  it('disables Locate for workers without finite canonical coordinates', () => {
    const onLocateStaff = vi.fn();
    useGameState.mockReturnValue(makeState({
      staff: [
        locatedWorker({ id: 's1', name: 'Marco', x: undefined, y: 80 }),
        locatedWorker({ id: 's2', name: 'Anna', x: Number.NaN, y: 80 }),
        locatedWorker({ id: 's3', name: 'Luca', x: 80, y: Number.POSITIVE_INFINITY }),
      ],
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<StaffPanel onLocateStaff={onLocateStaff} />);

    for (const [id, name] of [['s1', 'Marco'], ['s2', 'Anna'], ['s3', 'Luca']]) {
      const button = within(getStaffCard(id)).getByRole('button', { name: `Locate ${name}` });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onLocateStaff).not.toHaveBeenCalled();
  });
});

describe('StaffPanel rename draft lifetime', () => {
  const renameState = (overrides = {}) => makeState({
    staff: [
      { id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200 },
      { id: 's2', name: 'Anna', role: 'waiter', skill: 3, morale: 80, salary: 150 },
    ],
    ...overrides,
  });

  const openRename = (id = 's1') => {
    const card = getStaffCard(id);
    fireEvent.click(within(card).getByRole('button', { name: 'Rename' }));
    return within(card).getByRole('textbox');
  };

  // Clicks the rendered Save control during the commit phase, before the panel's
  // passive invalidation effect can run.
  function RenameLayoutHarness({ saveOnLayout = false }) {
    useLayoutEffect(() => {
      if (!saveOnLayout) return;
      const save = screen.queryByRole('button', { name: 'Save' });
      save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, [saveOnLayout]);
    return <StaffPanel />;
  }

  it('clears an excluded draft synchronously and never resurrects it when the filter returns', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(renameState());
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const input = openRename();
    fireEvent.change(input, { target: { value: 'Matteo' } });

    fireEvent.click(screen.getByRole('button', { name: 'Waiters' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const restored = getStaffCard('s1');
    expect(within(restored).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(restored).getByText('Marco')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('retains the draft when the selected filter still includes the worker', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(renameState());
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const input = openRename();
    fireEvent.change(input, { target: { value: 'Matteo' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cooks' }));

    const card = getStaffCard('s1');
    expect(within(card).getByRole('textbox')).toHaveValue('Matteo');
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'RENAME_STAFF', id: 's1', name: 'Matteo' });
  });

  it('cancels the draft when the worker disappears and keeps it cancelled if the id returns', () => {
    let state = renameState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    state = { ...state, staff: state.staff.filter(worker => worker.id !== 's1') };
    rerender(<StaffPanel />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    state = renameState();
    rerender(<StaffPanel />);
    expect(within(getStaffCard('s1')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(getStaffCard('s1')).getByText('Marco')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('cancels the draft when the visible name changes', () => {
    let state = renameState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    state = {
      ...state,
      staff: state.staff.map(worker => worker.id === 's1' ? { ...worker, name: 'Anna' } : worker),
    };
    rerender(<StaffPanel />);

    expect(within(getStaffCard('s1')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(getStaffCard('s1')).getByText('Anna')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('cancels the draft when the visible role changes', () => {
    let state = renameState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    state = {
      ...state,
      staff: state.staff.map(worker => worker.id === 's1' ? { ...worker, role: 'waiter' } : worker),
    };
    rerender(<StaffPanel />);

    expect(within(getStaffCard('s1')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(getStaffCard('s1')).getByText(/Waiter/)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('cancels the draft when the game generation changes', () => {
    let state = renameState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    useGameGeneration.mockReturnValue(1);
    state = { ...state };
    rerender(<StaffPanel />);

    expect(within(getStaffCard('s1')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('retains the draft across an ordinary tick that replaces the worker object', () => {
    let state = renameState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    state = {
      ...state,
      staff: state.staff.map(worker => worker.id === 's1'
        ? { ...worker, morale: 42, task: { type: 'clean_table' }, x: 10, y: 20 }
        : worker),
    };
    rerender(<StaffPanel />);

    const card = getStaffCard('s1');
    expect(within(card).getByRole('textbox')).toHaveValue('Matteo');
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'RENAME_STAFF', id: 's1', name: 'Matteo' });
  });

  it('preserves the raw numeric id through the rename guard and dispatch', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(renameState({
      staff: [{ id: 7, name: 'Nico', role: 'cook', skill: 3, morale: 80, salary: 200 }],
    }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    fireEvent.change(openRename('7'), { target: { value: '  Matteo  ' } });
    fireEvent.click(within(getStaffCard('7')).getByRole('button', { name: 'Save' }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'RENAME_STAFF', id: 7, name: 'Matteo' });
    expect(dispatch.mock.calls[0][0].id).toBe(7);
  });

  it('keeps the existing blank-name no-save behaviour', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(renameState());
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    const input = openRename();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(within(getStaffCard('s1')).getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(within(getStaffCard('s1')).getByRole('textbox')).toHaveValue('   ');
  });

  it('consumes Escape while renaming so the real management dialog stays open', () => {
    const dispatch = vi.fn();
    const onClose = vi.fn();
    useGameState.mockReturnValue(renameState());
    useDispatch.mockReturnValue(dispatch);

    render(<ManagementModal isOpen onClose={onClose} initialTab="staff" />);
    const dialog = screen.getByRole('dialog', { name: 'Restaurant management' });
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    const result = fireEvent.keyDown(within(getStaffCard('s1')).getByRole('textbox'), { key: 'Escape' });

    expect(result).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    expect(within(getStaffCard('s1')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('real Fire confirmation consumes Escape so the management dialog stays open', () => {
    const dispatch = vi.fn();
    const onClose = vi.fn();
    useGameState.mockReturnValue(renameState());
    useDispatch.mockReturnValue(dispatch);

    render(<ManagementModal isOpen onClose={onClose} initialTab="staff" />);
    const dialog = screen.getByRole('dialog', { name: 'Restaurant management' });
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Fire Marco' }));

    const result = fireEvent.keyDown(within(card).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });

    expect(result).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    expect(within(card).queryByRole('region', { name: 'Fire Marco?' })).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('clears the draft identity on Escape and Cancel', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(renameState());
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });
    fireEvent.keyDown(within(getStaffCard('s1')).getByRole('textbox'), { key: 'Escape' });
    expect(within(getStaffCard('s1')).queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.change(openRename(), { target: { value: 'Luca' } });
    fireEvent.click(within(getStaffCard('s1')).getByRole('button', { name: 'Cancel' }));
    expect(within(getStaffCard('s1')).queryByRole('textbox')).not.toBeInTheDocument();

    const reopened = openRename();
    expect(reopened).toHaveValue('Marco');
    fireEvent.change(reopened, { target: { value: 'Sofia' } });
    fireEvent.click(within(getStaffCard('s1')).getByRole('button', { name: 'Save' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'RENAME_STAFF', id: 's1', name: 'Sofia' });
  });

  it('discards the rename draft when schedule editing starts', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(renameState());
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));
    expect(within(card).getByRole('button', { name: 'Hide schedule for Marco' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(card).getByRole('button', { name: 'Hide schedule for Marco' }));

    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(card).getByText('Marco')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('synchronously rejects a stale save when the name changed before the invalidation effect ran', () => {
    let state = renameState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<RenameLayoutHarness />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    state = {
      ...state,
      staff: state.staff.map(worker => worker.id === 's1' ? { ...worker, name: 'Anna' } : worker),
    };
    rerender(<RenameLayoutHarness saveOnLayout />);

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('synchronously rejects a stale save when the generation changed before the invalidation effect ran', () => {
    const state = renameState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<RenameLayoutHarness />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    useGameGeneration.mockReturnValue(1);
    rerender(<RenameLayoutHarness saveOnLayout />);

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps a rename draft inert when a career decision becomes pending before the effect ran', () => {
    let state = renameState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<RenameLayoutHarness />);
    fireEvent.change(openRename(), { target: { value: 'Matteo' } });

    state = { ...state, careerRun: { needsDecision: true } };
    rerender(<RenameLayoutHarness saveOnLayout />);

    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('Matteo');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('StaffPanel career decision controls', () => {
  const allWorkSchedule = () => Array.from({ length: 48 }, () => 'work');
  const careerState = (overrides = {}) => makeState({
    restaurant: { funds: 2000 },
    staff: [
      { id: 's1', name: 'Marco', role: 'cook', skill: 3, morale: 80, salary: 200, schedule: allWorkSchedule() },
      { id: 's2', name: 'Anna', role: 'waiter', skill: 3, morale: 80, salary: 150, schedule: allWorkSchedule() },
    ],
    ...overrides,
  });

  it('shows the decision copy and disables every direct staff mutation without dispatching or consuming randomness', () => {
    const dispatch = vi.fn();
    const randomSpy = vi.spyOn(Math, 'random');
    useGameState.mockImplementation(() => careerState({ careerRun: { needsDecision: true } }));
    useDispatch.mockReturnValue(dispatch);

    render(<StaffPanel />);

    expect(screen.getByText('Resolve the career decision before changing staff.')).toBeVisible();
    const hire = screen.getByRole('button', { name: '+ Hire' });
    expect(hire).toBeDisabled();
    fireEvent.click(hire);
    expect(screen.queryByText('Hire staff')).not.toBeInTheDocument();

    const card = getStaffCard('s1');
    const rename = within(card).getByRole('button', { name: 'Rename' });
    const train = within(card).getByRole('button', { name: /^Train/ });
    const bonus = within(card).getByRole('button', { name: 'Bonus ($50)' });
    const editSchedule = within(card).getByRole('button', { name: 'Edit schedule for Marco' });
    [rename, train, bonus, editSchedule].forEach(button => {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Schedule totals' })).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();

    const cooks = screen.getByRole('button', { name: 'Cooks' });
    expect(cooks).toBeEnabled();
    fireEvent.click(cooks);
    expect(screen.getAllByTestId('staff-card')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByTestId('staff-card')).toHaveLength(2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps open hire and rename controls visible but inert after a pending transition, with Cancel and filters usable', () => {
    let state = careerState();
    const dispatch = vi.fn();
    const randomSpy = vi.spyOn(Math, 'random');
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    fireEvent.click(screen.getByRole('button', { name: '+ Hire' }));
    expect(screen.getByRole('button', { name: 'Cook' })).toBeEnabled();

    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Rename' }));
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'Matteo' } });

    state = { ...state, careerRun: { needsDecision: true } };
    rerender(<StaffPanel />);

    expect(screen.getByText('Resolve the career decision before changing staff.')).toBeVisible();
    expect(screen.getByRole('button', { name: '+ Hire' })).toBeDisabled();

    ['Cook', 'Waiter', 'Janitor'].forEach(roleName => {
      const roleButton = screen.getByRole('button', { name: roleName });
      expect(roleButton).toBeDisabled();
      fireEvent.click(roleButton);
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();

    const pendingCard = getStaffCard('s1');
    const pendingInput = within(pendingCard).getByRole('textbox');
    expect(pendingInput).toBeDisabled();
    expect(pendingInput).toHaveValue('Matteo');
    expect(within(pendingCard).getByRole('button', { name: 'Save' })).toBeDisabled();
    const cancelRename = within(pendingCard).getByRole('button', { name: 'Cancel' });
    expect(cancelRename).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cooks' }));
    expect(within(getStaffCard('s1')).getByRole('textbox')).toHaveValue('Matteo');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(cancelRename);
    expect(within(getStaffCard('s1')).queryByRole('textbox')).not.toBeInTheDocument();

    state = { ...state, careerRun: { needsDecision: false } };
    rerender(<StaffPanel />);

    expect(screen.getByRole('button', { name: '+ Hire' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cook' })).toBeEnabled();
    const resumedCard = getStaffCard('s1');
    expect(within(resumedCard).getByRole('button', { name: 'Rename' })).toBeEnabled();
    expect(within(resumedCard).getByRole('button', { name: /^Train/ })).toBeEnabled();
    expect(within(resumedCard).getByRole('button', { name: 'Bonus ($50)' })).toBeEnabled();
    expect(within(resumedCard).getByRole('button', { name: 'Edit schedule for Marco' })).toBeEnabled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('closes an open schedule editor on transition while preserving the saved schedule and retained draft', () => {
    let state = careerState();
    const dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<StaffPanel />);
    const card = getStaffCard('s1');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule for Marco' }));
    fireEvent.change(within(card).getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(within(card).getByRole('button', { name: 'All day' }));
    expect(within(card).getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*24 hours/);

    state = { ...state, careerRun: { needsDecision: true } };
    rerender(<StaffPanel />);

    expect(screen.queryByRole('list', { name: 'Schedule totals' })).not.toBeInTheDocument();
    const pendingEdit = within(getStaffCard('s1')).getByRole('button', { name: 'Edit schedule for Marco' });
    expect(pendingEdit).toBeDisabled();
    fireEvent.click(pendingEdit);
    expect(screen.queryByRole('list', { name: 'Schedule totals' })).not.toBeInTheDocument();
    expect(state.staff[0].schedule).toEqual(allWorkSchedule());
    expect(dispatch).not.toHaveBeenCalled();

    state = { ...state, careerRun: { needsDecision: false } };
    rerender(<StaffPanel />);

    const resumedEdit = within(getStaffCard('s1')).getByRole('button', { name: 'Edit schedule for Marco' });
    expect(resumedEdit).toBeEnabled();
    fireEvent.click(resumedEdit);
    expect(within(getStaffCard('s1')).getByRole('list', { name: 'Schedule totals' }))
      .toHaveTextContent(/Rest:\s*24 hours/);
    expect(state.staff[0].schedule).toEqual(allWorkSchedule());
    expect(dispatch).not.toHaveBeenCalled();
  });
});
