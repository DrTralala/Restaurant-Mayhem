import { findPath, findPathWithDynamicFallback } from '../pathfinding';
import {
  buildOccupiedCharacterCells,
  cellToWorld,
  isSafeSegment,
  resolveNavigationWorkspace,
  worldToCell,
} from './navigationWorkspace';
import { getDefaultStaffPosition } from '../world';

const ROLE_SPEED = { waiter: 75, cook: 55 };

export function clearMovementRecoveryMetadata(character) {
  const cleared = { ...character, stalledFor: 0 };
  delete cleared.pathGoal;
  delete cleared.usingStaticFallback;
  delete cleared.minimumSpacing;
  delete cleared.localConflictTarget;
  delete cleared.headOnRecovery;
  delete cleared.recoveredHeadOnDetourTarget;
  return cleared;
}

export function ensureStaffRuntime(staff, state) {
  return (staff || []).map((s, index) => {
    const hasCoord = Number.isFinite(s.x) && Number.isFinite(s.y);
    const pos = hasCoord ? { x: s.x, y: s.y } : getDefaultStaffPosition(s.role, index, state, s.id);
    return { ...s, x: pos.x, y: pos.y, path: s.path || [], task: s.task || null };
  });
}

export function moveStaffAlongPath(staff, dt, others = []) {
  return moveCharacterAlongPath(staff, dt, others, ROLE_SPEED[staff.role] || 60);
}

export function moveCharacterAlongPath(character, dt, others = [], speed = 60, minimumSpacing = 16, state = null, navigation = {}) {
  if (!character.path || character.path.length === 0) return character;
  const target = cellToWorld(character.path[0]);
  if (!isSafeSegment(state, character, target, navigation)) return character;
  const distance = Math.hypot(target.x - character.x, target.y - character.y);
  const budget = Math.max(0, speed * dt);
  if (distance <= 1 && distance <= budget + 1e-6) {
    return { ...character, x: target.x, y: target.y, path: character.path.slice(1) };
  }
  if (distance <= budget + 1e-6) {
    const moved = moveCharacterTowards(character, target, dt, others, speed, minimumSpacing, state, navigation);
    return moved.x === target.x && moved.y === target.y
      ? { ...moved, path: character.path.slice(1) }
      : moved;
  }
  const moved = moveCharacterTowards(character, target, dt, others, speed, minimumSpacing, state, navigation);
  if (moved === character) return character;
  if (Math.hypot(target.x - moved.x, target.y - moved.y) <= 0.001) {
    return { ...moved, path: character.path.slice(1) };
  }
  return moved;
}

export function planCharacterPath(state, character, goal, others = [], ignoredIds = [], navigation = {}) {
  const goalCell = goal?.cell ? goal.cell : worldToCell(goal?.world || goal);
  const occupiedCells = buildOccupiedCharacterCells(others, [character.id, ...ignoredIds]);
  const { workspace = null, metrics = null } = navigation;
  const result = findPathWithDynamicFallback(state, worldToCell(character), goalCell, {
    occupiedCells, workspace, metrics,
  });
  // recovery metadata is attached at planning time so stalled movement can revisit the same goal
  return {
    ...character,
    path: result.path,
    pathGoal: goalCell,
    usingStaticFallback: result.usedStaticFallback,
    stalledFor: 0,
    minimumSpacing: 16,
  };
}

