export function getDiningTableRect(table) {
  if (!Number.isFinite(table?.x) || !Number.isFinite(table?.y)) return null;
  const size = table.highTopCounterId != null ? 20 : 40;
  return { x: table.x, y: table.y, w: size, h: size };
}

export function getDiningTableCentre(table) {
  const rect = getDiningTableRect(table);
  return rect ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : null;
}

// Closely packed counter chairs need centre-line access, not a grid corner
// within the collision radius of the diner in the neighbouring chair.
export function getDiningChairAccessPoint(chair, latticePoint) {
  const offset = chair?.highTopCounterId != null ? 10 : 0;
  return { x: latticePoint.x + offset, y: latticePoint.y + offset };
}
