import { CHARACTER_CLEARANCE } from './destinations';

const samePoint = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);
const score = request => (request.priority ?? 2) - Math.floor((request.waitingTicks || 0) / 30);
const compareIds = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export function compareTraffic(left, right) {
  return score(left) - score(right) || (right.waitingTicks || 0) - (left.waitingTicks || 0)
    || compareIds(left.id, right.id);
}

export function arbitrateDestinations(requests, previousClaims = new Map()) {
  const claims = new Map();
  const blocked = new Map();
  const productiveOwner = request => (request.priority ?? 2) < 4 && samePoint(previousClaims.get(request.id), request.goal);
  const ordered = requests.filter(request => Number.isFinite(request.goal?.x) && Number.isFinite(request.goal?.y))
    .sort((a, b) => Number(samePoint(b.start, b.goal)) - Number(samePoint(a.start, a.goal))
      || Number(productiveOwner(b)) - Number(productiveOwner(a))
      || score(a) - score(b)
      || Number(samePoint(previousClaims.get(b.id), b.goal)) - Number(samePoint(previousClaims.get(a.id), a.goal))
      || compareTraffic(a, b));
  for (const request of ordered) {
    const owners = [...claims].filter(([, point]) => Math.hypot(point.x - request.goal.x, point.y - request.goal.y) < CHARACTER_CLEARANCE)
      .map(([id]) => id);
    if (owners.length) blocked.set(request.id, owners);
    else claims.set(request.id, { ...request.goal });
  }
  return { claims, blocked };
}
