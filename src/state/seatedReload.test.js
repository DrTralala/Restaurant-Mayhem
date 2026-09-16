import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from './initialState';
import { hydrateState, loadState, saveState } from './persistence';
import { movementSaveSnapshot } from './movementPersistence';
import { saveRepositoryState } from './repositorySaves';
import { moveFixtures } from './fixtureMoves';
import { runTick } from '../simulation/gameLoop';
import { resolveSelfSeating } from '../simulation/selfSeating';
import { updateCustomers } from '../simulation/customers';
import { enterCheckout, requeueCheckoutCustomer } from '../simulation/checkout';
import { createMovementCoordinator, getCharacterMovementStatus } from '../simulation/movement';
import { cellKey, worldToCell } from '../simulation/movement/navigationWorkspace';
import { createCustomerOrder } from '../simulation/serviceItems';
import { advanceConsumption } from '../simulation/consumption';
import { createStaffDutyDefaults } from '../simulation/staffSchedules';

afterEach(() => vi.restoreAllMocks());
const point = actor => ({ x: actor.x, y: actor.y });

function seated() {
  vi.spyOn(Math, 'random').mockReturnValue(1);
  const initial = createInitialState();
  const approachPoint = { x: 160, y: 200 };
  const assignment = {
    customerId: 'departure', chairId: 'ch1',
    approachCell: { x: 8, y: 10 }, approachPoint,
  };
  const state = resolveSelfSeating({
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 43200 }, queue: [], serviceItems: [],
    kitchenStations: [], serviceTables: [], washStations: [], cashierStations: [],
    tables: [{ id: 't1', status: 'reserved', seats: 1, x: 200, y: 200,
      diningPartyId: 'solo', diningCustomerIds: ['departure'], seatingAssignments: [assignment] }],
    chairs: [{ id: 'ch1', tableId: 't1', x: 180, y: 200 }],
    staff: [],
    customers: [{ id: 'departure', partyId: 'solo', partySize: 1, state: 'entering',
      tableId: 't1', chairId: 'ch1', patience: 1000, happiness: 80,
      x: approachPoint.x, y: approachPoint.y }],
  }, new Map([['departure', { plan: 'arrived' }]]));
  expect(state.customers[0]).toMatchObject({ state: 'seated', x: 190, y: 210 });
  return { ...state, doors: [{ id: 'door1', y: 340, role: 'exit' }] };
}

function checkout(state) {
  return { ...state,
    customers: [enterCheckout(state.customers[0], state.restaurant.gameTime)],
    cashierStations: [{ id: 'cashier', x: 800, y: 120, w: 40, h: 40, assignedStaffId: 'cashier-waiter' }],
    staff: [...state.staff, {
      id: 'cashier-waiter', role: 'waiter', x: 820, y: 100, task: null,
      ...createStaffDutyDefaults(),
    }],
  };
}
const advance = state => updateCustomers(state, { gameDt: 0, movementDt: 0.1 });
function reload(state) {
  saveState(state);
  const saved = loadState();
  expect(saved).not.toHaveProperty('movementCoordinator');
  const restored = hydrateState(saved, createInitialState());
  expect(restored.movementCoordinator).toEqual(createMovementCoordinator());
  expect(point(restored.customers[0])).toEqual(point(state.customers[0]));
  return restored;
}
function partial() {
  const state = advance(checkout(seated()));
  expect(point(state.customers[0])).not.toEqual({ x: 190, y: 210 });
  expect(cellKey(worldToCell(state.customers[0]))).toBe('9,10');
  return state;
}

