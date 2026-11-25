import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/initialState';
import { gameReducer } from '../state/GameContext';
import { createCustomerOrder } from './serviceItems';
import { runTick } from './gameLoop';
import { recordSeatResidency } from './movement/seatedDeparture';
import { getCookingBatchCapacity } from './cookingBatches';

const CUSTOMER_IDS = ['A', 'B', 'C'];
const SHORT_FOOD_BUDGET = 800;
const LONG_FOOD_BUDGET = 1800;
const GAME_STEP = 2;

afterEach(() => vi.restoreAllMocks());

function createServiceScenario() {
  const initial = createInitialState();
  const partyId = 'dish-rush-party';
  const table = {
    ...initial.tables.find(candidate => candidate.id === 't3'),
    x: 200,
    y: 200,
    status: 'occupied',
    diningPartyId: partyId,
    diningCustomerIds: [...CUSTOMER_IDS],
  };
  const chairs = initial.chairs
    .filter(chair => chair.tableId === table.id)
    .map(chair => ({ ...chair, y: chair.y - 160 }));
  const chairById = new Map(chairs.map(chair => [chair.id, chair]));
  const seatedCustomers = CUSTOMER_IDS.map((id, index) => {
    const chair = chairById.get(['ch5', 'ch6', 'ch8'][index]);
    const customer = {
      id,
      partyId,
      partyType: 'triple',
      partySize: CUSTOMER_IDS.length,
      state: 'seated',
      tableId: table.id,
      chairId: chair.id,
      x: chair.x + 10,
      y: chair.y + 10,
      happiness: 80,
      patienceMax: id === 'A' ? LONG_FOOD_BUDGET : SHORT_FOOD_BUDGET,
      spendingTier: 'premium',
      spendingBudget: 120,
      archetype: 'regular',
    };
    return { ...customer, ...recordSeatResidency(customer, chair, table) };
  });
  const staff = initial.staff
    .filter(worker => ['starter-cook', 'starter-waiter', 'starter-cashier-waiter'].includes(worker.id))
    .map(worker => ({
      ...worker,
      ...(worker.id === 'starter-cook' ? { skill: 5 } : {}),
      ...(worker.id === 'starter-waiter' ? { x: 170, y: 160 } : {}),
      task: null,
    }));
  let state = {
    ...initial,
    restaurant: { ...initial.restaurant, walkInsPaused: true },
    tables: [table],
    chairs,
    kitchenStations: [initial.kitchenStations.find(station => station.id === 'k1')],
    // The same deliberately slow equipment rate in both arms leaves time for
    // the first two-dish batch, but not a second batch before B/C's deadline.
    equipment: initial.equipment.map(equipment => equipment.id === 'eq1'
      ? { ...equipment, speedMultiplier: 0.1 }
      : equipment),
    staff,
    cashierStations: initial.cashierStations.map(station => ({
      ...station,
      assignedStaffId: 'starter-cashier-waiter',
    })),
    customers: [],
    serviceItems: [],
    cookingBatches: [],
  };

  for (const seated of seatedCustomers) {
    const { customer, serviceItems } = createCustomerOrder(state, seated, () => 0);
    state = {
      ...state,
      customers: [...state.customers, customer],
      serviceItems,
    };
  }

  return state;
}

function runService(state) {
  const foodOutcomes = new Map();
  const outcomeTimes = new Map();
  const paidVisits = new Map();
  const deliveredItemIds = new Set();

  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  for (let tick = 0; tick < 1500; tick += 1) {
    state = runTick(state, { gameDt: GAME_STEP, movementDt: GAME_STEP / 60 });
    if (state.navigationFault) break;

    for (const customer of state.customers) {
      if (['delivered', 'cancelled'].includes(customer.foodOutcome)) {
        if (!outcomeTimes.has(customer.id)) outcomeTimes.set(customer.id, state.restaurant.gameTime);
        foodOutcomes.set(customer.id, customer.foodOutcome);
      }
      if (customer.paidVisitSequence != null) {
        paidVisits.set(customer.id, {
          sequence: customer.paidVisitSequence,
          foodOutcome: customer.foodOutcome,
          orderSubtotal: customer.orderSubtotal,
        });
      }
    }
    for (const item of state.serviceItems) {
      if (item.kind === 'dish' && item.state === 'delivered') deliveredItemIds.add(item.id);
    }

    if (CUSTOMER_IDS.every(id => foodOutcomes.has(id) && paidVisits.has(id))) break;
  }

  return {
    state,
    foodOutcomes: Object.fromEntries(foodOutcomes),
    outcomeTimes: Object.fromEntries(outcomeTimes),
    paidVisits: Object.fromEntries(paidVisits),
    deliveredItemIds: [...deliveredItemIds],
  };
}

