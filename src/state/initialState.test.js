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

  it('starts with a top-right cashier station and a dual-role cashier-waitress', () => {
    const state = createInitialState();

    expect(state.cashierStations).toEqual([
      expect.objectContaining({ id: 'cashier1', x: 800, y: 120 }),
    ]);
    expect(state.staff).toContainEqual(expect.objectContaining({
      name: 'Elena', role: 'cashier_waiter', gender: 'female',
    }));
  });
});
