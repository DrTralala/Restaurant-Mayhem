export function compareKeys(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareActorsById(left, right) {
  return compareKeys(left.id, right.id);
}

function compareActorsByAgedPriority(left, right) {
  return (right.stalledFor || 0) - (left.stalledFor || 0)
    || compareActorsById(left, right);
}

function hasSameDoorEgressPrecedence(higher, lower) {
  return higher.doorId != null
    && higher.doorId === lower.doorId
    && higher.doorFlow === 'out'
    && lower.doorFlow === 'in';
}

export function sameDoorEgressEdges(actors) {
  const edges = [];
  for (const higher of actors) {
    for (const lower of actors) {
      if (hasSameDoorEgressPrecedence(higher, lower)) edges.push([higher.id, lower.id]);
    }
  }
  return edges;
}

export function buildPriorityGraph(actors, edges) {
  const graph = new Map(actors.map(actor => [actor.id, new Set()]));
  for (const [higherId, lowerId] of edges) graph.get(higherId).add(lowerId);
  return graph;
}

export function reachableIds(graph, startId) {
  const reached = new Set();
  const pending = [...graph.get(startId)].sort(compareKeys);
  while (pending.length > 0) {
    const id = pending.shift();
    if (reached.has(id)) continue;
    reached.add(id);
    pending.push(...[...graph.get(id)].sort(compareKeys));
  }
  return reached;
}

export function topologicalActorIds(actors, edges) {
  const graph = buildPriorityGraph(actors, edges);
  const indegrees = new Map(actors.map(actor => [actor.id, 0]));
  for (const lowerIds of graph.values()) {
    for (const lowerId of lowerIds) indegrees.set(lowerId, indegrees.get(lowerId) + 1);
  }
  const ready = actors.map(actor => actor.id)
    .filter(id => indegrees.get(id) === 0)
    .sort(compareKeys);
  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(id);
    for (const lowerId of [...graph.get(id)].sort(compareKeys)) {
      indegrees.set(lowerId, indegrees.get(lowerId) - 1);
      if (indegrees.get(lowerId) === 0) {
        ready.push(lowerId);
        ready.sort(compareKeys);
      }
    }
  }
  return ordered.length === actors.length ? ordered : null;
}

export function priorityAncestors(actors, edges, actorId) {
  const reverseGraph = new Map(actors.map(actor => [actor.id, new Set()]));
  for (const [higherId, lowerId] of edges) reverseGraph.get(lowerId).add(higherId);
  return reachableIds(reverseGraph, actorId);
}

export function orderActorsByMovementPriority(actors) {
  const actorMap = new Map(actors.map(actor => [actor.id, actor]));
  const graph = buildPriorityGraph(actors, sameDoorEgressEdges(actors));
  const indegrees = new Map(actors.map(actor => [actor.id, 0]));
  for (const lowerIds of graph.values()) {
    for (const lowerId of lowerIds) indegrees.set(lowerId, indegrees.get(lowerId) + 1);
  }
  const ready = actors.filter(actor => indegrees.get(actor.id) === 0)
    .sort(compareActorsByAgedPriority);
  const ordered = [];
  while (ready.length > 0) {
    const actor = ready.shift();
    ordered.push(actor);
    for (const lowerId of [...graph.get(actor.id)].sort(compareKeys)) {
      indegrees.set(lowerId, indegrees.get(lowerId) - 1);
      if (indegrees.get(lowerId) === 0) {
        ready.push(actorMap.get(lowerId));
        ready.sort(compareActorsByAgedPriority);
      }
    }
  }
  return ordered.length === actors.length
    ? ordered
    : [...actors].sort(compareActorsByAgedPriority);
}

export function addPriorityEdge(actors, edges, higherId, lowerId) {
  const graph = buildPriorityGraph(actors, edges);
  if (higherId === lowerId || reachableIds(graph, lowerId).has(higherId)) return null;
  if (graph.get(higherId).has(lowerId)) return edges;
  return [...edges, [higherId, lowerId]];
}
