import { afterEach, describe, it, expect, vi } from 'vitest';
import { spawnCustomers, updateCustomers } from './customers';

const baseState = {
  restaurant: { reputation: 3.0, gameTime: 12 * 3600, openHour: 10, closeHour: 22, totalServed: 0 },
  tables: [
    { id: 't1', seats: 2, status: 'empty' },
    { id: 't2', seats: 2, status: 'empty' },
  ],
  customers: [],
  queue: [],
  staff: [],
  dishes: [],
  kitchenQueue: [],
  completedCustomers: [],
};

describe('spawnCustomers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('scales spawning probability by elapsed time instead of animation frames', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const frameResult = spawnCustomers(baseState, 0.016);
    const oneSecondResult = spawnCustomers(baseState, 1);

    expect(frameResult.queue).toHaveLength(0);
    expect(oneSecondResult.queue).toHaveLength(1);
  });

  it('spawns customers into queue when restaurant is open', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
    }
    expect(result.queue.length).toBeGreaterThan(0);
    expect(result.queue[0].state).toBe('queued');
    expect(result.queue[0].tableId).toBeNull();
    expect(result.customers.length).toBe(0);
  });

  it('queues customers when no free tables', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const state = {
      ...baseState,
      tables: baseState.tables.map(t => ({ ...t, status: 'occupied' })),
    };
    let result = state;
    for (let i = 0; i < 100; i++) {
      result = spawnCustomers(result);
    }
    expect(result.queue.length).toBeGreaterThan(0);
    expect(result.queue[0].state).toBe('queued');
  });

  it('does not spawn during closed hours', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 3 * 3600 } };
    let result = state;
    for (let i = 0; i < 50; i++) {
      result = spawnCustomers(result);
    }
    expect(result.customers.length).toBe(0);
    expect(result.queue.length).toBe(0);
  });

  it('includes archetype in spawned customer', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
      if (result.queue.length > 0) break;
    }
    const archetypes = ['regular', 'foodie', 'rusher', 'influencer'];
    expect(archetypes).toContain(result.queue[0].archetype);
  });

  it('assigns a gender to spawned customers', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.75);

    const result = spawnCustomers(baseState, 1);

    expect(result.queue[0].gender).toBe('female');
  });

  it('spawns couples as linked customers who queue together', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.8);

    const result = spawnCustomers(baseState, 1);

    expect(result.queue).toHaveLength(2);
    expect(result.queue.map(customer => customer.partyType)).toEqual(['couple', 'couple']);
    expect(result.queue.map(customer => customer.partySize)).toEqual([2, 2]);
    expect(new Set(result.queue.map(customer => customer.partyId)).size).toBe(1);
    expect(result.queue.map(customer => customer.gender)).toEqual(['male', 'female']);
  });

  it('stops arrivals when eight parties are queued', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const queue = Array.from({ length: 8 }, (_, index) => ({ id: `q${index}`, partyId: `p${index}` }));

    const result = spawnCustomers({ ...baseState, queue }, 1);

    expect(result.queue).toHaveLength(8);
  });

  it('applies configured marketing and ambient-lighting effects', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.04);
    const upgrades = [
      { level: 2, effects: { type: 'customerRate', value: 0.02 } },
      { level: 2, effects: { type: 'happiness', value: 5 } },
    ];

    const result = spawnCustomers({ ...baseState, upgrades }, 1);

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0].happiness).toBe(90);
  });
});

