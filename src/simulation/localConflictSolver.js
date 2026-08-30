import { isInsideWorld } from './pathfinding';

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

function buildPlan(node) {
  const plan = [];
  let current = node;
  while (current.parent) {
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
}) {
  const startKey = cellKey(startCell);
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
        if (!previous || compareNodes(successor, previous, goalCell) < 0) {
          bestByCellAndSlot.set(stateKey, successor);
        }
      }
    }

    frontier = [...bestByCellAndSlot.values()]
      .sort((left, right) => compareNodes(left, right, goalCell));
    if (frontier.length === 0) return null;
  }

  return buildPlan(frontier[0]);
}
