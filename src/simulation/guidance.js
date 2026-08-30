export function taskCustomerIds(task) {
  return task?.customerIds || (task?.customerId ? [task.customerId] : []);
}

export function reserveTableForGuide(table, guideStaffId) {
  return { ...table, status: 'reserved', reservationOwnerStaffId: guideStaffId };
}

export function releaseTableReservation(table, status) {
  const { reservationOwnerStaffId: _reservationOwnerStaffId, ...released } = table;
  return { ...released, status };
}

export function normaliseTableReservationOwners(tables, staff) {
  const guideIdsByTable = new Map();
  for (const guide of staff || []) {
    if (guide.id == null || guide.task?.type !== 'guide_customer' || guide.task.tableId == null) continue;
    const guideIds = guideIdsByTable.get(guide.task.tableId) || [];
    guideIds.push(guide.id);
    guideIdsByTable.set(guide.task.tableId, guideIds);
  }

  return (tables || []).map(table => {
    if (table.status !== 'reserved') {
      return Object.hasOwn(table, 'reservationOwnerStaffId')
        ? releaseTableReservation(table, table.status)
        : table;
    }
    if (table.reservationOwnerStaffId != null) return table;
    const guideIds = guideIdsByTable.get(table.id) || [];
    return guideIds.length === 1 ? reserveTableForGuide(table, guideIds[0]) : table;
  });
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
