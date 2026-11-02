import { getDiningTableCentre } from '../data/diningGeometry';

export function getTableLocatePoint(tables, id) {
  const validId = (typeof id === 'string' && id.trim().length > 0)
    || (Number.isSafeInteger(id) && id >= 0);
  if (!validId || !Array.isArray(tables)) return null;
  const matches = tables.filter(table => table?.id != null && String(table.id) === String(id));
  if (matches.length !== 1) return null;
  const table = matches[0];
  if (!Number.isFinite(table.x) || !Number.isFinite(table.y)) return null;
  return getDiningTableCentre(table);
}
