import { describe, expect, it } from 'vitest';
import { createActorGrid, commitActorPosition } from './domainGrid';
import { createGrid } from './grid';
import { findRoute } from './router';
import { recordSeatResidency } from '../movement/seatedDeparture';
import { advanceCharacterMovementBatch, createMovementCoordinator } from './coordinator';
import { createInitialState } from '../../state/initialState';
import { hydrateState } from '../../state/persistence';
import { movementSaveSnapshot } from '../../state/movementPersistence';

function seatedWorld() {
  const table = { id: 'table', x: 200, y: 200 };
  const chair = { id: 'chair', tableId: 'table', x: 180, y: 200 };
  let customer = { id: 'customer', partyId: 'party', x: 190, y: 210, state: 'checkout_moving',
    chairId: chair.id, tableId: table.id, navigationGoal: { x: 300, y: 300 } };
  customer = { ...customer, ...recordSeatResidency(customer, chair, table) };
  return { restaurant: { expansionLevel: 1 }, tables: [table], chairs: [chair], customers: [customer], staff: [],
     kitchenStations: [], serviceTables: [], doors: [{ id: 'door', y: 340, role: 'exit' }] };
}

describe('domain-authorised navigation connectors', () => {
  it.each(['ch7', 'ch8', 'ch11', 'ch12'])('completes departure across every raster cell of offset chair %s', chairId => {
    let state = createInitialState();
    const chair = state.chairs.find(item => item.id === chairId);
    const table = state.tables.find(item => item.id === chair.tableId);
    let customer = { id: 'departing', partyId: 'party', state: 'checkout_moving',
      x: chair.x + 10, y: chair.y + 10, chairId, tableId: table.id, navigationGoal: { x: 840, y: 180 } };
    customer = { ...customer, ...recordSeatResidency(customer, chair, table) };
    state = { ...state, staff: [], customers: [customer] };
    for (let tick = 0; tick < 180 && state.customers[0].seatResidency.phase !== 'clear'; tick += 1) {
      const previous = state.customers[0];
      const result = advanceCharacterMovementBatch(state, [{ character: state.customers[0], speed: 62 }], 4 / 30);
      state = { ...state, customers: [result.moved.get('departing')], movementCoordinator: result.coordinator };
      expect(state.customers[0].seatResidency.phase).not.toBe('revoked');
      const before = { x: state.customers[0].x, y: state.customers[0].y };
      if (distance(previous, state.customers[0]) > 0) {
        state = hydrateState(JSON.parse(JSON.stringify(movementSaveSnapshot(state))), createInitialState());
      }
      expect(state.customers[0]).toMatchObject(before);
      expect(state.customers[0].seatResidency.phase).not.toBe('revoked');
    }
    expect(state.customers[0].seatResidency.phase).toBe('clear');
    expect(createGrid(state).isOpen(state.customers[0])).toBe(true);
  });
  it('allows a seated customer to leave only its own chair, without making the chair traversable from outside', () => {
    const state = seatedWorld();
    const actor = state.customers[0];
    const base = createGrid(state);
    const grid = createActorGrid(state, actor, base);
    expect(base.isOpen(actor)).toBe(false);
    expect(findRoute(grid, actor, actor.navigationGoal).status).toBe('found');
    expect(grid.segmentClear({ x: 160, y: 200 }, actor)).toBe(false);
    expect(grid.segmentClear(actor, { x: 240, y: 210 })).toBe(false);
  });

  it('persists a partial departure as domain geometry and resumes along the same connector', () => {
    let state = seatedWorld();
    const actor = state.customers[0];
    const grid = createActorGrid(state, actor, createGrid(state));
    const port = grid.neighbours(actor)[0];
    const position = { x: actor.x + (port.x - actor.x) * 0.1, y: actor.y + (port.y - actor.y) * 0.1 };
    const moved = commitActorPosition(actor, grid, position, [{ from: actor, to: port, start: 0, end: 1 }]);
    expect(moved.seatResidency).toMatchObject({ phase: 'departing', position, connector: { to: port } });
    state = JSON.parse(JSON.stringify({ ...state, customers: [moved] }));
    const resumed = createActorGrid(state, state.customers[0], createGrid(state));
    expect(resumed.neighbours(state.customers[0])).toEqual([port]);
    expect(findRoute(resumed, state.customers[0], actor.navigationGoal).status).toBe('found');
  });

  it('does not grant a chair escape to a staff member or a revoked/mismatched residency', () => {
    const state = seatedWorld();
    const actor = state.customers[0];
    for (const modified of [
      { ...actor, seatResidency: { ...actor.seatResidency, phase: 'revoked' } },
      { ...actor, chairId: 'other' },
      { ...actor, x: 191 },
    ]) {
      const changed = { ...state, customers: [modified] };
      expect(findRoute(createActorGrid(changed, modified, createGrid(changed)), modified, actor.navigationGoal).status)
        .toBe('unreachable');
    }
    const worker = { ...actor, id: 'worker', role: 'waiter' };
    const changed = { ...state, staff: [worker] };
    expect(findRoute(createActorGrid(changed, worker, createGrid(changed)), worker, actor.navigationGoal).status)
      .toBe('unreachable');
  });

  it('does not permit escape through an overlapping unrelated fixture', () => {
    const state = seatedWorld();
    state.chairs.push({ id: 'overlap', x: 180, y: 200 });
    const actor = state.customers[0];
    expect(findRoute(createActorGrid(state, actor, createGrid(state)), actor, actor.navigationGoal).status).toBe('unreachable');
  });

  it('establishes residency for an actual customer exactly at its assigned chair centre, but not an offset start', () => {
    const state = seatedWorld();
    delete state.customers[0].seatResidency;
    delete state.customers[0].seatingGeneration;
    const actor = state.customers[0];
    const grid = createActorGrid(state, actor, createGrid(state));
    expect(findRoute(grid, actor, actor.navigationGoal).status).toBe('found');
    const held = commitActorPosition(actor, grid, actor, []);
    expect(held.seatResidency).toMatchObject({ phase: 'seated', generation: held.seatingGeneration });
    const offset = { ...actor, x: 191 };
    const changed = { ...state, customers: [offset] };
    expect(findRoute(createActorGrid(changed, offset, createGrid(changed)), offset, actor.navigationGoal).status)
      .toBe('unreachable');
  });

  it('allows an actual fading customer to finish its bounded exit ray outside the ordinary grid', () => {
    const customer = { id: 'exit', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door',
      x: 993, y: 360, exitHeading: { x: 1, y: 0 }, navigationGoal: { x: 1113, y: 360 } };
    const state = { ...seatedWorld(), customers: [customer] };
    const base = createGrid(state);
    expect(base.isOpen(customer.navigationGoal)).toBe(false);
    const grid = createActorGrid(state, customer, base);
    expect(findRoute(grid, customer, customer.navigationGoal).points).toEqual([customer.navigationGoal]);
    expect(grid.segmentClear(customer.navigationGoal, customer)).toBe(false);
    expect(grid.isOpen({ x: 1200, y: 360 })).toBe(false);
    const imposter = { ...customer, id: 'worker', role: 'waiter' };
    expect(createActorGrid(state, imposter, base).isOpen(customer.navigationGoal)).toBe(false);
  });

  it('keeps a selected off-centre crossing origin for the bounded fading ray', () => {
    const customer = { id: 'off-centre-exit', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door',
      exitCrossingPoint: { x: 993, y: 340 }, x: 993, y: 340,
      navigationGoal: { x: 1113, y: 340 } };
    const state = { ...seatedWorld(), customers: [customer] };
    const base = createGrid(state);
    const grid = createActorGrid(state, customer, base);

    expect(findRoute(grid, customer, customer.navigationGoal).status).toBe('found');
    expect(findRoute(grid, customer, customer.navigationGoal).points).toEqual([customer.navigationGoal]);
  });

  it('finishes a partially completed off-centre fade after the door moves', () => {
    const customer = { id: 'moved-off-centre-exit', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door',
      exitCrossingPoint: { x: 993, y: 340 }, x: 1023, y: 340,
      navigationGoal: { x: 1113, y: 340 } };
    const state = { ...seatedWorld(), doors: [{ id: 'door', y: 440, role: 'exit' }], customers: [customer] };
    const grid = createActorGrid(state, customer, createGrid(state));

    expect(findRoute(grid, customer, customer.navigationGoal).status).toBe('found');
  });

  it('rejects uncapped outdoor fade rays but preserves bounded edge and door tails', () => {
    const uncapped = {
      id: 'uncapped', state: 'leaving', exitPhase: 'fading', exitDoorId: null,
      x: 1040, y: 360, navigationGoal: { x: 100000, y: 360 },
    };
    const edge = {
      id: 'edge', state: 'leaving', exitPhase: 'fading', exitDoorId: null,
      x: 1033, y: 360, navigationGoal: { x: 1153, y: 360 },
    };
    const movedDoor = {
      id: 'moved-door', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door',
      x: 1040, y: 360, navigationGoal: { x: 1113, y: 360 },
    };
    for (const customer of [uncapped, edge, movedDoor]) {
      const state = { ...seatedWorld(), customers: [customer] };
      const base = createGrid(state);
      const grid = createActorGrid(state, customer, base);
      const route = findRoute(grid, customer, customer.navigationGoal);
      if (customer.id === 'uncapped') {
        expect(grid.isOpen(customer.navigationGoal)).toBe(false);
        expect(route.status).toBe('unreachable');
      } else {
        expect(grid.isOpen(customer.navigationGoal)).toBe(true);
        expect(route.status).toBe('found');
      }
    }
  });

  it('executes chair departure and off-grid fading through the real coordinator at bounded speed', () => {
    let state = seatedWorld();
    state.customers.push({ id: 'exit', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door',
      x: 993, y: 360, navigationGoal: { x: 1113, y: 360 } });
    state.movementCoordinator = createMovementCoordinator();
    for (let index = 0; index < 180; index += 1) {
      const result = advanceCharacterMovementBatch(state, state.customers.map(character => ({ character, speed: 60 })), 1 / 30);
      const customers = state.customers.map(customer => {
        const moved = result.moved.get(customer.id);
        expect(distance(moved, customer)).toBeLessThanOrEqual(2 + 1e-9);
        return moved;
      });
      state = { ...state, customers, movementCoordinator: result.coordinator };
    }
    expect(state.customers[0]).toMatchObject({ x: 300, y: 300, seatResidency: { phase: 'clear' } });
    expect(state.customers[1]).toMatchObject({ x: 1113, y: 360 });
    expect([...state.movementCoordinator.statuses.values()].every(status => status.plan === 'arrived')).toBe(true);
  });

  it('keeps a valid departing customer connector authoritative through real recovery', () => {
    const table = { id: 'table', x: 200, y: 200 };
    const chair = { id: 'chair', tableId: 'table', x: 180, y: 200 };
    let customer = {
      id: 'departing', partyId: 'party', state: 'checkout_moving',
      x: chair.x + 10, y: chair.y + 10, chairId: chair.id, tableId: table.id,
      navigationGoal: { x: 300, y: 210 },
    };
    customer = { ...customer, ...recordSeatResidency(customer, chair, table) };
    const blocker = {
      id: 'blocker', role: 'waiter', x: 220, y: 210, navigationGoal: { x: 220, y: 300 },
    };
    const coordinator = createMovementCoordinator();
    coordinator.records.set('departing', {
      goal: customer.navigationGoal, waitingTicks: 8, waitingSeconds: 8 / 30,
    });
    coordinator.records.set('blocker', {
      goal: blocker.navigationGoal, waitingTicks: 8, waitingSeconds: 8 / 30,
    });
    coordinator.statuses.set('departing', {
      motion: 'holding', plan: 'waiting', reason: 'traffic', blockers: ['blocker'],
    });
    coordinator.statuses.set('blocker', {
      motion: 'holding', plan: 'waiting', reason: 'traffic', blockers: ['departing'],
    });
    const state = {
      restaurant: { expansionLevel: 1 },
      tables: [table], chairs: [chair], customers: [customer], staff: [blocker],
      kitchenStations: [], serviceTables: [], doors: [{ id: 'door', y: 340, role: 'exit' }],
      movementCoordinator: coordinator,
    };

    const batch = advanceCharacterMovementBatch(state, [
      { character: customer, speed: 62 },
      { character: blocker, speed: 0 },
    ], 1 / 30);
    const moved = batch.moved.get('departing');
    const recovery = batch.diagnostics.recoveries.get('departing');

    expect(recovery).toBeDefined();
    expect(batch.statuses.get('departing')).toMatchObject({ plan: 'moving', motion: 'traversing' });
    expect(moved).toMatchObject({ seatResidency: { phase: 'departing' } });
    expect(moved.seatResidency.connector).toMatchObject({
      from: { x: customer.x, y: customer.y },
    });
    expect(moved.seatResidency.phase).not.toBe('revoked');
  });
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
