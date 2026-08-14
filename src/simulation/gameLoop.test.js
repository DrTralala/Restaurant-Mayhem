import { afterEach, describe, it, expect, vi } from 'vitest';
import { runTick } from './gameLoop';
import { createInitialState } from '../state/initialState';

const emptyState = {
  restaurant: { funds: 500, gameTime: 100, day: 1, openHour: 10, closeHour: 22, totalServed: 0, reputation: 2.0 },
  paused: false,
  speed: 1,
  tables: [],
  kitchenStations: [],
  kitchenQueue: [],
  queue: [],
  customers: [],
  foodItems: [],
  serviceTables: [],
  staff: [],
  dishes: [],
  equipment: [],
  upgrades: [],
  milestones: [],
  recipeSlots: 0,
  staffSlots: 0,
  completedCustomers: [],
  dailyHistory: [],
  notifications: [],
};

describe('runTick', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns same state when paused', () => {
    const state = { ...emptyState, paused: true };
    const result = runTick(state, 1);
    expect(result).toBe(state);
  });

  it('advances gameTime when not paused', () => {
    const result = runTick(emptyState, 5);
    expect(result.restaurant.gameTime).toBe(105);
  });

  it('applies speed multiplier', () => {
    const state = { ...emptyState, speed: 2 };
    const result = runTick(state, 5);
    expect(result.restaurant.gameTime).toBe(110); // 100 + 5 * 2
  });

  it('keeps a fresh-game roster and food invariant through a deterministic journey tick', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const initial = createInitialState();
    let state = {
      ...initial,
      queue: [{
        id: 'invariant-customer', partyId: 'invariant-party', partySize: 1,
        partyType: 'solo', archetype: 'regular', gender: 'female', patience: 1000,
        happiness: 80, state: 'queued', dishId: null, tableId: null, chairId: null,
      }],
    };

    for (let second = 0; second < 300 && state.foodItems.length === 0; second += 1) {
      state = runTick(state, 1);
    }

    expect(state.staff.filter(staff => staff.role === 'waiter')).toHaveLength(3);
    expect(state.staff.filter(staff => staff.role === 'host' || staff.role === 'cashier_waiter'))
      .toHaveLength(0);
    expect(state.cashierStations.filter(station => station.assignedStaffId)).toHaveLength(1);
    expect(state.restaurant.funds).toBeGreaterThanOrEqual(0);
    expect(state.foodItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerId: 'invariant-customer' }),
    ]));
    expect(new Set(state.foodItems.map(food => food.customerId)).size)
      .toBe(state.foodItems.length);

    expect(state.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'invariant-customer' }),
    ]));
  });

  it('releases stale carried food for cleanup without leaving a carrier reference', () => {
    const state = {
      ...emptyState,
      customers: [{
        id: 'c1', state: 'leaving', happiness: 40, patience: 0,
        dishId: 'd1', tableId: 't1', x: 200, y: 200, path: [],
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      foodItems: [{
        id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
        state: 'carried', x: 150, y: 130,
      }],
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, salary: 150,
        x: 180, y: 220, path: [], carryingFoodId: 'f1',
        task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' },
      }],
    };

    const result = runTick(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.foodItems).toEqual([expect.objectContaining({ id: 'f1', state: 'to_clean' })]);
  });

  it("preserves another worker's carried food through stale delivery cancellation", () => {
    const food = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 400, y: 400,
    };
    const state = {
      ...emptyState,
      customers: [{
        id: 'c1', state: 'ordering', happiness: 80, patience: 100,
        dishId: 'd1', tableId: 't1', x: 200, y: 200, path: [],
      }],
      tables: [{ id: 't1', status: 'occupied', seats: 2, x: 200, y: 200 }],
      foodItems: [food],
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, salary: 150,
          x: 180, y: 220, path: [], carryingFoodId: null,
          task: { type: 'deliver_food', foodId: 'f1', customerId: 'missing' },
        },
        {
          id: 'w2', role: 'waiter', morale: 80, salary: 150,
          x: 400, y: 400, path: [{ x: 10, y: 10 }], carryingFoodId: 'f1',
          task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' },
        },
      ],
    };

    const result = runTick(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.staff[1]).toMatchObject({ carryingFoodId: 'f1' });
    expect(result.foodItems).toEqual([food]);
  });

  it('routes a fresh-game customer through seating, exact-counter pickup, delivery, cashier, and departure', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const customerId = 'integration-customer';
    let state = createInitialState();
    state = {
      ...state,
      queue: [{
        id: customerId, partyId: 'integration-party', partySize: 1,
        partyType: 'solo', archetype: 'regular', gender: 'male', patience: 1000,
        happiness: 80, state: 'queued', dishId: null, tableId: null, chairId: null,
      }],
    };

    const milestones = {
      seated: false,
      cooking: false,
      onService: false,
      pickup: false,
      carried: false,
      delivered: false,
      eating: false,
      paying: false,
      paymentTask: false,
      leaving: false,
    };
    let seatedPosition = null;
    let pickupServiceTableId = null;
    let delivery = null;
    let payment = null;

    for (let second = 0; second < 600 && state.restaurant.totalServed === 0; second += 1) {
      state = runTick(state, 1);
      const customer = state.customers.find(candidate => candidate.id === customerId);
      const food = state.foodItems.find(candidate => candidate.customerId === customerId);
      const queueItem = state.kitchenQueue.find(item => item.customerId === customerId);

      if (customer?.state === 'seated') {
        milestones.seated = true;
        const chair = state.chairs.find(candidate => candidate.id === customer.chairId);
        const table = state.tables.find(candidate => candidate.id === customer.tableId);
        expect(chair).toBeDefined();
        expect(table).toBeDefined();
        expect(customer.x).toBe(chair.x + 10);
        expect(customer.y).toBe(chair.y + 10);
        seatedPosition = { chairId: chair.id, x: customer.x, y: customer.y, tableX: table.x, tableY: table.y };
      }

      if (queueItem?.startTime != null) milestones.cooking = true;

      if (food?.state === 'on_service') {
        milestones.onService = true;
        expect(food.serviceTableId).toBe('st1');
      }

      const pickupStaff = state.staff.find(staff =>
        staff.task?.type === 'pickup_food' && staff.task.foodId === food?.id);
      if (pickupStaff) {
        milestones.pickup = true;
        pickupServiceTableId = food.serviceTableId;
        expect(pickupServiceTableId).toBe('st1');
      }

      if (food?.state === 'carried') {
        milestones.carried = true;
        expect(state.staff).toEqual(expect.arrayContaining([
          expect.objectContaining({ carryingFoodId: food.id }),
        ]));
      }

      if (food?.state === 'delivered') {
        if (!milestones.delivered) {
          milestones.delivered = true;
          delivery = { ...food };
          expect(food).toMatchObject({ state: 'delivered', tableId: 't1', x: 208, y: 208 });
          expect(customer).toMatchObject({ state: 'eating', tableId: 't1' });
        }
      }

      if (customer?.state === 'eating') milestones.eating = true;

      if (customer?.state === 'paying') {
        milestones.paying = true;
        if (customer.cashierStationId) {
          const station = state.cashierStations.find(candidate =>
            candidate.id === customer.cashierStationId);
          expect(station?.assignedStaffId).toBeDefined();
          expect(state.staff.find(staff => staff.id === station.assignedStaffId))
            .toMatchObject({ role: 'waiter' });
        }
      }

      const paymentStaff = state.staff.find(staff =>
        staff.task?.type === 'take_payment' && staff.task.customerId === customerId);
      if (paymentStaff) {
        milestones.paymentTask = true;
        expect(state.cashierStations).toContainEqual(expect.objectContaining({
          id: paymentStaff.task.stationId,
          assignedStaffId: paymentStaff.id,
        }));
      }

      if (state.restaurant.totalServed === 1 && !payment) {
        payment = {
          funds: state.restaurant.funds,
          dailyRevenue: state.restaurant.dailyRevenue,
        };
      }
      if (customer?.state === 'leaving') milestones.leaving = true;

      expect(new Set(state.foodItems.map(item => item.customerId)).size)
        .toBe(state.foodItems.length);
    }

    expect(milestones).toEqual({
      seated: true,
      cooking: true,
      onService: true,
      pickup: true,
      carried: true,
      delivered: true,
      eating: true,
      paying: true,
      paymentTask: true,
      leaving: true,
    });
    expect(seatedPosition).toEqual(expect.objectContaining({ chairId: expect.any(String) }));
    expect(seatedPosition.x).not.toBe(seatedPosition.tableX);
    expect(seatedPosition.y).not.toBe(seatedPosition.tableY);
    expect(pickupServiceTableId).toBe('st1');
    expect(delivery).toMatchObject({ customerId, tableId: 't1', x: 208, y: 208 });
    expect(state.restaurant.totalServed).toBe(1);
    expect(payment).toEqual({ funds: 614.4, dailyRevenue: 14.4 });
    expect(state.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: customerId, state: 'leaving', departureReason: 'served' }),
    ]));
    expect(state.cashierStations.filter(station => station.assignedStaffId)).toHaveLength(1);
    expect(state.staff.filter(staff => staff.role === 'waiter')).toHaveLength(3);
  });
});
