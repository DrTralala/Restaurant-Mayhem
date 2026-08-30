import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  getStaffMovementEntries,
  prepareStaffForMovement,
  resolveStaffAfterMovement,
  updateStaff,
} from './staff';
import { updateCustomers } from './customers';
import { buildBlockedCells, cellToWorld, isInsideWorld, worldToCell } from './pathfinding';
import { minimumSweptDistance, resolveCharacterMovementBatch } from './movement';
import { updateAutomaticDishwashers } from './dishwashing';
import { getQueuePosition, getRestaurantWorld } from './world';

const baseState = {
  staff: [],
  customers: [],
  queue: [],
  tables: [],
  chairs: [],
  serviceItems: [],
  unlockedDrinkIds: ['water'],
  kitchenStations: [],
  dishes: [],
  restaurant: { gameTime: 12 * 3600, expansionLevel: 1 },
  serviceTables: [],
};

it('prepares staff paths without changing positions', () => {
  const stateWithWalkingWaiter = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', morale: 80, x: 100, y: 100,
      path: [{ x: 8, y: 5 }], task: null,
    }],
  };
  const prepared = prepareStaffForMovement(stateWithWalkingWaiter, 1);
  expect(prepared.staff[0]).toMatchObject({ x: 100, y: 100 });
});

it('marks guide and party movement entries as mutually ignored', () => {
  const stateWithGuidedParty = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', morale: 80, x: 100, y: 100,
      path: [{ x: 8, y: 5 }],
      task: { type: 'guide_customer', customerIds: ['party-1', 'party-2'], tableId: 't1' },
    }],
    customers: [
      { id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 88, y: 112, path: [{ x: 7, y: 5 }] },
      { id: 'party-2', state: 'guided', guideStaffId: 'guide', x: 76, y: 124, path: [{ x: 6, y: 6 }] },
    ],
  };
  const entries = getStaffMovementEntries(stateWithGuidedParty);
  expect(entries.find(entry => entry.character.id === 'guide').ignoredIds)
    .toEqual(expect.arrayContaining(['guide', 'party-1', 'party-2']));
});

it('emits guide provenance only on genuine guided-customer descriptors, never guide staff', () => {
  const state = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }],
      task: { type: 'guide_customer', customerIds: ['party-1'], tableId: 't1' },
    }, {
      id: 'walker', role: 'waiter', x: 140, y: 100, path: [{ x: 9, y: 5 }], task: null,
    }],
    customers: [
      { id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 88, y: 112, path: [{ x: 7, y: 5 }] },
      { id: 'idle', state: 'eating', x: 300, y: 300, path: [] },
    ],
  };
  const entries = getStaffMovementEntries(state);
  const guideEntry = entries.find(entry => entry.character.id === 'guide');
  const partyEntry = entries.find(entry => entry.character.id === 'party-1');
  const walkerEntry = entries.find(entry => entry.character.id === 'walker');
  const idleEntry = entries.find(entry => entry.character.id === 'idle');
  expect(guideEntry.provenance).toBeUndefined();
  expect(guideEntry.ignoredIds).toEqual(['guide', 'party-1']);
  expect(partyEntry.provenance).toBe('guide');
  expect(partyEntry.ignoredIds).toEqual(['guide', 'party-1']);
  expect(walkerEntry.provenance).toBeUndefined();
  expect(idleEntry.provenance).toBeUndefined();
});

it('keeps a pathful guided customer safe when its referenced guide has a null task', () => {
  const entries = getStaffMovementEntries({
    ...baseState,
    staff: [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [], task: null }],
    customers: [{ id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 88, y: 112, path: [{ x: 7, y: 5 }] }],
  });
  const entry = entries.find(candidate => candidate.character.id === 'party-1');
  expect(entry.provenance).toBeUndefined();
  expect(entry.ignoredIds).toEqual([]);
  expect(entry.speed).toBe(0);
});

it('keeps a pathful guided customer safe when its referenced guide has a non-guide task', () => {
  const entries = getStaffMovementEntries({
    ...baseState,
    staff: [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [], task: { type: 'clean_table', tableId: 't1' } }],
    customers: [{ id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 88, y: 112, path: [{ x: 7, y: 5 }] }],
  });
  const entry = entries.find(candidate => candidate.character.id === 'party-1');
  expect(entry.provenance).toBeUndefined();
  expect(entry.ignoredIds).toEqual([]);
  expect(entry.speed).toBe(0);
});

it('keeps a pathful guided customer safe when an active guide task excludes it from the party', () => {
  const entries = getStaffMovementEntries({
    ...baseState,
    staff: [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }],
      task: { type: 'guide_customer', customerIds: ['other-party'], tableId: 't1' } }],
    customers: [{ id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 88, y: 112, path: [{ x: 7, y: 5 }] }],
  });
  const entry = entries.find(candidate => candidate.character.id === 'party-1');
  expect(entry.provenance).toBeUndefined();
  expect(entry.ignoredIds).toEqual([]);
  expect(entry.speed).toBe(0);
});



it('keeps pathless guided followers stationary and safely handles a missing guide', () => {
  const entries = getStaffMovementEntries({
    ...baseState,
    staff: [],
    customers: [{ id: 'party-1', state: 'guided', guideStaffId: 'missing', x: 88, y: 112, path: [] }],
  });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ character: { id: 'party-1' }, speed: 0, ignoredIds: [] });
  expect(entries[0].target).toBeUndefined();
});

it.each([
  ['null task', null],
  ['non-guide task', { type: 'clean_table', tableId: 't1' }],
])('keeps a pathless guided customer stationary when its referenced guide has a %s', (_name, task) => {
  const entries = getStaffMovementEntries({
    ...baseState,
    staff: [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [], task }],
    customers: [{ id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 88, y: 112, path: [] }],
  });

  expect(entries.find(entry => entry.character.id === 'party-1'))
    .toMatchObject({ speed: 0, ignoredIds: [] });
});

it('does not plan a follower path for a guided customer excluded from the active guide party', () => {
  const state = {
    ...baseState,
    staff: [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }],
      task: { type: 'guide_customer', customerIds: ['other-party'], tableId: 't1' } }],
    customers: [{ id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 80, y: 120, path: [] }],
  };

  const prepared = prepareStaffForMovement(state, 0);

  expect(prepared.customers[0].path).toEqual([]);
  expect(prepared.customers[0].pathGoal).toBeUndefined();
});

it('assigns a guide task without changing existing customer or staff coordinates after movement', () => {
  const state = {
    ...baseState,
    staff: [{ id: 'guide', role: 'waiter', morale: 80, x: 860, y: 360, path: [], task: null }],
    customers: [{ id: 'party-1', state: 'waiting', patience: 100, happiness: 80, x: 900, y: 360, path: [] }],
    tables: [{ id: 't1', seats: 1, status: 'empty', x: 200, y: 220 }],
    chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
  };

  const resolved = resolveStaffAfterMovement(state, 0);

  expect(resolved.staff[0]).toMatchObject({ x: 860, y: 360, task: { type: 'guide_customer' } });
  expect(resolved.customers[0]).toMatchObject({
    id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 900, y: 360,
  });
});

it('normalises a coordinate-less assigned customer only in the next preparation and moves it through the batch', () => {
  const state = {
    ...baseState,
    staff: [{ id: 'guide', role: 'waiter', morale: 80, x: 860, y: 360, path: [], task: null }],
    customers: [{ id: 'party-1', state: 'waiting', patience: 100, happiness: 80, path: [] }],
    tables: [{ id: 't1', seats: 1, status: 'empty', x: 200, y: 220 }],
    chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
  };

  const assigned = resolveStaffAfterMovement(state, 0);
  expect(assigned.customers[0]).toMatchObject({ state: 'guided', guideStaffId: 'guide' });
  expect(assigned.customers[0].x).toBeUndefined();
  expect(assigned.customers[0].y).toBeUndefined();

  const prepared = prepareStaffForMovement(assigned, 0);
  const preparedCustomer = prepared.customers[0];
  expect(Number.isFinite(preparedCustomer.x)).toBe(true);
  expect(Number.isFinite(preparedCustomer.y)).toBe(true);
  expect(preparedCustomer.path.length).toBeGreaterThan(0);

  const customerEntry = getStaffMovementEntries(prepared)
    .find(entry => entry.character.id === preparedCustomer.id);
  expect(customerEntry).toMatchObject({ speed: 62, provenance: 'guide' });

  const movedCustomer = resolveCharacterMovementBatch(prepared, getStaffMovementEntries(prepared), 0.1)
    .get(preparedCustomer.id);
  expect(Number.isFinite(movedCustomer.x)).toBe(true);
  expect(Number.isFinite(movedCustomer.y)).toBe(true);
  expect(Math.hypot(movedCustomer.x - preparedCustomer.x, movedCustomer.y - preparedCustomer.y))
    .toBeGreaterThan(0);
});

it('normalises a late genuine guided customer inside pathfinding world bounds', () => {
  const guidedCustomer = { id: 'guided', state: 'guided', guideStaffId: 'guide', path: [] };
  const state = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', x: 700, y: 300, path: [{ x: 10, y: 10 }],
      task: { type: 'guide_customer', customerId: 'guided', tableId: 't1' },
    }],
    customers: [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `existing-${index}`, state: 'eating', x: 100 + index * 20, y: 600,
      })),
      guidedCustomer,
    ],
  };

  expect(isInsideWorld(state, worldToCell(getQueuePosition(state, 20)))).toBe(false);

  const preparedCustomer = prepareStaffForMovement(state, 0).customers
    .find(customer => customer.id === guidedCustomer.id);

  expect(Number.isFinite(preparedCustomer.x)).toBe(true);
  expect(Number.isFinite(preparedCustomer.y)).toBe(true);
  expect(isInsideWorld(state, worldToCell(preparedCustomer))).toBe(true);
});

it('chooses a deterministic legal unoccupied alternative when the preferred guided start is occupied', () => {
  const preferred = getQueuePosition(baseState, 0);
  const state = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', x: 700, y: 300, path: [{ x: 10, y: 10 }],
      task: { type: 'guide_customer', customerId: 'guided', tableId: 't1' },
    }],
    customers: [
      { id: 'guided', state: 'guided', guideStaffId: 'guide', path: [] },
      { id: 'occupier', state: 'eating', ...preferred, path: [] },
    ],
  };

  const first = prepareStaffForMovement(state, 0).customers.find(customer => customer.id === 'guided');
  const second = prepareStaffForMovement(state, 0).customers.find(customer => customer.id === 'guided');

  expect(first).toMatchObject(getQueuePosition(state, 1));
  expect({ x: first.x, y: first.y }).toEqual({ x: second.x, y: second.y });
  expect(isInsideWorld(state, worldToCell(first))).toBe(true);
  expect(Math.hypot(first.x - preferred.x, first.y - preferred.y)).toBeGreaterThanOrEqual(16);
});

it.each([
  ['x', { x: 777, y: Number.NaN }, 'x', 777],
  ['y', { x: Number.POSITIVE_INFINITY, y: 333 }, 'y', 333],
])('preserves a finite %s coordinate while normalising only the missing guided coordinate', (_axis, coordinates, preservedKey, preservedValue) => {
  const state = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', x: 700, y: 300, path: [{ x: 10, y: 10 }],
      task: { type: 'guide_customer', customerId: 'guided', tableId: 't1' },
    }],
    customers: [{ id: 'guided', state: 'guided', guideStaffId: 'guide', path: [], ...coordinates }],
  };

  const preparedCustomer = prepareStaffForMovement(state, 0).customers[0];

  expect(preparedCustomer[preservedKey]).toBe(preservedValue);
  expect(Number.isFinite(preparedCustomer.x)).toBe(true);
  expect(Number.isFinite(preparedCustomer.y)).toBe(true);
  expect(isInsideWorld(state, worldToCell(preparedCustomer))).toBe(true);
});

it.each([
  ['x', { x: -100, y: Number.NaN }, 'x', -100],
  ['y', { x: Number.NaN, y: 10000 }, 'y', 10000],
])('replaces an out-of-bounds finite %s while filling the missing guided coordinate', (_axis, coordinates, invalidKey, invalidValue) => {
  const preferred = getQueuePosition(baseState, 0);
  const state = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', x: 700, y: 300, path: [{ x: 10, y: 10 }],
      task: { type: 'guide_customer', customerId: 'guided', tableId: 't1' },
    }],
    customers: [
      { id: 'guided', state: 'guided', guideStaffId: 'guide', path: [], ...coordinates },
      { id: 'occupier', state: 'eating', ...preferred, path: [] },
    ],
  };

  const first = prepareStaffForMovement(state, 0).customers.find(customer => customer.id === 'guided');
  const second = prepareStaffForMovement(state, 0).customers.find(customer => customer.id === 'guided');

  expect(first).toMatchObject(getQueuePosition(state, 1));
  expect(first[invalidKey]).not.toBe(invalidValue);
  expect(Number.isFinite(first.x)).toBe(true);
  expect(Number.isFinite(first.y)).toBe(true);
  expect(isInsideWorld(state, worldToCell(first))).toBe(true);
  expect(Math.hypot(first.x - preferred.x, first.y - preferred.y)).toBeGreaterThanOrEqual(16);
  expect({ x: first.x, y: first.y }).toEqual({ x: second.x, y: second.y });
});

it('starts chair approach routing without changing customer or staff coordinates after movement', () => {
  const state = {
    ...baseState,
    staff: [{
      id: 'guide', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
      task: { type: 'guide_customer', customerId: 'party-1', tableId: 't1', reservedChairIds: ['ch1'] },
    }],
    customers: [{
      id: 'party-1', state: 'guided', guideStaffId: 'guide', tableId: 't1',
      x: 168, y: 232, path: [], patience: 100, happiness: 80,
    }],
    tables: [{ id: 't1', seats: 1, status: 'reserved', x: 200, y: 220 }],
    chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
  };

  const resolved = resolveStaffAfterMovement(state, 0);

  expect(resolved.staff[0]).toMatchObject({
    x: 180, y: 220, task: { type: 'guide_customer', stage: 'approach_chairs' },
  });
  expect(resolved.customers[0]).toMatchObject({
    state: 'guided', guideStaffId: 'guide', x: 168, y: 232,
  });
  expect(resolved.customers[0].path.length).toBeGreaterThan(0);
  expect(resolved.tables[0].status).toBe('reserved');
});

