import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameProvider, useDispatch, useGameState } from './GameContext';
import { createInitialState } from './initialState';
import { getRestaurantWorld } from '../simulation/world';

function StaffNameHarness() {
  const state = useGameState();
  const dispatch = useDispatch();

  return (
    <>
      <span>{state.staff[0].name}</span>
      <span>${state.staff[0].salary}</span>
      <button onClick={() => dispatch({ type: 'RENAME_STAFF', id: state.staff[0].id, name: 'Matteo' })}>
        Rename starter
      </button>
      <button onClick={() => dispatch({ type: 'SET_STAFF_SALARY', id: state.staff[0].id, salary: 240 })}>
        Raise starter
      </button>
    </>
  );
}

function TableHarness() {
  const state = useGameState();
  const dispatch = useDispatch();
  const newestTableId = state.tables.at(-1).id;
  const rotations = state.chairs
    .filter(chair => chair.tableId === newestTableId)
    .map(chair => chair.rotation)
    .join(',');

  return (
    <>
      <span data-testid="newest-chair-rotations">{rotations}</span>
      <button onClick={() => dispatch({ type: 'ADD_TABLE' })}>Add table</button>
    </>
  );
}

function ItemHarness() {
  const state = useGameState();
  const dispatch = useDispatch();
  return (
    <>
      <span data-testid="funds">{state.restaurant.funds}</span>
      <span data-testid="table-count">{state.tables.length}</span>
      <span data-testid="chair-count">{state.chairs.length}</span>
      <span data-testid="door-count">{state.doors.length}</span>
      <button onClick={() => dispatch({ type: 'BUY_TABLE', cost: 1 })}>Buy table</button>
      <button onClick={() => dispatch({ type: 'BUY_CHAIR', cost: 1 })}>Buy chair</button>
      <button onClick={() => dispatch({ type: 'SELL_ITEMS', items: [{ type: 'chair', id: 'ch1' }] })}>Sell chair</button>
      <button onClick={() => dispatch({ type: 'BUY_DOOR', cost: 1 })}>Buy door</button>
    </>
  );
}

function ReducerHarness({ current }) {
  const state = useGameState();
  const dispatch = useDispatch();
  current.state = state;
  current.dispatch = dispatch;
  return null;
}

function renderReducer(overrides = {}) {
  const initial = createInitialState();
  const saved = {
    ...initial,
    ...overrides,
    restaurant: { ...initial.restaurant, ...(overrides.restaurant || {}) },
  };
  localStorage.setItem('restaurant-sim-save', JSON.stringify(saved));
  const current = {};
  render(<GameProvider><ReducerHarness current={current} /></GameProvider>);
  return {
    dispatch(action) {
      act(() => current.dispatch(action));
    },
    get state() {
      return current.state;
    },
  };
}

describe('GameProvider staff actions', () => {
  beforeEach(() => localStorage.clear());

  it('uses fresh state when a saved state has an older version', () => {
    const saved = { ...createInitialState(), version: 2, restaurant: { funds: 999 } };
    localStorage.setItem('restaurant-sim-save', JSON.stringify(saved));

    render(<GameProvider><ItemHarness /></GameProvider>);

    expect(screen.getByTestId('funds')).toHaveTextContent('600');
  });

  it('renames only the selected staff member', () => {
    render(
      <GameProvider>
        <StaffNameHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Rename starter' }).click());

    expect(screen.getByText('Matteo')).toBeInTheDocument();
  });

  it('updates only the selected staff salary', () => {
    render(
      <GameProvider>
        <StaffNameHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Raise starter' }).click());

    expect(screen.getByText('$240')).toBeInTheDocument();
  });

  it('rejects invalid salary adjustments and missing staff targets', () => {
    const game = renderReducer();

    game.dispatch({ type: 'SET_STAFF_SALARY', id: 'starter-cook', salary: -1 });
    game.dispatch({ type: 'SET_STAFF_SALARY', id: 'starter-cook', salary: Number.POSITIVE_INFINITY });
    game.dispatch({ type: 'SET_STAFF_SALARY', id: 'missing', salary: 250 });

    expect(game.state.staff.find(staff => staff.id === 'starter-cook').salary).toBe(200);
    expect(game.state.staff).toHaveLength(4);
  });

  it('preserves raise-only salary adjustment semantics', () => {
    const game = renderReducer();

    game.dispatch({ type: 'SET_STAFF_SALARY', id: 'starter-cook', salary: 190 });

    expect(game.state.staff.find(staff => staff.id === 'starter-cook').salary).toBe(200);
  });
});

describe('GameProvider furniture actions', () => {
  beforeEach(() => localStorage.clear());

  it('faces chairs added with a table inwards', () => {
    render(
      <GameProvider>
        <TableHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Add table' }).click());

    expect(screen.getByTestId('newest-chair-rotations')).toHaveTextContent('2,0,1,3');
  });

  it('buys tables and chairs while deducting their item prices', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Buy table' }).click());
    expect(screen.getByTestId('funds')).toHaveTextContent('300');
    expect(screen.getByTestId('table-count')).toHaveTextContent('5');

    act(() => screen.getByRole('button', { name: 'Buy chair' }).click());
    expect(screen.getByTestId('funds')).toHaveTextContent('250');
    expect(screen.getByTestId('chair-count')).toHaveTextContent('13');
  });

  it('refunds half the chair price when selling selected furniture', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Sell chair' }).click());

    expect(screen.getByTestId('funds')).toHaveTextContent('625');
    expect(screen.getByTestId('chair-count')).toHaveTextContent('11');
  });

  it('buys an additional door and deducts its item price', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Buy door' }).click());

    expect(screen.getByTestId('funds')).toHaveTextContent('200');
    expect(screen.getByTestId('door-count')).toHaveTextContent('2');
  });
});