describe('durable domain seated residency', () => {
  it('records genuine atomic seating but neither save path serialises guide epoch proofs', async () => {
    const state = seated();
    expect(state.customers[0].seatResidency).toMatchObject({ phase: 'seated', position: { x: 190, y: 210 } });
    expect(state.customers[0].seatingGeneration).toBeGreaterThan(0);
    expect(state.customers[0]).not.toHaveProperty('seatingTransition');
    saveState(state);
    const local = loadState();
    let repository;
    await saveRepositoryState(state, async (_url, options) => {
      repository = JSON.parse(options.body);
      return { ok: true, json: async () => ({ filename: 'test.json' }) };
    });
    expect(repository).toEqual(local);
    expect(local.customers[0]).not.toHaveProperty('seatingTransition');
    expect(JSON.stringify(local.customers[0].seatResidency)).not.toMatch(/Fingerprint|admissionSequence|timeOrigin|startOffset|duration/);
    expect(state.customers[0]).not.toHaveProperty('seatingTransition');
  });

  it.each(['seated', 'admitted', 'partial', 'queued', 'clear'])('resumes legitimate %s checkout residency from exact saved coordinates', phase => {
    let state = phase === 'seated' ? seated() : phase === 'admitted'
      ? advance(checkout(seated())) : partial();
    if (phase === 'queued') {
      state.customers = [requeueCheckoutCustomer(state.customers[0])];
      state.cashierStations = [];
      state = advance(state);
    }
    if (phase === 'clear') for (let tick = 0; tick < 6; tick++) state = advance(state);
    const before = point(state.customers[0]);
    state = reload(state);
    if (phase === 'seated') state = checkout(state);
    if (phase === 'queued') state.cashierStations = [{ id: 'cashier', x: 800, y: 120,
      w: 40, h: 40, assignedStaffId: 'cashier-waiter' }];
    state = advance(state);
    expect(state.customers[0]).toMatchObject({ paymentReady: false,
      navigationGoal: { x: 820, y: 180 } });
    expect(getCharacterMovementStatus(state, 'departure').plan).toBe('scheduled');
    expect(Math.hypot(state.customers[0].x - before.x, state.customers[0].y - before.y)).toBeLessThanOrEqual(6.2 + 1e-6);
    state = advance(state);
    expect(Math.hypot(state.customers[0].x - before.x, state.customers[0].y - before.y)).toBeGreaterThan(0);
    expect(Math.hypot(state.customers[0].x - before.x, state.customers[0].y - before.y)).toBeLessThanOrEqual(12.4 + 1e-6);
  });

  it('resumes a partially departed abandoning customer without switching its exact door goal', () => {
    let state = seated();
    state.customers[0] = {
      ...state.customers[0],
      state: 'leaving',
      exitPhase: 'to_door',
      exitDoorId: null,
      exitFadeProgress: 0,
      exitHeading: null,
    };
    state = updateCustomers(state, { gameDt: 1, movementDt: 0.1 });
    state = advance(state);
    const before = point(state.customers[0]);
    const goal = state.customers[0].navigationGoal;
    state = advance(reload(state));
    expect(state.customers[0].navigationGoal).toEqual(goal);
    expect(Math.hypot(state.customers[0].x - before.x, state.customers[0].y - before.y)).toBeLessThanOrEqual(5.5 + 1e-6);
    state = advance(state);
    expect(point(state.customers[0])).not.toEqual(before);
  });

  it.each(['chair', 'table', 'generation', 'actor', 'party', 'position', 'missing', 'connector', 'revoked'])('rejects %s metadata without projecting or reauthorising the saved source', variant => {
    const state = partial();
    saveState(state);
    const saved = loadState();
    // Assert genuine evidence before corruption; fabricated test-only authority cannot make this pass.
    expect(saved.customers[0].seatResidency).toBeTruthy();
    const actor = saved.customers[0];
    if (variant === 'chair') saved.chairs[0].x += 0.25;
    if (variant === 'table') saved.tables[0].x += 1;
    if (variant === 'generation') actor.seatingGeneration += 1;
    if (variant === 'actor') actor.id = 'reused-id';
    if (variant === 'party') actor.partyId = 'new-visit';
    if (variant === 'position') actor.x += 0.25;
    if (variant === 'missing') delete actor.seatResidency;
    if (variant === 'connector') actor.seatResidency.connector.to = { x: 999, y: 999 };
    if (variant === 'revoked') actor.seatResidency.phase = 'revoked';
    actor.seatingTransition = state.customers[0].seatingTransition;
    saved.movementCoordinator = state.movementCoordinator;
    const before = point(actor);
    let restored = hydrateState(saved, createInitialState());
    expect(restored.customers[0]).not.toHaveProperty('seatingTransition');
    expect(restored.movementCoordinator).toEqual(createMovementCoordinator());
    restored = advance(restored);
    expect(point(restored.customers[0])).toEqual(before);
    expect(restored.customers[0].seatResidency.phase).toBe('revoked');
    expect(restored.movementCoordinator.statuses.get(String(actor.id)).plan).toBe('unreachable');
  });

  it('carries edit/restore revocation through a save before any movement tick', () => {
    let state = advance(checkout(seated()));
    const before = point(state.customers[0]);
    state = moveFixtures(state, [{ type: 'chair', id: 'ch1', x: 210, y: 180 }]);
    expect(state.chairs[0].y).toBe(180);
    state = reload(state);
    state = moveFixtures(state, [{ type: 'chair', id: 'ch1', x: 180, y: 200 }]);
    expect(state.chairs[0].y).toBe(200);
    state = advance(reload(state));
    expect(point(state.customers[0])).toEqual(before);
    expect(state.customers[0].seatResidency.phase).toBe('revoked');
    expect(state.movementCoordinator.statuses.get('departure').plan).toBe('unreachable');
  });

  it('does not erase runtime revocation on save after a same-raster edit and stationary pause', () => {
    let state = partial();
    state.chairs[0] = { ...state.chairs[0], x: 180.25 };
    state = advance(state);
    expect(state.customers[0].seatResidency.phase).toBe('revoked');
    state.chairs[0] = { ...state.chairs[0], x: 180 };
    state.customers = [requeueCheckoutCustomer(state.customers[0])];
    state.cashierStations = [];
    state = advance(state);
    const before = point(state.customers[0]);
    state = reload(state);
    state.cashierStations = [{ id: 'cashier', x: 800, y: 120, w: 40, h: 40, assignedStaffId: 'cashier-waiter' }];
    state = advance(state);
    expect(point(state.customers[0])).toEqual(before);
    expect(state.customers[0].seatResidency.phase).toBe('revoked');
  });

  it.each(['translated', 'rotated'])('records intentional %s occupied-seat edits as a new residency, not recovery', edit => {
    let state = seated();
    const generation = state.customers[0].seatingGeneration;
    const moves = edit === 'translated' ? [{ type: 'table', id: 't1', x: 300, y: 300 }]
      : [{ type: 'chair', id: 'ch1', x: 180, y: 200, rotation: 1 }];
    state = moveFixtures(state, moves);
    const expected = edit === 'translated' ? { x: 290, y: 310 } : { x: 190, y: 210 };
    expect(point(state.customers[0])).toEqual(expected);
    expect(state.customers[0].seatingGeneration).toBe(generation + 1);
    expect(state.customers[0].seatResidency.phase).toBe('seated');
    // Both the uninterrupted old guide epoch and an empty reload epoch must accept the real placement.
    for (const current of [state, reload(state)]) {
      const prepared = advance(checkout(current));
      expect(getCharacterMovementStatus(prepared, 'departure').plan).toBe('scheduled');
      expect(Math.hypot(prepared.customers[0].x - expected.x, prepared.customers[0].y - expected.y)).toBeLessThanOrEqual(6.2 + 1e-9);
      expect(point(advance(prepared).customers[0])).not.toEqual(expected);
    }
  });

  it('retains cleared residency history after reload and ordinary open-space progress', () => {
    let state = partial();
    for (let tick = 0; tick < 6; tick++) state = advance(state);
    expect(state.customers[0].seatResidency.phase).toBe('clear');
    state = reload(state);
    state.chairs[0] = { ...state.chairs[0], x: 180.25 };
    state = advance(advance(state));
    expect(state.customers[0].seatResidency.phase).toBe('clear');
    const saved = reload(state);
    expect(saved.customers[0].seatResidency.phase).toBe('clear');
  });

  it('rejects an unrelated fixture overlapping the original occupied source before reload', () => {
    let state = partial();
    state.serviceTables = [{ id: 'foreign', x: 180, y: 200 }];
    expect(() => movementSaveSnapshot(state)).toThrow('Invalid saved navigation geometry');
  });

  it('survives repeated partial-connector replans and reloads without mutating previous plans or connector geometry', () => {
    let state = partial();
    for (let tick = 0; tick < 3; tick++) {
      state = reload(state);
      const coordinator = state.movementCoordinator;
      const plans = JSON.stringify([...coordinator.plans]);
      const connector = state.customers[0].seatResidency.connector;
      const before = point(state.customers[0]);
      state = updateCustomers(state, { gameDt: 0, movementDt: 0.02 });
      expect(point(state.customers[0])).not.toEqual(before);
      expect(JSON.stringify([...coordinator.plans])).toBe(plans);
      expect(state.customers[0].seatResidency.connector.from).toEqual(connector.from);
      expect(state.customers[0].seatResidency.connector.to).toEqual(connector.to);
      expect(Object.isFrozen(state.customers[0].seatResidency)).toBe(true);
      expect(Object.isFrozen(state.customers[0].seatResidency.connector)).toBe(true);
    }
  });

  it('rejects malformed cleared-source metadata without throwing during hydration', () => {
    let state = partial();
    for (let tick = 0; tick < 6; tick++) state = advance(state);
    saveState(state);
    const saved = loadState();
    saved.customers[0].seatResidency.connector = { unexpected: true };
    const before = point(saved.customers[0]);
    const restored = hydrateState(saved, createInitialState());
    expect(point(restored.customers[0])).toEqual(before);
    expect(restored.customers[0].seatResidency.phase).toBe('revoked');
  });


  it('finishes the real checkout journey after partial-source reload and gates readiness at the exact goal', () => {
    let state = reload(partial());
    let reached = false;
    for (let tick = 0; tick < 200; tick++) {
      state = advance(state);
      const actor = state.customers[0];
      for (const worker of state.staff) {
        expect(Math.hypot(actor.x - worker.x, actor.y - worker.y)).toBeGreaterThanOrEqual(16);
      }
      if (actor.paymentReady) {
        expect(point(actor)).toEqual({ x: 820, y: 180 });
        expect(state.movementCoordinator.statuses.get('departure').plan).toBe('arrived');
        reached = true;
        break;
      }
      if (state.movementCoordinator.statuses.get('departure').plan === 'arrived') {
        // Checkout preparation observes the prior batch, so readiness follows on the next tick.
        expect(point(actor)).toEqual({ x: 820, y: 180 });
      }
    }
    expect(reached).toBe(true);
  });
});

