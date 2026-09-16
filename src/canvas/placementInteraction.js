import { getPlaceable } from '../data/placeables';
import { validatePlacement } from '../simulation/placement';
import { humaniseIdentifier } from '../typography';

export function buildPlacement(state, request, point, rotation = 0) {
  const placementRequest = typeof request === 'string'
    ? { itemType: request }
    : request;

  const candidate = {
    ...placementRequest,
    x: point.x,
    y: point.y,
    rotation,
  };

  return { ...candidate, ...validatePlacement(state, candidate) };
}

export function samePlacement(first, second) {
  return first?.itemType === second?.itemType
    && first?.equipmentId === second?.equipmentId
    && first?.x === second?.x
    && first?.y === second?.y
    && first?.rotation === second?.rotation
    && first?.valid === second?.valid
    && first?.reason === second?.reason
    && first?.tableId === second?.tableId;
}

export function getPlacementLabel(state, placement) {
  const itemType = placement?.itemType;
  if (itemType === 'equipmentStation') {
    const equipment = (state.equipment || []).find(
      candidate => candidate.id === placement.equipmentId,
    );
    if (equipment?.name) return equipment.name;
  }

  return getPlaceable(itemType)?.label || humaniseIdentifier(itemType);
}
