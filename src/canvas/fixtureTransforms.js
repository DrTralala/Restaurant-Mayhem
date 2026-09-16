import { getFixture, getFixtureDescriptor, getFixtureRect } from '../data/fixtures';
import { getPlaceable } from '../data/placeables';
import { getRestaurantWorld } from '../simulation/world';
import { snapPlacement } from '../simulation/placement';
import { expandFurnitureSelection } from './selection';

export function getFixturePlacementType(fixture) {
  const descriptor = getFixtureDescriptor(fixture?.type);
  return typeof descriptor?.placementType === 'function'
    ? descriptor.placementType(fixture?.data)
    : descriptor?.placementType;
}

export function getMoveItem(state, fixture) {
  const rect = getFixtureRect(state, fixture);
  if (!rect) return null;

  const item = {
    type: fixture.type,
    id: fixture.id,
    x: rect.x,
    y: rect.y,
  };

  const placementType = getFixturePlacementType(fixture);
  if (getPlaceable(placementType)?.rotatable) {
    item.rotation = fixture.data.rotation ?? 0;
  }

  return item;
}

export function isRotatableMoveItem(state, item) {
  const fixture = getFixture(state, item?.type, item?.id);
  return Boolean(
    fixture && getPlaceable(getFixturePlacementType(fixture))?.rotatable,
  );
}

export function expandSelectedFixtures(state, selectedItems) {
  return expandFurnitureSelection(state, selectedItems)
    .map(item => getFixture(state, item.type, item.id))
    .filter(Boolean)
    .map(fixture => getMoveItem(state, fixture))
    .filter(Boolean);
}

export function buildCopyItems(state, originalItems, anchor, world) {
  const primary = originalItems[0];
  if (!primary || !anchor || !world) {
    return originalItems.map(item => ({ ...item }));
  }

  const fixture = getFixture(state, primary.type, primary.id);
  const placementType = fixture && getFixturePlacementType(fixture);
  const target = placementType
    ? snapPlacement(placementType, world, state, primary.rotation ?? 0)
    : null;

  if (!target) return originalItems.map(item => ({ ...item }));

  const deltaX = target.x - anchor.x;
  const deltaY = target.y - anchor.y;

  return originalItems.map(item => ({
    ...item,
    x: item.type === 'door'
      ? getRestaurantWorld(state.restaurant || {}).doorX
      : item.x + deltaX,
    y: item.y + deltaY,
  }));
}

function snapMoveItem(state, item) {
  const fixture = getFixture(state, item.type, item.id);
  const placementType = fixture && getFixturePlacementType(fixture);
  const placeable = getPlaceable(placementType);
  if (!placeable) return item;

  return {
    ...item,
    x: item.type === 'door'
      ? getRestaurantWorld(state.restaurant || {}).doorX
      : Math.round(item.x / placeable.grid) * placeable.grid,
    y: Math.round(item.y / placeable.grid) * placeable.grid,
  };
}

export function buildMoveItems(state, originalItems, anchor, world) {
  const deltaX = world.x - anchor.x;
  const deltaY = world.y - anchor.y;

  const snappedItems = originalItems.map(item => snapMoveItem(state, {
    ...item,
    x: item.x + deltaX,
    y: item.y + deltaY,
  }));

  const tableDeltas = new Map();
  originalItems.forEach((item, index) => {
    if (item.type !== 'table') return;
    const snapped = snappedItems[index];
    tableDeltas.set(item.id, {
      x: snapped.x - item.x,
      y: snapped.y - item.y,
    });
  });

  return snappedItems.map((item, index) => {
    if (item.type !== 'chair') return item;

    const original = originalItems[index];
    const chair = getFixture(state, 'chair', original.id)?.data;
    const tableDelta = tableDeltas.get(chair?.tableId);
    if (!tableDelta) return item;

    return {
      ...item,
      x: original.x + tableDelta.x,
      y: original.y + tableDelta.y,
    };
  });
}
