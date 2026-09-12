import { advanceCharacterMovementBatch } from './movement';
import { isInsideWorld, worldToCell } from './pathfinding';
import { createMovementMetrics, summariseMovementMetrics } from './movementMetrics';
import { nonTimingSummary, recordStressTick } from './navigation/stressDiagnostics';
import { getRestaurantWorld } from './world';

const TICK_SECONDS = 1 / 30;
const DOOR_DENSITY_RADIUS = 180;
const DOOR_CORRIDOR_BOUNDS = { left: 600, right: 960, top: 300, bottom: 400 };
const scenarioState = {
  restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [],
  serviceTables: [], cashierStations: [], washStations: [],
};
const inboundGoals = [500, 420, 340, 260, 180].flatMap(x => [460, 220, 540, 140]
  .map(y => ({ x, y })));

function buildInboundEntry(index) {
  const lane = Math.floor(index / 10);
  const position = index % 10;
  // Original serpentine fixture's starting positions, without retaining its routes.
  const start = position < 6
    ? { x: 1020 - lane * 20, y: 60 + position * 100 }
    : { x: 980 - lane * 20, y: 620 - (position - 6) * 100 };
  const partyIndex = Math.max(0, index - 4);
  const character = index < 4
    ? { id: `guide-${String(index + 1).padStart(2, '0')}`, kind: 'guide' }
    : {
        id: `party-${String(Math.floor(partyIndex / 4) + 1).padStart(2, '0')}-customer-${String(partyIndex % 4 + 1).padStart(2, '0')}`,
        kind: 'newly-admitted-customer',
        partyId: `party-${String(Math.floor(partyIndex / 4) + 1).padStart(2, '0')}`,
      };
  const goal = inboundGoals[index];
  return { character: { ...character, ...start, navigationGoal: { ...goal } },
    goal, speed: 60, terminalPolicy: 'hold' };
}

function buildCrossingEntry(index) {
  const goal = { x: 1020, y: 300 + index * 40 };
  return {
    character: {
      id: `opposite-crossing-${String(index + 1).padStart(2, '0')}`,
      kind: index % 2 === 0 ? 'staff' : 'customer',
      x: 540 + index * 100, y: 360, navigationGoal: { ...goal },
    },
    goal, speed: 60, terminalPolicy: 'hold',
  };
}

export function buildDenseQueueScenario() {
  return { state: scenarioState, tickSeconds: TICK_SECONDS, entries: [
    ...Array.from({ length: 20 }, (_, index) => buildInboundEntry(index)),
    ...Array.from({ length: 4 }, (_, index) => buildCrossingEntry(index)),
  ] };
}

export function buildDenseQueueNonTimingProjection(result) {
  const { timings: _timings, summary, ...projection } = result;
  return { ...projection, summary: nonTimingSummary(summary) };
}