function coupleFixture() {
  const initial = createInitialState();
  return { ...initial,
    restaurant: { ...initial.restaurant, gameTime: 43200 }, queue: [], serviceItems: [],
    kitchenStations: [], serviceTables: [], washStations: [], cashierStations: [],
    unlockedDrinkIds: [],
    tables: [{ id: 't1', status: 'reserved', seats: 2, x: 200, y: 200,
      diningPartyId: 'mixed', diningCustomerIds: ['non-payer', 'payer'],
      seatingAssignments: [
        { customerId: 'non-payer', chairId: 'ch1', approachCell: { x: 9, y: 9 }, approachPoint: { x: 180, y: 180 } },
        { customerId: 'payer', chairId: 'ch2', approachCell: { x: 9, y: 12 }, approachPoint: { x: 180, y: 240 } },
      ] }],
    chairs: [
      { id: 'ch1', tableId: 't1', x: 210, y: 180 },
      { id: 'ch2', tableId: 't1', x: 210, y: 240 },
    ],
    staff: [],
    customers: [
      { id: 'non-payer', partyId: 'mixed', partySize: 2, partyType: 'couple', state: 'entering',
        tableId: 't1', chairId: 'ch1', patience: 1000, happiness: 80, x: 180, y: 180 },
      { id: 'payer', partyId: 'mixed', partySize: 2, partyType: 'couple', state: 'entering',
        tableId: 't1', chairId: 'ch2', patience: 1000, happiness: 80, x: 180, y: 240 },
    ],
  };
}

