const TABLE_SIZE = 40;

export function getChairFacingRadians(rotation) {
  return [0, Math.PI / 2, Math.PI, -Math.PI / 2][rotation] ?? 0;
}

export function getPlaceSettingPositions(table, chair, kinds) {
  if (![table?.x, table?.y, chair?.x, chair?.y].every(Number.isFinite)) return {};
  const chairCentre = { x: chair.x + 10, y: chair.y + 10 };
  const centre = { x: table.x + 20, y: table.y + 20 };
  const dx = centre.x - chairCentre.x;
  const dy = centre.y - chairCentre.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const candidates = [];
  if (chairCentre.x < table.x && ux > 0) candidates.push((table.x - chairCentre.x) / ux);
  if (chairCentre.x > table.x + TABLE_SIZE && ux < 0) candidates.push((table.x + TABLE_SIZE - chairCentre.x) / ux);
  if (chairCentre.y < table.y && uy > 0) candidates.push((table.y - chairCentre.y) / uy);
  if (chairCentre.y > table.y + TABLE_SIZE && uy < 0) candidates.push((table.y + TABLE_SIZE - chairCentre.y) / uy);
  const validCandidates = candidates.filter(value => Number.isFinite(value) && value >= 0);
  if (!validCandidates.length) return {};
  const distanceToEdge = Math.min(...validCandidates);
  const anchor = { x: chairCentre.x + ux * distanceToEdge, y: chairCentre.y + uy * distanceToEdge };
  if (![anchor.x, anchor.y].every(Number.isFinite)) return {};
  const requested = Array.isArray(kinds) ? kinds : [];
  const result = {};
  const hasPair = requested.includes('dish') && requested.includes('drink');
  const left = { x: uy, y: -ux };
  for (const kind of requested) {
    const side = hasPair ? (kind === 'dish' ? 1 : kind === 'drink' ? -1 : 0) : 0;
    result[kind] = { x: anchor.x + left.x * 6 * side, y: anchor.y + left.y * 6 * side };
  }
  return result;
}
