import { advanceClock } from './clock';
import {
  admitScheduledServiceParty,
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
import { advanceServiceContractArrivals, getNextServiceContractBoundary, settleServiceContracts } from './serviceContracts';
import { evaluateCareerRun, isCareerDecisionPending } from './careerRun';

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
  const contractBoundary = getNextServiceContractBoundary(state, fromTime, toTime);
  if (contractBoundary !== null) candidates.push(contractBoundary);
  return candidates.length ? Math.min(...candidates) : toTime;
}

function prepareStaffAtTickEntry(state) {
  const staff = state.staff || [];
  if (staff.every(finitePoint)) return state;
  const allocated = allocateStaffPositions(state, staff);
  return allocated ? { ...state, staff: allocated } : quarantineNavigation(state);
}

function tickStopped(state) {
  return state.paused || state.navigationFault || isCareerDecisionPending(state);
}

function evaluateCareer(state) {
  const careerRun = evaluateCareerRun(state.careerRun, state.restaurant);
  return careerRun === state.careerRun ? state : { ...state, careerRun };
}

function repairContractEntry(state) {
  const now = state.restaurant.gameTime;
  let next = state;
  if (next.serviceContracts?.active && now >= next.serviceContracts.active.deadlineAt) {
    next = settleServiceContracts(next, now, { entry: true });
  }
  if (next.serviceContracts?.active?.parties.some(party => party.status === 'scheduled' && party.arrivalAt <= now)) {
    next = foodPatienceDomain.expireFoodPatience(next, now);
    next = advanceServiceContractArrivals(next, now, { admitParty: admitScheduledServiceParty });
  }
  return next;
}

function runTickSegment(state, fromTime, toTime, movementDt, totalGameDt, isFinalSegment) {
  const gameDt = Math.max(0, toTime - fromTime);
  let s = navigationPhase('clock', () => advanceClock(state, gameDt));
  const now = s.restaurant.gameTime;
  const careerTerminal = s.careerRun?.status === 'active' && now >= s.careerRun.deadlineAt;

  // Food cancellation is the first domain transition at every timestamp. The
  // customer and kitchen modules retain defensive idempotent calls, but this
  // explicit call makes the deadline ordering visible to the run loop.
  s = navigationPhase('food-patience', () => foodPatienceDomain.expireFoodPatience(s, now));
  if (!careerTerminal) {
    s = navigationPhase('contract-arrivals', () => advanceServiceContractArrivals(s, now, { admitParty: admitScheduledServiceParty }));
    if (isFinalSegment) s = navigationPhase('spawn', () => spawnCustomers(s, totalGameDt));
  }
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
  s = navigationPhase('contract-settlement', () => settleServiceContracts(s, now));
  s = navigationPhase('milestones', () => checkMilestones(s));
  s = navigationPhase('career-evaluation', () => evaluateCareer(s));

  return s;
}

function runTickInternal(state, timing) {
  const legacyDt = Number.isFinite(timing) ? timing * state.speed * 60 : null;
  const requestedGameDt = Math.max(0, legacyDt ?? (Number(timing?.gameDt) || 0));
  const requestedMovementDt = Math.max(0, legacyDt ?? (Number(timing?.movementDt) || 0));
  const startTime = Number.isFinite(state.restaurant?.gameTime)
    ? state.restaurant.gameTime : 0;
  const gameDt = state.careerRun?.status === 'active'
    ? Math.min(requestedGameDt, Math.max(0, state.careerRun.deadlineAt - startTime)) : requestedGameDt;
  const movementDt = requestedGameDt > 0
    ? requestedMovementDt * (gameDt / requestedGameDt) : requestedMovementDt;
  // Keep legacy sandbox tolerances, but never skip a representable contract
  // boundary or leave an active career stranded just short of its deadline.
  const timeEpsilon = state.serviceContracts?.active || state.careerRun?.status === 'active' ? 0 : TIME_EPSILON;
  let currentState = repairContractEntry(state);

  if (gameDt <= timeEpsilon) {
    return runTickSegment(currentState, startTime, startTime, movementDt, 0, true);
  }

  const endTime = startTime + gameDt;
  let currentTime = startTime;
  let movedTime = 0;
  let guard = 0;

  while (currentTime < endTime - timeEpsilon && guard < 4096) {
    const boundary = Math.max(
      currentTime + timeEpsilon,
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
      segmentEnd >= endTime - timeEpsilon,
    );
    currentTime = segmentEnd;
    guard += 1;
    if (tickStopped(currentState)) return currentState;
  }

  // Preserve the requested movement budget even when floating-point boundary
  // arithmetic leaves a tiny remainder.
  if (currentTime < endTime - timeEpsilon) {
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
  if (tickStopped(state)) return state;

  // A loaded career at cutoff finalises only already-recorded facts. Overdue
  // career data becomes a non-scoring decision before any contract entry repair.
  if (state.careerRun?.status === 'active' && state.restaurant.gameTime >= state.careerRun.deadlineAt) {
    if (state.restaurant.gameTime > state.careerRun.deadlineAt) return evaluateCareer(state);
    let next = calculateRevenue(state);
    if (next.serviceContracts?.active && next.restaurant.gameTime >= next.serviceContracts.active.deadlineAt) {
      next = settleServiceContracts(next, next.restaurant.gameTime, { entry: true });
    }
    return evaluateCareer(next);
  }

  const positioned = prepareStaffAtTickEntry(state);
  if (tickStopped(positioned)) return positioned;

  const frame = runPreflightFrame(positioned.navigationPreflight,
    () => runTickInternal(positioned, timing));
  return { ...frame.value, navigationPreflight: frame.runtime };
}
