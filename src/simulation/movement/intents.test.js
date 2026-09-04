import { beforeEach, expect, it, vi } from 'vitest';

const { buildDirectTrajectorySpy } = vi.hoisted(() => ({
  buildDirectTrajectorySpy: vi.fn(),
}));

vi.mock('./trajectory', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildDirectTrajectory(...args) {
      buildDirectTrajectorySpy(...args);
      return actual.buildDirectTrajectory(...args);
    },
  };
});

import {
  buildMovementIntent,
  resolutionFromSolverPlan,
  solverActorForIntent,
} from './intents';

beforeEach(() => {
  buildDirectTrajectorySpy.mockClear();
});

const openState = {
  restaurant: { expansionLevel: 1 },
  tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [],
};

it('constructs one trajectory when a direct target consumes the queued path cell', () => {
  const intent = buildMovementIntent(openState, {
    character: { id: 'actor', x: 100, y: 100, path: [{ x: 6, y: 5 }] },
    target: { x: 120, y: 100 },
    consumePath: true,
    speed: 20,
  }, 1);

  expect(buildDirectTrajectorySpy).toHaveBeenCalledTimes(1);
  expect({
    desired: intent.desired,
    trajectory: intent.trajectory,
    pathConsumedAt: intent.pathConsumedAt,
  }).toEqual({
    desired: { id: 'actor', x: 120, y: 100, path: [] },
    trajectory: [
      { start: { x: 100, y: 100 }, end: { x: 120, y: 100 }, startTime: 0, endTime: 1 },
    ],
    pathConsumedAt: 1,
  });
});

it('builds the exact one-cell path intent', () => {
  const intent = buildMovementIntent(openState, {
    character: { id: 'actor', x: 100, y: 100, path: [{ x: 6, y: 5 }] },
    speed: 20,
  }, 1);
  expect({
    start: intent.start,
    desired: intent.desired,
    spacing: intent.spacing,
    trajectory: intent.trajectory,
    pathConsumedAt: intent.pathConsumedAt,
  }).toEqual({
    start: { x: 100, y: 100 },
    desired: { id: 'actor', x: 120, y: 100, path: [] },
    spacing: 16,
    trajectory: [
      { start: { x: 100, y: 100 }, end: { x: 120, y: 100 }, startTime: 0, endTime: 1 },
    ],
    pathConsumedAt: 1,
  });
});

it('converts leaving and entering intents to exact door-priority actors', () => {
  const leavingIntent = buildMovementIntent(openState, {
    character: {
      id: 'leaver', state: 'leaving', exitDoorId: 'front',
      x: 100, y: 100, path: [{ x: 6, y: 5 }], pathGoal: { x: 6, y: 5 },
    },
    speed: 20,
  }, 1);
  const enteringIntent = buildMovementIntent(openState, {
    character: {
      id: 'entrant', state: 'guided', entryDoorId: 'front',
      x: 100, y: 120, path: [{ x: 6, y: 6 }], pathGoal: { x: 6, y: 6 },
    },
    speed: 20,
  }, 1);

  expect(solverActorForIntent(leavingIntent)).toMatchObject({
    id: 'leaver', moving: true, doorId: 'front', doorFlow: 'out',
  });
  expect(solverActorForIntent(enteringIntent)).toMatchObject({
    id: 'entrant', moving: true, doorId: 'front', doorFlow: 'in',
  });
});

it('materialises an exact partial one-cell solver plan', () => {
  const intent = buildMovementIntent(openState, {
    character: { id: 'actor', x: 100, y: 100, path: [{ x: 6, y: 5 }] },
    speed: 10,
  }, 1);
  const plannerCell = Object.freeze({ x: 6, y: 5 });
  const resolution = resolutionFromSolverPlan(
    openState, intent, [plannerCell], [intent], 1, 1, plannerCell,
  );

  expect({
    endpoint: resolution.endpoint,
    pathConsumptionTimes: resolution.pathConsumptionTimes,
    plannedArrivals: resolution.plannedArrivals,
    trajectory: resolution.trajectory,
    fromLocalConflictPlan: resolution.fromLocalConflictPlan,
  }).toEqual({
    endpoint: {
      id: 'actor', x: 110, y: 100,
      path: [{ x: 6, y: 5 }],
      localConflictTarget: { x: 6, y: 5 },
    },
    pathConsumptionTimes: [],
    plannedArrivals: [{ cell: { x: 6, y: 5 }, time: 2 }],
    trajectory: [
      { start: { x: 100, y: 100 }, end: { x: 110, y: 100 }, startTime: 0, endTime: 1 },
    ],
    fromLocalConflictPlan: true,
  });
  expect(resolution.endpoint.localConflictTarget).not.toBe(plannerCell);
});
