function validate(action) {
  if (!action) throw new Error('Invalid movement reservation');
  const fromX = action.from?.x;
  const fromY = action.from?.y;
  const toX = action.to?.x;
  const toY = action.to?.y;
  const start = action.start;
  const end = action.end;
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX)
    || !Number.isFinite(toY) || !Number.isFinite(start) || !Number.isFinite(end)
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

const BROAD_PHASE_SAFE_LIMIT = Number.MAX_SAFE_INTEGER;

function broadPhaseEligible(left, right, clearance) {
  return Math.abs(left.from.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.from.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.to.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.to.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.from.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.from.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.to.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.to.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.start) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.end) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.start) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.end) <= BROAD_PHASE_SAFE_LIMIT
    && clearance <= BROAD_PHASE_SAFE_LIMIT;
}

function isSpatiallySeparated(left, right, clearance) {
  if (!broadPhaseEligible(left, right, clearance)) return false;
  const leftMinX = Math.min(left.from.x, left.to.x);
  const leftMaxX = Math.max(left.from.x, left.to.x);
  const leftMinY = Math.min(left.from.y, left.to.y);
  const leftMaxY = Math.max(left.from.y, left.to.y);
  const rightMinX = Math.min(right.from.x, right.to.x);
  const rightMaxX = Math.max(right.from.x, right.to.x);
  const rightMinY = Math.min(right.from.y, right.to.y);
  const rightMaxY = Math.max(right.from.y, right.to.y);
  const gapX = leftMinX > rightMaxX ? leftMinX - rightMaxX
    : rightMinX > leftMaxX ? rightMinX - leftMaxX : 0;
  const gapY = leftMinY > rightMaxY ? leftMinY - rightMaxY
    : rightMinY > leftMaxY ? rightMinY - leftMaxY : 0;
  if (!Number.isFinite(gapX) || !Number.isFinite(gapY)) return false;
  if (gapX <= clearance && gapY <= clearance) return false;

  const scale = Math.max(1, clearance,
    Math.abs(left.from.x), Math.abs(left.from.y), Math.abs(left.to.x), Math.abs(left.to.y),
    Math.abs(right.from.x), Math.abs(right.from.y), Math.abs(right.to.x), Math.abs(right.to.y));
  const margin = Number.EPSILON * scale * 8;
  const threshold = clearance + margin;
  if (!Number.isFinite(threshold)) return false;
  return gapX > threshold || gapY > threshold;
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
  if (isSpatiallySeparated(left, right, clearance)) return false;
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
