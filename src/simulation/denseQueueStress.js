import { minimumTrajectoryDistance, resolveCharacterMovementBatchWithDiagnostics } from './movement.js';
import { findPath, isInsideWorld, worldToCell } from './pathfinding.js';
import { createMovementMetrics, summariseMovementMetrics } from './movementMetrics.js';
import { getRestaurantWorld } from './world.js';

const TICK_SECONDS = 1 / 30;
const DOOR_DENSITY_RADIUS = 180;
const DOOR_CORRIDOR_BOUNDS = { left: 600, right: 960, top: 300, bottom: 400 };
const TIMING_SUMMARY_KEYS = new Set([
  'batchMilliseconds',
  'averageBatchMilliseconds',
  'pairBuildMilliseconds',
  'localConflictMilliseconds',
  'localConflictPreparationMilliseconds',
  'localConflictSolverMilliseconds',
  'localConflictCandidateMilliseconds',
  'localConflictSafetyMilliseconds',
  'localConflictFallbackMilliseconds',
  'localConflictResidualMilliseconds',
  'solverInitialPlanningMilliseconds',
  'solverNodeBuildMilliseconds',
  'solverFrontierOrderingMilliseconds',
  'solverReplanningMilliseconds',
  'solverAgedFallbackMilliseconds',
  'solverResidualMilliseconds',
  'safePrefixMilliseconds',
  'dynamicRepathMilliseconds',
  'staticRepathMilliseconds',
  'residualBatchMilliseconds',
]);

const scenarioState = {
  restaurant: { expansionLevel: 1 },
  tables: [],
  chairs: [],
  kitchenStations: [],
  serviceTables: [],
  cashierStations: [],
  washStations: [],
};

function buildCellPolyline(waypoints) {
  const cells = [{ ...waypoints[0] }];
  for (const target of waypoints.slice(1)) {
    const current = { ...cells.at(-1) };
    while (current.x !== target.x) {
      current.x += Math.sign(target.x - current.x);
      cells.push({ ...current });
    }
    while (current.y !== target.y) {
      current.y += Math.sign(target.y - current.y);
      cells.push({ ...current });
    }
  }
  return cells;
}

const inboundQueueRoutes = [
  buildCellPolyline([
    { x: 51, y: 3 }, { x: 51, y: 31 }, { x: 49, y: 31 },
    { x: 49, y: 3 }, { x: 47, y: 3 }, { x: 47, y: 17 },
    { x: 45, y: 17 }, { x: 30, y: 17 },
  ]),
  buildCellPolyline([
    { x: 50, y: 3 }, { x: 50, y: 31 }, { x: 48, y: 31 },
    { x: 48, y: 3 }, { x: 46, y: 3 }, { x: 46, y: 18 },
    { x: 45, y: 18 }, { x: 30, y: 18 },
  ]),
];
const inboundGoals = [500, 420, 340, 260, 180].flatMap(x => [460, 220, 540, 140]
  .map(y => ({ x, y })));

function buildInboundEntry(index) {
  const laneIndex = Math.floor(index / 10);
  const route = inboundQueueRoutes[laneIndex];
  const routeIndex = (index % 10) * 5;
  const startCell = route[routeIndex];
  const start = { x: startCell.x * 20, y: startCell.y * 20 };
  const goal = inboundGoals[index];
  const goalCell = worldToCell(goal);
  const partyIndex = Math.max(0, index - 4);
  const character = index < 4
    ? { id: `guide-${String(index + 1).padStart(2, '0')}`, kind: 'guide' }
    : {
        id: `party-${String(Math.floor(partyIndex / 4) + 1).padStart(2, '0')}-customer-${String(partyIndex % 4 + 1).padStart(2, '0')}`,
        kind: 'newly-admitted-customer',
        partyId: `party-${String(Math.floor(partyIndex / 4) + 1).padStart(2, '0')}`,
      };
  return {
    character: {
      ...character,
      ...start,
      path: [
        ...route.slice(routeIndex + 1),
        ...findPath(scenarioState, route.at(-1), goalCell),
      ],
      pathGoal: goalCell,
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
    },
    speed: 60,
    goal,
    released: true,
  };
}

