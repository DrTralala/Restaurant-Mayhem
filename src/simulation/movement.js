import { cellToWorld } from './pathfinding';
import { getDefaultStaffPosition } from './world';

const ROLE_SPEED = { waiter: 75, cook: 55 };

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

export function moveCharacterAlongPath(character, dt, others = [], speed = 60, minimumSpacing = 16) {
  if (!character.path || character.path.length === 0) return character;
  const target = cellToWorld(character.path[0]);
  if (Math.hypot(target.x - character.x, target.y - character.y) <= 1) {
    return { ...character, x: target.x, y: target.y, path: character.path.slice(1) };
  }
  const moved = moveCharacterTowards(character, target, dt, others, speed, minimumSpacing);
  if (moved === character) return character;
  if (Math.hypot(target.x - moved.x, target.y - moved.y) <= 0.001) {
    return { ...moved, path: character.path.slice(1) };
  }
  return moved;
}

export function moveCharacterTowards(character, target, dt, others = [], speed = 60, minimumSpacing = 16) {
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
  if (distance <= step) return { ...character, x: target.x, y: target.y };
  return { ...character, x: character.x + direction.x * step, y: character.y + direction.y * step };
}

export function hasArrived(staff) {
  return !staff || !staff.path || staff.path.length === 0;
}
