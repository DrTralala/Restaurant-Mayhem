import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../state/initialState';
import { runTick } from './gameLoop';

function tripleParty() {
  return {
    partyId: 'triple-party',
    members: Array.from({ length: 3 }, (_value, index) => ({
      id: `triple-customer-${index + 1}`,
      partyId: 'triple-party',
      partyType: 'triple',
      partySize: 3,
      archetype: 'regular',
      gender: index === 0 ? 'female' : 'male',
      spendingTier: 'premium',
      spendingBudget: 120,
      patience: 5000,
      patienceMax: 5000,
      queuePatience: 5000,
      queuePatienceMax: 5000,
      happiness: 80,
      state: 'queued',
      dishId: null,
      drinkId: null,
      tableId: null,
      chairId: null,
      tipAmount: 0,
      seatTime: null,
      orderTime: null,
      eatTime: null,
    })),
  };
}

function lifecycleStaff(initial) {
  const positions = {
    'starter-cook': { x: 80, y: 100 },
    'starter-waiter': { x: 180, y: 180 },
    'starter-cashier-waiter': { x: 820, y: 100 },
    'starter-janitor': { x: 600, y: 360 },
  };
  return initial.staff
    .filter(staff => Object.hasOwn(positions, staff.id))
    .map(staff => ({
      ...staff,
      ...positions[staff.id],
      task: null,
      carryingServiceItemIds: [],
    }));
}

describe('Task 3 three-person party integration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('admits, seats, orders, and checks out a three-person party through the generic loop', () => {
    const initial = createInitialState();
    let state = {
      ...initial,
      restaurant: { ...initial.restaurant, gameTime: 10 * 3600, reputation: 3 },
      tables: initial.tables.filter(table => table.id === 't3'),
      chairs: initial.chairs.filter(chair => chair.tableId === 't3'),
      staff: lifecycleStaff(initial),
      customers: [],
      queue: [tripleParty()],
      queueSlots: [],
      queueDepartures: [],
      queueAdmissionGate: null,
      serviceItems: [],
      unlockedDrinkIds: [],
      pendingPartyReviews: [],
      partyReviewHistory: [],
    };
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const stages = new Set();
    for (let tick = 0; tick < 8000; tick += 1) {
      state = runTick(state, 1 / 60);
      const members = state.customers.filter(customer => customer.partyId === 'triple-party');

      if (members.length === 3) stages.add('admitted');
      if (members.length === 3 && members.every(customer => customer.state === 'seated')) {
        stages.add('seated');
      }
      if (members.length === 3 && members.every(customer => customer.menuOutcome === 'ordered')) {
        stages.add('ordered');
      }
      if (members.some(customer => [
        'checkout_queued', 'checkout_moving', 'checkout_processing',
      ].includes(customer.state))) {
        stages.add('checkout');
      }
      if (state.restaurant.totalServed === 3) break;
    }

    expect(stages).toEqual(new Set(['admitted', 'seated', 'ordered', 'checkout']));
    expect(state.restaurant.totalServed).toBe(3);
    expect(state.partyReviewHistory).toEqual([
      expect.objectContaining({
        partyId: 'triple-party', memberCount: 3, paidCount: 3, unaffordableCount: 0,
      }),
    ]);
  });
});
