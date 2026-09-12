import { getQueueProjectedMembers } from './customerQueue.js';
import { advanceCharacterMovementBatch } from './movement';
import { createMovementMetrics, summariseMovementMetrics } from './movementMetrics';
import { nonTimingSummary, recordStressTick } from './navigation/stressDiagnostics';
import { getQueueAdmissionGateStatus } from './queueAdmission.js';
import {
  getStaffMovementEntries,
  prepareStaffForMovement,
  resolveStaffAfterMovement,
} from './staff.js';

const PARTY_SIZE = 4;
const INITIAL_PARTIES = 8;
const MAX_TICKS_PER_PARTY = 5_000;
const GATE_KEYS = ['customerIds', 'doorId', 'guideStaffId', 'partyId', 'tableId'];

function buildParty(index) {
  const partyId = `stress-party-${String(index).padStart(2, '0')}`;
  return {
    partyId,
    members: Array.from({ length: PARTY_SIZE }, (_, memberIndex) => ({
      id: `${partyId}-customer-${memberIndex + 1}`,
      partyId,
      partySize: PARTY_SIZE,
      partyType: 'group',
      state: 'queued',
      patience: 100,
      happiness: 80,
      dishId: null,
      drinkId: null,
      tableId: null,
      chairId: null,
    })),
  };
}

export function buildCustomerQueueStressState() {
  return {
    restaurant: {
      gameTime: 12 * 3_600,
      expansionLevel: 1,
      reputation: 2,
      totalServed: 0,
    },
    queue: Array.from({ length: INITIAL_PARTIES }, (_, index) => buildParty(index + 1)),
    queueAdmissionGate: null,
    customers: [],
    staff: [{
      id: 'queue-guide',
      role: 'waiter',
      morale: 80,
      x: 860,
      y: 360,
      task: null,
      carryingServiceItemId: null,
    }],
    tables: [{ id: 'queue-table', seats: PARTY_SIZE, status: 'empty', x: 200, y: 360 }],
    chairs: [
      { id: 'queue-chair-1', tableId: 'queue-table', x: 210, y: 340, rotation: 2 },
      { id: 'queue-chair-2', tableId: 'queue-table', x: 210, y: 400, rotation: 0 },
      { id: 'queue-chair-3', tableId: 'queue-table', x: 180, y: 370, rotation: 1 },
      { id: 'queue-chair-4', tableId: 'queue-table', x: 240, y: 370, rotation: 3 },
    ],
    doors: [{ id: 'queue-door', y: 340 }],
    kitchenStations: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    serviceItems: [],
    floorDirt: [],
    dishes: [],
    equipment: [],
    unlockedDrinkIds: [],
    completedCustomers: [],
  };
}

function elapsedNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function sameOrderedIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function getValidatedGateOwnerPartyIds(state) {
  const gate = state.queueAdmissionGate;
  if (gate == null) return [];
  const keys = Object.keys(gate).sort();
  if (!sameOrderedIds(keys, GATE_KEYS)
    || typeof gate.partyId !== 'string'
    || !Array.isArray(gate.customerIds)
    || gate.customerIds.length === 0
    || new Set(gate.customerIds).size !== gate.customerIds.length
    || typeof gate.guideStaffId !== 'string'
    || typeof gate.tableId !== 'string'
    || typeof gate.doorId !== 'string') {
    throw new Error('Customer queue stress gate must contain exactly partyId, customerIds, guideStaffId, tableId, and doorId');
  }

  const guide = (state.staff || []).find(worker => worker.id === gate.guideStaffId);
  const task = guide?.task;
  if (task?.type !== 'guide_customer'
    || task.partyId !== gate.partyId
    || task.tableId !== gate.tableId
    || task.customerId !== gate.customerIds[0]
    || !Array.isArray(task.customerIds)
    || !sameOrderedIds(task.customerIds, gate.customerIds)) {
    throw new Error('Customer queue stress gate identity does not match its guide task');
  }

  const status = getQueueAdmissionGateStatus(state);
  const gateCustomerIds = new Set(gate.customerIds);
  const materialisedPartyMembers = (state.customers || [])
    .filter(customer => customer.partyId === gate.partyId);
  if (!status.occupied
    || status.stale
    || status.gateMembers.length !== gate.customerIds.length
    || materialisedPartyMembers.length !== gate.customerIds.length
    || !status.gateMembers.every(customer => gateCustomerIds.has(customer.id)
      && customer.partyId === gate.partyId)
    || !materialisedPartyMembers.every(customer => gateCustomerIds.has(customer.id))) {
    throw new Error('Customer queue stress gate identity does not match its materialised customers');
  }

  return [gate.partyId];
}

