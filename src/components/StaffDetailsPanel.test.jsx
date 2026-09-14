import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import StaffDetailsPanel from './StaffDetailsPanel';

const staff = {
  id: 's1', name: 'Sofia', role: 'waiter', morale: 79.6, salary: 150,
  skill: 3, task: { type: 'take_order' },
};

const allWork = () => Array.from({ length: 48 }, () => 'work');

describe('StaffDetailsPanel', () => {
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

  it.each([
    ['clean_floor', 'Cleaning floor'],
    ['collect_dirty_item', 'Collecting dirty item'],
    ['deliver_dirty_item', 'Delivering dirty item'],
    ['wash_item', 'Washing item'],
    ['prepare_dish', 'Preparing dish'],
    ['prepare_drink', 'Preparing drink'],
    ['pickup_service_item', 'Collecting order'],
    ['deliver_service_item', 'Delivering order'],
    ['clean_service_item', 'Clearing service item'],
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

  it('applies a selected raise and can fire the employee', () => {
    const dispatch = vi.fn();
    const onMove = vi.fn();
    render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onMove={onMove} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('slider', { name: 'Daily salary for Sofia' }), {
      target: { value: '220' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply raise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAFF_SALARY', id: 's1', salary: 220 });
    expect(onMove).toHaveBeenCalledWith('s1');
    expect(dispatch).toHaveBeenCalledWith({ type: 'FIRE_STAFF', id: 's1' });
  });

  it('places Move directly above Fire employee', () => {
    const onMove = vi.fn();
    render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onMove={onMove} onClose={vi.fn()} />);

    const move = screen.getByRole('button', { name: 'Move' });
    const fire = screen.getByRole('button', { name: 'Fire Sofia' });
    expect(move.nextElementSibling).toBe(fire);
  });
});
