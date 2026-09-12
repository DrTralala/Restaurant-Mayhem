function validate(action) {
  if (!action || ![action.from?.x, action.from?.y, action.to?.x, action.to?.y, action.start, action.end].every(Number.isFinite)
    || action.end < action.start
    || (action.end === action.start && (action.from.x !== action.to.x || action.from.y !== action.to.y))) {
    throw new Error('Invalid movement reservation');
  }
}

function interpolate(action, time) {
  if (time <= action.start) return { ...action.from };
  if (time >= action.end) return { ...action.to };
  const fraction = (time - action.start) / (action.end - action.start);
  return { x: action.from.x + (action.to.x - action.from.x) * fraction,
    y: action.from.y + (action.to.y - action.from.y) * fraction };
}

export function positionAt(action, time) {
  validate(action);
  if (!Number.isFinite(time)) throw new Error('Invalid movement reservation time');
  return interpolate(action, time);
}

export function actionsConflict(left, right, clearance = 16) {
  validate(left);
  validate(right);
  if (!Number.isFinite(clearance) || clearance < 0) throw new Error('Invalid movement reservation clearance');
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  if (end < start) return false;
  const a = interpolate(left, start);
  const b = interpolate(right, start);
  const aEnd = interpolate(left, end);
  const bEnd = interpolate(right, end);
  const x = a.x - b.x;
  const y = a.y - b.y;
  const dx = (aEnd.x - bEnd.x) - x;
  const dy = (aEnd.y - bEnd.y) - y;
  const squared = dx * dx + dy * dy;
  const fraction = squared === 0 ? 0 : Math.max(0, Math.min(1, -(x * dx + y * dy) / squared));
  const separation = Math.hypot(x + dx * fraction, y + dy * fraction);
  if (!Number.isFinite(separation)) throw new Error('Invalid movement reservation arithmetic');
  return separation < clearance;
}