function coordinatesAreFinite(state) {
  const projectedQueue = getQueueProjectedMembers(state, state.queue);
  return [...(state.staff || []), ...(state.customers || []), ...projectedQueue]
    .every(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y));
}

function assertLogicalQueueRecords(state) {
  for (const party of state.queue || []) {
    for (const member of party.members || []) {
      if (Number.isFinite(member.x) || Number.isFinite(member.y)
        || Object.hasOwn(member, 'navigationGoal')) {
        throw new Error(`Queued customer ${member.id} became a movement or route actor`);
      }
    }
  }
}

function minimumMaterialisationSpacing(state, materialisedIds) {
  const actors = [...(state.staff || []), ...(state.customers || [])]
    .filter(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y));
  let minimum = Infinity;
  for (let left = 0; left < actors.length; left += 1) {
    for (let right = left + 1; right < actors.length; right += 1) {
      if (!materialisedIds.has(actors[left].id) && !materialisedIds.has(actors[right].id)) continue;
      minimum = Math.min(minimum, Math.hypot(
        actors[left].x - actors[right].x,
        actors[left].y - actors[right].y,
      ));
    }
  }
  return minimum;
}

function resetAfterCompletion(state, partyId) {
  return {
    ...state,
    customers: state.customers.filter(customer => customer.partyId !== partyId),
    queueAdmissionGate: null,
    staff: state.staff.map(worker => worker.id === 'queue-guide'
      ? {
          ...worker,
          x: 860,
          y: 360,
          navigationGoal: null,
          task: null,
          activityPhase: 'stationed',
        }
      : worker),
    tables: state.tables.map(table => {
      if (table.id !== 'queue-table') return table;
      const { reservationOwnerStaffId: _owner, ...tableWithoutOwner } = table;
      return { ...tableWithoutOwner, status: 'empty' };
    }),
  };
}

export function buildCustomerQueueNonTimingProjection(result) {
  const { timings: _timings, summary, ...projection } = result;
  return { ...projection, summary: nonTimingSummary(summary) };
}

