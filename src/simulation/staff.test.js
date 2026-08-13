import { describe, it, expect } from 'vitest';
import { updateStaff } from './staff';

const baseState = {
  staff: [],
  customers: [],
  queue: [],
  tables: [],
  chairs: [],
  foodItems: [],
  kitchenQueue: [],
  kitchenStations: [],
  dishes: [],
  restaurant: { gameTime: 12 * 3600, expansionLevel: 1 },
  serviceTables: [],
};

describe('updateStaff', () => {
  it('does nothing with no staff', () => {
    const result = updateStaff(baseState, 1);
    expect(result.staff).toEqual([]);
  });

  it('assigns the front paying customer to a dual-role cashier-waiter', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'cashier_waiter', morale: 80, x: 760, y: 140 };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [
        { id: 'c1', state: 'paying', x: 780, y: 140, checkoutPosition: { x: 780, y: 140 }, dishId: 'd1', tableId: 't1', patience: 100 },
        { id: 'c2', state: 'paying', x: 700, y: 160, dishId: 'd1', tableId: 't1', patience: 100 },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'take_payment', customerId: 'c1' });
    expect(result.staff[0].path.at(-1)).toEqual({ x: 42, y: 5 });
    expect(result.customers[1].state).toBe('paying');
  });

  it('does not claim payment while another character occupies the cashier work point', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'cashier_waiter', morale: 80, x: 760, y: 140 };
    const blocker = { id: 'w1', name: 'Anna', role: 'waiter', morale: 80, x: 840, y: 100 };
    const state = {
      ...baseState,
      staff: [cashier, blocker],
      customers: [{ id: 'c1', state: 'paying', x: 780, y: 140, dishId: 'd1', tableId: 't1', patience: 100 }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0].state).toBe('paying');
  });

  it('cashier completes payment and sends the customer towards an exit', () => {
    const cashier = {
      id: 'cw1', name: 'Elena', role: 'cashier_waiter', morale: 80, x: 780, y: 140,
      path: [], task: { type: 'take_payment', customerId: 'c1' },
    };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'paying', x: 780, y: 140, checkoutPosition: { x: 780, y: 140 }, dishId: 'd1', tableId: 't1', patience: 100 }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
      restaurant: { ...baseState.restaurant, totalServed: 3 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({ state: 'leaving', departureReason: 'served' });
    expect(result.completedCustomers[0]).toMatchObject({ revenue: 14.4, tip: 2.4 });
    expect(result.restaurant.totalServed).toBe(4);
  });

  it('happy payment increases reputation with configured gain effects', () => {
    const cashier = {
      id: 'cw1', role: 'cashier_waiter', morale: 80, x: 780, y: 140,
      path: [], task: { type: 'take_payment', customerId: 'c1' },
    };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'paying', happiness: 80, dishId: 'd1', tableId: 't1' }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
      restaurant: { ...baseState.restaurant, reputation: 4.9 },
      upgrades: [{ level: 2, effects: { type: 'reputationGain', value: 0.01 } }],
    };

    const result = updateStaff(state, 0);

    expect(result.restaurant.reputation).toBeCloseTo(4.91836);
    expect(result.completedCustomers[0].tip).toBe(2.4);
  });

  it('dual-role cashier-waiter takes orders when no payment is waiting', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'cashier_waiter', morale: 80, x: 300, y: 300 };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'seated', dishId: null, tableId: 't1', patience: 100 }],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      chairs: [],
      dishes: [{ id: 'd1', popularity: 50 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'take_order', customerId: 'c1' });
  });

  it('reduces morale slowly over time', () => {
    const staff = [{ id: 's1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200 }];
    const state = { ...baseState, staff };
    const result = updateStaff(state, 10);
    expect(result.staff[0].morale).toBeLessThan(80);
  });

  // --- New arrival-based tests (Task 4) ---

  it('host starts guiding a waiting customer and reserves table', () => {
    const host = { id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150, x: 860, y: 360 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      staff: [host],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('guide_customer');
    expect(result.staff[0].task.customerId).toBe('c1');
    expect(result.staff[0].task.tableId).toBe('t1');
    expect(result.customers[0].state).toBe('guided');
    expect(result.customers[0].guideHostId).toBe('h1');
    expect(result.tables[0].status).toBe('reserved');
  });

  it('guides a queued customer to a reachable table when the first empty table is blocked', () => {
    const host = { id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150, x: 800, y: 300 };
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
      staff: [host],
      queue: [queued],
      tables: [
        { id: 't1', seats: 2, status: 'empty', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'empty', x: 400, y: 300 },
      ],
      chairs: blockedCells.map(([x, y], index) => ({ id: `ch${index}`, x, y })),
    };

    const result = updateStaff(state, 1);

    expect(result.queue).toHaveLength(0);
    expect(result.customers[0]).toMatchObject({ id: 'q1', state: 'guided', tableId: 't2' });
    expect(result.tables[1].status).toBe('reserved');
  });

  it('brings queued customers through a doorway instead of teleporting them inside', () => {
    const host = { id: 'h1', name: 'Luca', role: 'host', morale: 80, x: 860, y: 360 };
    const queued = { id: 'q1', state: 'queued', patience: 100, happiness: 80, tableId: null };
    const state = {
      ...baseState,
      staff: [host], queue: [queued],
      doors: [{ id: 'door1', y: 340 }],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0].x).toBeGreaterThan(900);
    expect(result.customers[0].path.length).toBeGreaterThan(0);
  });

  it('host completes seating on arrival', () => {
    const host = {
      id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'guide_customer', customerId: 'c1', tableId: 't1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null, guideHostId: 'h1', x: 860, y: 360,
    };
    const state = {
      ...baseState,
      staff: [host],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.customers[0].state).toBe('seated');
    expect(result.customers[0].guideHostId).toBeNull();
    expect(result.customers[0].seatTime).toBe(100);
    expect(result.customers[0].chairId).toBe('ch1');
    expect(result.tables[0].status).toBe('occupied');
    expect(result.staff[0].task).toBeNull();
  });

  it('seats every member of a party on a chair at the same suitable table', () => {
    const host = {
      id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'guide_customer', customerIds: ['c1', 'c2'], partyId: 'p1', tableId: 't1' },
    };
    const customers = ['c1', 'c2'].map((id, index) => ({
      id, partyId: 'p1', partyType: 'couple', partySize: 2,
      archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null, guideHostId: 'h1', x: 860 + index * 10, y: 360,
    }));
    const state = {
      ...baseState,
      staff: [host], customers,
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 210, y: 180 },
        { id: 'ch2', tableId: 't1', x: 210, y: 260 },
      ],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 1);

    expect(result.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'c1', state: 'seated', chairId: 'ch1', x: 220, y: 190 }),
      expect.objectContaining({ id: 'c2', state: 'seated', chairId: 'ch2', x: 220, y: 270 }),
    ]));
    expect(result.tables[0].status).toBe('occupied');
  });

  it('cancels a stale guide task and releases its reserved table', () => {
    const host = {
      id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150,
      x: 800, y: 300, path: [{ x: 20, y: 20 }],
      task: { type: 'guide_customer', customerId: 'missing', tableId: 't1' },
    };
    const state = {
      ...baseState,
      staff: [host],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
    expect(result.staff[0].path).toEqual([]);
    expect(result.tables[0].status).toBe('empty');
  });

  it('cancels guidance when the target party is already leaving', () => {
    const host = {
      id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150,
      x: 800, y: 300, path: [{ x: 20, y: 20 }],
      task: { type: 'guide_customer', customerId: 'c1', customerIds: ['c1'], tableId: 't1' },
    };
    const state = {
      ...baseState,
      staff: [host],
      customers: [{ id: 'c1', state: 'leaving', tableId: 't1', patience: 0, happiness: 50 }],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
    expect(result.tables[0].status).toBe('empty');
  });

  it('keeps a party together when one member abandons guidance', () => {
    const host = {
      id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150,
      x: 800, y: 300, path: [{ x: 20, y: 20 }],
      task: { type: 'guide_customer', customerIds: ['c1', 'c2'], partyId: 'p1', tableId: 't1' },
    };
    const state = {
      ...baseState,
      staff: [host],
      customers: [
        { id: 'c1', partyId: 'p1', state: 'leaving', tableId: 't1', patience: 0, happiness: 50 },
        { id: 'c2', partyId: 'p1', state: 'guided', tableId: 't1', patience: 20, happiness: 80 },
      ],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
    };

    const result = updateStaff(state, 1);

    expect(result.staff[0].task).toBeNull();
    expect(result.customers.every(customer => customer.state === 'leaving')).toBe(true);
    expect(result.tables[0].status).toBe('empty');
  });

  it('host cleans dirty table on arrival', () => {
    const host = {
      id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'clean_table', tableId: 't1' },
    };
    const state = {
      ...baseState,
      staff: [host],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.tables[0].status).toBe('empty');
    expect(result.staff[0].task).toBeNull();
  });

  it('waiter does not complete order until arrival', () => {
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
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

  it('waiter completes order on arrival', () => {
    const waiter = {
      id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'take_order', customerId: 'c1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
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
    expect(result.customers[0].state).toBe('ordering');
    expect(result.customers[0].dishId).toBe('d1');
    expect(result.customers[0].orderTime).toBe(100);
    expect(result.staff[0].task).toBeNull();
  });

  it('selects a better-value dish over an overpriced popular dish', () => {
    const waiter = {
      id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220,
      path: [], task: { type: 'take_order', customerId: 'c1' },
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [{ id: 'c1', state: 'seated', dishId: null, tableId: 't1', patience: 100 }],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 220 }],
      dishes: [
        { id: 'good-value', popularity: 70, quality: 7, price: 20 },
        { id: 'overpriced', popularity: 90, quality: 8, price: 100 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0].dishId).toBe('good-value');
  });

  // --- Adapted existing tests ---

  it('waiter beginning take_order task (was: seats waiting customer)', () => {
    // With arrival-based tasks, waiters no longer seat customers.
    // A waiter sees a seated customer without dishId and starts a take_order task.
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
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

  it('waiter completes take_order on arrival (was: takes order from seated customer)', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'take_order', customerId: 'c1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't1', tipAmount: 0,
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
    const result = updateStaff(state, 2);
    expect(result.customers[0].state).toBe('ordering');
    expect(result.customers[0].dishId).toBe('d1');
    expect(result.customers[0].orderTime).toBe(100);
    expect(result.staff[0].task).toBeNull();
  });

  // --- Task 5: Waiter food pickup ---

  it('waiter starts picking up ready food from service table', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      foodItems: [foodItem],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };
    const result = updateStaff(state, 2);
    // Waiter should start moving to pick up food
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('pickup_food');
    expect(result.staff[0].task.foodId).toBe('f1');
    expect(result.foodItems[0].state).toBe('on_service'); // not picked up yet
    expect(result.staff[0].path.length).toBeGreaterThan(0);
  });

  it('waiter completes food pickup on arrival at service table', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 120, y: 120, path: [], task: { type: 'pickup_food', foodId: 'f1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 1);
    expect(result.foodItems[0].state).toBe('carried');
    expect(result.staff[0].carryingFoodId).toBe('f1');
    expect(result.staff[0].task).toBeNull();
  });

  // --- Task 5: Waiter food delivery ---

  it('waiter carrying food paths to customer table for delivery', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 120, y: 120, carryingFoodId: 'f1',
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('deliver_food');
    expect(result.staff[0].task.foodId).toBe('f1');
    expect(result.staff[0].task.customerId).toBe('c1');
    expect(result.staff[0].path.length).toBeGreaterThan(0);
  });

  it('waiter completes food delivery on arrival, customer starts eating', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [],
      task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' },
      carryingFoodId: 'f1',
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 }],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 1);
    expect(result.foodItems[0].state).toBe('delivered');
    expect(result.staff[0].carryingFoodId).toBeNull();
    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0].state).toBe('eating');
    expect(result.customers[0].eatTime).toBe(100);
  });

  // --- Task 5: Food cleanup ---

  it('waiter cleans to_clean food on arrival', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 220, y: 220, path: [], task: { type: 'clean_food', foodId: 'f1' },
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const state = {
      ...baseState,
      staff: [waiter],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 2);
    expect(result.foodItems.length).toBe(0);
    expect(result.staff[0].task).toBeNull();
  });

  it('waiter starts cleaning to_clean food', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const state = {
      ...baseState,
      staff: [waiter],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 2);
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('clean_food');
    expect(result.staff[0].task.foodId).toBe('f1');
    expect(result.staff[0].path.length).toBeGreaterThan(0);
  });

  it('host also cleans to_clean food', () => {
    const host = { id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'to_clean', x: 220, y: 220,
    };
    const state = {
      ...baseState,
      staff: [host],
      foodItems: [foodItem],
    };
    const result = updateStaff(state, 2);
    // Host prioritises other tasks; with no customers or dirty tables, should clean food
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('clean_food');
    expect(result.staff[0].task.foodId).toBe('f1');
  });

  // --- Task 5: Cook movement ---

  it('cook paths to kitchen station for queued order with null startTime', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200, x: 500, y: 600 };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: null, completedAt: null }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('cook_order');
    expect(result.staff[0].task.stationId).toBe('k1');
    expect(result.staff[0].path.length).toBeGreaterThan(0);
  });

  it('cook sets startTime on queue item upon arrival at station', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 90, y: 70 };
    const cook = {
      id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200,
      x: station.x, y: station.y, path: [],
      task: { type: 'cook_order', stationId: 'k1', customerId: 'c1' },
    };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [station],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: null, completedAt: null }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].task).toBeNull();
    // startTime should now be set on the queue item
    expect(result.kitchenQueue[0].startTime).toBe(100);
  });

  it('cook does not move if no pending queue items', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200, x: 500, y: 600 };
    const state = {
      ...baseState,
      staff: [cook],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      kitchenQueue: [{ customerId: 'c1', dishId: 'd1', stationId: 'k1', startTime: 50, completedAt: null }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    // startTime already set, so no cook_order task
    expect(result.staff[0].task).toBeNull();
  });

  // --- Task 5: Duplicate food prevention ---

  it('waiter with food available prioritises pickup over taking new orders', () => {
    const waiter = { id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const waitingCustomer = {
      id: 'c2', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const orderingCustomer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: 1, orderTime: 1, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter],
      customers: [waitingCustomer, orderingCustomer],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'empty', x: 360, y: 200 },
      ],
      foodItems: [foodItem],
      dishes,
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };
    const result = updateStaff(state, 2);
    // Waiter prioritises food pickup over taking new orders
    expect(result.staff[0].task.type).toBe('pickup_food');
    expect(result.foodItems[0].state).toBe('on_service'); // not delivered yet
  });

  it('waiter does not take new orders while carrying food', () => {
    const waiter = {
      id: 's1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 120, y: 120, carryingFoodId: 'f1',
    };
    const orderingCustomer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'ordering', dishId: 'd1', tableId: 't1', tipAmount: 0,
      seatTime: 100, orderTime: 100, eatTime: null,
    };
    const seatedCustomer = {
      id: 'c2', archetype: 'regular', patience: 100, happiness: 80,
      state: 'seated', dishId: null, tableId: 't2', tipAmount: 0,
      seatTime: 1, orderTime: null, eatTime: null,
    };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 150, y: 130,
    };
    const dishes = [{ id: 'd1', name: 'Pizza', price: 12, prepTime: 180, quality: 5, popularity: 80, cuisine: 'italian', requiredEquipmentId: null }];
    const state = {
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      staff: [waiter],
      customers: [orderingCustomer, seatedCustomer],
      tables: [
        { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 },
        { id: 't2', seats: 2, status: 'occupied', x: 360, y: 200 },
      ],
      foodItems: [foodItem],
      dishes,
    };
    const result = updateStaff(state, 1);
    // Waiter must deliver carrying food, not take new order
    expect(result.staff[0].task.type).toBe('deliver_food');
  });

  // --- Existing tests preserved ---

  it('host guides queued customer from queue, removes from queue, and reserves table', () => {
    const host = { id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150, x: 860, y: 360 };
    const queuedCustomer = {
      id: 'q1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      staff: [host],
      queue: [queuedCustomer],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.queue.length).toBe(0);
    expect(result.customers.length).toBe(1);
    expect(result.customers[0].state).toBe('guided');
    expect(result.customers[0].guideHostId).toBe('h1');
    expect(result.customers[0].tableId).toBe('t1');
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('guide_customer');
    expect(result.staff[0].task.customerId).toBe('q1');
    expect(result.tables[0].status).toBe('reserved');
  });

  it('guided customer follows host x/y during movement', () => {
    const host = {
      id: 'h1', name: 'Luca', role: 'host', skill: 5, morale: 80, salary: 150,
      x: 100, y: 100, path: [{ x: 10, y: 5 }],
      task: { type: 'guide_customer', customerId: 'c1', tableId: 't1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
      guideHostId: 'h1', x: 100, y: 100,
    };
    const state = {
      ...baseState,
      staff: [host],
      customers: [customer],
      tables: [{ id: 't1', seats: 2, status: 'reserved', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    expect(result.staff[0].x).toBeCloseTo(165, -1);
    expect(result.staff[0].y).toBeCloseTo(100, -1);
    expect(result.customers[0].x).toBeCloseTo(165 - 12, -1);
    expect(result.customers[0].y).toBeCloseTo(100 + 12, -1);
    expect(result.customers[0].guideHostId).toBe('h1');
    expect(result.customers[0].state).toBe('guided');
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

  it('two waiters do not claim the same on_service food for pickup in one tick', () => {
    const waiter1 = { id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      foodItems: [foodItem],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    const pickupTasks = result.staff.filter(s => s.task && s.task.type === 'pickup_food');
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

  it('waiter2 does not claim food already in an active pickup_food task by waiter1', () => {
    const waiter1 = {
      id: 'w1', name: 'Anna', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 400, y: 500, path: [{ x: 10, y: 0 }],
      task: { type: 'pickup_food', foodId: 'f1' },
    };
    const waiter2 = { id: 'w2', name: 'Bob', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 700, y: 500 };
    const foodItem = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'on_service', x: 150, y: 130,
    };
    const state = {
      ...baseState,
      staff: [waiter1, waiter2],
      foodItems: [foodItem],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    // waiter2 must not have claimed the same food
    const w2Task = result.staff.find(s => s.id === 'w2').task;
    expect(w2Task).toBeNull();
  });

  it('cook2 does not claim queue item already in an active cook_order task by cook1', () => {
    const cook1 = {
      id: 'c1', name: 'Marco', role: 'cook', skill: 5, morale: 80, salary: 200,
      x: 400, y: 500, path: [{ x: 10, y: 0 }],
      task: { type: 'cook_order', stationId: 'k1', customerId: 'cust1' },
    };
    const cook2 = { id: 'c2', name: 'Luca', role: 'cook', skill: 5, morale: 80, salary: 200, x: 700, y: 500 };
    const state = {
      ...baseState,
      staff: [cook1, cook2],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1', x: 90, y: 70 }],
      kitchenQueue: [{ customerId: 'cust1', dishId: 'd1', stationId: 'k1', startTime: null, completedAt: null }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };
    const result = updateStaff(state, 1);
    // cook2 must not have claimed the same queue item
    const c2Task = result.staff.find(s => s.id === 'c2').task;
    expect(c2Task).toBeNull();
  });
});