function seatedCouple() {
  vi.spyOn(Math, 'random').mockReturnValue(1);
  const state = resolveSelfSeating(coupleFixture(), new Map([
    ['non-payer', { plan: 'arrived' }],
    ['payer', { plan: 'arrived' }],
  ]));
  const nonPayer = state.customers.find(customer => customer.id === 'non-payer');
  const payer = state.customers.find(customer => customer.id === 'payer');
  expect(nonPayer).toMatchObject({ state: 'seated', x: 220, y: 190 });
  expect(payer).toMatchObject({ state: 'seated', x: 220, y: 250 });
  return state;
}

describe('waiting_for_party preserves genuine seated departure authority', () => {
  it('keeps unaffordable party members durably seated across movement ticks, saves and fixture edits', async () => {
    const state = seatedCouple();
    const seatedResidency = state.customers.find(customer => customer.id === 'non-payer').seatResidency;
    const order = createCustomerOrder(state, {
      ...state.customers.find(customer => customer.id === 'non-payer'),
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 6,
    }, () => 1);
    expect(order.customer.state).toBe('waiting_for_party');
    const waiting = { ...state, customers: state.customers.map(customer =>
      customer.id === 'non-payer' ? order.customer : customer) };
    const before = point(waiting.customers.find(customer => customer.id === 'non-payer'));

    // Waiting across movement ticks must keep the genuine seated authority.
    let current = waiting;
    for (let tick = 0; tick < 5; tick += 1) {
      current = advance(current);
      const member = current.customers.find(customer => customer.id === 'non-payer');
      expect(member).toMatchObject({ state: 'waiting_for_party', x: before.x, y: before.y });
      expect(member.seatResidency.phase).toBe('seated');
      expect(member.seatResidency).toEqual(seatedResidency);
      expect(member.seatingGeneration).toBe(state.customers.find(customer => customer.id === 'non-payer').seatingGeneration);
    }

    // Saving and reloading during the waiting phase via both transports.
    saveState(current);
    const saved = loadState();
    let repository;
    await saveRepositoryState(current, async (_url, options) => {
      repository = JSON.parse(options.body);
      return { ok: true, json: async () => ({ filename: 'test.json' }) };
    });
    expect(repository).toEqual(saved);
    for (const snapshot of [saved, repository]) {
      const member = snapshot.customers.find(customer => customer.id === 'non-payer');
      expect(member.seatResidency.phase).toBe('seated');
      const restored = hydrateState(snapshot, createInitialState());
      const restoredMember = restored.customers.find(customer => customer.id === 'non-payer');
      expect(point(restoredMember)).toEqual(before);
      expect(restoredMember.seatResidency.phase).toBe('seated');
      expect(restoredMember.seatResidency).toEqual(seatedResidency);
    }
  });

  it('moves an occupied table during the waiting phase into a fresh genuine residency generation', () => {
    const state = seatedCouple();
    const order = createCustomerOrder(state, {
      ...state.customers.find(customer => customer.id === 'non-payer'),
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 6,
    }, () => 1);
    const waiting = { ...state, customers: state.customers.map(customer =>
      customer.id === 'non-payer' ? order.customer : customer) };
    const nonPayer = waiting.customers.find(customer => customer.id === 'non-payer');
    const generation = nonPayer.seatingGeneration;

    const moved = moveFixtures(waiting, [{ type: 'table', id: 't1', x: 300, y: 300 }]);
    const member = moved.customers.find(customer => customer.id === 'non-payer');
    expect(point(member)).toEqual({ x: 320, y: 290 });
    expect(member.state).toBe('waiting_for_party');
    expect(member.seatingGeneration).toBe(generation + 1);
    expect(member.seatResidency.phase).toBe('seated');
  });

  it('departs the waiting member through production consumption once the payer has finished dining', () => {
    const state = seatedCouple();
    const payerOrder = createCustomerOrder(state, {
      ...state.customers.find(customer => customer.id === 'payer'),
      archetype: 'regular', spendingTier: 'value', spendingBudget: 30,
    }, () => 0.999);
    expect(payerOrder.customer.state).toBe('waiting_for_items');
    const orderedItems = payerOrder.serviceItems.filter(item => item.customerId === 'payer');
    expect(orderedItems.length).toBeGreaterThan(0);
    const nonPayerOrder = createCustomerOrder(state, {
      ...state.customers.find(customer => customer.id === 'non-payer'),
      archetype: 'regular', spendingTier: 'budget', spendingBudget: 6,
    }, () => 1);
    expect(nonPayerOrder.customer.state).toBe('waiting_for_party');

    let current = { ...state,
      serviceItems: orderedItems.map(item => ({
        ...item, state: 'delivered', consumptionStartedAt: 0,
      })),
      customers: state.customers.map(customer => {
        if (customer.id === 'payer') {
          return {
            ...payerOrder.customer, state: 'eating', tableId: 't1',
            orderedServiceItemIds: orderedItems.map(item => item.id),
            consumedServiceItemIds: [],
          };
        }
        if (customer.id === 'non-payer') return { ...nonPayerOrder.customer, tableId: 't1' };
        return customer;
      }),
      restaurant: { ...state.restaurant, gameTime: 43200 + 3600 },
    };
    for (let tick = 0; tick < 5; tick += 1) {
      current = advance(current);
      const waitingMember = current.customers.find(customer => customer.id === 'non-payer');
      expect(waitingMember).toMatchObject({ state: 'waiting_for_party' });
      expect(waitingMember.seatResidency.phase).toBe('seated');
    }
    const consumed = advanceConsumption(current);
    const payer = consumed.customers.find(customer => customer.id === 'payer');
    const nonPayer = consumed.customers.find(customer => customer.id === 'non-payer');
    expect(payer).toMatchObject({ state: 'checkout_queued' });
    expect(nonPayer).toMatchObject({ state: 'leaving', departureReason: 'menu_unaffordable' });
    expect(nonPayer.seatResidency.phase).toBe('seated');

    const before = point(nonPayer);
    let departing = consumed;
    for (let tick = 0; tick < 20; tick += 1) {
      departing = advance(departing);
    }
    const finalMember = departing.customers.find(customer => customer.id === 'non-payer');
    expect(finalMember).toBeDefined();
    expect(point(finalMember)).not.toEqual(before);
    expect(finalMember).toMatchObject({ state: 'leaving', departureReason: 'menu_unaffordable' });
    expect(['to_door', 'fading']).toContain(finalMember.exitPhase);
    expect(finalMember.seatResidency.phase).not.toBe('revoked');
  });
});