describe('GameProvider authoritative placement actions', () => {
  beforeEach(() => localStorage.clear());

  it('charges the catalogue price and assigns a free waiter to a cashier station', () => {
    const game = renderReducer();

    game.dispatch({
      type: 'PLACE_ITEM',
      itemType: 'cashierTable',
      x: 600,
      y: 300,
      rotation: 0,
      cost: 1,
    });

    expect(game.state.restaurant.funds).toBe(300);
    expect(game.state.cashierStations.at(-1)).toMatchObject({
      id: 'cashier2',
      x: 600,
      y: 300,
      w: 80,
      h: 40,
      assignedStaffId: 'starter-waiter',
    });
    expect(game.state.staff).toHaveLength(4);
  });

  it('creates an unassigned cashier station when no waiter is available', () => {
    const initial = createInitialState();
    const game = renderReducer({
      staff: initial.staff.filter(staff => staff.role !== 'waiter'),
    });

    game.dispatch({
      type: 'PLACE_ITEM',
      itemType: 'cashierTable',
      x: 600,
      y: 300,
      rotation: 0,
    });

    expect(game.state.restaurant.funds).toBe(300);
    expect(game.state.cashierStations.at(-1)).not.toHaveProperty('assignedStaffId');
    expect(game.state.staff).toHaveLength(1);
  });

  it('stores a snapped y coordinate for an authoritative door placement', () => {
    const initial = createInitialState();
    const game = renderReducer();
    const { doorX } = getRestaurantWorld(initial.restaurant);

    game.dispatch({
      type: 'PLACE_ITEM',
      itemType: 'door',
      x: doorX,
      y: 441,
      rotation: 0,
    });

    expect(game.state.doors.at(-1)).toEqual({ id: 'door2', y: 440 });
  });

  it('clears cashier assignments when firing staff', () => {
    const game = renderReducer({
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'starter-waiter' },
        { id: 'cashier2', x: 600, y: 300, w: 80, h: 40, assignedStaffId: 'starter-waiter' },
      ],
    });

    game.dispatch({ type: 'FIRE_STAFF', id: 'starter-waiter' });

    expect(game.state.staff.some(staff => staff.id === 'starter-waiter')).toBe(false);
    expect(game.state.cashierStations).toEqual([
      { id: 'cashier1', x: 800, y: 120, w: 80, h: 40 },
      { id: 'cashier2', x: 600, y: 300, w: 80, h: 40 },
    ]);
  });
});

