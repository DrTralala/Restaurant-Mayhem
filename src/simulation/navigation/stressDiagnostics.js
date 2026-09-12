import { positionAt } from './reservations';
import { minimumTrajectoryDistance } from '../movement/trajectory';
import { summariseMovementMetrics } from '../movementMetrics';

export function nonTimingSummary(summary) {
  return Object.fromEntries(Object.entries(summary).filter(([key]) => !key.endsWith('Milliseconds')));
}
const same = (a, b) => Number.isFinite(a?.x) && Number.isFinite(a?.y) && a.x === b?.x && a.y === b?.y;

function matchesPlan(actions, actor, endpoint, trajectory, dt) {
  if (!actions?.length || !same(actions[0].from, actor) || actions[0].start !== 0) return false;
  try {
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      positionAt(action, action.start);
      if (index && (actions[index - 1].end !== action.start || !same(actions[index - 1].to, action.from))) return false;
    }
    if (actions.at(-1).end < dt) return false;
    const expected = dt === 0 ? [{ start: actor, end: actor, startTime: 0, endTime: 1 }]
      : actions.filter(action => action.start < dt).map(action => ({ start: action.from,
        end: positionAt(action, Math.min(action.end, dt)), startTime: action.start / dt, endTime: Math.min(action.end, dt) / dt }));
    return same(endpoint, expected.at(-1).end) && trajectory.length === expected.length
      && trajectory.every((segment, index) => same(segment.start, expected[index].start)
        && same(segment.end, expected[index].end) && segment.startTime === expected[index].startTime
        && segment.endTime === expected[index].endTime);
  } catch { return false; }
}

export function recordStressTick(state, entries, result, dt, metrics) {
  const actors = entries.map(entry => {
    const id = String(entry.character.id);
    const endpoint = result.moved.get(id);
    const trajectory = result.trajectories.get(id).map(segment => ({ ...segment,
      start: { ...segment.start }, end: { ...segment.end } }));
    const travelled = trajectory.reduce((sum, segment) => sum + Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y), 0);
    const displacement = Math.hypot(endpoint.x - entry.character.x, endpoint.y - entry.character.y);
    const verified = matchesPlan(result.coordinator.plans.get(id), entry.character, endpoint, trajectory, dt);
    return { id, start: { x: entry.character.x, y: entry.character.y }, end: { x: endpoint.x, y: endpoint.y },
      goal: entry.character.navigationGoal ?? null, speed: entry.speed, ignoredIds: [], status: { ...result.statuses.get(id) },
      trajectory, occupiedTrajectory: trajectory, occupiesEnd: true, travelled, displacement,
      executedReservedPlan: verified, executedInstalledSchedule: verified,
      withinSpeedBudget: Math.max(travelled, displacement) <= entry.speed * dt + 1e-6 };
  });
  let minimumEndpointSpacing = Infinity;
  let minimumSweptSpacing = Infinity;
  let minimumEndpointPair = null;
  let minimumSweptPair = null;
  for (let left = 0; left < actors.length; left += 1) for (const right of actors.slice(left + 1)) {
    const actor = actors[left];
    const endpoint = Math.hypot(actor.end.x - right.end.x, actor.end.y - right.end.y);
    const swept = minimumTrajectoryDistance(actor.trajectory, right.trajectory);
    if (endpoint < minimumEndpointSpacing) { minimumEndpointSpacing = endpoint; minimumEndpointPair = { leftId: actor.id, rightId: right.id, spacing: endpoint }; }
    if (swept < minimumSweptSpacing) { minimumSweptSpacing = swept; minimumSweptPair = { leftId: actor.id, rightId: right.id, spacing: swept }; }
  }
  return { dt, timeStart: (state.movementCoordinator?.tick ?? 0) * dt, timeEnd: result.coordinator.tick * dt,
    actors, expansionsThisTick: result.diagnostics.expansionsThisTick,
    // Kept for the existing profiler output schema; the replacement has no joint search groups.
    actorQuanta: [...(result.diagnostics.actorExpansions?.values() || [])],
    groupQuanta: [], groups: [], counters: nonTimingSummary(summariseMovementMetrics(metrics)),
    minimumEndpointSpacing, minimumSweptSpacing, minimumEndpointPair, minimumSweptPair,
    allMovementScheduled: actors.every(actor => !(actor.travelled > 0 || actor.displacement > 0) || actor.executedReservedPlan),
    allWithinSpeedBudget: actors.every(actor => actor.withinSpeedBudget) };
}
