import { CHARACTER_CLEARANCE } from './destinations';

const samePoint = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);
const score = request => (request.priority ?? 2) - Math.floor((request.waitingTicks || 0) / 30);
const compareIds = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

function hasCheckoutRank(request) {
  return request?.checkoutStationId != null
    && Number.isInteger(request.queueRank) && request.queueRank >= 0;
}

function sameCheckoutQueue(left, right) {
  return hasCheckoutRank(left) && hasCheckoutRank(right)
    && String(left.checkoutStationId) === String(right.checkoutStationId);
}

export function compareTraffic(left, right) {
  // This comparator is deliberately a total base ordering. Queue precedence is
  // a graph constraint applied by orderTrafficRequests; embedding that
  // preference in pairwise comparisons makes mixed queue/non-queue triples
  // non-transitive and lets Array#sort depend on input order.
  return score(left) - score(right) || (right.waitingTicks || 0) - (left.waitingTicks || 0)
    || compareIds(left.id, right.id);
}

// Apply checkout FIFO edges without weakening the total traffic ordering used
// to choose among requests that are currently eligible. Lower ranks precede
// higher ranks only within the same station; unrelated actors remain ordered by
// score, waiting age and ID, so they cannot be starved by a checkout queue.
export function orderTrafficRequests(requests, compare = compareTraffic) {
  const items = [...requests];
  const outgoing = items.map(() => new Set());
  const incoming = items.map(() => 0);
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      if (!sameCheckoutQueue(items[left], items[right])
        || items[left].queueRank === items[right].queueRank) continue;
      const earlier = items[left].queueRank < items[right].queueRank ? left : right;
      const later = earlier === left ? right : left;
      if (outgoing[earlier].has(later)) continue;
      outgoing[earlier].add(later);
      incoming[later] += 1;
    }
  }

  const ready = items.map((item, index) => incoming[index] === 0 ? index : -1)
    .filter(index => index >= 0);
  const ordered = [];
  const takeBest = () => {
    let bestIndex = 0;
    for (let index = 1; index < ready.length; index += 1) {
      const candidate = ready[index];
      const current = ready[bestIndex];
      if (compare(items[candidate], items[current]) < 0
        || (compare(items[candidate], items[current]) === 0
          && compareIds(items[candidate].id, items[current].id) < 0)) {
        bestIndex = index;
      }
    }
    return ready.splice(bestIndex, 1)[0];
  };

  while (ready.length) {
    const index = takeBest();
    ordered.push(items[index]);
    for (const next of outgoing[index]) {
      incoming[next] -= 1;
      if (incoming[next] === 0) ready.push(next);
    }
  }

  // Ranks are finite and strictly ordered, so a cycle is not expected. Keep
  // this fail-safe deterministic if malformed caller data violates that
  // assumption rather than returning a partial schedule.
  if (ordered.length < items.length) {
    const seen = new Set(ordered);
    ordered.push(...items.filter(item => !seen.has(item)).sort(compare));
  }
  return ordered;
}

export function arbitrateDestinations(requests, previousClaims = new Map()) {
  const claims = new Map();
  const blocked = new Map();
  const productiveOwner = request => (request.priority ?? 2) < 4 && samePoint(previousClaims.get(request.id), request.goal);
  const compareArbitration = (a, b) =>
    Number(samePoint(b.start, b.goal)) - Number(samePoint(a.start, a.goal))
    || Number(productiveOwner(b)) - Number(productiveOwner(a))
    || score(a) - score(b)
    || Number(samePoint(previousClaims.get(b.id), b.goal)) - Number(samePoint(previousClaims.get(a.id), a.goal))
    || compareTraffic(a, b);
  const ordered = orderTrafficRequests(
    requests.filter(request => Number.isFinite(request.goal?.x) && Number.isFinite(request.goal?.y)),
    compareArbitration,
  );
  for (const request of ordered) {
    const owners = [...claims].filter(([, point]) => Math.hypot(point.x - request.goal.x, point.y - request.goal.y) < CHARACTER_CLEARANCE)
      .map(([id]) => id);
    if (owners.length) blocked.set(request.id, owners);
    else claims.set(request.id, { ...request.goal });
  }
  return { claims, blocked };
}
