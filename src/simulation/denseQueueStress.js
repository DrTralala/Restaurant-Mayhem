import { minimumSweptDistance, resolveCharacterMovementBatch } from './movement.js';
import { findPath, isInsideWorld, worldToCell } from './pathfinding.js';
import { createMovementMetrics, summariseMovementMetrics } from './movementMetrics.js';

const TICK_SECONDS = 1 / 30;

const inboundStarts = [
  { id: 'guide-01', kind: 'guide', x: 860, y: 340, speed: 60 },
  { id: 'guide-02', kind: 'guide', x: 940, y: 280, speed: 0.1 },
  { id: 'guide-03', kind: 'guide', x: 940, y: 360, speed: 0.1 },
  { id: 'guide-04', kind: 'guide', x: 940, y: 440, speed: 0.1 },
  ...[1, 2, 3, 4].flatMap((party, column) => [280, 300, 400, 420].map((y, member) => ({
    id: `party-${String(party).padStart(2, '0')}-customer-${String(member + 1).padStart(2, '0')}`,
    kind: 'newly-admitted-customer',
    partyId: `party-${String(party).padStart(2, '0')}`,
    x: 960 + column * 20,
    y,
    speed: 0.1,
  }))),
];

const inboundGoals = [
  { x: 860, y: 380 },
  ...[500, 540, 580, 620, 660].flatMap(x => [180, 220, 460, 500]
    .map(y => ({ x, y }))).slice(0, 19),
];

const crossingStarts = [
  { id: 'opposite-crossing-01', kind: 'staff', x: 840, y: 360, speed: 60 },
  { id: 'opposite-crossing-02', kind: 'customer', x: 820, y: 280, speed: 0.1 },
  { id: 'opposite-crossing-03', kind: 'staff', x: 820, y: 400, speed: 0.1 },
  { id: 'opposite-crossing-04', kind: 'customer', x: 820, y: 440, speed: 0.1 },
];

const crossingGoals = [
  { x: 880, y: 360 },
  { x: 1020, y: 320 },
  { x: 1020, y: 360 },
  { x: 1020, y: 400 },
];

const scenarioState = {
  restaurant: { expansionLevel: 1 },
  tables: [],
  chairs: [],
  kitchenStations: [],
  serviceTables: [],
  cashierStations: [],
  washStations: [],
};

function buildEntry(start, goal) {
  const { speed, ...characterStart } = start;
  const goalCell = worldToCell(goal);
  const path = findPath(scenarioState, worldToCell(start), goalCell);
  if (path.length === 0) throw new Error(`Dense queue route is unavailable for ${start.id}`);
  return {
    character: {
      ...characterStart,
      path,
      pathGoal: goalCell,
      stalledFor: 0,
      minimumSpacing: 16,
      usingStaticFallback: false,
    },
    speed,
  };
}

export function buildDenseQueueScenario() {
  const entries = [
    ...inboundStarts.map((start, index) => buildEntry(start, inboundGoals[index])),
    ...crossingStarts.map((start, index) => buildEntry(start, crossingGoals[index])),
  ];
  return {
    state: scenarioState,
    entries,
    tickSeconds: TICK_SECONDS,
  };
}

function elapsedNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function runDenseQueueScenario({ ticks, metrics = createMovementMetrics() }) {
  const { state, entries: initialEntries, tickSeconds } = buildDenseQueueScenario();
  let entries = initialEntries;
  const progressedIds = new Set();
  const tickMilliseconds = [];
  let allCoordinatesFinite = true;
  let allActorsInsideWorld = true;
  let minimumEndpointSpacing = Infinity;
  let minimumSweptSpacing = Infinity;
  let minimumEndpointPair = null;
  let minimumSweptPair = null;

  for (let tick = 0; tick < ticks; tick += 1) {
    const startedAt = elapsedNow();
    const starts = entries.map(entry => ({
      ...entry,
      character: { ...entry.character, path: [...(entry.character.path || [])] },
    }));
    const moved = resolveCharacterMovementBatch(state, starts, tickSeconds, metrics);

    for (const entry of starts) {
      const endpoint = moved.get(entry.character.id);
      if (Math.hypot(endpoint.x - entry.character.x, endpoint.y - entry.character.y) >= 0.1
        || (endpoint.path?.length || 0) < (entry.character.path?.length || 0)) {
        progressedIds.add(entry.character.id);
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
        const sweptSpacing = minimumSweptDistance(
          leftStart,
          leftEnd,
          rightStart,
          rightEnd,
        );
        if (endpointSpacing < minimumEndpointSpacing) {
          minimumEndpointSpacing = endpointSpacing;
          minimumEndpointPair = { tick, leftId: leftStart.id, rightId: rightStart.id };
        }
        if (sweptSpacing < minimumSweptSpacing) {
          minimumSweptSpacing = sweptSpacing;
          minimumSweptPair = { tick, leftId: leftStart.id, rightId: rightStart.id };
        }
      }
    }

    entries = starts.map(entry => ({
      ...entry,
      character: moved.get(entry.character.id),
    }));
    tickMilliseconds.push(elapsedNow() - startedAt);
  }

  return {
    summary: summariseMovementMetrics(metrics),
    tickMilliseconds,
    progressedActors: progressedIds.size,
    allCoordinatesFinite,
    allActorsInsideWorld,
    minimumEndpointSpacing,
    minimumSweptSpacing,
    minimumEndpointPair,
    minimumSweptPair,
    actors: entries.map(entry => entry.character),
  };
}
