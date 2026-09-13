import { getFixtureRect, listFixtures } from '../data/fixtures';

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
  return listFixtures(state)
    .filter(fixture => {
      const fixtureRect = getFixtureRect(state, fixture);
      return fixtureRect && intersects(rect, fixtureRect);
    })
    .map(fixture => ({ type: fixture.type, id: fixture.id }));
}

export function expandFurnitureSelection(state, selectedItems = []) {
  if (!Array.isArray(selectedItems)) return [];
  const selected = new Set(selectedItems.map(item => `${item?.type}:${item?.id}`));
  for (const item of selectedItems) {
    if (item?.type !== 'table') continue;
    for (const chair of state?.chairs || []) {
      if (chair?.tableId === item.id) selected.add(`chair:${chair.id}`);
    }
  }

  return listFixtures(state)
    .filter(fixture => selected.has(`${fixture.type}:${fixture.id}`))
    .map(fixture => ({ type: fixture.type, id: fixture.id }));
}
