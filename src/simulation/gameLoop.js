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
import { resolveCharacterMovementBatch } from './movement';
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
  for (const entry of customerEntries) {
    if (entry?.character?.id == null) continue;
    byId.set(entry.character.id, entry);
  }
  for (const entry of staffEntries) {
    if (entry?.character?.id == null) continue;
    const existing = byId.get(entry.character.id);
    if (!existing) {
      byId.set(entry.character.id, entry);
    } else if (entry.provenance === 'guide') {
      byId.set(entry.character.id, entry);
    }
  }
  return [...byId.values()];
}

/** Replace matching actors in both `customers` and `staff` without changing array order. */
function commitWorldCharacters(state, moved) {
  return {
    ...state,
    customers: (state.customers || []).map(character => moved.get(character.id) || character),
    staff: (state.staff || []).map(character => moved.get(character.id) || character),
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
  const moved = resolveCharacterMovementBatch(s, entries, movementDt);
  const fadingMovementIds = new Set(entries
    .filter(entry => entry.character.state === 'leaving' && entry.character.exitPhase === 'fading')
    .filter(entry => {
      const movedCharacter = moved.get(entry.character.id);
      return movedCharacter
        && (movedCharacter.x !== entry.character.x || movedCharacter.y !== entry.character.y);
    })
    .map(entry => entry.character.id));
  s = commitWorldCharacters(s, moved);
  s = resolveCustomersAfterMovement(s, movementDt, fadingMovementIds);
  s = resolveStaffAfterMovement(s, gameDt);

  s = processKitchen(s);
  s = updateAutomaticDishwashers(s);
  s = calculateRevenue(s);
  s = checkMilestones(s);

  return s;
}
