import { describe, expect, it } from 'vitest';
import { buildChairApproachAssignments, getChairCentre } from './seating';
import { createInitialState } from '../state/initialState';
import { updateStaff } from './staff';

describe('chair approaches', () => {
  it('seats a customer without assigning the chair approach occupied by its own waiting guide', () => {
    const fresh = createInitialState();
    let state = { ...fresh,
      tables: fresh.tables.map(table => table.id === 't2' ? { ...table, status: 'reserved', reservationOwnerStaffId: 'guide' } : table),
      staff: [{ id: 'guide', role: 'waiter', x: 340, y: 180, navigationGoal: { x: 340, y: 180 },
        task: { type: 'guide_customer', customerIds: ['customer'], tableId: 't2', chairIds: ['ch3'], stage: 'follow_guide' } }],
      customers: [{ id: 'customer', partyId: 'party', partySize: 1, state: 'guided', guideStaffId: 'guide',
        tableId: 't2', x: 340, y: 200, happiness: 80, patience: 900 }],
    };
    const assignments = buildChairApproachAssignments(state, ['customer'], ['ch3']);
    expect(assignments).not.toBeNull();
    expect(Math.hypot(assignments[0].approachPoint.x - 340, assignments[0].approachPoint.y - 180)).toBeGreaterThanOrEqual(16);
    for (let tick = 0; tick < 300 && state.customers[0].state !== 'seated'; tick += 1) {
      state = updateStaff(state, 0.1);
      expect(Math.hypot(state.customers[0].x - state.staff[0].x, state.customers[0].y - state.staff[0].y)).toBeGreaterThanOrEqual(16 - 1e-9);
    }
    expect(state.customers[0]).toMatchObject({ state: 'seated', chairId: 'ch3', x: 380, y: 190 });
  });
  it('preserves ordered chair reservations and chooses distinct reachable approaches', () => {
    const state = {
      restaurant: { expansionLevel: 1 },
      customers: [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 100, y: 120 },
      ],
      chairs: [
        { id: 'ch2', tableId: 't1', x: 240, y: 200 },
        { id: 'ch1', tableId: 't1', x: 200, y: 200 },
      ],
      tables: [{ id: 't1', x: 220, y: 180 }],
      kitchenStations: [], serviceTables: [], cashierStations: [],
    };
    const result = buildChairApproachAssignments(state, ['c1', 'c2'], ['ch1', 'ch2']);
    expect(result.map(({ customerId, chairId }) => ({ customerId, chairId }))).toEqual([
      { customerId: 'c1', chairId: 'ch1' },
      { customerId: 'c2', chairId: 'ch2' },
    ]);
    expect(new Set(result.map(item => `${item.approachCell.x},${item.approachCell.y}`)).size).toBe(2);
  });

  it('returns null when one member has no distinct reachable chair approach', () => {
    const enclosedState = {
      restaurant: { expansionLevel: 1 },
      customers: [{ id: 'c1', x: 100, y: 100 }],
      tables: [{ id: 't1', x: 220, y: 180 }],
      kitchenStations: [], serviceTables: [], cashierStations: [],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 240, y: 200 },
        { id: 'north', x: 240, y: 180 }, { id: 'south', x: 240, y: 220 },
        { id: 'west', x: 220, y: 200 }, { id: 'east', x: 260, y: 200 },
      ],
    };
    expect(buildChairApproachAssignments(enclosedState, ['c1'], ['ch1'])).toBeNull();
  });

  it('returns null without throwing when a selected chair record is malformed', () => {
    const state = {
      restaurant: { expansionLevel: 1 },
      customers: [{ id: 'c1', x: 100, y: 100 }],
      chairs: [null],
      tables: [], kitchenStations: [], serviceTables: [], cashierStations: [],
    };

    expect(() => buildChairApproachAssignments(state, ['c1'], ['ch1'])).not.toThrow();
    expect(buildChairApproachAssignments(state, ['c1'], ['ch1'])).toBeNull();
  });

  it('defines the stored seated position as the chair centre', () => {
    expect(getChairCentre({ x: 200, y: 180 })).toEqual({ x: 210, y: 190 });
  });
});
