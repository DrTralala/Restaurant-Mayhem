import { GRID_SIZE } from '../world';
import { cellKey, cellToWorld, resolveNavigationWorkspace, worldToCell } from '../movement/navigationWorkspace';

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const comparePoints = (a, b) => a.y - b.y || a.x - b.x;

export function isLatticePoint(point) {
  return finitePoint(point) && point.x % GRID_SIZE === 0 && point.y % GRID_SIZE === 0;
}

export function latticeAnchors(point) {
  if (!finitePoint(point)) return [];
  const xs = [...new Set([Math.floor(point.x / GRID_SIZE), Math.ceil(point.x / GRID_SIZE)])];
  const ys = [...new Set([Math.floor(point.y / GRID_SIZE), Math.ceil(point.y / GRID_SIZE)])];
  return ys.flatMap(y => xs.map(x => cellToWorld({ x, y }))).sort(comparePoints);
}

export function createGrid(state, workspace = null) {
  const navigation = resolveNavigationWorkspace(state, workspace);
  const { bounds, blockedCells } = navigation;
  const isOpen = point => Boolean(finitePoint(point)
    && point.x >= bounds.left && point.x <= bounds.right
    && point.y >= bounds.top && point.y <= bounds.bottom
    && !blockedCells.has(cellKey(worldToCell(point))));

  const segmentClear = (from, to) => {
    if (!isOpen(from) || !isOpen(to)) return false;
    // Partition at every cell boundary, rather than sampling at a fixed spatial
    // interval that could miss a very short incursion near a blocked corner.
    const boundaries = [0, 1];
    for (const axis of ['x', 'y']) {
      const delta = to[axis] - from[axis];
      if (delta === 0) continue;
      const minimum = Math.min(from[axis], to[axis]);
      const maximum = Math.max(from[axis], to[axis]);
      for (let coordinate = (Math.floor(minimum / GRID_SIZE) + 1) * GRID_SIZE;
        coordinate < maximum; coordinate += GRID_SIZE) {
        boundaries.push((coordinate - from[axis]) / delta);
      }
    }
    boundaries.sort((a, b) => a - b);
    for (let index = 1; index < boundaries.length; index += 1) {
      const t = (boundaries[index - 1] + boundaries[index]) / 2;
      if (!isOpen({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })) return false;
    }
    return true;
  };

  const validCandidates = (point, candidates) => [...new Map(candidates.map(candidate => [`${candidate.x},${candidate.y}`, candidate])).values()]
    .filter(candidate => (candidate.x !== point.x || candidate.y !== point.y) && segmentClear(point, candidate)).sort(comparePoints);
  const connectors = point => !isOpen(point) || isLatticePoint(point) ? [] : validCandidates(point,
    latticeAnchors(point).flatMap(anchor => [[0, -1], [-1, 0], [1, 0], [0, 1]]
      .map(([dx, dy]) => ({ x: anchor.x + dx * GRID_SIZE, y: anchor.y + dy * GRID_SIZE }))));
  const neighbours = point => {
    if (!isOpen(point)) return [];
    const candidates = isLatticePoint(point)
      ? [[0, -1], [-1, 0], [1, 0], [0, 1]].map(([dx, dy]) => ({
        x: point.x + dx * GRID_SIZE, y: point.y + dy * GRID_SIZE,
      }))
      : latticeAnchors(point);
    return validCandidates(point, candidates);
  };

  return Object.freeze({ signature: navigation.topologyFingerprint, bounds, isOpen, segmentClear, neighbours, connectors });
}
