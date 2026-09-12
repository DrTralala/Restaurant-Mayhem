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

/**
 * Combine customer- and staff-phase movement descriptors into one batch.
 * A genuine guided-customer staff-phase descriptor (`provenance: 'guide'`)
 * overrides the duplicate customer-phase descriptor because it carries exact
 * guide-party ignored-ID exemptions; a staff-phase stationary blocker filler
 * must never override a real customer mover.
 */
export function mergeMovementEntries(customerEntries, staffEntries) {
  const byId = new Map();
  const sourceById = new Map();
  const shouldReplace = (existing, candidate, source, existingSource) => {
    if (candidate.provenance === 'guide') {
      if (existing.provenance !== 'guide') return true;
      return source === 'staff' && existingSource !== 'staff';
    }
    return candidate.provenance !== 'guide'
      && existing.provenance !== 'guide'
      && Number(candidate.speed) > 0
      && !(Number(existing.speed) > 0);
  };
  const add = (entry, source) => {
    if (entry?.character?.id == null) return;
    const id = String(entry.character.id);
    const existing = byId.get(id);
    if (!existing || shouldReplace(existing, entry, source, sourceById.get(id))) {
      byId.set(id, entry);
      sourceById.set(id, source);
    }
  };
  for (const entry of customerEntries) {
    add(entry, 'customer');
  }
  for (const entry of staffEntries) {
    add(entry, 'staff');
  }
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
  s = resolveStaffAfterMovement(s, gameDt, batch.statuses);

  s = processKitchen(s);
  s = updateAutomaticDishwashers(s);
  s = calculateRevenue(s);
  s = checkMilestones(s);

  return s;
}
