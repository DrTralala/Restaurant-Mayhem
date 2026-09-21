import { getQueueVisibleMembers } from '../customerQueue';

export const CHARACTER_CLEARANCE = 16;

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

/** Optional movement must not claim another actor's destination or resting place. */
export function canClaimDestination(state, actor, point) {
  if (!finitePoint(point)) return false;
  const peers = [...(state.staff || []), ...(state.customers || []),
    ...getQueueVisibleMembers(state, state.queue || [])];
  return peers.every(peer => {
    if (String(peer.id ?? peer.memberId) === String(actor.id)) return true;
    const destination = finitePoint(peer.navigationGoal) ? peer.navigationGoal : peer;
    return !finitePoint(destination)
      || Math.hypot(destination.x - point.x, destination.y - point.y) >= CHARACTER_CLEARANCE;
  });
}
