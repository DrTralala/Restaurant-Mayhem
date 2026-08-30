import { GRID_SIZE, getDoors, getRestaurantWorld } from './world';

export function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

export function worldToCell(point) {
  return { x: Math.floor(point.x / GRID_SIZE), y: Math.floor(point.y / GRID_SIZE) };
}

export function cellToWorld(cell) {
  return { x: cell.x * GRID_SIZE, y: cell.y * GRID_SIZE };
}

function blockRect(blocked, rect) {
  const start = worldToCell({ x: rect.x, y: rect.y });
  const end = worldToCell({ x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 });
  for (let y = start.y; y <= end.y; y += 1) {
    for (let x = start.x; x <= end.x; x += 1) blocked.add(cellKey({ x, y }));
  }
}

export function buildBlockedCells(state) {
  const blocked = new Set();
  for (const table of state.tables || []) blockRect(blocked, { x: table.x, y: table.y, w: 40, h: 40 });
  for (const chair of state.chairs || []) blockRect(blocked, { x: chair.x, y: chair.y, w: 20, h: 20 });
  for (const station of state.kitchenStations || []) blockRect(blocked, { x: station.x, y: station.y, w: 40, h: 40 });
  for (const service of state.serviceTables || []) blockRect(blocked, { x: service.x, y: service.y, w: 120, h: 40 });
  for (const cashier of state.cashierStations || []) blockRect(blocked, cashier);
  for (const station of state.washStations || []) blockRect(blocked, { x: station.x, y: station.y, w: station.w || 40, h: station.h || 40 });
  const world = getRestaurantWorld(state.restaurant || {});
  blockRect(blocked, { x: world.doorX, y: world.kitchenY, w: 6, h: world.floorH });
  const wallCellX = worldToCell({ x: world.doorX, y: 0 }).x;
  for (const door of getDoors(state)) {
    const firstDoorCell = worldToCell({ x: world.doorX, y: door.y }).y;
    const lastDoorCell = worldToCell({ x: world.doorX, y: door.y + 39 }).y;
    for (let y = firstDoorCell; y <= lastDoorCell; y += 1) blocked.delete(cellKey({ x: wallCellX, y }));
  }
  return blocked;
}

export function buildOccupiedCharacterCells(characters, excludedIds = []) {
  const excluded = new Set(excludedIds);
  return new Set((characters || [])
    .filter(character => !excluded.has(character.id) && Number.isFinite(character.x) && Number.isFinite(character.y))
    .map(character => cellKey(worldToCell(character))));
}

export function isInsideWorld(state, cell) {
  const world = getRestaurantWorld(state.restaurant || {});
  const point = cellToWorld(cell);
  return point.x >= world.floorX && point.x <= world.queueX + world.queueW && point.y >= world.kitchenY && point.y <= world.diningY + world.areaH + 50;
}

function isOpen(state, blocked, cell) {
  return isInsideWorld(state, cell) && !blocked.has(cellKey(cell));
}

export function findPath(state, start, goal, { occupiedCells = null, allowOccupiedGoal = false } = {}) {
  const blocked = buildBlockedCells(state);
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

export function findPathWithDynamicFallback(state, start, goal, { occupiedCells = null } = {}) {
  const path = findPath(state, start, goal, { occupiedCells, allowOccupiedGoal: true });
  if (path.length) return { path, usedStaticFallback: false };
  const staticPath = findPath(state, start, goal);
  return { path: staticPath, usedStaticFallback: staticPath.length > 0 };
}

export function findAdjacentOpenCells(state, rect, fromCell = null) {
  const blocked = buildBlockedCells(state);
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

export function findAdjacentOpenCell(state, rect, fromCell = null) {
  const candidates = findAdjacentOpenCells(state, rect, fromCell);
  if (!fromCell) return candidates[0] || null;
  return candidates.find(candidate => findPath(state, fromCell, candidate).length > 0) || null;
}
