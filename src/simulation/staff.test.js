import { describe, it, expect } from 'vitest';
import { updateStaff } from './staff';
import { updateCustomers } from './customers';

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

  it('assigns the front paying customer to an assigned cashier waiter', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 760, y: 140 };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [
        { id: 'c1', state: 'paying', x: 780, y: 140, checkoutPosition: { x: 780, y: 140 }, dishId: 'd1', tableId: 't1', patience: 100 },
        { id: 'c2', state: 'paying', x: 700, y: 160, dishId: 'd1', tableId: 't1', patience: 100 },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'take_payment', customerId: 'c1', stationId: 'cashier1' });
    expect(result.staff[0].path.at(-1)).toEqual({ x: 42, y: 5 });
    expect(result.customers[1].state).toBe('paying');
  });

  it('does not claim payment while another character occupies the cashier work point', () => {
    const cashier = { id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 760, y: 140 };
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
      id: 'cw1', name: 'Elena', role: 'waiter', morale: 80, x: 780, y: 140,
      path: [], task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' },
    };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'paying', x: 780, y: 140, checkoutPosition: { x: 780, y: 140 }, dishId: 'd1', tableId: 't1', patience: 100 }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      restaurant: { ...baseState.restaurant, totalServed: 3 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0]).toMatchObject({ state: 'leaving', departureReason: 'served' });
    expect(result.completedCustomers[0]).toMatchObject({ revenue: 14.4, tip: 2.4 });
    expect(result.restaurant.totalServed).toBe(4);
  });

  it('happy payment increases reputation with configured gain effects', () => {
    const cashier = {
      id: 'cw1', role: 'waiter', morale: 80, x: 780, y: 140,
      path: [], task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' },
    };
    const state = {
      ...baseState,
      staff: [cashier],
      customers: [{ id: 'c1', state: 'paying', happiness: 80, dishId: 'd1', tableId: 't1' }],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'cw1' }],
      restaurant: { ...baseState.restaurant, reputation: 4.9 },
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

  it('waiter starts guiding a waiting customer and reserves table', () => {
    const waiter = { id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 860, y: 360 };
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
    expect(result.customers[0].guideStaffId).toBe('h1');
    expect(result.tables[0].status).toBe('reserved');
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
    const waiter = { id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 300 };
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
    const waiter = { id: 'h1', name: 'Luca', role: 'waiter', morale: 80, x: 860, y: 360 };
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

  it('waiter completes seating on arrival', () => {
    const waiter = {
      id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'guide_customer', customerId: 'c1', tableId: 't1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null, guideStaffId: 'h1', x: 860, y: 360,
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
    expect(result.customers[0].state).toBe('seated');
    expect(result.customers[0].guideStaffId).toBeNull();
    expect(result.customers[0].seatTime).toBe(100);
    expect(result.customers[0].chairId).toBe('ch1');
    expect(result.tables[0].status).toBe('occupied');
    expect(result.staff[0].task).toBeNull();
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
      id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 180, y: 220, path: [], task: { type: 'guide_customer', customerIds: ['c1', 'c2'], partyId: 'p1', tableId: 't1' },
    };
    const customers = ['c1', 'c2'].map((id, index) => ({
      id, partyId: 'p1', partyType: 'couple', partySize: 2,
      archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
       seatTime: null, orderTime: null, eatTime: null, guideStaffId: 'h1', x: 860 + index * 10, y: 360,
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

    const result = updateStaff(state, 1);

    expect(result.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'c1', state: 'seated', chairId: 'ch1', x: 220, y: 190 }),
      expect.objectContaining({ id: 'c2', state: 'seated', chairId: 'ch2', x: 220, y: 270 }),
    ]));
    expect(result.tables[0].status).toBe('occupied');
  });

  it('cancels a stale guide task and releases its reserved table', () => {
    const waiter = {
      id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
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
      id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
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
      id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
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

  it('holds a waiter at a dirty table for two seconds', () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 180, y: 220, path: [], task: { type: 'clean_table', tableId: 't1' } }],
      tables: [{ id: 't1', seats: 2, status: 'dirty', x: 200, y: 220 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const started = updateStaff(state, 0);
    expect(started.tables[0].status).toBe('dirty');
    expect(started.staff[0].task).toMatchObject({ type: 'clean_table', cleaningStartedAt: 100 });
    expect(started.staff[0].path).toEqual([]);

    const stillCleaning = updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 101.9 } }, 0);
    expect(stillCleaning.tables[0].status).toBe('dirty');
    expect(stillCleaning.staff[0].task).toMatchObject({ type: 'clean_table', cleaningStartedAt: 100 });
    expect(stillCleaning.staff[0].path).toEqual([]);

    const finished = updateStaff({ ...stillCleaning, restaurant: { ...stillCleaning.restaurant, gameTime: 102 } }, 0);
    expect(finished.tables[0].status).toBe('empty');
    expect(finished.staff[0].task).toBeNull();
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
      state: 'on_service', serviceTableId: 'st1', x: 150, y: 130,
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

  it("waiter paths to the ready food's recorded service counter", () => {
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', morale: 80, x: 700, y: 500 }],
      customers: [{ id: 'c1', state: 'ordering', dishId: 'd1', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      foodItems: [{
        id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
        serviceTableId: 'st2', state: 'on_service', x: 410, y: 130,
      }],
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0].task).toMatchObject({ type: 'pickup_food', foodId: 'f1' });
    expect(result.staff[0].path.at(-1)).toEqual({ x: 26, y: 8 });
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
      state: 'on_service', serviceTableId: 'st1', x: 150, y: 130,
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
    const result = updateStaff(state, 1);
    expect(result.foodItems[0].state).toBe('carried');
    expect(result.staff[0].carryingFoodId).toBe('f1');
    expect(result.staff[0].task).toBeNull();
  });

  it('does not claim food that another waiter has already carried', () => {
    const food = { id: 'f1', customerId: 'c1', tableId: 't1', serviceTableId: 'st1', state: 'carried' };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 120, y: 120, path: [], task: { type: 'pickup_food', foodId: 'f1' } }],
      foodItems: [food],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.foodItems[0]).toEqual(food);
  });

  it('does not claim on-service food owned by another waiter', () => {
    const food = {
      id: 'f1', customerId: 'c1', tableId: 't1', serviceTableId: 'st1',
      state: 'on_service', x: 300, y: 300,
    };
    const state = {
      ...baseState,
      staff: [
        { id: 'w1', role: 'waiter', x: 120, y: 120, path: [], task: { type: 'pickup_food', foodId: 'f1' } },
        { id: 'w2', role: 'waiter', x: 300, y: 300, path: [{ x: 20, y: 20 }], carryingFoodId: 'f1' },
      ],
      foodItems: [food],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.staff[1].carryingFoodId).toBe('f1');
    expect(result.foodItems[0]).toEqual(food);
  });

  it('does not claim a second plate while already carrying another item', () => {
    const readyFood = {
      id: 'f1', customerId: 'c1', tableId: 't1', serviceTableId: 'st1',
      state: 'on_service', x: 150, y: 130,
    };
    const carriedFood = {
      id: 'f2', customerId: 'c2', tableId: 't2',
      state: 'carried', x: 120, y: 120,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 120, y: 120, path: [],
        task: { type: 'pickup_food', foodId: 'f1' }, carryingFoodId: 'f2',
      }],
      foodItems: [readyFood, carriedFood],
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: 'f2' });
    expect(result.foodItems).toEqual([readyFood, carriedFood]);
  });

  it('does not claim food from a missing service counter', () => {
    const food = { id: 'f1', customerId: 'c1', tableId: 't1', serviceTableId: 'missing', state: 'on_service' };
    const state = {
      ...baseState,
      staff: [{ id: 'w1', role: 'waiter', x: 120, y: 120, path: [], task: { type: 'pickup_food', foodId: 'f1' } }],
      foodItems: [food],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.foodItems[0]).toEqual(food);
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

  it('keeps carried food coordinates synchronised with its moving waiter', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', x: 120, y: 120, path: [{ x: 10, y: 10 }],
        task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' }, carryingFoodId: 'f1',
      }],
      customers: [{ id: 'c1', state: 'ordering', dishId: 'd1', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 300, y: 300 }],
      foodItems: [{ id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried', x: 150, y: 130 }],
    };

    const result = updateStaff(state, 0.5);

    expect(result.staff[0]).toMatchObject({ carryingFoodId: 'f1' });
    expect(result.foodItems[0]).toMatchObject({ state: 'carried', x: result.staff[0].x, y: result.staff[0].y });
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
    expect(result.foodItems[0]).toMatchObject({ x: 208, y: 208 });
    expect(result.staff[0].carryingFoodId).toBeNull();
    expect(result.staff[0].task).toBeNull();
    expect(result.customers[0].state).toBe('eating');
    expect(result.customers[0].eatTime).toBe(100);
  });

  it('adds dish, upgrade, and equipment quality to happiness on delivery', () => {
    const waiter = {
      id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
      task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' },
      carryingFoodId: 'f1',
    };
    const state = {
      ...baseState,
      staff: [waiter],
      customers: [{ id: 'c1', state: 'ordering', happiness: 50, dishId: 'd1', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      foodItems: [{ id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' }],
      dishes: [{ id: 'd1', quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1.3, qualityBonus: 0.15 }],
      upgrades: [{ level: 2, effects: { type: 'qualityBonus', value: 0.05 } }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    // round((5 - 1) * 2 + 0.10 * 100 + 0.15 * 100) = 33.
    expect(result.customers[0]).toMatchObject({ state: 'eating', happiness: 83 });
  });

  it('caps delivery happiness at 100', () => {
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' }, carryingFoodId: 'f1',
      }],
      customers: [{ id: 'c1', state: 'ordering', happiness: 95, dishId: 'd1', tableId: 't1' }],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
      foodItems: [{ id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' }],
      dishes: [{ id: 'd1', quality: 5, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1, qualityBonus: 0 }],
      restaurant: { ...baseState.restaurant, gameTime: 100 },
    };

    const result = updateStaff(state, 0);

    expect(result.customers[0].happiness).toBe(100);
  });

  it('cancels a stale take_order task when the customer is no longer seated', () => {
    const customer = { id: 'c1', state: 'paying', dishId: 'd1', tableId: 't1', happiness: 80 };
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
    const customer = { id: 'c1', state: 'eating', dishId: 'd1', tableId: 't1', happiness: 80 };
    const state = {
      ...baseState,
      staff: [{
        id: 'cashier', role: 'waiter', morale: 80, x: 780, y: 140, path: [],
        task: { type: 'take_payment', customerId: 'c1', stationId: 'cashier1' },
      }],
      customers: [customer],
      dishes: [{ id: 'd1', price: 12 }],
      completedCustomers: [],
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
    const customer = { id: 'c1', state: 'leaving', happiness: 40, dishId: 'd1', tableId: 't1' };
    const food = { id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1', state: 'carried' };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' }, carryingFoodId: 'f1',
      }],
      customers: [customer],
      foodItems: [food],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.customers[0]).toEqual(customer);
    expect(result.foodItems[0]).toEqual({ ...food, state: 'to_clean' });
  });

  it('cancels delivery when the task food is not carried', () => {
    const customer = { id: 'c1', state: 'ordering', happiness: 80, dishId: 'd1', tableId: 't1' };
    const food = { id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1', state: 'on_service' };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' }, carryingFoodId: 'f1',
      }],
      customers: [customer],
      foodItems: [food],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.customers[0]).toEqual(customer);
    expect(result.foodItems[0]).toEqual(food);
  });

  it('does not release stale task food carried by another worker', () => {
    const food = {
      id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1',
      state: 'carried', x: 400, y: 400,
    };
    const state = {
      ...baseState,
      staff: [
        {
          id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
          task: { type: 'deliver_food', foodId: 'f1', customerId: 'missing' }, carryingFoodId: null,
        },
        {
          id: 'w2', role: 'waiter', morale: 80, x: 400, y: 400, path: [{ x: 10, y: 10 }],
          task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' }, carryingFoodId: 'f1',
        },
      ],
      customers: [{ id: 'c1', state: 'ordering', happiness: 80, dishId: 'd1', tableId: 't1' }],
      foodItems: [food],
      tables: [{ id: 't1', status: 'occupied', x: 200, y: 200 }],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: null });
    expect(result.staff[1]).toMatchObject({ carryingFoodId: 'f1' });
    expect(result.foodItems[0]).toEqual(food);
  });

  it('preserves the current worker unrelated carrier when cancelling stale delivery', () => {
    const taskFood = { id: 'f1', dishId: 'd1', customerId: 'c1', tableId: 't1', state: 'on_service' };
    const ownFood = {
      id: 'f2', dishId: 'd2', customerId: 'c2', tableId: 't2',
      state: 'carried', x: 180, y: 220,
    };
    const state = {
      ...baseState,
      staff: [{
        id: 'w1', role: 'waiter', morale: 80, x: 180, y: 220, path: [],
        task: { type: 'deliver_food', foodId: 'f1', customerId: 'c1' }, carryingFoodId: 'f2',
      }],
      customers: [
        { id: 'c1', state: 'ordering', happiness: 80, dishId: 'd1', tableId: 't1' },
        { id: 'c2', state: 'ordering', happiness: 80, dishId: 'd2', tableId: 't2' },
      ],
      foodItems: [taskFood, ownFood],
      tables: [
        { id: 't1', status: 'occupied', x: 200, y: 200 },
        { id: 't2', status: 'occupied', x: 360, y: 200 },
      ],
    };

    const result = updateStaff(state, 0);

    expect(result.staff[0]).toMatchObject({ task: null, carryingFoodId: 'f2' });
    expect(result.foodItems).toEqual([taskFood, ownFood]);
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

  it('waiter also cleans to_clean food', () => {
    const waiter = { id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 800, y: 500 };
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
    // With no customers or dirty tables, the waiter should clean food.
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
      state: 'on_service', serviceTableId: 'st1', x: 150, y: 130,
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

  it('waiter guides queued customer from queue, removes from queue, and reserves table', () => {
    const waiter = { id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150, x: 860, y: 360 };
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
    expect(result.customers[0].guideStaffId).toBe('h1');
    expect(result.customers[0].tableId).toBe('t1');
    expect(result.staff[0].task).not.toBeNull();
    expect(result.staff[0].task.type).toBe('guide_customer');
    expect(result.staff[0].task.customerId).toBe('q1');
    expect(result.tables[0].status).toBe('reserved');
  });

  it('guided customer follows waiter x/y during movement', () => {
    const waiter = {
      id: 'h1', name: 'Luca', role: 'waiter', skill: 5, morale: 80, salary: 150,
      x: 100, y: 100, path: [{ x: 10, y: 5 }],
      task: { type: 'guide_customer', customerId: 'c1', tableId: 't1' },
    };
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'guided', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
      guideStaffId: 'h1', x: 100, y: 100,
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
    expect(result.customers[0].x).toBeCloseTo(175 - 12, -1);
    expect(result.customers[0].y).toBeCloseTo(100 + 12, -1);
    expect(result.customers[0].guideStaffId).toBe('h1');
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
