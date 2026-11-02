import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/initialState';
import { counterParty, createCounterTestState } from '../state/highTopCounter.testSupport';
import { createHighTopCounterRecords } from '../data/highTopCounters';
import { runTick } from './gameLoop';
import { seededRandom, serviceTrace } from './realServiceHarness.testSupport';
import { hydrateState, loadState, saveState } from '../state/persistence';
import { isPhysicallySeatedCustomerState } from './customerSeating';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('real high top counter service', () => {
  it('keeps a fifth solo diner queued while four places are occupied', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(1));
    let state = createCounterTestState();
    state.restaurant.walkInsPaused = true;
    state.queue = Array.from({ length: 5 }, (_, index) => counterParty(`solo-${index}`));
    for (let tick = 0; tick < 1200; tick++) {
      state = runTick(state, { gameDt: 2, movementDt: 2 / 60 });
      if (state.tables.every(table => table.status === 'occupied') || state.navigationFault) break;
    }
    expect(state.navigationFault).toBeFalsy();
    expect(state.tables.map(table => table.status)).toEqual(['occupied', 'occupied', 'occupied', 'occupied']);
    expect(state.queue.map(party => party.partyId)).toEqual(['solo-4']);
    expect(new Set(state.customers.map(customer => customer.chairId)).size).toBe(4);
  }, 30000);

  it.each([
    [0, 500, 240], [1, 500, 240], [2, 500, 240], [3, 500, 240],
    [0, 60, 100],
  ])('serves four independent diners, reloads and cleans at rotation %s, x=%s, y=%s', (rotation, x, y) => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(1));
    const counter = { id: 'htc1', x, y, rotation };
    let state = createInitialState();
    if (x === 60) {
      // Match the saved wall-backed layout without overlapping starter fixtures.
      state.kitchenStations = state.kitchenStations.map((station, index) => ({
        ...station, x: 300 + index * 100, y: 300,
      }));
      state.serviceTables = [{ ...state.serviceTables[0], x: 340, y: 300 }];
      state.washStations = [{ ...state.washStations[0], x: 500, y: 300 }];
      state.staff = state.staff.map((worker, index) => ({ ...worker, x: 500 + index * 40, y: 400 }));
    }
    state = { ...state, restaurant: { ...state.restaurant, walkInsPaused: true },
      highTopCounters: [counter], ...createHighTopCounterRecords(counter),
      queue: Array.from({ length: 4 }, (_, index) => {
        const party = counterParty(`solo-${index}`);
        party.members[0] = { ...party.members[0], spendingTier: 'premium', spendingBudget: 120 };
        return party;
      }),
    };
    let concurrent = 0;
    let reloaded = false;
    let cleanedBesideOccupied = false;
    const delivered = new Map();
    const paid = new Set();
    const samples = [];
    for (let tick = 0; tick < 3600; tick++) {
      state = runTick(state, { gameDt: 2, movementDt: 2 / 60 });
      if (state.navigationFault) break;
      if (state.tables.some(table => table.status === 'empty') && delivered.size === 4
        && state.tables.some(table => table.status === 'occupied')) cleanedBesideOccupied = true;
      if (tick % 600 === 0) samples.push({ at: state.restaurant.gameTime,
        tables: state.tables.map(table => ({ status: table.status, assignments: table.seatingAssignments })),
        gate: state.queueAdmissionGate,
        customers: state.customers.map(customer => ({ id: customer.id, state: customer.state,
          tableId: customer.tableId, x: customer.x, y: customer.y, navigationGoal: customer.navigationGoal })),
      });
      concurrent = Math.max(concurrent, state.customers.filter(customer =>
        isPhysicallySeatedCustomerState(customer.state)).length);
      for (const item of state.serviceItems) {
        if (item.state === 'delivered') {
          const kinds = delivered.get(item.customerId) || new Set();
          kinds.add(item.kind);
          delivered.set(item.customerId, kinds);
        }
      }
      for (const customer of state.customers) if (customer.paidVisitSequence) paid.add(customer.id);
      if (!reloaded && concurrent === 4 && delivered.size > 0) {
        expect(saveState(state)).toBe(true);
        const loaded = loadState();
        expect(loaded).not.toBeNull();
        const before = state;
        state = hydrateState(loaded, createInitialState());
        expect(state.tables).toEqual(before.tables);
        expect(state.chairs).toEqual(before.chairs);
        expect(state.customers.map(customer => [customer.id, customer.tableId, customer.chairId]))
          .toEqual(before.customers.map(customer => [customer.id, customer.tableId, customer.chairId]));
        reloaded = true;
      }
      if (paid.size === 4 && state.tables.every(table => table.status === 'empty')) break;
    }
    const trace = JSON.stringify({ samples, final: serviceTrace(state) });
    expect(state.navigationFault, trace).toBeFalsy();
    expect(concurrent, trace).toBe(4);
    expect(reloaded, trace).toBe(true);
    // In the distant wall layout all diners can depart before the janitor arrives.
    if (x === 500) expect(cleanedBesideOccupied, trace).toBe(true);
    expect(paid.size, trace).toBe(4);
    expect(delivered.size, trace).toBe(4);
    expect([...delivered.values()].some(kinds => kinds.has('dish')), trace).toBe(true);
    expect([...delivered.values()].some(kinds => kinds.has('drink')), trace).toBe(true);
    expect(state.tables.map(table => table.status), trace).toEqual(['empty', 'empty', 'empty', 'empty']);
  }, 30000);
});
