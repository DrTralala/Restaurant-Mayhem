import { normaliseCustomerQueue } from '../simulation/customerQueue';
import { getQueuePatience, getQueuePatienceMax } from '../simulation/queuePatience';

export function getQueuePatienceSummary(state) {
  return normaliseCustomerQueue(state.queue).filter(party => party.members.length > 0).map(party => {
    const base = { partyId: party.partyId, guestCount: party.members.length };
    const remaining = party.members.map(getQueuePatience);
    if (remaining.some(value => Number.isFinite(value) && value <= 0)) {
      return { ...base, status: 'exhausted', fraction: 0 };
    }
    if (remaining.some(value => !Number.isFinite(value))) {
      return { ...base, status: 'unknown', fraction: null };
    }
    const minimum = Math.min(...remaining);
    const maxima = party.members.filter((member, index) => remaining[index] === minimum)
      .map(getQueuePatienceMax);
    if (maxima.some(value => !Number.isFinite(value) || value <= 0)) {
      return { ...base, status: 'unknown', fraction: null };
    }
    return { ...base, status: 'known', fraction: Math.min(1, Math.max(0, minimum / Math.max(...maxima))) };
  });
}
