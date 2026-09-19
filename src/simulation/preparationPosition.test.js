import { describe, expect, it } from 'vitest';
import {
  findPreparationTarget,
  isAtPreparationPosition,
} from './preparationPosition';

const station = { id: 'k1', x: 100, y: 100 };

describe('preparation positions', () => {
  it('requires a close side position rather than a diagonal or distant one', () => {
    expect(isAtPreparationPosition({ x: 90, y: 110 }, station)).toBe(true);
    expect(isAtPreparationPosition({ x: 90, y: 90 }, station)).toBe(false);
    expect(isAtPreparationPosition({ x: 80, y: 110 }, station)).toBe(false);
    expect(isAtPreparationPosition({ x: 110, y: 110 }, station)).toBe(false);
  });

  it('only accepts the movement arrival tolerance around a legal side point', () => {
    expect(isAtPreparationPosition({ x: 91.5, y: 110 }, station)).toBe(true);
    expect(isAtPreparationPosition({ x: 92.1, y: 110 }, station)).toBe(false);
    expect(isAtPreparationPosition({ x: 90, y: 113 }, station)).toBe(false);
  });

  it('returns a real goal and distance when the worker shares the target cell', () => {
    const state = {
      restaurant: { expansionLevel: 1 },
      kitchenStations: [station],
      staff: [{ id: 'cook', role: 'cook', x: 80, y: 110, task: null }],
      tables: [],
      chairs: [],
      serviceTables: [],
      cashierStations: [],
      washStations: [],
    };
    const target = findPreparationTarget(state, station, state.staff[0]);

    expect(target).toEqual({ goal: { x: 90, y: 110 }, distance: 10 });
  });

  it('does not claim a route from a worker whose current cell is blocked by the station', () => {
    const worker = {
      id: 'cook', role: 'cook', x: 110, y: 110,
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
    };
    const target = findPreparationTarget({
      restaurant: { expansionLevel: 1 },
      kitchenStations: [station],
      staff: [worker],
      tables: [], chairs: [], serviceTables: [], cashierStations: [], washStations: [],
    }, station, worker);

    expect(target).toBeNull();
  });

  it('rejects a claimed preparation destination and returns another legal side point', () => {
    const worker = { id: 'cook', role: 'cook', x: 80, y: 110, task: null };
    const target = findPreparationTarget({
      restaurant: { expansionLevel: 1 },
      kitchenStations: [station],
      staff: [
        worker,
        {
          id: 'blocker', role: 'cook', x: 90, y: 110,
          navigationGoal: { x: 90, y: 110 }, task: { type: 'prepare_dish' },
        },
      ],
      tables: [], chairs: [], serviceTables: [], cashierStations: [], washStations: [],
    }, station, worker);

    expect(target).toBeTruthy();
    expect(target.goal).not.toEqual({ x: 90, y: 110 });
    expect(isAtPreparationPosition(target.goal, station)).toBe(true);
  });

  it('returns null when every legal preparation side cell is blocked', () => {
    const blockers = [
      [80, 100], [80, 120], [140, 100], [140, 120],
      [100, 80], [120, 80], [100, 140], [120, 140],
    ].map(([x, y], index) => ({ id: `blocker-${index}`, x, y }));
    const worker = { id: 'cook', role: 'cook', x: 80, y: 110, task: null };
    const target = findPreparationTarget({
      restaurant: { expansionLevel: 1 },
      kitchenStations: [station],
      staff: [worker],
      tables: [], chairs: blockers, serviceTables: [], cashierStations: [], washStations: [],
    }, station, worker);

    expect(target).toBeNull();
  });
});
