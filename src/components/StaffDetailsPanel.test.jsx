import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import StaffDetailsPanel from './StaffDetailsPanel';

const staff = {
  id: 's1', name: 'Sofia', role: 'waiter', morale: 79.6, salary: 150,
  skill: 3, task: { type: 'take_order' },
};

describe('StaffDetailsPanel', () => {
  it('shows rounded morale and staff details', () => {
    render(<StaffDetailsPanel staff={staff} dispatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Sofia' })).toBeInTheDocument();
    expect(screen.getByText('Waiter')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Taking order')).toBeInTheDocument();
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
    render(<StaffDetailsPanel staff={staff} dispatch={dispatch} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('slider', { name: 'Daily salary for Sofia' }), {
      target: { value: '220' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Raise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAFF_SALARY', id: 's1', salary: 220 });
    expect(dispatch).toHaveBeenCalledWith({ type: 'FIRE_STAFF', id: 's1' });
  });
});
