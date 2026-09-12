import { cellKey, cellToWorld, worldToCell } from '../movement/navigationWorkspace';
import { findRoute } from './router';
import { compareTraffic } from './traffic';

const samePoint = (a, b) => a && b && a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function passedConflict(peer, current, origin) {
  if (!peer.start || !origin) return false;
  const dx = peer.goal.x - peer.start.x, dy = peer.goal.y - peer.start.y;
  const length = Math.hypot(dx, dy);
  return length > 0 && ((current.start.x - origin.x) * dx + (current.start.y - origin.y) * dy) / length >= 16;
}

function cycles(requests, statuses) {
  const groups = [];
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const active = new Set();
  let sequence = 0;
  const visit = id => {
    indices.set(id, sequence);
    low.set(id, sequence++);
    stack.push(id);
    active.add(id);
    for (const other of statuses.get(id)?.blockers || []) {
      if (!requests.has(other) || (requests.get(other).waitingTicks || 0) < 8) continue;
      if (!indices.has(other)) {
        visit(other);
        low.set(id, Math.min(low.get(id), low.get(other)));
      } else if (active.has(other)) low.set(id, Math.min(low.get(id), indices.get(other)));
    }
    if (low.get(id) !== indices.get(id)) return;
    const group = [];
    let member;
    do { member = stack.pop(); active.delete(member); group.push(member); } while (member !== id);
    if (group.length > 1) groups.push(group.sort());
  };
  for (const id of [...requests.keys()].sort()) {
    if (requests.get(id).waitingTicks >= 8 && !indices.has(id)) visit(id);
  }
  return groups;
}

export function chooseRecoveries({ requests, records, statuses, grid, budget }) {
  const recoveries = new Map();
  let expansions = 0;
  for (const [id, request] of requests) {
    const old = records.get(id);
    if (!old?.recovery || !samePoint(old.goal, request.goal) || !grid.isOpen(old.recovery.goal)) continue;
    const outstanding = old.recovery.peers.filter(peer => {
      const current = requests.get(peer.id);
      return current?.goal && samePoint(current.goal, peer.goal) && !samePoint(current.start, current.goal)
        && !passedConflict(peer, current, old.recovery.origin);
    });
    if (outstanding.length) recoveries.set(id, { ...old.recovery, peers: outstanding });
  }
  // Separately granted bays can later depend on each other. Preserve a productive
  // actor in these retained dependencies too, not only when granting a new bay.
  const dependencies = new Map([...recoveries].map(([id, recovery]) => [id,
    { blockers: recovery.peers.filter(peer => recoveries.has(peer.id)).map(peer => peer.id) }]));
  for (const group of cycles(requests, dependencies)) {
    const passing = group.map(id => requests.get(id))
      .filter(request => samePoint(request.start, recoveries.get(request.id).goal)).sort(compareTraffic)[0];
    if (passing) recoveries.delete(passing.id);
  }
  const heldDependencies = new Map([...statuses].filter(([, status]) => status.motion !== 'traversing'));
  for (const group of cycles(requests, heldDependencies)) {
    // At least one actor must keep its productive route; making every member
    // wait for every other member merely replaces one deadlock with another.
    if (group.filter(id => recoveries.has(id)).length >= group.length - 1) continue;
    let best = null;
    for (const id of group) {
      if (recoveries.has(id)) continue;
      const request = requests.get(id);
      if (!request.goal || request.speed <= 0) continue;
      const peers = group.filter(other => other !== id).map(other => requests.get(other));
      const trafficCells = new Set(peers.flatMap(peer => [peer.start, peer.goal, ...(records.get(peer.id)?.route || [])])
        .map(point => cellKey(worldToCell(point))));
      const occupied = new Set([...requests.values()].filter(other => other.id !== id)
        .map(other => cellKey(worldToCell(other.start))));
      const start = worldToCell(request.start);
      const candidates = [];
      for (let dy = -6; dy <= 6; dy += 1) {
        for (let dx = -6; dx <= 6; dx += 1) {
          if (Math.abs(dx) + Math.abs(dy) > 6) continue;
          const cell = { x: start.x + dx, y: start.y + dy };
          const point = cellToWorld(cell);
          if (samePoint(point, request.start) || !grid.isOpen(point)
            || trafficCells.has(cellKey(cell)) || occupied.has(cellKey(cell))) continue;
          if ([...requests.values()].some(other => other.id !== id
            && ((other.goal && distance(point, other.goal) < 16) || distance(point, other.start) < 16))) continue;
          if ([...recoveries.values()].some(recovery => distance(point, recovery.goal) < 16)) continue;
          candidates.push(point);
        }
      }
      candidates.sort((a, b) => distance(a, request.start) - distance(b, request.start) || a.y - b.y || a.x - b.x);
      for (const point of candidates) {
        const available = Math.min(128, budget - expansions);
        if (available <= 0) break;
        const route = findRoute(grid, request.start, point, { maxExpansions: available, blocked: occupied });
        expansions += route.expansions;
        if (route.status !== 'found') continue;
        let length = 0;
        let previous = request.start;
        for (const step of route.points) { length += distance(previous, step); previous = step; }
        if (!best || length < best.length) best = { id, length, goal: point, origin: { ...request.start },
          peers: peers.map(peer => ({ id: peer.id, start: { ...peer.start }, goal: { ...peer.goal } })) };
        break;
      }
    }
    if (best) recoveries.set(best.id, { goal: best.goal, origin: best.origin, peers: best.peers });
  }
  return { recoveries, expansions };
}
