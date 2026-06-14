import { isRestaurantOpen } from './clock';

let customerIdCounter = 0;
function nextCustomerId() {
  return `c${++customerIdCounter}`;
}

const ARCHETYPES = ['regular', 'regular', 'regular', 'foodie', 'rusher', 'influencer'];

export function spawnCustomers(state) {
  if (!isRestaurantOpen(state)) return state;

  const freeTables = state.tables.filter(t => t.status === 'empty');
  if (freeTables.length === 0) return state;

  const spawnRate = 0.05 + (state.restaurant.reputation - 1) * 0.02;
  if (Math.random() > spawnRate) return state;

  const freeTable = freeTables[Math.floor(Math.random() * freeTables.length)];
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  const patienceMap = { regular: 120, foodie: 200, rusher: 60, influencer: 150 };
  const patienceBase = patienceMap[archetype];

  const newCustomer = {
    id: nextCustomerId(),
    archetype,
    patience: patienceBase,
    happiness: 80,
    state: 'arriving',
    dishId: null,
    tableId: freeTable.id,
    tipAmount: 0,
    seatTime: null,
    orderTime: null,
    eatTime: null,
  };

  const updatedTables = state.tables.map(t =>
    t.id === freeTable.id ? { ...t, status: 'occupied' } : t
  );

  return {
    ...state,
    customers: [...state.customers, newCustomer],
    tables: updatedTables,
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

  return { ...state, customers: updatedCustomers, tables: updatedTables };
}
