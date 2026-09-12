import { advanceClock } from './clock';
import {
  getCustomerMovementEntries,
  prepareCustomersForMovement,
  resolveCustomersAfterMovement,
  spawnCustomers,
} from './customers';
import {
  getStaffMovementEntries,
  prepareStaffForMovement,
  resolveStaffAfterMovement,
} from './staff';
import { advanceCharacterMovementBatch } from './movement';
import { updateDirt } from './dirt';
import { processKitchen } from './kitchen';
import { updateAutomaticDishwashers } from './dishwashing';
import { calculateRevenue } from './revenue';
import { checkMilestones } from './milestones';
import { advanceConsumption } from './consumption';
import { prepareSelfSeating, resolveSelfSeating } from './selfSeating';

/**
 * Combine customer- and staff-phase movement descriptors into one batch. A
 * duplicate id keeps the moving descriptor over a stationary filler; no
 * guide/ignored-ID override remains after guide removal.
 */
export function mergeMovementEntries(customerEntries, staffEntries) {
  const byId = new Map();
  const add = entry => {
    if (entry?.character?.id == null) return;
    const id = String(entry.character.id);
    const existing = byId.get(id);
    if (!existing || (Number(entry.speed) > 0 && !(Number(existing.speed) > 0))) {
      byId.set(id, entry);
    }
  };
  for (const entry of customerEntries) add(entry);
  for (const entry of staffEntries) add(entry);
  return [...byId.values()];
}

/** Replace matching actors in both `customers` and `staff` without changing array order. */
function commitWorldCharacters(state, moved) {
  const movedFor = id => moved.get(id) || moved.get(String(id));
  return {
    ...state,
    customers: (state.customers || []).map(character => movedFor(character.id) || character),
    staff: (state.staff || []).map(character => movedFor(character.id) || character),
  };
}

export function runTick(state, timing) {
  if (state.paused) return state;

  const legacyDt = Number.isFinite(timing) ? timing * state.speed * 60 : null;
  const gameDt = Math.max(0, legacyDt ?? (Number(timing?.gameDt) || 0));
  const movementDt = Math.max(0, legacyDt ?? (Number(timing?.movementDt) || 0));

  let s = advanceClock(state, gameDt);
  s = spawnCustomers(s, gameDt);
  s = prepareCustomersForMovement(s, gameDt);
  s = updateDirt(s, gameDt);
  s = advanceConsumption(s);
  s = prepareSelfSeating(s);
  s = prepareStaffForMovement(s, gameDt);

  const entries = mergeMovementEntries(
    getCustomerMovementEntries(s, movementDt),
    getStaffMovementEntries(s),
  );
  const batch = advanceCharacterMovementBatch(s, entries, movementDt);
  s = {
    ...commitWorldCharacters(s, batch.moved),
    movementCoordinator: batch.coordinator,
  };
  s = resolveCustomersAfterMovement(s, movementDt, batch.statuses);
  s = resolveSelfSeating(s, batch.statuses);
  s = resolveStaffAfterMovement(s, gameDt, batch.statuses);

  s = processKitchen(s);
  s = updateAutomaticDishwashers(s);
  s = calculateRevenue(s);
  s = checkMilestones(s);

  return s;
}
