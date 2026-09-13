import { createGrid, latticeAnchors } from './grid';
import { cellKey, worldToCell } from '../movement/navigationWorkspace';
import { advanceRouteSearch, beginRouteSearch, forkRouteSearch } from './router';
import { planMovement } from './planner';
import { actionsConflict, positionAt } from './reservations';
import { arbitrateDestinations, orderTrafficRequests } from './traffic';
import { chooseRecoveries } from './recovery';
import { createActorGrid, commitActorPosition } from './domainGrid';
import { stationaryTrajectory, trajectorySegment } from '../movement/trajectory';

export const MAX_EXPANSIONS_PER_TICK = 2048;
export const MAX_EXPANSIONS_PER_ACTOR = 256;
const HORIZON = 2;
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (a, b) => a && b && a.x === b.x && a.y === b.y;
const copyPoint = point => ({ x: point.x, y: point.y });
const hold = (point, horizon) => [{ from: copyPoint(point), to: copyPoint(point), start: 0, end: horizon }];

export function createMovementCoordinator() {
  return { version: 1, tick: 0, requests: new Map(), statuses: new Map(), claims: new Map(),
    records: new Map(), plans: new Map(), diagnostics: { expansionsThisTick: 0 } };
}

function priority(actor, entry) {
  if (entry?.doorFlow?.direction === 'egress') return 0;
  return actor.activityPhase === 'idle_roaming' ? 4 : 2;
}

function normalise(state, entries, previous) {
  const actors = new Map();
  for (const actor of [...(state.staff || []), ...(state.customers || [])]) {
    if (actor?.id != null && finitePoint(actor)) actors.set(String(actor.id), actor);
  }
  for (const slot of state.queueSlots || []) {
    if (slot.memberId != null && finitePoint(slot) && !actors.has(String(slot.memberId))) {
      actors.set(String(slot.memberId), { id: String(slot.memberId), x: slot.x, y: slot.y });
    }
  }
  const descriptors = new Map();
  const duplicate = new Set();
  for (const entry of entries) {
    if (entry.character?.id == null || !finitePoint(entry.character)) continue;
    const id = String(entry.character.id);
    if (descriptors.has(id)) duplicate.add(id);
    descriptors.set(id, entry);
    if (!actors.has(id)) actors.set(id, entry.character);
  }
  const requests = new Map();
  for (const [id, character] of actors) {
    const entry = duplicate.has(id) ? null : descriptors.get(id);
    const goal = finitePoint(character.navigationGoal) ? copyPoint(character.navigationGoal) : null;
    const queueRank = Number.isInteger(entry?.queueRank)
      ? entry.queueRank
      : Number.isInteger(entry?.checkoutAdvance?.queueRank)
        ? entry.checkoutAdvance.queueRank : null;
    const checkoutStationId = entry?.checkoutAdvance?.stationId ?? character.cashierStationId ?? null;
    const old = previous.records.get(id);
    requests.set(id, { id, character, start: copyPoint(character), goal,
      invalidGoal: character.navigationGoal != null && !finitePoint(character.navigationGoal),
      speed: Number.isFinite(entry?.speed) && entry.speed > 0 ? entry.speed : 0,
      doorFlow: entry?.doorFlow || null,
      doorApproach: entry?.doorApproach === true,
      checkoutAdvance: entry?.checkoutAdvance || null,
      queueRank,
      checkoutStationId,
      waitingTicks: samePoint(old?.goal, goal) ? old.waitingTicks : 0,
      priority: priority(character, entry), duplicate: duplicate.has(id) });
  }
  return requests;
}

function planPosition(actions, time) {
  const action = actions.find(item => item.end >= time) || actions.at(-1);
  return positionAt(action, time);
}

function trajectory(actions, dt, actor) {
  if (dt === 0) return stationaryTrajectory(actor);
  return actions.filter(action => action.start < dt).map(action => trajectorySegment(
    action.from, positionAt(action, Math.min(action.end, dt)), action.start / dt, Math.min(action.end, dt) / dt,
  ));
}

