function uniqueIds(value) {
  const ids = Array.isArray(value)
    ? value
    : value == null ? [] : [value];
  const seen = new Set();
  return ids.filter(id => {
    if (id == null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function getStaffCarryCapacity(worker) {
  const skill = Number.isFinite(worker?.skill) ? Math.floor(worker.skill) : 1;
  return skill >= 10 ? 3 : skill >= 5 ? 2 : 1;
}

export function getCarriedServiceItemIds(worker) {
  if (Array.isArray(worker?.carryingServiceItemIds)) {
    return uniqueIds(worker.carryingServiceItemIds);
  }
  return uniqueIds(worker?.carryingServiceItemId);
}

export function withCarriedServiceItemIds(worker, ids) {
  const { carryingServiceItemId: _legacyCarryingServiceItemId, ...withoutLegacy } = worker || {};
  return {
    ...withoutLegacy,
    carryingServiceItemIds: uniqueIds(ids),
  };
}
