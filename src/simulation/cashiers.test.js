import { describe, expect, it } from 'vitest';
import {
  assignWaiterToStation,
  getAssignedCashierStation,
  getAvailableWaiterId,
} from './cashiers';

describe('cashier station assignments', () => {
  it('assigns only an unassigned generic waiter', () => {
    const staff = [
      { id: 'w1', role: 'waiter' },
      { id: 'w2', role: 'waiter' },
      { id: 'c1', role: 'cook' },
    ];
    const stations = [{ id: 'cashier1', assignedStaffId: 'w1' }, { id: 'cashier2' }];

    expect(getAvailableWaiterId(staff, stations)).toBe('w2');
  });

  it('finds a waiter station and keeps assignments one-to-one', () => {
    const staff = [
      { id: 'w1', role: 'waiter' },
      { id: 'w2', role: 'waiter' },
    ];
    const stations = [
      { id: 'cashier1', assignedStaffId: 'w1' },
      { id: 'cashier2', assignedStaffId: 'w1' },
    ];

    expect(getAssignedCashierStation(stations, 'w2')).toBeNull();
    expect(assignWaiterToStation(stations, staff, 'cashier2')).toEqual([
      { id: 'cashier1' },
      { id: 'cashier2', assignedStaffId: 'w1' },
    ]);
  });
});
