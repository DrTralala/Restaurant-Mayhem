import { minimumTrajectoryDistance, resolveCharacterMovementBatchWithDiagnostics } from './movement.js';
import { findPath, isInsideWorld, worldToCell } from './pathfinding.js';
import { createMovementMetrics, summariseMovementMetrics } from './movementMetrics.js';
import { getRestaurantWorld } from './world.js';

const TICK_SECONDS = 1 / 30;

const guideCentre = { x: 860, y: 360 };
const guideStarts = [
  { id: 'guide-01', kind: 'guide', x: 800, y: 360 },
  { id: 'guide-02', kind: 'guide', x: 920, y: 360 },
  { id: 'guide-03', kind: 'guide', x: 860, y: 300 },
  { id: 'guide-04', kind: 'guide', x: 860, y: 420 },
];
const guideParking = [
  { x: 500, y: 360 }, { x: 640, y: 200 }, { x: 600, y: 280 }, { x: 600, y: 440 },
];
const partyPositions = [960, 1020].flatMap(x => [60, 140, 220, 300, 380, 460, 540, 620]
  .map(y => ({ x, y })));
const partyGoals = [780, 840].flatMap(x => [60, 660, 140, 580, 220, 500, 300, 420]
  .map(y => ({ x, y })));
const partyStarts = partyPositions.map((position, index) => {
  const party = Math.floor(index / 4) + 1;
  const member = index % 4 + 1;
  return {
    id: `party-${String(party).padStart(2, '0')}-customer-${String(member).padStart(2, '0')}`,
    kind: 'newly-admitted-customer',
    partyId: `party-${String(party).padStart(2, '0')}`,
    ...position,
  };
});
const crossingStarts = [300, 420, 540, 660].map((y, index) => ({
  id: `opposite-crossing-${String(index + 1).padStart(2, '0')}`,
  kind: index % 2 === 0 ? 'staff' : 'customer',
  x: 520,
  y,
}));
const crossingGoals = [320, 360, 400, 440].map(y => ({ x: 1020, y }));

const scenarioState = {
  restaurant: { expansionLevel: 1 },
  tables: [],
  chairs: [],
  kitchenStations: [],
  serviceTables: [],
  cashierStations: [],
  washStations: [],
};

function ticksToDoor(start, doorPosition) {
  return Math.ceil((Math.abs(start.x - doorPosition.x) + Math.abs(start.y - doorPosition.y)) / 2);
}

function buildRoute(state, start, goal, doorCell = null) {
  const startCell = worldToCell(start);
  const goalCell = worldToCell(goal);
  if (!doorCell) return findPath(state, startCell, goalCell);
  return [
    ...findPath(state, startCell, doorCell),
    ...findPath(state, doorCell, goalCell),
  ];
}

function buildEntry(start, goal, releaseTick = 0, stressKind = 'routed', doorCell = null) {
  const startCell = worldToCell(start);
  const goalCell = worldToCell(goal);
  const path = buildRoute(scenarioState, start, goal, doorCell);
  if (path.length === 0) throw new Error(`Dense queue route is unavailable for ${start.id}`);
  return {
    character: {
      ...start,
      path,
      pathGoal: goalCell,
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
    },
    speed: 60,
    goal,
    releaseTick,
    startPosition: { x: start.x, y: start.y },
    stressKind,
    doorCell,
    released: stressKind === 'guide',
  };
}

export function buildDenseQueueScenario() {
  const entries = [
    ...guideStarts.map((start, index) => buildEntry(start, guideParking[index], 0, 'guide')),
    ...partyStarts.map((start, index) => buildEntry(
      start,
      partyGoals[index],
      Math.max(0, (index < 8 ? 300 + index * 40 : 620 + (index - 8) * 35)
        - ticksToDoor(start, { x: 920, y: 340 })),
      'routed',
      { x: 45, y: index < 8 ? 17 : 18 },
    )),
    ...crossingStarts.map((start, index) => buildEntry(
      start,
      crossingGoals[index],
      Math.max(0, 920 + index * 40 - ticksToDoor(start, { x: 880, y: 360 })),
      'routed',
      { x: 45, y: index % 2 === 0 ? 17 : 18 },
    )),
  ];
  return {
    state: scenarioState,
    entries,
    tickSeconds: TICK_SECONDS,
  };
}

function prepareEntryForTick(state, entry, tick) {
  if (entry.stressKind === 'guide') {
    const guideIndex = Number(entry.character.id.slice(-2)) - 1;
    if (tick < 300) {
      const target = tick % 48 < 22 ? guideCentre : guideStarts[guideIndex];
      const targetCell = worldToCell(target);
      return {
        ...entry,
        target,
        character: { ...entry.character, path: [targetCell], pathGoal: targetCell },
      };
    }
    if (!entry.guideParked) {
      const goalCell = worldToCell(guideParking[guideIndex]);
      return {
        ...entry,
        guideParked: true,
        target: undefined,
        character: {
          ...entry.character,
          path: findPath(state, worldToCell(entry.character), goalCell),
          pathGoal: goalCell,
          stalledFor: 0,
        },
      };
    }
    return { ...entry, target: undefined };
  }
  if (!entry.released && tick < entry.releaseTick) {
    const target = {
      x: entry.startPosition.x + (Math.floor(tick / 6) % 2 === 0 ? 5 : 0),
      y: entry.startPosition.y,
    };
    const targetCell = worldToCell(target);
    return {
      ...entry,
      target,
      character: { ...entry.character, path: [targetCell], pathGoal: targetCell },
    };
  }
  if (!entry.released) {
    const goalCell = worldToCell(entry.goal);
    return {
      ...entry,
      released: true,
      target: undefined,
      character: {
        ...entry.character,
        path: buildRoute(state, entry.character, entry.goal, entry.doorCell),
        pathGoal: goalCell,
        stalledFor: 0,
      },
    };
  }
  return { ...entry, target: undefined };
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

  for (let tick = 0; tick < ticks; tick += 1) {
    const startedAt = elapsedNow();
    entries = entries.map(entry => prepareEntryForTick(state, entry, tick));
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

    entries = starts.map(entry => ({
      ...entry,
      character: moved.get(entry.character.id),
    }));
    tickMilliseconds.push(elapsedNow() - startedAt);
  }

  const finalGoalDistance = new Map(entries.map(entry => [
    entry.character.id,
    Math.hypot(
      entry.character.x - entry.goal.x,
      entry.character.y - entry.goal.y,
    ),
  ]));
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
    allCoordinatesFinite,
    allActorsInsideWorld,
    minimumInitialSpacing,
    minimumEndpointSpacing,
    minimumSweptSpacing,
    minimumEndpointPair,
    minimumSweptPair,
    actors: entries.map(entry => entry.character),
  };
}
