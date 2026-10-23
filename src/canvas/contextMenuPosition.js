const OFFSET = 8;

function clampAxis(anchor, bounds, size) {
  const requested = (Number.isFinite(anchor) ? anchor : 0) + OFFSET;
  const measurable = Number.isFinite(bounds) && bounds >= 0
    && Number.isFinite(size) && size >= 0;
  const maximum = measurable ? Math.max(0, bounds - size) : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(requested, maximum));
}

export function getContextMenuPosition(anchor, bounds, size) {
  return {
    x: clampAxis(anchor?.x, bounds?.width, size?.width),
    y: clampAxis(anchor?.y, bounds?.height, size?.height),
  };
}