function routeTarget(grid, start, route, speed, horizon, goal) {
  let nearest = -1;
  let nearestDistance = Infinity;
  for (let index = 0; index < route.length; index += 1) {
    const point = route[index];
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    if (distance > nearestDistance || !grid.segmentClear(start, point)) continue;
    nearest = index;
    nearestDistance = distance;
  }
  if (nearest < 0) return goal;
  const lookahead = speed * horizon * 0.75;
  let point = route[nearest];
  let length = nearestDistance;
  for (let index = nearest + 1; index < route.length; index += 1) {
    const next = route[index];
    const segment = Math.hypot(next.x - point.x, next.y - point.y);
    if (length + segment > lookahead && length > 0) break;
    length += segment;
    point = next;
  }
  return point;
}

function planCheckoutAdvance({ grid, start, goal, speed, horizon, reservations }) {
  const blockers = new Set();
  const result = (status, actions = []) => ({
    status,
    actions,
    blockers: [...blockers].sort(),
  });
  if (!grid.isOpen(start) || !grid.isOpen(goal) || !grid.segmentClear(start, goal)) {
    return result('blocked');
  }

  const distance = Math.hypot(goal.x - start.x, goal.y - start.y);
  if (distance === 0) return result('arrived', hold(start, horizon));

  const duration = distance / speed;
  const end = Math.min(horizon, duration);
  const fraction = end / duration;
  const endpoint = fraction >= 1 ? copyPoint(goal) : {
    x: start.x + (goal.x - start.x) * fraction,
    y: start.y + (goal.y - start.y) * fraction,
  };
  const actions = [{ from: copyPoint(start), to: endpoint, start: 0, end }];
  if (end < horizon) actions.push({ from: copyPoint(endpoint), to: copyPoint(endpoint),
    start: end, end: horizon });

  for (const reservation of reservations) {
    for (const other of reservation.actions) {
      if (!actions.some(action => actionsConflict(action, other))) continue;
      blockers.add(reservation.actorId);
      return result('blocked');
    }
  }
  return result(end >= duration ? 'arrived' : 'partial', actions);
}

