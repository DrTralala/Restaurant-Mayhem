import { isInsideWorld } from './pathfinding';

const ACTIONS = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

const solverPhaseKeys = [
  'solverInitialPlanningMilliseconds',
  'solverNodeBuildMilliseconds',
  'solverFrontierOrderingMilliseconds',
  'solverReplanningMilliseconds',
  'solverAgedFallbackMilliseconds',
];

function solverNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function measureSolverPhase(metrics, key, operation) {
  if (!metrics) return operation();
  const startedAt = solverNow();
  const result = operation();
  metrics[key] += solverNow() - startedAt;
  return result;
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function edgeKey(from, to, slot) {
  return `${cellKey(from)}>${cellKey(to)}@${slot}`;
}

function manhattan(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function compareKeys(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function distanceFromRoute(cell, routeCells) {
  if (routeCells.length === 0) return 0;
  return Math.min(...routeCells.map(routeCell => manhattan(cell, routeCell)));
}

function compareNodes(left, right, goalCell) {
  return manhattan(left.cell, goalCell) - manhattan(right.cell, goalCell)
    || left.waits - right.waits
    || left.routeDeviation - right.routeDeviation
    || compareKeys(cellKey(left.cell), cellKey(right.cell));
}

function buildPlan(node, onVisit = null) {
  const plan = [];
  let current = node;
  while (current.parent) {
    onVisit?.();
    plan.unshift(current.cell);
    current = current.parent;
  }
  return plan;
}

export function findSpaceTimePlan({
  state,
  startCell,
  goalCell,
  routeCells,
  blockedCells,
  horizon = 8,
  vertexReservations,
  edgeReservations,
  progressHorizon = horizon,
  metrics = null,
}) {
  if (metrics) metrics.spaceTimePlanCalls += 1;
  const startKey = cellKey(startCell);
  const scoringSlot = Math.max(1, Math.min(horizon, progressHorizon));
  const prefixScore = node => {
    if (metrics) metrics.solverExecutablePrefixScores += 1;
    const prefix = buildPlan(node, metrics
      ? () => { metrics.solverExecutablePrefixNodeVisits += 1; }
      : null).slice(0, scoringSlot);
    let previous = startCell;
    let waits = 0;
    let routeDeviation = 0;
    for (const cell of prefix) {
      if (cellKey(cell) === cellKey(previous)) waits += 1;
      routeDeviation += distanceFromRoute(cell, routeCells);
      previous = cell;
    }
    return { cell: prefix.at(-1) || startCell, waits, routeDeviation };
  };
  const compareByExecutablePrefix = (left, right) =>
    compareNodes(prefixScore(left), prefixScore(right), goalCell)
      || compareNodes(left, right, goalCell);
  let frontier = [{
    cell: { ...startCell },
    slot: 0,
    waits: 0,
    routeDeviation: 0,
    parent: null,
  }];

  for (let slot = 1; slot <= horizon; slot += 1) {
    const bestByCellAndSlot = new Map();

    for (const current of frontier) {
      if (metrics) metrics.spaceTimeExpandedStates += 1;
      const actions = cellKey(current.cell) === cellKey(goalCell) ? ACTIONS.slice(0, 1) : ACTIONS;
      const successors = actions.map(action => {
        const cell = { x: current.cell.x + action.x, y: current.cell.y + action.y };
        const waited = action.x === 0 && action.y === 0;
        return {
          cell,
          slot,
          waits: current.waits + (waited ? 1 : 0),
          routeDeviation: current.routeDeviation + distanceFromRoute(cell, routeCells),
          parent: current,
        };
      }).sort((left, right) => compareNodes(left, right, goalCell));

      for (const successor of successors) {
        const key = cellKey(successor.cell);
        if (!isInsideWorld(state, successor.cell)) continue;
        if (key !== startKey && blockedCells.has(key)) continue;
        if (vertexReservations.get(slot)?.has(key)) continue;
        if (edgeReservations.has(edgeKey(successor.cell, current.cell, slot))) continue;

        const stateKey = `${key}@${slot}`;
        const previous = bestByCellAndSlot.get(stateKey);
        if (!previous || (slot > scoringSlot
          ? compareByExecutablePrefix(successor, previous)
          : compareNodes(successor, previous, goalCell)) < 0) {
          bestByCellAndSlot.set(stateKey, successor);
        }
      }
    }

    frontier = [...bestByCellAndSlot.values()]
      .sort((left, right) => compareNodes(left, right, goalCell));
    if (frontier.length === 0) return null;
  }

  return buildPlan([...frontier].sort(compareByExecutablePrefix)[0]);
}

function compareActorsById(left, right) {
  return compareKeys(left.id, right.id);
}

function actorByAgedPriority(left, right) {
  return (right.stalledFor || 0) - (left.stalledFor || 0)
    || compareActorsById(left, right);
}

function planCellAt(actor, plan, slot) {
  if (slot === 0) return actor.startCell;
  return plan[slot - 1] || plan.at(-1) || actor.startCell;
}

function detectConflicts(actors, plans, horizon, allowControlledOverlapId) {
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < actors.length; leftIndex += 1) {
    const left = actors[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < actors.length; rightIndex += 1) {
      const right = actors[rightIndex];
      if (left.id === allowControlledOverlapId || right.id === allowControlledOverlapId) continue;
      const leftPlan = plans.get(left.id);
      const rightPlan = plans.get(right.id);
      for (let slot = 1; slot <= horizon; slot += 1) {
        const leftFrom = planCellAt(left, leftPlan, slot - 1);
        const rightFrom = planCellAt(right, rightPlan, slot - 1);
        const leftTo = planCellAt(left, leftPlan, slot);
        const rightTo = planCellAt(right, rightPlan, slot);
        if (cellKey(leftTo) === cellKey(rightTo)) {
          conflicts.push({ slot, kind: 'vertex', leftId: left.id, rightId: right.id });
        }
        if (cellKey(leftFrom) !== cellKey(leftTo)
          && cellKey(leftFrom) === cellKey(rightTo)
          && cellKey(leftTo) === cellKey(rightFrom)) {
          conflicts.push({ slot, kind: 'edge', leftId: left.id, rightId: right.id });
        }
      }
    }
  }
  return conflicts.sort((left, right) => left.slot - right.slot
    || compareKeys(left.kind, right.kind)
    || compareKeys(left.leftId, right.leftId)
    || compareKeys(left.rightId, right.rightId));
}

function serialisePriorityEdges(edges) {
  return edges
    .map(([higherId, lowerId]) => `${JSON.stringify(higherId)}>${JSON.stringify(lowerId)}`)
    .sort(compareKeys)
    .join('|');
}

function buildPriorityGraph(actors, edges) {
  const graph = new Map(actors.map(actor => [actor.id, new Set()]));
  for (const [higherId, lowerId] of edges) graph.get(higherId).add(lowerId);
  return graph;
}

function reachableIds(graph, startId) {
  const reached = new Set();
  const pending = [...graph.get(startId)].sort(compareKeys);
  while (pending.length > 0) {
    const id = pending.shift();
    if (reached.has(id)) continue;
    reached.add(id);
    pending.push(...[...graph.get(id)].sort(compareKeys));
  }
  return reached;
}

export function addPriorityEdge(actors, edges, higherId, lowerId) {
  const graph = buildPriorityGraph(actors, edges);
  if (higherId === lowerId || reachableIds(graph, lowerId).has(higherId)) return null;
  if (graph.get(higherId).has(lowerId)) return edges;
  return [...edges, [higherId, lowerId]];
}

function topologicalActorIds(actors, edges) {
  const graph = buildPriorityGraph(actors, edges);
  const indegrees = new Map(actors.map(actor => [actor.id, 0]));
  for (const lowerIds of graph.values()) {
    for (const lowerId of lowerIds) indegrees.set(lowerId, indegrees.get(lowerId) + 1);
  }
  const ready = actors.map(actor => actor.id)
    .filter(id => indegrees.get(id) === 0)
    .sort(compareKeys);
  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(id);
    for (const lowerId of [...graph.get(id)].sort(compareKeys)) {
      indegrees.set(lowerId, indegrees.get(lowerId) - 1);
      if (indegrees.get(lowerId) === 0) {
        ready.push(lowerId);
        ready.sort(compareKeys);
      }
    }
  }
  return ordered.length === actors.length ? ordered : null;
}

function priorityAncestors(actors, edges, actorId) {
  const reverseGraph = new Map(actors.map(actor => [actor.id, new Set()]));
  for (const [higherId, lowerId] of edges) reverseGraph.get(lowerId).add(higherId);
  return reachableIds(reverseGraph, actorId);
}

function reservePlan(vertexReservations, edgeReservations, actor, plan, horizon) {
  let previous = actor.startCell;
  for (let slot = 1; slot <= horizon; slot += 1) {
    const cell = planCellAt(actor, plan, slot);
    if (!vertexReservations.has(slot)) vertexReservations.set(slot, new Set());
    vertexReservations.get(slot).add(cellKey(cell));
    edgeReservations.add(edgeKey(previous, cell, slot));
    previous = cell;
  }
}

function planActor({
  state,
  actor,
  blockedCells,
  horizon,
  progressHorizon,
  higherActors,
  plans,
  ignoreReservations,
  metrics = null,
}) {
  const vertexReservations = new Map();
  const edgeReservations = new Set();
  if (!ignoreReservations) {
    for (const higherActor of higherActors) {
      reservePlan(vertexReservations, edgeReservations,
        higherActor, plans.get(higherActor.id), horizon);
    }
  }
  return findSpaceTimePlan({
    state,
    startCell: actor.startCell,
    goalCell: actor.goalCell,
    routeCells: actor.routeCells || [],
    blockedCells,
    horizon,
    vertexReservations,
    edgeReservations,
    progressHorizon,
    metrics,
  });
}

function planInitialActors({ state, actors, blockedCells, horizon, progressHorizon, metrics = null }) {
  const plans = new Map();
  for (const actor of actors) {
    const plan = planActor({
      state, actor, blockedCells, horizon, progressHorizon,
      higherActors: [], plans, ignoreReservations: false, metrics,
    });
    if (!plan) return null;
    plans.set(actor.id, plan);
  }
  return plans;
}

function replanPriorityDependants({
  state,
  actors,
  actorMap,
  blockedCells,
  horizon,
  progressHorizon,
  allowControlledOverlapId,
  edges,
  plans,
  lowerId,
  metrics = null,
}) {
  const graph = buildPriorityGraph(actors, edges);
  const affectedIds = reachableIds(graph, lowerId);
  affectedIds.add(lowerId);
  const orderedIds = topologicalActorIds(actors, edges);
  if (!orderedIds) return null;
  const replanned = new Map(plans);
  for (const id of orderedIds) {
    if (!affectedIds.has(id)) continue;
    const ancestorIds = priorityAncestors(actors, edges, id);
    const higherActors = orderedIds
      .filter(higherId => ancestorIds.has(higherId))
      .map(higherId => actorMap.get(higherId));
    const plan = planActor({
      state,
      actor: actorMap.get(id),
      blockedCells,
      horizon,
      progressHorizon,
      higherActors,
      plans: replanned,
      ignoreReservations: id === allowControlledOverlapId,
      metrics,
    });
    if (!plan) return null;
    replanned.set(id, plan);
  }
  return replanned;
}

function countWaits(actors, plans, horizon) {
  return actors.reduce((total, actor) => {
    const plan = plans.get(actor.id);
    let previous = actor.startCell;
    let waits = 0;
    for (let slot = 1; slot <= horizon; slot += 1) {
      const current = planCellAt(actor, plan, slot);
      if (cellKey(current) === cellKey(previous)) waits += 1;
      previous = current;
    }
    return total + waits;
  }, 0);
}

function totalProgress(actors, plans, horizon) {
  return actors.reduce((total, actor) => total
    + manhattan(actor.startCell, actor.goalCell)
    - manhattan(planCellAt(actor, plans.get(actor.id), horizon), actor.goalCell), 0);
}

function createHighLevelNode(
  actors,
  edges,
  plans,
  horizon,
  allowControlledOverlapId,
  branchPreference = [],
  progressHorizon = horizon,
  metrics = null,
) {
  if (metrics) metrics.solverNodesBuilt += 1;
  return measureSolverPhase(metrics, 'solverNodeBuildMilliseconds', () => {
    const conflicts = detectConflicts(actors, plans, horizon, allowControlledOverlapId);
    return {
      edges,
      plans,
      conflicts,
      waits: countWaits(actors, plans, progressHorizon),
      progress: totalProgress(actors, plans, progressHorizon),
      branchPreference,
      priorityKey: serialisePriorityEdges(edges),
    };
  });
}

function compareHighLevelNodes(left, right) {
  return left.conflicts.length - right.conflicts.length
    || left.waits - right.waits
    || right.progress - left.progress
    || compareBranchPreference(left.branchPreference, right.branchPreference)
    || compareKeys(left.priorityKey, right.priorityKey);
}

function compareBranchPreference(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function agedFallback({
  state, actors, blockedCells, horizon, progressHorizon, allowControlledOverlapId, metrics = null,
}) {
  return measureSolverPhase(metrics, 'solverAgedFallbackMilliseconds', () => {
    const orderedActors = [...actors].sort(actorByAgedPriority);
    const plans = new Map();
    const plannedActors = [];
    for (const actor of orderedActors) {
      const plan = planActor({
        state,
        actor,
        blockedCells,
        horizon,
        progressHorizon,
        higherActors: plannedActors,
        plans,
        ignoreReservations: actor.id === allowControlledOverlapId,
        metrics,
      });
      if (!plan) return null;
      plans.set(actor.id, plan);
      plannedActors.push(actor);
    }
    return { plans, mode: 'aged-fallback' };
  });
}

export function solveLocalConflictComponent({
  state,
  actors,
  blockedCells,
  horizon = 8,
  maxHighLevelNodes = 128,
  allowControlledOverlapId = null,
  progressHorizon = horizon,
  metrics = null,
}) {
  const startedAt = metrics ? solverNow() : 0;
  const phasesAtStart = metrics
    ? Object.fromEntries(solverPhaseKeys.map(key => [key, metrics[key]]))
    : null;
  const finish = result => {
    if (metrics) {
      if (!result) metrics.solverNull += 1;
      else if (result.mode === 'pbs') metrics.solverPbs += 1;
      else metrics.solverAgedFallback += 1;
      const measured = solverPhaseKeys.reduce((total, key) =>
        total + metrics[key] - phasesAtStart[key], 0);
      metrics.solverResidualMilliseconds += Math.max(0, solverNow() - startedAt - measured);
    }
    return result;
  };
  if (metrics) metrics.solverCalls += 1;
  const boundedProgressHorizon = Math.max(1, Math.min(horizon, progressHorizon));
  const stableActors = [...actors].sort(compareActorsById);
  const movingActorCount = stableActors.filter(actor => actor.moving !== false).length;
  const options = {
    state, actors: stableActors, blockedCells, horizon,
    progressHorizon: boundedProgressHorizon, allowControlledOverlapId, metrics,
  };
  if (movingActorCount > 12 || maxHighLevelNodes <= 0) return finish(agedFallback(options));

  const actorMap = new Map(stableActors.map(actor => [actor.id, actor]));
  const initialPlans = measureSolverPhase(
    metrics, 'solverInitialPlanningMilliseconds', () => planInitialActors(options),
  );
  if (!initialPlans) return finish(null);
  const frontier = [createHighLevelNode(
    stableActors, [], initialPlans, horizon, allowControlledOverlapId, [], boundedProgressHorizon,
    metrics,
  )];
  let poppedNodes = 0;

  while (frontier.length > 0 && poppedNodes < maxHighLevelNodes) {
    measureSolverPhase(metrics, 'solverFrontierOrderingMilliseconds', () => {
      frontier.sort(compareHighLevelNodes);
    });
    const node = frontier.shift();
    if (metrics) metrics.solverNodePops += 1;
    poppedNodes += 1;
    if (node.conflicts.length === 0) return finish({ plans: node.plans, mode: 'pbs' });

    const conflict = node.conflicts[0];
    const left = actorMap.get(conflict.leftId);
    const right = actorMap.get(conflict.rightId);
    const preferredHigher = actorByAgedPriority(left, right) <= 0 ? left : right;
    const other = preferredHigher === left ? right : left;
    for (const [branchIndex, [higher, lower]] of [
      [0, [preferredHigher, other]],
      [1, [other, preferredHigher]],
    ]) {
      const edges = addPriorityEdge(stableActors, node.edges, higher.id, lower.id);
      if (!edges || edges === node.edges) continue;
      const plans = measureSolverPhase(
        metrics,
        'solverReplanningMilliseconds',
        () => replanPriorityDependants({
          ...options,
          actorMap,
          edges,
          plans: node.plans,
          lowerId: lower.id,
        }),
      );
      if (!plans) continue;
      frontier.push(createHighLevelNode(
        stableActors,
        edges,
        plans,
        horizon,
        allowControlledOverlapId,
        [...node.branchPreference, branchIndex],
        boundedProgressHorizon,
        metrics,
      ));
      if (metrics) metrics.solverBranchesGenerated += 1;
    }
  }

  return finish(agedFallback(options));
}
