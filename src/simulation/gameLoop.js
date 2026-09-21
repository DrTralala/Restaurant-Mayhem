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
import * as foodPatienceDomain from './foodPatience';
import * as wellbeingDomain from './staffWellbeing';
import { finitePoint, quarantineNavigation } from './navigation/occupancy';
import { allocateStaffPositions } from './navigation/staffAllocation';
import { runPreflightFrame } from './navigation/preflight';
import { navigationPhase } from './navigation/telemetry';

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

const TIME_EPSILON = 1e-9;

function getNextFoodDeadline(state, fromTime, toTime) {
  let next = Infinity;
  for (const customer of state?.customers || []) {
    const pending = customer?.foodOutcome === 'pending'
      || (customer?.foodOutcome == null
        && Number.isFinite(customer?.foodPatienceBudget)
        && customer.foodPatienceBudget > 0);
    const deadline = customer?.foodDeadlineAt;
    if (pending && Number.isFinite(deadline)
      && deadline > fromTime + TIME_EPSILON
      && deadline <= toTime + TIME_EPSILON) {
      next = Math.min(next, deadline);
    }
  }
  return Number.isFinite(next) ? next : null;
}

function nextChronologicalBoundary(state, fromTime, toTime) {
  const candidates = [
    wellbeingDomain.getNextStaffWellbeingBoundary(state, fromTime, toTime),
    getNextFoodDeadline(state, fromTime, toTime),
  ].filter(value => Number.isFinite(value) && value > fromTime + TIME_EPSILON);
  return candidates.length ? Math.min(...candidates) : toTime;
}

function prepareStaffAtTickEntry(state) {
  const staff = state.staff || [];
  if (staff.every(finitePoint)) return state;
  const allocated = allocateStaffPositions(state, staff);
  return allocated ? { ...state, staff: allocated } : quarantineNavigation(state);
}

function runTickSegment(state, fromTime, toTime, movementDt, totalGameDt, isFinalSegment) {
  const gameDt = Math.max(0, toTime - fromTime);
  let s = navigationPhase('clock', () => advanceClock(state, gameDt));
  const now = s.restaurant.gameTime;

  // Food cancellation is the first domain transition at every timestamp. The
  // customer and kitchen modules retain defensive idempotent calls, but this
  // explicit call makes the deadline ordering visible to the run loop.
  s = navigationPhase('food-patience', () => foodPatienceDomain.expireFoodPatience(s, now));
  if (isFinalSegment) s = navigationPhase('spawn', () => spawnCustomers(s, totalGameDt));
  s = navigationPhase('customers-prepare', () => prepareCustomersForMovement(s, gameDt));
  s = navigationPhase('dirt', () => updateDirt(s, gameDt));
  s = navigationPhase('consumption', () => advanceConsumption(s));
  s = navigationPhase('seating-prepare', () => prepareSelfSeating(s));
  s = navigationPhase('wellbeing-prepare', () => wellbeingDomain.advanceStaffWellbeing(s, fromTime, now));
  s = navigationPhase('staff-prepare', () => prepareStaffForMovement(s, gameDt));

  const entries = mergeMovementEntries(
    getCustomerMovementEntries(s, movementDt),
    [
      ...getStaffMovementEntries(s),
      ...wellbeingDomain.getStaffWellbeingMovementEntries(s),
    ],
  );
  const batch = navigationPhase('movement', () => advanceCharacterMovementBatch(s, entries, movementDt));
  s = {
    ...commitWorldCharacters(s, batch.moved),
    movementCoordinator: batch.coordinator,
  };
  s = navigationPhase('customers-resolve', () => resolveCustomersAfterMovement(s, movementDt, batch.statuses));
  s = navigationPhase('seating-resolve', () => resolveSelfSeating(s, batch.statuses));
  s = navigationPhase('wellbeing-resolve', () => wellbeingDomain.resolveStaffWellbeingAfterMovement(s, batch.statuses, now));
  s = navigationPhase('staff-resolve', () => resolveStaffAfterMovement(s, gameDt, batch.statuses));

  s = navigationPhase('kitchen', () => processKitchen(s));
  s = navigationPhase('dishwashers', () => updateAutomaticDishwashers(s));
  s = navigationPhase('revenue', () => calculateRevenue(s));
  s = navigationPhase('milestones', () => checkMilestones(s));

  return s;
}

function runTickInternal(state, timing) {
  const legacyDt = Number.isFinite(timing) ? timing * state.speed * 60 : null;
  const gameDt = Math.max(0, legacyDt ?? (Number(timing?.gameDt) || 0));
  const movementDt = Math.max(0, legacyDt ?? (Number(timing?.movementDt) || 0));
  const startTime = Number.isFinite(state.restaurant?.gameTime)
    ? state.restaurant.gameTime : 0;

  if (gameDt <= TIME_EPSILON) {
    return runTickSegment(state, startTime, startTime, movementDt, 0, true);
  }

  const endTime = startTime + gameDt;
  let currentState = state;
  let currentTime = startTime;
  let movedTime = 0;
  let guard = 0;

  while (currentTime < endTime - TIME_EPSILON && guard < 4096) {
    const boundary = Math.max(
      currentTime + TIME_EPSILON,
      Math.min(endTime, nextChronologicalBoundary(currentState, currentTime, endTime)),
    );
    const segmentEnd = boundary > currentTime ? boundary : endTime;
    const segmentGameDt = segmentEnd - currentTime;
    const segmentMovementDt = movementDt * (segmentGameDt / gameDt);
    movedTime += segmentMovementDt;
    currentState = runTickSegment(
      currentState,
      currentTime,
      segmentEnd,
      segmentMovementDt,
      gameDt,
      segmentEnd >= endTime - TIME_EPSILON,
    );
    currentTime = segmentEnd;
    guard += 1;
  }

  // Preserve the requested movement budget even when floating-point boundary
  // arithmetic leaves a tiny remainder.
  if (currentTime < endTime - TIME_EPSILON) {
    currentState = runTickSegment(
      currentState,
      currentTime,
      endTime,
      Math.max(0, movementDt - movedTime),
      gameDt,
      true,
    );
  }
  return currentState;
}

export function runTick(state, timing) {
  if (state.paused || state.navigationFault) return state;

  const positioned = prepareStaffAtTickEntry(state);
  if (positioned.paused || positioned.navigationFault) return positioned;

  const frame = runPreflightFrame(positioned.navigationPreflight,
    () => runTickInternal(positioned, timing));
  return { ...frame.value, navigationPreflight: frame.runtime };
}
