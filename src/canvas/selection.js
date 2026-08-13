function intersects(rect, item) {
  return item.x < rect.right
    && item.x + item.w > rect.left
    && item.y < rect.bottom
    && item.y + item.h > rect.top;
}

export function normaliseSelectionRect({ x1, y1, x2, y2 }) {
  return {
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    top: Math.min(y1, y2),
    bottom: Math.max(y1, y2),
  };
}

export function selectFurnitureInRect(state, rawRect) {
  const rect = normaliseSelectionRect(rawRect);
  const tables = (state.tables || [])
    .filter(table => intersects(rect, { ...table, w: 40, h: 40 }))
    .map(table => ({ type: 'table', id: table.id }));
  const chairs = (state.chairs || [])
    .filter(chair => intersects(rect, { ...chair, w: 20, h: 20 }))
    .map(chair => ({ type: 'chair', id: chair.id }));
  return [...tables, ...chairs];
}
