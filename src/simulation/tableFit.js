export function physicalTableCapacity(table, chairs) {
  if (table?.id == null || !Number.isFinite(table.x) || !Number.isFinite(table.y)) return 0;

  const placedCount = (Array.isArray(chairs) ? chairs : []).filter(chair =>
    chair?.tableId === table.id
      && Number.isFinite(chair.x)
      && Number.isFinite(chair.y)).length;

  return Math.min(table.seats || placedCount, placedCount);
}

export function getPartySizeFit(state, size) {
  if (!Number.isSafeInteger(size) || size < 1) return 'no-fit';

  const tables = Array.isArray(state?.tables) ? state.tables : [];
  const chairs = Array.isArray(state?.chairs) ? state.chairs : [];
  let hasPhysicalFit = false;

  for (const table of tables) {
    if (physicalTableCapacity(table, chairs) < size) continue;

    hasPhysicalFit = true;
    const minimum = Number.isSafeInteger(table?.minPartySize) && table.minPartySize >= 2
      ? table.minPartySize
      : 1;
    if (size >= minimum) return 'allowed';
  }

  return hasPhysicalFit ? 'below-minimum' : 'no-fit';
}