it('marks only staff already in static-fallback recovery as head-on detour eligible', () => {
  const entries = getStaffMovementEntries({
    ...baseState,
    staff: [
      { id: 'eligible', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }],
        stalledFor: 2, usingStaticFallback: true, task: null },
      { id: 'not-stalled', role: 'waiter', x: 100, y: 120, path: [{ x: 8, y: 6 }],
        stalledFor: 0, usingStaticFallback: true, task: null },
      { id: 'not-static', role: 'waiter', x: 100, y: 140, path: [{ x: 8, y: 7 }],
        stalledFor: 2, usingStaticFallback: false, task: null },
    ],
  });

  expect(entries.find(entry => entry.character.id === 'eligible').headOnDetourEligible).toBe(true);
  expect(entries.find(entry => entry.character.id === 'not-stalled').headOnDetourEligible).toBeUndefined();
  expect(entries.find(entry => entry.character.id === 'not-static').headOnDetourEligible).toBeUndefined();
});

it('uses the rear-left formation and complete singular guide party IDs', () => {
  const state = {
    ...baseState,
    staff: [{ id: 'guide', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }],
      task: { type: 'guide_customer', customerId: 'party-1', tableId: 't1' } }],
    customers: [{ id: 'party-1', state: 'guided', guideStaffId: 'guide', x: 80, y: 120, path: [] }],
  };
  const prepared = prepareStaffForMovement(state, 0);
  expect(prepared.customers[0].pathGoal).toEqual({ x: 4, y: 5 });
  const guideEntry = getStaffMovementEntries(prepared).find(entry => entry.character.id === 'guide');
  const partyEntry = getStaffMovementEntries(prepared).find(entry => entry.character.id === 'party-1');
  expect(guideEntry.ignoredIds).toEqual(['guide', 'party-1']);
  expect(partyEntry.ignoredIds).toEqual(['guide', 'party-1']);
});

it('keeps every actor in the batch while granting deterministic corridor priority', () => {
  const state = congestionState([
    { id: 'a-worker', role: 'waiter', x: 100, y: 100, path: [{ x: 16, y: 5 }], task: null },
    { id: 'b-worker', role: 'waiter', x: 260, y: 100, path: [{ x: 3, y: 5 }], task: null },
  ]);
  const result = updateStaff(state, 0.1);
  expect(result.staff.find(worker => worker.id === 'a-worker').x).toBeGreaterThan(100);
  expect(result.staff.find(worker => worker.id === 'b-worker').x).toBeLessThanOrEqual(260);
});

it('reduces morale by 0.01 per game minute without using movement time', () => {
  const state = {
    ...baseState,
    staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 100, y: 100, path: [], task: null }],
  };

  const result = updateStaff(state, { gameDt: 60, movementDt: 0 });

  expect(result.staff[0].morale).toBeCloseTo(79.99);
  expect(result.staff[0]).toMatchObject({ x: 100, y: 100 });
});

function corridorWalls(endX) {
  return [20, 180].flatMap(y => Array.from(
    { length: (endX - 60) / 20 + 1 },
    (_, index) => ({ id: `corridor-${y}-${index}`, x: 60 + index * 20, y }),
  ));
}

function runCongestionScenario(state, isComplete) {
  const blocked = buildBlockedCells(state);
  const histories = new Map([...state.staff, ...state.customers].map(actor => [actor.id, []]));
  const metadataHistories = new Map(state.staff.map(actor => [actor.id, []]));
  let current = state;

  const recordActors = () => {
    for (const actor of [...current.staff, ...current.customers]) {
      const point = { x: actor.x, y: actor.y };
      const cell = worldToCell(point);
      histories.get(actor.id)?.push(point);
      metadataHistories.get(actor.id)?.push({ stalledFor: actor.stalledFor, minimumSpacing: actor.minimumSpacing, usingStaticFallback: actor.usingStaticFallback });
      expect(blocked.has(`${cell.x},${cell.y}`)).toBe(false);
    }
  };

  recordActors();
  for (let tick = 0; tick < 100 && !isComplete(current); tick += 1) {
    current = updateStaff(current, 0.1);
    recordActors();
  }
  expect(isComplete(current), JSON.stringify(current.staff.map(worker => ({
    id: worker.id,
    x: worker.x,
    stalledFor: worker.stalledFor,
    usingStaticFallback: worker.usingStaticFallback,
  })))).toBe(true);
  for (const actor of current.staff) {
    const history = histories.get(actor.id);
    const roleSpeed = actor.role === 'cook' ? 55 : 75;
    expect(history.length).toBeGreaterThan(1);
    for (let index = 1; index < history.length; index += 1) {
      expect(Math.hypot(history[index].x - history[index - 1].x, history[index].y - history[index - 1].y))
        .toBeLessThanOrEqual(roleSpeed * 0.1 + 1e-6);
    }
    const metadata = metadataHistories.get(actor.id);
    const checkedTransitions = history.slice(1).map((point, index) => ({ point, previous: history[index], metadata: metadata[index + 1] }))
      .filter(({ point, previous }) => Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.1);
    expect(checkedTransitions.length).toBeGreaterThan(0);
    expect(checkedTransitions.every(({ metadata: tick }) => tick.stalledFor === 0 && tick.minimumSpacing === 16 && tick.usingStaticFallback === false)).toBe(true);
  }
  expect(current.staff.filter(worker => worker.stalledFor === 0 && worker.minimumSpacing === 16 && worker.usingStaticFallback === false).length)
    .toBeGreaterThan(0);
  return { current, histories };
}


function congestionState(staff, customers = [], corridorEndX = 340) {
  return { ...baseState, staff, customers, chairs: corridorWalls(corridorEndX), tables: [], serviceItems: [] };
}

function queuedAdmissionState() {
  return {
    ...baseState,
    staff: [
      { id: 'w1', role: 'waiter', morale: 80, x: 860, y: 300, path: [], task: null },
      { id: 'w2', role: 'waiter', morale: 80, x: 860, y: 420, path: [], task: null },
    ],
    queue: [
      { id: 'q1', partyId: 'p1', partySize: 1, state: 'queued', patience: 100, happiness: 80 },
      { id: 'q2', partyId: 'p2', partySize: 1, state: 'queued', patience: 100, happiness: 80 },
    ],
    tables: [
      { id: 't1', seats: 1, status: 'empty', x: 200, y: 220 },
      { id: 't2', seats: 1, status: 'empty', x: 400, y: 420 },
    ],
    chairs: [
      { id: 'ch1', tableId: 't1', x: 210, y: 180 },
      { id: 'ch2', tableId: 't2', x: 410, y: 380 },
    ],
  };
}

