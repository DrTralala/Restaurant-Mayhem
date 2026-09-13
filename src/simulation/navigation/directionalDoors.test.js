import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../state/initialState';
import { prepareCustomersForMovement, updateCustomers } from '../customers';
import { createGrid } from './grid';
import { createActorGrid } from './domainGrid';
import { findRoute } from './router';
import { getRestaurantWorld } from '../world';
import { recordSeatResidency } from '../movement/seatedDeparture';
import { planQueuePartyAdmission } from '../queueAdmission';

function stateWithCustomer(customer, doors = createInitialState().doors) {
  return {
    ...createInitialState(),
    staff: [],
    queue: [],
    customers: [customer],
    doors,
  };
}

describe('directional door routing', () => {
  it('allows ingress through the assigned entrance and blocks the exit opening', () => {
    const initial = createInitialState();
    const world = getRestaurantWorld(initial.restaurant);
    const customer = {
      id: 'entering', state: 'entering', entryDoorId: 'door1',
      x: world.queueX + 80, y: 360, navigationGoal: { x: 700, y: 200 },
    };
    const state = stateWithCustomer(customer);
    const grid = createActorGrid(state, customer, createGrid(state), {
      direction: 'ingress', doorId: 'door1',
    });

    expect(grid.isOpen({ x: world.doorX, y: 360 })).toBe(true);
    expect(grid.isOpen({ x: world.doorX, y: 460 })).toBe(false);
    expect(findRoute(grid, customer, customer.navigationGoal).status).toBe('found');
  });

  it('allows egress through the assigned exit and blocks the entrance opening', () => {
    const initial = createInitialState();
    const world = getRestaurantWorld(initial.restaurant);
    const customer = {
      id: 'leaving', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door2',
      x: 700, y: 200, navigationGoal: { x: world.queueX + 80, y: 460 },
    };
    const state = stateWithCustomer(customer);
    const grid = createActorGrid(state, customer, createGrid(state), {
      direction: 'egress', doorId: 'door2',
    });

    expect(grid.isOpen({ x: world.doorX, y: 460 })).toBe(true);
    expect(grid.isOpen({ x: world.doorX, y: 360 })).toBe(false);
    expect(findRoute(grid, customer, customer.navigationGoal).status).toBe('found');
  });

  it('blocks a selected doorway whose role does not match the movement flow', () => {
    const initial = createInitialState();
    const world = getRestaurantWorld(initial.restaurant);
    const customer = {
      id: 'entering', state: 'entering', entryDoorId: 'door2',
      x: world.queueX + 80, y: 460, navigationGoal: { x: 700, y: 200 },
    };
    const state = stateWithCustomer(customer);
    const grid = createActorGrid(state, customer, createGrid(state), {
      direction: 'ingress', doorId: 'door2',
    });

    expect(grid.isOpen({ x: world.doorX, y: 460 })).toBe(false);
    expect(grid.isOpen({ x: world.doorX, y: 360 })).toBe(false);
  });

  it('keeps a chair departure on the selected egress flow', () => {
    const initial = createInitialState();
    const table = { ...initial.tables.find(item => item.id === 't1'), x: 820, y: 360, status: 'occupied' };
    const chair = { ...initial.chairs.find(item => item.id === 'ch1'), x: 870, y: 340 };
    let customer = {
      id: 'seated-departure', partyId: 'party', state: 'leaving', exitPhase: 'to_door',
      exitDoorId: 'door2', tableId: table.id, chairId: chair.id, x: 880, y: 350, happiness: 80,
    };
    customer = { ...customer, ...recordSeatResidency(customer, chair, table) };
    let state = {
      ...initial,
      tables: initial.tables.map(item => item.id === table.id ? table : item),
      chairs: initial.chairs.map(item => item.id === chair.id ? chair : item),
      customers: [customer], staff: [], queue: [], queueSlots: [],
    };

    for (let tick = 0; tick < 4; tick += 1) {
      state = updateCustomers(state, { gameDt: 0, movementDt: 0.1 });
    }

    expect(state.customers[0]).not.toMatchObject({ x: 900, y: 360 });
    for (let tick = 0; tick < 300 && state.customers.length > 0; tick += 1) {
      state = updateCustomers(state, { gameDt: 0, movementDt: 0.1 });
    }
    expect(state.customers).toHaveLength(0);
  });

  it('replans distant actors after a role change but preserves actors crossing the old door', () => {
    const initial = createInitialState();
    const changedDoors = [
      { id: 'door1', y: 340, role: 'exit' },
      { id: 'door2', y: 440, role: 'entrance' },
    ];
    const entering = {
      id: 'entering', state: 'entering', entryDoorId: 'door1',
      x: 980, y: 360, navigationGoal: { x: 700, y: 200 },
    };
    const crossing = { ...entering, id: 'crossing', x: 907, y: 360 };

    const distant = prepareCustomersForMovement(
      stateWithCustomer(entering, changedDoors), 0,
    );
    const crossingState = prepareCustomersForMovement(
      stateWithCustomer(crossing, changedDoors), 0,
    );

    expect(distant.customers[0].entryDoorId).toBe('door2');
    expect(crossingState.customers[0].entryDoorId).toBe('door1');

    const leaving = {
      id: 'leaving', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
      x: 700, y: 200, navigationGoal: { x: 900, y: 360 },
    };
    const leavingDistant = prepareCustomersForMovement(
      stateWithCustomer(leaving, [
        { id: 'door1', y: 340, role: 'entrance' },
        { id: 'door2', y: 440, role: 'exit' },
      ]), 0,
    );
    const leavingCrossing = prepareCustomersForMovement(
      stateWithCustomer({ ...leaving, id: 'leaving-crossing', x: 907, y: 360 }, [
        { id: 'door1', y: 340, role: 'entrance' },
        { id: 'door2', y: 440, role: 'exit' },
      ]), 0,
    );

    expect(leavingDistant.customers[0].exitDoorId).toBe('door2');
    expect(leavingCrossing.customers[0].exitDoorId).toBe('door1');

    const crossingGrid = createActorGrid(
      stateWithCustomer({ ...crossing, navigationGoal: { x: 700, y: 200 } }, changedDoors),
      { ...crossing, navigationGoal: { x: 700, y: 200 } },
      createGrid(stateWithCustomer(crossing, changedDoors)),
      { direction: 'ingress', doorId: 'door1' },
    );
    expect(crossingGrid.isOpen({ x: getRestaurantWorld(initial.restaurant).doorX, y: 360 })).toBe(true);
  });

  it('preserves an off-centre in-flight crossing when the door role changes', () => {
    const crossing = {
      id: 'off-centre-crossing', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door1',
      x: 907, y: 340, navigationGoal: { x: 993, y: 340 },
    };
    const prepared = prepareCustomersForMovement(stateWithCustomer(crossing, [
      { id: 'door1', y: 340, role: 'entrance' },
      { id: 'door2', y: 440, role: 'exit' },
    ]), 0);

    expect(prepared.customers[0]).toMatchObject({
      exitDoorId: 'door1',
      exitCrossingPoint: { x: 993, y: 340 },
      navigationGoal: { x: 993, y: 340 },
    });
  });

  it('does not assign a fallback exit when no exit role exists', () => {
    const state = stateWithCustomer({
      id: 'leaving', state: 'leaving', exitPhase: 'to_door',
      x: 700, y: 200, navigationGoal: { x: 900, y: 360 },
    }, [{ id: 'door1', y: 340, role: 'entrance' }]);

    const prepared = prepareCustomersForMovement(state, 0);

    expect(prepared.customers[0].exitDoorId).toBeNull();
    expect(prepared.customers[0]).not.toHaveProperty('navigationGoal');
  });

  it('waits without an entrance and resumes when one becomes available', () => {
    const customer = {
      id: 'entering', state: 'entering', entryDoorId: 'door1',
      x: 980, y: 360, navigationGoal: { x: 700, y: 200 },
    };
    const unavailable = prepareCustomersForMovement(stateWithCustomer(customer, [
      { id: 'door1', y: 340, role: 'exit' },
    ]), 0);

    expect(unavailable.customers[0].entryDoorId).toBeNull();
    expect(unavailable.customers[0]).not.toHaveProperty('navigationGoal');

    const restored = prepareCustomersForMovement({
      ...unavailable,
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    }, 0);
    expect(restored.customers[0].entryDoorId).toBe('door1');
  });

  it('keeps an entrant already inside on its interior route when no entrance remains', () => {
    const customer = {
      id: 'inside-entrant', state: 'entering', entryDoorId: 'door1',
      x: 800, y: 200, navigationGoal: { x: 700, y: 200 },
    };
    const unavailable = prepareCustomersForMovement(stateWithCustomer(customer, [
      { id: 'door1', y: 340, role: 'exit' },
      { id: 'door2', y: 440, role: 'exit' },
    ]), 0);

    expect(unavailable.customers[0]).toMatchObject({
      state: 'entering', entryDoorId: null, navigationGoal: customer.navigationGoal,
    });
  });

  it.each([
    ['with an exit', createInitialState().doors],
    ['without an exit', [{ id: 'door1', y: 340, role: 'entrance' }]],
  ])('lets an outdoor queue abandonment fade directly %s', (_label, doors) => {
    const customer = {
      id: 'queue-member', partyId: 'party', state: 'queued',
      patience: 1, queuePatience: 0, queuePatienceMax: 1, happiness: 80,
    };
    const state = stateWithCustomer({
      id: 'unused', state: 'waiting', x: 500, y: 300,
    }, doors);
    state.customers = [];
    state.queue = [{ partyId: 'party', members: [customer] }];
    state.queueSlots = [{ memberId: customer.id, partyId: 'party', x: 973, y: 360, slot: 0 }];

    const prepared = prepareCustomersForMovement(state, 0);
    const leaving = prepared.customers[0];

    expect(prepared.queue).toEqual([]);
    expect(leaving).toMatchObject({ state: 'leaving', exitPhase: 'fading', exitDoorId: null });
    expect(leaving.navigationGoal.x).toBeGreaterThan(leaving.x);
    expect(leaving.navigationGoal.x).toBeLessThanOrEqual(1033);
  });

  it.each(['visible', 'staged'])('keeps %s queue abandoners out of the restaurant exit stream', source => {
    const member = {
      id: 'abandoner', partyId: 'party', state: 'queued',
      patience: 1, queuePatience: 0, queuePatienceMax: 1, happiness: 80,
    };
    let state = stateWithCustomer({
      id: 'served', state: 'leaving', exitPhase: 'to_door',
      x: 800, y: 460, departureReason: 'served',
    });
    if (source === 'visible') {
      state.queue = [{ partyId: 'party', members: [member] }];
    } else {
      state.queueDepartures = [{ ...member, departureReason: 'abandoned' }];
    }

    state = prepareCustomersForMovement(state, 0);
    const abandoner = state.customers.find(customer => customer.id === member.id);
    expect(abandoner).toMatchObject({ exitPhase: 'fading', exitDoorId: null });
    expect(abandoner.navigationGoal.y).toBe(abandoner.y);
    expect(state.customers.find(customer => customer.id === 'served')).toMatchObject({
      exitPhase: 'to_door', exitDoorId: 'door2',
    });
    for (let tick = 0; tick < 300 && state.customers.length > 0; tick += 1) {
      state = updateCustomers(state, { gameDt: 0, movementDt: 0.1 });
      const queuedLeaver = state.customers.find(customer => customer.id === member.id);
      if (queuedLeaver) expect(queuedLeaver.exitDoorId).toBeNull();
    }
    expect(state.customers).toEqual([]);
    expect(state.queueDepartures).toEqual([]);
  });

  it('rejects admission when the chosen entrance interior is blocked instead of using the exit', () => {
    const initial = createInitialState();
    const state = {
      ...initial,
      staff: [],
      queue: [{
        partyId: 'party',
        members: [{ id: 'queue-member', partyId: 'party', partySize: 1, state: 'queued' }],
      }],
      tables: [{ ...initial.tables[0], status: 'empty' }],
      chairs: [initial.chairs[0]],
      kitchenStations: [{ id: 'k2', equipmentId: null, x: 860, y: 340 }],
    };

    expect(planQueuePartyAdmission(state, {
      party: state.queue[0], door: state.doors[0], tableId: 't1', chairIds: ['ch1'],
    })).toBeNull();
  });
});
