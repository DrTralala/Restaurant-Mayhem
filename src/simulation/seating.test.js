import { describe, expect, it } from 'vitest';
import { buildChairApproachAssignments, getChairCentre } from './seating';

describe('chair approaches', () => {
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
      tables: [], kitchenStations: [], serviceTables: [], cashierStations: [],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 240, y: 200 },
        { id: 'north', x: 240, y: 180 }, { id: 'south', x: 240, y: 220 },
        { id: 'west', x: 220, y: 200 }, { id: 'east', x: 260, y: 200 },
      ],
    };
    expect(buildChairApproachAssignments(enclosedState, ['c1'], ['ch1'])).toBeNull();
  });

  it('defines the stored seated position as the chair centre', () => {
    expect(getChairCentre({ x: 200, y: 180 })).toEqual({ x: 210, y: 190 });
  });
});