describe('updateCustomers', () => {
  it('reduces patience over time', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 2);
    expect(result.customers[0].patience).toBe(98);
  });

  it('moves customer from arriving to waiting', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 100, happiness: 80,
      state: 'arriving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 1);
    expect(result.customers[0].state).toBe('waiting');
  });

  it('moves paying customers into a single-file checkout queue', () => {
    const state = {
      ...baseState,
      chairs: [], kitchenStations: [], serviceTables: [],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
      customers: [
        { id: 'c1', state: 'paying', x: 400, y: 300, patience: 100, paymentQueuedAt: 10 },
        { id: 'c2', state: 'paying', x: 420, y: 300, patience: 100, paymentQueuedAt: 20 },
      ],
    };

    const result = updateCustomers(state, 0);

    expect(result.customers[0].checkoutPosition).toEqual({ x: 780, y: 140 });
    expect(result.customers[1].checkoutPosition).toEqual({ x: 760, y: 140 });
    expect(result.customers.every(customer => customer.path.length > 0)).toBe(true);
  });

  it('sets leaving state and reduces happiness when patience runs out', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 5, happiness: 80,
      state: 'waiting', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, customers: [customer] };
    const result = updateCustomers(state, 10);
    expect(result.customers[0].patience).toBe(0);
    expect(result.customers[0].state).toBe('leaving');
    expect(result.customers[0].happiness).toBeLessThan(80);
  });

  it('keeps leaving customers visible while they walk towards an exit', () => {
    const customer = {
      id: 'c1', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      customers: [customer],
      tables: baseState.tables.map(t => t.id === 't1' ? { ...t, status: 'occupied' } : t),
    };
    const result = updateCustomers(state, 1);
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]).toMatchObject({ state: 'leaving', exitDoorId: 'door1' });
    expect(result.customers[0].path.length).toBeGreaterThan(0);
    expect(result.tables.find(t => t.id === 't1').status).toBe('dirty');
  });

  it('does not auto-seat queued customer when table frees (host controls seating)', () => {
    const leavingCustomer = {
      id: 'c2', archetype: 'regular', patience: 0, happiness: 50,
      state: 'leaving', dishId: null, tableId: 't1', tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const queuedCustomer = {
      id: 'q1', archetype: 'foodie', patience: 150, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = {
      ...baseState,
      customers: [leavingCustomer],
      queue: [queuedCustomer],
      tables: baseState.tables.map(t => t.id === 't1' ? { ...t, status: 'occupied' } : t),
    };
    const result = updateCustomers(state, 1);
    expect(result.customers.length).toBe(1);
    expect(result.queue.length).toBe(1);
    expect(result.tables.find(t => t.id === 't1').status).toBe('dirty');
  });

  it('uses separate doors for simultaneous departures when available', () => {
    const customers = [
      { id: 'c1', state: 'leaving', x: 400, y: 300, patience: 0, happiness: 80 },
      { id: 'c2', state: 'leaving', x: 420, y: 300, patience: 0, happiness: 80 },
    ];
    const state = {
      ...baseState,
      customers,
      doors: [{ id: 'door1', y: 300 }, { id: 'door2', y: 420 }],
      chairs: [], kitchenStations: [], serviceTables: [],
    };

    const result = updateCustomers(state, 0);

    expect(new Set(result.customers.map(customer => customer.exitDoorId))).toEqual(new Set(['door1', 'door2']));
  });

  it('removes queue customer when patience runs out', () => {
    const queuedCustomer = {
      id: 'q1', archetype: 'rusher', patience: 5, happiness: 80,
      state: 'queued', dishId: null, tableId: null, tipAmount: 0,
      seatTime: null, orderTime: null, eatTime: null,
    };
    const state = { ...baseState, queue: [queuedCustomer] };
    const result = updateCustomers(state, 10);
    expect(result.queue.length).toBe(0);
    // Dead queue mbr becomes a leaving customer (reputation loss)
    expect(result.customers.length).toBe(1);
    expect(result.customers[0].state).toBe('leaving');
  });

  it('accelerates queued patience loss as the number of parties grows', () => {
    const queue = Array.from({ length: 6 }, (_, index) => ({
      id: `q${index}`, partyId: `p${index}`, state: 'queued', patience: 100, happiness: 80,
    }));

    const result = updateCustomers({ ...baseState, queue }, 2);

    expect(result.queue[0].patience).toBe(97);
  });

  it('does not reduce patience while a customer is eating', () => {
    const customer = { id: 'c1', state: 'eating', patience: 100, happiness: 80 };

    const result = updateCustomers({ ...baseState, customers: [customer] }, 10);

    expect(result.customers[0].patience).toBe(100);
  });

  it('lowers reputation once for each abandoning customer', () => {
    const customer = { id: 'c1', state: 'waiting', patience: 1, happiness: 80 };

    const abandoned = updateCustomers({ ...baseState, customers: [customer] }, 2);
    const updatedAgain = updateCustomers(abandoned, 2);

    expect(abandoned.restaurant.reputation).toBe(2.98);
    expect(abandoned.customers[0].reputationApplied).toBe(true);
    expect(updatedAgain.restaurant.reputation).toBe(2.98);
  });

  it('spawn never assigns tableId or adds directly to customers', () => {
    const state = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 12 * 3600 } };
    let result = state;
    for (let i = 0; i < 200; i++) {
      result = spawnCustomers(result);
    }
    expect(result.customers.length).toBe(0);
    for (const q of result.queue) {
      expect(q.tableId).toBeNull();
    }
  });
});
