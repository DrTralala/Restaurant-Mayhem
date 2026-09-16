export function getNextNumericIds(items, prefix, count) {
  const idPrefix = String(prefix ?? '');
  if (!Number.isSafeInteger(count) || count < 0) return [];

  const used = new Set();
  let highest = 0n;

  for (const item of Array.isArray(items) ? items : []) {
    if (item?.id == null) continue;
    const id = String(item.id);
    used.add(id);
    if (!id.startsWith(idPrefix)) continue;

    const suffix = id.slice(idPrefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const numericSuffix = BigInt(suffix);
    if (numericSuffix > highest) highest = numericSuffix;
  }

  const ids = [];
  let suffix = highest + 1n;
  while (ids.length < count) {
    const id = `${idPrefix}${suffix}`;
    suffix += 1n;
    if (used.has(id)) continue;
    used.add(id);
    ids.push(id);
  }

  return ids;
}

export function getNextNumericId(items, prefix) {
  return getNextNumericIds(items, prefix, 1)[0];
}