function constrainCrossingMovement(state, character, moved, peer, minimumSpacing, budget, navigation) {
  const dx = moved.x - character.x;
  const dy = moved.y - character.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return character;
  const { workspace = null, metrics = null } = navigation;
  const blocked = resolveNavigationWorkspace(state, workspace, metrics).blockedCells;
  const epsilon = 1e-6;
  const start = { x: character.x, y: character.y };
  const ordinaryEndpoint = { x: moved.x, y: moved.y };
  const direction = { x: ordinaryEndpoint.x - start.x, y: ordinaryEndpoint.y - start.y };
  const directionLength = Math.hypot(direction.x, direction.y);
  const startProjection = (start.x - peer.x) * direction.x + (start.y - peer.y) * direction.y;
  const legal = candidate => {
    if (Math.hypot(candidate.x - character.x, candidate.y - character.y) > budget + epsilon) return false;
    const cell = worldToCell(candidate);
    const candidateProjection = (candidate.x - peer.x) * direction.x + (candidate.y - peer.y) * direction.y;
    const sameSide = String(character.id) <= String(peer.id)
      || Math.abs(startProjection) <= epsilon || Math.abs(candidateProjection) <= epsilon
      || startProjection * candidateProjection >= -epsilon;
    return sameSide && isSafeSegment(state, character, candidate, navigation) && !blocked.has(`${cell.x},${cell.y}`)
      && Math.hypot(candidate.x - peer.x, candidate.y - peer.y) >= minimumSpacing - epsilon;
  };
  const breakpoints = [0, 1];
  const fromPeer = { x: start.x - peer.x, y: start.y - peer.y };
  const a = dx * dx + dy * dy;
  const b = 2 * (fromPeer.x * dx + fromPeer.y * dy);
  const c = fromPeer.x * fromPeer.x + fromPeer.y * fromPeer.y - minimumSpacing ** 2;
  const discriminant = b * b - 4 * a * c;
  if (a > 0 && discriminant >= 0) {
    breakpoints.push((-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a));
  }
  for (const coordinate of ['x', 'y']) {
    const delta = ordinaryEndpoint[coordinate] - start[coordinate];
    if (Math.abs(delta) > epsilon) {
      const first = Math.floor(start[coordinate] / 20) + (delta > 0 ? 1 : 0);
      const last = Math.floor(ordinaryEndpoint[coordinate] / 20) + (delta > 0 ? 0 : 1);
      for (let boundary = first; delta > 0 ? boundary <= last : boundary >= last; boundary += delta > 0 ? 1 : -1) {
        breakpoints.push((boundary * 20 - start[coordinate]) / delta);
      }
    }
  }
  const points = [...new Set(breakpoints.filter(point => point >= 0 && point <= 1))].sort((left, right) => right - left);
  for (const point of points) {
    for (const candidateT of [point, point - epsilon, point + epsilon]) {
      if (candidateT < 0 || candidateT > 1) continue;
      const candidate = { x: start.x + dx * candidateT, y: start.y + dy * candidateT };
      if (legal(candidate)) return { ...moved, x: candidate.x, y: candidate.y };
    }
  }
  return character;
}

