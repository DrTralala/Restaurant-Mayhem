import { isLatticePoint, latticeAnchors } from './grid';
import { actionsConflict } from './reservations';
import { noteNavigation } from './telemetry';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pointKey = point => `${point.x},${point.y}`;
const searchKey = (point, time) => `${pointKey(point)}@${Math.round(time * 1e6)}`;
const samePoint = (a, b) => a.x === b.x && a.y === b.y;

export function planMovement({ grid, start, goal, speed, horizon, reservations = [], maxExpansions = 256,
  firstWaypoint = null }) {
  if (!Number.isFinite(horizon) || horizon <= 0 || !Number.isFinite(speed) || speed <= 0) {
    throw new Error('Invalid movement planning horizon or speed');
  }
  const budget = Math.max(0, Math.floor(Number(maxExpansions) || 0));
  const blockers = new Set();
  let expansions = 0;
  const result = (status, actions = []) => {
    noteNavigation('localSearches');
    noteNavigation('localExpansions', expansions);
    return { status, actions, expansions, blockers: [...blockers].sort() };
  };
  if (!grid.isOpen(start) || !grid.isOpen(goal)) return result('unreachable');
  // A yielding actor may have to finish an edge without holding its intermediate
  // endpoint for the entire horizon. Keep that edge mandatory, then search on.
  const waypointPending = firstWaypoint !== null && !samePoint(start, firstWaypoint);
  if (waypointPending && (!grid.isOpen(firstWaypoint)
    || ![...grid.neighbours(start), ...(grid.connectors?.(start) || [])]
      .some(point => samePoint(point, firstWaypoint)))) return result('unreachable');
  const remaining = (point, pending) => pending
    ? distance(point, firstWaypoint) + distance(firstWaypoint, goal) : distance(point, goal);
  const keyFor = (point, time, pending) => `${searchKey(point, time)}${pending ? ':waypoint' : ''}`;
  const safe = action => {
    let clear = true;
    for (const reservation of reservations) {
      for (const other of reservation.actions) {
        if (!actionsConflict(action, other)) continue;
        blockers.add(reservation.actorId);
        clear = false;
        break;
      }
    }
    return clear;
  };
  const holding = node => ({ from: node.point, to: node.point, start: node.time, end: horizon });
  const initial = { point: start, time: 0, remaining: remaining(start, waypointPending),
    waypointPending, parent: null, action: null };
  const initialSafe = safe(holding(initial));
  let best = initialSafe ? initial : null;
  let bestClipped = null;
  const frontier = [initial];
  const visited = new Set([keyFor(start, 0, waypointPending)]);
  const goalAnchors = new Set(latticeAnchors(goal).map(pointKey));
  const waitDuration = Math.min(0.25, 20 / speed);
  let complete = null;
  while (frontier.length && expansions < budget) {
    frontier.sort((a, b) => a.time + a.remaining / speed - b.time - b.remaining / speed
      || a.remaining - b.remaining || a.point.y - b.point.y || a.point.x - b.point.x);
    const current = frontier.shift();
    expansions += 1;
    if (current === initial ? initialSafe : safe(holding(current))) {
      const previous = current.clipped ? bestClipped : best;
      if (!previous || current.remaining < previous.remaining
        || (current.remaining === previous.remaining && current.time < previous.time)) {
        if (current.clipped) bestClipped = current;
        else best = current;
      }
      if (current.remaining === 0) { complete = current; break; }
    }
    if (current.time >= horizon) continue;
    const candidates = current.waypointPending ? [firstWaypoint] : grid.neighbours(current.point);
    if (!current.waypointPending && !isLatticePoint(goal) && (goalAnchors.has(pointKey(current.point))
      || distance(current.point, goal) < 20) && grid.segmentClear(current.point, goal)) candidates.push(goal);
    const enqueue = target => {
      const length = distance(current.point, target);
      const duration = length === 0 ? waitDuration : length / speed;
      const end = Math.min(horizon, current.time + duration);
      if (end <= current.time) return false;
      const fraction = (end - current.time) / duration;
      const point = fraction >= 1 ? target : {
        x: current.point.x + (target.x - current.point.x) * fraction,
        y: current.point.y + (target.y - current.point.y) * fraction,
      };
      const pending = current.waypointPending && !samePoint(point, firstWaypoint);
      const key = keyFor(point, end, pending);
      if (visited.has(key)) return length > 0;
      const action = { from: current.point, to: point, start: current.time, end };
      if (!safe(action)) return false;
      visited.add(key);
      frontier.push({ point, time: end, remaining: remaining(point, pending), waypointPending: pending, parent: current, action,
        clipped: end < current.time + duration });
      return length > 0;
    };
    let canMove = false;
    for (const target of candidates) canMove = enqueue(target) || canMove;
    if (!current.waypointPending && !canMove && !isLatticePoint(current.point)) {
      for (const target of grid.connectors?.(current.point) || []) enqueue(target);
    }
    enqueue(current.point);
  }
  // Prefer reaching a safe waypoint over tuning a horizon-clipped endpoint.
  // Otherwise a backtracking loop can win by ending slightly closer to an
  // occupied hint, and repeating that first step each frame causes oscillation.
  let terminal = complete || best;
  if (!complete && (!best || best.remaining >= initial.remaining)
    && bestClipped && (!best || bestClipped.remaining < best.remaining)) terminal = bestClipped;
  if (!terminal) return result('blocked');
  const actions = [];
  for (let node = terminal; node.parent; node = node.parent) actions.push(node.action);
  actions.reverse();
  if (terminal.time < horizon) actions.push(holding(terminal));
  // The search payload owns all points: callers cannot mutate grid inputs or
  // another actor's reservations through returned action endpoints.
  const owned = actions.map(action => ({ ...action, from: { ...action.from }, to: { ...action.to } }));
  return result(complete ? 'arrived' : terminal.remaining < initial.remaining ? 'partial'
    : expansions >= budget ? 'pending' : 'blocked', owned);
}