describe('updateStaff', () => {
  it('bills one dish and one drink exactly once and marks both for clearing', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100, path: [],
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 } }],
      customers: [{ id: 'c1', state: 'paying', paymentReady: true, x: 840, y: 180, happiness: 80, dishId: 'd1', drinkId: 'water', tableId: 't1' }],
      dishes: [{ id: 'd1', price: 12 }], unlockedDrinkIds: ['water'],
      serviceItems: [
        { id: 'dish', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'delivered' },
        { id: 'drink', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'delivered' },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }], completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
    };
    const result = updateStaff(state, 0);
    expect(result.completedCustomers[0]).toMatchObject({ dishId: 'd1', drinkId: 'water', revenue: 16.8, tip: 2.8, totalPaid: 16.8 });
    expect(result.serviceItems.every(item => item.state === 'dirty_at_table')).toBe(true);
  });

  it.each(['dish', 'drink'])('clears a used %s item through one generic task', kind => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 220, y: 220, path: [],
        task: { type: 'clean_service_item', serviceItemId: 'i1' } }],
      serviceItems: [{ id: 'i1', kind, state: 'to_clean', x: 220, y: 220 }],
    };
    const result = updateStaff(state, 0);
    expect(result.serviceItems).toEqual([]);
    expect(result.staff[0].task).toBeNull();
  });

  it('balances concurrent dirty deliveries across projected station workloads', () => {
    const washStations = [
      { id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 },
      { id: 'auto-1', type: 'automatic', x: 320, y: 200, w: 40, h: 40 },
      { id: 'auto-2', type: 'automatic', x: 440, y: 200, w: 40, h: 40 },
    ];
    const serviceItems = ['one', 'two', 'three'].map((id, index) => ({
      id, kind: 'dish', customerId: `gone-${index}`, state: 'carried_dirty', washQueuedAt: null,
    }));
    const staff = serviceItems.map((item, index) => ({
      id: `waiter-${index}`, role: 'waiter', morale: 80,
      x: 100, y: 200 + index * 20, path: [], task: null, carryingServiceItemId: item.id,
    }));

    const assigned = updateStaff({ ...baseState, staff, serviceItems, washStations }, 0);
    const deliveries = assigned.staff.map(worker => worker.task);
    expect(new Set(deliveries.map(task => task?.washStationId))).toEqual(
      new Set(['sink', 'auto-1', 'auto-2']),
    );

    const delivered = updateStaff({
      ...assigned,
      staff: assigned.staff.map(worker => {
        const station = washStations.find(candidate => candidate.id === worker.task.washStationId);
        return { ...worker, x: station.x - 20, y: station.y + 20, path: [] };
      }),
    }, 0);
    expect(delivered.serviceItems.every(item => item.state === 'queued_for_wash')).toBe(true);
    const washing = updateAutomaticDishwashers(delivered);
    expect(washing.serviceItems.filter(item => item.state === 'washing')).toHaveLength(2);
    expect(new Set(washing.serviceItems.filter(item => item.state === 'washing')
      .map(item => item.washStationId))).toEqual(new Set(['auto-1', 'auto-2']));
  });

  it('reserves only eight inbound deliveries for a manual sink', () => {
    const washStations = [{ id: 'sink', type: 'manual', x: 300, y: 200, w: 40, h: 40 }];
    const serviceItems = Array.from({ length: 9 }, (_, index) => ({
      id: `dirty-${index}`, state: 'carried_dirty', tableId: `table-${index}`,
    }));
    const staff = serviceItems.map((item, index) => ({
      id: `waiter-${index}`, role: 'waiter', morale: 80,
      x: 100, y: 100 + index * 20, path: [], task: null, carryingServiceItemId: item.id,
    }));

    const result = updateStaff({ ...baseState, washStations, serviceItems, staff }, 0);

    expect(result.staff.filter(worker => worker.task?.type === 'deliver_dirty_item')).toHaveLength(8);
    expect(result.staff.filter(worker => worker.task == null && worker.carryingServiceItemId)).toHaveLength(1);
  });

  it('leaves dirty items at tables when every wash station is full', () => {
    const washStations = [{ id: 'sink', type: 'manual', x: 300, y: 200, w: 40, h: 40 }];
    const serviceItems = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `queued-${index}`, state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: index,
      })),
      { id: 'dirty', state: 'dirty_at_table', tableId: 't1' },
    ];
    const staff = [{ id: 'waiter', role: 'waiter', morale: 80, x: 180, y: 220, path: [], task: null }];

    const result = updateStaff({
      ...baseState,
      washStations,
      serviceItems,
      staff,
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
    }, 0);

    expect(result.serviceItems.find(item => item.id === 'dirty').state).toBe('dirty_at_table');
    expect(result.staff[0].task?.type).not.toBe('collect_dirty_item');
  });

  it('rechecks capacity before delivering a reserved dirty item', () => {
    const queued = Array.from({ length: 8 }, (_, index) => ({
      id: `queued-${index}`, state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: index,
    }));
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [...queued, { id: 'dirty', state: 'carried_dirty' }],
      staff: [{
        id: 'waiter', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'sink' },
        carryingServiceItemId: 'dirty',
      }],
    };

    const result = updateStaff(state, 0);

    expect(result.serviceItems.find(item => item.id === 'dirty')).toMatchObject({ state: 'carried_dirty' });
    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: 'dirty', path: [] });
  });

  it('does not claim a dirty item at a table with no reachable adjacent cell', () => {
    const blockers = [
      [180, 180], [200, 180], [220, 180], [240, 180],
      [180, 200], [240, 200], [180, 220], [240, 220],
      [180, 240], [200, 240], [220, 240], [240, 240],
    ].map(([x, y], index) => ({ id: `block-${index}`, x, y }));
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 400, y: 300, task: null }],
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
      chairs: blockers,
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', tableId: 't1', state: 'dirty_at_table' }],
    }, 0);
    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems[0].state).toBe('dirty_at_table');
  });

  it('replans dirty pickup when its table moves before arrival', () => {
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'collect_dirty_item', serviceItemId: 'dirty', tableId: 't1' }, carryingServiceItemId: null }],
      tables: [{ id: 't1', status: 'dirty', x: 400, y: 200 }],
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', tableId: 't1', state: 'dirty_at_table' }],
    }, 0);
    expect(result.staff[0]).toMatchObject({
      task: { type: 'collect_dirty_item', serviceItemId: 'dirty', tableId: 't1' },
      carryingServiceItemId: null,
    });
    expect(result.staff[0].path.length).toBeGreaterThan(0);
    expect(result.serviceItems[0].state).toBe('dirty_at_table');
  });

  it('replans dirty delivery when its station moves before arrival', () => {
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'sink' }, carryingServiceItemId: 'dirty' }],
      washStations: [{ id: 'sink', type: 'manual', x: 400, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', state: 'carried_dirty' }],
    }, 0);
    expect(result.staff[0]).toMatchObject({
      task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'sink' },
      carryingServiceItemId: 'dirty',
    });
    expect(result.staff[0].path.length).toBeGreaterThan(0);
    expect(result.serviceItems[0].state).toBe('carried_dirty');
  });

  it('cancels an unreachable moved-station delivery without losing the carried item', () => {
    const blockers = [
      [380, 180], [400, 180], [420, 180], [440, 180],
      [380, 200], [440, 200], [380, 220], [440, 220],
      [380, 240], [400, 240], [420, 240], [440, 240],
    ].map(([x, y], index) => ({ id: `station-block-${index}`, x, y }));
    const result = updateStaff({
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'sink' }, carryingServiceItemId: 'dirty' }],
      chairs: blockers,
      washStations: [{ id: 'sink', type: 'manual', x: 400, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'dirty', kind: 'dish', customerId: 'gone', state: 'carried_dirty' }],
    }, 0);
    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: 'dirty', path: [] });
    expect(result.serviceItems[0].state).toBe('carried_dirty');
  });

  it('assigns the oldest unassigned wash item to a reachable manual sink', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, path: [], task: null }],
      washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [
        { id: 'new', kind: 'dish', customerId: 'gone-new', state: 'queued_for_wash', washStationId: null, washQueuedAt: 20 },
        { id: 'old', kind: 'dish', customerId: 'gone-old', state: 'queued_for_wash', washStationId: null, washQueuedAt: 10 },
      ],
    };
    const claimed = updateStaff(state, 0);
    expect(claimed.staff[0].task).toMatchObject({ type: 'wash_item', serviceItemId: 'old', washStationId: 'sink' });
    expect(claimed.serviceItems.find(item => item.id === 'old').washStationId).toBe('sink');
    const started = updateStaff(claimed, 0);
    expect(started.serviceItems.find(item => item.id === 'old')).toMatchObject({
      state: 'washing', washStationId: 'sink', washStartedAt: 100,
    });
  });

  it.each([
    ['ordered', { id: 'ordered', kind: 'dish', customerId: 'c1', state: 'ordered' }],
    ['preparing', { id: 'preparing', kind: 'dish', customerId: 'c1', state: 'preparing' }],
  ])('removes a paid customer %s item at payment without owner-kind duplicates', (kind, pendingItem) => {
    const result = updateStaff({ ...baseState, restaurant: { ...baseState.restaurant, gameTime: 60 },
      staff: [{ id: 'cashier', role: 'waiter', task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 }, carryingServiceItemId: null },
        { id: 'other', role: 'waiter', carryingServiceItemId: 'other-carried' }],
      customers: [{ id: 'c1', state: 'paying', paymentReady: true, x: 840, y: 180, happiness: 80, dishId: 'd1', drinkId: null, tableId: 't1' }, { id: 'c2', state: 'waiting_for_items', dishId: 'd1' }],
      dishes: [{ id: 'd1', price: 10 }],
      serviceItems: [
        pendingItem,
        { id: 'carried', kind: 'drink', customerId: 'c1', state: 'carried' },
        { id: 'other-carried', kind: 'dish', customerId: 'c2', state: 'carried' },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
    }, 0);
    expect(result.serviceItems.map(item => item.id)).toEqual(['carried', 'other-carried']);
    expect(result.serviceItems[0].state).toBe('to_clean');
    expect(result.staff[0].carryingServiceItemId).toBeNull();
    expect(result.staff[1].carryingServiceItemId).toBe('other-carried');
  });

  it('clears every paid carried-item carrier and preserves unrelated ownership in the same tick', () => {
    const result = updateStaff({ ...baseState, restaurant: { ...baseState.restaurant, gameTime: 60 },
      staff: [{ id: 'cashier', role: 'waiter', task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 }, carryingServiceItemId: null },
        { id: 'paid-waiter', role: 'waiter', carryingServiceItemId: 'paid-item' },
        { id: 'other-waiter', role: 'waiter', carryingServiceItemId: 'other-item' }],
      customers: [{ id: 'c1', state: 'paying', paymentReady: true, x: 840, y: 180, happiness: 80, dishId: 'd1', tableId: 't1' }, { id: 'c2', state: 'waiting_for_items', dishId: 'd1' }],
      dishes: [{ id: 'd1', price: 10 }],
      serviceItems: [{ id: 'paid-item', kind: 'dish', customerId: 'c1', state: 'carried' }, { id: 'other-item', kind: 'dish', customerId: 'c2', state: 'carried' }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
    }, 60);
    expect(result.serviceItems).toEqual([expect.objectContaining({ id: 'paid-item', state: 'carried' }), expect.objectContaining({ id: 'other-item', state: 'carried' })]);
    expect(result.staff.find(worker => worker.id === 'paid-waiter').carryingServiceItemId).toBeNull();
    expect(result.staff.find(worker => worker.id === 'other-waiter').carryingServiceItemId).toBe('other-item');
  });
  afterEach(() => vi.restoreAllMocks());

  it('does nothing with no staff', () => {
    const result = updateStaff(baseState, 1);
    expect(result.staff).toEqual([]);
  });

  it('collects and queues dirty service items, retaining ownership when no station is reachable', () => {
    const base = { ...baseState, restaurant: { gameTime: 100 }, customers: [{ id: 'c1', tableId: 't1', state: 'leaving' }],
      tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }], serviceItems: [{ id: 'i1', customerId: 'c1', tableId: 't1', kind: 'dish', state: 'dirty_at_table', dirtyAt: 1 }],
      staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220, path: [], task: { type: 'collect_dirty_item', serviceItemId: 'i1', tableId: 't1' }, carryingServiceItemId: null }] };
    const carried = updateStaff({ ...base, washStations: [] }, 0);
    expect(carried.serviceItems[0].state).toBe('carried_dirty');
    expect(carried.staff[0].carryingServiceItemId).toBe('i1');
    const queued = updateStaff({ ...carried, washStations: [{ id: 'wash1', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      staff: [{ ...carried.staff[0], task: { type: 'deliver_dirty_item', serviceItemId: 'i1', washStationId: 'wash1' } }] }, 0);
    expect(queued.serviceItems[0]).toMatchObject({ state: 'queued_for_wash', washStationId: 'wash1', washQueuedAt: 100 });
    expect(queued.staff[0].carryingServiceItemId).toBeNull();
  });

  it('manual washing retains a duplicate and prevents a second janitor station claim', () => {
    const state = { ...baseState, restaurant: { gameTime: 100 }, washStations: [{ id: 'wash1', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'same', state: 'queued_for_wash', washStationId: 'wash1', washQueuedAt: 1 }, { id: 'same', state: 'queued_for_wash', washStationId: 'wash1', washQueuedAt: 2 }],
      staff: [{ id: 'j1', role: 'janitor', x: 200, y: 200, path: [], task: null }, { id: 'j2', role: 'janitor', x: 200, y: 200, path: [], task: null }] };
    const claimed = updateStaff(state, 0);
    expect(claimed.staff.filter(worker => worker.task?.type === 'wash_item')).toHaveLength(1);
    const started = updateStaff({ ...claimed, restaurant: { gameTime: 100 },
      staff: claimed.staff.map(worker => worker.task?.type === 'wash_item'
        ? { ...worker, path: [], task: { ...worker.task, washingStartedAt: null } } : worker) }, 0);
    expect(started.serviceItems.filter(item => item.state === 'washing')).toHaveLength(1);
    const waiting = updateStaff({ ...started, restaurant: { gameTime: 399 } }, 0);
    expect(waiting.serviceItems).toHaveLength(2);
    const done = updateStaff({ ...waiting, restaurant: { gameTime: 400 } }, 0);
    expect(done.serviceItems).toHaveLength(1);
  });

  it('does not claim a dirty table while a customer or dirty item blocks cleaning', () => {
    const blocked = {
      ...baseState,
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      customers: [{ id: 'c1', tableId: 't1', state: 'eating' }],
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [], task: null }],
    };
    expect(updateStaff(blocked, 0).staff[0].task).toBeNull();
    expect(updateStaff({
      ...blocked,
      customers: [{ id: 'c1', tableId: 't1', state: 'leaving' }],
      serviceItems: [{ id: 'dirty', tableId: 't1', state: 'dirty_at_table' }],
    }, 0).staff[0].task).toBeNull();
  });

  it('never assigns automatic-station queued work to a janitor', () => {
    const result = updateStaff({ ...baseState, washStations: [{ id: 'auto', type: 'automatic', x: 200, y: 200, w: 40, h: 40 }],
      serviceItems: [{ id: 'i', state: 'queued_for_wash', washStationId: 'auto', washQueuedAt: 1 }],
      staff: [{ id: 'j1', role: 'janitor', x: 200, y: 200, path: [], task: null }] }, 0);
    expect(result.staff[0].task?.type).not.toBe('wash_item');
  });

  it('recovers two workers meeting head-on in a narrow corridor within ten seconds', () => {
    const state = congestionState([
      { id: 'a-worker', role: 'waiter', x: 100, y: 100, stalledFor: 2, usingStaticFallback: true, path: [{ x: 16, y: 5 }], task: { type: 'clean_service_item', serviceItemId: 'right' } },
      { id: 'b-worker', role: 'waiter', x: 260, y: 100, stalledFor: 2, usingStaticFallback: true, path: [{ x: 3, y: 5 }], task: { type: 'clean_service_item', serviceItemId: 'left' } },
    ]);
    const { histories } = runCongestionScenario({
      ...state,
      staff: state.staff.map(worker => ({ ...worker, task: null })),
      serviceItems: [],
    }, current => current.staff.find(worker => worker.id === 'a-worker').x > 260
      && current.staff.find(worker => worker.id === 'b-worker').x < 100);

    expect(histories.get('a-worker').some(point => point.y !== 100)).toBe(true);
    expect(histories.get('b-worker').some(point => point.y !== 100)
      || histories.get('a-worker').some(point => point.y !== 100)).toBe(true);
    expect(Math.max(...histories.get('a-worker').map(point => point.x))).toBeGreaterThan(260);
    expect(Math.min(...histories.get('b-worker').map(point => point.x))).toBeLessThan(100);
    const pairwiseSeparations = histories.get('a-worker').map((point, tick) => {
      const peer = histories.get('b-worker')[tick];
      return Math.hypot(point.x - peer.x, point.y - peer.y);
    });
    expect(Math.min(...pairwiseSeparations)).toBeGreaterThanOrEqual(16 - 1e-6);
    for (let tick = 1; tick < histories.get('a-worker').length; tick += 1) {
      expect(minimumSweptDistance(
        histories.get('a-worker')[tick - 1], histories.get('a-worker')[tick],
        histories.get('b-worker')[tick - 1], histories.get('b-worker')[tick],
      )).toBeGreaterThanOrEqual(16 - 1e-6);
    }
  });

  it('recovers a worker whose work point is temporarily occupied within ten seconds', () => {
    const state = congestionState([
      { id: 'worker', role: 'waiter', x: 100, y: 100, path: [{ x: 8, y: 5 }], task: { type: 'clean_service_item', serviceItemId: 'target' } },
      { id: 'occupier', role: 'waiter', x: 160, y: 100, path: [{ x: 14, y: 5 }], task: { type: 'clean_service_item', serviceItemId: 'other' } },
    ]);
    runCongestionScenario({
      ...state,
      serviceItems: [
        { id: 'target', kind: 'drink', state: 'to_clean', x: 200, y: 100 },
        { id: 'other', kind: 'dish', state: 'to_clean', x: 300, y: 100 },
      ],
    }, current => current.staff.find(worker => worker.id === 'worker').x >= 160);
  });

  it('keeps a waiter and its own guided party moving within ten seconds', () => {
    const state = congestionState([
      { id: 'guide', role: 'waiter', x: 100, y: 100, path: [{ x: 16, y: 5 }], task: { type: 'guide_customer', customerIds: ['party'], tableId: 't1' } },
    ], [{ id: 'party', state: 'guided', guideStaffId: 'guide', x: 140, y: 100, path: [] }]);
    const { histories } = runCongestionScenario({
      ...state,
      tables: [{ id: 't1', seats: 1, status: 'reserved', x: 400, y: 160 }],
    }, current => current.staff.find(worker => worker.id === 'guide').x > 140);

    expect(histories.get('party').some(point => point.x < 140)).toBe(true);
  });

  it('keeps staff and customers progressing through a shared corridor within ten seconds', () => {
    const state = congestionState([
      { id: 'staff', role: 'waiter', x: 100, y: 100, path: [{ x: 16, y: 5 }], task: { type: 'clean_service_item', serviceItemId: 'target' } },
      { id: 'guide', role: 'waiter', x: 200, y: 100, path: [{ x: 30, y: 5 }], task: { type: 'guide_customer', customerIds: ['customer'], tableId: 't1' } },
    ], [{ id: 'customer', state: 'guided', guideStaffId: 'guide', x: 160, y: 100, path: [] }], 620);
    runCongestionScenario({
      ...state,
      tables: [{ id: 't1', seats: 1, status: 'reserved', x: 700, y: 160 }],
      serviceItems: [{ id: 'target', kind: 'dish', state: 'to_clean', x: 340, y: 100 }],
    }, current => current.staff.find(worker => worker.id === 'staff').x > 160);
  });

  it('reserves a unique counter slot when assigning drink preparation', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 400, y: 300 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
        state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
      }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0,
    });
    expect(result.serviceItems[0]).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1',
    });
  });

  it('holds the waiter still for five game-seconds before placing the drink', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0,
      assignedStaffId: 'w1', preparationStartedAt: 100,
    };
    const staff = [{
      id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120, path: [],
      task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
    }];
    const state = {
      ...baseState, staff, serviceItems: [item],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1', drinkId: 'water' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 104.999 },
    };

    const waiting = updateStaff(state, 0);
    const completed = updateStaff({
      ...waiting,
      restaurant: { ...waiting.restaurant, gameTime: 225 },
    }, 0);

    expect(waiting.staff[0]).toMatchObject({ x: 120, y: 120, path: [] });
    expect(waiting.serviceItems[0].state).toBe('preparing');
    expect(completed.serviceItems[0]).toMatchObject({ state: 'on_service', x: 150, y: 130 });
    expect(completed.staff[0].task).toBeNull();
  });

  it('starts preparation only for an exact drink reservation', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1',
    };
    const untouched = {
      id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
      state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120, path: [],
        task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 1 },
      }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water', tableId: 't2' },
      ],
      serviceItems: [item, untouched],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 50 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'prepare_drink', serviceItemId: 'i2' });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
    });
    expect(result.serviceItems[1]).toMatchObject({ id: 'i2', customerId: 'c2', state: 'ordered' });
  });

  it('starts a reserved drink on arrival while retaining its task', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120, path: [],
        task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
        state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1',
      }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({
      task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
      path: [],
    });
    expect(result.serviceItems[0]).toMatchObject({ state: 'preparing', preparationStartedAt: 100 });
  });

  it('does not reserve a second drink slot when three slots and one reservation are occupied', () => {
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120, path: [{ x: 7, y: 5 }],
          task: { type: 'prepare_drink', serviceItemId: 'i4', serviceTableId: 'st1', serviceSlotIndex: 3 },
        },
        { id: 'w2', role: 'waiter', morale: 80, x: 400, y: 300 },
      ],
      customers: [
        { id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water', tableId: 't2' },
      ],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [
        ...[0, 1, 2].map(index => ({
          id: `i${index + 1}`, kind: 'drink', menuItemId: 'water', customerId: `c${index + 1}`,
          tableId: `t${index + 1}`, state: 'on_service', serviceTableId: 'st1',
          serviceSlotIndex: index, assignedStaffId: null,
        })),
        {
          id: 'i4', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
          state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 3, assignedStaffId: 'w1',
        },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff.find(staff => staff.id === 'w2').task?.type).not.toBe('prepare_drink');
  });

  it('reserves a pending drink while another waiter already owns a drink reservation', () => {
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120, path: [{ x: 7, y: 5 }],
          task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
        },
        { id: 'w2', role: 'waiter', morale: 80, x: 400, y: 300 },
      ],
      customers: [
        { id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water', tableId: 't2' },
      ],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [
        {
          id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
          state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w1',
          preparationStartedAt: 100,
        },
        {
          id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
          state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
        },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[1].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'i2', serviceTableId: 'st1', serviceSlotIndex: 1,
    });
    expect(result.serviceItems[1]).toMatchObject({
      serviceTableId: 'st1', serviceSlotIndex: 1, assignedStaffId: 'w2',
    });
  });

  it('does not clear a valid drink reservation owned by another waiter after a stale task', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'w2',
      preparationStartedAt: 100,
    };
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120, path: [],
          task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
        },
        {
          id: 'w2', role: 'waiter', morale: 80, x: 400, y: 300, path: [{ x: 7, y: 5 }],
          task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0 },
        },
      ],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [item],
    };

    const result = updateStaff(state, 0);

    expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'preparing' });
    expect(result.staff[0].task).toBeNull();
  });

  it('does not pick up a service item after its recorded counter changes', () => {
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st2', serviceSlotIndex: 0, state: 'on_service', x: 410, y: 130,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 400, y: 120, path: [],
        task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' },
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      serviceItems: [item],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'on_service' });
  });

  it('restarts an unassigned preparing drink from zero after reservation cleanup', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 0, assignedStaffId: 'missing',
      preparationStartedAt: 10,
    };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water', tableId: 't1' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [item],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 0,
    });
    expect(result.serviceItems[0]).toMatchObject({
      state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0,
      assignedStaffId: 'w1', preparationStartedAt: null,
    });
  });

  it('assigns the front paying customer to an assigned cashier waiter', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 840, y: 100 };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [
        { id: 'c1', state: 'paying', paymentReady: true, x: 840, y: 180, checkoutPosition: { x: 840, y: 180 }, dishId: 'd1', tableId: 't1', patience: 100 },
        { id: 'c2', state: 'paying', x: 700, y: 160, dishId: 'd1', tableId: 't1', patience: 100 },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'take_payment', customerId: 'c1', stationId: 'cashier1' });
    expect(result.staff[0].path).toEqual([]);
    expect(result.customers[1].state).toBe('paying');
  });

  it('does not claim payment while another character occupies the cashier work point', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 840, y: 100 };
    const blocker = { id: 'w1', name: 'Anna', role: 'waiter', morale: 80, x: 840, y: 100 };
    const state = {
      ...baseState,
      staff: [cashier, blocker],
      customers: [{ id: 'c1', state: 'paying', x: 780, y: 140, dishId: 'd1', tableId: 't1', patience: 100 }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0].state).toBe('paying');
  });

  it('cashier completes payment and sends the customer towards an exit', () => {
    const cashier = {
      id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 840, y: 100,
      path: [], task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 },
    };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'paying', paymentReady: true, x: 840, y: 180, checkoutPosition: { x: 840, y: 180 }, dishId: 'd1', tableId: 't1', patience: 100,
        stalledFor: 6, pathGoal: { x: 10, y: 10 }, usingStaticFallback: true, minimumSpacing: 2,
        localConflictTarget: { x: 11, y: 10 }, headOnRecovery: true,
        recoveredHeadOnDetourTarget: { x: 12, y: 10 } }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      restaurant: { ...baseState.restaurant, gameTime: 60, totalServed: 3 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({
      state: 'leaving', departureReason: 'served', exitPhase: 'to_door', exitDoorId: null,
      exitFadeProgress: 0, exitHeading: null, path: [], checkoutPosition: null,
    });
    expect(result.customers[0]).not.toHaveProperty('pathGoal');
    expect(result.customers[0]).not.toHaveProperty('usingStaticFallback');
    expect(result.customers[0]).not.toHaveProperty('minimumSpacing');
    expect(result.customers[0]).not.toHaveProperty('localConflictTarget');
    expect(result.customers[0]).not.toHaveProperty('headOnRecovery');
    expect(result.customers[0]).not.toHaveProperty('recoveredHeadOnDetourTarget');
    expect(result.customers[0].stalledFor).toBe(0);
    expect(result.completedCustomers[0]).toMatchObject({ revenue: 14.4, tip: 2.4 });
    expect(result.restaurant.totalServed).toBe(4);
  });

  it('happy payment increases reputation with configured gain effects', () => {
    const cashier = {
      id: 'cw1', role: 'waiter', morale: 80, x: 840, y: 100,
      path: [], task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 },
    };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'paying', paymentReady: true, x: 840, y: 180, happiness: 80, dishId: 'd1', tableId: 't1' }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      restaurant: { ...baseState.restaurant, gameTime: 60, reputation: 4.9 },
      upgrades: [{ level: 2, effects: { type: 'reputationGain', value: 0.01 } }],
    };

    const result = updateStaff(state, 0);

    expect(result.restaurant.reputation).toBeCloseTo(4.91836);
    expect(result.completedCustomers[0].tip).toBe(2.4);
  });

  it('assigned cashier waiter stays at the station when no payment is waiting', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 300, y: 300 };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'seated', dishId: null, tableId: 't1', patience: 100 }],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      chairs: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      dishes: [{ id: 'd1', popularity: 50 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0].path.at(-1)).toEqual({ x: 42, y: 5 });
  });

  it('reduces morale slowly over time', () => {
    const staff = [{ id: 's1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200 }];
    const state = { ...baseState, staff };
    const result = updateStaff(state, 10);
    expect(result.staff[0].morale).toBeLessThan(80);
  });

  // --- New arrival-based tests (Task 4) ---

  it('allocates distinct collision-safe positions when two waiters admit queued parties together', () => {
    const state = queuedAdmissionState();
    const result = updateStaff(state, 0);
    const [first, second] = result.customers;
    const world = getRestaurantWorld(state.restaurant || {});
    const blocked = buildBlockedCells(state);

    expect(result.queue).toEqual([]);
    expect(first).toMatchObject({ state: 'guided', guideStaffId: 'w1' });
    expect(second).toMatchObject({ state: 'guided', guideStaffId: 'w2' });
    expect(Number.isFinite(first.x) && Number.isFinite(first.y)).toBe(true);
    expect(Number.isFinite(second.x) && Number.isFinite(second.y)).toBe(true);
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(16);
    for (const admitted of [first, second]) {
      expect(admitted.x).toBeGreaterThanOrEqual(world.queueX);
      expect(admitted.x).toBeLessThanOrEqual(world.queueX + world.queueW);
      expect(admitted.y).toBeGreaterThanOrEqual(world.kitchenY);
      expect(admitted.y).toBeLessThanOrEqual(world.diningY + world.areaH + 50);
      const cell = worldToCell(admitted);
      expect(blocked.has(`${cell.x},${cell.y}`)).toBe(false);
    }
  });

  it('uses a deterministic safe fallback and routes from the allocated admission position', () => {
    const initialState = queuedAdmissionState();
    const blockers = [
      { id: 'blocker-preferred', state: 'eating', x: 1000, y: 360, path: [] },
      { id: 'blocker-shared-origin', state: 'eating', x: 980, y: 360, path: [] },
    ];
    const blockedState = {
      ...initialState,
      staff: initialState.staff.slice(0, 1),
      customers: blockers,
      queue: initialState.queue.slice(0, 1),
      tables: initialState.tables.slice(0, 1),
      chairs: initialState.chairs.slice(0, 1),
    };

    const firstRun = updateStaff(blockedState, 0);
    const secondRun = updateStaff(blockedState, 0);
    const admitted = firstRun.customers.find(customer => customer.id === 'q1');
    const repeated = secondRun.customers.find(customer => customer.id === 'q1');
    const world = getRestaurantWorld(blockedState.restaurant || {});
    const blocked = buildBlockedCells(blockedState);

    expect(admitted).toMatchObject({ x: 1000, y: 340 });
    for (const blocker of blockers) {
      expect(worldToCell(admitted)).not.toEqual(worldToCell(blocker));
      expect(Math.hypot(admitted.x - blocker.x, admitted.y - blocker.y)).toBeGreaterThanOrEqual(16);
    }
    expect(admitted).toMatchObject(repeated);
    expect(admitted.path.length).toBeGreaterThan(0);
    expect(cellToWorld(admitted.path[0])).toEqual({ x: 980, y: 340 });
    expect(admitted.x).toBeGreaterThanOrEqual(world.queueX);
    expect(admitted.x).toBeLessThanOrEqual(world.queueX + world.queueW);
    expect(admitted.y).toBeGreaterThanOrEqual(world.kitchenY);
    expect(admitted.y).toBeLessThanOrEqual(world.diningY + world.areaH + 50);
    const admittedCell = worldToCell(admitted);
    expect(blocked.has(`${admittedCell.x},${admittedCell.y}`)).toBe(false);
  });

  it('leaves a queued party and table untouched when no safe admission position exists', () => {
    const initialState = queuedAdmissionState();
    const world = getRestaurantWorld(initialState.restaurant || {});
    const blockers = [];
    const first = {
      x: Math.ceil(world.queueX / world.gridSize),
      y: Math.ceil(world.kitchenY / world.gridSize),
    };
    const last = {
      x: Math.floor((world.queueX + world.queueW) / world.gridSize),
      y: Math.floor((world.diningY + world.areaH + 50) / world.gridSize),
    };
    for (let y = first.y; y <= last.y; y += 1) {
      for (let x = first.x; x <= last.x; x += 1) {
        const point = cellToWorld({ x, y });
        blockers.push({ id: `blocker-${x}-${y}`, state: 'eating', ...point, path: [] });
      }
    }
    const state = {
      ...initialState,
      staff: initialState.staff.slice(0, 1),
      customers: blockers,
      queue: initialState.queue.slice(0, 1),
      tables: initialState.tables.slice(0, 1),
      chairs: initialState.chairs.slice(0, 1),
    };

    const result = updateStaff(state, 0);

    expect(result.queue.map(customer => customer.id)).toContain('q1');
    expect(result.customers.some(customer => customer.id === 'q1')).toBe(false);
    expect(result.staff[0].task).toBeNull();
    expect(result.tables.find(table => table.id === 't1').status).toBe('empty');
  });

  it('waiter starts guiding a waiting customer and reserves table', () => {
    const waiter = { id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 860, y: 360 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('guide_customer');
    expect(result.staff[0].task.customerId).toBe('c1');
    expect(result.staff[0].task.tableId).toBe('t1');
    expect(result.customers[0].state).toBe('guided');
    expect(result.customers[0].guideStaffId).toBe('w1');
    expect(result.tables[0].status).toBe('reserved');
  });

  it('persists chair reservations in customer assignment order when guidance starts', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 860, y: 360, path: [], task: null }],
      customers: [
        { id: 'c1', partyId: 'p1', partySize: 2, state: 'waiting', patience: 100, happiness: 80, x: 880, y: 360 },
        { id: 'c2', partyId: 'p1', partySize: 2, state: 'waiting', patience: 100, happiness: 80, x: 900, y: 360 },
      ],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [
        { id: 'ch2', tableId: 't1', x: 210, y: 260 },
        { id: 'ch1', tableId: 't1', x: 210, y: 180 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({
      type: 'guide_customer',
      customerIds: ['c1', 'c2'],
      chairIds: ['ch2', 'ch1'],
      stage: 'follow_guide',
      approaches: [],
    });
    expect(result.tables[0]).toMatchObject({
      status: 'reserved',
      reservationOwnerStaffId: 'w1',
    });
  });

  it.each([
    ['owner first', ['guide-a', 'guide-b']],
    ['stale guide first', ['guide-b', 'guide-a']],
  ])('prevents a stale guide from releasing or stealing another guide reservation when processed %s', (_order, staffOrder) => {
    const approachFor = customerId => ({
      customerId,
      chairId: 'ch1',
      approachCell: { x: 8, y: 10 },
      approachPoint: { x: 160, y: 200 },
    });
    const staffById = {
      'guide-a': {
        id: 'guide-a', role: 'waiter', x: 240, y: 220, path: [],
        task: {
          type: 'guide_customer', customerIds: ['party-a'], tableId: 't1',
          chairIds: ['ch1'], stage: 'approach_chairs', approaches: [approachFor('party-a')],
        },
      },
      'guide-b': {
        id: 'guide-b', role: 'waiter', x: 260, y: 220, path: [],
        task: {
          type: 'guide_customer', customerIds: ['party-b'], tableId: 't1',
          chairIds: ['ch1'], stage: 'approach_chairs', approaches: [approachFor('party-b')],
        },
      },
    };
    const state = {
      ...baseState,
      staff: staffOrder.map(id => staffById[id]),
      customers: [
        {
          id: 'party-a', state: 'guided', guideStaffId: 'guide-a', tableId: 't1',
          chairId: 'ch1', x: 160, y: 200, path: [],
        },
        {
          id: 'party-b', state: 'guided', guideStaffId: 'guide-b', tableId: 't1',
          chairId: null, x: 160, y: 200, path: [],
        },
      ],
      tables: [{
        id: 't1', status: 'reserved', reservationOwnerStaffId: 'guide-a',
        seats: 1, x: 220, y: 200,
      }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 180, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.tables[0]).toEqual({ id: 't1', status: 'occupied', seats: 1, x: 220, y: 200 });
    expect(result.staff.find(worker => worker.id === 'guide-a').task).toBeNull();
    expect(result.staff.find(worker => worker.id === 'guide-b').task).toBeNull();
    expect(result.customers.find(customer => customer.id === 'party-a')).toMatchObject({
      state: 'seated', tableId: 't1', chairId: 'ch1', guideStaffId: null,
    });
    expect(result.customers.find(customer => customer.id === 'party-b')).toMatchObject({
      state: 'leaving', tableId: null, chairId: null, guideStaffId: null,
    });
  });

  it('releases an ownerless reservation with multiple legacy guides before cancelling their linkages', () => {
    const state = {
      ...baseState,
      staff: ['a', 'b'].map(id => ({
        id: `guide-${id}`, role: 'waiter', x: 220, y: 220, path: [],
        task: {
          type: 'guide_customer', customerIds: [`party-${id}`], tableId: 't1',
          chairIds: ['ch1'], stage: 'follow_guide', approaches: [],
        },
      })),
      customers: ['a', 'b'].map(id => ({
        id: `party-${id}`, state: 'guided', guideStaffId: `guide-${id}`,
        tableId: 't1', chairId: null, x: 160, y: 200, path: [],
      })),
      tables: [{ id: 't1', status: 'reserved', seats: 1, x: 220, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 180, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.tables[0]).toEqual({ id: 't1', status: 'empty', seats: 1, x: 220, y: 200 });
    expect(result.tables[0]).not.toHaveProperty('reservationOwnerStaffId');
    expect(result.staff.every(worker => worker.task === null)).toBe(true);
    expect(result.customers.every(customer => customer.state === 'leaving'
      && customer.tableId === null
      && customer.chairId === null
      && customer.guideStaffId === null)).toBe(true);
  });

  it('does not seat a waiting customer or fall back to the table centre when no chairs exist', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360, morale: 80 }],
      customers: [{
        id: 'c1', state: 'waiting', patience: 100, happiness: 80,
        tableId: null, chairId: null, x: 860, y: 360,
      }],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [],
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toMatchObject({
      id: 'c1', state: 'waiting', tableId: null, chairId: null, x: 860, y: 360,
    });
    expect(result.customers[0]).not.toMatchObject({ x: 200, y: 220 });
    expect(result.tables[0].status).toBe('empty');
  });

  it('does not guide a party when the table has fewer distinct chairs than members', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360, morale: 80 }],
      queue: [{ id: 'q1', partyId: 'p1', partySize: 2, state: 'queued', patience: 100 }],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.queue).toHaveLength(1);
  });

  it('skips an incomplete waiting party and guides an eligible queued customer', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360, morale: 80 }],
      customers: [{ id: 'waiting1', partyId: 'waiting-party', partySize: 2, state: 'waiting', patience: 100 }],
      queue: [{ id: 'queued1', partyId: 'queued-party', partySize: 1, state: 'queued', patience: 100 }],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'guide_customer', customerId: 'queued1' });
    expect(result.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'waiting1', state: 'waiting' }),
      expect.objectContaining({ id: 'queued1', state: 'guided', tableId: 't1' }),
    ]));
  });

  it('skips an incomplete queued party and starts lower-priority cleaning', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360, morale: 80 }],
      queue: [{ id: 'queued1', partyId: 'queued-party', partySize: 2, state: 'queued', patience: 100 }],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'clean_table', tableId: 't1' });
    expect(result.queue).toEqual(state.queue);
  });

  it('keeps an assigned cashier waiter out of general waiter work while idle', () => {
    const waiter = { id: 'w1', role: 'waiter', x: 300, y: 300, morale: 80 };
    const state = {
      ...baseState,
      staff: [waiter],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'w1' }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null }],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      dishes: [{ id: 'd1', popularity: 50 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0].path.at(-1)).toEqual({ x: 42, y: 5 });
  });

  it('guides a queued customer to a reachable table when the first empty table is blocked', () => {
    const waiter = { id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 300 };
    const queued = {
      id: 'q1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const blockedCells = [
      [180, 180], [200, 180], [220, 180], [240, 180],
      [180, 200], [240, 200], [180, 220], [240, 220],
      [180, 240], [200, 240], [220, 240], [240, 240],
    ];
    const state = {
      ...baseState,
      staff: [waiter],
      queue: [queued],
      tables: [
        { id: 't1', seats: 2, status: 'empty', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'empty', x: 400, y: 300 },
      ],
      chairs: [
        ...blockedCells.map(([x, y], index) => ({ id: `ch${index}`, tableId: 't1', x, y })),
        { id: 't2ch1', tableId: 't2', x: 410, y: 280 },
        { id: 't2ch2', tableId: 't2', x: 410, y: 340 },
      ],
    };

    const result = updateStaff(state, 1);

    expect(result.queue).toHaveLength(0);
    expect(result.customers[0]).toMatchObject({ id: 'q1', state: 'guided', tableId: 't2' });
    expect(result.tables[1].status).toBe('reserved');
  });

  it('brings queued customers through a doorway instead of teleporting them inside', () => {
    const waiter = { id: 'w1', name: 'Luca', role: 'waiter', morale: 80, x: 860, y: 360 };
    const queued = { id: 'q1', state: 'queued', patience: 100, happiness: 80, tableId: null };
    const state = {
      ...baseState,
      staff: [waiter], queue: [queued],
      doors: [{ id: 'door1', y: 340 }],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0].x).toBeGreaterThan(900);
    expect(result.customers[0].path.length).toBeGreaterThan(0);
  });

  it('waiter starts the chair approach stage on arrival', () => {
    const waiter = {
      id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'guide_customer', customerId: 'c1', tableId: 't1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null, guideStaffId: 'w1', x: 860, y: 360,
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.customers[0].state).toBe('guided');
    expect(result.customers[0].guideStaffId).toBe('w1');
    expect(result.customers[0].path.length).toBeGreaterThan(0);
    expect(result.tables[0].status).toBe('reserved');
    expect(result.staff[0].task).toMatchObject({
      type: 'guide_customer', chairIds: ['ch1'], stage: 'approach_chairs',
    });
  });

  it('waits at the table instead of seating followers that have not reached their chair approaches', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 220, y: 220, path: [],
        task: {
          type: 'guide_customer', customerIds: ['c1'], tableId: 't1',
          chairIds: ['ch1'], stage: 'follow_guide', approaches: [],
        },
      }],
      customers: [{
        id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', chairId: 'ch1',
        x: 100, y: 100, path: [],
      }],
      tables: [{ id: 't1', status: 'reserved', seats: 1, x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 180, y: 200 }],
    };
    const result = updateStaff(state, 0);
    expect(result.staff[0].task).toMatchObject({
      type: 'guide_customer',
      stage: 'approach_chairs',
    });
    expect(result.customers[0]).toMatchObject({ state: 'guided', guideStaffId: 'w1' });
    expect(result.customers[0].path.at(-1)).toEqual(result.staff[0].task.approaches[0].approachCell);
    expect(result.customers[0].x).not.toBe(190);
  });

  it.each([
    ['guided state', { state: 'waiting' }],
    ['guide ownership', { guideStaffId: 'other-waiter' }],
    ['table ownership', { tableId: 'other-table' }],
  ])('cancels the whole party when a member loses %s before the chair approach transition', (_reason, changedFields) => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1', 'c2'], tableId: 't1',
        chairIds: ['ch1', 'ch2'], stage: 'follow_guide', approaches: [],
      } }],
      customers: [
        { id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', x: 100, y: 100, path: [] },
        { id: 'c2', state: 'guided', guideStaffId: 'w1', tableId: 't1', x: 120, y: 100, path: [], ...changedFields },
      ],
      tables: [{ id: 't1', status: 'reserved', seats: 2, x: 220, y: 200 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 180, y: 200 },
        { id: 'ch2', tableId: 't1', x: 280, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0].status).toBe('empty');
    expect(result.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(result.customers.every(customer => customer.guideStaffId === null
      && customer.tableId === null)).toBe(true);
  });

  it('seats the whole party atomically from distinct completed approaches', () => {
    const approaches = [
      { customerId: 'c1', chairId: 'ch1', approachCell: { x: 8, y: 10 }, approachPoint: { x: 160, y: 200 } },
      { customerId: 'c2', chairId: 'ch2', approachCell: { x: 13, y: 10 }, approachPoint: { x: 260, y: 200 } },
    ];
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1', 'c2'], tableId: 't1',
        chairIds: ['ch1', 'ch2'], stage: 'approach_chairs', approaches,
      } }],
      customers: [
        { id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', chairId: 'ch1', x: 160, y: 200, path: [] },
        { id: 'c2', state: 'guided', guideStaffId: 'w1', tableId: 't1', chairId: 'ch2', x: 260, y: 200, path: [] },
      ],
      tables: [{ id: 't1', status: 'reserved', seats: 2, x: 220, y: 200 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 180, y: 200 },
        { id: 'ch2', tableId: 't1', x: 280, y: 200 },
      ],
    };
    const result = updateStaff(state, 0);
    expect(result.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'c1', state: 'seated', x: 190, y: 210 }),
      expect.objectContaining({ id: 'c2', state: 'seated', x: 290, y: 210 }),
    ]));
    expect(result.staff[0].task).toBeNull();
  });

  it('clears every movement-recovery field when guidance cancellation starts an exact departure', () => {
    const recovery = {
      pathGoal: { x: 20, y: 20 }, usingStaticFallback: true, minimumSpacing: 2,
      stalledFor: 7, localConflictTarget: { x: 9, y: 9 }, headOnRecovery: true,
      recoveredHeadOnDetourTarget: { x: 8, y: 8 },
    };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1'], tableId: 't1',
        chairIds: ['missing-chair'], stage: 'follow_guide', approaches: [],
      } }],
      customers: [{
        id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', chairId: null,
        x: 100, y: 100, path: [{ x: 9, y: 9 }], ...recovery,
      }],
      tables: [{ id: 't1', status: 'reserved', seats: 1, x: 220, y: 200 }],
      chairs: [],
    };

    const customer = updateStaff(state, 0).customers[0];

    expect(customer).toMatchObject({ state: 'leaving', stalledFor: 0, path: [] });
    for (const field of [
      'pathGoal', 'usingStaticFallback', 'minimumSpacing', 'localConflictTarget',
      'headOnRecovery', 'recoveredHeadOnDetourTarget',
    ]) expect(customer).not.toHaveProperty(field);
  });

  it('clears every movement-recovery field when atomic seating discards movement', () => {
    const approach = {
      customerId: 'c1', chairId: 'ch1',
      approachCell: { x: 8, y: 10 }, approachPoint: { x: 160, y: 200 },
    };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1'], tableId: 't1',
        chairIds: ['ch1'], stage: 'approach_chairs', approaches: [approach],
      } }],
      customers: [{
        id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', chairId: 'ch1',
        x: 160, y: 200, path: [], stalledFor: 7, pathGoal: { x: 20, y: 20 },
        usingStaticFallback: true, minimumSpacing: 2, localConflictTarget: { x: 9, y: 9 },
        headOnRecovery: true, recoveredHeadOnDetourTarget: { x: 8, y: 8 },
      }],
      tables: [{ id: 't1', status: 'reserved', seats: 1, x: 220, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 180, y: 200 }],
    };

    const customer = updateStaff(state, 0).customers[0];

    expect(customer).toMatchObject({ state: 'seated', stalledFor: 0, path: [] });
    for (const field of [
      'pathGoal', 'usingStaticFallback', 'minimumSpacing', 'localConflictTarget',
      'headOnRecovery', 'recoveredHeadOnDetourTarget',
    ]) expect(customer).not.toHaveProperty(field);
  });

  it.each(['occupied', 'dirty'])('cancels a stale guide task without releasing a %s table', status => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1'], tableId: 't1',
        chairIds: ['ch1'], stage: 'follow_guide', approaches: [],
      } }],
      customers: [{
        id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1',
        x: 100, y: 100, path: [],
      }],
      tables: [{ id: 't1', status, seats: 1, x: 220, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 180, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0].status).toBe(status);
    expect(result.customers[0].state).toBe('leaving');
  });

  it('cancels instead of seating after an arrived stored approach becomes statically blocked', () => {
    const approach = {
      customerId: 'c1', chairId: 'ch1',
      approachCell: { x: 8, y: 10 }, approachPoint: { x: 160, y: 200 },
    };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1'], tableId: 't1',
        chairIds: ['ch1'], stage: 'approach_chairs', approaches: [approach],
      } }],
      customers: [{
        id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', chairId: 'ch1',
        x: 160, y: 200, path: [],
      }],
      tables: [{ id: 't1', status: 'reserved', seats: 1, x: 220, y: 200 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 180, y: 200 },
        { id: 'new-blocker', x: 160, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0].status).toBe('empty');
    expect(result.customers[0].state).toBe('leaving');
    expect(result.customers[0]).not.toMatchObject({ x: 190, y: 210 });
  });

  it.each([
    ['guided state', { state: 'waiting' }],
    ['guide ownership', { guideStaffId: 'other-waiter' }],
    ['table ownership', { tableId: 'other-table' }],
  ])('cancels the whole party when a member loses %s before atomic seating', (_reason, changedFields) => {
    const approaches = [
      { customerId: 'c1', chairId: 'ch1', approachCell: { x: 8, y: 10 }, approachPoint: { x: 160, y: 200 } },
      { customerId: 'c2', chairId: 'ch2', approachCell: { x: 13, y: 10 }, approachPoint: { x: 260, y: 200 } },
    ];
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1', 'c2'], tableId: 't1',
        chairIds: ['ch1', 'ch2'], stage: 'approach_chairs', approaches,
      } }],
      customers: [
        { id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', x: 160, y: 200, path: [] },
        { id: 'c2', state: 'guided', guideStaffId: 'w1', tableId: 't1', x: 260, y: 200, path: [], ...changedFields },
      ],
      tables: [{ id: 't1', status: 'reserved', seats: 2, x: 220, y: 200 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 180, y: 200 },
        { id: 'ch2', tableId: 't1', x: 280, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0].status).toBe('empty');
    expect(result.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(result.customers.every(customer => customer.guideStaffId === null
      && customer.tableId === null && customer.chairId == null)).toBe(true);
  });

  it('keeps the whole party guided until every assigned approach is complete', () => {
    const approaches = [
      { customerId: 'c1', chairId: 'ch1', approachCell: { x: 8, y: 10 }, approachPoint: { x: 160, y: 200 } },
      { customerId: 'c2', chairId: 'ch2', approachCell: { x: 13, y: 10 }, approachPoint: { x: 260, y: 200 } },
    ];
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1', 'c2'], tableId: 't1',
        chairIds: ['ch1', 'ch2'], stage: 'approach_chairs', approaches,
      } }],
      customers: [
        { id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', x: 160, y: 200, path: [] },
        { id: 'c2', state: 'guided', guideStaffId: 'w1', tableId: 't1', x: 260, y: 180, path: [{ x: 14, y: 10 }] },
      ],
      tables: [{ id: 't1', status: 'reserved', seats: 2, x: 220, y: 200 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 180, y: 200 },
        { id: 'ch2', tableId: 't1', x: 280, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.customers.every(customer => customer.state === 'guided')).toBe(true);
    expect(result.staff[0].task).toMatchObject({ stage: 'approach_chairs', approaches });
    expect(result.tables[0].status).toBe('reserved');
  });

  it('replans only a stalled follower to its stored chair approach', () => {
    const approaches = [
      { customerId: 'c1', chairId: 'ch1', approachCell: { x: 8, y: 10 }, approachPoint: { x: 160, y: 200 } },
      { customerId: 'c2', chairId: 'ch2', approachCell: { x: 13, y: 10 }, approachPoint: { x: 260, y: 200 } },
    ];
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1', 'c2'], tableId: 't1',
        chairIds: ['ch1', 'ch2'], stage: 'approach_chairs', approaches,
      } }],
      customers: [
        { id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1', x: 160, y: 200, path: [] },
        { id: 'c2', state: 'guided', guideStaffId: 'w1', tableId: 't1', x: 100, y: 100, path: [] },
      ],
      tables: [{ id: 't1', status: 'reserved', seats: 2, x: 220, y: 200 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 180, y: 200 },
        { id: 'ch2', tableId: 't1', x: 280, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.customers.find(customer => customer.id === 'c1').path).toEqual([]);
    expect(result.customers.find(customer => customer.id === 'c2').path.length).toBeGreaterThan(0);
    expect(result.customers.find(customer => customer.id === 'c2').path.at(-1)).toEqual({ x: 13, y: 10 });
    expect(result.staff[0].task).toMatchObject({ stage: 'approach_chairs', approaches });
  });

  it('routes a chair approach around stationary starter staff without deadlocking', () => {
    let state = {
      ...baseState,
      staff: [
        { id: 'starter-waiter', role: 'waiter', x: 240, y: 240, path: [], task: {
          type: 'guide_customer', customerIds: ['c1'], tableId: 't1',
          chairIds: ['ch1'], stage: 'follow_guide', approaches: [],
        } },
        { id: 'starter-host', role: 'waiter', morale: 80, x: 530, y: 360, path: [], task: null },
        { id: 'starter-janitor', role: 'janitor', morale: 80, x: 560, y: 360, path: [], task: null },
      ],
      customers: [{
        id: 'c1', state: 'guided', guideStaffId: 'starter-waiter', tableId: 't1',
        x: 620, y: 360, path: [], patience: 1000, happiness: 80,
      }],
      tables: [{ id: 't1', status: 'reserved', seats: 1, x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
    };
    const guidedPositions = [];

    state = updateStaff(state, 0);
    expect(state.staff[0].task).toMatchObject({ stage: 'approach_chairs' });
    for (let tick = 0; tick < 120 && state.customers[0].state === 'guided'; tick += 1) {
      state = updateStaff(state, 1);
      if (state.customers[0].state === 'guided') {
        guidedPositions.push({ x: state.customers[0].x, y: state.customers[0].y });
      }
    }

    expect(state.customers[0]).toMatchObject({ state: 'seated', chairId: 'ch1', x: 220, y: 190 });
    expect(state.staff[0].task).toBeNull();
    expect(state.staff.find(worker => worker.id === 'starter-host')).toMatchObject({ x: 530, y: 360 });
    expect(state.staff.find(worker => worker.id === 'starter-janitor')).toMatchObject({ x: 560, y: 360 });
    for (const position of guidedPositions) {
      expect(Math.hypot(position.x - 530, position.y - 360)).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(Math.hypot(position.x - 560, position.y - 360)).toBeGreaterThanOrEqual(16 - 1e-6);
    }
  });

  it('never teleports to a chair enclosed after guidance starts', () => {
    const initial = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 220, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1'], tableId: 't1',
        chairIds: ['ch1'], stage: 'follow_guide', approaches: [],
      } }],
      customers: [{
        id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1',
        x: 100, y: 100, path: [], patience: 100, happiness: 80,
      }],
      tables: [{ id: 't1', status: 'reserved', seats: 1, x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 180, y: 200 }],
    };
    const approaching = updateStaff(initial, 0);
    const assignment = approaching.staff[0].task.approaches[0];
    const enclosed = {
      ...approaching,
      chairs: [
        ...approaching.chairs,
        { id: 'enclosed-approach', x: assignment.approachPoint.x, y: assignment.approachPoint.y },
      ],
      customers: approaching.customers.map(customer => ({ ...customer, x: 100, y: 100, path: [] })),
    };

    let result = enclosed;
    for (let tick = 0; tick < 3; tick += 1) result = updateStaff(result, 0.1);

    const customer = result.customers[0];
    expect(Number.isFinite(customer.x) && Number.isFinite(customer.y)).toBe(true);
    expect(customer.state).not.toBe('seated');
    expect(customer).not.toMatchObject({ x: 190, y: 210 });
    expect(['guided', 'leaving']).toContain(customer.state);
  });

  it('cancels the whole guide task when chair approaches cannot be assigned', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 220, y: 220, path: [], task: {
        type: 'guide_customer', customerIds: ['c1'], tableId: 't1',
        chairIds: ['ch1'], stage: 'follow_guide', approaches: [],
      } }],
      customers: [{
        id: 'c1', state: 'guided', guideStaffId: 'w1', tableId: 't1',
        x: 100, y: 100, path: [], patience: 100, happiness: 80,
      }],
      tables: [{ id: 't1', status: 'reserved', seats: 1, x: 220, y: 180 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 200, y: 200 },
        { id: 'north', x: 200, y: 180 },
        { id: 'south', x: 200, y: 220 },
        { id: 'west', x: 180, y: 200 },
        { id: 'east', x: 220, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0].status).toBe('empty');
    expect(result.customers[0]).toMatchObject({
      state: 'leaving', tableId: null, guideStaffId: null, chairId: null,
    });
    expect(result.customers[0]).not.toMatchObject({ x: 210, y: 210 });
  });

  it('moves an admitted queued customer continuously through a door before seating', () => {
    const initial = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 860, y: 360, path: [], task: null }],
      queue: [{ id: 'q1', partyId: 'p1', partySize: 1, state: 'queued', patience: 100, happiness: 80 }],
      doors: [{ id: 'door1', y: 340 }],
      tables: [{ id: 't1', seats: 1, status: 'empty', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
    };
    const world = getRestaurantWorld(initial.restaurant || {});
    let state = updateStaff(initial, 0);
    let previous = state.customers[0];
    let firstInteriorTransition = null;
    let lastGuided = previous;
    let approachPoint = null;

    expect(previous.x).toBeGreaterThan(world.doorX);
    for (let tick = 0; tick < 3000 && state.customers[0].state !== 'seated'; tick += 1) {
      state = updateStaff(state, 0.1);
      const current = state.customers[0];
      if (current.state !== 'seated') {
        const displacement = Math.hypot(current.x - previous.x, current.y - previous.y);
        expect(displacement).toBeLessThanOrEqual(62 * 0.1 + 1e-6);
        if (!firstInteriorTransition && previous.x > world.doorX && current.x <= world.doorX) {
          firstInteriorTransition = { previous, current, displacement };
        }
        lastGuided = current;
      }
      approachPoint = state.staff[0].task?.stage === 'approach_chairs'
        ? state.staff[0].task.approaches[0].approachPoint
        : approachPoint;
      previous = current;
    }

    expect(firstInteriorTransition).not.toBeNull();
    expect(firstInteriorTransition.current.state).toBe('guided');
    expect(firstInteriorTransition.displacement).toBeGreaterThan(0);
    expect(approachPoint).not.toBeNull();
    expect(Math.hypot(lastGuided.x - approachPoint.x, lastGuided.y - approachPoint.y)).toBeLessThanOrEqual(2);
    expect(state.customers[0]).toMatchObject({ state: 'seated', chairId: 'ch1' });
  });

  it('clears a queued customer table reservation when chairs disappear during guidance', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 860, y: 360, morale: 80 }],
      queue: [{ id: 'queued1', partyId: 'queued-party', partySize: 1, state: 'queued', patience: 100, happiness: 80 }],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
    };
    const guided = updateStaff(state, 0);
    const invalidated = updateStaff({
      ...guided,
      staff: guided.staff.map(waiter => ({ ...waiter, path: [] })),
      chairs: [],
    }, 0);

    expect(invalidated.customers[0]).toMatchObject({ state: 'leaving', tableId: null });
    expect(invalidated.tables[0].status).toBe('empty');

    const customerUpdated = updateCustomers(invalidated, 0);
    expect(customerUpdated.tables[0].status).toBe('empty');
  });

  it('seats every member of a party on a chair at the same suitable table', () => {
    const waiter = {
      id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'guide_customer', customerIds: ['c1', 'c2'], partyId: 'p1', tableId: 't1' },
    };
    const customers = ['c1', 'c2'].map((id, index) => ({
      id, partyId: 'p1', partyType: 'couple', partySize: 2,
      archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
       seatTime: null, orderTime: null, eatTime: null, guideStaffId: 'w1', x: 860 + index * 10, y: 360,
    }));
    const state = {
      ...baseState,
      staff: [waiter], customers,
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 210, y: 180 },
        { id: 'ch2', tableId: 't1', x: 210, y: 260 },
      ],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    let result = state;
    for (let tick = 0; tick < 100 && result.customers.some(customer => customer.state !== 'seated'); tick += 1) {
      result = updateStaff(result, 1);
    }

    expect(result.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'c1', state: 'seated', chairId: 'ch1', x: 220, y: 190 }),
      expect.objectContaining({ id: 'c2', state: 'seated', chairId: 'ch2', x: 220, y: 270 }),
    ]));
    expect(result.tables[0].status).toBe('occupied');
  });

  it('cancels a stale guide task and releases its reserved table', () => {
    const waiter = {
      id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 800, y: 300, path: [{ x: 20, y: 20 }],
      task: { type: 'guide_customer', customerId: 'missing', tableId: 't1' },
    };
    const state = {
      ...baseState,
      staff: [waiter],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0].path).toEqual([]);
    expect(result.tables[0].status).toBe('empty');
  });

  it('cancels guidance when the target party is already leaving', () => {
    const waiter = {
      id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 800, y: 300, path: [{ x: 20, y: 20 }],
      task: { type: 'guide_customer', customerId: 'c1', customerIds: ['c1'], tableId: 't1' },
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [{ id: 'c1', state: 'leaving', tableId: 't1', patience: 0, happiness: 50 }],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0].tableId).toBeNull();
    expect(result.tables[0].status).toBe('empty');
  });

  it('keeps a party together when one member abandons guidance', () => {
    const waiter = {
      id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 800, y: 300, path: [{ x: 20, y: 20 }],
      task: { type: 'guide_customer', customerIds: ['c1', 'c2'], partyId: 'p1', tableId: 't1' },
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [
        { id: 'c1', partyId: 'p1', state: 'leaving', tableId: 't1', patience: 0, happiness: 50 },
        { id: 'c2', partyId: 'p1', state: 'guided', tableId: 't1', patience: 20, happiness: 80 },
      ],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(result.customers.every(customer => customer.tableId === null)).toBe(true);
    expect(result.tables[0].status).toBe('empty');
  });

  it('holds a waiter at a ready dirty table for the canonical wipe duration', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220, path: [], task: { type: 'clean_table', tableId: 't1' } }],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const started = updateStaff(state, 0);
    expect(started.staff[0].task).toMatchObject({ cleaningStartedAt: 100 });
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 219.999 } }, 0).tables[0].status).toBe('dirty');
    const finished = updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 220 } }, 0);
    expect(finished.tables[0].status).toBe('empty');
    expect(finished.staff[0].task).toBeNull();
  });

  it('cancels active table cleaning when a customer blocks the table', () => {
    const active = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220, path: [],
        task: { type: 'clean_table', tableId: 't1', cleaningStartedAt: 100 } }],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 150 },
    };

    const result = updateStaff({
      ...active,
      customers: [{ id: 'c1', tableId: 't1', state: 'eating' }],
    }, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0].path).toEqual([]);
    expect(result.tables[0].status).toBe('dirty');
  });

  it('cancels cleaning safely when the target table is no longer dirty', () => {
    const tables = [
      { id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 },
      { id: 't2', seats: 2, status: 'dirty', x: 360, y: 220 },
    ];
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 180, y: 220, path: [],
        task: { type: 'clean_table', tableId: 't1', cleaningStartedAt: 100 },
      }],
      tables,
      restaurant: { ...baseState.restaurant, gameTime: 102 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables).toEqual(tables);
  });

  it('allows only one idle waiter to claim a dirty table in one tick', () => {
    const state = {
      ...baseState,
      staff: [
        { id: 'w1', role: 'waiter', morale: 80, x: 800, y: 500 },
        { id: 'w2', role: 'waiter', morale: 80, x: 700, y: 500 },
      ],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff.filter(staff => staff.task?.type === 'clean_table'))
      .toHaveLength(1);
  });

  it('assigns floor dirt only to a janitor', () => {
    const state = {
      ...baseState,
      floorDirt: [{ id: 'dirt-1', x: 200, y: 200 }],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, path: [], task: null }],
    };
    expect(updateStaff(state, 0).staff[0].task)
      .toMatchObject({ type: 'clean_floor', dirtId: 'dirt-1' });
  });

  it('starts and completes floor wiping after the canonical duration', () => {
    const state = {
      ...baseState,
      floorDirt: [{ id: 'dirt-1', x: 200, y: 200 }],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 200, y: 180, path: [], task: { type: 'clean_floor', dirtId: 'dirt-1' } }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const started = updateStaff(state, 0);
    expect(started.staff[0].task).toMatchObject({ type: 'clean_floor', cleaningStartedAt: 100 });
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 219 } }, 0).floorDirt)
      .toHaveLength(1);
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 220 } }, 0).floorDirt)
      .toHaveLength(0);
  });

  it('prevents two janitors from claiming the same dirt item', () => {
    const state = {
      ...baseState,
      floorDirt: [{ id: 'dirt-1', x: 200, y: 200 }],
      staff: [
        { id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, path: [], task: null },
        { id: 'j2', role: 'janitor', morale: 80, x: 220, y: 180, path: [], task: null },
      ],
    };
    expect(updateStaff(state, 0).staff.filter(staff => staff.task?.dirtId === 'dirt-1')).toHaveLength(1);
  });

  it('selects the nearest reachable dirt item', () => {
    const state = {
      ...baseState,
      floorDirt: [
        { id: 'dirt-near', x: 200, y: 200 },
        { id: 'dirt-far', x: 400, y: 200 },
      ],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 180, y: 220, path: [], task: null }],
    };
    expect(updateStaff(state, 0).staff[0].task).toMatchObject({ type: 'clean_floor', dirtId: 'dirt-near' });
  });

  it('does not give floor-cleaning work to waiters', () => {
    const state = {
      ...baseState,
      floorDirt: [{ id: 'dirt-1', x: 200, y: 200 }],
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [], task: null }],
    };
    expect(updateStaff(state, 0).staff[0].task?.type).not.toBe('clean_floor');
  });

  it('clears a floor-cleaning task safely when its dirt disappears', () => {
    const state = {
      ...baseState,
      floorDirt: [],
      staff: [{ id: 'j1', role: 'janitor', morale: 80, x: 200, y: 180, path: [], task: { type: 'clean_floor', dirtId: 'dirt-1' } }],
    };
    expect(updateStaff(state, 0).staff[0]).toMatchObject({ task: null, path: [] });
  });

  it('does not claim a dirty table already targeted by an active cleaning task', () => {
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, x: 800, y: 500,
          path: [{ x: 20, y: 20 }], task: { type: 'clean_table', tableId: 't1' },
        },
        { id: 'w2', role: 'waiter', morale: 80, x: 700, y: 500 },
      ],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff.filter(staff => staff.task?.type === 'clean_table'))
      .toHaveLength(1);
    expect(result.staff.find(staff => staff.id === 'w2').task).toBeNull();
  });

  it('waiter does not complete order until arrival', () => {
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, drinkId: null, tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('take_order');
    // Not completed yet - waiter hasn't arrived
    expect(result.customers[0].state).toBe('seated');
    expect(result.customers[0].dishId).toBe(null);
  });

  it('times an arrived order before creating service items', () => {
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{ id: 'w1', role: 'waiter', x: 220, y: 220, path: [], task: { type: 'take_order', customerId: 'c1' } }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null, drinkId: null }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      dishes: [{ id: 'd1', price: 10, popularity: 50 }],
    };
    const started = updateStaff(state, 0);
    expect(started.staff[0].task.startedAt).toBe(100);
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 159 } }, 0).customers[0].dishId).toBeNull();
    expect(updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 160 } }, 0).customers[0].state).toBe('waiting_for_items');
  });

  it('times payment only after both actors are positioned', () => {
    const station = { id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'w1' };
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 0 },
      cashierStations: [station], dishes: [{ id: 'd1', price: 10 }],
      staff: [{ id: 'w1', role: 'waiter', x: 840, y: 100, path: [], task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' } }],
      customers: [{ id: 'c1', state: 'paying', paymentReady: true, x: 800, y: 140, dishId: 'd1', tableId: 't1' }] };
    const started = updateStaff({ ...state, customers: [{ ...state.customers[0], x: 840, y: 180 }] }, 0);
    expect(started.staff[0].task.startedAt).toBe(0);
    const displaced = updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 20 }, customers: [{ ...started.customers[0], x: 800, y: 140 }] }, 0);
    expect(displaced.staff[0].task).toBeNull();
    expect(displaced.customers[0].state).toBe('paying');
    expect(displaced.completedCustomers).toEqual([]);
    const reassigned = updateStaff({ ...displaced, restaurant: { ...displaced.restaurant, gameTime: 20 }, customers: [{ ...displaced.customers[0], x: 840, y: 180 }] }, 0);
    expect(reassigned.staff[0].task).toMatchObject({ type: 'take_payment', customerId: 'c1' });
    const restarted = updateStaff(reassigned, 0);
    expect(restarted.staff[0].task.startedAt).toBe(20);
    expect(updateStaff({ ...restarted, restaurant: { ...restarted.restaurant, gameTime: 79 } }, 0).customers[0].state).toBe('paying');
    expect(updateStaff({ ...restarted, restaurant: { ...restarted.restaurant, gameTime: 80 } }, 0).customers[0].state).toBe('leaving');
  });

  it.each([
    [0.5, ['dish'], 'd1', null],
    [0.8, ['dish', 'drink'], 'd1', 'water'],
    [0.97, ['drink'], null, 'water'],
  ])('creates customer-owned service items for roll %s', (roll, kinds, dishId, drinkId) => {
    vi.spyOn(Math, 'random').mockReturnValue(roll);
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [], task: { type: 'take_order', customerId: 'c1', startedAt: 0 } }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null, drinkId: null }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      dishes: [{ id: 'd1', popularity: 50, quality: 1, price: 12 }],
      unlockedDrinkIds: ['water'],
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({ state: 'waiting_for_items', dishId, drinkId });
    expect(result.serviceItems.map(item => item.kind)).toEqual(kinds);
    expect(result.serviceItems.every(item => item.customerId === 'c1')).toBe(true);
  });

  it('takes an order when only a canonical unlocked drink is available', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 800, y: 500 }],
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dishId: null, drinkId: null }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 220 }],
      unlockedDrinkIds: ['water'],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'take_order', customerId: 'c1' });
  });

  // --- Adapted existing tests ---

  it('waiter beginning take_order task (was: seats waiting customer)', () => {
    // With arrival-based tasks, waiters no longer seat customers.
    // A waiter sees a seated customer without dishId and starts a take_order task.
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, drinkId: null, tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes,
    };
    const result = updateStaff(state, 2);
    // Waiter starts take_order task but doesn't complete (distance)
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('take_order');
    expect(result.customers[0].state).toBe('seated');
    expect(result.customers[0].dishId).toBe(null);
  });

  // --- Unified service-item pickup ---

  it('waiter starts picking up a ready service item from its recorded service table', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1',
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 0, x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter], customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      serviceItems: [item], serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };
    const result = updateStaff(state, 2);

    expect(result.staff[0].task).toMatchObject({ type: 'pickup_service_item', serviceItemId: 'i1' });
    expect(result.serviceItems[0].state).toBe('on_service');
    expect(result.staff[0].path.length).toBeGreaterThan(0);
  });

  it("waiter paths to the ready item's recorded service counter", () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 700, y: 500 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{
        id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
        serviceTableId: 'st2', serviceSlotIndex: 0, state: 'on_service', x: 410, y: 130,
      }],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'pickup_service_item', serviceItemId: 'i1' });
    expect(result.staff[0].path.at(-1)).toEqual({ x: 26, y: 8 });
  });

  it.each(['dish', 'drink'])('picks up and carries one on-service %s', kind => {
    const item = {
      id: 'i1', kind, menuItemId: kind === 'dish' ? 'd1' : 'water',
      customerId: 'c1', tableId: 't1', serviceTableId: 'st1', serviceSlotIndex: 0,
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 120, y: 120, path: [], task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' } }],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
      serviceItems: [item],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.serviceItems[0].state).toBe('carried');
    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: 'i1' });
  });

  it('does not claim a service item that another waiter has already carried', () => {
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', serviceTableId: 'st1', serviceSlotIndex: 0, state: 'carried' };
    const state = {
      ...baseState,
       staff: [
         { id: 'w1', role: 'waiter', x: 120, y: 120, path: [], task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' } },
         { id: 'w2', role: 'waiter', carryingServiceItemId: 'i1' },
       ],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
      serviceItems: [item], serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
     expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'carried' });
  });

  it('clears stale carrier metadata before a valid pickup', () => {
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 300, y: 300,
    };
    const state = {
      ...baseState,
      staff: [
        { id: 'w1', role: 'waiter', x: 120, y: 120, path: [], task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' } },
         { id: 'w2', role: 'waiter', x: 300, y: 300, path: [{ x: 20, y: 20 }], carryingServiceItemId: 'missing' },
      ],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
      serviceItems: [item], serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

     expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: 'i1' });
     expect(result.staff[1].carryingServiceItemId).toBeNull();
     expect(result.serviceItems[0]).toMatchObject({ id: 'i1', state: 'carried' });
  });

  it('does not claim a second service item while already carrying another item', () => {
    const readyItem = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130,
    };
    const carriedItem = {
      id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
      serviceTableId: 'st1', serviceSlotIndex: 1, state: 'carried', x: 120, y: 120,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 120, y: 120, path: [],
        task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' }, carryingServiceItemId: 'i2',
      }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', tableId: 't2' },
      ],
      serviceItems: [readyItem, carriedItem],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: 'i2' });
    expect(result.serviceItems).toEqual([readyItem, carriedItem]);
  });

  it('does not claim an item from a missing service counter', () => {
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', serviceTableId: 'missing', serviceSlotIndex: 0, state: 'on_service' };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 120, y: 120, path: [], task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' } }],
      customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1' }],
      serviceItems: [item],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.serviceItems[0]).toEqual(item);
  });

  // --- Unified service-item delivery ---

  it('waiter carrying a service item paths to its customer table for delivery', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 120, y: 120, carryingServiceItemId: 'i1',
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1',
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter], customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      serviceItems: [item],
    };
    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toMatchObject({ type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' });
    expect(result.staff[0].path.length).toBeGreaterThan(0);
  });

  it('keeps carried service-item coordinates synchronised with its moving waiter', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 120, y: 120, path: [{ x: 10, y: 10 }],
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 300, y: 300 }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried', x: 150, y: 130 }],
    };

    const result = updateStaff(state, 0.5);

    expect(result.staff[0]).toMatchObject({ carryingServiceItemId: 'i1' });
    expect(result.serviceItems[0]).toMatchObject({ state: 'carried', x: result.staff[0].x, y: result.staff[0].y });
  });

  it.each([
    ['dish', 'd1', { x: 208, y: 208 }],
    ['drink', 'water', { x: 224, y: 208 }],
  ])('delivers a %s at its kind-specific table position', (kind, menuItemId, position) => {
    const item = {
      id: 'i1', kind, menuItemId, customerId: 'c1', tableId: 't1',
      state: 'carried', x: 150, y: 130,
    };
    const customer = {
      id: 'c1', state: 'waiting_for_items', dishId: kind === 'dish' ? 'd1' : null,
      drinkId: kind === 'drink' ? 'water' : null, tableId: 't1', happiness: 80,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [customer],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [item],
    };

    const result = updateStaff(state, 0);

    expect(result.serviceItems[0]).toMatchObject({ state: 'delivered', ...position });
    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.customers[0]).toMatchObject({ state: 'eating', eatTime: 100 });
  });

  it('adds dish quality, upgrade, and equipment quality only for a dish delivery', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', happiness: 50, dishId: 'd1', drinkId: null, tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' }],
      dishes: [{ id: 'd1', quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1.3, qualityBonus: 0.15 }],
      upgrades: [{ level: 2, effects: { type: 'qualityBonus', value: 0.05 } }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({ state: 'eating', happiness: 83 });
  });

  it('does not add a dish-quality bonus to a drink delivery', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', happiness: 50, dishId: null, drinkId: 'water', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{ id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1', state: 'carried' }],
      dishes: [{ id: 'd1', quality: 10, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, qualityBonus: 0.5 }],
      upgrades: [{ level: 2, effects: { type: 'qualityBonus', value: 0.5 } }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({ state: 'eating', happiness: 50 });
  });

  it('caps dish-delivery happiness at 100', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', happiness: 95, dishId: 'd1', drinkId: null, tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' }],
      dishes: [{ id: 'd1', quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, qualityBonus: 0 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0].happiness).toBe(100);
  });

  it('dish-only, drink-only, and combined customers wait for exactly their ordered items', () => {
    const deliver = (kind, customer, serviceItems) => updateStaff({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: serviceItems.find(item => item.state === 'carried').id, customerId: customer.id },
        carryingServiceItemId: serviceItems.find(item => item.state === 'carried').id,
      }],
      customers: [customer],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      serviceItems,
    }, 0);

    const dishOnly = deliver(
      'dish', { id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1' },
      [{ id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' }],
    );
    expect(dishOnly.customers[0]).toMatchObject({ state: 'eating', consumptionStartedAt: 100, consumptionDuration: 480 });

    const drinkOnly = deliver(
      'drink', { id: 'c2', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't1' },
      [{ id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't1', state: 'carried' }],
    );
    expect(drinkOnly.customers[0]).toMatchObject({ state: 'eating', consumptionStartedAt: 100, consumptionDuration: 180 });

    const combinedCustomer = { id: 'c3', state: 'waiting_for_items', dishId: 'd1', drinkId: 'water', tableId: 't1' };
    const first = deliver(
      'dish', combinedCustomer,
      [
        { id: 'i3', kind: 'dish', menuItemId: 'd1', customerId: 'c3', tableId: 't1', state: 'carried' },
        { id: 'i4', kind: 'drink', menuItemId: 'water', customerId: 'c3', tableId: 't1', state: 'ordered' },
      ],
    );
    expect(first.customers[0].state).toBe('waiting_for_items');
    expect(first.customers[0]).not.toHaveProperty('consumptionStartedAt');
    expect(first.customers[0]).not.toHaveProperty('consumptionDuration');

    const second = updateStaff({
      ...first,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: 'i4', customerId: 'c3' }, carryingServiceItemId: 'i4',
      }],
      serviceItems: first.serviceItems.map(item => item.id === 'i4' ? { ...item, state: 'carried' } : item),
    }, 0);
    expect(second.customers[0]).toMatchObject({ state: 'eating', consumptionStartedAt: 100, consumptionDuration: 600 });
  });

  it('cancels a stale take_order task when the customer is no longer seated', () => {
    const customer = { id: 'c1', state: 'paying', dishId: 'd1', drinkId: null, tableId: 't1', happiness: 80 };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'take_order', customerId: 'c1' },
      }],
      customers: [customer],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      dishes: [{ id: 'd2', popularity: 100, quality: 10, price: 1 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toEqual(customer);
  });

  it('cancels a stale take_payment task without creating revenue', () => {
    const customer = { id: 'c1', state: 'eating', dishId: 'd1', drinkId: null, tableId: 't1', happiness: 80 };
    const state = {
      ...baseState,
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, x: 840, y: 100, path: [],
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1', startedAt: 0 },
      }],
      customers: [customer], dishes: [{ id: 'd1', price: 12 }], completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier' }],
      restaurant: { ...baseState.restaurant, totalServed: 4 },
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0]).toEqual(customer);
    expect(result.completedCustomers).toEqual([]);
    expect(result.restaurant.totalServed).toBe(4);
  });

  it('cancels delivery when the target customer is leaving', () => {
    const customer = { id: 'c1', state: 'leaving', happiness: 40, dishId: 'd1', drinkId: null, tableId: 't1' };
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [customer], serviceItems: [item],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.customers[0]).toEqual(customer);
    expect(result.serviceItems[0]).toEqual({ ...item, state: 'to_clean' });
  });

  it('cancels delivery when the task service item is not carried', () => {
    const customer = { id: 'c1', state: 'waiting_for_items', happiness: 80, dishId: 'd1', drinkId: null, tableId: 't1' };
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'on_service' };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
      }],
      customers: [customer], serviceItems: [item],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.customers[0]).toEqual(customer);
    expect(result.serviceItems[0]).toEqual(item);
  });

  it('does not release a stale task service item carried by another worker', () => {
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 400, y: 400,
    };
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
          task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'missing' }, carryingServiceItemId: null,
        },
        {
          id: 'w2', role: 'waiter', morale: 80, x: 400, y: 400, path: [{ x: 10, y: 10 }],
          task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i1',
        },
      ],
      customers: [{ id: 'c1', state: 'waiting_for_items', happiness: 80, dishId: 'd1', tableId: 't1' }],
      serviceItems: [item], tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: null });
    expect(result.staff[1]).toMatchObject({ carryingServiceItemId: 'i1' });
    expect(result.serviceItems[0]).toEqual(item);
  });

  it('preserves the current worker unrelated carrier when cancelling stale delivery', () => {
    const taskItem = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'on_service' };
    const ownItem = {
      id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2',
      state: 'carried', x: 180, y: 220,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' }, carryingServiceItemId: 'i2',
      }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', happiness: 80, dishId: 'd1', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', happiness: 80, drinkId: 'water', tableId: 't2' },
      ],
      serviceItems: [taskItem, ownItem],
      tables: [
        { id: 't1', status: 'occupied', x: 200, y: 200 },
        { id: 't2', status: 'occupied', x: 360, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingServiceItemId: 'i2' });
    expect(result.serviceItems).toEqual([taskItem, ownItem]);
  });

  // --- Unified service-item cleanup ---

  it('waiter cleans a to_clean service item on arrival', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 220, y: 220, path: [], task: { type: 'clean_service_item', serviceItemId: 'i1' },
    };
    const item = {
      id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const result = updateStaff({ ...baseState, staff: [waiter], serviceItems: [item] }, 2);
    expect(result.serviceItems).toEqual([]);
    expect(result.staff[0].task).toBeNull();
  });

  it('waiter starts cleaning a to_clean service item', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const result = updateStaff({ ...baseState, staff: [waiter], serviceItems: [item] }, 2);
    expect(result.staff[0].task).toMatchObject({ type: 'clean_service_item', serviceItemId: 'i1' });
    expect(result.staff[0].path.length).toBeGreaterThan(0);
  });

  it('waiter also cleans a to_clean service item after table work', () => {
    const waiter = { id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const result = updateStaff({ ...baseState, staff: [waiter], serviceItems: [item] }, 2);
    expect(result.staff[0].task).toMatchObject({ type: 'clean_service_item', serviceItemId: 'i1' });
  });

  // --- Dish preparation ---

  it('cook paths to a compatible station for the oldest ordered dish item', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200, x: 500, y: 600 };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'ordered' },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ordered' },
      ],
      customers: [{ id: 'c1', dishId: 'd1' }, { id: 'c2', dishId: 'd1' }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toEqual({
      type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1',
    });
    expect(result.staff[0].path.length).toBeGreaterThan(0);
  });

  it('cook starts only the exact owned dish item upon arrival at its station', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 90, y: 70 };
    const cook = {
      id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200,
      x: station.x, y: station.y, path: [],
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
    };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [station],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', state: 'ordered' },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ordered' },
      ],
      customers: [{ id: 'c1', dishId: 'd1' }, { id: 'c2', dishId: 'd1' }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toEqual({
      type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1',
    });
    expect(result.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'i1', state: 'preparing', stationId: 'k1', assignedStaffId: 'c1',
        preparationStartedAt: 100,
      }),
      expect.objectContaining({ id: 'i2', customerId: 'c2', state: 'ordered' }),
    ]));
  });

  it('clears a stale prepare-dish task without touching another item', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 90, y: 70 };
    const item = { id: 'i2', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ordered' };
    const cook = {
      id: 'c1', role: 'cook', morale: 80, x: station.x, y: station.y, path: [],
      task: { type: 'prepare_dish', serviceItemId: 'missing', stationId: 'k1' },
    };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [station],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
       serviceItems: [item], customers: [{ id: 'c2', dishId: 'd1' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems).toEqual([item]);
  });

  it('does not assign a dish whose required equipment is unowned', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'c1', role: 'cook', morale: 80, x: 500, y: 600 }],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: false }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', state: 'ordered' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
  });

  it('clears an arrival task if the required equipment became unavailable', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 90, y: 70 };
    const item = { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c2', state: 'ordered' };
    const state = {
      ...baseState,
      staff: [{
        id: 'c1', role: 'cook', morale: 80, x: station.x, y: station.y, path: [],
        task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
      }],
      kitchenStations: [station],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: false }],
      serviceItems: [item], customers: [{ id: 'c2', dishId: 'd1' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.serviceItems).toEqual([item]);
  });

  it('cook does not move if no ordered dish item is pending', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200, x: 500, y: 600 };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      serviceItems: [{ id: 'i1', kind: 'dish', menuItemId: 'd1', state: 'preparing' }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
  });

  it('does not reuse a station while another dish is preparing there', () => {
    const state = {
      ...baseState,
      staff: [
        { id: 'c1', role: 'cook', morale: 80, x: 500, y: 600 },
        { id: 'c2', role: 'cook', morale: 80, x: 700, y: 600 },
      ],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [
        {
          id: 'i1', kind: 'dish', menuItemId: 'd1', state: 'preparing',
          stationId: 'k1', assignedStaffId: 'c1', preparationStartedAt: 0,
        },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', state: 'ordered' },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff.every(candidate => candidate.task == null)).toBe(true);
  });

  // --- Unified service-item priority and duplicate prevention ---

  it('prioritises on-service pickup over ordered-drink preparation and taking new orders', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't2' },
        { id: 'c3', state: 'seated', dishId: null, drinkId: null, tableId: 't3' },
      ],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'occupied', x: 360, y: 200 },
        { id: 't3', seats: 2, status: 'occupied', x: 200, y: 360 },
      ],
      dishes: [{ id: 'd1', popularity: 50, quality: 1, price: 12 }],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130 },
        { id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2', serviceTableId: null, serviceSlotIndex: null, state: 'ordered', assignedStaffId: null },
      ],
    };
    const result = updateStaff(state, 2);
    expect(result.staff[0].task).toMatchObject({ type: 'pickup_service_item', serviceItemId: 'i1' });
  });

  it('delivers a carried service item before preparing another ordered drink', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 120, y: 120, carryingServiceItemId: 'i1',
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't2' },
      ],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'occupied', x: 360, y: 200 },
      ],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' },
        { id: 'i2', kind: 'drink', menuItemId: 'water', customerId: 'c2', tableId: 't2', state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null },
      ],
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).toMatchObject({ type: 'deliver_service_item', serviceItemId: 'i1', customerId: 'c1' });
  });

  it('allows only one waiter to claim an ordered drink or service item', () => {
    const state = {
      ...baseState,
      staff: [
        { id: 'w1', role: 'waiter', morale: 80, x: 800, y: 500 },
        { id: 'w2', role: 'waiter', morale: 80, x: 700, y: 500 },
      ],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: null, drinkId: 'water', tableId: 't1' },
        { id: 'c2', state: 'waiting_for_items', dishId: 'd1', drinkId: null, tableId: 't2' },
      ],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'occupied', x: 360, y: 200 },
      ],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', tableId: 't1',
        state: 'ordered', serviceTableId: null, serviceSlotIndex: null, assignedStaffId: null,
      }],
    };
    const result = updateStaff(state, 0);
    expect(result.staff.filter(candidate => candidate.task?.type === 'prepare_drink')).toHaveLength(1);
    expect(result.staff.filter(candidate => candidate.task?.serviceItemId === 'i1')).toHaveLength(1);
  });

  // --- Existing tests preserved ---

  it('waiter guides queued customer from queue, removes from queue, and reserves table', () => {
    const waiter = { id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 860, y: 360 };
    const queuedCustomer = {
      id: 'q1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      staff: [waiter],
      queue: [queuedCustomer],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.queue.length).toBe(0);
    expect(result.customers.length).toBe(1);
    expect(result.customers[0].state).toBe('guided');
    expect(result.customers[0].guideStaffId).toBe('w1');
    expect(result.customers[0].tableId).toBe('t1');
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('guide_customer');
    expect(result.staff[0].task.customerId).toBe('q1');
    expect(result.tables[0].status).toBe('reserved');
  });

  it('guided customer follows waiter x/y during movement', () => {
    const waiter = {
      id: 'w1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 100, y: 100, path: [{ x: 10, y: 5 }],
      task: { type: 'guide_customer', customerId: 'c1', tableId: 't1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
      guideStaffId: 'w1', x: 100, y: 100,
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].x).toBeCloseTo(175, -1);
    expect(result.staff[0].y).toBeCloseTo(100, -1);
    expect(result.customers[0].x).toBeLessThanOrEqual(100);
    expect(result.customers[0].y).toBeGreaterThanOrEqual(100);
    expect(result.customers[0].guideStaffId).toBe('w1');
    expect(result.customers[0].state).toBe('guided');
  });

  it('moves a guided customer around a hard obstacle without snapping or exceeding its speed', () => {
    const dt = 0.1;
    const state = {
      ...baseState,
      staff: [{ id: 'guide', role: 'waiter', x: 220, y: 100, path: [{ x: 25, y: 5 }], task: { type: 'guide_customer', customerIds: ['c1'], tableId: 't1' } }],
      customers: [{ id: 'c1', state: 'guided', guideStaffId: 'guide', x: 100, y: 100, tableId: 't1' }],
      tables: [{ id: 't1', seats: 1, status: 'reserved', x: 700, y: 200 }],
      chairs: [{ id: 'obstacle', x: 160, y: 100, tableId: null }],
    };
    const blocked = buildBlockedCells(state);
    const initialCustomer = state.customers[0];
    const predecessorTarget = { x: state.staff[0].x - 12, y: state.staff[0].y + 12 };
    const startCell = worldToCell(initialCustomer);
    const targetCell = worldToCell(predecessorTarget);
    const obstacleCell = worldToCell(state.chairs[0]);
    const journey = [{ x: initialCustomer.x, y: initialCustomer.y }];
    let current = state;

    expect(obstacleCell.y).toBe(startCell.y);
    expect(targetCell.y).toBe(startCell.y);
    expect(obstacleCell.x).toBeGreaterThan(startCell.x);
    expect(obstacleCell.x).toBeLessThan(targetCell.x);

    for (let tick = 0; tick < 40 && current.customers[0].x <= 180; tick += 1) {
      current = updateStaff(current, dt);
      journey.push({ x: current.customers[0].x, y: current.customers[0].y });
    }

    for (let index = 1; index < journey.length; index += 1) {
      expect(Math.hypot(
        journey[index].x - journey[index - 1].x,
        journey[index].y - journey[index - 1].y,
      )).toBeLessThanOrEqual(62 * dt + 1e-6);
    }
    expect(journey.every(point => {
      const cell = worldToCell(point);
      return !blocked.has(`${cell.x},${cell.y}`);
    })).toBe(true);
    expect(journey.some(point => worldToCell(point).y !== startCell.y)).toBe(true);
    expect(journey.at(-1).x).toBeGreaterThan(180);
  });

  // --- Task 5: Duplicate claim prevention ---

  it('two waiters do not claim the same take_order customer in one tick', () => {
    const waiter1 = { id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    const takeOrderTasks = result.staff.filter(s => s.task && s.task.type === 'take_order');
    expect(takeOrderTasks.length).toBeLessThanOrEqual(1);
  });

  it('two waiters do not claim the same on-service item for pickup in one tick', () => {
    const waiter1 = { id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      serviceItems: [item],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    const pickupTasks = result.staff.filter(s => s.task && s.task.type === 'pickup_service_item');
    expect(pickupTasks.length).toBeLessThanOrEqual(1);
  });

  // --- Task 5: Cross-tick duplicate claim prevention ---

  it('waiter2 does not claim customer already in an active take_order task by waiter1', () => {
    const waiter1 = {
      id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 400, y: 500, path: [{ x: 10, y: 0 }],
      task: { type: 'take_order', customerId: 'c1' },
    };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    // waiter2 must not have claimed the same customer as waiter1's active task
    const w2Task = result.staff.find(s => s.id === 'w2').task;
    expect(w2Task).toBeNull();
  });

  it('waiter2 does not claim an item already in an active pickup_service_item task by waiter1', () => {
    const waiter1 = {
      id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 400, y: 500, path: [{ x: 10, y: 0 }],
      task: { type: 'pickup_service_item', serviceItemId: 'i1', serviceTableId: 'st1' },
    };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const item = {
      id: 'i1', kind: 'dish', menuItemId: 'd1', customerId: 'c1', tableId: 't1',
      serviceTableId: 'st1', serviceSlotIndex: 0, state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      serviceItems: [item],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    // waiter2 must not have claimed the same service item
    const w2Task = result.staff.find(s => s.id === 'w2').task;
    expect(w2Task).toBeNull();
  });

  it('cook2 does not claim an item or station already used by an active prepare-dish task', () => {
    const cook1 = {
      id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200,
      x: 400, y: 500, path: [{ x: 10, y: 0 }],
      task: { type: 'prepare_dish', serviceItemId: 'i1', stationId: 'k1' },
    };
    const cook2 = { id: 'c2', name: 'Luca', role: 'cook', skill: 5, morale: 80, salary: 200, x: 700, y: 500 };
    const state = {
      ...baseState,
      staff: [cook1, cook2],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      dishes: [{ id: 'd1', requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'd1', state: 'ordered' },
        { id: 'i2', kind: 'dish', menuItemId: 'd1', state: 'ordered' },
      ],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);

    const c2Task = result.staff.find(s => s.id === 'c2').task;
    expect(c2Task).toBeNull();
  });
});
