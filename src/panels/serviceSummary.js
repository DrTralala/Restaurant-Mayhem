import { normaliseCustomerQueue } from '../simulation/customerQueue';

export function getServiceSummary(state) {
  const parties = normaliseCustomerQueue(state.queue).filter(party => party.members.length > 0);
  const pending = { ordered: 0, preparing: 0, ready: 0, on_service: 0, carried: 0 };
  const owners = new Map((state.customers || [])
    .filter(customer => customer.id != null)
    .map(customer => [String(customer.id), customer]));
  for (const item of state.serviceItems || []) {
    if (!['dish', 'drink'].includes(item.kind) || !Object.hasOwn(pending, item.state)) continue;
    const owner = item.customerId == null ? null : owners.get(String(item.customerId));
    if (!owner || owner.state === 'leaving' || item.foodCancelled === true
      || item.deliveryProhibited === true
      || (owner.cancelledServiceItemIds || []).some(id => String(id) === String(item.id))
      || (item.kind === 'dish' && owner.foodOutcome === 'cancelled')) continue;
    pending[item.state] += 1;
  }
  return {
    queueParties: parties.length,
    queueGuests: parties.reduce((sum, party) => sum + party.members.length, 0),
    pending,
  };
}
