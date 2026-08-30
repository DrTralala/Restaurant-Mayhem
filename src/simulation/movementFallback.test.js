import { describe, expect, it, vi } from 'vitest';

const solverCalls = vi.hoisted(() => []);

vi.mock('./localConflictSolver', () => ({
  solveLocalConflictComponent(options) {
    solverCalls.push(options);
    return null;
  },
}));

import { resolveCharacterMovementBatch } from './movement';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

describe('movement fallback invocation', () => {
  it('invokes the existing safe local fallback when the bounded solver returns null', () => {
    solverCalls.length = 0;
    const entries = [
      { character: { id: 'left', x: 80, y: 100, path: [{ x: 6, y: 5 }] }, speed: 40 },
      { character: { id: 'top', x: 100, y: 80, path: [{ x: 5, y: 6 }] }, speed: 40 },
    ];

    const moved = resolveCharacterMovementBatch(openState, entries, 1);

    expect(solverCalls).toHaveLength(1);
    expect([...moved.values()].every(result => Number.isFinite(result.x) && Number.isFinite(result.y))).toBe(true);
    expect(Math.hypot(
      moved.get('left').x - moved.get('top').x,
      moved.get('left').y - moved.get('top').y,
    )).toBeGreaterThanOrEqual(16 - 1e-6);
  });
});
