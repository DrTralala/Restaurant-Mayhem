export function getTableNumber(tableId) {
  const match = /^t(\d+)$/.exec(tableId);
  if (!match) return null;
  const number = Number(match[1]);
  return number > 0 ? number : null;
}
