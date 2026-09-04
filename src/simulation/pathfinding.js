import { GRID_SIZE } from './world';
import {
  buildBlockedCells,
  buildOccupiedCharacterCells,
  cellKey,
  cellToWorld,
  isInsideWorld,
  worldToCell,
} from './movement/navigationWorkspace';
import { resolveNavigationWorkspace } from './movement/navigationWorkspace';

export {
  buildBlockedCells,
  buildOccupiedCharacterCells,
  cellKey,
  cellToWorld,
  isInsideWorld,
  worldToCell,
} from './movement/navigationWorkspace';

function isOpen(state, blocked, cell) {
  return isInsideWorld(state, cell) && !blocked.has(cellKey(cell));
}

export function findPath(state, start, goal, {
  occupiedCells = null,
  allowOccupiedGoal = false,
  workspace = null,
  metrics = null,
} = {}) {
  const navigation = resolveNavigationWorkspace(state, workspace, metrics);
  const blocked = navigation.blockedCells;
  const queue = [start];
  const cameFrom = new Map([[cellKey(start), null]]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (queue.length) {
    const current = queue.shift();
    if (cellKey(current) === cellKey(goal)) break;
    for (const [dx, dy] of dirs) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = cellKey(next);
      const occupied = occupiedCells?.has(key) && !(allowOccupiedGoal && key === cellKey(goal));
      if (cameFrom.has(key) || !isOpen(state, blocked, next) || occupied) continue;
      cameFrom.set(key, current);
      queue.push(next);
    }
  }

  if (!cameFrom.has(cellKey(goal))) return [];
  const path = [];
  let current = goal;
  while (current) {
    path.unshift(current);
    current = cameFrom.get(cellKey(current));
  }
  return path.slice(1);
}

export function findPathWithDynamicFallback(state, start, goal, {
  occupiedCells = null,
  workspace = null,
  metrics = null,
} = {}) {
  const path = findPath(state, start, goal, {
    occupiedCells, allowOccupiedGoal: true, workspace, metrics,
  });
  if (path.length) return { path, usedStaticFallback: false };
  const staticPath = findPath(state, start, goal, { workspace, metrics });
  return { path: staticPath, usedStaticFallback: staticPath.length > 0 };
}

export function findAdjacentOpenCells(state, rect, fromCell = null, { workspace = null, metrics = null } = {}) {
  const navigation = resolveNavigationWorkspace(state, workspace, metrics);
  const blocked = navigation.blockedCells;
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
  const open = candidates.filter(cell => isOpen(state, blocked, cell));
  if (!fromCell) return open;
  return open.sort((a, b) => Math.abs(a.x - fromCell.x) + Math.abs(a.y - fromCell.y) - (Math.abs(b.x - fromCell.x) + Math.abs(b.y - fromCell.y)));
}

export function findAdjacentOpenCell(state, rect, fromCell = null, { workspace = null, metrics = null } = {}) {
  const candidates = findAdjacentOpenCells(state, rect, fromCell, { workspace, metrics });
  if (!fromCell) return candidates[0] || null;
  return candidates.find(candidate => findPath(state, fromCell, candidate, { workspace, metrics }).length > 0) || null;
}
