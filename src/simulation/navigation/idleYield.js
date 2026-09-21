import { createGrid } from './grid';
import { physicalActors, finitePoint, samePoint, positionAvailable } from './occupancy';
import { actionsConflict } from './reservations';
import { getCarriedServiceItemIds } from '../staffInventory';
import { clearNavigationGoal, setNavigationGoal } from '../movement/navigationGoal';
import { canClaimDestination } from './destinations';
import { noteNavigation } from './telemetry';

const MIN_HOLD = 8 / 30;
const MAX_YIELD_SECONDS = 5;
const MAX_NODES = 128;
const MAX_DEPTH = 6;

function eligible(state, worker) {
  return finitePoint(worker) && !worker.task && getCarriedServiceItemIds(worker).length === 0
    && !worker.amenityUse && !worker.movementResidency && !worker.ptoSession
    && (worker.effectiveDuty ?? 'work') === 'work'
    && (worker.dutyPhase ?? 'available') === 'available'
    && !(state.cashierStations || []).some(station => String(station.assignedStaffId) === String(worker.id));
}

function cancel(state, worker, restoreGoal = false) {
  const { navigationYield, ...clean } = worker;
  if (worker.task || !samePoint(worker.navigationGoal, navigationYield?.goal)) return clean;
  const cleared = clearNavigationGoal(clean);
  const resumeGoal = navigationYield?.resumeGoal;
  return restoreGoal && finitePoint(resumeGoal) && canClaimDestination(state, cleared, resumeGoal)
    ? setNavigationGoal({ ...cleared, activityPhase: 'idle_roaming', idleUntil: null }, resumeGoal)
    : cleared;
}

function lineDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const squared = dx * dx + dy * dy;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function passed(peer, intent) {
  const dx = intent.beneficiaryGoal.x - intent.beneficiaryStart.x;
  const dy = intent.beneficiaryGoal.y - intent.beneficiaryStart.y;
  const length = Math.hypot(dx, dy);
  return length > 0 && ((peer.x - intent.origin.x) * dx + (peer.y - intent.origin.y) * dy) / length >= 16;
}

function findBay(state, worker, peer, grid) {
  const obstacles = physicalActors(state).filter(actor => String(actor.id) !== String(worker.id));
  const frontier = [{ point: { x: worker.x, y: worker.y }, depth: 0 }];
  const seen = new Set([`${worker.x},${worker.y}`]);
  let expanded = 0;
  while (frontier.length && expanded < MAX_NODES) {
    const current = frontier.shift();
    expanded += 1;
    if (current.depth > 0 && positionAvailable(state, current.point, worker.id, { goals: true })
      && lineDistance(current.point, peer, peer.navigationGoal) >= 16) {
      return { point: current.point, expanded };
    }
    if (current.depth >= MAX_DEPTH) continue;
    const candidates = [...grid.neighbours(current.point), ...(grid.connectors?.(current.point) || [])]
      .sort((a, b) => a.y - b.y || a.x - b.x);
    for (const point of candidates) {
      const key = `${point.x},${point.y}`;
      if (seen.has(key)) continue;
      const action = { from: current.point, to: point, start: 0, end: 1 };
      if (obstacles.some(actor => actionsConflict(action,
        { from: actor, to: actor, start: 0, end: 1 }))) continue;
      seen.add(key);
      frontier.push({ point, depth: current.depth + 1 });
    }
  }
  return { point: null, expanded };
}

// undefined means continue ordinary activity selection; an actor return value is a complete temporary activity decision for this call.
export function prepareIdleYield(state, worker) {
  const intent = worker.navigationYield;
  if (!eligible(state, worker)) return intent ? cancel(state, worker) : undefined;
  const coordinator = state.movementCoordinator;
  const now = coordinator?.elapsedMovementSeconds || 0;
  const evidence = coordinator?.statuses instanceof Map ? [...coordinator.statuses] : [];
  if (!intent && !evidence.some(([id, status]) => status.motion === 'holding'
    && (coordinator.records?.get?.(id)?.waitingSeconds || 0) >= MIN_HOLD
    && status.blockers?.some(id => String(id) === String(worker.id)))) return undefined;
  const grid = intent ? createGrid(state) : null;
  const actors = physicalActors(state);
  if (intent) {
    const peer = actors.find(actor => String(actor.id) === intent.beneficiaryId);
    if (!peer || !samePoint(peer.navigationGoal, intent.beneficiaryGoal)
      || samePoint(peer, peer.navigationGoal) || passed(peer, intent)
      || now - intent.startedAt >= MAX_YIELD_SECONDS || !grid.isOpen(intent.goal)
      || !positionAvailable(state, intent.goal, worker.id, { goals: true })
      || coordinator?.statuses?.get?.(String(worker.id))?.plan === 'unreachable') {
      return cancel(state, worker, true);
    }
    return setNavigationGoal(worker, intent.goal);
  }
  if (worker.navigationGoal && worker.activityPhase !== 'idle_roaming') return undefined;
  const requests = coordinator?.requests instanceof Map ? coordinator.requests : new Map();
  const candidates = actors.filter(peer => String(peer.id) !== String(worker.id) && finitePoint(peer.navigationGoal))
    .filter(peer => {
      const id = String(peer.id);
      const record = coordinator?.records?.get?.(id);
      const status = coordinator?.statuses?.get?.(id);
      return (record?.waitingSeconds || 0) >= MIN_HOLD && status?.motion === 'holding'
        && ['traffic', 'destination-owned', 'checkout-clearance'].includes(status.reason)
        && samePoint(requests.get(id)?.goal, peer.navigationGoal)
        && !passed(peer, { beneficiaryStart: peer, beneficiaryGoal: peer.navigationGoal, origin: worker })
        && status.blockers?.some(id => String(id) === String(worker.id));
    }).sort((a, b) => (requests.get(String(a.id))?.priority ?? 2) - (requests.get(String(b.id))?.priority ?? 2)
      || (String(a.id) < String(b.id) ? -1 : 1));
  if (!candidates.length) return undefined;
  const bayGrid = createGrid(state);
  if (!bayGrid.isOpen(worker)) return undefined;
  for (const peer of candidates) {
    const result = findBay(state, worker, peer, bayGrid);
    noteNavigation('yieldSearches');
    noteNavigation('yieldExpansions', result.expanded);
    if (!result.point) continue;
    return setNavigationGoal({ ...worker, activityPhase: 'idle_roaming', idleUntil: null,
      navigationYield: { goal: result.point, origin: { x: worker.x, y: worker.y }, startedAt: now,
        beneficiaryId: String(peer.id), beneficiaryStart: { x: peer.x, y: peer.y },
        beneficiaryGoal: { ...peer.navigationGoal },
        ...(finitePoint(worker.navigationGoal) && worker.activityPhase === 'idle_roaming'
          ? { resumeGoal: { ...worker.navigationGoal } } : {}),
      } }, result.point);
  }
  return undefined;
}
