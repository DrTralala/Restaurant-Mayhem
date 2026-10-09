function recordsFor(state, collection) {
  return Array.isArray(state?.[collection]) ? state[collection] : [];
}

function isNaNKey(key) {
  return typeof key === 'number' && Number.isNaN(key);
}

function addFirst(map, key, value) {
  if (isNaNKey(key) || map.has(key)) return;
  map.set(key, value);
}

function addToGroup(map, key, value) {
  if (isNaNKey(key)) return;
  const group = map.get(key);
  if (group) group.push(value);
  else map.set(key, [value]);
}

function createIdMap(records) {
  const byId = new Map();
  for (const record of records) addFirst(byId, record?.id, record);
  return byId;
}

function createAmenitiesByStringId(records) {
  const byId = new Map();
  for (const record of records) addFirst(byId, String(record?.id), record);
  return byId;
}

function createActorsByStringId(state) {
  const byId = new Map();
  for (const collection of ['staff', 'customers']) {
    for (const actor of recordsFor(state, collection)) {
      addFirst(byId, String(actor?.id), actor);
    }
  }
  return byId;
}

function createChairsByIdAndTableId(records) {
  const byIdAndTableId = new Map();
  for (const chair of records) {
    const chairId = chair?.id;
    const tableId = chair?.tableId;
    if (isNaNKey(chairId) || isNaNKey(tableId)) continue;
    let byTableId = byIdAndTableId.get(chairId);
    if (!byTableId) {
      byTableId = new Map();
      byIdAndTableId.set(chairId, byTableId);
    }
    addFirst(byTableId, tableId, chair);
  }
  return byIdAndTableId;
}

export function createRenderIndexes(state) {
  const tablesById = createIdMap(recordsFor(state, 'tables'));
  const customersById = createIdMap(recordsFor(state, 'customers'));
  const serviceTablesById = createIdMap(recordsFor(state, 'serviceTables'));
  const equipmentById = createIdMap(recordsFor(state, 'equipment'));
  const kitchenStationsById = createIdMap(recordsFor(state, 'kitchenStations'));
  const dishesById = createIdMap(recordsFor(state, 'dishes'));
  const staffAmenitiesByStringId = createAmenitiesByStringId(recordsFor(state, 'staffAmenities'));
  const chairsByIdAndTableId = createChairsByIdAndTableId(recordsFor(state, 'chairs'));

  const kitchenStationIds = new Set();
  for (const station of recordsFor(state, 'kitchenStations')) {
    if (!isNaNKey(station?.id)) kitchenStationIds.add(station?.id);
  }

  const serviceItemsById = new Map();
  const serviceItemsByWashStationId = new Map();
  const serviceItemsByStationId = new Map();
  const serviceItemsByCustomerId = new Map();
  const deliveredKindsByCustomerId = new Map();
  const deliveredKindsSeenByCustomerId = new Map();
  const foodKitchenStationIds = new Set();
  for (const item of recordsFor(state, 'serviceItems')) {
    addFirst(serviceItemsById, item?.id, item);
    addToGroup(serviceItemsByWashStationId, item?.washStationId, item);
    addToGroup(serviceItemsByStationId, item?.stationId, item);
    addToGroup(serviceItemsByCustomerId, item?.customerId, item);

    if (['delivered', 'dirty_at_table'].includes(item?.state)) {
      const customerId = item?.customerId;
      if (!isNaNKey(customerId)) {
        let kinds = deliveredKindsByCustomerId.get(customerId);
        if (!kinds) {
          kinds = [];
          deliveredKindsByCustomerId.set(customerId, kinds);
          deliveredKindsSeenByCustomerId.set(customerId, new Set());
        }
        const seenKinds = deliveredKindsSeenByCustomerId.get(customerId);
        if (!seenKinds.has(item?.kind)) {
          seenKinds.add(item?.kind);
          kinds.push(item?.kind);
        }
      }
    }

    if (item?.kind === 'dish'
      && ['preparing', 'ready'].includes(item?.state)
      && kitchenStationIds.has(item?.stationId)) {
      foodKitchenStationIds.add(item?.stationId);
    }
  }

  return {
    tablesById,
    customersById,
    serviceTablesById,
    equipmentById,
    kitchenStationsById,
    dishesById,
    serviceItemsById,
    chairsByIdAndTableId,
    staffAmenitiesByStringId,
    serviceItemsByWashStationId,
    serviceItemsByStationId,
    serviceItemsByCustomerId,
    deliveredKindsByCustomerId,
    kitchenStationIds,
    foodKitchenStationIds,
    actorsByStringId: createActorsByStringId(state),
  };
}