export function runCustomerQueueStressScenario({ cycles, movementDt, metrics = createMovementMetrics() }) {
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw new Error('Customer queue stress cycles must be a positive integer');
  }
  if (!Number.isFinite(movementDt) || movementDt <= 0) {
    throw new Error('Customer queue stress movementDt must be positive and finite');
  }

  let state = buildCustomerQueueStressState();
  const completedPartyIds = [];
  const replacementPartyIds = [];
  const movementEntryIds = [];
  let nextPartyIndex = INITIAL_PARTIES + 1;
  let ticks = 0;
  let ticksForCurrentParty = 0;
  let maximumGateOwners = 0;
  let queuedMemberMovementEntries = 0;
  let maximumMovementActors = 0;
  let minimumSpacing = Infinity;
  let allCoordinatesFinite = true;
  const gateOwnerPartyIds = new Set();
  const timings = { ticks: [], batches: [], planner: [], executor: [] };
  const tickRecords = [];

  const observeGateOwners = currentState => {
    const ownerPartyIds = getValidatedGateOwnerPartyIds(currentState);
    ownerPartyIds.forEach(partyId => gateOwnerPartyIds.add(partyId));
    maximumGateOwners = Math.max(maximumGateOwners, ownerPartyIds.length);
  };

  while (completedPartyIds.length < cycles) {
    const tickStartedAt = elapsedNow();
    ticks += 1;
    ticksForCurrentParty += 1;
    assertLogicalQueueRecords(state);
    observeGateOwners(state);

    state = prepareStaffForMovement(state, movementDt);
    observeGateOwners(state);

    const queuedIds = new Set(getQueueProjectedMembers(state, state.queue)
      .map(member => member.id));
    const entries = getStaffMovementEntries(state);
    const entryIds = entries.map(entry => entry.character.id);
    movementEntryIds.push(...entryIds);
    maximumMovementActors = Math.max(maximumMovementActors, entries.length);
    const queuedEntries = entryIds.filter(id => queuedIds.has(id));
    queuedMemberMovementEntries += queuedEntries.length;
    if (queuedEntries.length) {
      throw new Error(`Queued customers entered movement planning: ${queuedEntries.join(', ')}`);
    }

    const before = { batch: metrics.batchMilliseconds, planner: metrics.plannerMilliseconds, executor: metrics.executorMilliseconds };
    const batch = advanceCharacterMovementBatch(
      state,
      entries,
      movementDt,
      metrics,
    );
    const record = recordStressTick(state, entries, batch, movementDt, metrics);
    tickRecords.push(record);
    minimumSpacing = Math.min(minimumSpacing, record.minimumSweptSpacing, record.minimumEndpointSpacing);
    const { moved, statuses } = batch;
    state = {
      ...state,
      movementCoordinator: batch.coordinator,
      staff: state.staff.map(actor => moved.get(actor.id) || actor),
      customers: state.customers.map(actor => moved.get(actor.id) || actor),
    };
    const customerIdsBeforeResolution = new Set(state.customers.map(customer => customer.id));
    state = resolveStaffAfterMovement(state, movementDt, statuses);
    const materialisedIds = new Set(state.customers
      .filter(customer => !customerIdsBeforeResolution.has(customer.id))
      .map(customer => customer.id));
    if (materialisedIds.size) {
      minimumSpacing = Math.min(
        minimumSpacing,
        minimumMaterialisationSpacing(state, materialisedIds),
      );
    }
    observeGateOwners(state);
    allCoordinatesFinite = allCoordinatesFinite && coordinatesAreFinite(state);

    const completedParty = state.customers.find(customer =>
      customer.state === 'seated'
      && !completedPartyIds.includes(customer.partyId));
    if (completedParty) {
      const seatedMembers = state.customers.filter(customer =>
        customer.partyId === completedParty.partyId && customer.state === 'seated');
      if (seatedMembers.length !== PARTY_SIZE) {
        throw new Error(`Party ${completedParty.partyId} seated only ${seatedMembers.length} members`);
      }
      completedPartyIds.push(completedParty.partyId);
      state = resetAfterCompletion(state, completedParty.partyId);
      if (state.queue.length < INITIAL_PARTIES) {
        const replacement = buildParty(nextPartyIndex);
        state = { ...state, queue: [...state.queue, replacement] };
        replacementPartyIds.push(replacement.partyId);
        nextPartyIndex += 1;
      }
      ticksForCurrentParty = 0;
    }

    timings.batches.push(metrics.batchMilliseconds - before.batch);
    timings.planner.push(metrics.plannerMilliseconds - before.planner);
    timings.executor.push(metrics.executorMilliseconds - before.executor);
    timings.ticks.push(elapsedNow() - tickStartedAt);
    if (ticksForCurrentParty >= MAX_TICKS_PER_PARTY) {
      const partyId = state.queueAdmissionGate?.partyId
        || state.staff.find(worker => worker.task?.type === 'guide_customer')?.task?.partyId
        || state.queue[0]?.partyId
        || 'unknown';
      const error = new Error(`Customer queue stress party ${partyId} did not complete within 5,000 ticks`);
      error.evidence = { completedPartyIds, ticks, minimumSpacing,
        summary: summariseMovementMetrics(metrics), lastTick: record };
      throw error;
    }
  }

  return {
    cycles,
    navigationVersion: state.movementCoordinator.version,
    ticks,
    completedPartyIds,
    throughput: completedPartyIds.length / ticks,
    queuedMemberMovementEntries,
    maximumGateOwners,
    gateOwnerPartyIds: [...gateOwnerPartyIds],
    maximumMovementActors,
    minimumSpacing,
    arrivalsResumed: replacementPartyIds.length > 0,
    replacementPartyIds,
    allCoordinatesFinite,
    movementEntryIds,
    timings,
    tickRecords,
    summary: summariseMovementMetrics(metrics),
    maxExpansionsPerTick: Math.max(...tickRecords.map(tick => tick.expansionsThisTick)),
    maximumActorQuantum: tickRecords.reduce((maximum, tick) => Math.max(maximum, ...tick.actorQuanta), 0),
    maximumGroupQuantum: tickRecords.reduce((maximum, tick) => Math.max(maximum, ...tick.groupQuanta), 0),
    allMovementScheduled: tickRecords.every(tick => tick.allMovementScheduled),
    allWithinSpeedBudget: tickRecords.every(tick => tick.allWithinSpeedBudget),
  };
}
