import { isInsideWorld } from '../pathfinding';
import {
  getExecutablePrefixProfile,
  getMovementResourceStrategy,
} from '../movementMetrics';
import {
  isCellInsideWorkspace,
  isNavigationWorkspaceForState,
} from '../movement/navigationWorkspace';

const ACTIONS = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

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

function createPlannerResources(metrics) {
  const strategy = getMovementResourceStrategy(metrics);
  const cells = new Map();
  const routeDistances = new Map();
  return {
    cell(x, y) {
      if (strategy === 'baseline') {
        if (metrics) metrics.plannerCellDescriptorsCreated += 1;
        return { x, y };
      }
      const key = `${x},${y}`;
      if (!cells.has(key)) {
        cells.set(key, Object.freeze({ x, y }));
        if (metrics) metrics.plannerCellDescriptorsCreated += 1;
      }
      return cells.get(key);
    },
    routeDistance(cell, routeCells) {
      const key = `${cell.x},${cell.y}`;
      if (strategy === 'optimised' && routeDistances.has(key)) {
        if (metrics) metrics.routeDistanceCacheHits += 1;
        return routeDistances.get(key);
      }
      if (metrics) metrics.routeDistanceCalculations += 1;
      const distance = routeCells.length === 0
        ? 0
        : Math.min(...routeCells.map(routeCell => manhattan(cell, routeCell)));
      if (strategy === 'optimised') routeDistances.set(key, distance);
      return distance;
    },
    strategy,
  };
}

// Exported only as test-support API; production calls the resource-aware variant.
export function advanceExecutablePrefixScore(parentScore, successor, scoringSlot, routeDistance) {
  if (successor.slot <= scoringSlot) {
    return {
      cell: { ...successor.cell },
      waits: parentScore.waits + (successor.waited ? 1 : 0),
      routeDeviation: parentScore.routeDeviation + routeDistance,
    };
  }
  return {
    cell: { ...parentScore.cell },
    waits: parentScore.waits,
    routeDeviation: parentScore.routeDeviation,
  };
}

function advanceExecutablePrefixScoreWithResources(
  parentScore, successor, scoringSlot, routeDistance, resources,
) {
  if (successor.slot <= scoringSlot) {
    return {
      cell: resources.cell(successor.cell.x, successor.cell.y),
      waits: parentScore.waits + (successor.waited ? 1 : 0),
      routeDeviation: parentScore.routeDeviation + routeDistance,
    };
  }
  return {
    cell: resources.cell(parentScore.cell.x, parentScore.cell.y),
    waits: parentScore.waits,
    routeDeviation: parentScore.routeDeviation,
  };
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
  navigationWorkspace = null,
}) {
  const resources = createPlannerResources(metrics);
  let legacyExecutablePrefixScoring = false;
  let countExecutablePrefixWork = true;
  if (metrics) {
    metrics.spaceTimePlanCalls += 1;
    const profile = getExecutablePrefixProfile(metrics);
    legacyExecutablePrefixScoring = profile?.mode === 'legacy';
    countExecutablePrefixWork = profile?.countWork !== false;
  }
  const startKey = cellKey(startCell);
  const scoringSlot = Math.max(1, Math.min(horizon, progressHorizon));
  const prefixScore = node => {
    if (metrics && countExecutablePrefixWork) metrics.solverExecutablePrefixScores += 1;
    if (legacyExecutablePrefixScoring) {
      const prefix = buildPlan(node, countExecutablePrefixWork
        ? () => { metrics.solverExecutablePrefixNodeVisits += 1; }
        : null).slice(0, scoringSlot);
      let previous = startCell;
      let waits = 0;
      let routeDeviation = 0;
      for (const cell of prefix) {
        if (cellKey(cell) === cellKey(previous)) waits += 1;
        routeDeviation += resources.routeDistance(cell, routeCells);
        previous = cell;
      }
      return { cell: prefix.at(-1) || startCell, waits, routeDeviation };
    }
    return {
      cell: node.executableCell,
      waits: node.executableWaits,
      routeDeviation: node.executableRouteDeviation,
    };
  };
  const compareByExecutablePrefix = (left, right) =>
    compareNodes(prefixScore(left), prefixScore(right), goalCell)
      || compareNodes(left, right, goalCell);
  const startNode = {
    cell: resources.cell(startCell.x, startCell.y),
    slot: 0,
    waits: 0,
    routeDeviation: 0,
    parent: null,
  };
  if (!legacyExecutablePrefixScoring) {
    startNode.executableCell = resources.cell(startCell.x, startCell.y);
    startNode.executableWaits = 0;
    startNode.executableRouteDeviation = 0;
  }
  let frontier = [startNode];
  if (metrics) metrics.peakPlannerFrontier = Math.max(metrics.peakPlannerFrontier, frontier.length);
  const insideWorld = isNavigationWorkspaceForState(navigationWorkspace, state)
    ? cell => isCellInsideWorkspace(navigationWorkspace, cell)
    : cell => isInsideWorld(state, cell);

  for (let slot = 1; slot <= horizon; slot += 1) {
    const bestByCellAndSlot = new Map();

    for (const current of frontier) {
      if (metrics) metrics.spaceTimeExpandedStates += 1;
      const actions = cellKey(current.cell) === cellKey(goalCell) ? ACTIONS.slice(0, 1) : ACTIONS;
      const successors = actions.map(action => {
        const cell = resources.cell(current.cell.x + action.x, current.cell.y + action.y);
        const waited = action.x === 0 && action.y === 0;
        const routeDistance = resources.routeDistance(cell, routeCells);
        const successor = {
          cell,
          slot,
          waits: current.waits + (waited ? 1 : 0),
          routeDeviation: current.routeDeviation + routeDistance,
          parent: current,
        };
        if (!legacyExecutablePrefixScoring) {
          const executableScore = advanceExecutablePrefixScoreWithResources({
            cell: current.executableCell,
            waits: current.executableWaits,
            routeDeviation: current.executableRouteDeviation,
          }, { cell, slot, waited }, scoringSlot, routeDistance, resources);
          successor.executableCell = executableScore.cell;
          successor.executableWaits = executableScore.waits;
          successor.executableRouteDeviation = executableScore.routeDeviation;
        }
        if (metrics) metrics.spaceTimeSuccessorNodesCreated += 1;
        return successor;
      }).sort((left, right) => compareNodes(left, right, goalCell));

      for (const successor of successors) {
        const key = cellKey(successor.cell);
        if (!insideWorld(successor.cell)) continue;
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
    if (metrics) metrics.peakPlannerFrontier = Math.max(metrics.peakPlannerFrontier, frontier.length);
    if (frontier.length === 0) return null;
  }

  return buildPlan([...frontier].sort(compareByExecutablePrefix)[0])
    .map(cell => ({ x: cell.x, y: cell.y }));
}
