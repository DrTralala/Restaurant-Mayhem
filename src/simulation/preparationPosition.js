import { GRID_SIZE } from './world';
import {
  cellToWorld,
  findAdjacentOpenCells,
  findPath,
  worldToCell,
} from './pathfinding';

const PREPARATION_STATION_WIDTH = 40;
const PREPARATION_STATION_HEIGHT = 40;
const DESTINATION_SEPARATION = 16;

// The movement coordinator certifies arrival within two world units. Work
// positions deliberately use the same small tolerance rather than an entire
// open cell.
export const PREPARATION_ARRIVAL_TOLERANCE = 2;

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function stationRect(station) {
  return {
    x: station?.x,
    y: station?.y,
    w: Number.isFinite(station?.w) ? station.w : PREPARATION_STATION_WIDTH,
    h: Number.isFinite(station?.h) ? station.h : PREPARATION_STATION_HEIGHT,
  };
}

function cellCentre(cell) {
  const point = cellToWorld(cell);
  return { x: point.x + GRID_SIZE / 2, y: point.y + GRID_SIZE / 2 };
}

function adjacentCells(rect) {
  const left = worldToCell({ x: rect.x - GRID_SIZE, y: rect.y });
  const right = worldToCell({ x: rect.x + rect.w, y: rect.y });
  const top = worldToCell({ x: rect.x, y: rect.y - GRID_SIZE });
  const bottom = worldToCell({ x: rect.x, y: rect.y + rect.h });
  const candidates = [];
  for (let y = top.y; y <= bottom.y; y += 1) {
    candidates.push({ x: left.x, y });
    candidates.push({ x: right.x, y });
  }
  for (let x = left.x + 1; x < right.x; x += 1) {
    candidates.push({ x, y: top.y });
    candidates.push({ x, y: bottom.y });
  }
  return candidates;
}

function isSideCell(rect, cell) {
  const left = worldToCell({ x: rect.x - GRID_SIZE, y: rect.y });
  const right = worldToCell({ x: rect.x + rect.w, y: rect.y });
  const top = worldToCell({ x: rect.x, y: rect.y - GRID_SIZE });
  const bottom = worldToCell({ x: rect.x, y: rect.y + rect.h });
  const onLeft = cell.x === left.x && cell.y > top.y && cell.y < bottom.y;
  const onRight = cell.x === right.x && cell.y > top.y && cell.y < bottom.y;
  const onTop = cell.y === top.y && cell.x > left.x && cell.x < right.x;
  const onBottom = cell.y === bottom.y && cell.x > left.x && cell.x < right.x;
  return onLeft || onRight || onTop || onBottom;
}

function preparationGoals(station) {
  const rect = stationRect(station);
  if (!finitePoint(rect)) return [];
  return adjacentCells(rect)
    .filter(cell => isSideCell(rect, cell))
    .map(cellCentre);
}

export function isAtPreparationPosition(worker, station) {
  if (!finitePoint(worker) || !finitePoint(station)) return false;
  return preparationGoals(station).some(goal => Math.hypot(
    worker.x - goal.x,
    worker.y - goal.y,
  ) <= PREPARATION_ARRIVAL_TOLERANCE);
}

function isDestinationAvailable(state, point, worker) {
  return (state?.staff || []).every(candidate => {
    if (sameId(candidate?.id, worker?.id)
      || (!candidate?.task && !candidate?.navigationGoal)) return true;
    const destination = candidate.navigationGoal || candidate;
    return !finitePoint(destination)
      || Math.hypot(point.x - destination.x, point.y - destination.y)
        >= DESTINATION_SEPARATION;
  });
}

function pathDistance(worker, goal, route, start, target) {
  if (target.x === start.x && target.y === start.y) {
    return Math.hypot(worker.x - goal.x, worker.y - goal.y);
  }
  return route.length * GRID_SIZE;
}

/**
 * Find a reachable, unclaimed side-only preparation position for a worker.
 * Kitchen stations are blocked rectangles, so the returned goal is the centre
 * of an open adjacent cell rather than that cell's top-left lattice anchor.
 */
export function findPreparationTarget(state, station, worker) {
  if (!finitePoint(station) || !finitePoint(worker)) return null;
  const rect = stationRect(station);
  const start = worldToCell(worker);
  const candidates = findAdjacentOpenCells(state, rect, start)
    .filter(candidate => isSideCell(rect, candidate));

  for (const target of candidates) {
    const goal = cellCentre(target);
    if (!isDestinationAvailable(state, goal, worker)) continue;
    const route = findPath(state, start, target);
    const isSameCell = target.x === start.x && target.y === start.y;
    if (route.length === 0 && !isSameCell) continue;
    return {
      goal,
      distance: pathDistance(worker, goal, route, start, target),
    };
  }
  return null;
}
