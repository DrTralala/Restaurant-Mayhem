import { cellKey, worldToCell } from '../movement/navigationWorkspace';
import { isLatticePoint, latticeAnchors } from './grid';
import { noteNavigation } from './telemetry';

const keyOf = point => `${point.x},${point.y}`;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const compare = (a, b) => a.f - b.f || a.h - b.h || a.point.y - b.point.y || a.point.x - b.point.x;

function push(heap, node) {
  let index = heap.length;
  heap.push(node);
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (compare(heap[parent], node) <= 0) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = node;
}

function pop(heap) {
  const result = heap[0];
  const last = heap.pop();
  if (!heap.length) return result;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child += 1;
    if (compare(last, heap[child]) <= 0) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return result;
}

export function findRoute(grid, start, goal, { maxExpansions = Infinity, blocked = new Set() } = {}) {
  return advanceRouteSearch(beginRouteSearch(grid, start, goal, { blocked }), maxExpansions);
}

export function beginRouteSearch(grid, start, goal, { blocked = new Set(), allowBlockedStart = false, allowBlockedGoal = false } = {}) {
  noteNavigation('routeStarts');
  const cursor = { grid, goal: goal ? { ...goal } : null, blocked: new Set(blocked), allowBlockedGoal,
    frontier: [], costs: new Map(), result: null, goalAnchors: new Set() };
  if (!grid.isOpen(start) || !grid.isOpen(goal)
    || (!allowBlockedStart && blocked.has(cellKey(worldToCell(start))))
    || (!allowBlockedGoal && blocked.has(cellKey(worldToCell(goal))))) {
    cursor.result = { status: 'unreachable', points: [] };
    return cursor;
  }
  const startKey = keyOf(start);
  if (startKey === keyOf(goal)) {
    cursor.result = { status: 'found', points: [] };
    return cursor;
  }
  cursor.goalAnchors = new Set(latticeAnchors(goal).map(keyOf));
  cursor.costs.set(startKey, 0);
  push(cursor.frontier, { point: { ...start }, g: 0, h: distance(start, goal), f: distance(start, goal), parent: null });
  return cursor;
}

export function forkRouteSearch(cursor) {
  return { ...cursor, frontier: cursor.frontier.slice(), costs: new Map(cursor.costs) };
}

export function advanceRouteSearch(cursor, maxExpansions) {
  let expansions = 0;
  const result = (status, points = []) => {
    noteNavigation('routeAdvances');
    noteNavigation('routeExpansions', expansions);
    return { status, points, expansions };
  };
  if (cursor.result) return result(cursor.result.status, cursor.result.points.map(point => ({ ...point })));
  const { grid, goal, blocked, goalAnchors, frontier, costs } = cursor;
  const goalKey = keyOf(goal);
  const budget = maxExpansions === Infinity ? Infinity : Math.max(0, Math.floor(Number(maxExpansions) || 0));
  while (frontier.length) {
    if (expansions >= budget) return result('pending');
    const current = pop(frontier);
    const currentKey = keyOf(current.point);
    if (current.g !== costs.get(currentKey)) continue;
    if (currentKey === goalKey) {
      const points = [];
      for (let node = current; node.parent; node = node.parent) points.push({ ...node.point });
      cursor.result = { status: 'found', points: points.reverse() };
      return result('found', cursor.result.points.map(point => ({ ...point })));
    }
    expansions += 1;
    const candidates = grid.neighbours(current.point);
    const sameCell = cellKey(worldToCell(current.point)) === cellKey(worldToCell(goal));
    if ((!isLatticePoint(goal) && (goalAnchors.has(currentKey) || sameCell))
      && grid.segmentClear(current.point, goal)) candidates.push(goal);
    if (!isLatticePoint(current.point) && !candidates.some(point => !blocked.has(cellKey(worldToCell(point))))) {
      candidates.push(...(grid.connectors?.(current.point) || []));
    }
    for (const point of candidates) {
      if (blocked.has(cellKey(worldToCell(point))) && !(cursor.allowBlockedGoal && keyOf(point) === goalKey)) continue;
      const g = current.g + distance(current.point, point);
      const key = keyOf(point);
      if (g >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, g);
      const h = distance(point, goal);
      push(frontier, { point, g, h, f: g + h, parent: current });
    }
  }
  cursor.result = { status: 'unreachable', points: [] };
  return result('unreachable');
}
