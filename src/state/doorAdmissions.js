import { getDoors } from '../simulation/world';

const positiveSequence = value => Number.isSafeInteger(value) && value > 0;
const compareIds = (left, right) => left < right ? -1 : left > right ? 1 : 0;

// Persist domain-owned FIFO order, not the coordinator's unrelated admission epoch.
export function normaliseDoorAdmissions(state) {
  const previous = state.doorAdmissions;
  if (!previous) return state;
  const doors = new Set(getDoors(state).map(door => String(door.id)));
  const actors = (state.customers || []).filter(actor => actor?.id != null
    && Number.isFinite(actor.x) && Number.isFinite(actor.y)
    && actor.state === 'leaving' && actor.exitPhase !== 'fading'
    && actor.exitDoorId != null && doors.has(String(actor.exitDoorId)));
  const ids = actors.map(actor => String(actor.id));
  const candidates = actors.filter(actor => ids.filter(id => id === String(actor.id)).length === 1)
    .map(actor => {
      const id = String(actor.id);
      const doorId = String(actor.exitDoorId);
      const prior = Object.hasOwn(previous.requests || {}, id) ? previous.requests[id] : null;
      return { id, doorId, sequence: prior?.doorId === doorId && positiveSequence(prior.sequence)
        ? prior.sequence : Infinity };
    }).sort((a, b) => a.sequence - b.sequence || compareIds(a.id, b.id));
  const maximum = Math.max(0, ...candidates.map(record => Number.isFinite(record.sequence) ? record.sequence : 0));
  const compact = maximum >= Number.MAX_SAFE_INTEGER - candidates.length
    || previous.nextSequence >= Number.MAX_SAFE_INTEGER - candidates.length;
  let nextSequence = compact ? 1 : Math.max(maximum + 1,
    positiveSequence(previous.nextSequence) ? previous.nextSequence : 1);
  const seen = new Set();
  const requests = Object.fromEntries(candidates.map(record => {
    const sequence = !compact && Number.isFinite(record.sequence) && !seen.has(record.sequence)
      ? record.sequence : nextSequence++;
    seen.add(sequence);
    return [record.id, { doorId: record.doorId, sequence }];
  }));
  return { ...state, doorAdmissions: { nextSequence, requests } };
}
