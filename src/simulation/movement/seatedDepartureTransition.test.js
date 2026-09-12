import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../state/initialState';
import { runTick } from '../gameLoop';
import { updateStaff } from '../staff';
import { updateCustomers } from '../customers';
import { enterCheckout } from '../checkout';
import { advanceCharacterMovementBatch, getCharacterMovementStatus } from '../movement';

function approachingSeat() {
  const initial = createInitialState();
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 43200 }, queue: [], serviceItems: [],
    kitchenStations: [], serviceTables: [], washStations: [], cashierStations: [],
    tables: [{ id: 't1', status: 'reserved', seats: 1, x: 220, y: 200 }],
    chairs: [{ id: 'ch1', tableId: 't1', x: 180, y: 200 }],
    staff: [{ id: 'w1', role: 'waiter', x: 240, y: 220, task: {
      type: 'guide_customer', customerIds: ['departure'], tableId: 't1',
      chairIds: ['ch1'], stage: 'approach_chairs', approaches: [{
        customerId: 'departure', chairId: 'ch1',
        approachCell: { x: 8, y: 10 }, approachPoint: { x: 160, y: 200 },
      }],
    } }],
    customers: [{ id: 'departure', partyId: 'solo', partySize: 1, state: 'guided',
      guideStaffId: 'w1', tableId: 't1', chairId: 'ch1', patience: 0.1, happiness: 80,
      x: 160, y: 200, navigationGoal: { x: 160, y: 200 } }],
  };
}

function seat(orchestration) {
  const state = approachingSeat();
  return orchestration === 'combined'
    ? runTick(state, { gameDt: 0, movementDt: 0.1 })
    : updateStaff(state, 0);
}

afterEach(() => vi.restoreAllMocks());

describe('fresh authoritative seating departure', () => {
  it.each(['combined', 'standalone'])('departs after bounded planning following real seating through %s orchestration', orchestration => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = seat(orchestration);
    expect(state.customers[0]).toMatchObject({ state: 'seated', x: 190, y: 210, guideStaffId: null });
    expect(state.customers[0].navigationGoal).toBeUndefined();
    expect(state.customers[0].seatResidency).toMatchObject({ phase: 'seated', actorId: 'departure' });
    expect(state.customers[0]).not.toHaveProperty('seatingTransition');
    const advance = orchestration === 'combined' ? runTick : updateCustomers;
    state = advance(state, { gameDt: 1, movementDt: 0.1 });
    expect(state.customers[0]).toMatchObject({ state: 'leaving' });
    expect(Math.hypot(state.customers[0].x - 190, state.customers[0].y - 210)).toBeLessThanOrEqual(5.5 + 1e-6);
    expect(state.customers[0].exitPhase).not.toBe('fading');
    let movingTicks = 0;
    for (let tick = 0; tick < 10; tick += 1) {
      const before = state.customers[0];
      state = advance(state, { gameDt: 0, movementDt: 0.1 });
      const actor = state.customers[0];
      const displacement = Math.hypot(actor.x - before.x, actor.y - before.y);
      expect(displacement).toBeLessThanOrEqual(5.5 + 1e-6);
      if (displacement > 0) {
        movingTicks += 1;
        expect(getCharacterMovementStatus(state, 'departure')).toMatchObject({ plan: 'scheduled', motion: 'traversing' });
      }
      for (const worker of state.staff) expect(Math.hypot(actor.x - worker.x, actor.y - worker.y)).toBeGreaterThanOrEqual(16);
    }
    expect(movingTicks).toBeGreaterThanOrEqual(3);
  });

  it.each([0, 0.1])('accepts real seating then immediate checkout at movement boundary %s', seatingDt => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let state = runTick(approachingSeat(), { gameDt: 0, movementDt: seatingDt });
    expect(state.customers[0]).toMatchObject({ state: 'seated', x: 190, y: 210 });
    state.customers = [enterCheckout(state.customers[0], state.restaurant.gameTime)];
    state.cashierStations = [{ id: 'cashier', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cashier-waiter' }];
    state.staff.push({ id: 'cashier-waiter', role: 'waiter', x: 840, y: 100, task: null });
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.1 });
    expect(state.customers[0]).toMatchObject({ state: 'checkout_moving',
      navigationGoal: { x: 840, y: 180 }, paymentReady: false });
    expect(getCharacterMovementStatus(state, 'departure').plan).toBe('scheduled');
    const before = state.customers[0];
    expect(Math.hypot(before.x - 190, before.y - 210)).toBeLessThanOrEqual(6.2 + 1e-6);
    state = updateCustomers(state, { gameDt: 0, movementDt: 0.1 });
    expect(Math.hypot(state.customers[0].x - before.x, state.customers[0].y - before.y)).toBeCloseTo(6.2, 12);
  });

  it.each(['missingResidency', 'staleGeneration', 'wrongActor', 'wrongParty', 'staleChair', 'staleTable', 'revoked'])('rejects %s during departure without granting new authority', variant => {
    let state = seat('standalone');
    const actor = state.customers[0];
    const previous = actor.seatResidency;
    if (variant === 'missingResidency') { delete actor.seatResidency; actor.x += 1; }
    if (variant === 'staleGeneration') actor.seatingGeneration += 1;
    if (variant === 'wrongActor') actor.seatResidency = { ...previous, actorId: 'other' };
    if (variant === 'wrongParty') actor.seatResidency = { ...previous, partyId: 'other' };
    if (variant === 'staleChair') state.chairs[0] = { ...state.chairs[0], x: 181 };
    if (variant === 'staleTable') state.tables[0] = { ...state.tables[0], x: 221 };
    if (variant === 'revoked') actor.seatResidency = { ...previous, phase: 'revoked' };
    state.customers[0] = { ...state.customers[0], state: 'checkout_moving', navigationGoal: { x: 840, y: 180 } };
    const before = { x: actor.x, y: actor.y };
    const result = advanceCharacterMovementBatch(state, [{ character: state.customers[0], speed: 62 }], 0.1);
    state = { ...state, customers: [result.moved.get('departure')], movementCoordinator: result.coordinator };
    expect(state.customers[0]).toMatchObject(before);
    expect(getCharacterMovementStatus(state, 'departure').plan).toBe('unreachable');
  });
});