function buildCrossingEntry(index) {
  const start = {
    x: 540 + index * 100,
    y: 360,
  };
  const goal = { x: 1020, y: 300 + index * 40 };
  const goalCell = worldToCell(goal);
  const startCell = worldToCell(start);
  const doorCell = { x: 45, y: 18 };
  const crossingRoute = buildCellPolyline([startCell, { x: startCell.x, y: doorCell.y }, doorCell]);
  return {
    character: {
      id: `opposite-crossing-${String(index + 1).padStart(2, '0')}`,
      kind: index % 2 === 0 ? 'staff' : 'customer',
      ...start,
      path: [
        ...crossingRoute.slice(1),
        ...findPath(scenarioState, doorCell, goalCell),
      ],
      pathGoal: goalCell,
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
    },
    speed: 60,
    goal,
    released: true,
  };
}

export function buildDenseQueueScenario() {
  return {
    state: scenarioState,
    entries: [
      ...Array.from({ length: 20 }, (_, index) => buildInboundEntry(index)),
      ...Array.from({ length: 4 }, (_, index) => buildCrossingEntry(index)),
    ],
    tickSeconds: TICK_SECONDS,
  };
}

export function buildDenseQueueNonTimingProjection(result) {
  const {
    summary,
    tickMilliseconds: _tickMilliseconds,
    actors,
    ...deterministicResult
  } = result;
  return {
    summary: Object.fromEntries(Object.entries(summary)
      .filter(([key]) => !TIMING_SUMMARY_KEYS.has(key))),
    ...deterministicResult,
    actors: actors.map(actor => ({
      id: actor.id,
      x: actor.x,
      y: actor.y,
      pathLength: actor.path?.length || 0,
      stalledFor: actor.stalledFor || 0,
      usingStaticFallback: actor.usingStaticFallback || false,
    })),
  };
}

export function assertDenseQueueDeterministicRuns(runs) {
  const expected = JSON.stringify(buildDenseQueueNonTimingProjection(runs[0]));
  if (!runs.every(run => JSON.stringify(buildDenseQueueNonTimingProjection(run)) === expected)) {
    throw new Error('Dense queue non-timing results changed between measured runs');
  }
}

export function selectRepresentativeDenseQueueRun(runs) {
  return runs
    .map((run, index) => ({ run, index }))
    .sort((left, right) => left.run.summary.batchMilliseconds - right.run.summary.batchMilliseconds
      || left.index - right.index)[Math.floor(runs.length / 2)];
}

export function calculateInitialPlanningOptimisation({
  baselineMillisecondsByRun,
  optimisedMillisecondsByRun,
  requiredImprovement = 0.30,
  parentNodeVisits,
}) {
  const median = values => {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = sorted.length / 2;
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[Math.floor(middle)];
  };
  const baselineMedianMilliseconds = median(baselineMillisecondsByRun);
  const optimisedMedianMilliseconds = median(optimisedMillisecondsByRun);
  const improvement = (baselineMedianMilliseconds - optimisedMedianMilliseconds)
    / baselineMedianMilliseconds;
  return {
    baselineMillisecondsByRun,
    baselineMedianMilliseconds,
    optimisedMillisecondsByRun,
    optimisedMedianMilliseconds,
    improvement,
    requiredImprovement,
    parentNodeVisits,
    performanceAccepted: parentNodeVisits === 0 && improvement >= requiredImprovement,
  };
}

function elapsedNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function runDenseQueueScenario({ ticks, metrics = createMovementMetrics() }) {
  const { state, entries: initialEntries, tickSeconds } = buildDenseQueueScenario();
  const world = getRestaurantWorld(state.restaurant);
  let minimumInitialSpacing = Infinity;
  for (let left = 0; left < initialEntries.length; left += 1) {
    for (let right = left + 1; right < initialEntries.length; right += 1) {
      minimumInitialSpacing = Math.min(minimumInitialSpacing, Math.hypot(
        initialEntries[left].character.x - initialEntries[right].character.x,
        initialEntries[left].character.y - initialEntries[right].character.y,
      ));
    }
  }
  let entries = initialEntries;
  const cumulativeDisplacement = new Map(entries.map(entry => [entry.character.id, 0]));
  const initialGoalDistance = new Map(entries.map(entry => [
    entry.character.id,
    Math.hypot(
      entry.character.x - entry.goal.x,
      entry.character.y - entry.goal.y,
    ),
  ]));
  const passedDoorIds = new Set();
  const reachedGoalIds = new Set();
  const exitedActors = new Map();
  const completedRouteIds = new Set();
  const doorPosition = { x: world.doorX, y: world.doorY + 20 };
  const initialDoorDistance = new Map(entries.map(entry => [
    entry.character.id,
    Math.hypot(entry.character.x - doorPosition.x, entry.character.y - doorPosition.y),
  ]));
  const minimumDoorDistance = new Map(initialDoorDistance);
  const tickMilliseconds = [];
  let allCoordinatesFinite = true;
  let allActorsInsideWorld = true;
  let minimumEndpointSpacing = Infinity;
  let minimumSweptSpacing = Infinity;
  let minimumEndpointPair = null;
  let minimumSweptPair = null;
  let maximumNearDoorActors = 0;
  let totalNearDoorActors = 0;
  let ticksWithAtLeastEightNearDoorActors = 0;
  let maximumDoorCorridorActors = 0;
  let totalDoorCorridorActors = 0;
  let ticksWithAtLeastFourDoorCorridorActors = 0;
  let ticksWithConflicts = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    const startedAt = elapsedNow();
    const exitedThisTick = new Set();
    const conflictBatchesBefore = metrics.conflictBatches;
    const starts = entries.map(entry => ({
      ...entry,
      character: { ...entry.character, path: [...(entry.character.path || [])] },
    }));
    const { moved, trajectories } = resolveCharacterMovementBatchWithDiagnostics(
      state,
      starts,
      tickSeconds,
      metrics,
    );

    for (const entry of starts) {
      const endpoint = moved.get(entry.character.id);
      const displacement = Math.hypot(endpoint.x - entry.character.x, endpoint.y - entry.character.y);
      cumulativeDisplacement.set(
        entry.character.id,
        cumulativeDisplacement.get(entry.character.id) + displacement,
      );
      minimumDoorDistance.set(entry.character.id, Math.min(
        minimumDoorDistance.get(entry.character.id),
        Math.hypot(endpoint.x - doorPosition.x, endpoint.y - doorPosition.y),
      ));
      if ((entry.character.x - world.doorX) * (endpoint.x - world.doorX) < 0) {
        passedDoorIds.add(entry.character.id);
        if (entry.character.id.startsWith('opposite-crossing-')) {
          exitedThisTick.add(entry.character.id);
        }
      }
      if (!entry.character.id.startsWith('opposite-crossing-')
        && passedDoorIds.has(entry.character.id) && endpoint.x <= 700) {
        exitedThisTick.add(entry.character.id);
      }
      if (entry.released && Math.hypot(
        endpoint.x - entry.goal.x,
        endpoint.y - entry.goal.y,
      ) <= 0.001) {
        reachedGoalIds.add(entry.character.id);
      }
      allCoordinatesFinite &&= Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y);
      allActorsInsideWorld &&= isInsideWorld(state, worldToCell(endpoint));
    }
    const endpoints = starts.map(entry => moved.get(entry.character.id));
    const nearDoorActors = endpoints.filter(endpoint => Math.hypot(
      endpoint.x - doorPosition.x,
      endpoint.y - doorPosition.y,
    ) <= DOOR_DENSITY_RADIUS).length;
    const doorCorridorActors = endpoints.filter(endpoint =>
      endpoint.x >= DOOR_CORRIDOR_BOUNDS.left && endpoint.x <= DOOR_CORRIDOR_BOUNDS.right
      && endpoint.y >= DOOR_CORRIDOR_BOUNDS.top && endpoint.y <= DOOR_CORRIDOR_BOUNDS.bottom).length;
    maximumNearDoorActors = Math.max(maximumNearDoorActors, nearDoorActors);
    totalNearDoorActors += nearDoorActors;
    if (nearDoorActors >= 8) ticksWithAtLeastEightNearDoorActors += 1;
    maximumDoorCorridorActors = Math.max(maximumDoorCorridorActors, doorCorridorActors);
    totalDoorCorridorActors += doorCorridorActors;
    if (doorCorridorActors >= 4) ticksWithAtLeastFourDoorCorridorActors += 1;
    if (metrics.conflictBatches > conflictBatchesBefore) ticksWithConflicts += 1;

    for (let leftIndex = 0; leftIndex < starts.length; leftIndex += 1) {
      const leftStart = starts[leftIndex].character;
      const leftEnd = moved.get(leftStart.id);
      for (let rightIndex = leftIndex + 1; rightIndex < starts.length; rightIndex += 1) {
        const rightStart = starts[rightIndex].character;
        const rightEnd = moved.get(rightStart.id);
        const endpointSpacing = Math.hypot(
          leftEnd.x - rightEnd.x,
          leftEnd.y - rightEnd.y,
        );
        const sweptSpacing = minimumTrajectoryDistance(
          trajectories.get(leftStart.id),
          trajectories.get(rightStart.id),
        );
        if (endpointSpacing < minimumEndpointSpacing) {
          minimumEndpointSpacing = endpointSpacing;
          minimumEndpointPair = {
            tick, leftId: leftStart.id, rightId: rightStart.id, spacing: endpointSpacing,
          };
        }
        if (sweptSpacing < minimumSweptSpacing) {
          minimumSweptSpacing = sweptSpacing;
          minimumSweptPair = {
            tick, leftId: leftStart.id, rightId: rightStart.id, spacing: sweptSpacing,
          };
        }
      }
    }

    entries = starts.flatMap(entry => {
      const character = moved.get(entry.character.id);
      if (exitedThisTick.has(entry.character.id)) {
        exitedActors.set(entry.character.id, character);
        completedRouteIds.add(entry.character.id);
        return [];
      }
      return [{ ...entry, character }];
    });
    tickMilliseconds.push(elapsedNow() - startedAt);
  }

  const activeById = new Map(entries.map(entry => [entry.character.id, entry]));
  const finalGoalDistance = new Map(initialEntries.map(entry => {
    const character = activeById.get(entry.character.id)?.character || exitedActors.get(entry.character.id);
    return [
      entry.character.id,
      Math.hypot(character.x - entry.goal.x, character.y - entry.goal.y),
    ];
  }));
  return {
    summary: summariseMovementMetrics(metrics),
    tickMilliseconds,
    displacedActors: [...cumulativeDisplacement.values()].filter(distance => distance >= 16).length,
    totalDisplacement: [...cumulativeDisplacement.values()].reduce((total, distance) => total + distance, 0),
    totalGoalDistanceReduction: [...initialGoalDistance].reduce((total, [id, distance]) =>
      total + Math.max(0, distance - finalGoalDistance.get(id)), 0),
    actorsPassingDoor: passedDoorIds.size,
    actorsApproachingDoor: [...initialDoorDistance].filter(([id, distance]) =>
      distance - minimumDoorDistance.get(id) >= 16 || passedDoorIds.has(id)).length,
    actorsReachingGoals: reachedGoalIds.size,
    actorsCompletingDoorRoutes: completedRouteIds.size,
    doorDensityRadius: DOOR_DENSITY_RADIUS,
    doorCorridorBounds: DOOR_CORRIDOR_BOUNDS,
    maximumNearDoorActors,
    meanNearDoorActors: totalNearDoorActors / Math.max(1, ticks),
    ticksWithAtLeastEightNearDoorActors,
    maximumDoorCorridorActors,
    meanDoorCorridorActors: totalDoorCorridorActors / Math.max(1, ticks),
    ticksWithAtLeastFourDoorCorridorActors,
    ticksWithConflicts,
    ticksWithConflictComponents: ticksWithConflicts,
    allCoordinatesFinite,
    allActorsInsideWorld,
    minimumInitialSpacing,
    minimumEndpointSpacing,
    minimumSweptSpacing,
    minimumEndpointPair,
    minimumSweptPair,
    actors: initialEntries.map(entry =>
      activeById.get(entry.character.id)?.character || exitedActors.get(entry.character.id)),
  };
}
