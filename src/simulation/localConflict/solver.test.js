import { expect, it } from 'vitest';
import { solveLocalConflictComponent } from './solver';

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

const actor = (id, startCell, goalCell, stalledFor = 0) => ({
  id,
  startCell,
  goalCell,
  routeCells: [goalCell],
  stalledFor,
  moving: true,
});

it('preserves exact PBS and aged-fallback results', () => {
  const pbs = solveLocalConflictComponent({
    state: openState,
    actors: [
      actor('a', { x: 4, y: 5 }, { x: 5, y: 5 }),
      actor('b', { x: 5, y: 4 }, { x: 5, y: 5 }),
    ],
    blockedCells: new Set(), horizon: 3, progressHorizon: 2, maxHighLevelNodes: 128,
  });
  expect({ mode: pbs.mode, plans: [...pbs.plans.entries()].sort() }).toEqual({
    mode: 'pbs',
    plans: [
      ['a', [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]],
      ['b', [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 5 }]],
    ],
  });

  const fallback = solveLocalConflictComponent({
    state: openState,
    actors: [
      actor('a-new', { x: 4, y: 5 }, { x: 5, y: 5 }, 0),
      actor('z-old', { x: 5, y: 4 }, { x: 5, y: 5 }, 4),
    ],
    blockedCells: new Set(), horizon: 3, progressHorizon: 2, maxHighLevelNodes: 0,
  });
  expect({ mode: fallback.mode, plans: [...fallback.plans.entries()].sort() }).toEqual({
    mode: 'aged-fallback',
    plans: [
      ['a-new', [{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 5 }]],
      ['z-old', [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]],
    ],
  });
});
