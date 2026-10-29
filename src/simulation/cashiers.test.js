import { describe, expect, it } from 'vitest';
import {
  assignWaiterToStation,
  clearUnavailableCashierAssignments,
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

  it('skips waiters who have active work or are carrying a service item', () => {
    const staff = [
      { id: 'w1', role: 'waiter', task: { type: 'pickup_service_item', serviceItemId: 'i1' } },
      { id: 'w2', role: 'waiter', carryingServiceItemId: 'i2' },
      { id: 'w3', role: 'waiter', task: null, carryingServiceItemId: null },
    ];
    const stations = [{ id: 'cashier1' }];

    expect(getAvailableWaiterId(staff, stations)).toBe('w3');
    expect(assignWaiterToStation(stations, staff, 'cashier1')).toEqual([
      { id: 'cashier1', assignedStaffId: 'w3' },
    ]);
  });

  it('clears unavailable duty assignments but preserves an active payment owner', () => {
    const stations = [
      { id: 'resting', assignedStaffId: 'resting-waiter' },
      { id: 'paying', assignedStaffId: 'paying-waiter' },
      { id: 'working', assignedStaffId: 'working-waiter' },
    ];
    const staff = [
      { id: 'resting-waiter', role: 'waiter', task: null, effectiveDuty: 'rest' },
      { id: 'paying-waiter', role: 'waiter', task: { type: 'take_payment', stationId: 'paying' } },
      { id: 'working-waiter', role: 'waiter', task: null },
    ];

    expect(clearUnavailableCashierAssignments(stations, staff)).toEqual([
      { id: 'resting' },
      stations[1],
      stations[2],
    ]);
  });
});