export function advanceCharacterMovementBatch(state, entries, movementDt, metrics = null) {
  const batchStarted = metrics ? performance.now() : 0;
  let executorMilliseconds = 0;
  const dt = Number.isFinite(movementDt) ? Math.max(0, movementDt) : 0;
  const horizon = Math.max(HORIZON, dt);
  const previous = state.movementCoordinator?.version === 1 ? state.movementCoordinator : createMovementCoordinator();
  const next = createMovementCoordinator();
  next.tick = previous.tick + 1;
  const baseGrid = createGrid(state);
  const requests = normalise(state, entries, previous);
  next.requests = requests;
  const recoveryResult = chooseRecoveries({ requests, records: previous.records,
    statuses: previous.statuses, grid: baseGrid, budget: 512 });
  const effectiveGoal = request => request.checkoutAdvance
    ? request.goal : recoveryResult.recoveries.get(request.id)?.goal || request.goal;
  const arbitration = arbitrateDestinations([...requests.values()].filter(request => request.goal)
    .map(request => ({ ...request, goal: effectiveGoal(request) })), previous.claims);
  next.claims = arbitration.claims;
  const reservations = new Map([...requests].map(([id, request]) => [id, { actorId: id, actions: hold(request.start, horizon) }]));
  const moved = new Map();
  const trajectories = new Map();
  const diagnostics = { expansionsThisTick: recoveryResult.expansions, actorExpansions: new Map(), waiting: new Map(),
    blockedClaims: arbitration.blocked, recoveries: recoveryResult.recoveries };
  const physical = [...requests.values()];
  const unsafeActors = new Set();
  for (let left = 0; left < physical.length; left += 1) {
    for (let right = left + 1; right < physical.length; right += 1) {
      if (Math.hypot(physical[left].start.x - physical[right].start.x,
        physical[left].start.y - physical[right].start.y) < 16) {
        unsafeActors.add(physical[left].id);
        unsafeActors.add(physical[right].id);
      }
    }
  }
  if (unsafeActors.size) {
    diagnostics.invariantFailure = 'unsafeInitialState';
    diagnostics.unsafeActors = [...unsafeActors].sort();
  }

  for (const request of orderTrafficRequests([...requests.values()])) {
    const expansionsBefore = diagnostics.expansionsThisTick;
    const { id, goal, start, character, speed } = request;
    const grid = createActorGrid(state, character, baseGrid, request.doorFlow);
    const target = effectiveGoal(request);
    const recovery = recoveryResult.recoveries.get(id);
    let actions = reservations.get(id).actions;
    let plan = goal && !samePoint(start, goal) ? 'planning' : 'arrived';
    let reason = null;
    let blockers = [];
    const old = previous.records.get(id);
    const avoidance = new Map();
    const stationary = peer => peer && (!peer.goal || samePoint(peer.start, peer.goal) || peer.speed === 0
      || samePoint(peer.start, recoveryResult.recoveries.get(peer.id)?.goal));
    for (const obstacle of old?.routeAvoidance || []) {
      const peer = requests.get(obstacle.id);
      if (stationary(peer) && samePoint(peer.start, obstacle.start)) avoidance.set(peer.id, obstacle);
    }
    if (request.waitingTicks >= 8) for (const otherId of previous.statuses.get(id)?.blockers || []) {
      const peer = requests.get(otherId);
      if (otherId !== id && stationary(peer)) avoidance.set(otherId, { id: otherId, start: { ...peer.start } });
    }
    const routeAvoidance = request.checkoutAdvance ? []
      : [...avoidance.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const avoidanceKey = JSON.stringify(routeAvoidance);
    const sameRoute = old?.topology === grid.signature && samePoint(old.routeGoal, target)
      && old.avoidanceKey === avoidanceKey;
    let commitment = !request.checkoutAdvance && sameRoute && old.commitment && !samePoint(start, old.commitment)
      && grid.isOpen(old.commitment) && (samePoint(old.commitment, target)
        || [...grid.neighbours(start), ...(grid.connectors?.(start) || [])]
          .some(point => samePoint(point, old.commitment))) ? old.commitment : null;
    let route = !request.checkoutAdvance && sameRoute ? old.route : null;
    let routeSearch = !request.checkoutAdvance && sameRoute
      && samePoint(old.searchStart, start) && old.routeSearch ? forkRouteSearch(old.routeSearch) : null;
    if (unsafeActors.has(id)) { plan = 'waiting'; reason = 'unsafe-initial-state'; }
    else if (request.duplicate) { plan = 'waiting'; reason = 'duplicate-descriptor'; }
    else if (request.invalidGoal) { plan = 'unreachable'; reason = 'invalid-goal'; }
    else if (recovery && samePoint(start, target)) {
      plan = 'waiting'; reason = 'yielding'; blockers = recovery.peers.map(peer => peer.id);
    }
    else if (plan !== 'arrived' && arbitration.blocked.has(id)) {
      plan = 'waiting'; reason = 'destination-owned'; blockers = arbitration.blocked.get(id);
    } else if (request.checkoutAdvance && plan !== 'arrived' && speed > 0 && dt > 0) {
      const result = planCheckoutAdvance({ grid, start, goal: target, speed, horizon,
        reservations: [...reservations.values()].filter(item => item.actorId !== id) });
      blockers = result.blockers;
      if (result.actions.length) actions = result.actions;
      if (result.status === 'blocked') {
        plan = 'waiting';
        reason = 'checkout-clearance';
      }
    } else if (plan !== 'arrived' && speed > 0 && dt > 0) {
      const available = Math.min(MAX_EXPANSIONS_PER_ACTOR, MAX_EXPANSIONS_PER_TICK - diagnostics.expansionsThisTick);
      let spent = 0;
      if (!route) {
        if (!routeSearch) {
          const blocked = new Set(routeAvoidance.flatMap(obstacle => latticeAnchors(obstacle.start)
            .filter(point => Math.hypot(point.x - obstacle.start.x, point.y - obstacle.start.y) < 16)
            .map(point => cellKey(worldToCell(point)))));
          routeSearch = beginRouteSearch(grid, start, target, { blocked, allowBlockedStart: true,
            allowBlockedGoal: routeAvoidance.every(obstacle => Math.hypot(target.x - obstacle.start.x, target.y - obstacle.start.y) >= 16) });
        }
        const search = advanceRouteSearch(routeSearch, available);
        spent += search.expansions;
        if (search.status === 'found') { route = search.points; routeSearch = null; }
        else if (search.status === 'unreachable') {
          plan = routeAvoidance.length ? 'waiting' : 'unreachable';
          reason = routeAvoidance.length ? 'traffic' : 'static-geometry';
          blockers = routeAvoidance.map(obstacle => obstacle.id);
        }
      }
      if (route && plan !== 'unreachable') {
        const result = planMovement({ grid, start, goal: commitment || routeTarget(grid, start, route, speed, horizon, target), speed, horizon,
          reservations: [...reservations.values()].filter(item => item.actorId !== id),
          maxExpansions: Math.max(0, available - spent) });
        spent += result.expansions;
        blockers = result.blockers;
        if (result.actions.length) actions = result.actions;
        reason = result.status === 'pending' ? 'planning-budget' : blockers.length ? 'traffic' : null;
      } else if (plan !== 'unreachable' && plan !== 'waiting') reason = 'planning-budget';
      diagnostics.expansionsThisTick += spent;
    }
    diagnostics.actorExpansions.set(id, diagnostics.expansionsThisTick - expansionsBefore);
    const executorStarted = metrics ? performance.now() : 0;
    reservations.set(id, { actorId: id, actions });
    const position = planPosition(actions, dt);
    const advancing = !samePoint(position, start);
    if (goal && samePoint(position, goal)) plan = 'arrived';
    else if (advancing) plan = 'moving';
    else if (plan === 'planning' && reason === 'traffic') plan = 'waiting';
    const status = { plan, motion: advancing ? 'traversing' : 'holding', reason, blockers };
    next.statuses.set(id, status);
    const remaining = goal ? Math.hypot(position.x - goal.x, position.y - goal.y) : 0;
    const bestDistance = samePoint(old?.goal, goal) ? old.bestDistance ?? Infinity
      : goal ? Math.hypot(start.x - goal.x, start.y - goal.y) : 0;
    const progress = remaining < bestDistance - 1e-6;
    if (commitment && samePoint(position, commitment)) commitment = null;
    if (!request.checkoutAdvance && !commitment) {
      const nextMove = actions.find(action => action.end > dt && !samePoint(action.from, action.to));
      commitment = nextMove && !samePoint(position, nextMove.to)
        && (samePoint(nextMove.to, target) || [...grid.neighbours(nextMove.from), ...(grid.connectors?.(nextMove.from) || [])]
          .some(point => samePoint(point, nextMove.to)))
        ? copyPoint(nextMove.to) : null;
    }
    next.records.set(id, { goal, routeGoal: target, topology: grid.signature, route, routeSearch, searchStart: start, recovery,
      routeAvoidance, avoidanceKey, commitment,
      bestDistance: Math.min(bestDistance, remaining),
      waitingTicks: !goal || plan === 'arrived' || progress ? 0 : request.waitingTicks + 1 });
    next.plans.set(id, actions);
    if (!advancing && goal && plan !== 'arrived') diagnostics.waiting.set(id, status);
    moved.set(id, commitActorPosition(character, grid, position, actions));
    trajectories.set(id, trajectory(actions, dt, character));
    if (metrics) executorMilliseconds += performance.now() - executorStarted;
  }
  next.diagnostics = diagnostics;
  if (metrics) {
    const elapsed = performance.now() - batchStarted;
    metrics.batches += 1;
    metrics.plannerExpansions = (metrics.plannerExpansions || 0) + diagnostics.expansionsThisTick;
    metrics.batchMilliseconds += elapsed;
    metrics.executorMilliseconds += executorMilliseconds;
    metrics.plannerMilliseconds += elapsed - executorMilliseconds;
  }
  return { moved, coordinator: next, statuses: next.statuses, trajectories, diagnostics };
}
