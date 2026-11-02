const PLACE_INDICES = [0, 1, 2, 3];

export function getHighTopCounterGeometry(counter) {
  const rotation = counter?.rotation ?? 0;
  if (!Number.isFinite(counter?.x) || !Number.isFinite(counter?.y)
    || !Number.isInteger(rotation) || rotation < 0 || rotation > 3) return null;
  const cell = (x, y) => {
    const point = [
      { x, y }, { x: 20 - y, y: x },
      { x: 60 - x, y: 20 - y }, { x: y, y: 60 - x },
    ][rotation];
    return { x: counter.x + point.x, y: counter.y + point.y };
  };
  const places = PLACE_INDICES.map(index => ({
    index,
    table: { ...cell(index * 20, 0), w: 20, h: 20 },
    chair: { ...cell(index * 20, 20), rotation },
  }));
  return {
    footprint: { x: counter.x, y: counter.y, w: rotation % 2 ? 40 : 80, h: rotation % 2 ? 80 : 40 },
    countertop: {
      x: Math.min(...places.map(p => p.table.x)), y: Math.min(...places.map(p => p.table.y)),
      w: rotation % 2 ? 20 : 80, h: rotation % 2 ? 80 : 20,
    },
    places,
  };
}

export function createHighTopCounterRecords(counter) {
  const geometry = getHighTopCounterGeometry(counter);
  if (!geometry || typeof counter.id !== 'string' || !counter.id) throw new Error('Invalid high top counter');
  return {
    tables: geometry.places.map(({ index, table }) => ({
      id: `${counter.id}-seat-${index}`, highTopCounterId: counter.id, counterSeatIndex: index,
      seats: 1, status: 'empty', x: table.x, y: table.y,
    })),
    chairs: geometry.places.map(({ index, chair }) => ({
      id: `${counter.id}-chair-${index}`, highTopCounterId: counter.id, counterSeatIndex: index,
      tableId: `${counter.id}-seat-${index}`, ...chair,
    })),
  };
}

// Geometry only: never overwrite reservations or recreate missing owned records.
export function repositionHighTopCounterRecords(state) {
  const geometry = new Map((state.highTopCounters || []).map(counter => [counter.id, getHighTopCounterGeometry(counter)]));
  const reposition = (records, kind) => (records || []).map(record => {
    const place = geometry.get(record.highTopCounterId)?.places[record.counterSeatIndex];
    if (!place) return record;
    const point = place[kind];
    if (record.x === point.x && record.y === point.y && (kind !== 'chair' || record.rotation === point.rotation)) return record;
    return { ...record, x: point.x, y: point.y, ...(kind === 'chair' ? { rotation: point.rotation } : {}) };
  });
  return { ...state, tables: reposition(state.tables, 'table'), chairs: reposition(state.chairs, 'chair') };
}

export function isHighTopCounterInUse(state, counterId) {
  const tables = (state.tables || []).filter(t => t.highTopCounterId === counterId);
  const chairs = (state.chairs || []).filter(c => c.highTopCounterId === counterId);
  if (tables.length !== 4 || chairs.length !== 4 || tables.some(t => t.status !== 'empty')) return true;
  const tableIds = new Set(tables.map(t => t.id));
  const chairIds = new Set(chairs.map(c => c.id));
  const references = record => tableIds.has(record?.tableId) || chairIds.has(record?.chairId);
  return (state.customers || []).some(references)
    || (state.staff || []).some(worker => references(worker.task))
    || (state.serviceItems || []).some(item => references(item) && ['delivered', 'dirty_at_table'].includes(item.state));
}