describe('GameProvider guarded economy actions', () => {
  beforeEach(() => localStorage.clear());

  it('uses the selected upgrade state to derive its cost and maximum level', () => {
    const game = renderReducer({ restaurant: { funds: 1000 } });

    game.dispatch({ type: 'BUY_UPGRADE', id: 'u3', cost: 1 });

    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.upgrades.find(upgrade => upgrade.id === 'u3').level).toBe(1);

    const maxedUpgrades = game.state.upgrades.map(upgrade =>
      upgrade.id === 'u3' ? { ...upgrade, level: upgrade.costs.length } : upgrade);
    game.dispatch({ type: 'LOAD_STATE', state: { ...game.state, upgrades: maxedUpgrades } });
    game.dispatch({ type: 'BUY_UPGRADE', id: 'u3', cost: -1000 });
    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.upgrades.find(upgrade => upgrade.id === 'u3').level).toBe(4);
  });

  it('applies configured reputation upgrade effects without relying on upgrade identity', () => {
    const reputationUpgrade = {
      id: 'custom-decor',
      name: 'Wall Art',
      level: 0,
      costs: [150],
      effects: { type: 'reputation', value: 0.1 },
    };
    const game = renderReducer({
      restaurant: { funds: 150, reputation: 2 },
      upgrades: [reputationUpgrade],
    });

    game.dispatch({ type: 'BUY_UPGRADE', id: 'custom-decor' });

    expect(game.state.restaurant).toMatchObject({ funds: 0, reputation: 2.1 });
    expect(game.state.upgrades[0].level).toBe(1);

    const capped = renderReducer({
      restaurant: { funds: 150, reputation: 4.95 },
      upgrades: [reputationUpgrade],
    });
    capped.dispatch({ type: 'BUY_UPGRADE', id: 'custom-decor' });
    expect(capped.state.restaurant.reputation).toBe(5);
  });

  it('ignores malformed reputation effect values while completing a valid purchase', () => {
    const game = renderReducer({
      restaurant: { funds: 150, reputation: 2 },
      upgrades: [{
        id: 'broken-decor', level: 0, costs: [150],
        effects: { type: 'reputation', value: Number.NaN },
      }],
    });

    game.dispatch({ type: 'BUY_UPGRADE', id: 'broken-decor' });

    expect(game.state.restaurant).toMatchObject({ funds: 0, reputation: 2 });
    expect(game.state.upgrades[0].level).toBe(1);
  });

  it('only buys equipment when it exists, is unowned, is affordable, and has a free station', () => {
    const game = renderReducer({ restaurant: { funds: 500 } });

    game.dispatch({ type: 'BUY_EQUIPMENT', id: 'missing', cost: 0 });
    expect(game.state.restaurant.funds).toBe(500);

    game.dispatch({ type: 'BUY_EQUIPMENT', id: 'eq2', cost: 0 });
    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.equipment.find(equipment => equipment.id === 'eq2').owned).toBe(true);
    expect(game.state.kitchenStations.find(station => station.id === 'k2').equipmentId).toBe('eq2');

    game.dispatch({ type: 'BUY_EQUIPMENT', id: 'eq2', cost: -500 });
    expect(game.state.restaurant.funds).toBe(0);
  });

  it('rejects equipment purchases without enough funds or a free station', () => {
    const noFunds = renderReducer({ restaurant: { funds: 499 } });
    noFunds.dispatch({ type: 'BUY_EQUIPMENT', id: 'eq2', cost: 0 });
    expect(noFunds.state.equipment.find(equipment => equipment.id === 'eq2').owned).toBe(false);
    expect(noFunds.state.restaurant.funds).toBe(499);

    const fullKitchen = renderReducer({
      restaurant: { funds: 500 },
      kitchenStations: [
        { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 },
        { id: 'k2', equipmentId: 'eq3', x: 200, y: 120 },
      ],
    });
    fullKitchen.dispatch({ type: 'BUY_EQUIPMENT', id: 'eq2', cost: 0 });
    expect(fullKitchen.state.equipment.find(equipment => equipment.id === 'eq2').owned).toBe(false);
    expect(fullKitchen.state.restaurant.funds).toBe(500);
  });

  it('updates equipment level multipliers using the canonical upgrade cost', () => {
    const game = renderReducer({ restaurant: { funds: 100 } });

    game.dispatch({ type: 'UPGRADE_EQUIPMENT', id: 'eq1', cost: 0 });

    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.equipment.find(equipment => equipment.id === 'eq1')).toMatchObject({
      level: 2,
      speedMultiplier: 1.1,
      qualityBonus: 0.05,
    });
  });

  it('stops hiring at the staff slot limit and when salary is unaffordable', () => {
    const game = renderReducer({ restaurant: { funds: 300 } });
    const makeStaff = id => ({ id, name: id, role: 'waiter', skill: 1, morale: 80, salary: 150 });

    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('fifth') });
    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('sixth') });
    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('seventh') });

    expect(game.state.staff).toHaveLength(6);
    expect(game.state.restaurant.funds).toBe(0);

    const unaffordable = renderReducer({ restaurant: { funds: 149 } });
    unaffordable.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('fifth') });
    expect(unaffordable.state.staff).toHaveLength(4);
    expect(unaffordable.state.restaurant.funds).toBe(149);

    const forgedSalary = renderReducer({ restaurant: { funds: 150 } });
    forgedSalary.dispatch({ type: 'HIRE_STAFF', staff: { ...makeStaff('forged'), salary: 0 } });
    expect(forgedSalary.state.restaurant.funds).toBe(0);
    expect(forgedSalary.state.staff.at(-1).salary).toBe(150);

    const unknownRole = renderReducer({ restaurant: { funds: 1000 } });
    unknownRole.dispatch({
      type: 'HIRE_STAFF',
      staff: { ...makeStaff('invalid'), role: 'manager', salary: 0 },
    });
    expect(unknownRole.state.staff).toHaveLength(4);
    expect(unknownRole.state.restaurant.funds).toBe(1000);
  });

  it('does not let staff development or service counters overdraw funds', () => {
    const training = renderReducer({ restaurant: { funds: 100 } });
    training.dispatch({ type: 'TRAIN_STAFF', id: 'starter-cook', cost: 0 });
    expect(training.state.restaurant.funds).toBe(0);
    expect(training.state.staff.find(staff => staff.id === 'starter-cook').skill).toBe(4);

    training.dispatch({ type: 'GIVE_BONUS', id: 'starter-cook', cost: -100 });
    expect(training.state.restaurant.funds).toBe(0);
    expect(training.state.staff.find(staff => staff.id === 'starter-cook').morale).toBe(80);

    const service = renderReducer({ restaurant: { funds: 299 } });
    service.dispatch({ type: 'BUY_SERVICE_TABLE', cost: 0 });
    expect(service.state.restaurant.funds).toBe(299);
    expect(service.state.serviceTables).toHaveLength(1);
  });

  it('uses the canonical expansion cost and rejects expansion at the configured maximum', () => {
    const game = renderReducer({ restaurant: { funds: 20000, expansionLevel: 3 } });
    const initialStationCount = game.state.kitchenStations.length;

    game.dispatch({ type: 'EXPAND', cost: 1 });

    expect(game.state.restaurant).toMatchObject({ funds: 14000, expansionLevel: 4 });
    expect(game.state.kitchenStations).toHaveLength(initialStationCount + 1);

    game.dispatch({ type: 'EXPAND', cost: 1 });

    expect(game.state.restaurant).toMatchObject({ funds: 14000, expansionLevel: 4 });
    expect(game.state.kitchenStations).toHaveLength(initialStationCount + 1);
  });

  it('enforces recipe slots, price limits, and paid dish quality', () => {
    const game = renderReducer({ restaurant: { funds: 50 } });
    const extraDish = { ...game.state.dishes[0], id: 'extra-dish' };

    game.dispatch({ type: 'ADD_DISH', dish: extraDish });
    expect(game.state.dishes).toHaveLength(1);

    game.dispatch({ type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: -20, quality: 10 } });
    expect(game.state.dishes[0]).toMatchObject({ price: 1, quality: 1 });

    game.dispatch({ type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 101 } });
    expect(game.state.dishes[0].price).toBe(100);

    game.dispatch({ type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast', cost: 0 });
    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.dishes[0].quality).toBe(2);

    game.dispatch({ type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast', cost: -50 });
    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.dishes[0].quality).toBe(2);

    game.dispatch({ type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: Number.POSITIVE_INFINITY } });
    expect(game.state.dishes[0].price).toBe(100);
  });

  it('canonicalises valid dish creation and rejects malformed dishes', () => {
    const initial = createInitialState();
    const game = renderReducer({ dishes: [], recipeSlots: 3 });
    const validDish = {
      ...initial.dishes[0],
      id: 'new-dish',
      price: 100.6,
      quality: 10,
    };

    game.dispatch({ type: 'ADD_DISH', dish: validDish });
    expect(game.state.dishes).toEqual([{ ...validDish, price: 100, quality: 1 }]);

    game.dispatch({ type: 'ADD_DISH', dish: { ...validDish, id: 'bad-price', price: Number.NaN } });
    game.dispatch({ type: 'ADD_DISH', dish: { ...validDish, id: 'bad-quality', quality: Number.NaN } });
    game.dispatch({ type: 'ADD_DISH', dish: { ...validDish, id: 'zero-quality', quality: 0 } });
    game.dispatch({ type: 'ADD_DISH', dish: { ...validDish, id: '' } });

    expect(game.state.dishes).toHaveLength(1);
  });

  it('normalises fractional quality before enforcing the paid maximum', () => {
    const initial = createInitialState();
    const game = renderReducer({
      restaurant: { funds: 50 },
      dishes: [{ ...initial.dishes[0], quality: 9.5 }],
    });

    game.dispatch({ type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' });

    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.dishes[0].quality).toBe(10);
  });
});

describe('GameProvider service counter actions', () => {
  beforeEach(() => localStorage.clear());

  it('prevents deleting a counter referenced by a food item ID', () => {
    const game = renderReducer({
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
      foodItems: [{
        id: 'food-1', serviceTableId: 'st1', state: 'on_service', x: 410, y: 130,
      }],
    });

    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });

    expect(game.state.serviceTables.map(table => table.id)).toEqual(['st1', 'st2']);
    expect(game.state.foodItems).toHaveLength(1);
  });

  it('uses geometry for legacy food without a counter ID while allowing unoccupied deletion', () => {
    const game = renderReducer({
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
      foodItems: [{ id: 'legacy-food', state: 'on_service', x: 150, y: 130 }],
    });

    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });
    expect(game.state.serviceTables.map(table => table.id)).toEqual(['st1', 'st2']);

    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st2' });
    expect(game.state.serviceTables.map(table => table.id)).toEqual(['st1']);
    expect(game.state.foodItems).toHaveLength(1);
  });
});
