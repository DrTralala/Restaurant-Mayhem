import { ACTIVITY_DURATIONS } from './activity';
import { getCarriedServiceItemIds } from './staffInventory';

const DIRTY_STATES = new Set(['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing']);
const WASH_STATION_CAPACITY = Object.freeze({ manual: 8, automatic: 12 });

export function getWashStationCapacity(station) {
  return WASH_STATION_CAPACITY[station?.type] ?? 0;
}

export function getWashStationOccupancy(state, station, {
  excludeServiceItemId = null,
  excludeServiceItemIds = [],
} = {}) {
  if (!station?.id) return 0;
  const excludedIds = new Set(excludeServiceItemIds);
  if (excludeServiceItemId != null) excludedIds.add(excludeServiceItemId);
  const ids = new Set((state.serviceItems || [])
    .filter(item => !excludedIds.has(item.id)
      && item.washStationId === station.id
      && ['queued_for_wash', 'washing', 'carried_dirty'].includes(item.state))
    .map(item => item.id));
  for (const worker of state.staff || []) {
    if (worker.task?.type === 'deliver_dirty_item'
      && worker.task.washStationId === station.id) {
      if (worker.task.serviceItemId != null && !excludedIds.has(worker.task.serviceItemId)) {
        ids.add(worker.task.serviceItemId);
      }
      for (const itemId of getCarriedServiceItemIds(worker)) {
        const item = (state.serviceItems || []).find(candidate => candidate.id === itemId);
        if (item?.state === 'carried_dirty' && !excludedIds.has(itemId)) ids.add(itemId);
      }
    }
  }
  return ids.size;
}

export function hasWashStationCapacity(state, station, options) {
  return getWashStationOccupancy(state, station, options) < getWashStationCapacity(station);
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
    if (unassigned && hasWashStationCapacity({ ...state, serviceItems }, station)) {
      const unassignedIndex = serviceItems.indexOf(unassigned);
      serviceItems = serviceItems.map((item, index) => index === unassignedIndex
        ? { ...item, washStationId: station.id, state: 'washing', washStartedAt: now }
        : item);
    }
  }
  return { ...state, serviceItems };
}

export { DIRTY_STATES };
