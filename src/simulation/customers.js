import { isRestaurantOpen } from './clock';

let customerIdCounter = 0;
function nextCustomerId() {
  return `c${++customerIdCounter}`;
}

const ARCHETYPES = ['regular', 'regular', 'regular', 'foodie', 'rusher', 'influencer'];

export function spawnCustomers(state) {
  if (!isRestaurantOpen(state)) return state;

  const spawnRate = 0.05 + (state.restaurant.reputation - 1) * 0.02;
  if (Math.random() > spawnRate) return state;

  const freeTables = state.tables.filter(t => t.status === 'empty');
  const patienceMap = { regular: 120, foodie: 200, rusher: 60, influencer: 150 };
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  const patienceBase = patienceMap[archetype];

  const newCustomer = {
    id: nextCustomerId(),
    archetype,
    patience: patienceBase,
    happiness: 80,
    state: 'arriving',
    dishId: null,
    tableId: null,
    tipAmount: 0,
    seatTime: null,
    orderTime: null,
    eatTime: null,
  };

  if (freeTables.length > 0 && state.queue.length === 0) {
    const freeTable = freeTables[Math.floor(Math.random() * freeTables.length)];
    newCustomer.tableId = freeTable.id;
    newCustomer.state = 'arriving';

    const updatedTables = state.tables.map(t =>
      t.id === freeTable.id ? { ...t, status: 'occupied' } : t
    );

    return {
      ...state,
      customers: [...state.customers, newCustomer],
      tables: updatedTables,
    };
  }

  // No free table: customer queues outside
  return {
    ...state,
    queue: [...state.queue, { ...newCustomer, state: 'queued' }],
  };
}

export function updateCustomers(state, dt) {
  let updatedCustomers = state.customers.map(c => {
    const newPatience = Math.max(0, c.patience - dt);

    if (newPatience <= 0 && c.state !== 'leaving') {
      return { ...c, patience: 0, state: 'leaving', happiness: Math.max(0, c.happiness - 30) };
    }

    let newState = c.state;
    if (c.state === 'arriving') {
      newState = 'waiting';
    }

    return { ...c, patience: newPatience, state: newState };
  });

  // Update queue: decrement patience, remove those who run out
  let updatedQueue = state.queue.map(q => ({
    ...q,
    patience: Math.max(0, q.patience - dt),
  }));

  // Separate queue members whose patience expired
  const deadQueue = updatedQueue.filter(q => q.patience <= 0);
  updatedQueue = updatedQueue.filter(q => q.patience > 0);

  // If dead queue members exist, add them as leaving customers (reputation penalty)
  if (deadQueue.length > 0) {
    updatedCustomers = [...updatedCustomers, ...deadQueue.map(q => ({
      ...q,
      state: 'leaving',
      happiness: Math.max(0, q.happiness - 30),
      tableId: null,
    }))];
  }

  // Remove leaving customers and free their tables
  // Only remove customers that were already leaving BEFORE this tick
  const alreadyLeaving = state.customers.filter(c => c.state === 'leaving');
  const leavingIds = new Set(alreadyLeaving.map(c => c.id));

  let updatedTables = state.tables;
  if (leavingIds.size > 0) {
    const leavingTableIds = new Set(alreadyLeaving.map(c => c.tableId).filter(Boolean));
    updatedCustomers = updatedCustomers.filter(c => !leavingIds.has(c.id));
    updatedTables = state.tables.map(t =>
      leavingTableIds.has(t.id) ? { ...t, status: 'dirty' } : t
    );
  }

  // Seat queued customers into freed tables
  const freeTables = updatedTables.filter(t => t.status === 'empty');
  let remainingQueue = [...updatedQueue];

  for (const table of freeTables) {
    if (remainingQueue.length === 0) break;
    const nextInLine = remainingQueue.shift();
    updatedCustomers = [...updatedCustomers, {
      ...nextInLine,
      state: 'arriving',
      tableId: table.id,
    }];
    updatedTables = updatedTables.map(t =>
      t.id === table.id ? { ...t, status: 'occupied' } : t
    );
  }

  return {
    ...state,
    customers: updatedCustomers,
    queue: remainingQueue,
    tables: updatedTables,
  };
}
