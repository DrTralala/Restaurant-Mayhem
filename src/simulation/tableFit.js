export function physicalTableCapacity(table, chairs) {
  if (table?.id == null || !Number.isFinite(table.x) || !Number.isFinite(table.y)) return 0;

  const placedCount = (Array.isArray(chairs) ? chairs : []).filter(chair =>
    chair?.tableId === table.id
      && Number.isFinite(chair.x)
      && Number.isFinite(chair.y)).length;

  return Math.min(table.seats || placedCount, placedCount);
}
