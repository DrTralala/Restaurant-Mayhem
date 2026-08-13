import { describe, expect, it } from 'vitest';
import { createInitialState } from './initialState';

describe('createInitialState', () => {
  it('starts the balanced economy with $600 and a $12 toast', () => {
    const state = createInitialState();

    expect(state.restaurant.funds).toBe(600);
    expect(state.dishes[0].price).toBe(12);
  });
  it('gives starter staff distinct names', () => {
    const names = createInitialState().staff.map(staff => staff.name);

    expect(names).toEqual(['Marco', 'Sofia', 'Luca', 'Elena']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('assigns genders to starter staff', () => {
    expect(createInitialState().staff.map(staff => [staff.name, staff.gender])).toEqual([
      ['Marco', 'male'],
      ['Sofia', 'female'],
      ['Luca', 'male'],
      ['Elena', 'female'],
    ]);
  });

  it('faces every starter chair towards its table', () => {
    const rotations = Object.fromEntries(
      createInitialState().chairs.map(chair => [chair.id, chair.rotation]),
    );

    expect(rotations).toEqual({
      ch1: 2, ch2: 0,
      ch3: 2, ch4: 0,
      ch5: 2, ch6: 0, ch7: 1, ch8: 3,
      ch9: 2, ch10: 0, ch11: 1, ch12: 3,
    });
  });

  it('starts with one usable entrance and exit door', () => {
    expect(createInitialState().doors).toEqual([{ id: 'door1', y: 340 }]);
  });

  it('starts with one cook and three generic waiters', () => {
    const state = createInitialState();

    expect(state.version).toBe(3);
    expect(state.staff.map(staff => staff.role)).toEqual(['cook', 'waiter', 'waiter', 'waiter']);
    expect(state.cashierStations[0]).toMatchObject({
      id: 'cashier1',
      assignedStaffId: 'starter-cashier-waiter',
    });
  });
});
