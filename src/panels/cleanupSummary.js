const keys = {
  dirty_at_table: 'dirtyAtTable',
  carried_dirty: 'carriedDirty',
  queued_for_wash: 'queuedForWash',
  washing: 'washing',
};

export function getCleanupSummary(state) {
  const summary = {
    dirtyTables: 0,
    dirtyAtTable: 0,
    carriedDirty: 0,
    queuedForWash: 0,
    washing: 0,
  };
  const tables = Array.isArray(state?.tables) ? state.tables : [];
  const serviceItems = Array.isArray(state?.serviceItems) ? state.serviceItems : [];

  summary.dirtyTables = tables.filter(table => table?.status === 'dirty').length;

  for (const item of serviceItems) {
    if (item == null || typeof item !== 'object') continue;
    if (item.kind !== 'dish' && item.kind !== 'drink') continue;
    if (!Object.hasOwn(keys, item.state)) continue;
    summary[keys[item.state]] += 1;
  }

  return summary;
}
