import { getAmenityCapacity } from '../data/staffAmenities';

export function getAmenityUsageSummary(amenity) {
  const capacity = getAmenityCapacity(amenity?.type);
  if (capacity <= 0 || !Array.isArray(amenity?.slots) || amenity.slots.length !== capacity) return null;
  const counts = { capacity, occupied: 0, reserved: 0, unclaimed: 0 };
  for (const [index, slot] of amenity.slots.entries()) {
    if (!slot || typeof slot !== 'object' || slot.index !== index || (slot.occupiedBy != null && slot.reservedBy != null)) return null;
    if (slot.occupiedBy != null) counts.occupied++;
    else if (slot.reservedBy != null) counts.reserved++;
    else counts.unclaimed++;
  }
  return counts;
}
