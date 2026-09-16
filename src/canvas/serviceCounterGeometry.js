import { getPlaceableDimensions } from '../data/placeables';

// Visual anchors on the clear worktop, not the simulation's pickup coordinates.
export function getServiceCounterItemPosition(counter, slot) {
  if (!counter || !Number.isFinite(counter.x) || !Number.isFinite(counter.y)
    || !Number.isInteger(slot) || slot < 0 || slot > 3
    || (counter.rotation != null && !Number.isInteger(counter.rotation))) return null;
  const rotation = (((counter.rotation ?? 0) + 2) % 4 + 4) % 4;
  const { width, height } = getPlaceableDimensions('serviceTable', counter.rotation);
  const dx = 36 + slot * 16 - 60;
  const dy = 16 - 20;
  const [rx, ry] = [[dx, dy], [-dy, dx], [-dx, -dy], [dy, -dx]][rotation];
  return { x: counter.x + width / 2 + rx, y: counter.y + height / 2 + ry };
}
