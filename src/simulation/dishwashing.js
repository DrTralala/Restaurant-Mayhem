import { ACTIVITY_DURATIONS } from './activity';

const DIRTY_STATES = new Set(['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing']);

export function markCustomerItemsDirty(serviceItems, customerId, gameTime) {
  return (serviceItems || []).map(item => item.customerId === customerId && item.state === 'delivered'
    ? {
      ...item,
      state: 'dirty_at_table',
      dirtyAt: gameTime,
      washStationId: null,
      washQueuedAt: null,
      washStartedAt: null,
    }
    : item);
}

export function releaseClearedTables(tables, customers, serviceItems) {
  return (tables || []).map(table => {
    const occupied = (customers || []).some(customer => customer.tableId === table.id
      && customer.state !== 'leaving' && customer.state !== 'paying');
    const dirty = (serviceItems || []).some(item => item.tableId === table.id
      && item.state === 'dirty_at_table');
    return !occupied && !dirty && table.status === 'dirty'
      ? { ...table, status: 'empty' }
      : table;
  });
}

export function updateAutomaticDishwashers(state) {
  const now = state.restaurant?.gameTime;
  let serviceItems = [...(state.serviceItems || [])];
  for (const station of (state.washStations || []).filter(candidate => candidate.type === 'automatic')) {
    const washing = serviceItems.find(item => item.state === 'washing' && item.washStationId === station.id);
    if (washing) {
      if (Number.isFinite(now) && Number.isFinite(washing.washStartedAt)
        && now - washing.washStartedAt >= ACTIVITY_DURATIONS.automaticWash) {
        const index = serviceItems.indexOf(washing);
        serviceItems = serviceItems.filter((_item, candidateIndex) => candidateIndex !== index);
      }
      continue;
    }
    const queued = serviceItems
      .filter(item => item.state === 'queued_for_wash' && item.washStationId === station.id)
      .sort((a, b) => (a.washQueuedAt ?? 0) - (b.washQueuedAt ?? 0)
        || String(a.id).localeCompare(String(b.id)))[0];
    if (queued) {
      const queuedIndex = serviceItems.indexOf(queued);
      serviceItems = serviceItems.map((item, index) => index === queuedIndex
        ? { ...item, state: 'washing', washStartedAt: now }
        : item);
      continue;
    }
    const unassigned = serviceItems
      .filter(item => item.state === 'queued_for_wash' && item.washStationId == null)
      .sort((a, b) => (a.washQueuedAt ?? 0) - (b.washQueuedAt ?? 0)
        || String(a.id).localeCompare(String(b.id)))[0];
    if (unassigned) {
      const unassignedIndex = serviceItems.indexOf(unassigned);
      serviceItems = serviceItems.map((item, index) => index === unassignedIndex
        ? { ...item, washStationId: station.id, state: 'washing', washStartedAt: now }
        : item);
    }
  }
  return { ...state, serviceItems };
}

export { DIRTY_STATES };
