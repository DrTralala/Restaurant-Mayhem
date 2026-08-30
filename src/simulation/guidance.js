export function taskCustomerIds(task) {
  return task?.customerIds || (task?.customerId ? [task.customerId] : []);
}

function isGuidedPartyMember(customer, guide, partyIds) {
  return customer?.state === 'guided'
    && customer.guideStaffId === guide.id
    && partyIds.includes(customer.id);
}

export function getGuidePartyContext(state, guide) {
  if (!guide || guide.task?.type !== 'guide_customer') return null;
  const partyIds = taskCustomerIds(guide.task);
  const customersById = new Map((state.customers || []).map(customer => [customer.id, customer]));
  const genuinePartyIds = partyIds.filter(id => isGuidedPartyMember(customersById.get(id), guide, partyIds));
  return {
    guide,
    task: guide.task,
    partyIds,
    genuinePartyIds,
    ignoredIds: [guide.id, ...genuinePartyIds],
  };
}

export function getCustomerGuideContext(state, customer) {
  if (customer?.state !== 'guided' || customer.guideStaffId == null) return null;
  const guide = (state.staff || []).find(candidate => candidate.id === customer.guideStaffId);
  const context = getGuidePartyContext(state, guide);
  return context?.genuinePartyIds.includes(customer.id) ? context : null;
}
