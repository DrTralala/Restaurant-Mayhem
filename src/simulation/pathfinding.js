import { GRID_SIZE } from './world';
import {
  buildBlockedCells,
  cellKey,
  cellToWorld,
  isInsideWorld,
  worldToCell,
} from './movement/navigationWorkspace';
import { resolveNavigationWorkspace } from './movement/navigationWorkspace';
import { createGrid } from './navigation/grid';
import { findRoute } from './navigation/router';
import { noteNavigation } from './navigation/telemetry';

export {
  buildBlockedCells,
  cellKey,
  cellToWorld,
  isInsideWorld,
  worldToCell,
} from './movement/navigationWorkspace';

function isOpen(state, blocked, cell) {
  return isInsideWorld(state, cell) && !blocked.has(cellKey(cell));
}

// Door arrays survive ordinary ticks but are replaced by fresh/hydrated games.
// Weak ownership releases old games; each owner retains only one topology and
// a bounded set of routes. No state, graph or actor-specific authority is cached.
const routeCaches = new WeakMap();
const MAX_CACHED_ROUTES = 128;

export function findPath(state, startCell, goalCell, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => key !== 'workspace' && key !== 'metrics')) {
    throw new Error('findPath accepts only static path options: workspace and metrics');
  }
  noteNavigation('pathRequests');
  const workspace = resolveNavigationWorkspace(state, options.workspace || null, options.metrics || null);
  const owner = Array.isArray(state.doors) ? state.doors : state;
  let cache = routeCaches.get(owner);
  if (!cache || cache.topology !== workspace.topologyFingerprint) {
    cache = { topology: workspace.topologyFingerprint, routes: new Map() };
    routeCaches.set(owner, cache);
  }
  const key = `${cellKey(startCell)}->${cellKey(goalCell)}`;
  if (cache.routes.has(key)) {
    noteNavigation('pathCacheHits');
    const route = cache.routes.get(key);
    cache.routes.delete(key);
    cache.routes.set(key, route);
    return route.map(cell => ({ ...cell }));
  }
  noteNavigation('pathCacheMisses');
  const result = findRoute(createGrid(state, workspace), cellToWorld(startCell), cellToWorld(goalCell));
  const route = result.status === 'found' ? result.points.map(worldToCell) : [];
  cache.routes.set(key, route);
  if (cache.routes.size > MAX_CACHED_ROUTES) cache.routes.delete(cache.routes.keys().next().value);
  return route.map(cell => ({ ...cell }));
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