export function runDenseQueueScenario({ ticks = 900, metrics = createMovementMetrics() } = {}) {
  if (!Number.isInteger(ticks) || ticks < 1) throw new Error('Dense queue ticks must be a positive integer');
  const { state: initialState, entries: initialEntries, tickSeconds } = buildDenseQueueScenario();
  let state = initialState;
  let entries = initialEntries;
  const world = getRestaurantWorld(state.restaurant);
  const doorPosition = { x: world.doorX, y: world.doorY + 20 };
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cumulativeDisplacement = new Map(entries.map(entry => [entry.character.id, 0]));
  const minimumDoorDistance = new Map(entries.map(entry => [entry.character.id, distance(entry.character, doorPosition)]));
  const passedDoorIds = new Set();
  const reachedGoalIds = new Set();
  const completed = new Map();
  const tickRecords = [];
  const timings = { ticks: [], batches: [], planner: [], executor: [] };
  let minimumInitialSpacing = Infinity;
  for (let left = 0; left < entries.length; left += 1) {
    for (const right of entries.slice(left + 1)) {
      minimumInitialSpacing = Math.min(minimumInitialSpacing, distance(entries[left].character, right.character));
    }
  }
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
  for (let tick = 0; tick < ticks; tick += 1) {
    const startedAt = performance.now();
    const before = { batch: metrics.batchMilliseconds, planner: metrics.plannerMilliseconds, executor: metrics.executorMilliseconds };
    const result = advanceCharacterMovementBatch(state, entries, tickSeconds, metrics);
    const record = recordStressTick(state, entries, result, tickSeconds, metrics);
    tickRecords.push(record);
    if (record.minimumEndpointSpacing < minimumEndpointSpacing) {
      minimumEndpointSpacing = record.minimumEndpointSpacing;
      minimumEndpointPair = { tick, ...record.minimumEndpointPair };
    }
    if (record.minimumSweptSpacing < minimumSweptSpacing) {
      minimumSweptSpacing = record.minimumSweptSpacing;
      minimumSweptPair = { tick, ...record.minimumSweptPair };
    }
    const endpoints = [...result.moved.values()];
    const nearDoor = endpoints.filter(endpoint => distance(endpoint, doorPosition) <= DOOR_DENSITY_RADIUS).length;
    const corridor = endpoints.filter(endpoint => endpoint.x >= DOOR_CORRIDOR_BOUNDS.left
      && endpoint.x <= DOOR_CORRIDOR_BOUNDS.right && endpoint.y >= DOOR_CORRIDOR_BOUNDS.top
      && endpoint.y <= DOOR_CORRIDOR_BOUNDS.bottom).length;
    maximumNearDoorActors = Math.max(maximumNearDoorActors, nearDoor);
    totalNearDoorActors += nearDoor;
    if (nearDoor >= 8) ticksWithAtLeastEightNearDoorActors += 1;
    maximumDoorCorridorActors = Math.max(maximumDoorCorridorActors, corridor);
    totalDoorCorridorActors += corridor;
    if (corridor >= 4) ticksWithAtLeastFourDoorCorridorActors += 1;
    entries = entries.flatMap(entry => {
      const id = entry.character.id;
      const endpoint = result.moved.get(id);
      cumulativeDisplacement.set(id, cumulativeDisplacement.get(id) + distance(endpoint, entry.character));
      minimumDoorDistance.set(id, Math.min(minimumDoorDistance.get(id), distance(endpoint, doorPosition)));
      if ((entry.character.x - world.doorX) * (endpoint.x - world.doorX) < 0) passedDoorIds.add(id);
      if (endpoint.x === entry.goal.x && endpoint.y === entry.goal.y) {
        reachedGoalIds.add(id);
        if (result.statuses.get(id)?.plan !== 'arrived') throw new Error(`Exact-goal actor ${id} did not report arrived`);
      }
      allCoordinatesFinite &&= Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y);
      allActorsInsideWorld &&= isInsideWorld(state, worldToCell(endpoint));
      // Unchanged synthetic completion/removal boundaries, not exact-goal arrival.
      if (passedDoorIds.has(id) && (id.startsWith('opposite-crossing-') || endpoint.x <= 700)) {
        completed.set(id, endpoint);
        return [];
      }
      return [{ ...entry, character: endpoint }];
    });
    state = { ...state, movementCoordinator: result.coordinator };
    timings.batches.push(metrics.batchMilliseconds - before.batch);
    timings.planner.push(metrics.plannerMilliseconds - before.planner);
    timings.executor.push(metrics.executorMilliseconds - before.executor);
    timings.ticks.push(performance.now() - startedAt);
  }
  const active = new Map(entries.map(entry => [entry.character.id, entry.character]));
  const actors = initialEntries.map(entry => active.get(entry.character.id) || completed.get(entry.character.id));
  return {
    summary: summariseMovementMetrics(metrics), timings, tickRecords,
    navigationVersion: state.movementCoordinator.version,
    maxExpansionsPerTick: Math.max(...tickRecords.map(tick => tick.expansionsThisTick)),
    maximumActorQuantum: tickRecords.reduce((maximum, tick) => Math.max(maximum, ...tick.actorQuanta), 0),
    maximumGroupQuantum: tickRecords.reduce((maximum, tick) => Math.max(maximum, ...tick.groupQuanta), 0),
    allMovementScheduled: tickRecords.every(tick => tick.allMovementScheduled),
    allWithinSpeedBudget: tickRecords.every(tick => tick.allWithinSpeedBudget),
    displacedActors: [...cumulativeDisplacement.values()].filter(value => value >= 16).length,
    totalDisplacement: [...cumulativeDisplacement.values()].reduce((sum, value) => sum + value, 0),
    totalGoalDistanceReduction: initialEntries.reduce((sum, entry, index) => sum
      + Math.max(0, distance(entry.character, entry.goal) - distance(actors[index], entry.goal)), 0),
    actorsPassingDoor: passedDoorIds.size,
    actorsApproachingDoor: initialEntries.filter(entry => distance(entry.character, doorPosition)
      - minimumDoorDistance.get(entry.character.id) >= 16 || passedDoorIds.has(entry.character.id)).length,
    actorsReachingGoals: reachedGoalIds.size,
    actorsCompletingDoorRoutes: completed.size, completionOrder: [...completed.keys()],
    doorDensityRadius: DOOR_DENSITY_RADIUS, doorCorridorBounds: DOOR_CORRIDOR_BOUNDS,
    maximumNearDoorActors, meanNearDoorActors: totalNearDoorActors / ticks, ticksWithAtLeastEightNearDoorActors,
    maximumDoorCorridorActors, meanDoorCorridorActors: totalDoorCorridorActors / ticks,
    ticksWithAtLeastFourDoorCorridorActors,
    allCoordinatesFinite, allActorsInsideWorld, minimumInitialSpacing,
    minimumEndpointSpacing, minimumSweptSpacing, minimumEndpointPair, minimumSweptPair, actors,
  };
}
