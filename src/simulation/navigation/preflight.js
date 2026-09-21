import { beginRouteSearch, advanceRouteSearch, forkRouteSearch, findRoute } from './router';
import { noteNavigation } from './telemetry';

const MAX_ENTRIES = 128;
const STALE_FRAMES = 120;
let active = null;

export function runPreflightFrame(previous, run) {
  const frame = (previous?.version === 1 ? previous.frame : 0) + 1;
  const entries = new Map(previous?.version === 1 && previous.entries instanceof Map ? previous.entries : []);
  for (const [key, entry] of entries) if (frame - entry.lastFrame > STALE_FRAMES) entries.delete(key);
  const parent = active;
  active = { frame, entries };
  try {
    const value = run();
    return { value, runtime: { version: 1, frame, entries } };
  } finally {
    active = parent;
  }
}

export function queryReachability(channel, grid, start, goal, quantum) {
  noteNavigation('preflightQueries');
  if (!active) return findRoute(grid, start, goal).status;
  const key = JSON.stringify([channel, grid.signature, start?.x, start?.y, goal?.x, goal?.y]);
  let entry = active.entries.get(key);
  if (entry?.lastFrame === active.frame) {
    noteNavigation('preflightCacheHits');
    return entry.status;
  }
  if (!entry) {
    if (active.entries.size >= MAX_ENTRIES) {
      const terminal = [...active.entries].filter(([, item]) => item.status !== 'pending' && item.lastFrame < active.frame)
        .sort((a, b) => a[1].lastFrame - b[1].lastFrame || (a[0] < b[0] ? -1 : 1))[0];
      if (terminal) active.entries.delete(terminal[0]);
      else {
        noteNavigation('preflightCapacityWaits');
        return 'capacity-wait';
      }
    }
    entry = { status: 'pending', cursor: beginRouteSearch(grid, start, goal), lastFrame: active.frame - 1 };
  }
  if (entry.status !== 'pending') {
    noteNavigation('preflightCacheHits');
    active.entries.set(key, { ...entry, lastFrame: active.frame });
    return entry.status;
  }
  const cursor = forkRouteSearch(entry.cursor);
  noteNavigation('preflightAdvances');
  const result = advanceRouteSearch(cursor, Math.max(1, Math.floor(Number(quantum) || 1)));
  if (result.status === 'pending') noteNavigation('preflightPending');
  active.entries.set(key, { status: result.status,
    cursor: result.status === 'pending' ? cursor : null, lastFrame: active.frame });
  return result.status;
}