describe('dish rush real service trade-off', () => {
  it('swaps the served and expired second/third orders through actual delivery and payment', () => {
    const ordinaryStart = createServiceScenario();
    const cTicketId = ordinaryStart.serviceItems.find(item => item.customerId === 'C').id;
    const rushedStart = gameReducer(ordinaryStart, {
      type: 'SET_RUSH_DISH',
      serviceItemId: cTicketId,
    });

    expect(rushedStart).toEqual({
      ...ordinaryStart,
      restaurant: { ...ordinaryStart.restaurant, rushedDishId: cTicketId },
    });
    expect(ordinaryStart.staff.filter(worker => worker.role === 'cook')).toHaveLength(1);
    expect(ordinaryStart.staff.find(worker => worker.role === 'cook').skill).toBe(5);
    expect(getCookingBatchCapacity(ordinaryStart.staff.find(worker => worker.role === 'cook'))).toBe(2);
    expect(ordinaryStart.kitchenStations).toHaveLength(1);
    expect(ordinaryStart.serviceItems.map(item => [item.customerId, item.kind, item.menuItemId]))
      .toEqual(CUSTOMER_IDS.map(id => [id, 'dish', 'starter-toast']));
    expect(ordinaryStart.customers.map(customer => [customer.id, customer.foodPatienceBudget]))
      .toEqual([['A', LONG_FOOD_BUDGET], ['B', SHORT_FOOD_BUDGET], ['C', SHORT_FOOD_BUDGET]]);

    const ordinary = runService(ordinaryStart);
    const rushed = runService(rushedStart);

    expect(ordinary.state.navigationFault).toBeFalsy();
    expect(rushed.state.navigationFault).toBeFalsy();
    expect(ordinary.foodOutcomes).toEqual({ A: 'delivered', B: 'delivered', C: 'cancelled' });
    expect(rushed.foodOutcomes).toEqual({ A: 'delivered', B: 'cancelled', C: 'delivered' });
    for (const [run, start] of [[ordinary, ordinaryStart], [rushed, rushedStart]]) {
      for (const id of CUSTOMER_IDS) {
        const deadline = start.customers.find(customer => customer.id === id).foodDeadlineAt;
        expect(Number.isFinite(run.outcomeTimes[id])).toBe(true);
        if (run.foodOutcomes[id] === 'delivered') {
          expect(run.outcomeTimes[id]).toBeLessThan(deadline);
        } else {
          expect(run.outcomeTimes[id]).toBe(deadline);
        }
      }
    }

    const ordinaryCustomerById = new Map(ordinaryStart.customers.map(customer => [customer.id, customer]));
    const rushedCustomerById = new Map(rushedStart.customers.map(customer => [customer.id, customer]));
    expect(ordinary.deliveredItemIds.sort()).toEqual([
      ordinaryCustomerById.get('A').dishOrderSnapshot.serviceItemId,
      ordinaryCustomerById.get('B').dishOrderSnapshot.serviceItemId,
    ].sort());
    expect(rushed.deliveredItemIds.sort()).toEqual([
      rushedCustomerById.get('A').dishOrderSnapshot.serviceItemId,
      rushedCustomerById.get('C').dishOrderSnapshot.serviceItemId,
    ].sort());

    for (const run of [ordinary, rushed]) {
      const deliveredCustomers = CUSTOMER_IDS.filter(id => run.foodOutcomes[id] === 'delivered');
      const paidDishCustomers = Object.entries(run.paidVisits)
        .filter(([, visit]) => visit.foodOutcome === 'delivered')
        .map(([id]) => id);
      expect(paidDishCustomers.sort()).toEqual(deliveredCustomers.sort());
      expect(Object.keys(run.paidVisits).sort()).toEqual([...CUSTOMER_IDS].sort());
      for (const id of deliveredCustomers) {
        expect(run.paidVisits[id]).toMatchObject({ foodOutcome: 'delivered', orderSubtotal: 12 });
      }
      const expiredCustomer = CUSTOMER_IDS.find(id => run.foodOutcomes[id] === 'cancelled');
      expect(run.paidVisits[expiredCustomer]).toMatchObject({ foodOutcome: 'cancelled', orderSubtotal: 0 });
      expect(run.state.menuSales.dishes).toEqual([{
        key: 'starter-toast', count: 2, gross: 24, grossComplete: true,
      }]);
      expect(run.state.cookbook.entries.toast.paidPortions).toBe(2);
    }
  }, 30000);
});
