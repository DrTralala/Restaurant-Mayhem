import { describe, expect, it, vi } from 'vitest';

const solveCalls = vi.hoisted(() => []);

vi.mock('./localConflictSolver', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    solveLocalConflictComponent(options) {
      solveCalls.push(options);
      return actual.solveLocalConflictComponent(options);
    },
  };
});

import { resolveCharacterMovementBatch } from './movement';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

describe('movement local-solver horizon', () => {
  it('plans and reserves eight slots even when this tick can execute only a short prefix', () => {
    solveCalls.length = 0;
    resolveCharacterMovementBatch(openState, [
      {
        character: {
          id: 'left', x: 99, y: 100,
          path: [{ x: 5, y: 5 }, { x: 6, y: 5 }], pathGoal: { x: 6, y: 5 }, stalledFor: 1,
        },
        speed: 20,
      },
      {
        character: {
          id: 'top', x: 100, y: 99,
          path: [{ x: 5, y: 5 }, { x: 5, y: 6 }], pathGoal: { x: 5, y: 6 },
        },
        speed: 20,
      },
    ], 0.1);

    expect(solveCalls).toHaveLength(1);
    expect(solveCalls[0].horizon).toBe(8);
    for (const actor of solveCalls[0].actors) expect(actor.routeCells.length).toBeGreaterThan(0);
  });
});
