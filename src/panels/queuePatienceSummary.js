import { normaliseCustomerQueue } from '../simulation/customerQueue';
import { getQueuePatience, getQueuePatienceMax } from '../simulation/queuePatience';
import { getQueuePatienceMultiplier } from '../simulation/balance';
import { isRestaurantOpen } from '../simulation/clock';

export function getQueuePatienceSummary(state) {
  const queue = normaliseCustomerQueue(state.queue);
  const restaurantOpen = isRestaurantOpen(state);
  const queuePatienceMultiplier = getQueuePatienceMultiplier(queue);
  return queue.filter(party => party.members.length > 0).map(party => {
    const base = { partyId: party.partyId, guestCount: party.members.length };
    const remaining = party.members.map(getQueuePatience);
    if (remaining.some(value => Number.isFinite(value) && value <= 0)) {
      return { ...base, status: 'exhausted', fraction: 0, exhaustionSeconds: restaurantOpen ? 0 : null };
    }
    if (remaining.some(value => !Number.isFinite(value))) {
      return { ...base, status: 'unknown', fraction: null, exhaustionSeconds: null };
    }
    const minimum = Math.min(...remaining);
    const maxima = party.members.filter((member, index) => remaining[index] === minimum)
      .map(getQueuePatienceMax);
    if (maxima.some(value => !Number.isFinite(value) || value <= 0)) {
      return { ...base, status: 'unknown', fraction: null, exhaustionSeconds: null };
    }
    return {
      ...base,
      status: 'known',
      fraction: Math.min(1, Math.max(0, minimum / Math.max(...maxima))),
      exhaustionSeconds: restaurantOpen ? minimum / queuePatienceMultiplier : null,
    };
  });
}