export function moveCharacterWithRecovery(state, character, dt, others = [], speed = 60, ignoredIds = [], navigation = {}) {
  if (!character.path?.length) {
    return { ...character, stalledFor: 0, minimumSpacing: 16, usingStaticFallback: false, pathGoal: undefined };
  }
  const before = { x: character.x, y: character.y };
  const pathGoal = character.pathGoal || character.path.at(-1);
  const beforeLength = character.path.length;
  const spacing = character.usingStaticFallback || (character.stalledFor || 0) >= 2 ? 6 : 16;
  const ignored = new Set(ignoredIds);
  const target = cellToWorld(character.path[0]);
  const direction = { x: target.x - character.x, y: target.y - character.y };
  const directionLength = Math.hypot(direction.x, direction.y) || 1;
  const projectedOncoming = others.filter(other => other?.id !== character.id && !ignored.has(other.id)
    && Number.isFinite(other.x) && Number.isFinite(other.y) && other.path?.length
    && Math.hypot(other.x - character.x, other.y - character.y) < 40
    && ((other.x - character.x) * direction.x + (other.y - character.y) * direction.y) > 0
    && ((cellToWorld(other.path[0]).x - other.x) * direction.x
      + (cellToWorld(other.path[0]).y - other.y) * direction.y) < 0
    && Math.abs((other.x - character.x) * direction.y - (other.y - character.y) * direction.x) / directionLength < spacing);
  const lowerOncoming = projectedOncoming.find(other => String(other.id) < String(character.id));
  const higherOncoming = projectedOncoming.find(other => String(other.id) > String(character.id));
  const collisionOthers = others.filter(other => !ignored.has(other?.id));
  const crossingPeer = (character.stalledFor || 0) >= 2 && spacing === 6
    && projectedOncoming.find(other => Math.hypot(other.x - character.x, other.y - character.y) <= 16 + 1e-6);
  const movementOthers = crossingPeer
    ? collisionOthers.filter(other => other.id !== crossingPeer.id)
    : collisionOthers;
  const movementSpacing = spacing === 16 && higherOncoming ? 6 : spacing;
  // Keep this ordinary move deliberately state-free; the explicit static check below
  // preserves recovery's existing sequencing.
  const ordinaryMoved = moveCharacterAlongPath(character, dt, movementOthers, speed, movementSpacing);
  let moved = lowerOncoming && spacing === 16 ? character : ordinaryMoved;
  if (!crossingPeer && !isSafeSegment(state, character, ordinaryMoved, navigation)) moved = character;
  if (lowerOncoming && spacing === 6
    && (moved === character || Math.hypot(moved.x - character.x, moved.y - character.y) < speed * dt - 1e-6)) {
    const retreatLength = Math.min(speed * dt, directionLength);
    const retreat = {
      x: character.x - direction.x * retreatLength,
      y: character.y - direction.y * retreatLength,
    };
    const { workspace = null, metrics = null } = navigation;
    const blocked = resolveNavigationWorkspace(state, workspace, metrics).blockedCells;
    const cell = worldToCell(retreat);
    if (!blocked.has(`${cell.x},${cell.y}`)
      && Math.hypot(retreat.x - lowerOncoming.x, retreat.y - lowerOncoming.y) >= spacing - 1e-6) {
      moved = { ...character, ...retreat };
    }
  }
  if (crossingPeer) {
    const controlledSpacing = String(character.id) < String(crossingPeer.id) ? 2 : 6;
    moved = constrainCrossingMovement(state, character, ordinaryMoved, crossingPeer, controlledSpacing, speed * dt, navigation);
    if (moved !== character) {
      moved.path = Math.hypot(target.x - moved.x, target.y - moved.y) <= 0.001
        ? character.path.slice(1)
        : character.path;
    }
  }
  if (!isSafeSegment(state, character, moved, navigation)) moved = character;
  const progress = Math.hypot(moved.x - before.x, moved.y - before.y) >= 0.1 || moved.path.length < beforeLength;
  const stalledFor = (character.stalledFor || 0) + dt;
  if (progress) {
    return { ...moved, stalledFor: 0, minimumSpacing: 16, usingStaticFallback: false };
  }
  let recovered = { ...moved, stalledFor, minimumSpacing: spacing };
  if (stalledFor >= 0.75 && pathGoal) {
    const replanned = planCharacterPath(state, recovered, { cell: pathGoal }, others, ignoredIds, navigation);
    recovered = { ...replanned, stalledFor };
  }
  if (stalledFor >= 2 && pathGoal) {
    const staticPath = findPath(state, worldToCell(recovered), pathGoal, navigation);
    recovered = { ...recovered, path: staticPath, usingStaticFallback: true, minimumSpacing: 6 };
  }
  return recovered;
}

export function moveCharacterTowards(character, target, dt, others = [], speed = 60, minimumSpacing = 16, state = null, navigation = {}) {
  const dx = target.x - character.x;
  const dy = target.y - character.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return character;
  const direction = { x: dx / distance, y: dy / distance };
  let step = Math.min(speed * dt, distance);

  for (const other of others) {
    if (!other || other.id === character.id || !Number.isFinite(other.x) || !Number.isFinite(other.y)) continue;
    const relative = { x: other.x - character.x, y: other.y - character.y };
    const along = relative.x * direction.x + relative.y * direction.y;
    if (along <= 0 || along > step + minimumSpacing) continue;
    const perpendicularSquared = Math.max(0, relative.x ** 2 + relative.y ** 2 - along ** 2);
    if (perpendicularSquared >= minimumSpacing ** 2) continue;
    const safeStep = along - Math.sqrt(minimumSpacing ** 2 - perpendicularSquared);
    step = Math.min(step, Math.max(0, safeStep));
  }

  if (step <= 0) return character;
  const endpoint = distance <= step
    ? target
    : { x: character.x + direction.x * step, y: character.y + direction.y * step };
  return isSafeSegment(state, character, endpoint, navigation) ? { ...character, ...endpoint } : character;
}

export function hasArrived(staff) {
  return !staff || !staff.path || staff.path.length === 0;
}
