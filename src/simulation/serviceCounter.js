// Single source of truth for how many service items a counter can hold.
// Simulation allocation, the canvas renderer and save validation all agree on
// this eight-slot contract.
export const SERVICE_COUNTER_CAPACITY = 8;

const COUNTER_WIDTH = 120;

// Local simulation centres on the unrotated 120x40 worktop: four columns and
// two compact rows. Orientations reuse the legacy directional anchors so old
// slot IDs keep their meaning, and the physical position is shared with
// cancellation waste origins to prevent drift.
export function getServiceSlotPosition(serviceTable, serviceSlotIndex) {
  if (!serviceTable || !Number.isInteger(serviceSlotIndex)
    || serviceSlotIndex < 0 || serviceSlotIndex >= SERVICE_COUNTER_CAPACITY) return null;
  const rotation = Number.isInteger(serviceTable.rotation)
    ? ((serviceTable.rotation % 4) + 4) % 4
    : 0;
  const localX = 15 + (serviceSlotIndex % 4) * 30;
  const localY = 10 + Math.floor(serviceSlotIndex / 4) * 20;
  if (rotation === 1) return { x: serviceTable.x + localY, y: serviceTable.y + localX };
  if (rotation === 2) {
    return { x: serviceTable.x + COUNTER_WIDTH - localX, y: serviceTable.y + localY };
  }
  if (rotation === 3) {
    return { x: serviceTable.x + localY, y: serviceTable.y + COUNTER_WIDTH - localX };
  }
  return { x: serviceTable.x + localX, y: serviceTable.y + localY };
}
